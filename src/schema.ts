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

/** What the reviewer wants done (F4). */
export const INTENTS = ['change', 'question', 'delete', 'looks-good'] as const;
export type Intent = (typeof INTENTS)[number];
/** How much it matters (F4). */
export const SEVERITIES = ['blocking', 'important', 'nit'] as const;
export type Severity = (typeof SEVERITIES)[number];

/**
 * The W3C Web Annotation `motivation` for each intent, so a reader that knows
 * that vocabulary needs no table of ours. A note with no intent is `commenting`.
 */
export const MOTIVATION: Record<Intent, string> = {
  change: 'editing',
  question: 'questioning',
  delete: 'editing',
  'looks-good': 'assessing',
};

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
  /** F8: a table cell, by its row's first cell and its column's header. Absent when spans make that ambiguous. */
  cell?: { row?: string; column?: string };
  /** F8: a control, by its role and accessible name. */
  control?: { role: string; name: string };
  /** F8: where a click landed on an image, canvas or svg, in CSS pixels of the graphic's box. */
  point?: { x: number; y: number; width: number; height: number };
  /** 1-based line in the saved file, or null when it cannot be mapped. */
  source_line: number | null;
}

export interface Note {
  id: string;
  kind: NoteKind;
  comment: string;
  intent?: Intent;
  severity?: Severity;
  /** W3C Web Annotation motivation, derived from the intent. */
  motivation: string;
  anchor: Anchor | null;
  /** Who made the note. Only `reviewer` notes exist today. */
  source: 'reviewer';
  attachments: never[];
  at: string;
}

/**
 * What the reviewer decided when they pressed a Send button (F1). The plain
 * Send is `request-changes`; the others end the round in a different way.
 */
export const DECISIONS = ['request-changes', 'approve', 'approve-with-notes', 'dismiss'] as const;
export type Decision = (typeof DECISIONS)[number];

/** One line of `feedback/<session>.jsonl`. */
export interface NoteEntry {
  seq: number;
  type: 'note';
  batch: string;
  at: string;
  note: Note;
  /** The batch's decision. Absent in logs written before F1, which means `request-changes`. */
  decision?: Decision;
}

/** A Send with no notes (approve or dismiss) is logged as one decision entry. */
export interface DecisionEntry {
  seq: number;
  type: 'decision';
  batch: string;
  at: string;
  decision: Decision;
}

export type LogEntry = NoteEntry | DecisionEntry;

export function entryDecision(e: LogEntry): Decision {
  return e.decision ?? 'request-changes';
}

/** Validates a Send's decision against its notes. Returns an error message for bad input. */
export function parseDecision(v: unknown, noteCount: number): Decision | string {
  const d = v === undefined || v === null ? 'request-changes' : v;
  if (typeof d !== 'string' || !(DECISIONS as readonly string[]).includes(d)) return `decision must be one of ${DECISIONS.join(', ')}`;
  const decision = d as Decision;
  if ((decision === 'request-changes' || decision === 'approve-with-notes') && noteCount === 0) return 'notes must be a non-empty array';
  if (decision === 'approve' && noteCount > 0) return 'approve sends no notes; use approve-with-notes';
  if (decision === 'dismiss' && noteCount > 0) return 'dismiss sends no notes';
  return decision;
}

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
  intent?: Intent;
  severity?: Severity;
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

function plainObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** The F8 names of an element target: cell, control and point. Unknown or empty parts are dropped. */
function parseNames(ar: Record<string, unknown>): Pick<Anchor, 'cell' | 'control' | 'point'> | string {
  const out: Pick<Anchor, 'cell' | 'control' | 'point'> = {};
  const cell = plainObject(ar.cell);
  if (cell) {
    const row = str(cell.row, LIMITS.text);
    const column = str(cell.column, LIMITS.text);
    if (row || column) out.cell = { ...(row ? { row } : {}), ...(column ? { column } : {}) };
  }
  const control = plainObject(ar.control);
  if (control) {
    const name = str(control.name, LIMITS.text);
    const role = str(control.role, 40);
    if (name) out.control = { role: role || 'button', name };
  }
  if (ar.point !== undefined && ar.point !== null) {
    const p = plainObject(ar.point);
    const nums = p && [p.x, p.y, p.width, p.height];
    if (!nums || !nums.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1e6)) {
      return 'anchor.point needs x, y, width and height as non-negative numbers';
    }
    const [x, y, width, height] = (nums as number[]).map((n) => Math.round(n * 10) / 10);
    out.point = { x, y, width, height };
  }
  return out;
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
  const tags: Pick<DraftNote, 'intent' | 'severity'> = {};
  if (x.intent !== undefined && x.intent !== null) {
    if (!(INTENTS as readonly unknown[]).includes(x.intent)) return `note.intent must be one of ${INTENTS.join(', ')}`;
    tags.intent = x.intent as Intent;
  }
  if (x.severity !== undefined && x.severity !== null) {
    if (!(SEVERITIES as readonly unknown[]).includes(x.severity)) return `note.severity must be one of ${SEVERITIES.join(', ')}`;
    tags.severity = x.severity as Severity;
  }
  if (kind === 'page') return { kind, comment, ...tags, anchor: null };

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
    const named = parseNames(ar);
    if (typeof named === 'string') return named;
    Object.assign(anchor, named);
  } else {
    const quote = str(ar.quote, LIMITS.quote);
    if (!quote || !quote.trim()) return 'a text note needs anchor.quote';
    anchor.quote = quote;
    anchor.prefix = str(ar.prefix, LIMITS.context) ?? '';
    anchor.suffix = str(ar.suffix, LIMITS.context) ?? '';
  }
  return { kind, comment, ...tags, anchor };
}
