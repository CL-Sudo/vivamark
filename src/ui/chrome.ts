// The review UI: the top-level page the reviewer uses. It holds the session
// token (from the URL fragment), shows the page in a sandboxed frame, keeps
// the reviewer's queued notes, and is the only thing that sends them.

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
type Intent = 'change' | 'question' | 'delete' | 'looks-good';
type Severity = 'blocking' | 'important' | 'nit';
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
interface Draft {
  kind: Kind;
  comment: string;
  intent?: Intent;
  severity?: Severity;
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

/** One version of the reviewed file, across all its reviews. */
interface VersionRow {
  n: number;
  hash: string;
  at: string;
  cause: 'open' | 'save' | 'send' | 'end' | 'read';
  size: number;
  session: string;
  batch?: string;
  decision?: Decision;
  notes?: number;
  path: string;
}
interface VersionNote {
  id: string;
  kind: Kind;
  comment: string;
  intent?: Intent;
  severity?: Severity;
  anchor: Anchor | null;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const sessionId = location.pathname.split('/').pop() ?? '';
const tokenKey = `vivamark:token:${sessionId}`;
const queueKey = `vivamark:queue:${sessionId}`;

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
let queue: Draft[] = loadQueue();
let target: { kind: Kind; anchor: Anchor | null } = { kind: 'page', anchor: null };
let tags: { intent?: Intent; severity?: Severity } = {};
let loadNonce = '';
let lastScroll = { x: 0, y: 0 };
let sending = false;
/** Set once the agent or the reviewer ends the review: nothing more can be sent. */
let ended: Ended | null = null;
/** Files for the note being written, uploaded already, added to it on Add note. */
let pendingFiles: Attached[] = [];
let limits = { image_bytes: 10 * 1024 * 1024, note_image_bytes: 25 * 1024 * 1024 };
/** Every version of the file, oldest first, and the one the file is at now. */
let versions: VersionRow[] = [];
let currentVersion: number | null = null;
/** An earlier version shown read-only, with the notes sent on it; null shows the page as it is now. */
let viewing: { row: VersionRow; notes: VersionNote[] } | null = null;
/** "Compare with…": the version Show changes counts from, and what it found. */
let compareBase: number | 'current' | null = null;
let compareChanges: Changes | null = null;

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
const INTENT_LABEL: Record<Intent, string> = { change: 'Change', question: 'Question', delete: 'Delete', 'looks-good': 'Looks good' };
const SEVERITY_LABEL: Record<Severity, string> = { blocking: 'Blocking', important: 'Important', nit: 'Nit' };
/** One keystroke on a queued note card sets its intent or severity; the same key again clears it. */
const INTENT_KEYS: Record<string, Intent> = { c: 'change', q: 'question', d: 'delete', g: 'looks-good' };
const SEVERITY_KEYS: Record<string, Severity> = { b: 'blocking', i: 'important', n: 'nit' };

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
    card.title = 'Keys: C Q D G set the intent, B I N the severity, Delete removes';
    card.addEventListener('keydown', (e) => onQueuedKey(e, queuedIndex));
    if (d.suggested) {
      card.classList.add('suggested');
      head.append(Object.assign(el('span', 'state from-page', 'From the page'), { title: 'Queued by your choice on the page. Edit or remove it; it is sent only with your next Send.' }));
    } else head.append(el('span', 'state', 'Queued'));
    const rm = el('button', 'icon remove', '×');
    rm.type = 'button';
    rm.title = 'Remove this note';
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
  if (d.intent) tagRow.append(el('span', `pill intent ${d.intent}`, INTENT_LABEL[d.intent]));
  if (d.severity) tagRow.append(el('span', `pill sev ${d.severity}`, SEVERITY_LABEL[d.severity]));
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
  for (const r of replies.filter((x) => x.note === note.id)) {
    const box = el('div', `note-reply ${r.status ?? ''}`);
    box.append(el('div', 'reply-head', `Agent · ${r.status ?? 'reply'}`));
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
  tags = { ...(d.intent ? { intent: d.intent } : {}), ...(d.severity ? { severity: d.severity } : {}) };
  pendingFiles = [...pendingFiles, ...(d.attachments ?? [])];
  linking = null;
  comment.value = d.comment;
  render();
  comment.focus();
}

const SUGGEST_INTENTS: Intent[] = ['change', 'question', 'delete', 'looks-good'];

/**
 * Click-to-answer: the reviewer changed a control the page author marked with
 * data-vivamark-suggest. It is queued, marked "from the page", one per radio
 * group or control; it is never sent by itself. The page proposes; the
 * reviewer sends.
 */
function onSuggest(d: { key?: unknown; remove?: unknown; kind?: unknown; anchor?: unknown; intent?: unknown; text?: unknown }): void {
  if (ended || typeof d.key !== 'string' || !d.key || d.key.length > 2_000) return;
  const at = queue.findIndex((q) => q.suggested === d.key);
  if (d.remove === true) {
    if (at >= 0) queue.splice(at, 1);
  } else {
    const text = typeof d.text === 'string' ? d.text.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
    if (d.kind !== 'element' || !d.anchor || typeof d.anchor !== 'object' || !text) return;
    const intent = SUGGEST_INTENTS.includes(d.intent as Intent) ? (d.intent as Intent) : undefined;
    const prev = at >= 0 ? queue[at] : undefined;
    const draft: Draft = {
      kind: 'element',
      comment: text,
      ...(intent ? { intent } : {}),
      // A severity or files the reviewer added stay with the new choice.
      ...(prev?.severity ? { severity: prev.severity } : {}),
      ...(prev?.attachments?.length ? { attachments: prev.attachments } : {}),
      anchor: d.anchor as Anchor,
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
  if (INTENT_KEYS[key]) d.intent = d.intent === INTENT_KEYS[key] ? undefined : INTENT_KEYS[key];
  else if (SEVERITY_KEYS[key]) d.severity = d.severity === SEVERITY_KEYS[key] ? undefined : SEVERITY_KEYS[key];
  else if (key === 'delete' || key === 'backspace') {
    queue.splice(i, 1);
    saveQueue();
    render();
    comment.focus();
    e.preventDefault();
    return;
  } else return;
  e.preventDefault();
  saveQueue();
  render();
  focusQueued(i);
}

function focusQueued(i: number): void {
  thread.querySelector<HTMLElement>(`.note.queued[data-n="${sent.length + i + 1}"]`)?.focus();
}

function renderTags(): void {
  for (const b of document.querySelectorAll<HTMLButtonElement>('#tags [data-intent]')) b.setAttribute('aria-pressed', String(tags.intent === b.dataset.intent));
  for (const b of document.querySelectorAll<HTMLButtonElement>('#tags [data-severity]')) b.setAttribute('aria-pressed', String(tags.severity === b.dataset.severity));
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
  sendBtn.disabled = sending || queue.length === 0 || !!viewing;
  sendBtn.textContent = queue.length ? `Send ${queue.length}` : 'Send';
  approveBtn.disabled = sending || !!viewing;
  approveBtn.textContent = queue.length ? 'Approve with notes' : 'Approve';
  approveBtn.title = queue.length ? 'Approve, and send the queued notes as guidance' : 'Approve: no further revision needed';
  dismissBtn.disabled = sending || queue.length > 0 || !!viewing;
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
  // The how-to hint is for an empty review; once there are notes the thread needs the room.
  $('hint').hidden = sent.length + queue.length > 0;
  renderTags();
  renderChanges();
  renderVersions();
  postMarks();
}

/** An ended review keeps its thread readable and takes nothing more. */
function renderEnded(): void {
  const box = $('ended');
  box.hidden = !ended;
  $('composer').hidden = !!ended || !!viewing;
  if (!ended) return;
  const who = ended.by === 'agent' ? 'The agent' : 'You';
  $('ended-head').textContent = `${who} ended this review at ${new Date(ended.at).toLocaleTimeString()}`;
  const msg = $('ended-message');
  // Agent text, shown as plain text.
  msg.textContent = ended.message ?? '';
  msg.hidden = !ended.message;
  if (pointBtn.getAttribute('aria-pressed') === 'true') setPicking(false);
}

/** What Show changes highlights: since the last Send, or between two versions picked with "Compare with…". */
function shownChanges(): Changes | null {
  if (compareBase !== null) return compareChanges;
  // Changes since the last Send are offsets into the page as it is now.
  return viewing ? null : changes;
}

function renderChanges(): void {
  const btn = $<HTMLButtonElement>('show-changes');
  const c = shownChanges();
  const n = c ? c.inserts.length + c.removals.length : 0;
  btn.disabled = n === 0;
  if (!n) showChanges = false;
  btn.setAttribute('aria-pressed', String(showChanges));
  btn.textContent = n ? `Show changes · ${n}` : 'Show changes';
  if (compareBase !== null) btn.title = n ? `What changed from ${versionName(compareBase)} to ${viewing ? `v${viewing.row.n}` : 'Current'}` : 'No difference in the text between these versions';
  else btn.title = n && changes ? `What changed since you last sent, at ${new Date(changes.since).toLocaleTimeString()}` : 'Nothing has changed since you last sent';
}

function postChanges(): void {
  const c = shownChanges();
  toFrame({ type: 'changes', show: showChanges, inserts: c?.inserts ?? [], removals: c?.removals ?? [] });
}

function setPresence(state: 'listening' | 'away'): void {
  const p = $('presence');
  p.dataset.state = state;
  $('presence-text').textContent = state === 'listening' ? 'Agent listening' : 'Agent away';
}

// ---- the frame -------------------------------------------------------------------------

function toFrame(msg: Record<string, unknown>): void {
  // The frame has an opaque origin, so '*' is the only target that reaches it.
  // Nothing sent here is secret: marks and scroll positions only.
  frame.contentWindow?.postMessage({ vivamark: 1, ...msg }, '*');
}

function postMarks(): void {
  if (viewing) {
    // An earlier version shows only the notes sent on it, where they were when sent.
    const marks = viewing.notes.map((n) => ({ n: Number(n.id.slice(2)), kind: n.kind, anchor: n.anchor, queued: false }));
    toFrame({ type: 'marks', marks });
    return;
  }
  const marks = [
    ...sent.flatMap((e, i) => {
      const a = e.note.anchor;
      // An orphaned note is not drawn at all; a moved one is drawn where it is now.
      if (a?.state === 'orphaned') return [];
      const anchor = a?.current && a.state === 'moved' ? { ...a, stable_id: a.current.stable_id, selector: a.current.selector } : a;
      return [{ n: i + 1, kind: e.note.kind, anchor, queued: false }];
    }),
    ...queue.map((d, i) => ({ n: sent.length + i + 1, kind: d.kind, anchor: d.anchor, queued: true })),
    ...agentNotes.flatMap((a) => {
      if (a.status !== 'shown' || a.anchor?.state === 'orphaned') return [];
      const anchor = a.anchor?.current && a.anchor.state === 'moved' ? { ...a.anchor, stable_id: a.anchor.current.stable_id, selector: a.anchor.current.selector } : a.anchor;
      return [{ n: agentLabel(a.id), kind: a.kind, anchor, queued: false, agent: true }];
    }),
  ];
  toFrame({ type: 'marks', marks });
}

function setPicking(on: boolean): void {
  pointBtn.setAttribute('aria-pressed', String(on));
  toFrame({ type: 'mode', pick: on });
}

function loadFrame(): void {
  if (!session) return;
  loadNonce = Math.random().toString(36).slice(2, 12);
  // /a/<session>/<key>/<name> is the page now; /v/<session>/<key>/<hash>/<name> an earlier version of it.
  const [, , id, key, ...name] = session.artifact_url.split('/');
  const url = viewing ? `/v/${id}/${key}/${viewing.row.hash}/${name.join('/')}` : session.artifact_url;
  frame.src = `${url}?vmload=${loadNonce}`;
}

window.addEventListener('message', (e) => {
  // Only the current page in our frame, from its current load, is listened to.
  if (e.source !== frame.contentWindow || e.origin !== 'null') return;
  const d = e.data as { vivamark?: number; load?: string; type?: string; kind?: Kind; anchor?: Anchor; x?: number; y?: number };
  if (!d || d.vivamark !== 1 || d.load !== loadNonce) return;
  switch (d.type) {
    case 'ready':
      toFrame({ type: 'restore', ...lastScroll });
      setPicking(pointBtn.getAttribute('aria-pressed') === 'true');
      postMarks();
      postChanges();
      break;
    case 'pick':
      // An earlier version is read-only: nothing on it becomes a note.
      if (viewing) break;
      if ((d.kind === 'element' || d.kind === 'text') && d.anchor) {
        // A page can only propose a target. Nothing is queued or sent without the reviewer.
        target = { kind: d.kind, anchor: d.anchor };
        pointBtn.setAttribute('aria-pressed', 'false');
        render();
        comment.focus();
      }
      break;
    case 'suggest':
      if (!viewing) onSuggest(d as Parameters<typeof onSuggest>[0]);
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
  if (!text || viewing) return;
  queue.push({
    kind: target.kind,
    comment: text,
    ...tags,
    ...(linking ? { [linking.field]: linking.id } : {}),
    ...(pendingFiles.length ? { attachments: pendingFiles } : {}),
    anchor: target.anchor,
  });
  saveQueue();
  comment.value = '';
  pendingFiles = [];
  target = { kind: 'page', anchor: null };
  tags = {};
  linking = null;
  render();
  // The new card takes the focus, so one key can still set its intent or severity.
  focusQueued(queue.length - 1);
}

$('tags').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLButtonElement>('button.tag');
  if (!b) return;
  if (b.dataset.intent) {
    const v = b.dataset.intent as Intent;
    tags.intent = tags.intent === v ? undefined : v;
  } else if (b.dataset.severity) {
    const v = b.dataset.severity as Severity;
    tags.severity = tags.severity === v ? undefined : v;
  }
  renderTags();
});

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
  // Onto the queued note that has the focus, else the note being written.
  const card = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('.note.queued');
  const i = card ? Number(card.dataset.n) - sent.length - 1 : -1;
  void attachFiles(files, i >= 0 && i < queue.length ? i : null);
});
$('show-changes').addEventListener('click', () => {
  showChanges = !showChanges;
  renderChanges();
  postChanges();
});

const SENT_TEXT: Record<Decision, string> = {
  'request-changes': 'Sent {n} to the agent.',
  approve: 'Approved. The agent has been told.',
  'approve-with-notes': 'Approved, with {n} for the agent.',
  dismiss: 'Dismissed. The agent has been told.',
};

/** The only way anything reaches the agent: one of the reviewer's Send buttons. */
async function sendDecision(decision: Decision): Promise<void> {
  // Notes are sent against the page as it is now, never an earlier version.
  if (sending || viewing) return;
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

// ---- versions ---------------------------------------------------------------------------------

const CAUSE_LABEL: Record<VersionRow['cause'], string> = { open: 'Opened', save: 'Saved', send: 'Sent', end: 'Ended', read: 'Seen' };
const CAUSE_TITLE: Record<VersionRow['cause'], string> = {
  open: 'The file when a review of it was opened',
  save: 'The file after a save, seen while the review page was open',
  send: 'The file as it was when you pressed a Send button',
  end: 'The file when the review ended',
  read: 'The file as found the next time anything looked at the review (a save made while no review page was open)',
};
const DECISION_SHORT: Record<Decision, string> = { 'request-changes': 'Changes requested', approve: 'Approved', 'approve-with-notes': 'Approved with notes', dismiss: 'Dismissed' };

function versionName(v: number | 'current'): string {
  return v === 'current' ? 'Current' : `v${v}`;
}

function timeText(iso: string): string {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString() : `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
}

async function loadVersions(): Promise<void> {
  try {
    const r = await api<{ current: number | null; versions: VersionRow[] }>('GET', '/versions');
    versions = r.versions;
    currentVersion = r.current;
    renderVersions();
  } catch {
    // The server is restarting; the next event reloads the list.
  }
}

function versionRowButton(v: VersionRow | null): HTMLElement {
  const b = el('button', `version-row${v?.cause === 'send' ? ' send' : ''}`);
  b.type = 'button';
  b.setAttribute('aria-current', String(v ? viewing?.row.n === v.n : !viewing));
  if (!v) {
    b.dataset.version = 'current';
    b.append(el('span', 'vnum', 'Now'), el('span', 'vcause', 'Current'), el('span', 'vtime', currentVersion ? `same as v${currentVersion}` : 'the file as it is'));
    b.title = 'The page as it is now: notes are added and sent here';
    b.addEventListener('click', () => void viewVersion(null));
    return b;
  }
  b.dataset.version = String(v.n);
  b.title = `${CAUSE_TITLE[v.cause]}\nsha256 ${v.hash}\n${v.path}`;
  b.append(el('span', 'vnum', `v${v.n}`), el('span', 'vcause', CAUSE_LABEL[v.cause]), el('span', 'vtime', timeText(v.at)));
  const meta = el('span', 'vmeta');
  if (v.cause === 'send') {
    const d = v.decision ?? 'request-changes';
    meta.append(el('span', `pill decision-pill ${d}`, DECISION_SHORT[d]));
    if (v.notes) meta.append(el('span', 'pill count-pill', `${v.notes} note${v.notes === 1 ? '' : 's'}`));
  }
  meta.append(el('span', 'vsize', sizeText(v.size)));
  b.append(meta);
  b.addEventListener('click', () => void viewVersion(v));
  return b;
}

function renderVersions(): void {
  const btn = $<HTMLButtonElement>('versions-btn');
  btn.textContent = versions.length ? `Versions · ${versions.length}` : 'Versions';
  // Newest first, under Current.
  $('versions-list').replaceChildren(versionRowButton(null), ...[...versions].reverse().map((v) => versionRowButton(v)));
  const select = $<HTMLSelectElement>('compare-select');
  const shown = viewing ? viewing.row.n : 'current';
  const options = [Object.assign(el('option', '', 'Nothing (since your last Send)'), { value: '' })];
  if (shown !== 'current') options.push(Object.assign(el('option', '', 'Current'), { value: 'current' }));
  for (const v of [...versions].reverse()) {
    if (v.n === shown) continue;
    options.push(Object.assign(el('option', '', `v${v.n} · ${CAUSE_LABEL[v.cause]} · ${timeText(v.at)}`), { value: String(v.n) }));
  }
  select.replaceChildren(...options);
  select.value = compareBase === null ? '' : String(compareBase);

  const bar = $('version-bar');
  bar.hidden = !viewing;
  $('readonly').hidden = !viewing;
  if (!viewing) return;
  const v = viewing.row;
  $('version-text').textContent = `Viewing v${v.n} · ${CAUSE_LABEL[v.cause]} ${timeText(v.at)} · read-only`;
  $<HTMLButtonElement>('restore').disabled = !!ended;
  $<HTMLButtonElement>('restore').title = ended
    ? 'This review has ended; open the file again to ask for a restore'
    : 'Queue a note asking the agent to write this version back to the file; it is sent only with your next Send';
  $('readonly-head').textContent = `v${v.n} is an earlier version, read-only`;
  const list = $('readonly-notes');
  const sentOn = viewing.notes.map((n) => {
    const row = el('div', 'readonly-note');
    row.append(el('span', 'num', String(Number(n.id.slice(2)))), document.createTextNode(`${describe(n.kind, n.anchor)}: ${clip(n.comment, 140)}`));
    return row;
  });
  if (sentOn.length) sentOn.unshift(el('div', 'readonly-head', `Notes sent on v${v.n} · ${sentOn.length}`));
  list.replaceChildren(...sentOn);
}

/** Shows an earlier version read-only, or (null) the page as it is now. */
async function viewVersion(v: VersionRow | null): Promise<void> {
  if (!v) viewing = null;
  else {
    let notes: VersionNote[] = [];
    try {
      notes = (await api<{ notes: VersionNote[] }>('GET', `/versions/${v.n}`)).notes;
    } catch (err) {
      banner(`Could not load v${v.n}: ${(err as Error).message}`, true, 5000);
      return;
    }
    viewing = { row: v, notes };
    if (pointBtn.getAttribute('aria-pressed') === 'true') setPicking(false);
  }
  // A comparison with the version now shown would be empty: drop it.
  if (compareBase !== null && compareBase === (viewing ? viewing.row.n : 'current')) compareBase = null;
  lastScroll = { x: 0, y: 0 };
  setVersionsOpen(false);
  if (compareBase !== null) await loadCompare();
  render();
  loadFrame();
}

async function loadCompare(): Promise<void> {
  if (compareBase === null) {
    compareChanges = null;
    return;
  }
  try {
    const to = viewing ? String(viewing.row.n) : 'current';
    const r = await api<Changes & { from: number | 'current' }>('GET', `/compare?from=${compareBase}&to=${to}`);
    compareChanges = { since: '', inserts: r.inserts, removals: r.removals };
  } catch (err) {
    compareChanges = null;
    banner(`Could not compare: ${(err as Error).message}`, true, 5000);
  }
  renderChanges();
  postChanges();
}

function setVersionsOpen(open: boolean): void {
  $('versions-panel').hidden = !open;
  $('versions-btn').setAttribute('aria-expanded', String(open));
  if (open) void loadVersions();
}

$('versions-btn').addEventListener('click', () => setVersionsOpen($('versions-panel').hidden));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('versions-panel').hidden) setVersionsOpen(false);
});
document.addEventListener('click', (e) => {
  if (!(e.target as Element).closest('.versions-wrap')) setVersionsOpen(false);
});
$<HTMLSelectElement>('compare-select').addEventListener('change', async (e) => {
  const v = (e.target as HTMLSelectElement).value;
  compareBase = v === '' ? null : v === 'current' ? 'current' : Number(v);
  await loadCompare();
  // Picking a version to compare with is asking to see the changes.
  showChanges = compareBase !== null;
  renderChanges();
  postChanges();
});
$('back-current').addEventListener('click', () => void viewVersion(null));

/**
 * Asks the agent, through an ordinary queued note, to bring this version back.
 * Nothing is sent here: the note waits for the reviewer's next Send, and the
 * agent writes the file itself (vivamark never does).
 */
$('restore').addEventListener('click', () => {
  if (!viewing || ended) return;
  const v = viewing.row;
  queue.push({
    kind: 'page',
    intent: 'change',
    comment:
      `Please restore version ${v.n} of this page (${CAUSE_LABEL[v.cause].toLowerCase()} ${new Date(v.at).toLocaleString()}, sha256 ${v.hash}).\n` +
      `Its content is kept at ${v.path}\n` +
      `Get it with: vivamark show ${session?.file ?? '<file>'} --version ${v.n}\n` +
      `then write it back to the file yourself.`,
    anchor: null,
  });
  saveQueue();
  void viewVersion(null).then(() => banner(`Queued a note asking the agent to restore v${v.n}. It is sent with your next Send.`, false, 4000));
});

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
    } else if (ev.type === 'versions') {
      void loadVersions();
    } else if (ev.type === 'reload') {
      // The file changed: the server has re-anchored every note against it.
      void refresh();
      // An earlier version does not change; the page as it is now does.
      if (!viewing) loadFrame();
      if (compareBase !== null) void loadCompare();
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
  void loadVersions();
}

void start();
