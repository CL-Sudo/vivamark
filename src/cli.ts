// The agent's only interface. stdout carries the result; progress and
// heartbeats go to stderr, so an agent can read stdout as the answer.

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { openBrowser } from './browser.js';
import { ApiError, ensureDaemon, mayBeRunning, request, runningDaemon, stopDaemon } from './client.js';
import { eventsPath, parseEventLines } from './events.js';
import type { VivamarkEvent } from './events.js';
import { GUIDE_SCHEMA, TAGLINE, TOPICS, findTopic, guideIndex } from './guide.js';
import { FIGURES_SCHEMA, lintExitCode, lintPage, pageFigures, renderFigures, renderLint } from './lint.js';
import type { LintResult } from './lint.js';
import { RenderError, renderExitCode, renderPage, renderRenderResult } from './render.js';
import { FEEDBACK_SCHEMA } from './schema.js';
import type { Anchor, Decision, Note, NoteKind } from './schema.js';
import { findSession, readServerInfo, stateDir } from './store.js';
import type { Ended, SessionRecord } from './store.js';
import { VERSION } from './version.js';

const EXIT = { ok: 0, error: 1, usage: 2, ended: 3, disconnected: 4, timeout: 5, approved: 6, dismissed: 7 } as const;

const HELP = `vivamark ${VERSION}: ${TAGLINE}

Usage:
  vivamark open <file.html> [--label k=v]... [--no-browser] [--json]
      Start (or resume) a review of a saved HTML or Markdown (.md) file and open
      it in the browser: the one BROWSER names, else the system's default (see
      Environment). --no-browser opens none. The URL is always printed. Markdown
      is rendered with raw HTML shown as text.
  vivamark wait <file|session> [--after <seq>] [--timeout <dur>] [--owner <name>]
                [-m <text> | --reply-file <file>] [--json]
      Block until the reviewer sends notes or a decision, then print them.
      Nothing is consumed: re-running wait returns the same notes until you
      pass --after <seq>. -m posts a reply first, then waits. It also returns
      when the review ends (exit 3), or when the review page, once opened, has
      been closed for about 10 seconds (exit 4); a page never opened yet keeps
      it waiting. Notes already sent are delivered first.
  vivamark reply <file|session> (-m <text> | --file <file|->) [--json]
  vivamark reply <file|session> --note <id> --status addressed|declined|question
                [-m <text>] [--json]
      Send a message to the reviewer's page. With --note, say what became of one
      note: addressed, declined, or a question back to the reviewer (needs -m).
      The reviewer's answer arrives as a new note with "answers": <id>. Only the
      reviewer resolves a note.
  vivamark note add <file|session> --text <text> [--target <target>]
                [--source <name>] [--json]
      Show the reviewer a note from the agent or a tool ("I guessed this number"),
      labelled with --source (default: agent). The target is line:<n> (or <n>),
      css:<selector> (or a selector starting with # or body), quote:<text>, or
      any other text on the page; without one the note is on the whole page.
      It never reaches wait unless the reviewer endorses it or replies to it;
      then wait shows the reviewer's note with "endorses" or "replies_to" and
      "agent_note".
  vivamark status [<file|session>] [--owner <name>] [--json]
      Where a review stands, at once: open or ended, notes pending after the
      owner's cursor (default: agent), last seq, last decision, whose turn it
      is, the reviewer's page (connected, disconnected, or never-opened) and
      whether the agent is listening. Never blocks and never moves a cursor,
      so a supervisor can poll it without taking notes from the agent.
      Without a file, lists every session.
  vivamark end <file|session> [-m <text>] [--json]
      End the review as the agent. The page shows it ended (with the message),
      sends are refused, and wait returns ended (exit 3). The reviewer can end
      it too, with End review on the page. A later open of the same file
      starts a fresh review.
  vivamark versions <file|session> [--json]
      Every version of the file vivamark has seen, across all its reviews,
      oldest first: number, time, why it was kept (open, save, send, end,
      read), size and where its content is. A Send shows its decision and
      note count. Kept forever; vivamark never writes the reviewed file.
  vivamark show <file|session> --version <n|hash> [--json]
      Print one version's content (n from versions, or 8+ hex digits of its
      hash), for you to write back yourself when the reviewer asks to
      restore it. --json adds the version's details and the notes sent on it.
  vivamark events [--after <seq>] [--follow] [--json]
      Print the event log (events.jsonl in the state directory) after a seq;
      with --follow, keep printing new events until interrupted. One event per
      line: seq, at, type, session, file, labels and a few details. Types:
      session.opened, feedback.sent, reply.posted, note.status,
      agent-note.added, session.ended, browser.connected, browser.disconnected,
      version.saved (number, hash, size and cause; never the content).
      Events never contain note text, quotes, replies, messages or images
      (feedback.sent counts them as attachments); read those with wait. Reads the log only; needs no server and no browser.
  vivamark guide [<topic>] [--json]
      How to run a review and write a page worth reviewing: the workflow, the
      page design (ready CSS), stable ids, and playbooks for a plan, report,
      comparison, explainer or diff. Without a topic, lists the topics.
  vivamark lint <page.html> [--json]
      Check a page's figures against the text they summarise (vivamark guide
      figures), offline, without changing the page. Errors: an SVG without
      role="img" and an aria-label; a caption not starting "Author's summary
      of" or not linking a section on the page; a duplicate part id; a hex
      fill or stroke; a script; an external URL; a number of two or more
      digits in a figure that is not in the linked section; bars not drawn to
      one scale; a shape nothing fills, which SVG paints black (a warning
      instead when the page fills through CSS lint cannot fully read: check
      it with render). Warnings: label words not in the section; no coverage
      line where the section has more items than the figure has parts; an
      arrow group without data-from and data-to; text that likely runs out of
      its box or the viewBox (an estimate from its length); a term listed in
      data-vivamark-supersedes still in the lede, a card or a figure.
      Exit 0 clean, 1 errors (or the page cannot be read), 2 warnings only.
  vivamark figures <page.html> [--json]
      Print each figure (.viz) as saved, with its caption, and apart from it
      the text of the section(s) its caption links to: for a read-back check,
      give a fresh reader the figure alone first, the section after.
  vivamark render <page.html> [--out <dir>] [--dark] [--width <px>] [--json]
      Draw the page in a headless Chrome or Chromium already on this machine
      (VIVAMARK_CHROME, else google-chrome, google-chrome-stable, chromium or
      chromium-browser on PATH; never downloaded) and write PNGs of the page
      and of each figure, whole even where it scrolls sideways (default: a
      folder under the system temp directory; width 1000, light). Reports
      what the drawing shows, and is the judge of paint where lint is not
      sure: a shape painted black and text cut off by its figure (errors),
      text out of its box and a page that scrolls sideways (warnings), and
      any request for something other than a local file (an error; refused).
      The browser is kept off the network by its flags and by refusing every
      such request, and page script does not run. Never writes the page;
      open never runs it. Exit 0 clean, 1 errors (or no browser), 2 warnings
      only.
  vivamark stop
      Stop the background review server.

What wait returns (--json; the text form says the same):
  decision     request-changes, approve, approve-with-notes or dismiss
  turn         agent while a note waits on you, else reviewer
  orphaned     ids of notes whose target is gone from the file
  per note     comment, intent (change, question, delete, looks-good), severity
               (blocking, important, nit), motivation (W3C), status (open,
               addressed, declined, question, answered, resolved), anchor with
               lines [first, last], state (anchored, moved, orphaned) and
               current place when it moved, cell {row, column}, control
               {role, name} or point {x, y, width, height}, target_changed,
               attachments: images the reviewer attached, each {id, path, mime,
               width, height, bytes}; path is a local PNG, JPEG, GIF or WebP
               file to open (the text form lists them). A choice clicked on a
               control marked data-vivamark-suggest arrives as a note like any
               other, once the reviewer sends it (vivamark guide decisions).

Exit codes for wait:
  0  notes; the reviewer requests changes     6  approved (or approved with notes)
  7  dismissed: the review closed with nothing 5  timeout
  3  ended: the agent or the reviewer ended the review; nothing more will come
  4  disconnected: the review page, opened before, has been gone for the grace
     period; nothing consumed. Never before a page has first connected.
  1  error     130/143 interrupted, safe to re-run
Durations: 90s, 5m, 1h, or milliseconds.

Notify hook (set only by you, never by a page or a request):
  VIVAMARK_NOTIFY_CMD=<command>, in the environment of the command that starts
  the server, or "notify_cmd" in $XDG_CONFIG_HOME/vivamark/config.json
  (~/.config/vivamark/config.json); the environment wins. The server runs it
  once per event with the event's JSON on stdin (no note text), without
  waiting, never retrying, and kills it after 5 s (VIVAMARK_NOTIFY_TIMEOUT_MS
  or "notify_timeout_ms"). Failures go to daemon.log in the state directory.
  Read when the server starts: run vivamark stop to apply a change.

Environment:
  BROWSER                       the browser open starts, instead of the system's
                                default. Commands separated by : (; on Windows),
                                tried in order; a drive letter's colon (C:\\) is
                                kept. Without %s, the whole entry is one program,
                                spaces and all, given the URL:
                                  BROWSER="/mnt/c/Program Files/Google/Chrome/Application/chrome.exe"
                                With %s, it is a command line split on spaces
                                ('...' or "..." keep them) and %s is the URL:
                                  BROWSER="firefox --new-window %s"
                                Run without a shell. If none starts, the system's
                                default opens it.
  VIVAMARK_CHROME               the Chrome or Chromium render draws with (a path,
                                or a name on PATH); on WSL, one installed in WSL
  VIVAMARK_STATE_DIR            state directory (default $XDG_STATE_HOME/vivamark
                                or ~/.local/state/vivamark)
  VIVAMARK_DISCONNECT_GRACE_MS  how long wait goes on after the review page went
                                away before it returns disconnected (default 10000)
  VIVAMARK_MAX_IMAGE_BYTES      largest image the reviewer can attach (default
                                10 MB; or "max_image_bytes" in config.json)
  VIVAMARK_MAX_NOTE_IMAGE_BYTES largest total of images on one note (default
                                25 MB; or "max_note_image_bytes" in config.json)
                                Both are read when the server starts.
`;

