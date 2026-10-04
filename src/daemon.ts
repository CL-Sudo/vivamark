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
import { createHash } from 'node:crypto';
import { diffText } from './diff.js';
import type { TextChanges } from './diff.js';
import { docKind, findQuote, loadDoc, locate, namedTarget, placeAnchor, renderMarkdownPage, squash, textOf } from './doc.js';
import type { AnchorState, Doc, Place } from './doc.js';
import { EventLog } from './events.js';
import { injectScript } from './html.js';
import { sniffImage } from './image.js';
import { configPath, Notifier, notifyConfig } from './notify.js';
import { AGENT_STATUSES, DECISIONS, SOURCE_NAME, entryDecision, FEEDBACK_SCHEMA, IMAGE_LIMITS, LIMITS, NOTE_ID, parseDecision, parseDraft, REPLY_SCHEMA, STATUS_SCHEMA } from './schema.js';
import type { AgentNote, AgentStatus, Anchor, Attachment, Decision, DraftNote, LogEntry, Note, NoteEntry, NoteStatus, Reply, Turn } from './schema.js';
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
/** How long a wait goes on with no review page connected before it returns `disconnected`. */
export const DISCONNECT_GRACE_MS = 10_000;
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

const DECISION_SET = new Set<string>(DECISIONS);

/** A reader's name for its cursor (`--owner`). */
const OWNER = /^[A-Za-z0-9._:-]{1,64}$/;

const SANDBOX = 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads';

/** How a long poll ends: new log entries, the session ended, the review page gone, or nothing (re-poll). */
type WaitResult = LogEntry[] | 'ended' | 'disconnected' | null;

interface Waiter {
  after: number;
  done: (result: WaitResult) => void;
  disconnectTimer?: NodeJS.Timeout;
}

interface Live {
  sockets: Set<WebSocket>;
  waiters: Set<Waiter>;
  lastWaiterGone: number;
  /** Since when no review page has been connected (or since this session was first seen). */
  noBrowserSince: number;
  /** Since when the agent has been waiting without a break longer than the presence grace. */
  listeningSince: number;
  /** Whether the event log last said a review page is connected, and the pending "disconnected". */
  browserAnnounced: boolean;
  browserGoneTimer?: NodeJS.Timeout;
  watcher?: fs.FSWatcher;
  reloadTimer?: NodeJS.Timeout;
  presenceTimer?: NodeJS.Timeout;
  lastPresence?: string;
}

/** What re-anchoring found for one note, against the file as it is now. */
interface NoteState {
  state: AnchorState;
  current: Place | null;
  /** F2: the target's text differs from what it was when the note was sent. */
  changed?: boolean;
}

/** The derived state of a session for one version of the file and the log. */
interface Analysis {
  key: string;
  notes: Map<string, NoteState>;
  /** F2: what changed in the page's text since the latest Send, or null before any Send or without a snapshot. */
  changes: (TextChanges & { since: string; batch: string }) | null;
}

/** A note's target as text, for telling whether it changed: an element's text, or a quote with some context. */
function targetText(doc: Doc, anchor: Anchor, el: ReturnType<typeof locate>['el']): string | null {
  if (!el) return null;
  if (anchor.quote === undefined) return squash(textOf(doc, el));
  const r = doc.ranges.get(el);
  const at = r ? findQuote(doc, anchor, r[0], r[1]) : -1;
  if (at < 0) return null;
  const ctx = 40;
  return squash(doc.text.slice(Math.max(0, at - ctx), at + anchor.quote.length + ctx));
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

/** Reads a raw request body, refusing it (413) once it passes `limit` bytes. */
async function readRaw(req: IncomingMessage, limit: number, what: string): Promise<Buffer> {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) throw new HttpError(413, what);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new HttpError(413, what);
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

export interface ImageLimits {
  imageBytes: number;
  noteBytes: number;
}

function mb(n: number): string {
  return `${Math.round((n / (1024 * 1024)) * 10) / 10} MB`;
}

/**
 * How large attached images may be: VIVAMARK_MAX_IMAGE_BYTES and
 * VIVAMARK_MAX_NOTE_IMAGE_BYTES, else "max_image_bytes" and
 * "max_note_image_bytes" in the config file, else 10 MB and 25 MB.
 */
export function imageLimits(env: NodeJS.ProcessEnv = process.env): ImageLimits {
  let file: { max_image_bytes?: unknown; max_note_image_bytes?: unknown } = {};
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(configPath(env), 'utf8'));
    if (parsed && typeof parsed === 'object') file = parsed as typeof file;
  } catch {
    // No config file, or one the notify reader has already complained about.
  }
  const pick = (fromEnv: string | undefined, fromFile: unknown, fallback: number) => {
    const n = Number(fromEnv) || Number(fromFile);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
  };
  const imageBytes = pick(env.VIVAMARK_MAX_IMAGE_BYTES, file.max_image_bytes, IMAGE_LIMITS.imageBytes);
  const noteBytes = pick(env.VIVAMARK_MAX_NOTE_IMAGE_BYTES, file.max_note_image_bytes, IMAGE_LIMITS.noteBytes);
  return { imageBytes, noteBytes: Math.max(noteBytes, imageBytes) };
}

