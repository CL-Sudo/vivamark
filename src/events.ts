// The event log: <state>/events.jsonl, append-only, one JSON object per line,
// one line per thing that happened to a review. It is the integration surface
// for tools that follow reviews (an orchestrator, an editor, a notifier);
// vivamark does not know who reads it.
//
// Metadata only. An event names sessions, notes, counts and decisions, never
// what anyone wrote: no note comment, quote, reply text, agent note text or
// end message, and no image or image path. A reader fetches words through `vivamark wait`. Every event is
// built from the whitelisted fields below, so new text cannot leak in by a
// spread of some larger object.

import fs from 'node:fs';
import path from 'node:path';
import type { AgentStatus, Decision, NoteKind, NoteStatus } from './schema.js';

export interface EventDetails {
  'session.opened': Record<string, never>;
  /** A Send: its decision, how many notes, their seq range in the session's feedback log, and how many images they carry. */
  'feedback.sent': { decision: Decision; notes: number; feedback_seq: { from: number; to: number }; attachments: number };
  /** An agent reply; `note` when it is about one note. */
  'reply.posted': { reply_seq: number; note?: string; status?: AgentStatus };
  /**
   * A note's status changed: by the agent (addressed, declined, question) or by
   * the reviewer (answered; resolved; or its earlier status again when reopened).
   */
  'note.status': { note: string; status: NoteStatus; by: 'agent' | 'reviewer' };
  'agent-note.added': { note: string; source: string; kind: NoteKind };
  'session.ended': { by: 'agent' | 'reviewer'; has_message: boolean };
  'browser.connected': Record<string, never>;
  'browser.disconnected': Record<string, never>;
}

export type EventType = keyof EventDetails;

export interface VivamarkEvent {
  seq: number;
  at: string;
  type: EventType;
  session: string;
  file: string;
  labels: Record<string, string>;
  [detail: string]: unknown;
}

export function eventsPath(dir: string): string {
  return path.join(dir, 'events.jsonl');
}

/** The seq of the last whole line in the log, read from its tail. */
function lastSeqIn(file: string): number {
  let fd: number;
  try {
    fd = fs.openSync(file, 'r');
  } catch {
    return 0;
  }
  try {
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, 64 * 1024);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const seq = (JSON.parse(lines[i]) as { seq?: unknown }).seq;
        if (typeof seq === 'number') return seq;
      } catch {
        // A torn or partial line: look further back.
      }
    }
    return 0;
  } finally {
    fs.closeSync(fd);
  }
}

/** The daemon's writer. `listener` sees each event once it is on disk (the notify hook). */
export class EventLog {
  readonly file: string;
  private seq: number;
  listener: ((e: VivamarkEvent) => void) | undefined;

  constructor(dir: string) {
    this.file = eventsPath(dir);
    this.seq = lastSeqIn(this.file);
  }

  append<T extends EventType>(type: T, s: { id: string; file: string; labels: Record<string, string> }, details: EventDetails[T]): VivamarkEvent {
    this.seq += 1;
    const event: VivamarkEvent = { seq: this.seq, at: new Date().toISOString(), type, session: s.id, file: s.file, labels: { ...s.labels }, ...details };
    try {
      fs.appendFileSync(this.file, JSON.stringify(event) + '\n', { mode: 0o600 });
    } catch (err) {
      // The review goes on without its log line; say so in the daemon log.
      console.error(`vivamark: could not write the event log: ${(err as Error).message}`);
    }
    try {
      this.listener?.(event);
    } catch (err) {
      console.error(`vivamark: event listener failed: ${(err as Error).message}`);
    }
    return event;
  }
}

/** Parses whole lines from a chunk of the log; returns the events and the unfinished tail. */
export function parseEventLines(text: string): { events: VivamarkEvent[]; rest: string } {
  const lines = text.split('\n');
  const rest = lines.pop() ?? '';
  const events: VivamarkEvent[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as VivamarkEvent);
    } catch {
      // A damaged line: skip it rather than stop following.
    }
  }
  return { events, rest };
}
