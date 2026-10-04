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
interface Draft {
  kind: Kind;
  comment: string;
  intent?: Intent;
  severity?: Severity;
  answers?: string;
  anchor: Anchor | null;
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
interface SessionView {
  id: string;
  file: string;
  name: string;
  artifact_url: string;
  notes: NoteEntry[];
  decisions: DecisionView[];
  changes: Changes | null;
  turn: 'agent' | 'reviewer';
  replies: ReplyView[];
  agent: 'listening' | 'away';
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

let session: SessionView | null = null;
let sent: NoteEntry[] = [];
let replies: ReplyView[] = [];
let decisions: DecisionView[] = [];
let changes: Changes | null = null;
let turn: 'agent' | 'reviewer' = 'reviewer';
/** The sent note the reviewer is answering (F6), if any. */
let answering: { id: string; n: number } | null = null;
let showChanges = false;
let queue: Draft[] = loadQueue();
let target: { kind: Kind; anchor: Anchor | null } = { kind: 'page', anchor: null };
let tags: { intent?: Intent; severity?: Severity } = {};
let loadNonce = '';
let lastScroll = { x: 0, y: 0 };
let sending = false;

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
    head.append(el('span', 'state', 'Queued'));
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
  card.append(head, tagRow, el('p', 'comment', d.comment));
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
      answering = { id: note.id, n };
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
  sendBtn.disabled = sending || queue.length === 0;
  sendBtn.textContent = queue.length ? `Send ${queue.length}` : 'Send';
  approveBtn.disabled = sending;
  approveBtn.textContent = queue.length ? 'Approve with notes' : 'Approve';
  approveBtn.title = queue.length ? 'Approve, and send the queued notes as guidance' : 'Approve: no further revision needed';
  dismissBtn.disabled = sending || queue.length > 0;
  dismissBtn.title = queue.length ? 'Send or remove the queued notes first' : 'Close this review without feedback';
  addBtn.disabled = !comment.value.trim();

  const t = $('target');
  t.dataset.kind = target.kind;
  $('target-text').textContent = answering ? `answer to note ${answering.n}` : describe(target.kind, target.anchor);
  t.dataset.answering = String(!!answering);
  $('target-clear').hidden = target.kind === 'page' && !answering;
  const turnEl = $('turn');
  turnEl.dataset.turn = turn;
  turnEl.textContent = turn === 'agent' ? "Agent's turn" : 'Your turn';
  turnEl.title = turn === 'agent' ? 'Notes are waiting on the agent' : 'Nothing is waiting on the agent';
  renderTags();
  renderChanges();
  postMarks();
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

function postChanges(): void {
  toFrame({ type: 'changes', show: showChanges, inserts: changes?.inserts ?? [], removals: changes?.removals ?? [] });
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
  const marks = [
    ...sent.flatMap((e, i) => {
      const a = e.note.anchor;
      // An orphaned note is not drawn at all; a moved one is drawn where it is now.
      if (a?.state === 'orphaned') return [];
      const anchor = a?.current && a.state === 'moved' ? { ...a, stable_id: a.current.stable_id, selector: a.current.selector } : a;
      return [{ n: i + 1, kind: e.note.kind, anchor, queued: false }];
    }),
    ...queue.map((d, i) => ({ n: sent.length + i + 1, kind: d.kind, anchor: d.anchor, queued: true })),
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
  frame.src = `${session.artifact_url}?vmload=${loadNonce}`;
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
      if ((d.kind === 'element' || d.kind === 'text') && d.anchor) {
        // A page can only propose a target. Nothing is queued or sent without the reviewer.
        target = { kind: d.kind, anchor: d.anchor };
        pointBtn.setAttribute('aria-pressed', 'false');
        render();
        comment.focus();
      }
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
  queue.push({ kind: target.kind, comment: text, ...tags, ...(answering ? { answers: answering.id } : {}), anchor: target.anchor });
  saveQueue();
  comment.value = '';
  target = { kind: 'page', anchor: null };
  tags = {};
  answering = null;
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
  answering = null;
  render();
});
pointBtn.addEventListener('click', () => setPicking(pointBtn.getAttribute('aria-pressed') !== 'true'));
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
  if (sending) return;
  const notes = decision === 'approve' || decision === 'dismiss' ? [] : queue;
  if ((decision === 'request-changes' || decision === 'approve-with-notes') && !notes.length) return;
  sending = true;
  render();
  try {
    const res = await api<{ notes: (NoteEntry & { type: string })[] }>('POST', '/send', { notes, decision });
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
    let ev: { type: string; agent?: 'listening' | 'away'; entries?: NoteEntry[]; reply?: ReplyView };
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
    backoff = Math.min(backoff * 2, 10_000);
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
  document.title = `${session.name} · vivamark`;
  $('file-name').textContent = session.name;
  $('file-name').title = session.file;
  mergeNotes(session.notes);
  replies = session.replies;
  decisions = session.decisions ?? [];
  changes = session.changes ?? null;
  turn = session.turn ?? 'reviewer';
  setPresence(session.agent);
  render();
  loadFrame();
  connect();
}

void start();
