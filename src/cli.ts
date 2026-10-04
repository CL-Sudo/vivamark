// The agent's only interface. stdout carries the result; progress and
// heartbeats go to stderr, so an agent can read stdout as the answer.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { ApiError, ensureDaemon, request, runningDaemon, stopDaemon } from './client.js';
import { FEEDBACK_SCHEMA } from './schema.js';
import type { Anchor, Decision, Note, NoteKind } from './schema.js';
import { findSession } from './store.js';
import type { SessionRecord } from './store.js';
import { VERSION } from './version.js';

const EXIT = { ok: 0, error: 1, usage: 2, ended: 3, disconnected: 4, timeout: 5, approved: 6, dismissed: 7 } as const;

const HELP = `vivamark ${VERSION}: point at what you mean on a page; the agent gets each note tied to that spot.

Usage:
  vivamark open <file.html> [--label k=v]... [--no-browser] [--json]
      Start (or resume) a review of a saved HTML or Markdown (.md) file and open
      it in the browser. Markdown is rendered with raw HTML shown as text; each note
      carries the source lines it points at.
  vivamark wait <file|session> [--after <seq>] [--timeout <dur>] [--owner <name>]
                [-m <text> | --reply-file <file>] [--json]
      Block until the reviewer sends notes, then print them. Nothing is consumed:
      re-running wait returns the same notes until you pass --after <seq>.
      -m posts a reply first, then waits.
  vivamark reply <file|session> (-m <text> | --file <file|->) [--json]
  vivamark reply <file|session> --note <id> --status addressed|declined|question
                [-m <text>] [--json]
      Send a message to the reviewer's page. With --note, say what became of one
      note: addressed, declined, or a question back to the reviewer (needs -m).
      The reviewer's answer arrives as a new note with "answers": <id>. Only the
      reviewer resolves a note.
  vivamark stop
      Stop the background review server.

Exit codes for wait:
  0  notes, the reviewer requests changes      6  approved (or approved with notes)
  7  dismissed: the review closed with nothing 5  timeout
  1  error     130/143 interrupted, safe to re-run
  The JSON output's "decision" field says the same: request-changes, approve,
  approve-with-notes or dismiss.
Durations: 90s, 5m, 1h, or milliseconds.
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

function isWsl(): boolean {
  try {
    return /microsoft/i.test(fs.readFileSync('/proc/version', 'utf8'));
  } catch {
    return false;
  }
}

function has(cmd: string): boolean {
  return spawnSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' }).status === 0;
}

/** Opens the URL in the person's browser. A local process only; the URL is always printed as well. */
function openBrowser(url: string): void {
  let cmd: string;
  let args: string[];
  if (process.platform === 'darwin') [cmd, args] = ['open', [url]];
  else if (process.platform === 'win32') [cmd, args] = ['explorer.exe', [url]];
  else if (isWsl()) {
    if (has('wslview')) [cmd, args] = ['wslview', [url]];
    else [cmd, args] = ['powershell.exe', ['-NoProfile', '-Command', `Start-Process '${url}'`]];
  } else [cmd, args] = ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => process.stderr.write(`vivamark: could not start ${cmd}; open the URL yourself.\n`));
    child.unref();
  } catch {
    process.stderr.write(`vivamark: could not start ${cmd}; open the URL yourself.\n`);
  }
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
  if (!values['no-browser'] && process.env.VIVAMARK_NO_BROWSER !== '1') openBrowser(url);
  if (values.json) {
    process.stdout.write(
      JSON.stringify({ schema: 'vivamark.open/1', session: { id: res.id, file: res.file, status: 'open', labels: res.labels }, url, created: res.created, next }) + '\n',
    );
  } else {
    process.stdout.write(
      `${res.created ? 'Opened' : 'Resumed'} ${path.basename(res.file)} for review (session ${res.id}).\n` +
        `URL: ${url}\n` +
        `next: ${next}\n`,
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
  status: 'feedback' | 'pending';
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
    const tags = [n.intent, n.severity, nv.status && nv.status !== 'open' ? nv.status : '', nv.answers ? `answers ${nv.answers}` : '', nv.target_changed ? 'target changed' : '']
      .filter(Boolean)
      .join(', ');
    lines.push(`[${n.seq}] ${n.id}${tags ? ` (${tags})` : ''} on ${describeTarget(n.kind, a)}${describeLines(a)}`);
    for (const l of n.comment.split('\n')) lines.push(`    > ${l}`);
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

// ---- stop -------------------------------------------------------------------------

async function cmdStop(): Promise<void> {
  const info = await runningDaemon();
  if (!info) {
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
