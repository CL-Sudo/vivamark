// The review UI: the top-level page the reviewer uses. It holds the session
// token (from the URL fragment), shows the page in a sandboxed frame, keeps
// the reviewer's queued notes, and is the only thing that sends them.

import { startCanvas } from './canvas.js';
import type { Canvas } from './canvas.js';
import { MARK_TOKENS } from './mark-tokens.js';
import { PAGE_THEMES } from './page-tokens.js';
import { PANEL_KEY, TEXT_SIZES, TEXT_SIZE_KEY, THEME_KEY, THEMES, applyTextSize, layoutFolds, textSizeById, themeById } from './themes.js';
import type { Layout, Theme } from './themes.js';

type Kind = 'element' | 'text' | 'page';
interface Anchor {
  stable_id: string | null;
  selector: string | null;
  tag?: string;
  text?: string;
  quote?: string;
  prefix?: string;
  suffix?: string;
  cell?: { row?: string; column?: string };
  control?: { role: string; name: string };
  point?: { x: number; y: number; width: number; height: number };
  source_line?: number | null;
  lines?: [number, number] | null;
  /** F3, on sent notes: where the target is now. */
  state?: 'anchored' | 'moved' | 'orphaned';
  current?: { stable_id: string | null; selector: string; source_line: number | null; lines: [number, number] | null };
}
/**
 * A file uploaded to this review for a note; sent notes also carry its local
 * `path`. A real image has its type and size; any other file is
 * application/octet-stream, shown by its name and never opened here.
 */
interface Attached {
  id: string;
  mime: string;
  width?: number;
  height?: number;
  bytes: number;
  name?: string;
  path?: string;
}
/**
 * The reviewer's own words on a decision, typed in the field vivamark adds
 * under its options: the decision, the option picked (null for none) and the
 * words apart from the option's label.
 */
