// State on disk. The daemon is the only writer; the CLI only reads session
// files (to find a session's token) and server.json (to find the daemon).
//
//   <state>/server.json            pid, port, version, admin token   0600
//   <state>/sessions/<id>.json     file, labels, token, cursors      0600
//   <state>/feedback/<id>.jsonl    append-only note log, seq per line 0600
//   <state>/replies/<id>.jsonl     append-only agent replies          0600
//   <state>/daemon.log
//
// Directories are 0700. Whole-file writes go through a rename so a reader
// never sees half a file.

import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MOTIVATION } from './schema.js';
import type { Decision, DecisionEntry, DraftNote, LogEntry, Note, NoteEntry, Reply } from './schema.js';

export function stateDir(): string {
  const explicit = process.env.VIVAMARK_STATE_DIR;
  if (explicit) return path.resolve(explicit);
  const xdg = process.env.XDG_STATE_HOME;
  const base = xdg && path.isAbsolute(xdg) ? xdg : path.join(os.homedir(), '.local', 'state');
  return path.join(base, 'vivamark');
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
}

export function writeJsonAtomic(file: string, value: unknown): void {
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

export function randomToken(): string {
  return randomBytes(32).toString('hex');
}

const ID_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

export function randomId(prefix: string, length = 8): string {
  const bytes = randomBytes(length);
  let out = prefix;
  for (const b of bytes) out += ID_ALPHABET[b % ID_ALPHABET.length];
  return out;
}

export interface SessionRecord {
  id: string;
  file: string;
  labels: Record<string, string>;
  status: 'open';
  token: string;
  /** Unguessable path segment that lets the sandboxed frame load the page and its assets, and nothing else. */
  artifact_key: string;
  created: string;
  /** Read cursors on the feedback log, keyed by owner. */
  cursors: Record<string, number>;
}

export interface ServerInfo {
  app: 'vivamark';
  pid: number;
  port: number;
  version: string;
  admin_token: string;
  started: string;
}

export function serverInfoPath(dir = stateDir()): string {
  return path.join(dir, 'server.json');
}

export function readServerInfo(dir = stateDir()): ServerInfo | null {
  return readJson<ServerInfo>(serverInfoPath(dir));
}

/** Finds a session by id or by the path of the reviewed file. Used by the CLI. */
export function findSession(ref: string, dir = stateDir()): SessionRecord | null {
  const sessionsDir = path.join(dir, 'sessions');
  if (/^s_[a-z0-9]+$/.test(ref)) {
    const direct = readJson<SessionRecord>(path.join(sessionsDir, `${ref}.json`));
    if (direct) return direct;
  }
  let canonical: string;
  try {
    canonical = fs.realpathSync(path.resolve(ref));
  } catch {
    canonical = path.resolve(ref);
  }
  let names: string[];
  try {
    names = fs.readdirSync(sessionsDir);
  } catch {
    return null;
  }
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const s = readJson<SessionRecord>(path.join(sessionsDir, name));
    if (s && s.file === canonical) return s;
  }
  return null;
}

function readJsonl<T>(file: string): T[] {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const out: T[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as T);
    } catch {
      // A torn last line after a crash: skip it rather than refuse the log.
    }
  }
  return out;
}

export interface Session extends SessionRecord {
  log: LogEntry[];
  replies: Reply[];
}

/** The daemon's view of the state directory. */
export class Store {
  readonly dir: string;
  readonly sessions = new Map<string, Session>();

  constructor(dir = stateDir()) {
    this.dir = dir;
    for (const sub of ['', 'sessions', 'feedback', 'replies']) ensureDir(path.join(dir, sub));
    this.load();
  }

  private load(): void {
    for (const name of fs.readdirSync(path.join(this.dir, 'sessions'))) {
      if (!name.endsWith('.json')) continue;
      const rec = readJson<SessionRecord>(path.join(this.dir, 'sessions', name));
      if (!rec || !rec.id) continue;
      this.sessions.set(rec.id, {
        ...rec,
        cursors: rec.cursors ?? {},
        log: readJsonl<LogEntry>(this.feedbackPath(rec.id)),
        replies: readJsonl<Reply>(this.repliesPath(rec.id)),
      });
    }
  }

