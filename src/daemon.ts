// The review server. One per state directory, started by the CLI on demand.
// It binds 127.0.0.1 and ::1 and nothing else, serves the review UI and the
// sandboxed page, keeps the feedback log, and answers the CLI's long polls.

import fs from 'node:fs';
import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import MarkdownIt from 'markdown-it';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import { bearer, hostAllowed, LOOPBACK_HOSTS, originAllowed, tokenProof, tokensEqual, wsToken } from './guard.js';
import { injectScript, sourceLine } from './html.js';
import { FEEDBACK_SCHEMA, LIMITS, parseDraft, REPLY_SCHEMA } from './schema.js';
import type { DraftNote, NoteEntry, Reply } from './schema.js';
import { randomToken, readServerInfo, serverInfoPath, Store, writeJsonAtomic } from './store.js';
import type { Session, ServerInfo } from './store.js';
import { VERSION } from './version.js';

export const DEFAULT_PORT = 47470;
/** Fallback ports: explicit, and below the 32768-60999 ephemeral range most systems use. */
export const FALLBACK_PORTS = { min: 20000, max: 32000 } as const;

function randomPort(): number {
  return FALLBACK_PORTS.min + Math.floor(Math.random() * (FALLBACK_PORTS.max - FALLBACK_PORTS.min + 1));
}
const MAX_HOLD_MS = 25_000;
const PRESENCE_GRACE_MS = 4_000;
const RELOAD_DEBOUNCE_MS = 150;

const UI_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ui');

const md = new MarkdownIt({ html: false, linkify: false, typographer: false });
const defaultLinkOpen =
  md.renderer.rules.link_open ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  tokens[idx].attrSet('target', '_blank');
  tokens[idx].attrSet('rel', 'noopener noreferrer');
  return defaultLinkOpen(tokens, idx, options, env, self);
};

/** Agent text is Markdown with raw HTML disabled; markdown-it also refuses javascript: and similar links. */
export function renderReply(text: string): string {
  return md.render(text);
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

const SANDBOX = 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads';

interface Waiter {
  after: number;
  done: (entries: NoteEntry[] | null) => void;
}

interface Live {
  sockets: Set<WebSocket>;
  waiters: Set<Waiter>;
  lastWaiterGone: number;
  watcher?: fs.FSWatcher;
  reloadTimer?: NodeJS.Timeout;
  presenceTimer?: NodeJS.Timeout;
  lastPresence?: string;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function send(res: ServerResponse, status: number, body: string | Buffer, headers: Record<string, string> = {}): void {
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...headers,
  });
  res.end(body);
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  send(res, status, JSON.stringify(value), { 'Content-Type': 'application/json; charset=utf-8' });
}

async function readBody(req: IncomingMessage, limit: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new HttpError(413, 'request body too large');
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new HttpError(400, 'body must be JSON');
  }
}

function isHtmlFile(file: string): boolean {
  return /\.html?$/i.test(file);
}