interface Choice {
  group: string;
  group_id: string | null;
  option: string | null;
  option_id: string | null;
  text: string;
}
interface Draft {
  kind: Kind;
  comment: string;
  choice?: Choice;
  answers?: string;
  endorses?: string;
  replies_to?: string;
  attachments?: Attached[];
  anchor: Anchor | null;
  /**
   * Queued from a control on the page (click-to-answer): which radio group,
   * checkbox or select it came from. Kept in the review page only; never sent.
   */
  suggested?: string;
}
type NoteStatus = 'open' | 'addressed' | 'declined' | 'question' | 'answered' | 'resolved';
interface Note extends Draft {
  id: string;
  at: string;
  target_changed?: boolean;
  status?: NoteStatus;
}
interface NoteEntry {
  seq: number;
  at: string;
  note: Note;
}
type Decision = 'request-changes' | 'approve' | 'approve-with-notes' | 'dismiss';
interface DecisionView {
  batch: string;
  seq: number;
  at: string;
  decision: Decision;
}
/** F7: a note from the agent or a tool, shown until the reviewer acts on it. */
interface AgentNoteView {
  id: string;
  kind: Kind;
  comment: string;
  anchor: Anchor | null;
  source: string;
  at: string;
  status: 'shown' | 'endorsed' | 'replied';
}
interface ReplyView {
  seq: number;
  at: string;
  text: string;
  html: string;
  note?: string;
  status?: 'addressed' | 'declined' | 'question';
}
interface Changes {
  since: string;
  inserts: { at: number; text: string }[];
  removals: { at: number; text: string }[];
}
interface Ended {
  at: string;
  by: 'agent' | 'reviewer';
  message?: string;
}
interface SessionView {
  id: string;
  file: string;
  name: string;
  status: 'open' | 'ended';
  ended?: Ended;
  artifact_url: string;
  notes: NoteEntry[];
  decisions: DecisionView[];
  changes: Changes | null;
  turn: 'agent' | 'reviewer';
  agent_notes: AgentNoteView[];
  replies: ReplyView[];
  agent: 'listening' | 'away';
  limits?: { image_bytes: number; note_image_bytes: number };
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const sessionId = location.pathname.split('/').pop() ?? '';
const tokenKey = `vivamark:token:${sessionId}`;
const queueKey = `vivamark:queue:${sessionId}`;
/** A viewing preference, not part of a review: kept for every review in this browser. */
const showMarksKey = 'vivamark:show-marks';

function readToken(): string | null {
  const m = /(?:^#|&)t=([0-9a-f]{64})(?:&|$)/.exec(location.hash);
  if (m) {
    try {
      sessionStorage.setItem(tokenKey, m[1]);
    } catch {
      // Private mode without storage: the token lives only in this page.
    }
    // Keep the token out of the address bar, history and any screenshot.
    history.replaceState(null, '', location.pathname);
    return m[1];
  }
  try {
    return sessionStorage.getItem(tokenKey);
  } catch {
    return null;
  }
}

const token = readToken();
const frame = $<HTMLIFrameElement>('page');
const thread = $('thread');
const comment = $<HTMLTextAreaElement>('comment');
const addBtn = $<HTMLButtonElement>('add');
const sendBtn = $<HTMLButtonElement>('send');
const pointBtn = $<HTMLButtonElement>('point');
const approveBtn = $<HTMLButtonElement>('approve');
const dismissBtn = $<HTMLButtonElement>('dismiss');
const endBtn = $<HTMLButtonElement>('end');

let session: SessionView | null = null;
let sent: NoteEntry[] = [];
let replies: ReplyView[] = [];
let decisions: DecisionView[] = [];
let changes: Changes | null = null;
let turn: 'agent' | 'reviewer' = 'reviewer';
/** The note the next one answers (F6) or replies to (F7), if any. */
let linking: { field: 'answers' | 'replies_to'; id: string; label: string } | null = null;
let agentNotes: AgentNoteView[] = [];
let showChanges = false;
/** Whether note marks are drawn on the page. Hiding them changes no note. */
let showMarks = loadShowMarks();
let queue: Draft[] = loadQueue();
let target: { kind: Kind; anchor: Anchor | null } = { kind: 'page', anchor: null };
let loadNonce = '';
let lastScroll = { x: 0, y: 0 };
let sending = false;
/** Set once the agent or the reviewer ends the review: nothing more can be sent. */
let ended: Ended | null = null;
/** Files for the note being written, uploaded already, added to it on Add note. */
let pendingFiles: Attached[] = [];
let limits = { image_bytes: 10 * 1024 * 1024, note_image_bytes: 25 * 1024 * 1024 };
/** The theme in use; the boot script has already applied it to the page. */
let theme: Theme = themeById(document.documentElement.dataset.theme) ?? THEMES[0];
/** Runs after each render while a layout needs to place things itself (Pinboard's canvas). */
let layoutHook: (() => void) | null = null;

function loadQueue(): Draft[] {
  try {
    const v = JSON.parse(sessionStorage.getItem(queueKey) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function saveQueue(): void {
  try {
    sessionStorage.setItem(queueKey, JSON.stringify(queue));
  } catch {
    // Queue survives in memory only.
  }
}

function loadShowMarks(): boolean {
  try {
    return localStorage.getItem(showMarksKey) !== 'off';
  } catch {
    return true;
  }
}

function saveShowMarks(): void {
  try {
    localStorage.setItem(showMarksKey, showMarks ? 'on' : 'off');
  } catch {
    // Storage blocked: the choice lasts as long as this page.
  }
}

function banner(text: string, error = false, ms = 0): void {
  const b = $('banner');
  b.textContent = text;
  b.classList.toggle('error', error);
  b.hidden = false;
  if (ms) setTimeout(() => (b.hidden = true), ms);
}

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/s/${sessionId}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
    credentials: 'omit',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}

// ---- attachments -------------------------------------------------------------------

function sizeText(n: number): string {
  return n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${Math.round((n / (1024 * 1024)) * 10) / 10} MB`;
}

function isImage(a: Attached): boolean {
  return a.mime.startsWith('image/');
}

/** Uploads one file the reviewer chose. The server checks what it really is; nothing is sent to the agent here. */
async function uploadFile(file: File): Promise<Attached> {
  if (file.size > limits.image_bytes) throw new Error(`that file is ${sizeText(file.size)}; a file may be at most ${sizeText(limits.image_bytes)}`);
  const res = await fetch(`/api/s/${sessionId}/attachments?name=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
    body: file,
    cache: 'no-store',
    credentials: 'omit',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as Attached;
}

/**
 * Adds the reviewer's files to the note being written, or to a queued note.
 * Only files from a paste, a drop or the file picker get here; the reviewed
 * page has no way to attach anything.
 */
async function attachFiles(files: File[], queuedIndex: number | null): Promise<void> {
  if (!files.length || ended) return;
  for (const file of files) {
    const list = queuedIndex === null ? pendingFiles : (queue[queuedIndex]?.attachments ?? []);
    const total = list.reduce((n, a) => n + a.bytes, 0) + file.size;
    if (total > limits.note_image_bytes) {
      banner(`Not attached${file.name ? ` (${file.name})` : ''}: the files on one note may come to at most ${sizeText(limits.note_image_bytes)}.`, true, 6000);
      return;
    }
    let up: Attached;
    try {
      up = await uploadFile(file);
    } catch (err) {
      banner(`Not attached${file.name ? ` (${file.name})` : ''}: ${(err as Error).message}`, true, 6000);
      continue;
    }
    if (queuedIndex === null) {
      if (!pendingFiles.some((a) => a.id === up.id)) pendingFiles.push(up);
    } else {
      const d = queue[queuedIndex];
      if (!d) return;
      d.attachments = d.attachments ?? [];
      if (!d.attachments.some((a) => a.id === up.id)) d.attachments.push(up);
      saveQueue();
    }
    render();
  }
}

/** Thumbnails as data: URLs (the review page's CSP allows no blob: images), fetched once with the session token. */
const thumbs = new Map<string, Promise<string>>();
function thumbUrl(id: string): Promise<string> {
  let p = thumbs.get(id);
  if (!p) {
    p = fetch(`/api/s/${sessionId}/attachments/${id}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', credentials: 'omit' })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(
        (b) =>
          new Promise<string>((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(String(fr.result));
            fr.onerror = () => reject(fr.error);
            fr.readAsDataURL(b);
          }),
      );
    p.catch(() => thumbs.delete(id));
    thumbs.set(id, p);
  }
  return p;
}

/**
 * A note's attachments: a thumbnail for a real image, a chip with the name and
 * size for any other file, whose contents the review page never fetches or shows.
 */
function thumbStrip(files: Attached[], remove?: (i: number) => void): HTMLElement {
  const strip = el('div', 'thumbs');
  files.forEach((a, i) => {
    const image = isImage(a);
    const t = el('div', image ? 'thumb' : 'thumb attached-file');
    t.dataset.attachment = a.id;
    const named = a.name ? `${a.name}\n` : '';
    if (image) {
      t.title = `${named}${a.mime.slice(6).toUpperCase()}, ${a.width} × ${a.height}, ${sizeText(a.bytes)}${a.path ? `\n${a.path}` : ''}`;
      const img = el('img');
      img.alt = a.name ? `Attached image ${a.name}` : `Attached image ${i + 1}`;
      void thumbUrl(a.id).then(
        (u) => (img.src = u),
        () => t.classList.add('broken'),
      );
      t.append(img);
    } else {
      t.title = `${named}File, ${sizeText(a.bytes)}${a.path ? `\n${a.path}` : ''}`;
      t.append(el('span', 'file-name', a.name ?? 'File'), el('span', 'file-size', sizeText(a.bytes)));
    }
    if (remove) {
      const rm = el('button', 'icon remove-image', '×');
      rm.type = 'button';
      rm.title = image ? 'Remove this image' : 'Remove this file';
      rm.setAttribute('aria-label', a.name ? `Remove ${a.name}` : rm.title);
      rm.addEventListener('click', (e) => {
        e.stopPropagation();
        remove(i);
      });
      t.append(rm);
    }
    strip.append(t);
  });
  return strip;
}

/** A drop zone for files: the composer, or one queued note. */
function dropZone(zone: HTMLElement, queuedIndex: () => number | null): void {
  zone.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types.includes('Files') || ended) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    zone.classList.add('drop-over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('drop-over'));
  zone.addEventListener('drop', (e) => {
    zone.classList.remove('drop-over');
    if (!e.dataTransfer?.files.length) return;
    e.preventDefault();
    e.stopPropagation();
    void attachFiles([...e.dataTransfer.files], queuedIndex());
  });
}

// ---- describing targets ---------------------------------------------------------

function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function describe(kind: Kind, a: Anchor | null): string {
  if (kind === 'page' || !a) return 'the whole page';
  if (kind === 'text') return `“${clip(a.quote ?? '', 60)}”`;
  const name = `<${a.tag ?? 'element'}${a.stable_id ? `#${a.stable_id}` : ''}>`;
  if (a.control) return `${a.control.role} “${clip(a.control.name, 40)}”`;
  if (a.cell) {
    const parts = [a.cell.row, a.cell.column].filter((x) => x !== undefined) as string[];
    return `cell ${parts.map((p) => clip(p, 24)).join(' · ')}`;
  }
  if (a.point) return `${name} at ${Math.round(a.point.x)}, ${Math.round(a.point.y)}`;
  return a.text ? `${name} ${clip(a.text, 48)}` : name;
}

const KIND_LABEL: Record<Kind, string> = { element: 'Element', text: 'Text', page: 'Page' };

// ---- rendering -----------------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function noteCard(n: number, d: Draft, queuedIndex: number | null, line?: number | null): HTMLElement {
  const card = el('div', `note${queuedIndex !== null ? ' queued' : ''}`);
  card.dataset.n = String(n);
  const head = el('div', 'note-head');
  head.append(el('span', 'num', String(n)), el('span', `kind ${d.kind}`, KIND_LABEL[d.kind]));
  const state = d.anchor?.state;
  const lineNow = d.anchor?.current?.source_line ?? line;
  const where = el('span', 'where', describe(d.kind, d.anchor) + (lineNow && state !== 'orphaned' ? ` · line ${lineNow}` : ''));
  where.title = where.textContent ?? '';
  head.append(where);
  if (queuedIndex !== null) {
    card.tabIndex = 0;
    card.title = 'Delete removes this note';
    card.addEventListener('keydown', (e) => onQueuedKey(e, queuedIndex));
    if (d.suggested) {
      card.classList.add('suggested');
      head.append(Object.assign(el('span', 'state from-page', 'From the page'), { title: 'Queued by your choice on the page. Edit or remove it; it is sent only with your next Send.' }));
    } else head.append(el('span', 'state', 'Queued'));
    const rm = el('button', 'icon remove', '×');
    rm.type = 'button';
    rm.title = 'Remove this note';
    rm.setAttribute('aria-label', 'Remove this note');
    rm.addEventListener('click', () => {
      queue.splice(queuedIndex, 1);
      saveQueue();
      render();
    });
    head.append(rm);
  } else {
    const status = (d as Note).status ?? 'open';
    head.append(Object.assign(el('span', `state status-${status}`, STATUS_LABEL[status]), { title: STATUS_TITLE[status] }));
  }
  const tagRow = el('div', 'note-tags');
  if (state === 'moved') tagRow.append(Object.assign(el('span', 'pill flag moved', 'Moved'), { title: `Re-attached at ${d.anchor?.current?.selector ?? 'a new place'}` }));
  if (state === 'orphaned') card.classList.add('orphaned');
  if ((d as Partial<Note>).target_changed && state !== 'orphaned') {
    tagRow.append(Object.assign(el('span', 'pill flag changed', 'Changed'), { title: 'What this note points at has changed since you sent it' }));
  }
  if (d.answers) tagRow.append(el('span', 'pill flag', `Answer to ${noteNumber(d.answers) ?? d.answers}`));
  if (d.endorses) tagRow.append(el('span', 'pill flag agent', `Endorses ${agentLabel(d.endorses)}`));
  if (d.replies_to) tagRow.append(el('span', 'pill flag agent', `Reply to ${agentLabel(d.replies_to)}`));
  card.append(head, tagRow, el('p', 'comment', d.comment));
  const files = d.attachments ?? [];
  if (queuedIndex !== null && d.suggested) {
    const actions = el('div', 'note-actions');
    const edit = el('button', 'btn small edit', 'Edit');
    edit.type = 'button';
    edit.title = 'Move this note into the editor and make it your own';
    edit.addEventListener('click', () => editQueued(queuedIndex));
    actions.append(edit);
    card.append(actions);
  }
  if (queuedIndex !== null) {
    if (files.length)
      card.append(
        thumbStrip(files, (i) => {
          files.splice(i, 1);
          saveQueue();
          render();
        }),
      );
    dropZone(card, () => queuedIndex);
  } else if (files.length) card.append(thumbStrip(files));
  if (queuedIndex === null) sentExtras(card, n, d as Note);
  return card;
}

/** Sticker's word for the agent's answer, stuck on its reply. */
const STICKER: Record<string, string> = { addressed: 'Done!', question: 'Question', declined: 'Declined', reply: 'Reply' };

/**
 * Whether this is the first render to show something, so a theme can animate
 * its arrival (a sticker popping in, a square rounding into a circle) once
 * and not on every render. The first render of the page shows everything as
 * already there.
 */
const seen = new Set<string>();
let firstRender = true;
function fresh(key: string): boolean {
  if (seen.has(key)) return false;
  seen.add(key);
  return !firstRender;
}

const STATUS_LABEL: Record<NoteStatus, string> = {
  open: 'Sent',
  addressed: 'Addressed',
  declined: 'Declined',
  question: 'Question',
  answered: 'Answered',
  resolved: 'Resolved',
};
const STATUS_TITLE: Record<NoteStatus, string> = {
  open: 'Sent; the agent has not said anything about it yet',
  addressed: 'The agent says it is done; resolve it if you agree',
  declined: 'The agent chose not to do it; resolve it, or answer with a new note',
  question: 'The agent asked you something about this note',
  answered: 'You answered the agent’s question',
  resolved: 'You resolved this note',
};

/** Agent notes are labelled A1, A2… on the page and in the list. */
function agentLabel(id: string): string {
  return `A${Number(id.slice(2))}`;
}

const AGENT_STATUS_LABEL: Record<AgentNoteView['status'], string> = { shown: 'Not sent', endorsed: 'Endorsed', replied: 'Replied' };

function agentNoteCard(a: AgentNoteView): HTMLElement {
  const card = el('div', 'note agent');
  card.dataset.agentId = a.id;
  card.dataset.status = a.status;
  const head = el('div', 'note-head');
  head.append(el('span', 'num agent', agentLabel(a.id)), el('span', 'kind source', `From ${a.source}`));
  const where = el('span', 'where', describe(a.kind, a.anchor));
  where.title = where.textContent ?? '';
  head.append(where);
  const queued = queue.some((d) => d.endorses === a.id || d.replies_to === a.id);
  head.append(
    Object.assign(el('span', 'state', queued ? 'Queued' : AGENT_STATUS_LABEL[a.status]), {
      title: 'Notes from the agent or a tool reach the agent only if you endorse them or reply to them',
    }),
  );
  card.append(head, el('p', 'comment', a.comment));
  if (a.anchor?.state === 'orphaned') card.classList.add('orphaned');
  const actions = el('div', 'note-actions');
  const endorse = el('button', 'btn small endorse', 'Endorse');
  endorse.type = 'button';
  endorse.title = 'Queue this as your own note, to send to the agent';
  endorse.disabled = queued || a.status === 'endorsed';
  endorse.addEventListener('click', () => {
    queue.push({ kind: a.kind, comment: a.comment, endorses: a.id, anchor: stripDerived(a.anchor) });
    saveQueue();
    render();
  });
  const reply = el('button', 'btn small', 'Reply');
  reply.type = 'button';
  reply.title = 'Write a note in reply, to send to the agent';
  reply.addEventListener('click', () => {
    linking = { field: 'replies_to', id: a.id, label: `reply to ${agentLabel(a.id)} (${a.source})` };
    target = { kind: a.kind, anchor: stripDerived(a.anchor) };
    render();
    comment.focus();
  });
  actions.append(endorse, reply);
  card.append(actions);
  return card;
}

function noteNumber(id: string): number | null {
  const i = sent.findIndex((e) => e.note.id === id);
  return i >= 0 ? i + 1 : null;
}

/** On a sent note: what the agent said about it, and the reviewer's own actions. */
function sentExtras(card: HTMLElement, n: number, note: Note): void {
  const status = note.status ?? 'open';
  card.dataset.status = status;
  card.dataset.id = note.id;
  if (fresh(`s${note.id}:${status}`) && status !== 'open') card.classList.add('changed-now');
  for (const r of replies.filter((x) => x.note === note.id)) {
    const box = el('div', `note-reply ${r.status ?? ''}${fresh(`r${r.seq}`) ? ' fresh' : ''}`);
    box.append(el('span', 'sticker', STICKER[r.status ?? 'reply']), el('div', 'reply-head', `Agent · ${r.status ?? 'reply'}`));
    if (r.text.trim()) {
      const body = el('div', 'md');
      // Rendered on the server from Markdown with raw HTML disabled; the page's CSP blocks scripts as well.
      body.innerHTML = r.html;
      box.append(body);
    }
    card.append(box);
  }
  const actions = el('div', 'note-actions');
  if (status === 'question') {
    const answer = el('button', 'btn small answer', 'Answer');
    answer.type = 'button';
    answer.addEventListener('click', () => {
      linking = { field: 'answers', id: note.id, label: `answer to note ${n}` };
      target = { kind: note.kind, anchor: stripDerived(note.anchor) };
      render();
      comment.focus();
    });
    actions.append(answer);
  }
  const resolve = el('button', 'btn small resolve', status === 'resolved' ? 'Reopen' : 'Resolve');
  resolve.type = 'button';
  resolve.title = status === 'resolved' ? 'Open this note again' : 'Close this note: nothing more is needed';
  resolve.addEventListener('click', async () => {
    try {
      await api('POST', '/resolve', { note: note.id, resolved: status !== 'resolved' });
      await refresh();
    } catch (err) {
      banner(`Could not resolve: ${(err as Error).message}`, true, 5000);
    }
  });
  actions.append(resolve);
  card.append(actions);
}

/** An anchor as it was sent, without what the server derived (state, lines, current place). */
function stripDerived(a: Anchor | null): Anchor | null {
  if (!a) return null;
  const { state: _s, current, source_line: _l, lines: _ls, ...rest } = a;
  return current && a.state === 'moved' ? { ...rest, stable_id: current.stable_id, selector: current.selector } : rest;
}

/** Takes a queued note back into the composer, to be changed and added again as the reviewer's own. */
function editQueued(i: number): void {
  const d = queue[i];
  if (!d) return;
  queue.splice(i, 1);
  saveQueue();
  target = { kind: d.kind, anchor: d.anchor };
  pendingFiles = [...pendingFiles, ...(d.attachments ?? [])];
  linking = null;
  comment.value = d.comment;
  render();
  comment.focus();
}

/** The most a reviewer's own words on one decision may run to, as the page's field allows. */
const MAX_WORDS = 4000;

/**
 * Click-to-answer: the reviewer changed a control the page author marked with
 * data-vivamark-suggest. It is queued, marked "from the page", one per radio
 * group or control; it is never sent by itself. The page proposes; the
 * reviewer sends.
 */
function onSuggest(d: {
  key?: unknown;
  remove?: unknown;
  kind?: unknown;
  anchor?: unknown;
  text?: unknown;
  words?: unknown;
  decision?: unknown;
}): void {
  if (ended || typeof d.key !== 'string' || !d.key || d.key.length > 2_000) return;
  const at = queue.findIndex((q) => q.suggested === d.key);
  if (d.remove === true) {
    if (at >= 0) queue.splice(at, 1);
  } else {
    const text = typeof d.text === 'string' ? d.text.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
    // The reviewer's own words on a decision: kept as typed, line breaks and all.
    const words = typeof d.words === 'string' ? d.words.trim().slice(0, MAX_WORDS) : '';
    if (d.kind !== 'element' || !d.anchor || typeof d.anchor !== 'object' || (!text && !words)) return;
    const prev = at >= 0 ? queue[at] : undefined;
    const anchor = d.anchor as Anchor;
    const decision = (d.decision && typeof d.decision === 'object' ? d.decision : {}) as { name?: unknown; id?: unknown };
    const choice: Choice | undefined = words
      ? {
          group: typeof decision.name === 'string' ? decision.name.slice(0, 300) : '',
          group_id: typeof decision.id === 'string' && decision.id ? decision.id.slice(0, 200) : null,
          option: text || null,
          option_id: text ? anchor.stable_id : null,
          text: words,
        }
      : undefined;
    const draft: Draft = {
      kind: 'element',
      // The option's label as today, then the reviewer's words on a line of their own.
      comment: text && words ? `${text}\n${words}` : text || words,
      ...(choice ? { choice } : {}),
      // Files the reviewer added stay with the new choice.
      ...(prev?.attachments?.length ? { attachments: prev.attachments } : {}),
      anchor,
      suggested: d.key,
    };
    if (at >= 0) queue[at] = draft;
    else queue.push(draft);
  }
  saveQueue();
  render();
}

function onQueuedKey(e: KeyboardEvent, i: number): void {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const d = queue[i];
  if (!d) return;
  const key = e.key.toLowerCase();
  if (key !== 'delete' && key !== 'backspace') return;
  queue.splice(i, 1);
  saveQueue();
  render();
  comment.focus();
  e.preventDefault();
}

function focusQueued(i: number): void {
  thread.querySelector<HTMLElement>(`.note.queued[data-n="${sent.length + i + 1}"]`)?.focus();
}

function replyCard(r: ReplyView): HTMLElement {
  const card = el('div', 'reply');
  card.dataset.replySeq = String(r.seq);
  card.append(el('div', 'reply-head', 'Agent'));
  const body = el('div', 'md');
  // Rendered on the server from Markdown with raw HTML disabled; the page's CSP blocks scripts as well.
  body.innerHTML = r.html;
  card.append(body);
  return card;
}

const DECISION_LABEL: Record<Decision, string> = {
  'request-changes': 'You requested changes',
  approve: 'You approved',
  'approve-with-notes': 'You approved with notes',
  dismiss: 'You dismissed this review',
};

function decisionCard(d: DecisionView): HTMLElement {
  const card = el('div', `decision ${d.decision}`, DECISION_LABEL[d.decision]);
  card.dataset.decision = d.decision;
  return card;
}

function orphanGroup(cards: HTMLElement[]): HTMLElement {
  const group = el('section', 'orphans');
  group.setAttribute('aria-label', 'Notes whose target is gone');
  const head = el('div', 'orphans-head', `Target gone · ${cards.length}`);
  const hint = el('p', 'orphans-hint', 'What these notes pointed at is no longer in the file. They are kept here, not pinned to a guess.');
  group.append(head, hint, ...cards);
  return group;
}

function render(): void {
  const items: { at: string; node: HTMLElement }[] = [];
  const orphans: HTMLElement[] = [];
  sent.forEach((e, i) => {
    const card = noteCard(i + 1, e.note, null, e.note.anchor?.source_line);
    if (e.note.anchor?.state === 'orphaned') orphans.push(card);
    else items.push({ at: e.at, node: card });
  });
  agentNotes.forEach((a) => items.push({ at: a.at, node: agentNoteCard(a) }));
  // A reply about one note is shown on that note's card.
  replies.filter((r) => !r.note).forEach((r) => items.push({ at: r.at, node: replyCard(r) }));
  // A decision follows the notes it was sent with.
  decisions.forEach((d) => items.push({ at: `${d.at}~`, node: decisionCard(d) }));
  items.sort((a, b) => a.at.localeCompare(b.at));
  const nodes = items.map((i) => i.node);
  queue.forEach((d, i) => nodes.push(noteCard(sent.length + i + 1, d, i)));
  if (orphans.length) nodes.unshift(orphanGroup(orphans));
  if (!nodes.length) nodes.push(el('div', 'empty', 'No notes yet.'));
  const atBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 40;
  thread.replaceChildren(...nodes);
  if (atBottom) thread.scrollTop = thread.scrollHeight;

  $('note-count').textContent = String(sent.length + queue.length);
  renderEnded();
  sendBtn.disabled = sending || queue.length === 0;
  sendBtn.textContent = queue.length ? `Send ${queue.length}${theme.fullLabels ? ` note${queue.length === 1 ? '' : 's'}` : ''}` : 'Send';
  approveBtn.disabled = sending;
  approveBtn.textContent = queue.length ? 'Approve with notes' : 'Approve';
  approveBtn.title = queue.length ? 'Approve, and send the queued notes as guidance' : 'Approve: no further revision needed';
  dismissBtn.disabled = sending || queue.length > 0;
  dismissBtn.title = queue.length ? 'Send or remove the queued notes first' : 'Close this review without feedback';
  addBtn.disabled = !comment.value.trim();
  const composerImages = $('composer-images');
  composerImages.hidden = !pendingFiles.length;
  composerImages.replaceChildren(
    ...(pendingFiles.length
      ? [
          thumbStrip(pendingFiles, (i) => {
            pendingFiles.splice(i, 1);
            render();
          }),
        ]
      : []),
  );

  const t = $('target');
  t.dataset.kind = target.kind;
  $('target-text').textContent = linking ? linking.label : describe(target.kind, target.anchor);
  t.dataset.answering = String(!!linking);
  $('target-clear').hidden = target.kind === 'page' && !linking;
  const turnEl = $('turn');
  turnEl.dataset.turn = turn;
  turnEl.textContent = turn === 'agent' ? "Agent's turn" : 'Your turn';
  turnEl.title = turn === 'agent' ? 'Notes are waiting on the agent' : 'Nothing is waiting on the agent';
  renderPanelToggle();
  openForNews();
  // The how-to hint is for an empty review; once there are notes the thread needs the room.
  $('hint').hidden = sent.length + queue.length > 0;
  $('comp-num').textContent = String(sent.length + queue.length + 1);
  $('who-status').textContent = `${$('presence').dataset.state === 'listening' ? 'listening' : 'away'} · ${turn === 'agent' ? "agent's turn" : 'your turn'}`;
  renderChanges();
  postMarks();
  postFields();
  layoutHook?.();
  firstRender = false;
}

/** An ended review keeps its thread readable and takes nothing more. */
function renderEnded(): void {
  const box = $('ended');
  box.hidden = !ended;
  $('composer').hidden = !!ended;
  $('strip-point').hidden = !!ended;
  if (!ended) return;
  const who = ended.by === 'agent' ? 'The agent' : 'You';
  $('ended-head').textContent = `${who} ended this review at ${new Date(ended.at).toLocaleTimeString()}`;
  const msg = $('ended-message');
  // Agent text, shown as plain text.
  msg.textContent = ended.message ?? '';
  msg.hidden = !ended.message;
  if (pointBtn.getAttribute('aria-pressed') === 'true') setPicking(false);
}

function renderChanges(): void {
  const btn = $<HTMLButtonElement>('show-changes');
  const n = changes ? changes.inserts.length + changes.removals.length : 0;
  btn.disabled = n === 0;
  if (!n) showChanges = false;
  btn.setAttribute('aria-pressed', String(showChanges));
  btn.textContent = n ? `Show changes · ${n}` : 'Show changes';
  btn.title = n && changes ? `What changed since you last sent, at ${new Date(changes.since).toLocaleTimeString()}` : 'Nothing has changed since you last sent';
}

function renderMarksToggle(): void {
  const btn = $<HTMLButtonElement>('show-marks');
  btn.setAttribute('aria-pressed', String(showMarks));
  btn.title = showMarks
    ? 'Hide the outlines and numbers on noted places; the notes stay in the panel'
    : 'Show the outlines and numbers on noted places';
}

function postChanges(): void {
  toFrame({ type: 'changes', show: showChanges, inserts: changes?.inserts ?? [], removals: changes?.removals ?? [] });
}

function setPresence(state: 'listening' | 'away'): void {
  const p = $('presence');
  p.dataset.state = state;
  $('presence-text').textContent = state === 'listening' ? 'Agent listening' : 'Agent away';
  $('who').dataset.state = state;
  $('who-status').textContent = `${state === 'listening' ? 'listening' : 'away'} · ${turn === 'agent' ? "agent's turn" : 'your turn'}`;
}

// ---- the frame -------------------------------------------------------------------------

function toFrame(msg: Record<string, unknown>): void {
  // The frame has an opaque origin, so '*' is the only target that reaches it.
  // Nothing sent here is secret: marks, scroll positions, and the words the
  // reviewer typed into this same page's decision fields.
  frame.contentWindow?.postMessage({ vivamark: 1, ...msg }, '*');
}

function postMarks(): void {
  const marks = [
    ...sent.flatMap((e, i) => {
      const a = e.note.anchor;
      // An orphaned note is not drawn at all; a moved one is drawn where it is now.
      if (a?.state === 'orphaned') return [];
      const anchor = a?.current && a.state === 'moved' ? { ...a, stable_id: a.current.stable_id, selector: a.current.selector } : a;
      return [{ n: i + 1, kind: e.note.kind, anchor, queued: false, state: e.note.status ?? 'open' }];
    }),
    ...queue.map((d, i) => ({ n: sent.length + i + 1, kind: d.kind, anchor: d.anchor, queued: true, state: 'queued' })),
    ...agentNotes.flatMap((a) => {
      if (a.status !== 'shown' || a.anchor?.state === 'orphaned') return [];
      const anchor = a.anchor?.current && a.anchor.state === 'moved' ? { ...a.anchor, stable_id: a.anchor.current.stable_id, selector: a.anchor.current.selector } : a.anchor;
      return [{ n: agentLabel(a.id), kind: a.kind, anchor, queued: false, agent: true, state: 'agent' }];
    }),
  ];
  toFrame({ type: 'marks', marks, show: showMarks });
}

/**
 * Tells the page what its decision fields hold: the words and option of each
 * group's queued note, so a field shows what will be sent, empties once it is
 * sent or removed, and comes back after the page reloads. These are the
 * reviewer's words typed into that same page; the queue stays the record.
 */
let postedFields = '';
function postFields(force = false): void {
  const fields = queue.flatMap((d) =>
    d.suggested?.startsWith('group:')
      ? [{ key: d.suggested, text: d.choice?.text ?? '', option: !d.choice || d.choice.option !== null ? d.anchor : null }]
      : [],
  );
  const msg = { type: 'fields', fields, readOnly: !!ended };
  const json = JSON.stringify(msg);
  if (!force && json === postedFields) return;
  postedFields = json;
  toFrame(msg);
}

function setPicking(on: boolean): void {
  pointBtn.setAttribute('aria-pressed', String(on));
  toFrame({ type: 'mode', pick: on });
}

function loadFrame(): void {
  if (!session) return;
  loadNonce = Math.random().toString(36).slice(2, 12);
  // The theme rides along so the page has its page tokens from the first paint.
  frame.src = `${session.artifact_url}?vmload=${loadNonce}&vmtheme=${encodeURIComponent(theme.id)}`;
}

window.addEventListener('message', (e) => {
  // Only the current page in our frame, from its current load, is listened to.
  if (e.source !== frame.contentWindow || e.origin !== 'null') return;
  const d = e.data as { vivamark?: number; load?: string; type?: string; kind?: Kind; anchor?: Anchor; x?: number; y?: number };
  if (!d || d.vivamark !== 1 || d.load !== loadNonce) return;
  if (canvas?.onMessage(d as Record<string, unknown>)) return;
  switch (d.type) {
    case 'ready':
      postTheme();
      canvas?.frameReady();
      toFrame({ type: 'restore', ...lastScroll });
      setPicking(pointBtn.getAttribute('aria-pressed') === 'true');
      postMarks();
      postChanges();
      postFields(true);
      break;
    case 'pick':
      if ((d.kind === 'element' || d.kind === 'text') && d.anchor) {
        // A page can only propose a target. Nothing is queued or sent without the reviewer.
        target = { kind: d.kind, anchor: d.anchor };
        pointBtn.setAttribute('aria-pressed', 'false');
        // The reviewer is making a note: the composer has to be in view.
        expandPanel();
        render();
        comment.focus();
      }
      break;
    case 'suggest':
      onSuggest(d as Parameters<typeof onSuggest>[0]);
      break;
    case 'pick-cancelled':
      pointBtn.setAttribute('aria-pressed', 'false');
      break;
    case 'scroll':
      lastScroll = { x: Number(d.x) || 0, y: Number(d.y) || 0 };
      break;
  }
});

// ---- composer --------------------------------------------------------------------------

function addNote(): void {
  const text = comment.value.trim();
  if (!text) return;
  queue.push({
    kind: target.kind,
    comment: text,
    ...(linking ? { [linking.field]: linking.id } : {}),
    ...(pendingFiles.length ? { attachments: pendingFiles } : {}),
    anchor: target.anchor,
  });
  saveQueue();
  comment.value = '';
  pendingFiles = [];
  target = { kind: 'page', anchor: null };
  linking = null;
  render();
  // The new card takes the focus, so Delete can still take it back out.
  focusQueued(queue.length - 1);
}

$('composer').addEventListener('submit', (e) => {
  e.preventDefault();
  addNote();
});
comment.addEventListener('input', () => (addBtn.disabled = !comment.value.trim()));
comment.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    addNote();
  }
});
$('target-clear').addEventListener('click', () => {
  target = { kind: 'page', anchor: null };
  linking = null;
  render();
});
pointBtn.addEventListener('click', () => setPicking(pointBtn.getAttribute('aria-pressed') !== 'true'));

// Files: the file picker, a drop on the composer or a queued note, or a paste.
const fileInput = $<HTMLInputElement>('file-input');
$('attach').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const files = [...(fileInput.files ?? [])];
  fileInput.value = '';
  void attachFiles(files, null);
});
dropZone($('composer'), () => null);
// A file dropped anywhere else must not replace the review page with the file.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());
document.addEventListener('paste', (e) => {
  const files = [...(e.clipboardData?.files ?? [])];
  if (!files.length) return;
  e.preventDefault();
  // Onto the queued note that has the focus, else the note being written, which then has to be in view.
  const card = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('.note.queued');
  const i = card ? Number(card.dataset.n) - sent.length - 1 : -1;
  if (i < 0 || i >= queue.length) expandPanel();
  void attachFiles(files, i >= 0 && i < queue.length ? i : null);
});
$('show-changes').addEventListener('click', () => {
  showChanges = !showChanges;
  renderChanges();
  postChanges();
});
renderMarksToggle();
$('show-marks').addEventListener('click', () => {
  showMarks = !showMarks;
  saveShowMarks();
  renderMarksToggle();
  postMarks();
  layoutHook?.();
});

const SENT_TEXT: Record<Decision, string> = {
  'request-changes': 'Sent {n} to the agent.',
  approve: 'Approved. The agent has been told.',
  'approve-with-notes': 'Approved, with {n} for the agent.',
  dismiss: 'Dismissed. The agent has been told.',
};

/** The only way anything reaches the agent: one of the reviewer's Send buttons. */
async function sendDecision(decision: Decision): Promise<void> {
  if (sending) return;
  const notes = decision === 'approve' || decision === 'dismiss' ? [] : queue;
  if ((decision === 'request-changes' || decision === 'approve-with-notes') && !notes.length) return;
  sending = true;
  render();
  try {
    // Files go by id: the server already has them, and fills in the rest.
    const body = notes.map(({ suggested: _s, ...d }) => ({ ...d, attachments: d.attachments?.map((a) => a.id) }));
    const res = await api<{ notes: (NoteEntry & { type: string })[] }>('POST', '/send', { notes: body, decision });
    if (notes.length) {
      queue = [];
      saveQueue();
    }
    mergeNotes(res.notes.filter((e) => e.type === 'note'));
    const n = notes.length;
    document.body.classList.remove('just-sent');
    void document.body.offsetWidth;
    document.body.classList.add('just-sent');
    setTimeout(() => document.body.classList.remove('just-sent'), 400);
    banner(SENT_TEXT[decision].replace('{n}', `${n} note${n === 1 ? '' : 's'}`), false, 2500);
    await refresh();
  } catch (err) {
    banner(`Could not send: ${(err as Error).message}`, true, 5000);
  } finally {
    sending = false;
    render();
  }
}

endBtn.addEventListener('click', async () => {
  if (sending || ended) return;
  if (!confirm('End this review? The agent is told, and nothing more can be sent on this page.')) return;
  sending = true;
  render();
  try {
    const res = await api<{ ended: Ended }>('POST', '/end', {});
    ended = res.ended;
  } catch (err) {
    banner(`Could not end the review: ${(err as Error).message}`, true, 5000);
  } finally {
    sending = false;
    render();
  }
});

sendBtn.addEventListener('click', () => void sendDecision('request-changes'));
approveBtn.addEventListener('click', () => void sendDecision(queue.length ? 'approve-with-notes' : 'approve'));
dismissBtn.addEventListener('click', () => void sendDecision('dismiss'));

function mergeNotes(entries: NoteEntry[]): void {
  const seen = new Set(sent.map((e) => e.seq));
  for (const e of entries) if (!seen.has(e.seq)) sent.push(e);
  sent.sort((a, b) => a.seq - b.seq);
}

function mergeReply(r: ReplyView): void {
  if (!replies.some((x) => x.seq === r.seq)) replies.push(r);
}

// ---- live events ----------------------------------------------------------------------------

let backoff = 500;
function connect(): void {
  const ws = new WebSocket(`ws://${location.host}/api/s/${sessionId}/events`, ['vivamark.v1', `vivamark.token.${token}`]);
  ws.addEventListener('open', () => {
    backoff = 500;
  });
  ws.addEventListener('message', (e) => {
    let ev: { type: string; agent?: 'listening' | 'away'; entries?: NoteEntry[]; reply?: ReplyView; ended?: Ended };
    try {
      ev = JSON.parse(String(e.data));
    } catch {
      return;
    }
    if (ev.type === 'hello' || ev.type === 'presence') setPresence(ev.agent ?? 'away');
    else if (ev.type === 'notes') void refresh();
    else if (ev.type === 'reply' && ev.reply) {
      mergeReply(ev.reply);
      render();
      // A reply can change a note's status and whose turn it is.
      void refresh();
    } else if (ev.type === 'ended' && ev.ended) {
      ended = ev.ended;
      render();
    } else if (ev.type === 'state') {
      void refresh();
    } else if (ev.type === 'reload') {
      // The file changed: the server has re-anchored every note against it.
      void refresh();
      loadFrame();
      const chip = $('reload-chip');
      chip.hidden = false;
      setTimeout(() => (chip.hidden = true), 4000);
    }
  });
  ws.addEventListener('close', () => {
    setPresence('away');
    setTimeout(() => {
      void refresh().finally(connect);
    }, backoff);
    // Under the server's disconnect grace, so a restart does not end an agent's wait.
    backoff = Math.min(backoff * 2, 5_000);
  });
}

async function refresh(): Promise<void> {
  try {
    const s = await api<SessionView>('GET', '');
    session = s;
    sent = [];
    mergeNotes(s.notes);
    replies = s.replies;
    decisions = s.decisions ?? [];
    changes = s.changes ?? null;
    turn = s.turn ?? 'reviewer';
    agentNotes = s.agent_notes ?? [];
    ended = s.ended ?? null;
    setPresence(s.agent);
    render();
    postChanges();
  } catch {
    // The server is restarting; the socket loop retries.
  }
}

// ---- the notes panel, folded away or open ------------------------------------------------

/**
 * In the panel and index layouts the reviewer can fold the notes panel to a
 * strip at the right edge (along the bottom on a narrow window), so the page gets the
 * width. Folding only hides: the note being written, its files, the queue
 * and the target all stay. The boot script has already applied the choice
 * this browser remembers; whose turn it is and the agent's presence stay in
 * the bar.
 */
let panelCollapsed = document.documentElement.dataset.panel === 'collapsed';
const panelToggle = $<HTMLButtonElement>('panel-toggle');

function setPanel(collapsed: boolean): void {
  const root = document.documentElement;
  panelCollapsed = collapsed;
  root.dataset.panel = collapsed ? 'collapsed' : 'expanded';
  try {
    localStorage.setItem(PANEL_KEY, collapsed ? 'collapsed' : 'expanded');
  } catch {
    // Storage blocked: the choice lasts as long as this page.
  }
  renderPanelToggle();
  // The page's frame has a new width; the page script redraws its marks on
  // its own resize. A layout that places things itself places them again.
  layoutHook?.();
}

/** Opens the panel when the reviewer needs it, if it is folded away here. */
function expandPanel(): void {
  if (panelCollapsed && layoutFolds(theme.layout)) setPanel(false);
}

function renderPanelToggle(): void {
  const n = sent.length + queue.length;
  panelToggle.setAttribute('aria-expanded', String(!panelCollapsed));
  panelToggle.textContent = panelCollapsed ? 'Show notes' : 'Hide notes';
  // The words on the button come first, then the count the strip shows beside it.
  if (panelCollapsed) panelToggle.setAttribute('aria-label', `Show notes, ${n} note${n === 1 ? '' : 's'}`);
  else panelToggle.removeAttribute('aria-label');
  panelToggle.title = panelCollapsed
    ? 'Open the notes panel again; this browser remembers it'
    : 'Fold the notes panel away so the page gets the full width; this browser remembers it';
}

/**
 * What has opened the panel by itself already, so each thing opens it once:
 * a reply from the agent, a note from the agent or a tool, a question on one
 * of the reviewer's notes, the end of the review. What was there when the
 * page loaded opens it only if the reviewer still has to act on it (a
 * question, an ended review); the rest was there before.
 */
const openedFor = new Set<string>();
let openedSeeded = false;
function openForNews(): void {
  if (!session) return;
  const keys: string[] = [
    ...replies.map((r) => `r${r.seq}`),
    ...agentNotes.filter((a) => a.status === 'shown').map((a) => `a${a.id}`),
    ...sent
      .filter((e) => e.note.status === 'question')
      .map((e) => `q${e.note.id}:${Math.max(0, ...replies.filter((r) => r.note === e.note.id && r.status === 'question').map((r) => r.seq))}`),
    ...(ended ? ['ended'] : []),
  ];
  let news = false;
  for (const k of keys) {
    if (openedFor.has(k)) continue;
    openedFor.add(k);
    if (openedSeeded || k.startsWith('q') || k === 'ended') news = true;
  }
  openedSeeded = true;
  if (news) expandPanel();
}

panelToggle.addEventListener('click', () => setPanel(!panelCollapsed));
$('strip-point').addEventListener('click', () => {
  setPanel(false);
  setPicking(true);
  // The strip's button is gone with the strip: the panel's own Point button, now pressed, takes the focus.
  pointBtn.focus();
});
renderPanelToggle();

// ---- themes ------------------------------------------------------------------------------

/**
 * Switches the theme at once: no reload, so the note being written, the
 * queue and the page's scroll position stay. This browser remembers it.
 */
function applyTheme(id: string, remember: boolean): void {
  const next = themeById(id);
  if (!next) return;
  const root = document.documentElement;
  root.dataset.theme = next.id;
  root.dataset.layout = next.layout;
  if (remember) {
    try {
      localStorage.setItem(THEME_KEY, next.id);
    } catch {
      // Storage blocked: the theme lasts as long as this page.
    }
  }
  theme = next;
  themeSelect.value = next.id;
  setLayout(next.layout);
  postTheme();
  render();
}

/**
 * Layouts that place things themselves start and stop here. Pinboard's
 * canvas needs the room of a desktop window; narrower, Pinboard stacks the
 * sheet and its cards like the panel. The room is the app's own width, in
 * its own pixels, as chrome.css's container queries see it: a larger text
 * size leaves less of it.
 */
let canvas: Canvas | null = null;
const app = document.querySelector<HTMLElement>('.app')!;
const isWide = () => app.clientWidth >= 861;
let wasWide = isWide();
function setLayout(layout: Layout): void {
  const want = layout === 'canvas' && isWide();
  if (want === !!canvas) return;
  if (canvas) {
    canvas.stop();
    canvas = null;
    layoutHook = null;
    return;
  }
  canvas = startCanvas({
    stage: document.querySelector<HTMLElement>('.stage')!,
    sheet: $('sheet'),
    frame,
    thread,
    composer: $('composer'),
    ended: $('ended'),
    toFrame,
    probe: () => (target.anchor && target.kind !== 'page' ? { kind: target.kind, anchor: target.anchor } : null),
    marksShown: () => showMarks,
    scrollY: () => lastScroll.y,
  });
  layoutHook = () => canvas?.layout();
}
/** Starts or stops the canvas when the room crosses the line, by a resize or a text size. */
function checkRoom(): void {
  if (isWide() === wasWide) return;
  wasWide = !wasWide;
  setLayout(theme.layout);
}
new ResizeObserver(checkRoom).observe(app);

/**
 * Sends the active theme's mark tokens to the page, so its marks follow the
 * theme, and its page tokens, for a page that styles itself with them.
 */
function postTheme(): void {
  const cs = getComputedStyle(document.documentElement);
  const tokens: Record<string, string> = {};
  for (const name of MARK_TOKENS) tokens[name] = cs.getPropertyValue(name).trim();
  toFrame({ type: 'theme', id: theme.id, tokens, page: PAGE_THEMES[theme.id], pinPrefix: theme.pinPrefix ?? '', pinShapes: !!theme.pinShapes });
}

const themeSelect = $<HTMLSelectElement>('theme');
for (const t of THEMES) themeSelect.append(new Option(t.name, t.id));
themeSelect.value = theme.id;
themeSelect.addEventListener('change', () => applyTheme(themeSelect.value, true));
setLayout(theme.layout);

// ---- text size ---------------------------------------------------------------------------

/**
 * Draws the review larger or smaller at once: the bar, the notes and the
 * agent's page together, with no reload. The boot script set it before the
 * first paint; this browser remembers a change.
 */
const textSizeSelect = $<HTMLSelectElement>('text-size');
for (const z of TEXT_SIZES) textSizeSelect.append(new Option(z.name, z.id));
textSizeSelect.value = document.documentElement.dataset.textSize ?? 'normal';
textSizeSelect.addEventListener('change', () => {
  const size = textSizeById(textSizeSelect.value);
  if (!size) return;
  applyTextSize(document.documentElement, size);
  try {
    localStorage.setItem(TEXT_SIZE_KEY, size.id);
  } catch {
    // Storage blocked: the size lasts as long as this page.
  }
  // Pinboard's table has less room or more; the page redraws its marks on its own resize.
  checkRoom();
  layoutHook?.();
});

async function start(): Promise<void> {
  if (!token) {
    banner('This link has no access token. Open the URL that vivamark printed.', true);
    return;
  }
  try {
    session = await api<SessionView>('GET', '');
  } catch (err) {
    banner(`Could not load this review: ${(err as Error).message}`, true);
    return;
  }
  if (session.limits) limits = session.limits;
  document.title = `${session.name} · vivamark`;
  $('file-name').textContent = session.name;
  $('file-name').title = session.file;
  mergeNotes(session.notes);
  replies = session.replies;
  decisions = session.decisions ?? [];
  changes = session.changes ?? null;
  turn = session.turn ?? 'reviewer';
  agentNotes = session.agent_notes ?? [];
  ended = session.ended ?? null;
  setPresence(session.agent);
  render();
  loadFrame();
  connect();
}

void start();
