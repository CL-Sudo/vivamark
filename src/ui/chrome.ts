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
  source_line?: number | null;
}
interface Draft {
  kind: Kind;
  comment: string;
  anchor: Anchor | null;
}
interface Note extends Draft {
  id: string;
  at: string;
}
interface NoteEntry {
  seq: number;
  at: string;
  note: Note;
}
interface ReplyView {
  seq: number;
  at: string;
  text: string;
  html: string;
}
interface SessionView {
  id: string;
  file: string;
  name: string;
  artifact_url: string;
  notes: NoteEntry[];
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

let session: SessionView | null = null;
let sent: NoteEntry[] = [];
let replies: ReplyView[] = [];
let queue: Draft[] = loadQueue();
let target: { kind: Kind; anchor: Anchor | null } = { kind: 'page', anchor: null };
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
  const where = el('span', 'where', describe(d.kind, d.anchor) + (line ? ` · line ${line}` : ''));
  where.title = where.textContent ?? '';
  head.append(where);
  if (queuedIndex !== null) {
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
    head.append(el('span', 'state', 'Sent'));
  }
  card.append(head, el('p', 'comment', d.comment));
  return card;
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

function render(): void {
  const items: { at: string; node: HTMLElement }[] = [];
  sent.forEach((e, i) => items.push({ at: e.at, node: noteCard(i + 1, e.note, null, e.note.anchor?.source_line) }));
  replies.forEach((r) => items.push({ at: r.at, node: replyCard(r) }));
  items.sort((a, b) => a.at.localeCompare(b.at));
  const nodes = items.map((i) => i.node);
  queue.forEach((d, i) => nodes.push(noteCard(sent.length + i + 1, d, i)));
  if (!nodes.length) nodes.push(el('div', 'empty', 'No notes yet.'));
  const atBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 40;
  thread.replaceChildren(...nodes);
  if (atBottom) thread.scrollTop = thread.scrollHeight;

  $('note-count').textContent = String(sent.length + queue.length);
  sendBtn.disabled = sending || queue.length === 0;
  sendBtn.textContent = queue.length ? `Send ${queue.length}` : 'Send';
  addBtn.disabled = !comment.value.trim();

  const t = $('target');
  t.dataset.kind = target.kind;
  $('target-text').textContent = describe(target.kind, target.anchor);
  $('target-clear').hidden = target.kind === 'page';
  postMarks();
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
    ...sent.map((e, i) => ({ n: i + 1, kind: e.note.kind, anchor: e.note.anchor, queued: false })),
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
  queue.push({ kind: target.kind, comment: text, anchor: target.anchor });
  saveQueue();
  comment.value = '';
  target = { kind: 'page', anchor: null };
  render();
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
  render();
});
pointBtn.addEventListener('click', () => setPicking(pointBtn.getAttribute('aria-pressed') !== 'true'));

sendBtn.addEventListener('click', async () => {
  if (!queue.length || sending) return;
  sending = true;
  render();
  try {
    const res = await api<{ notes: NoteEntry[] }>('POST', '/send', { notes: queue });
    queue = [];
    saveQueue();
    mergeNotes(res.notes);
    banner(`Sent ${res.notes.length} note${res.notes.length === 1 ? '' : 's'} to the agent.`, false, 2500);
  } catch (err) {
    banner(`Could not send: ${(err as Error).message}`, true, 5000);
  } finally {
    sending = false;
    render();
  }
});

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
    else if (ev.type === 'notes' && ev.entries) {
      mergeNotes(ev.entries);
      render();
    } else if (ev.type === 'reply' && ev.reply) {
      mergeReply(ev.reply);
      render();
    } else if (ev.type === 'reload') {
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
    setPresence(s.agent);
    render();
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
  setPresence(session.agent);
  render();
  loadFrame();
  connect();
}

void start();
