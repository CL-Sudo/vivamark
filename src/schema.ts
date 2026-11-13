// The shapes that cross a boundary: the feedback log on disk, the review UI's
// API, and the agent's `wait` output. Field order is part of the contract: the
// reviewer's words come before anything large, so an agent that truncates
// output still keeps what the person said.
//
// Features add fields here without changing existing ones: a batch
// `decision` (F1), `target_changed` (F2), `anchor.state` (F3), `note.intent`
// and `note.severity` (F4), `anchor.lines` (F5), a per-note `status` carried
// by replies and `answers` on notes (F6), notes from the agent or tools in a
// log of their own (F7), `anchor.cell`, `control` and `point` (F8),
// images in `note.attachments`, which was always there and always empty before,
// and other files there too: an attachment with mime application/octet-stream
// and no width or height, and an optional `name` on every attachment, and
// `note.choice`: the reviewer's own words on a decision, apart from the
// option's label.
// Version history (VersionEntry) is a log of its own, per reviewed file.
// Readers must ignore fields they do not know.

export const FEEDBACK_SCHEMA = 'vivamark.feedback/1';
export const REPLY_SCHEMA = 'vivamark.reply/1';
export const STATUS_SCHEMA = 'vivamark.status/1';

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
  /** F5: the first and last line of the target in the saved file (a Markdown block, or an HTML element or quote). */
  lines?: [number, number] | null;
}

/**
 * A file the reviewer attached to a note. `path` is an absolute path in the
 * state directory that the agent can open; the bytes are never inlined.
 * `id` is the sha256 of the file, so the same file is stored once. A real PNG,
 * JPEG, GIF or WebP image, checked by its bytes, carries its type and size; any
 * other file is application/octet-stream, whatever its name says. `name` is
 * the name the reviewer's file had, cleaned (attachmentName): metadata only,
 * never part of `path`.
 */
export type Attachment = ImageAttachment | FileAttachment;

export interface ImageAttachment {
  id: string;
  path: string;
  mime: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
  width: number;
  height: number;
  bytes: number;
  name?: string;
}

export interface FileAttachment {
  id: string;
  path: string;
  mime: 'application/octet-stream';
  bytes: number;
  name?: string;
}

export const ATTACHMENT_ID = /^[0-9a-f]{64}$/;

/**
 * The reviewer's own words on a decision, typed in the field vivamark adds
 * under every decision group (a role=radiogroup of radios marked
 * data-vivamark-suggest). Present only when they typed something. `group` is
 * the decision's name and `group_id` its stable id (the group or the card
 * around it); `option` and `option_id` are the option picked, both null when
 * the words came with no option. `text` is the words alone, as typed: the
 * note's comment carries the option's label first, then these words.
 */
export interface Choice {
  group: string;
  group_id: string | null;
  option: string | null;
  option_id: string | null;
  text: string;
}

export interface Note {
  id: string;
  kind: NoteKind;
  comment: string;
  /** The reviewer's own words on a decision, apart from the option's label. */
  choice?: Choice;
  intent?: Intent;
  severity?: Severity;
  /** W3C Web Annotation motivation, derived from the intent. */
  motivation: string;
  anchor: Anchor | null;
  /** F6: the reviewer's answer to the agent's question on this note. */
  answers?: string;
  /** F7: the reviewer endorses, or replies to, a note from the agent or a tool. */
  endorses?: string;
  replies_to?: string;
  /** F7: the agent's note acted on, so the reader needs nothing else. */
  agent_note?: { id: string; source: string; comment: string };
  /** F2, derived when read: the target's text changed since the note was sent. */
  target_changed?: boolean;
  /** Who made the note. Only `reviewer` notes exist today. */
  source: 'reviewer';
  /** Images and other files attached by the reviewer, in the order they were added. Empty when there are none. */
  attachments: Attachment[];
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
  /** F2: the file as it was at this Send, by the sha256 of its snapshot. */
  snapshot?: string;
}

export const VERSIONS_SCHEMA = 'vivamark.versions/1';
export const VERSION_SCHEMA = 'vivamark.version/1';

/** Why a version of the reviewed file was kept. */
export const VERSION_CAUSES = ['open', 'save', 'send', 'end', 'read'] as const;
export type VersionCause = (typeof VERSION_CAUSES)[number];

/**
 * One line of `versions/<file key>/index.jsonl`: a version of the reviewed
 * file that vivamark saw, across every review of that file. `n` counts from 1
 * in the order they were seen. The content is kept once per distinct `hash`.
 */
export interface VersionEntry {
  n: number;
  hash: string;
  at: string;
  cause: VersionCause;
  /** Bytes of the file at this version. */
  size: number;
  /** The review it was seen in. */
  session: string;
  /** For a Send: which batch, its decision and how many notes it carried. */
  batch?: string;
  decision?: Decision;
  notes?: number;
  /** Kept before version history existed: the content is the Send snapshot in snapshots/<session>/. */
  legacy?: true;
}

/** A Send with no notes (approve or dismiss) is logged as one decision entry. */
export interface DecisionEntry {
  seq: number;
  type: 'decision';
  batch: string;
  at: string;
  decision: Decision;
  snapshot?: string;
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
  /** F6: the note this reply is about, and what the agent says of it. */
  note?: string;
  status?: AgentStatus;
}

/** What the agent can say about one note (F6). Resolving is the reviewer's call, so it is not here. */
export const AGENT_STATUSES = ['addressed', 'declined', 'question'] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

/**
 * A note's status as both sides see it, derived from the log: `open` until
 * the agent says something of it, then the agent's word, `answered` once the
 * reviewer answers a question, and `resolved` when the reviewer closes it.
 */
export type NoteStatus = 'open' | AgentStatus | 'answered' | 'resolved';