export class Daemon {
  readonly store: Store;
  readonly events: EventLog;
  readonly adminToken = randomToken();
  port = 0;
  private servers: http.Server[] = [];
  private wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024, handleProtocols: () => 'vivamark.v1' });
  private live = new Map<string, Live>();
  private analyses = new Map<string, Analysis>();
  /** Parsed snapshots by session and hash; a few per session are enough. */
  private snapshotDocs = new Map<string, Doc | null>();
  private idleMs: number;
  private idleSince = Date.now();
  private timers: NodeJS.Timeout[] = [];
  private disconnectGraceMs: number;
  readonly imageLimits: ImageLimits;
  private stopping = false;

  constructor(store: Store, idleMs: number, opts: { disconnectGraceMs?: number; imageLimits?: ImageLimits } = {}) {
    this.store = store;
    this.events = new EventLog(store.dir);
    this.idleMs = idleMs;
    this.disconnectGraceMs = opts.disconnectGraceMs ?? DISCONNECT_GRACE_MS;
    this.imageLimits = opts.imageLimits ?? { ...IMAGE_LIMITS };
  }

  private liveFor(s: Session): Live {
    let l = this.live.get(s.id);
    if (!l) {
      const now = Date.now();
      l = { sockets: new Set(), waiters: new Set(), lastWaiterGone: 0, noBrowserSince: now, listeningSince: now, browserAnnounced: false };
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
    this.stopping = true;
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
    if (!hostAllowed(req)) throw new HttpError(403, 'host not allowed');
    const method = req.method ?? 'GET';
    if (method !== 'GET' && method !== 'HEAD' && !originAllowed(req, false)) {
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
    if (p === '/api/status' && method === 'GET') {
      this.requireAdmin(req);
      const owner = url.searchParams.get('owner') || 'agent';
      if (!OWNER.test(owner)) throw new HttpError(400, 'bad owner');
      const id = url.searchParams.get('session');
      if (id !== null) return sendJson(res, 200, { schema: STATUS_SCHEMA, ...this.statusView(this.session(id), owner) });
      const sessions = [...this.store.sessions.values()].sort((a, b) => a.created.localeCompare(b.created));
      return sendJson(res, 200, { schema: STATUS_SCHEMA, sessions: sessions.map((s) => this.statusView(s, owner)) });
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
    if ((m = /^\/api\/s\/(s_[a-z0-9]+)\/attachments\/([0-9a-f]{64})$/.exec(p)) && method === 'GET') {
      const s = this.session(m[1]);
      this.requireSessionToken(req, s);
      const found = this.store.readAttachment(s, m[2]);
      if (!found) throw new HttpError(404, 'no such attachment');
      return send(res, 200, found.data, { 'Content-Type': found.attachment.mime, 'Content-Security-Policy': "default-src 'none'" });
    }
    if ((m = /^\/api\/s\/(s_[a-z0-9]+)(\/[a-z-]+)?$/.exec(p))) {
      const s = this.session(m[1]);
      this.requireSessionToken(req, s);
      const sub = m[2] ?? '';
      if (sub === '' && method === 'GET') return sendJson(res, 200, this.sessionView(s));
      if (sub === '/feedback' && method === 'GET') return this.feedback(req, res, s, url);
      if (sub === '/end' && method === 'POST') return this.receiveEnd(req, res, s);
      // An ended review takes nothing more from either side.
      if (method === 'POST' && s.status === 'ended') throw new HttpError(409, 'this review has ended; open the file again to start a new one');
      if (sub === '/send' && method === 'POST') {
        if (!originAllowed(req, true)) throw new HttpError(403, 'notes are sent from the review page only');
        return this.receiveNotes(req, res, s);
      }
      if (sub === '/attachments' && method === 'POST') {
        // Images come from the reviewer's review page, with the same token and Origin rules as Send.
        if (!originAllowed(req, true)) throw new HttpError(403, 'images are attached from the review page only');
        return this.receiveAttachment(req, res, s);
      }
      if (sub === '/replies' && method === 'POST') return this.receiveReply(req, res, s);
      if (sub === '/agent-notes' && method === 'POST') return this.receiveAgentNote(req, res, s);
      if (sub === '/resolve' && method === 'POST') {
        // Only the reviewer resolves a note (F6): from the review page, never the CLI.
        if (!originAllowed(req, true)) throw new HttpError(403, 'only the reviewer resolves a note, from the review page');
        return this.receiveResolve(req, res, s);
      }
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
    if (!docKind(file)) throw new HttpError(400, 'only .html, .htm, .md and .markdown files can be opened');
    const labels: Record<string, string> = {};
    if (body.labels && typeof body.labels === 'object') {
      for (const [k, v] of Object.entries(body.labels as Record<string, unknown>)) {
        if (typeof v === 'string' && k.length <= 64 && v.length <= 256) labels[k] = v;
      }
    }
    const { session, created } = this.store.openSession(file, labels);
    sendJson(res, created ? 201 : 200, { id: session.id, file: session.file, created, labels: session.labels });
    if (created) this.events.append('session.opened', session, {});
  }

  private sessionView(s: Session) {
    const a = this.analyze(s);
    const p = this.progress(s);
    return {
      id: s.id,
      file: s.file,
      name: path.basename(s.file),
      status: s.status,
      ...(s.ended ? { ended: s.ended } : {}),
      labels: s.labels,
      artifact_url: `/a/${s.id}/${s.artifact_key}/${encodeURIComponent(path.basename(s.file))}`,
      notes: this.noteEntries(s).map((e) => ({ ...e, note: this.noteView(e.note, a, p.status.get(e.note.id)) })),
      turn: p.turn,
      decisions: this.decisions(s),
      changes: a.changes,
      agent_notes: this.agentNotesView(s, a),
      replies: s.replies.map((r) => this.replyView(r)),
      agent: this.presence(s),
      limits: { image_bytes: this.imageLimits.imageBytes, note_image_bytes: this.imageLimits.noteBytes },
    };
  }

  /**
   * Where a review stands, for `vivamark status`: what a supervisor polls. It
   * never blocks and never moves a cursor, so it takes nothing from the agent.
   */
  private statusView(s: Session, owner: string) {
    const cursor = s.cursors[owner] ?? 0;
    const last = s.log.at(-1);
    return {
      session: { id: s.id, file: s.file, status: s.status, labels: s.labels },
      owner,
      cursor,
      pending: this.noteEntries(s).filter((e) => e.seq > cursor).length,
      last_seq: this.store.lastSeq(s),
      decision: last ? entryDecision(last) : null,
      turn: this.progress(s).turn,
      reviewer: this.live.get(s.id)?.sockets.size ? 'connected' : s.browser_seen ? 'disconnected' : 'never-opened',
      agent: this.presence(s),
      created: s.created,
    };
  }

  /** One entry per Send that did more than request changes, for the review page's thread. */
  private decisions(s: Session) {
    const out: { batch: string; seq: number; at: string; decision: string }[] = [];
    for (const e of s.log) {
      const decision = entryDecision(e);
      if (decision === 'request-changes' || out.some((d) => d.batch === e.batch)) continue;
      out.push({ batch: e.batch, seq: e.seq, at: e.at, decision });
    }
    return out;
  }

  private replyView(r: Reply) {
    return { seq: r.seq, at: r.at, text: r.text, html: renderReply(r.text), ...(r.note ? { note: r.note, status: r.status } : {}) };
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
      // A Markdown file is rendered to a page; the saved file itself is never changed.
      if (docKind(s.file) === 'markdown') html = renderMarkdownPage(html, path.basename(s.file));
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

  /**
   * Each note's status and whose turn it is (F6). A note waits on the agent
   * while it is open and the agent has not replied since it was sent.
   */
  private progress(s: Session): { status: Map<string, NoteStatus>; turn: Turn } {
    const status = new Map<string, NoteStatus>();
    const notes = this.noteEntries(s);
    for (const e of notes) status.set(e.note.id, 'open');
    for (const r of s.replies) if (r.note && r.status && status.has(r.note)) status.set(r.note, r.status);
    for (const e of notes) {
      const q = e.note.answers;
      if (q && status.get(q) === 'question') status.set(q, 'answered');
    }
    const resolved = new Map<string, boolean>();
    for (const a of s.annotations) if (a.type === 'resolve') resolved.set(a.note, a.resolved);
    for (const [id, r] of resolved) if (r && status.has(id)) status.set(id, 'resolved');
    const lastGeneralReply = s.replies.filter((r) => !r.note).at(-1)?.at ?? '';
    const waiting = notes.some((e) => status.get(e.note.id) === 'open' && e.at > lastGeneralReply);
    return { status, turn: waiting ? 'agent' : 'reviewer' };
  }

  private noteEntries(s: Session): NoteEntry[] {
    return s.log.filter((e): e is NoteEntry => e.type === 'note');
  }

  /**
   * Re-resolves every note's anchor against the file as it is now (F3).
   * Cached until the file or the log changes.
   */
  private analyze(s: Session): Analysis {
    let source: string | null = null;
    try {
      source = fs.readFileSync(s.file, 'utf8');
    } catch {
      // The file is gone: so is every target on it.
    }
    const key = `${source === null ? 'gone' : createHash('sha256').update(source).digest('hex')}:${s.log.length}:${s.annotations.length}`;
    const cached = this.analyses.get(s.id);
    if (cached?.key === key) return cached;
    const doc: Doc | null = source === null ? null : loadDoc(docKind(s.file) ?? 'html', source, path.basename(s.file));
    const notes = new Map<string, NoteState>();
    for (const n of this.store.agentNotes(s)) {
      if (!n.anchor) continue;
      const found = doc ? locate(doc, n.anchor) : null;
      notes.set(n.id, { state: found?.state ?? 'orphaned', current: found?.place ?? null });
    }
    for (const e of this.noteEntries(s)) {
      const anchor = e.note.anchor;
      if (!anchor) continue;
      const found = doc ? locate(doc, anchor) : null;
      const st: NoteState = { state: found?.state ?? 'orphaned', current: found?.place ?? null };
      const then = e.snapshot ? this.snapshotDoc(s, e.snapshot) : null;
      if (then && doc) {
        const before = targetText(then, anchor, locate(then, anchor).el);
        const now = found ? targetText(doc, anchor, found.el) : null;
        st.changed = before !== null && before !== now;
      }
      notes.set(e.note.id, st);
    }
    let changes: Analysis['changes'] = null;
    const last = [...s.log].reverse().find((e) => e.snapshot);
    const before = last?.snapshot ? this.snapshotDoc(s, last.snapshot) : null;
    if (last && before && doc) changes = { since: last.at, batch: last.batch, ...diffText(before.text, doc.text) };
    const analysis: Analysis = { key, notes, changes };
    this.analyses.set(s.id, analysis);
    return analysis;
  }

  private snapshotDoc(s: Session, hash: string): Doc | null {
    const key = `${s.id}:${hash}`;
    if (this.snapshotDocs.has(key)) return this.snapshotDocs.get(key)!;
    const source = this.store.readSnapshot(s, hash);
    const doc = source === null ? null : loadDoc(docKind(s.file) ?? 'html', source, path.basename(s.file));
    if (this.snapshotDocs.size > 32) this.snapshotDocs.delete(this.snapshotDocs.keys().next().value!);
    this.snapshotDocs.set(key, doc);
    return doc;
  }

  /** A note as readers see it: the logged note, plus where its target is now. */
  private noteView<N extends Note | AgentNote>(n: N, a: Analysis, status?: string): N & { status?: string } {
    const tail: { status?: string } = status ? { status } : {};
    const st = n.anchor ? a.notes.get(n.id) : undefined;
    if (!n.anchor || !st) return { ...n, ...tail };
    const anchor: Anchor & { state: AnchorState; current?: Place } = { ...n.anchor, state: st.state };
    const stale = st.current && (st.state === 'moved' || JSON.stringify(st.current.lines) !== JSON.stringify(n.anchor.lines ?? null));
    if (st.current && stale) anchor.current = st.current;
    return { ...n, anchor, ...(st.changed !== undefined ? { target_changed: st.changed } : {}), ...tail } as N & { status?: string };
  }

  /** Agent notes for the review page, each with what the reviewer has done with it (F7). */
  private agentNotesView(s: Session, a: Analysis) {
    const notes = this.noteEntries(s);
    return this.store.agentNotes(s).map((n) => {
      const status = notes.some((e) => e.note.endorses === n.id) ? 'endorsed' : notes.some((e) => e.note.replies_to === n.id) ? 'replied' : 'shown';
      return this.noteView(n, a, status);
    });
  }

  private orphaned(s: Session, a: Analysis): string[] {
    return this.noteEntries(s)
      .filter((e) => a.notes.get(e.note.id)?.state === 'orphaned')
      .map((e) => e.note.id);
  }

  /** The reviewed file, parsed; null when it is gone (notes then keep their anchors, without lines). */
  private readDoc(s: Session) {
    let source: string;
    try {
      source = fs.readFileSync(s.file, 'utf8');
    } catch {
      return null;
    }
    return loadDoc(docKind(s.file) ?? 'html', source, path.basename(s.file));
  }

  private async receiveNotes(req: IncomingMessage, res: ServerResponse, s: Session): Promise<void> {
    const body = (await readBody(req, LIMITS.sendBody)) as { notes?: unknown; decision?: unknown };
    const notes = body.notes ?? [];
    if (!Array.isArray(notes)) throw new HttpError(400, 'notes must be an array');
    if (notes.length > LIMITS.notesPerBatch) throw new HttpError(400, 'too many notes in one send');
    const decision = parseDecision(body.decision, notes.length);
    if (!(DECISION_SET as Set<string>).has(decision)) throw new HttpError(400, decision);
    const drafts: DraftNote[] = [];
    const images = new Map<string, Attachment>();
    const known = new Set(this.noteEntries(s).map((e) => e.note.id));
    const agentNotes = new Map(this.store.agentNotes(s).map((n) => [n.id, n]));
    for (const n of notes) {
      const d = parseDraft(n);
      if (typeof d === 'string') throw new HttpError(400, d);
      if (d.answers && !known.has(d.answers)) throw new HttpError(400, `note.answers: no note ${d.answers} in this review`);
      const link = d.endorses ?? d.replies_to;
      if (link && !agentNotes.has(link)) throw new HttpError(400, `no agent note ${link} in this review`);
      let total = 0;
      for (const id of d.attachments ?? []) {
        const a = images.get(id) ?? this.store.readAttachment(s, id)?.attachment;
        if (!a) throw new HttpError(400, `no attached image ${id.slice(0, 12)}… in this review; attach it again`);
        images.set(id, a);
        total += a.bytes;
      }
      if (total > this.imageLimits.noteBytes) throw new HttpError(413, `the images on one note come to more than ${mb(this.imageLimits.noteBytes)}`);
      drafts.push(d);
    }
    const doc = this.readDoc(s);
    // F2: keep the file as the reviewer saw it, for "what changed since I last sent".
    const snapshot = doc ? this.store.saveSnapshot(s, doc.source) : undefined;
    const entries = this.store.appendBatch(
      s,
      drafts,
      decision as Decision,
      snapshot,
      (d) => (doc && d.anchor ? placeAnchor(doc, d.anchor) : null),
      (id) => agentNotes.get(id),
      (d) => (d.attachments ?? []).map((id) => images.get(id)!),
    );
    const seq = { from: entries[0].seq, to: entries[entries.length - 1].seq };
    sendJson(res, 201, { seq, notes: entries });
    this.broadcast(s, { type: 'notes', entries });
    const attached = drafts.reduce((n, d) => n + (d.attachments?.length ?? 0), 0);
    this.events.append('feedback.sent', s, { decision: decision as Decision, notes: drafts.length, feedback_seq: seq, attachments: attached });
    for (const d of drafts) if (d.answers) this.events.append('note.status', s, { note: d.answers, status: 'answered', by: 'reviewer' });
    const l = this.liveFor(s);
    for (const w of [...l.waiters]) {
      const ready = s.log.filter((e) => e.seq > w.after);
      if (ready.length) w.done(ready);
    }
  }

  /**
   * Keeps one image for a note the reviewer is writing. Nothing reaches the
   * agent here: an image is delivered only on a note the reviewer sends.
   */
  private async receiveAttachment(req: IncomingMessage, res: ServerResponse, s: Session): Promise<void> {
    const limit = this.imageLimits.imageBytes;
    const bytes = await readRaw(req, limit, `an image may be at most ${mb(limit)}`);
    const info = sniffImage(bytes);
    if (!info) throw new HttpError(415, 'only PNG, JPEG, GIF and WebP images can be attached');
    const a = this.store.saveAttachment(s, bytes, info);
    sendJson(res, 201, { id: a.id, mime: a.mime, width: a.width, height: a.height, bytes: a.bytes });
  }

  private async feedback(req: IncomingMessage, res: ServerResponse, s: Session, url: URL): Promise<void> {
    const owner = url.searchParams.get('owner') || 'agent';
    if (!OWNER.test(owner)) throw new HttpError(400, 'bad owner');
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
    const view = (entries: LogEntry[]) => {
      const a = this.analyze(s);
      const p = this.progress(s);
      return {
        schema: FEEDBACK_SCHEMA,
        session: { id: s.id, file: s.file, status: s.status, labels: s.labels },
        status: 'feedback',
        seq: { from: entries[0].seq, to: entries[entries.length - 1].seq },
        notes: entries.filter((e): e is NoteEntry => e.type === 'note').map((e) => ({ seq: e.seq, ...this.noteView(e.note, a, p.status.get(e.note.id)) })),
        // The latest Send in the range decides.
        decision: entryDecision(entries[entries.length - 1]),
        turn: p.turn,
        // Every unresolved note in the session whose target is gone, not only those in this range.
        orphaned: this.orphaned(s, a).filter((id) => p.status.get(id) !== 'resolved'),
      };
    };
    // Nothing is consumed by any of these: the cursor moves only on an explicit --after.
    const pending = (status: 'pending' | 'ended' | 'disconnected' = 'pending') => ({
      schema: FEEDBACK_SCHEMA,
      session: { id: s.id, file: s.file, status: s.status, labels: s.labels },
      status,
      ...(status === 'ended' && s.ended ? { ended: s.ended } : {}),
      after,
      last_seq: this.store.lastSeq(s),
    });

    // Feedback already sent is delivered first, even from a review that has since ended.
    const ready = s.log.filter((e) => e.seq > after);
    if (ready.length) return sendJson(res, 200, view(ready));
    if (s.status === 'ended') return sendJson(res, 200, pending('ended'));
    if (hold === 0) return sendJson(res, 200, pending());

    const l = this.liveFor(s);
    if (!l.waiters.size && Date.now() - l.lastWaiterGone >= PRESENCE_GRACE_MS) l.listeningSince = Date.now();
    await new Promise<void>((resolve) => {
      let finished = false;
      const waiter: Waiter = {
        after,
        done: (result) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          clearTimeout(waiter.disconnectTimer);
          l.waiters.delete(waiter);
          l.lastWaiterGone = Date.now();
          this.schedulePresence(s);
          if (!res.writableEnded && !res.destroyed) sendJson(res, 200, Array.isArray(result) ? view(result) : pending(result ?? 'pending'));
          resolve();
        },
      };
      const timer = setTimeout(() => waiter.done(null), hold);
      req.on('close', () => waiter.done(null));
      l.waiters.add(waiter);
      this.schedulePresence(s);
      this.armDisconnect(s, l);
    });
  }

  /**
   * A wait returns `disconnected` once no review page has been connected for
   * the grace period, counted from when the page went away or the agent began
   * waiting, whichever is later. A page that comes back in time keeps it waiting.
   * A review whose page has never been opened is not disconnected: the reviewer
   * may still be pasting the URL, so the wait goes on.
   */
  private armDisconnect(s: Session, l: Live): void {
    for (const w of l.waiters) {
      clearTimeout(w.disconnectTimer);
      if (l.sockets.size || !s.browser_seen) continue;
      const left = this.disconnectGraceMs - (Date.now() - Math.max(l.noBrowserSince, l.listeningSince));
      if (left <= 0) w.done('disconnected');
      else w.disconnectTimer = setTimeout(() => this.armDisconnect(s, l), left + 10);
    }
  }

  /** Ends the review, by the agent (the CLI) or by the reviewer (the review page). */
  private async receiveEnd(req: IncomingMessage, res: ServerResponse, s: Session): Promise<void> {
    const body = (await readBody(req, 16 * 1024)) as { message?: unknown };
    if (body.message !== undefined && typeof body.message !== 'string') throw new HttpError(400, 'message must be a string');
    const message = (body.message ?? '').trim();
    if (message.length > LIMITS.endMessage) throw new HttpError(413, `message is longer than ${LIMITS.endMessage} characters`);
    // Only the review page sends an Origin; the CLI never does.
    const by = req.headers.origin !== undefined && originAllowed(req, true) ? 'reviewer' : 'agent';
    const already = s.status === 'ended';
    const ended = this.store.endSession(s, by, message || undefined);
    sendJson(res, 200, { session: s.id, status: s.status, ended, already });
    if (already) return;
    this.broadcast(s, { type: 'ended', ended });
    this.events.append('session.ended', s, { by, has_message: !!ended.message });
    const l = this.live.get(s.id);
    if (l) for (const w of [...l.waiters]) w.done('ended');
  }

  private async receiveReply(req: IncomingMessage, res: ServerResponse, s: Session): Promise<void> {
    const body = (await readBody(req, LIMITS.reply + 4096)) as { text?: unknown; note?: unknown; status?: unknown };
    const text = body.text === undefined ? '' : body.text;
    if (typeof text !== 'string') throw new HttpError(400, 'text must be a string');
    if (text.length > LIMITS.reply) throw new HttpError(413, 'reply is too long');
    let about: { note: string; status: AgentStatus } | undefined;
    if (body.note !== undefined || body.status !== undefined) {
      if (typeof body.note !== 'string' || !NOTE_ID.test(body.note)) throw new HttpError(400, 'note must be a note id such as n_0001');
      if (!this.noteEntries(s).some((e) => e.note.id === body.note)) throw new HttpError(404, `no note ${body.note} in this review`);
      if (body.status === 'resolved') throw new HttpError(400, 'only the reviewer resolves a note; say addressed, declined or question');
      if (!(AGENT_STATUSES as readonly unknown[]).includes(body.status)) throw new HttpError(400, `status must be one of ${AGENT_STATUSES.join(', ')}`);
      about = { note: body.note, status: body.status as AgentStatus };
      if (about.status === 'question' && !text.trim()) throw new HttpError(400, 'a question needs its text');
    } else if (!text.trim()) {
      throw new HttpError(400, 'text is required');
    }
    const reply = this.store.appendReply(s, text, about);
    sendJson(res, 201, { schema: REPLY_SCHEMA, session: s.id, seq: reply.seq, at: reply.at, ...(about ?? {}) });
    this.broadcast(s, { type: 'reply', reply: this.replyView(reply) });
    this.events.append('reply.posted', s, { reply_seq: reply.seq, ...(about ? { note: about.note, status: about.status } : {}) });
    if (about) this.events.append('note.status', s, { note: about.note, status: about.status, by: 'agent' });
  }

  /**
   * A note from the agent or a tool (F7). It is shown on the review page and
   * kept apart from the feedback log, so it can never wake or reach wait.
   */
  private async receiveAgentNote(req: IncomingMessage, res: ServerResponse, s: Session): Promise<void> {
    const body = (await readBody(req, 64 * 1024)) as { target?: unknown; text?: unknown; source?: unknown };
    if (typeof body.text !== 'string' || !body.text.trim()) throw new HttpError(400, 'text is required');
    if (body.text.length > LIMITS.comment) throw new HttpError(413, `text is longer than ${LIMITS.comment} characters`);
    const source = body.source === undefined ? 'agent' : body.source;
    if (typeof source !== 'string' || !SOURCE_NAME.test(source) || source.toLowerCase() === 'reviewer') {
      throw new HttpError(400, 'source must be a short name (letters, digits, . _ - and spaces), and not "reviewer"');
    }
    let kind: AgentNote['kind'] = 'page';
    let anchor: Anchor | null = null;
    if (body.target !== undefined) {
      if (typeof body.target !== 'string' || !body.target.trim() || body.target.length > LIMITS.quote) throw new HttpError(400, 'target must be a selector, quote or line');
      const doc = this.readDoc(s);
      if (!doc) throw new HttpError(409, 'the reviewed file is missing');
      const t = namedTarget(doc, body.target);
      if (typeof t === 'string') throw new HttpError(400, t);
      const place = placeAnchor(doc, t.anchor);
      kind = t.kind;
      anchor = { ...t.anchor, source_line: place?.source_line ?? null, lines: place?.lines ?? null };
    }
    const note = this.store.appendAgentNote(s, { kind, comment: body.text.trim(), anchor, source });
    sendJson(res, 201, { note });
    this.broadcast(s, { type: 'state' });
    this.events.append('agent-note.added', s, { note: note.id, source: note.source, kind: note.kind });
  }

  private async receiveResolve(req: IncomingMessage, res: ServerResponse, s: Session): Promise<void> {
    const body = (await readBody(req, 4096)) as { note?: unknown; resolved?: unknown };
    if (typeof body.note !== 'string' || !this.noteEntries(s).some((e) => e.note.id === body.note)) throw new HttpError(400, 'note must be a note in this review');
    const resolved = body.resolved === undefined ? true : body.resolved;
    if (typeof resolved !== 'boolean') throw new HttpError(400, 'resolved must be true or false');
    this.store.appendAnnotation(s, { type: 'resolve', at: new Date().toISOString(), note: body.note, resolved });
    const status = this.progress(s).status.get(body.note) ?? 'open';
    sendJson(res, 201, { note: body.note, status });
    this.broadcast(s, { type: 'state' });
    this.events.append('note.status', s, { note: body.note, status, by: 'reviewer' });
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
    if (!hostAllowed(req)) return refuse(403, 'Forbidden');
    if (!originAllowed(req, true)) return refuse(403, 'Forbidden');
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
        if (l.sockets.size) return;
        this.unwatch(l);
        l.noBrowserSince = Date.now();
        this.armDisconnect(s, l);
        // A reload closes and reopens the socket at once: only a page gone for a moment is news.
        clearTimeout(l.browserGoneTimer);
        l.browserGoneTimer = setTimeout(() => {
          if (l.sockets.size || !l.browserAnnounced || this.stopping) return;
          l.browserAnnounced = false;
          this.events.append('browser.disconnected', s, {});
        }, Math.min(PRESENCE_GRACE_MS, this.disconnectGraceMs));
        l.browserGoneTimer.unref();
      });
      this.watch(s, l);
      this.store.markBrowserSeen(s);
      this.armDisconnect(s, l);
      clearTimeout(l.browserGoneTimer);
      if (!l.browserAnnounced) {
        l.browserAnnounced = true;
        this.events.append('browser.connected', s, {});
      }
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
        l.reloadTimer = setTimeout(() => {
          // Re-anchor every note against the new file before the page asks for it.
          this.analyze(s);
          this.broadcast(s, { type: 'reload' });
        }, RELOAD_DEBOUNCE_MS);
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
  const disconnectGraceMs = Number(process.env.VIVAMARK_DISCONNECT_GRACE_MS) || DISCONNECT_GRACE_MS;
  const daemon = new Daemon(store, idleMs, { disconnectGraceMs, imageLimits: imageLimits() });
  // The notify hook comes from the user's environment or config file only, read once here.
  const notify = notifyConfig();
  if (notify) {
    const notifier = new Notifier(notify);
    daemon.events.listener = (e) => notifier.run(e);
    console.error(`vivamark: notify command from ${notify.from} runs for each event (timeout ${notify.timeoutMs} ms)`);
  } else {
    console.error('vivamark: no notify command configured');
  }
  await daemon.listen(port);
  daemon.writeServerInfo();
  daemon.startTimers();
  const stop = () => void daemon.shutdown('signal');
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  console.error(`vivamark daemon ${VERSION} listening on 127.0.0.1:${daemon.port} (pid ${process.pid})`);
}