export class Daemon {
  readonly store: Store;
  readonly adminToken = randomToken();
  port = 0;
  private servers: http.Server[] = [];
  private wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024, handleProtocols: () => 'vivamark.v1' });
  private live = new Map<string, Live>();
  private idleMs: number;
  private idleSince = Date.now();
  private timers: NodeJS.Timeout[] = [];

  constructor(store: Store, idleMs: number) {
    this.store = store;
    this.idleMs = idleMs;
  }

  private liveFor(s: Session): Live {
    let l = this.live.get(s.id);
    if (!l) {
      l = { sockets: new Set(), waiters: new Set(), lastWaiterGone: 0 };
      this.live.set(s.id, l);
    }
    return l;
  }

  // ---- listening ---------------------------------------------------------

  async listen(preferredPort: number): Promise<void> {
    const handler = (req: IncomingMessage, res: ServerResponse) => {
      this.handle(req, res).catch((err: unknown) => {
        const status = err instanceof HttpError ? err.status : 500;
        if (status === 500) console.error(err);
        if (!res.headersSent) sendJson(res, status, { error: err instanceof Error ? err.message : String(err) });
        else res.end();
      });
    };
    // Port 0 (let the OS pick) is never used: in some agent sandboxes a socket
    // bound to an OS-assigned port cannot be connected to, while an explicitly
    // chosen port works. Those sandboxes are a real place vivamark runs, so a
    // busy or unset port falls back to explicit random ports below the usual
    // ephemeral range instead.
    let port = preferredPort > 0 ? preferredPort : randomPort();
    for (let attempt = 0; attempt < 20; attempt++) {
      const v4 = http.createServer(handler);
      try {
        await listenOn(v4, LOOPBACK_HOSTS[0], port);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
          port = randomPort();
          continue;
        }
        throw err;
      }
      const bound = (v4.address() as { port: number }).port;
      const v6 = http.createServer(handler);
      try {
        await listenOn(v6, LOOPBACK_HOSTS[1], bound);
        this.servers = [v4, v6];
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'EADDRINUSE') {
          v4.close();
          port = randomPort();
          continue;
        }
        // No IPv6 loopback on this machine: serve IPv4 loopback only.
        this.servers = [v4];
      }
      this.port = bound;
      for (const s of this.servers) s.on('upgrade', (req, socket, head) => this.upgrade(req, socket, head));
      return;
    }
    throw new Error('could not find a free loopback port');
  }

  writeServerInfo(): void {
    const info: ServerInfo = {
      app: 'vivamark',
      pid: process.pid,
      port: this.port,
      version: VERSION,
      admin_token: this.adminToken,
      started: new Date().toISOString(),
    };
    writeJsonAtomic(serverInfoPath(this.store.dir), info);
  }

  startTimers(): void {
    this.timers.push(
      setInterval(() => {
        for (const l of this.live.values()) {
          for (const ws of l.sockets) {
            const w = ws as WebSocket & { alive?: boolean };
            if (w.alive === false) {
              ws.terminate();
              continue;
            }
            w.alive = false;
            ws.ping();
          }
        }
      }, 20_000),
      setInterval(() => {
        if (this.busy()) this.idleSince = Date.now();
        else if (Date.now() - this.idleSince > this.idleMs) void this.shutdown('idle');
      }, Math.min(60_000, Math.max(1_000, this.idleMs / 4))),
    );
    for (const t of this.timers) t.unref();
  }

  private busy(): boolean {
    for (const l of this.live.values()) if (l.sockets.size || l.waiters.size) return true;
    return false;
  }

  async shutdown(reason: string): Promise<void> {
    console.error(`vivamark daemon stopping (${reason})`);
    for (const t of this.timers) clearInterval(t);
    for (const l of this.live.values()) {
      for (const w of l.waiters) w.done(null);
      for (const ws of l.sockets) ws.close(1001, 'server stopping');
      l.watcher?.close();
    }
    const info = readServerInfo(this.store.dir);
    if (info && info.pid === process.pid) fs.rmSync(serverInfoPath(this.store.dir), { force: true });
    await Promise.all(this.servers.map((s) => new Promise<void>((r) => s.close(() => r()))));
    for (const s of this.servers) s.closeAllConnections();
    setTimeout(() => process.exit(0), 50).unref();
  }

  // ---- routing ------------------------------------------------------------

  private session(id: string): Session {
    const s = this.store.sessions.get(id);
    if (!s) throw new HttpError(404, 'no such session');
    return s;
  }

  private requireSessionToken(req: IncomingMessage, s: Session): void {
    if (!tokensEqual(bearer(req), s.token)) throw new HttpError(401, 'missing or wrong session token');
  }

  private requireAdmin(req: IncomingMessage): void {
    if (!tokensEqual(bearer(req), this.adminToken)) throw new HttpError(401, 'missing or wrong admin token');
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!hostAllowed(req, this.port)) throw new HttpError(403, 'host not allowed');
    const method = req.method ?? 'GET';
    if (method !== 'GET' && method !== 'HEAD' && !originAllowed(req, this.port, false)) {
      throw new HttpError(403, 'origin not allowed');
    }
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${this.port}`);
    const p = url.pathname;
    let m: RegExpExecArray | null;

    if (p === '/health' && method === 'GET') {
      const challenge = url.searchParams.get('challenge');
      return sendJson(res, 200, {
        app: 'vivamark',
        version: VERSION,
        schema: FEEDBACK_SCHEMA,
        pid: process.pid,
        ...(challenge && /^[0-9a-f]{16,128}$/.test(challenge) ? { proof: tokenProof(this.adminToken, challenge) } : {}),
      });
    }
    if (p === '/api/sessions' && method === 'POST') {
      this.requireAdmin(req);
      return this.openSession(req, res);
    }
    if (p === '/api/shutdown' && method === 'POST') {
      this.requireAdmin(req);
      sendJson(res, 200, { ok: true });
      void this.shutdown('stop requested');
      return;
    }
    if ((m = /^\/_vivamark\/(sdk\.js|chrome\.js|chrome\.css)$/.exec(p)) && method === 'GET') {
      return this.serveUiAsset(res, m[1]);
    }
    if ((m = /^\/s\/(s_[a-z0-9]+)$/.exec(p)) && method === 'GET') {
      this.session(m[1]);
      return this.serveChrome(req, res);
    }
    if ((m = /^\/a\/(s_[a-z0-9]+)\/([0-9a-f]{64})\/(.*)$/.exec(p)) && method === 'GET') {
      const s = this.session(m[1]);
      if (!tokensEqual(m[2], s.artifact_key)) throw new HttpError(404, 'not found');
      return this.serveArtifact(res, s, m[3], url.searchParams.get('vmload') ?? '');
    }
    if ((m = /^\/api\/s\/(s_[a-z0-9]+)(\/[a-z]+)?$/.exec(p))) {
      const s = this.session(m[1]);
      this.requireSessionToken(req, s);
      const sub = m[2] ?? '';
      if (sub === '' && method === 'GET') return sendJson(res, 200, this.sessionView(s));
      if (sub === '/feedback' && method === 'GET') return this.feedback(req, res, s, url);
      if (sub === '/send' && method === 'POST') {
        if (!originAllowed(req, this.port, true)) throw new HttpError(403, 'notes are sent from the review page only');
        return this.receiveNotes(req, res, s);
      }
      if (sub === '/replies' && method === 'POST') return this.receiveReply(req, res, s);
    }
    throw new HttpError(404, 'not found');
  }

  private async openSession(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = (await readBody(req, 64 * 1024)) as { file?: unknown; labels?: unknown };
    if (typeof body.file !== 'string' || !path.isAbsolute(body.file)) throw new HttpError(400, 'file must be an absolute path');
    let file: string;
    try {
      file = fs.realpathSync(body.file);
    } catch {
      throw new HttpError(400, `no such file: ${body.file}`);
    }
    if (!fs.statSync(file).isFile()) throw new HttpError(400, `not a file: ${file}`);
    if (!isHtmlFile(file)) throw new HttpError(400, 'only .html and .htm files can be opened for now');
    const labels: Record<string, string> = {};
    if (body.labels && typeof body.labels === 'object') {
      for (const [k, v] of Object.entries(body.labels as Record<string, unknown>)) {
        if (typeof v === 'string' && k.length <= 64 && v.length <= 256) labels[k] = v;
      }
    }
    const { session, created } = this.store.openSession(file, labels);
    sendJson(res, created ? 201 : 200, { id: session.id, file: session.file, created, labels: session.labels });
  }

  private sessionView(s: Session) {
    return {
      id: s.id,
      file: s.file,
      name: path.basename(s.file),
      status: s.status,
      labels: s.labels,
      artifact_url: `/a/${s.id}/${s.artifact_key}/${encodeURIComponent(path.basename(s.file))}`,
      notes: s.log.filter((e) => e.type === 'note'),
      replies: s.replies.map((r) => this.replyView(r)),
      agent: this.presence(s),
    };
  }

  private replyView(r: Reply) {
    return { seq: r.seq, at: r.at, text: r.text, html: renderReply(r.text) };
  }

  // ---- static -------------------------------------------------------------

  private serveUiAsset(res: ServerResponse, name: string): void {
    const body = fs.readFileSync(path.join(UI_DIR, name));
    send(res, 200, body, { 'Content-Type': MIME[path.extname(name)] });
  }

  private serveChrome(req: IncomingMessage, res: ServerResponse): void {
    const host = req.headers.host!;
    const csp = [
      "default-src 'none'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data:",
      "font-src 'self'",
      `connect-src 'self' ws://${host}`,
      "frame-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "form-action 'none'",
    ].join('; ');
    const body = fs.readFileSync(path.join(UI_DIR, 'chrome.html'));
    send(res, 200, body, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': csp,
      'X-Frame-Options': 'DENY',
    });
  }

  private serveArtifact(res: ServerResponse, s: Session, rest: string, load: string): void {
    const headers = { 'Content-Security-Policy': `sandbox ${SANDBOX}` };
    let rel: string;
    try {
      rel = decodeURIComponent(rest);
    } catch {
      throw new HttpError(400, 'bad path');
    }
    if (rel === '' || rel === path.basename(s.file)) {
      let html: string;
      try {
        html = fs.readFileSync(s.file, 'utf8');
      } catch {
        throw new HttpError(404, 'the reviewed file is missing');
      }
      const safeLoad = /^[a-z0-9]{1,32}$/.test(load) ? load : '';
      const tag = `<script src="/_vivamark/sdk.js" data-vivamark-load="${safeLoad}"></script>`;
      return send(res, 200, injectScript(html, tag), { ...headers, 'Content-Type': 'text/html; charset=utf-8' });
    }
    // A sibling asset: confined to the page's directory, symlinks included, and no dotfiles.
    if (rel.split(/[\\/]/).some((seg) => seg.startsWith('.'))) throw new HttpError(404, 'not found');
    const root = path.dirname(s.file);
    let real: string;
    try {
      real = fs.realpathSync(path.resolve(root, rel));
    } catch {
      throw new HttpError(404, 'not found');
    }
    if (!real.startsWith(root + path.sep) || !fs.statSync(real).isFile()) throw new HttpError(404, 'not found');
    const type = MIME[path.extname(real).toLowerCase()] ?? 'application/octet-stream';
    send(res, 200, fs.readFileSync(real), { ...headers, 'Content-Type': type });
  }

  // ---- feedback -----------------------------------------------------------

  private async receiveNotes(req: IncomingMessage, res: ServerResponse, s: Session): Promise<void> {
    const body = (await readBody(req, LIMITS.sendBody)) as { notes?: unknown };
    if (!Array.isArray(body.notes) || body.notes.length === 0) throw new HttpError(400, 'notes must be a non-empty array');
    if (body.notes.length > LIMITS.notesPerBatch) throw new HttpError(400, 'too many notes in one send');
    const drafts: DraftNote[] = [];
    for (const n of body.notes) {
      const d = parseDraft(n);
      if (typeof d === 'string') throw new HttpError(400, d);
      drafts.push(d);
    }
    let html = '';
    try {
      html = fs.readFileSync(s.file, 'utf8');
    } catch {
      // The file is gone: notes keep their anchors, without line numbers.
    }
    const entries = this.store.appendBatch(s, drafts, (d) => (html && d.anchor ? sourceLine(html, d.anchor) : null));
    sendJson(res, 201, { seq: { from: entries[0].seq, to: entries[entries.length - 1].seq }, notes: entries });
    this.broadcast(s, { type: 'notes', entries });
    const l = this.liveFor(s);
    for (const w of [...l.waiters]) {
      const ready = s.log.filter((e) => e.seq > w.after);
      if (ready.length) w.done(ready);
    }
  }

  private async feedback(req: IncomingMessage, res: ServerResponse, s: Session, url: URL): Promise<void> {
    const owner = url.searchParams.get('owner') || 'agent';
    if (!/^[A-Za-z0-9._:-]{1,64}$/.test(owner)) throw new HttpError(400, 'bad owner');
    const afterParam = url.searchParams.get('after');
    let after: number;
    if (afterParam !== null) {
      if (!/^\d+$/.test(afterParam)) throw new HttpError(400, 'after must be a whole number');
      after = Number(afterParam);
      // An explicit --after is the reader's acknowledgement: it becomes the stored cursor.
      this.store.setCursor(s, owner, after);
    } else {
      after = s.cursors[owner] ?? 0;
    }
    const hold = Math.min(MAX_HOLD_MS, Math.max(0, Number(url.searchParams.get('hold') ?? 0) || 0));
    const view = (entries: NoteEntry[]) => ({
      schema: FEEDBACK_SCHEMA,
      session: { id: s.id, file: s.file, status: s.status, labels: s.labels },
      status: 'feedback',
      seq: { from: entries[0].seq, to: entries[entries.length - 1].seq },
      notes: entries.map((e) => ({ seq: e.seq, ...e.note })),
    });
    const pending = () => ({
      schema: FEEDBACK_SCHEMA,
      session: { id: s.id, file: s.file, status: s.status, labels: s.labels },
      status: 'pending',
      after,
      last_seq: this.store.lastSeq(s),
    });

    const ready = s.log.filter((e) => e.seq > after);
    if (ready.length) return sendJson(res, 200, view(ready));
    if (hold === 0) return sendJson(res, 200, pending());

    const l = this.liveFor(s);
    await new Promise<void>((resolve) => {
      let finished = false;
      const waiter: Waiter = {
        after,
        done: (entries) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          l.waiters.delete(waiter);
          l.lastWaiterGone = Date.now();
          this.schedulePresence(s);
          if (!res.writableEnded && !res.destroyed) sendJson(res, 200, entries ? view(entries) : pending());
          resolve();
        },
      };
      const timer = setTimeout(() => waiter.done(null), hold);
      req.on('close', () => waiter.done(null));
      l.waiters.add(waiter);
      this.schedulePresence(s);
    });
  }

  private async receiveReply(req: IncomingMessage, res: ServerResponse, s: Session): Promise<void> {
    const body = (await readBody(req, LIMITS.reply + 4096)) as { text?: unknown };
    if (typeof body.text !== 'string' || !body.text.trim()) throw new HttpError(400, 'text is required');
    if (body.text.length > LIMITS.reply) throw new HttpError(413, 'reply is too long');
    const reply = this.store.appendReply(s, body.text);
    sendJson(res, 201, { schema: REPLY_SCHEMA, session: s.id, seq: reply.seq, at: reply.at });
    this.broadcast(s, { type: 'reply', reply: this.replyView(reply) });
  }

  // ---- presence and live events --------------------------------------------

  private presence(s: Session): 'listening' | 'away' {
    const l = this.live.get(s.id);
    if (!l) return 'away';
    if (l.waiters.size || Date.now() - l.lastWaiterGone < PRESENCE_GRACE_MS) return 'listening';
    return 'away';
  }

  /** The CLI re-polls every few seconds; only report "away" once it has been gone for the grace period. */
  private schedulePresence(s: Session): void {
    const l = this.liveFor(s);
    const now = this.presence(s);
    if (now !== l.lastPresence) {
      l.lastPresence = now;
      this.broadcast(s, { type: 'presence', agent: now });
    }
    clearTimeout(l.presenceTimer);
    if (now === 'listening' && !l.waiters.size) {
      l.presenceTimer = setTimeout(() => this.schedulePresence(s), PRESENCE_GRACE_MS + 50);
      l.presenceTimer.unref();
    }
  }

  private broadcast(s: Session, event: unknown): void {
    const l = this.live.get(s.id);
    if (!l) return;
    const data = JSON.stringify(event);
    for (const ws of l.sockets) ws.send(data);
  }

  private upgrade(req: IncomingMessage, socket: import('node:stream').Duplex, head: Buffer): void {
    const refuse = (code: number, text: string) => {
      socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      socket.destroy();
    };
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${this.port}`);
    const m = /^\/api\/s\/(s_[a-z0-9]+)\/events$/.exec(url.pathname);
    if (!hostAllowed(req, this.port)) return refuse(403, 'Forbidden');
    if (!originAllowed(req, this.port, true)) return refuse(403, 'Forbidden');
    const s = m ? this.store.sessions.get(m[1]) : undefined;
    if (!s) return refuse(404, 'Not Found');
    if (!tokensEqual(wsToken(req), s.token)) return refuse(401, 'Unauthorized');
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      const l = this.liveFor(s);
      l.sockets.add(ws);
      (ws as WebSocket & { alive?: boolean }).alive = true;
      ws.on('pong', () => ((ws as WebSocket & { alive?: boolean }).alive = true));
      ws.on('message', () => {
        // The review UI sends nothing over the socket today; notes go through POST /send.
      });
      ws.on('close', () => {
        l.sockets.delete(ws);
        if (!l.sockets.size) this.unwatch(l);
      });
      this.watch(s, l);
      ws.send(JSON.stringify({ type: 'hello', agent: this.presence(s), version: VERSION }));
    });
  }

  /** Watches the page's directory (not the file: editors often replace files by rename) for live reload. */
  private watch(s: Session, l: Live): void {
    if (l.watcher) return;
    const name = path.basename(s.file);
    try {
      l.watcher = fs.watch(path.dirname(s.file), { persistent: false }, (_event, changed) => {
        if (changed && changed.toString() !== name) return;
        clearTimeout(l.reloadTimer);
        l.reloadTimer = setTimeout(() => this.broadcast(s, { type: 'reload' }), RELOAD_DEBOUNCE_MS);
      });
      l.watcher.on('error', () => this.unwatch(l));
    } catch {
      // Live reload is a convenience; the review still works without it.
    }
  }

  private unwatch(l: Live): void {
    l.watcher?.close();
    l.watcher = undefined;
  }
}

function listenOn(server: http.Server, host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen({ host, port, exclusive: true, ipv6Only: host === '::1' });
  });
}

/** Entry point for `vivamark __daemon`, which the CLI starts detached. */
export async function runDaemon(): Promise<void> {
  const store = new Store();
  // VIVAMARK_PORT picks the port only, never the address. 0 means "a random free port".
  const envPort = process.env.VIVAMARK_PORT;
  const port = envPort !== undefined && /^\d+$/.test(envPort) && Number(envPort) < 65536 ? Number(envPort) : DEFAULT_PORT;
  const idleMs = Number(process.env.VIVAMARK_IDLE_MS) || 30 * 60_000;
  const daemon = new Daemon(store, idleMs);
  await daemon.listen(port);
  daemon.writeServerInfo();
  daemon.startTimers();
  const stop = () => void daemon.shutdown('signal');
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  console.error(`vivamark daemon ${VERSION} listening on 127.0.0.1:${daemon.port} (pid ${process.pid})`);
}