/** Whose move it is: the agent's while any note waits on it, else the reviewer's. */
export type Turn = 'agent' | 'reviewer';

/** One line of `annotations/<session>.jsonl`: things that are not feedback, so never reach wait. */
export interface ResolveEntry {
  type: 'resolve';
  at: string;
  note: string;
  resolved: boolean;
}

/**
 * F7: a note added by the agent or a tool, shown to the reviewer labelled with
 * its source. It never reaches wait: only a reviewer note that endorses or
 * replies to it does.
 */
export interface AgentNote {
  id: string;
  kind: NoteKind;
  comment: string;
  anchor: Anchor | null;
  /** Who added it: `agent` unless --source names a tool. Never `reviewer`. */
  source: string;
  at: string;
}

export interface AgentNoteEntry {
  type: 'agent-note';
  at: string;
  note: AgentNote;
}

export type AnnotationEntry = ResolveEntry | AgentNoteEntry;

export const AGENT_NOTE_ID = /^a_\d{4,}$/;
export const SOURCE_NAME = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,39}$/;

/** What the review UI posts for each queued note. The server assigns ids, times and source lines. */
export interface DraftNote {
  kind: NoteKind;
  comment: string;
  choice?: Choice;
  intent?: Intent;
  severity?: Severity;
  answers?: string;
  endorses?: string;
  replies_to?: string;
  /** Ids of files uploaded to this review from the review page; the server fills in the rest. */
  attachments?: string[];
  anchor: Omit<Anchor, 'source_line' | 'lines'> | null;
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
  endMessage: 2_000,
  attachmentsPerNote: 20,
  attachmentName: 200,
  /** The reviewer's own words on one decision. */
  choiceText: 4_000,
};

/**
 * Default sizes for attached files, images or not; the user can change them
 * (VIVAMARK_MAX_IMAGE_BYTES and friends, named when only images could be attached).
 */
export const IMAGE_LIMITS = {
  imageBytes: 10 * 1024 * 1024,
  noteBytes: 25 * 1024 * 1024,
};

export const NOTE_ID = /^n_\d{4,}$/;

/** Control, format and direction-override characters: none belong in a file name shown to a person or an agent. */
const NAME_JUNK = /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/g;

/**
 * The name of a file the reviewer attached, as metadata: its last path part,
 * without control or direction-override characters, at most 200 characters.
 * Undefined when nothing usable is left. It never becomes a path on disk.
 */
export function attachmentName(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const base = (raw.split(/[\\/]/).pop() ?? '').replace(NAME_JUNK, '').trim();
  if (!base || base === '.' || base === '..') return undefined;
  const chars = [...base];
  return chars.length > LIMITS.attachmentName ? chars.slice(0, LIMITS.attachmentName).join('') : base;
}

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

/** The reviewer's own words on a decision; an error message for a malformed one. */
function parseChoice(v: unknown): Choice | string {
  const c = plainObject(v);
  if (!c) return 'note.choice must be an object';
  const text = typeof c.text === 'string' ? c.text.trim() : '';
  if (!text) return 'note.choice.text is required';
  if (text.length > LIMITS.choiceText) return `note.choice.text is longer than ${LIMITS.choiceText} characters`;
  const option = c.option === null || c.option === undefined ? null : str(c.option, LIMITS.text);
  if (option === undefined) return 'note.choice.option must be a string or null';
  return {
    group: str(c.group, LIMITS.text) ?? '',
    group_id: str(c.group_id, LIMITS.context) || null,
    option: option || null,
    option_id: option ? str(c.option_id, LIMITS.context) || null : null,
    text,
  };
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
  const tags: Pick<DraftNote, 'choice' | 'intent' | 'severity' | 'answers' | 'endorses' | 'replies_to' | 'attachments'> = {};
  if (x.choice !== undefined && x.choice !== null) {
    if (kind !== 'element') return 'note.choice belongs on an element note';
    const choice = parseChoice(x.choice);
    if (typeof choice === 'string') return choice;
    tags.choice = choice;
  }
  if (x.intent !== undefined && x.intent !== null) {
    if (!(INTENTS as readonly unknown[]).includes(x.intent)) return `note.intent must be one of ${INTENTS.join(', ')}`;
    tags.intent = x.intent as Intent;
  }
  if (x.severity !== undefined && x.severity !== null) {
    if (!(SEVERITIES as readonly unknown[]).includes(x.severity)) return `note.severity must be one of ${SEVERITIES.join(', ')}`;
    tags.severity = x.severity as Severity;
  }
  if (x.answers !== undefined && x.answers !== null) {
    if (typeof x.answers !== 'string' || !NOTE_ID.test(x.answers)) return 'note.answers must be a note id';
    tags.answers = x.answers;
  }
  for (const link of ['endorses', 'replies_to'] as const) {
    const v = x[link];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'string' || !AGENT_NOTE_ID.test(v)) return `note.${link} must be an agent note id`;
    tags[link] = v;
  }
  if (tags.endorses && tags.replies_to) return 'a note endorses or replies to an agent note, not both';
  if (x.attachments !== undefined && x.attachments !== null) {
    const ids = x.attachments;
    if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string' && ATTACHMENT_ID.test(id))) return 'note.attachments must be a list of attachment ids';
    const unique = [...new Set(ids as string[])];
    if (unique.length > LIMITS.attachmentsPerNote) return `a note carries at most ${LIMITS.attachmentsPerNote} attachments`;
    if (unique.length) tags.attachments = unique;
  }
  if (kind === 'page') return { kind, comment, ...tags, anchor: null };

  const a = x.anchor;
  if (!a || typeof a !== 'object') return `a ${kind} note needs an anchor`;
  const ar = a as Record<string, unknown>;
  const anchor: Omit<Anchor, 'source_line' | 'lines'> = {
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