  private feedbackPath(id: string): string {
    return path.join(this.dir, 'feedback', `${id}.jsonl`);
  }

  private repliesPath(id: string): string {
    return path.join(this.dir, 'replies', `${id}.jsonl`);
  }

  private saveRecord(s: Session): void {
    const rec: SessionRecord = {
      id: s.id,
      file: s.file,
      labels: s.labels,
      status: s.status,
      token: s.token,
      artifact_key: s.artifact_key,
      created: s.created,
      cursors: s.cursors,
    };
    writeJsonAtomic(path.join(this.dir, 'sessions', `${s.id}.json`), rec);
  }

  byFile(file: string): Session | undefined {
    for (const s of this.sessions.values()) if (s.file === file) return s;
    return undefined;
  }

  /** Creates a session for a file, or resumes the existing one and merges labels. */
  openSession(file: string, labels: Record<string, string>): { session: Session; created: boolean } {
    const existing = this.byFile(file);
    if (existing) {
      if (Object.keys(labels).length) {
        existing.labels = { ...existing.labels, ...labels };
        this.saveRecord(existing);
      }
      return { session: existing, created: false };
    }
    let id = randomId('s_');
    while (this.sessions.has(id)) id = randomId('s_');
    const session: Session = {
      id,
      file,
      labels,
      status: 'open',
      token: randomToken(),
      artifact_key: randomToken(),
      created: new Date().toISOString(),
      cursors: {},
      log: [],
      replies: [],
    };
    this.sessions.set(id, session);
    this.saveRecord(session);
    return { session, created: true };
  }

  lastSeq(s: Session): number {
    return s.log.length ? s.log[s.log.length - 1].seq : 0;
  }

  /**
   * Appends one Send to the log: its notes, each carrying the batch's
   * decision, or a single decision entry when there are no notes.
   * `sourceLine` maps an anchor to a line of the saved file.
   */
  appendBatch(
    s: Session,
    drafts: DraftNote[],
    decision: Decision,
    sourceLine: (d: DraftNote) => number | null,
  ): LogEntry[] {
    const at = new Date().toISOString();
    const batch = randomId('b_');
    let seq = this.lastSeq(s);
    let noteCount = s.log.filter((e) => e.type === 'note').length;
    const entries: LogEntry[] = drafts.map((d): NoteEntry => {
      seq += 1;
      noteCount += 1;
      const note: Note = {
        id: `n_${String(noteCount).padStart(4, '0')}`,
        kind: d.kind,
        comment: d.comment,
        ...(d.intent ? { intent: d.intent } : {}),
        ...(d.severity ? { severity: d.severity } : {}),
        motivation: d.intent ? MOTIVATION[d.intent] : 'commenting',
        anchor: d.anchor ? { ...d.anchor, source_line: sourceLine(d) } : null,
        source: 'reviewer',
        attachments: [],
        at,
      };
      return { seq, type: 'note', batch, at, note, decision };
    });
    if (!entries.length) entries.push({ seq: seq + 1, type: 'decision', batch, at, decision } satisfies DecisionEntry);
    fs.appendFileSync(this.feedbackPath(s.id), entries.map((e) => JSON.stringify(e) + '\n').join(''), { mode: 0o600 });
    s.log.push(...entries);
    return entries;
  }

  appendReply(s: Session, text: string): Reply {
    const reply: Reply = {
      seq: s.replies.length ? s.replies[s.replies.length - 1].seq + 1 : 1,
      at: new Date().toISOString(),
      text,
    };
    fs.appendFileSync(this.repliesPath(s.id), JSON.stringify(reply) + '\n', { mode: 0o600 });
    s.replies.push(reply);
    return reply;
  }

  setCursor(s: Session, owner: string, seq: number): void {
    if (s.cursors[owner] === seq) return;
    s.cursors[owner] = seq;
    this.saveRecord(s);
  }
}