class UsageError extends Error {}

function fail(message: string, code: number = EXIT.error): never {
  process.stderr.write(`vivamark: ${message}\n`);
  process.exit(code);
}

function parseDuration(s: string): number {
  const m = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(s.trim());
  if (!m) throw new UsageError(`bad duration: ${s}`);
  const n = Number(m[1]);
  const unit = m[2] ?? 'ms';
  return Math.round(n * { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 }[unit]!);
}

function sessionFor(ref: string): SessionRecord {
  const s = findSession(ref);
  if (!s) fail(`no review session for ${ref}; start one with: vivamark open ${ref}`);
  return s;
}

function quote(s: string): string {
  return /^[A-Za-z0-9_./:@%+=-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

// ---- open -------------------------------------------------------------------

async function cmdOpen(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      label: { type: 'string', multiple: true },
      'no-browser': { type: 'boolean' },
      json: { type: 'boolean' },
    },
  });
  if (positionals.length !== 1) throw new UsageError('open takes exactly one file');
  const file = path.resolve(positionals[0]);
  if (!fs.existsSync(file)) fail(`no such file: ${file}`);
  if (!/\.(html?|md|markdown)$/i.test(file)) fail('vivamark opens .html, .htm, .md and .markdown files');
  const labels: Record<string, string> = {};
  for (const l of values.label ?? []) {
    const i = l.indexOf('=');
    if (i <= 0) throw new UsageError(`--label wants k=v, got ${l}`);
    labels[l.slice(0, i)] = l.slice(i + 1);
  }
  const info = await ensureDaemon();
  const res = await request<{ id: string; file: string; created: boolean; labels: Record<string, string> }>(
    info.port,
    'POST',
    '/api/sessions',
    { token: info.admin_token, body: { file: fs.realpathSync(file), labels } },
  );
  const session = sessionFor(res.id);
  const url = `http://127.0.0.1:${info.port}/s/${res.id}#t=${session.token}`;
  const next = `vivamark wait ${quote(res.file)}`;
  const guide = /\.(md|markdown)$/i.test(res.file)
    ? 'for decisions, tables or a diff a structured HTML page is often better: vivamark guide markdown'
    : 'how to write a page worth reviewing: vivamark guide';
  if (!values['no-browser'] && process.env.VIVAMARK_NO_BROWSER !== '1') openBrowser(url);
  lintOnOpen(file);
  if (values.json) {
    process.stdout.write(
      JSON.stringify({ schema: 'vivamark.open/1', session: { id: res.id, file: res.file, status: 'open', labels: res.labels }, url, created: res.created, next, guide }) + '\n',
    );
  } else {
    process.stdout.write(
      `${res.created ? 'Opened' : 'Resumed'} ${path.basename(res.file)} for review (session ${res.id}).\n` +
        `URL: ${url}\n` +
        `next: ${next}\n` +
        `guide: ${guide}\n`,
    );
  }
}

