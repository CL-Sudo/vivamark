// State on disk. The daemon is the only writer; the CLI only reads session
// files (to find a session's token) and server.json (to find the daemon).
//
//   <state>/server.json            pid, port, version, admin token   0600
//   <state>/sessions/<id>.json     file, labels, token, cursors      0600
//   <state>/feedback/<id>.jsonl    append-only note log, seq per line 0600
//   <state>/replies/<id>.jsonl     append-only agent replies          0600
//   <state>/annotations/<id>.jsonl append-only: resolutions, agent notes 0600
//   <state>/snapshots/<id>/<sha256>  the file as it was at a Send       0600
//   <state>/daemon.log
//
// Directories are 0700. Whole-file writes go through a rename so a reader
// never sees half a file.

import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MOTIVATION } from './schema.js';
import type { AgentNote, AgentStatus, AnnotationEntry, Decision, DecisionEntry, DraftNote, LogEntry, Note, NoteEntry, Reply } from './schema.js';

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
  status: 'open' | 'ended';
  token: string;
  /** Unguessable path segment that lets the sandboxed frame load the page and its assets, and nothing else. */
  artifact_key: string;
  created: string;
  /** Read cursors on the feedback log, keyed by owner. */
  cursors: Record<string, number>;
  /** Set once the session ends; an ended session is never revived. */
  ended?: Ended;
}

/** Who ended a review, when, and what they said. */
export interface Ended {
  at: string;
  by: 'agent' | 'reviewer';
  message?: string;
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

/**
 * Finds a session by id or by the path of the reviewed file. Used by the CLI.
 * By path it prefers the open session, else the one that ended last.
 */
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
  let found: SessionRecord | null = null;
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const s = readJson<SessionRecord>(path.join(sessionsDir, name));
    if (!s || s.file !== canonical) continue;
    if (s.status !== 'ended') return s;
    if (!found || (s.ended?.at ?? s.created) > (found.ended?.at ?? found.created)) found = s;
  }
  return found;
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
  annotations: AnnotationEntry[];
}

/** The daemon's view of the state directory. */
export class Store {
  readonly dir: string;
  readonly sessions = new Map<string, Session>();

