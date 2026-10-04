// The shapes that cross a boundary: the feedback log on disk, the review UI's
// API, and the agent's `wait` output. Field order is part of the contract: the
// reviewer's words come before anything large, so an agent that truncates
// output still keeps what the person said.
//
// Later features add fields here without changing existing ones: a batch
// `decision` (F1), `anchor.state` (F3), `note.intent` and `note.severity`
// (F4), and a per-note `status` carried by replies (F6). Readers must ignore
// fields they do not know.

export const FEEDBACK_SCHEMA = 'vivamark.feedback/1';
export const REPLY_SCHEMA = 'vivamark.reply/1';

export type NoteKind = 'element' | 'text' | 'page';

export interface Anchor {
  /** The element's own `id` or `data-vivamark-id`, when it has one. */
  stable_id: string | null;
  /** A CSS path from the nearest ancestor with an id (or from `body`). */
  selector: string | null;
  /** Lower-case tag name of the marked element (element notes). */
  tag?: string;
  /** The start of the marked element's text (element notes). */
  text?: string;
  /** W3C TextQuoteSelector fields (text notes). */
  quote?: string;
  prefix?: string;
  suffix?: string;
  /** 1-based line in the saved file, or null when it cannot be mapped. */
  source_line: number | null;
}

export interface Note {
  id: string;
  kind: NoteKind;
  comment: string;
  anchor: Anchor | null;
  /** Who made the note. Only `reviewer` notes exist today. */
  source: 'reviewer';
  attachments: never[];
  at: string;
}

/** One line of `feedback/<session>.jsonl`. */
export interface NoteEntry {
  seq: number;
  type: 'note';
  batch: string;
  at: string;
  note: Note;
}

export type LogEntry = NoteEntry;

/** One line of `replies/<session>.jsonl`. */
export interface Reply {
  seq: number;
  at: string;
  text: string;
}

/** What the review UI posts for each queued note. The server assigns ids, times and source lines. */
export interface DraftNote {
  kind: NoteKind;
  comment: string;
  anchor: Omit<Anchor, 'source_line'> | null;
}

export const LIMITS = {
  comment: 10_000,
  quote: 2_000,
  context: 200,
  selector: 2_000,
  text: 300,
  notesPerBatch: 200,
  sendBody: 1_000_000,
  reply: 256 * 1024,
};

function str(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  return v.length > max ? v.slice(0, max) : v;
}

function nullableStr(v: unknown, max: number): string | null {
  return str(v, max) ?? null;
}

/** Validates one note from the review UI. Returns an error message for bad input. */
export function parseDraft(input: unknown): DraftNote | string {
  if (!input || typeof input !== 'object') return 'note must be an object';
  const x = input as Record<string, unknown>;
  const kind = x.kind;
  if (kind !== 'element' && kind !== 'text' && kind !== 'page') return 'note.kind must be element, text or page';
  const comment = typeof x.comment === 'string' ? x.comment.trim() : '';
  if (!comment) return 'note.comment is required';
  if (comment.length > LIMITS.comment) return `note.comment is longer than ${LIMITS.comment} characters`;
  if (kind === 'page') return { kind, comment, anchor: null };

  const a = x.anchor;
  if (!a || typeof a !== 'object') return `a ${kind} note needs an anchor`;
  const ar = a as Record<string, unknown>;
  const anchor: Omit<Anchor, 'source_line'> = {
    stable_id: nullableStr(ar.stable_id, LIMITS.context),
    selector: nullableStr(ar.selector, LIMITS.selector),
  };
  if (kind === 'element') {
    anchor.tag = str(ar.tag, 40) ?? '';
    anchor.text = str(ar.text, LIMITS.text) ?? '';
    if (!anchor.stable_id && !anchor.selector) return 'an element note needs stable_id or selector';
  } else {
    const quote = str(ar.quote, LIMITS.quote);
    if (!quote || !quote.trim()) return 'a text note needs anchor.quote';
    anchor.quote = quote;
    anchor.prefix = str(ar.prefix, LIMITS.context) ?? '';
    anchor.suffix = str(ar.suffix, LIMITS.context) ?? '';
  }
  return { kind, comment, anchor };
}