// ---- wait ---------------------------------------------------------------------

interface DeliveredNote extends Note {
  seq: number;
}

interface FeedbackView {
  schema: string;
  session: { id: string; file: string; status: string; labels: Record<string, string> };
  status: 'feedback' | 'pending' | 'ended' | 'disconnected';
  ended?: Ended;
  seq?: { from: number; to: number };
  notes?: DeliveredNote[];
  decision?: Decision;
  turn?: 'agent' | 'reviewer';
  orphaned?: string[];
  after?: number;
  last_seq?: number;
}

async function postReply(port: number, s: SessionRecord, text: string, about?: { note: string; status: string }): Promise<{ seq: number; at: string }> {
  return request(port, 'POST', `/api/s/${s.id}/replies`, { token: s.token, body: { text, ...about } });
}

function readReplyFile(p: string): string {
  return p === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(path.resolve(p), 'utf8');
}

function describeTarget(kind: NoteKind, a: Anchor | null): string {
  if (kind === 'page' || !a) return 'the whole page';
  if (kind === 'text') return `text "${a.quote}"`;
  const el = `<${a.tag || 'element'}${a.stable_id ? `#${a.stable_id}` : ''}>`;
  if (a.control) return `${a.control.role} "${a.control.name}" ${el}`;
  if (a.cell) return `cell ${describeCell(a.cell)} ${el}`;
  return el;
}

function describeLines(a: Anchor | null): string {
  if (a?.lines && a.lines[1] > a.lines[0]) return ` (lines ${a.lines[0]}-${a.lines[1]})`;
  return a?.source_line ? ` (line ${a.source_line})` : '';
}

function describeCell(c: NonNullable<Anchor['cell']>): string {
  return [c.row !== undefined ? `row "${c.row}"` : '', c.column !== undefined ? `column "${c.column}"` : ''].filter(Boolean).join(', ');
}