  constructor(dir = stateDir()) {
    this.dir = dir;
    for (const sub of ['', 'sessions', 'feedback', 'replies', 'annotations']) ensureDir(path.join(dir, sub));
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
        annotations: readJsonl<AnnotationEntry>(this.annotationsPath(rec.id)),
      });
    }
  }

  private feedbackPath(id: string): string {
    return path.join(this.dir, 'feedback', `${id}.jsonl`);
  }

  private repliesPath(id: string): string {
    return path.join(this.dir, 'replies', `${id}.jsonl`);
  }

  private annotationsPath(id: string): string {
    return path.join(this.dir, 'annotations', `${id}.jsonl`);
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
      ...(s.ended ? { ended: s.ended } : {}),
    };
    writeJsonAtomic(path.join(this.dir, 'sessions', `${s.id}.json`), rec);
  }

  /** The open session for a file. An ended one is history, not a candidate. */
  byFile(file: string): Session | undefined {
    for (const s of this.sessions.values()) if (s.file === file && s.status === 'open') return s;
    return undefined;
  }

  /** Ends a session for good: a later open of the same file starts a fresh one. */
  endSession(s: Session, by: Ended['by'], message?: string): Ended {
    if (s.ended) return s.ended;
    s.status = 'ended';
    s.ended = { at: new Date().toISOString(), by, ...(message ? { message } : {}) };
    this.saveRecord(s);
    return s.ended;
  }

  /** Creates a session for a file, or resumes its open one and merges labels. */
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
      annotations: [],
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
   * `place` maps an anchor to lines of the saved file.
   */
  appendBatch(
    s: Session,
    drafts: DraftNote[],
    decision: Decision,
    snapshot: string | undefined,
    place: (d: DraftNote) => { source_line: number | null; lines: [number, number] | null } | null,
    agentNote: (id: string) => AgentNote | undefined = () => undefined,
  ): LogEntry[] {
    const at = new Date().toISOString();
    const batch = randomId('b_');
    let seq = this.lastSeq(s);
    let noteCount = s.log.filter((e) => e.type === 'note').length;
    const linked = (id: string | undefined) => {
      const a = id ? agentNote(id) : undefined;
      return a ? { agent_note: { id: a.id, source: a.source, comment: a.comment } } : {};
    };
    const placed = (d: DraftNote) => {
      const p = place(d);
      return { source_line: p?.source_line ?? null, lines: p?.lines ?? null };
    };
    const entries: LogEntry[] = drafts.map((d): NoteEntry => {
      seq += 1;
      noteCount += 1;
      const note: Note = {
        id: `n_${String(noteCount).padStart(4, '0')}`,
        kind: d.kind,
        comment: d.comment,
        ...(d.intent ? { intent: d.intent } : {}),
        ...(d.severity ? { severity: d.severity } : {}),
        ...(d.answers ? { answers: d.answers } : {}),
        ...(d.endorses ? { endorses: d.endorses } : {}),
        ...(d.replies_to ? { replies_to: d.replies_to } : {}),
        ...linked(d.endorses ?? d.replies_to),
        motivation: d.intent ? MOTIVATION[d.intent] : 'commenting',
        anchor: d.anchor ? { ...d.anchor, ...placed(d) } : null,
        source: 'reviewer',
        attachments: [],
        at,
      };
      return { seq, type: 'note', batch, at, note, decision, ...(snapshot ? { snapshot } : {}) };
    });
    if (!entries.length) entries.push({ seq: seq + 1, type: 'decision', batch, at, decision, ...(snapshot ? { snapshot } : {}) } satisfies DecisionEntry);
    fs.appendFileSync(this.feedbackPath(s.id), entries.map((e) => JSON.stringify(e) + '\n').join(''), { mode: 0o600 });
    s.log.push(...entries);
    return entries;
  }

  /** Keeps the file as it is at a Send (F2). Snapshots are named by content, so a file sent twice unchanged is stored once. */
  saveSnapshot(s: Session, source: string): string {
    const hash = createHash('sha256').update(source).digest('hex');
    const dir = path.join(this.dir, 'snapshots', s.id);
    ensureDir(path.join(this.dir, 'snapshots'));
    ensureDir(dir);
    const file = path.join(dir, hash);
    if (!fs.existsSync(file)) {
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, source, { mode: 0o600 });
      fs.renameSync(tmp, file);
    }
    return hash;
  }

  readSnapshot(s: Session, hash: string): string | null {
    if (!/^[0-9a-f]{64}$/.test(hash)) return null;
    try {
      return fs.readFileSync(path.join(this.dir, 'snapshots', s.id, hash), 'utf8');
    } catch {
      return null;
    }
  }

  appendReply(s: Session, text: string, about?: { note: string; status: AgentStatus }): Reply {
    const reply: Reply = {
      seq: s.replies.length ? s.replies[s.replies.length - 1].seq + 1 : 1,
      at: new Date().toISOString(),
      text,
      ...(about ? { note: about.note, status: about.status } : {}),
    };
    fs.appendFileSync(this.repliesPath(s.id), JSON.stringify(reply) + '\n', { mode: 0o600 });
    s.replies.push(reply);
    return reply;
  }

  agentNotes(s: Session): AgentNote[] {
    return s.annotations.filter((a) => a.type === 'agent-note').map((a) => a.note);
  }

  /** Adds a note from the agent or a tool (F7), numbered a_0001 on. */
  appendAgentNote(s: Session, note: Omit<AgentNote, 'id' | 'at'>): AgentNote {
    const at = new Date().toISOString();
    const full: AgentNote = { id: `a_${String(this.agentNotes(s).length + 1).padStart(4, '0')}`, ...note, at };
    this.appendAnnotation(s, { type: 'agent-note', at, note: full });
    return full;
  }

  appendAnnotation(s: Session, entry: AnnotationEntry): void {
    fs.appendFileSync(this.annotationsPath(s.id), JSON.stringify(entry) + '\n', { mode: 0o600 });
    s.annotations.push(entry);
  }

  setCursor(s: Session, owner: string, seq: number): void {
    if (s.cursors[owner] === seq) return;
    s.cursors[owner] = seq;
    this.saveRecord(s);
  }
}