function kb(n: number): string {
  return n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${Math.round((n / (1024 * 1024)) * 10) / 10} MB`;
}

const DECISION_TEXT: Record<Decision, string> = {
  'request-changes': 'The reviewer requests changes.',
  approve: 'The reviewer approved. No further revision is needed.',
  'approve-with-notes': 'The reviewer approved with notes: go ahead, taking the notes as guidance.',
  dismiss: 'The reviewer dismissed the review without feedback.',
};

function renderFeedback(v: FeedbackView, next: string): string {
  const notes = v.notes ?? [];
  const lines = [`${notes.length} note${notes.length === 1 ? '' : 's'} on ${v.session.file} (seq ${v.seq!.from}-${v.seq!.to}, session ${v.session.id})`];
  lines.push(`decision: ${v.decision ?? 'request-changes'}. ${DECISION_TEXT[v.decision ?? 'request-changes']}`, '');
  for (const n of notes) {
    const a = n.anchor;
    const nv = n as DeliveredNote & { status?: string; answers?: string; target_changed?: boolean };
    const tags = [
      n.intent,
      n.severity,
      nv.status && nv.status !== 'open' ? nv.status : '',
      nv.answers ? `answers ${nv.answers}` : '',
      n.endorses ? `endorses ${n.endorses}` : '',
      n.replies_to ? `replies to ${n.replies_to}` : '',
      nv.target_changed ? 'target changed' : '',
    ]
      .filter(Boolean)
      .join(', ');
    lines.push(`[${n.seq}] ${n.id}${tags ? ` (${tags})` : ''} on ${describeTarget(n.kind, a)}${describeLines(a)}`);
    for (const l of n.comment.split('\n')) lines.push(`    > ${l}`);
    const images = n.attachments ?? [];
    if (images.length) {
      lines.push(`    images: ${images.length} attached; open them from these paths:`);
      for (const img of images) lines.push(`      ${img.path} (${img.mime.slice(6).toUpperCase()}, ${img.width} x ${img.height}, ${kb(img.bytes)})`);
    }
    if (n.agent_note && n.replies_to) lines.push(`    in reply to ${n.agent_note.source} (${n.agent_note.id}): "${n.agent_note.comment}"`);
    if (a) {
      const st = a as Anchor & { state?: string; current?: { selector: string; source_line: number | null } };
      if (st.state === 'orphaned') lines.push('    target: gone from the file (orphaned); the note is kept, not re-pinned');
      else if (st.state === 'moved' && st.current) lines.push(`    target: moved to ${st.current.selector}${st.current.source_line ? ` (line ${st.current.source_line})` : ''}`);
      else if (st.current?.source_line) lines.push(`    target: now at line ${st.current.source_line}`);
      if (a.selector) lines.push(`    selector: ${a.selector}`);
      if (n.kind === 'element' && a.text) lines.push(`    text: "${a.text}"`);
      if (a.cell) lines.push(`    cell: ${describeCell(a.cell)}`);
      if (a.point) lines.push(`    point: x ${a.point.x}, y ${a.point.y} in a ${a.point.width} x ${a.point.height} box`);
      if (n.kind === 'text') lines.push(`    context: "…${a.prefix ?? ''}[${a.quote}]${a.suffix ?? ''}…"`);
    }
    lines.push('');
  }
  if (v.orphaned?.length) lines.push(`orphaned (target gone): ${v.orphaned.join(', ')}`);
  if (v.turn) lines.push(`turn: ${v.turn === 'agent' ? "the agent's (notes are waiting on you)" : "the reviewer's"}`);
  lines.push(`next: ${next}`);
  return lines.join('\n') + '\n';
}

async function cmdWait(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      after: { type: 'string' },
      timeout: { type: 'string' },
      owner: { type: 'string' },
      m: { type: 'string', short: 'm' },
      'reply-file': { type: 'string' },
      json: { type: 'boolean' },
    },
  });
  if (positionals.length !== 1) throw new UsageError('wait takes exactly one file or session id');
  if (values.after !== undefined && !/^\d+$/.test(values.after)) throw new UsageError('--after wants a sequence number');
  const timeoutMs = values.timeout ? parseDuration(values.timeout) : 0;
  const owner = values.owner ?? 'agent';
  const s = sessionFor(positionals[0]);
  let info = await ensureDaemon();

  const replyText = values.m ?? (values['reply-file'] ? readReplyFile(values['reply-file']) : undefined);
  if (replyText !== undefined) await postReply(info.port, s, replyText);

  const deadline = timeoutMs ? Date.now() + timeoutMs : Infinity;
  process.stderr.write(`Waiting for the reviewer to send notes on ${s.file}. Interrupting is safe; nothing is consumed.\n`);
  let lastBeat = Date.now();
  let failures = 0;
  for (;;) {
    const hold = Math.max(0, Math.min(20_000, deadline - Date.now()));
    const params = new URLSearchParams({ owner, hold: String(hold) });
    if (values.after !== undefined) params.set('after', values.after);
    let v: FeedbackView;
    try {
      v = await request<FeedbackView>(info.port, 'GET', `/api/s/${s.id}/feedback?${params}`, { token: s.token, timeoutMs: hold + 10_000 });
      failures = 0;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      // The daemon went away (stopped or restarted): the log is on disk, so start it again and carry on.
      if (++failures > 5) throw err;
      await new Promise((r) => setTimeout(r, 300));
      info = await ensureDaemon();
      continue;
    }
    if (v.status === 'feedback') {
      const to = v.seq!.to;
      const decision = v.decision ?? 'request-changes';
      const next =
        decision === 'request-changes'
          ? `edit the file (the page reloads), then: vivamark wait ${quote(s.file)} --after ${to} -m "<what you changed>"`
          : decision === 'dismiss'
            ? 'the review is closed; stop, or ask the reviewer to look again later'
            : `carry on with the work${decision === 'approve-with-notes' ? ', following the notes' : ''}; to wait for more: vivamark wait ${quote(s.file)} --after ${to}`;
      if (values.json) {
        const out = { schema: FEEDBACK_SCHEMA, session: v.session, status: v.status, seq: v.seq, notes: v.notes, next, decision, turn: v.turn, orphaned: v.orphaned ?? [] };
        process.stdout.write(JSON.stringify(out, null, 2) + '\n');
      } else {
        process.stdout.write(renderFeedback(v, next));
      }
      process.exit(decision === 'dismiss' ? EXIT.dismissed : decision === 'request-changes' ? EXIT.ok : EXIT.approved);
    }
    if (v.status === 'ended') {
      const e = v.ended;
      const next = `the review is over; to start a new one: vivamark open ${quote(s.file)}`;
      if (values.json) process.stdout.write(JSON.stringify({ ...v, next }) + '\n');
      else {
        process.stdout.write(
          `The review of ${s.file} has ended${e ? ` (by the ${e.by}, ${e.at})` : ''}; nothing more will come (last seq ${v.last_seq}).\n` +
            (e?.message ? `    > ${e.message.split('\n').join('\n    > ')}\n` : '') +
            `next: ${next}\n`,
        );
      }
      process.exit(EXIT.ended);
    }
    if (v.status === 'disconnected') {
      const next = `ask the reviewer to open the page again (vivamark open ${quote(s.file)} reopens it), then: vivamark wait ${quote(s.file)}`;
      if (values.json) process.stdout.write(JSON.stringify({ ...v, next }) + '\n');
      else process.stdout.write(`No review page is open for ${s.file}, so no notes can come (last seq ${v.last_seq}). Nothing was consumed.\nnext: ${next}\n`);
      process.exit(EXIT.disconnected);
    }
    if (Date.now() >= deadline) {
      if (values.json) process.stdout.write(JSON.stringify({ ...v, status: 'timeout' }) + '\n');
      else process.stdout.write(`No notes yet on ${s.file} (timed out; last seq ${v.last_seq}).\n`);
      process.exit(EXIT.timeout);
    }
    if (Date.now() - lastBeat > 60_000) {
      process.stderr.write('Still waiting for the reviewer…\n');
      lastBeat = Date.now();
    }
  }
}

// ---- reply ----------------------------------------------------------------------

async function cmdReply(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      m: { type: 'string', short: 'm' },
      file: { type: 'string' },
      note: { type: 'string' },
      status: { type: 'string' },
      json: { type: 'boolean' },
    },
  });
  if (positionals.length !== 1) throw new UsageError('reply takes exactly one file or session id');
  const text = values.m ?? (values.file ? readReplyFile(values.file) : undefined);
  let about: { note: string; status: string } | undefined;
  if (values.note !== undefined || values.status !== undefined) {
    if (!values.note || !values.status) throw new UsageError('--note and --status go together');
    if (values.status === 'resolved') throw new UsageError('only the reviewer resolves a note; mark it addressed, declined or question');
    if (!['addressed', 'declined', 'question'].includes(values.status)) throw new UsageError('--status wants addressed, declined or question');
    if (values.status === 'question' && (text === undefined || !text.trim())) throw new UsageError('--status question needs the question: -m <text>');
    about = { note: values.note, status: values.status };
  } else if (text === undefined || !text.trim()) {
    throw new UsageError('reply needs -m <text> or --file <file>');
  }
  const s = sessionFor(positionals[0]);
  const info = await ensureDaemon();
  const r = await postReply(info.port, s, text ?? '', about);
  if (values.json) process.stdout.write(JSON.stringify({ schema: 'vivamark.reply/1', session: s.id, seq: r.seq, at: r.at, ...about }) + '\n');
  else if (about) process.stdout.write(`Marked ${about.note} ${about.status} on the review page for ${path.basename(s.file)} (reply ${r.seq}).\n`);
  else process.stdout.write(`Reply ${r.seq} delivered to the review page for ${path.basename(s.file)}.\n`);
}

// ---- note add ---------------------------------------------------------------------

interface AddedNote {
  note: { id: string; kind: NoteKind; comment: string; anchor: Anchor | null; source: string; at: string };
}

async function cmdNote(argv: string[]): Promise<void> {
  const [sub, ...rest] = argv;
  if (sub !== 'add') throw new UsageError('note wants a subcommand: vivamark note add <file> --target <t> --text <text>');
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      target: { type: 'string' },
      text: { type: 'string' },
      source: { type: 'string' },
      json: { type: 'boolean' },
    },
  });
  if (positionals.length !== 1) throw new UsageError('note add takes exactly one file or session id');
  if (!values.text || !values.text.trim()) throw new UsageError('note add needs --text <text>');
  const s = sessionFor(positionals[0]);
  const info = await ensureDaemon();
  const body = { text: values.text, ...(values.target !== undefined ? { target: values.target } : {}), ...(values.source !== undefined ? { source: values.source } : {}) };
  const r = await request<AddedNote>(info.port, 'POST', `/api/s/${s.id}/agent-notes`, { token: s.token, body });
  const n = r.note;
  if (values.json) {
    process.stdout.write(JSON.stringify({ schema: 'vivamark.note/1', session: s.id, note: n }) + '\n');
  } else {
    process.stdout.write(
      `Added ${n.id} from ${n.source} on ${describeTarget(n.kind, n.anchor)}${describeLines(n.anchor)} to the review page for ${path.basename(s.file)}.\n` +
        'The reviewer sees it; it reaches wait only if they endorse it or reply to it.\n',
    );
  }
}

// ---- end --------------------------------------------------------------------------

async function cmdEnd(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      m: { type: 'string', short: 'm' },
      json: { type: 'boolean' },
    },
  });
  if (positionals.length !== 1) throw new UsageError('end takes exactly one file or session id');
  const s = sessionFor(positionals[0]);
  const info = await ensureDaemon();
  const r = await request<{ session: string; status: string; ended: Ended; already: boolean }>(info.port, 'POST', `/api/s/${s.id}/end`, {
    token: s.token,
    body: values.m !== undefined ? { message: values.m } : {},
  });
  if (values.json) process.stdout.write(JSON.stringify({ schema: 'vivamark.end/1', ...r }) + '\n');
  else if (r.already) process.stdout.write(`The review of ${path.basename(s.file)} had already ended (by the ${r.ended.by}, ${r.ended.at}).\n`);
  else process.stdout.write(`Ended the review of ${path.basename(s.file)} (session ${s.id}). The page shows it ended; vivamark open starts a new one.\n`);
}

// ---- status -----------------------------------------------------------------------

interface StatusEntry {
  session: { id: string; file: string; status: string; labels: Record<string, string> };
  owner: string;
  cursor: number;
  pending: number;
  last_seq: number;
  decision: Decision | null;
  turn: 'agent' | 'reviewer';
  reviewer: 'connected' | 'disconnected' | 'never-opened';
  agent: 'listening' | 'away';
  created: string;
}

function labelText(labels: Record<string, string>): string {
  return Object.entries(labels)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
}

function renderStatus(e: StatusEntry): string {
  const labels = labelText(e.session.labels);
  return (
    `${path.basename(e.session.file)} (session ${e.session.id}): ${e.session.status}\n` +
    `  file: ${e.session.file}\n` +
    `  pending: ${e.pending} note${e.pending === 1 ? '' : 's'} after seq ${e.cursor} (owner ${e.owner}); last seq ${e.last_seq}` +
    `${e.decision ? `, last decision ${e.decision}` : ''}\n` +
    `  turn: ${e.turn === 'agent' ? 'the agent' : 'the reviewer'}; reviewer ${e.reviewer}; agent ${e.agent}\n` +
    (labels ? `  labels: ${labels}\n` : '')
  );
}

async function cmdStatus(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      owner: { type: 'string' },
      json: { type: 'boolean' },
    },
  });
  if (positionals.length > 1) throw new UsageError('status takes at most one file or session id');
  const owner = values.owner ?? 'agent';
  if (!/^[A-Za-z0-9._:-]{1,64}$/.test(owner)) throw new UsageError('--owner wants a short name (letters, digits, . _ : -)');
  const s = positionals.length ? sessionFor(positionals[0]) : undefined;
  const info = await ensureDaemon();
  const params = new URLSearchParams({ owner });
  if (s) params.set('session', s.id);
  const r = await request<StatusEntry & { schema: string; sessions?: StatusEntry[] }>(info.port, 'GET', `/api/status?${params}`, { token: info.admin_token });
  if (values.json) {
    process.stdout.write(JSON.stringify(r) + '\n');
  } else if (s) {
    process.stdout.write(renderStatus(r));
  } else if (!r.sessions?.length) {
    process.stdout.write('No review sessions.\n');
  } else {
    process.stdout.write(r.sessions.map(renderStatus).join('\n'));
  }
}

// ---- versions -----------------------------------------------------------------------

interface VersionRow {
  n: number;
  hash: string;
  at: string;
  cause: string;
  size: number;
  session: string;
  batch?: string;
  decision?: Decision;
  notes?: number;
  path: string;
}

const CAUSE_TEXT: Record<string, string> = { open: 'opened', save: 'saved', send: 'sent', end: 'ended', read: 'read' };

function versionLine(v: VersionRow, current: number | null): string {
  const send = v.cause === 'send' ? ` ${v.decision ?? 'request-changes'}, ${v.notes ?? 0} note${v.notes === 1 ? '' : 's'}` : '';
  return `v${v.n}  ${v.at}  ${(CAUSE_TEXT[v.cause] ?? v.cause).padEnd(6)}${send}  ${kb(v.size)}  ${v.hash.slice(0, 12)}${v.n === current ? '  (current)' : ''}`;
}

async function cmdVersions(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { json: { type: 'boolean' } } });
  if (positionals.length !== 1) throw new UsageError('versions takes exactly one file or session id');
  const s = sessionFor(positionals[0]);
  const info = await ensureDaemon();
  const r = await request<{ schema: string; file: string; current: number | null; versions: VersionRow[] }>(info.port, 'GET', `/api/s/${s.id}/versions`, { token: s.token });
  if (values.json) {
    process.stdout.write(JSON.stringify(r) + '\n');
    return;
  }
  if (!r.versions.length) {
    process.stdout.write(`No versions of ${r.file} kept yet.\n`);
    return;
  }
  process.stdout.write(
    `${r.versions.length} version${r.versions.length === 1 ? '' : 's'} of ${r.file}, oldest first:\n` +
      r.versions.map((v) => `  ${versionLine(v, r.current)}\n`).join('') +
      `content of one: vivamark show ${quote(r.file)} --version <n>\n`,
  );
}

async function cmdShow(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { version: { type: 'string' }, json: { type: 'boolean' } } });
  if (positionals.length !== 1) throw new UsageError('show takes exactly one file or session id');
  const ref = values.version;
  if (!ref || !/^(\d{1,9}|[0-9a-f]{8,64})$/.test(ref)) throw new UsageError('show needs --version <n> (from vivamark versions) or 8+ hex digits of a hash');
  const s = sessionFor(positionals[0]);
  const info = await ensureDaemon();
  const r = await request<{ schema: string; file: string; version: VersionRow; notes: unknown[]; content: string }>(info.port, 'GET', `/api/s/${s.id}/versions/${ref}?content=1`, {
    token: s.token,
  });
  // The content goes to stdout as it is, so it can be written back unchanged; the details go to stderr.
  if (values.json) process.stdout.write(JSON.stringify(r) + '\n');
  else {
    process.stderr.write(`${versionLine(r.version, null)}\n  ${r.version.path}\n`);
    process.stdout.write(r.content);
  }
}

// ---- events -----------------------------------------------------------------------

const EVENT_CORE = new Set(['seq', 'at', 'type', 'session', 'file', 'labels']);

function renderEvent(e: VivamarkEvent): string {
  const details = Object.entries(e)
    .filter(([k]) => !EVENT_CORE.has(k))
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
  const labels = labelText(e.labels ?? {});
  return [`[${e.seq}]`, e.at, e.type, e.session, path.basename(e.file ?? ''), ...details, ...(labels ? [`labels: ${labels}`] : [])].join('  ') + '\n';
}

/** Prints the event log after a seq. Reads the file only: no server, no browser. */
async function cmdEvents(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      after: { type: 'string' },
      follow: { type: 'boolean', short: 'f' },
      json: { type: 'boolean' },
    },
  });
  if (positionals.length) throw new UsageError('events takes no file; it prints every review\'s events');
  if (values.after !== undefined && !/^\d+$/.test(values.after)) throw new UsageError('--after wants a sequence number');
  const after = Number(values.after ?? 0);
  const file = eventsPath(stateDir());
  let offset = 0;
  let rest = '';
  const drain = () => {
    let fd: number;
    try {
      fd = fs.openSync(file, 'r');
    } catch {
      return; // No log yet: nothing has happened.
    }
    try {
      const size = fs.fstatSync(fd).size;
      if (size < offset) offset = 0; // Replaced or truncated: start over.
      if (size === offset) return;
      const buf = Buffer.alloc(size - offset);
      fs.readSync(fd, buf, 0, buf.length, offset);
      offset = size;
      const parsed = parseEventLines(rest + buf.toString('utf8'));
      rest = parsed.rest;
      const out = parsed.events
        .filter((e) => e.seq > after)
        .map((e) => (values.json ? JSON.stringify(e) + '\n' : renderEvent(e)))
        .join('');
      if (out) process.stdout.write(out);
    } finally {
      fs.closeSync(fd);
    }
  };
  drain();
  if (!values.follow) return;
  // Polling, not fs.watch: it behaves the same on every platform and file system.
  setInterval(drain, 250);
  await new Promise(() => undefined);
}

// ---- guide ------------------------------------------------------------------------

/** Prints the guide's index or one topic. Text only: no server, no state. */
function cmdGuide(argv: string[]): void {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { json: { type: 'boolean' } },
  });
  if (positionals.length > 1) throw new UsageError('guide takes at most one topic');
  if (!positionals.length) {
    if (values.json) process.stdout.write(JSON.stringify({ schema: GUIDE_SCHEMA, topics: TOPICS.map(({ name, summary }) => ({ name, summary })) }) + '\n');
    else process.stdout.write(guideIndex());
    return;
  }
  const t = findTopic(positionals[0]);
  if (!t) fail(`no guide topic "${positionals[0]}". Topics: ${TOPICS.map((x) => x.name).join(', ')}`, EXIT.usage);
  if (values.json) process.stdout.write(JSON.stringify({ schema: GUIDE_SCHEMA, topic: t.name, summary: t.summary, text: t.text }) + '\n');
  else process.stdout.write(t.text);
}

// ---- lint and figures ---------------------------------------------------------------

/** Reads one HTML page for lint or figures. Usage problems exit 1 here: lint's 2 means warnings. */
function readPage(cmd: string, argv: string[]): { file: string; html: string; json: boolean } {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, options: { json: { type: 'boolean' } } });
  } catch (err) {
    fail(`${(err as Error).message}\nRun vivamark --help for usage.`);
  }
  const { values, positionals } = parsed;
  if (positionals.length !== 1) fail(`${cmd} takes exactly one .html file\nRun vivamark --help for usage.`);
  const file = path.resolve(positionals[0]);
  if (!/\.html?$/i.test(file)) fail(`${cmd} reads .html and .htm pages`);
  let html: string;
  try {
    html = fs.readFileSync(file, 'utf8');
  } catch (err) {
    fail(`cannot read ${file}: ${(err as Error).message}`);
  }
  return { file, html, json: !!values.json };
}

function cmdLint(argv: string[]): void {
  const { file, html, json } = readPage('lint', argv);
  const r = lintPage(html);
  process.stdout.write(json ? JSON.stringify({ ...r, file }) + '\n' : renderLint(r, file));
  process.exitCode = lintExitCode(r);
}

async function cmdRender(argv: string[]): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, options: { json: { type: 'boolean' }, dark: { type: 'boolean' }, out: { type: 'string' }, width: { type: 'string' } } });
  } catch (err) {
    fail(`${(err as Error).message}\nRun vivamark --help for usage.`);
  }
  const { values, positionals } = parsed;
  if (positionals.length !== 1) fail('render takes exactly one .html file\nRun vivamark --help for usage.');
  const file = path.resolve(positionals[0]);
  if (!/\.html?$/i.test(file)) fail('render reads .html and .htm pages');
  if (!fs.existsSync(file)) fail(`cannot read ${file}: no such file`);
  const width = values.width === undefined ? undefined : Number(values.width);
  if (width !== undefined && !(Number.isInteger(width) && width >= 200 && width <= 4000)) fail('--width takes a whole number of pixels from 200 to 4000');
  try {
    const r = await renderPage(file, { outDir: values.out, dark: !!values.dark, width });
    process.stdout.write(values.json ? JSON.stringify(r) + '\n' : renderRenderResult(r));
    process.exitCode = renderExitCode(r);
  } catch (err) {
    if (err instanceof RenderError) fail(err.message);
    throw err;
  }
}

function cmdFigures(argv: string[]): void {
  const { file, html, json } = readPage('figures', argv);
  const figures = pageFigures(html);
  process.stdout.write(json ? JSON.stringify({ schema: FIGURES_SCHEMA, file, figures }) + '\n' : renderFigures(figures, file));
}

/** open lints an HTML page and prints what it finds on stderr. It never stops the page from opening. */
function lintOnOpen(file: string): void {
  if (!/\.html?$/i.test(file)) return;
  let r: LintResult;
  try {
    r = lintPage(fs.readFileSync(file, 'utf8'));
  } catch {
    return;
  }
  if (!r.problems.length) return;
  const shown = r.problems.slice(0, 8).map((p) => `  ${p.severity} ${p.rule}${p.line ? ` (line ${p.line})` : ''}: ${p.message}`);
  if (r.problems.length > shown.length) shown.push(`  ... and ${r.problems.length - shown.length} more`);
  process.stderr.write(
    `lint: ${r.errors} error${r.errors === 1 ? '' : 's'}, ${r.warnings} warning${r.warnings === 1 ? '' : 's'} (the page opened anyway; details: vivamark lint ${quote(file)})\n${shown.join('\n')}\n`,
  );
}

// ---- stop -------------------------------------------------------------------------

async function cmdStop(): Promise<void> {
  const info = await runningDaemon();
  if (!info) {
    const named = readServerInfo();
    if (named && (await mayBeRunning(named))) fail(`the review server (pid ${named.pid}, port ${named.port}) is running but did not answer, so it was not stopped; stop it with kill ${named.pid}`);
    process.stdout.write('The review server is not running.\n');
    return;
  }
  await stopDaemon(info);
  process.stdout.write('Stopped the review server.\n');
}

// ---- main ---------------------------------------------------------------------------

export async function main(argv: string[]): Promise<void> {
  const [cmd, ...rest] = argv;
  if (cmd === '--version' || cmd === '-v' || cmd === 'version') {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') {
    process.stdout.write(HELP);
    return;
  }
  try {
    switch (cmd) {
      case 'open':
        return await cmdOpen(rest);
      case 'wait':
        return await cmdWait(rest);
      case 'reply':
        return await cmdReply(rest);
      case 'note':
        return await cmdNote(rest);
      case 'status':
        return await cmdStatus(rest);
      case 'end':
        return await cmdEnd(rest);
      case 'events':
        return await cmdEvents(rest);
      case 'versions':
        return await cmdVersions(rest);
      case 'show':
        return await cmdShow(rest);
      case 'guide':
        return cmdGuide(rest);
      case 'lint':
        return cmdLint(rest);
      case 'figures':
        return cmdFigures(rest);
      case 'render':
        return await cmdRender(rest);
      case 'stop':
        return await cmdStop();
      case '__daemon': {
        const { runDaemon } = await import('./daemon.js');
        return await runDaemon();
      }
      default:
        throw new UsageError(`unknown command: ${cmd}`);
    }
  } catch (err) {
    if (err instanceof UsageError || (err as { code?: string }).code?.startsWith('ERR_PARSE_ARGS')) {
      fail(`${(err as Error).message}\nRun vivamark --help for usage.`, EXIT.usage);
    }
    fail(err instanceof Error ? err.message : String(err));
  }
}

void main(process.argv.slice(2));
