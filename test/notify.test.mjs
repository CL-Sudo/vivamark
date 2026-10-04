// The notify hook: a user-configured command the daemon runs once per event,
// with the event's JSON on stdin. Fire-and-forget, killed at a timeout, and
// only ever set by the user's own environment or config file.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { ELEMENT_NOTE, api, makeWorld, openSession, sendNotes } from './helpers/harness.mjs';

const worlds = [];
after(async () => {
  for (const w of worlds) await w.cleanup();
});

function world(env = {}) {
  const w = makeWorld();
  Object.assign(w.env, env);
  worlds.push(w);
  return w;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A command line that runs a small Node script with arguments, quoted for the shell. */
function nodeCmd(script, ...args) {
  return [process.execPath, script, ...args].map((a) => `'${a.replace(/'/g, `'\\''`)}'`).join(' ');
}

/** A notify command that appends the JSON it gets on stdin to `out`, one line per run. */
function captureScript(w) {
  const script = path.join(w.base, 'capture.cjs');
  fs.writeFileSync(
    script,
    `let s = ''; process.stdin.on('data', (d) => (s += d)); process.stdin.on('end', () => require('fs').appendFileSync(process.argv[2], JSON.stringify({ stdin: s }) + '\\n'));\n`,
  );
  return script;
}

function lines(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
}

const eventLog = (w) => lines(path.join(w.stateDir, 'events.jsonl'));

async function until(fn, ms = 10_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await sleep(100);
  }
  return fn();
}

const daemonLog = (w) => fs.readFileSync(path.join(w.stateDir, 'daemon.log'), 'utf8');

test('notify runs once per event with that event as JSON on stdin, and no note text', async () => {
  const w = world();
  const out = path.join(w.base, 'notified.jsonl');
  w.env.VIVAMARK_NOTIFY_CMD = nodeCmd(captureScript(w), out);
  const s = await openSession(w, ['--label', 'task=n1']);
  assert.equal((await sendNotes(s, [ELEMENT_NOTE])).status, 201);
  assert.equal((await w.cli(['reply', w.page, '-m', 'Split it as asked.'])).code, 0);
  assert.equal((await w.cli(['end', w.page])).code, 0);

  const events = eventLog(w);
  assert.deepEqual(
    events.map((e) => e.type),
    ['session.opened', 'feedback.sent', 'reply.posted', 'session.ended'],
  );
  assert.ok(await until(() => lines(out).length >= events.length), `ran for every event: ${JSON.stringify(lines(out))}`);
  await sleep(500); // Room for a wrong extra run to show up.
  const got = lines(out)
    .map((l) => JSON.parse(l.stdin))
    .sort((a, b) => a.seq - b.seq);
  assert.deepEqual(got, events, 'exactly one run per event, each with that event');
  const raw = fs.readFileSync(out, 'utf8');
  assert.ok(!raw.includes(ELEMENT_NOTE.comment) && !raw.includes('Split it as asked'), 'no note or reply text');
  assert.match(daemonLog(w), /notify command from VIVAMARK_NOTIFY_CMD/);
});

test('notify can come from the user config file instead', async () => {
  const w = world();
  const out = path.join(w.base, 'notified.jsonl');
  const cfgDir = path.join(w.env.XDG_CONFIG_HOME, 'vivamark');
  fs.mkdirSync(cfgDir, { recursive: true });
  fs.writeFileSync(path.join(cfgDir, 'config.json'), JSON.stringify({ notify_cmd: nodeCmd(captureScript(w), out) }));
  await openSession(w);
  assert.ok(await until(() => lines(out).length === 1));
  assert.equal(JSON.parse(lines(out)[0].stdin).type, 'session.opened');
});

test('a hanging notify command is killed at the timeout without stalling the review', async () => {
  const w = world({ VIVAMARK_NOTIFY_TIMEOUT_MS: '500' });
  const pids = path.join(w.base, 'pids');
  fs.mkdirSync(pids);
  const script = path.join(w.base, 'hang.cjs');
  fs.writeFileSync(script, `require('fs').writeFileSync(require('path').join(process.argv[2], String(process.pid)), ''); setInterval(() => {}, 1000);\n`);
  w.env.VIVAMARK_NOTIFY_CMD = nodeCmd(script, pids);

  const started = Date.now();
  const s = await openSession(w);
  for (let i = 0; i < 3; i++) assert.equal((await sendNotes(s, [ELEMENT_NOTE])).status, 201);
  const r = await w.cli(['wait', w.page, '--json']);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).seq, { from: 1, to: 3 });
  const view = await api(s.port, 'GET', `/api/s/${s.id}`, { token: s.token });
  assert.equal(view.status, 200);
  assert.ok(Date.now() - started < 5_000, `the review went on while the hook hung (${Date.now() - started} ms)`);

  assert.ok(await until(() => fs.readdirSync(pids).length === 4), 'one run per event');
  assert.ok(await until(() => (daemonLog(w).match(/killed the notify command/g) ?? []).length === 4), daemonLog(w));
  for (const pid of fs.readdirSync(pids).map(Number)) {
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, `notify process ${pid} was killed`);
  }
});

test('a failing notify command is logged and ignored', async () => {
  const w = world({ VIVAMARK_NOTIFY_CMD: `${process.execPath} -e "console.error('hook broke'); process.exit(3)"` });
  const s = await openSession(w);
  assert.equal((await sendNotes(s, [ELEMENT_NOTE])).status, 201);
  assert.equal((await w.cli(['wait', w.page])).code, 0);
  assert.ok(await until(() => /notify command for event 2 \(feedback\.sent\) exited with 3: hook broke/.test(daemonLog(w))), daemonLog(w));
  assert.equal((daemonLog(w).match(/exited with 3/g) ?? []).length, 2, 'never retried');
});

test('nothing runs when notify is not configured, and no request or page can set it', async () => {
  const w = world();
  const marker = path.join(w.base, 'ran');
  const cmd = `touch '${marker}'`;
  // A page that names a command, labels that look like config, and request fields the server does not know.
  fs.writeFileSync(w.page, fs.readFileSync(w.page, 'utf8').replace('</body>', `<p data-notify-cmd="${cmd}">VIVAMARK_NOTIFY_CMD=${cmd}</p></body>`));
  const s = await openSession(w, ['--label', `notify_cmd=${cmd}`, '--label', `VIVAMARK_NOTIFY_CMD=${cmd}`]);
  const opened = await api(s.port, 'POST', '/api/sessions', { token: s.adminToken, body: { file: w.page, notify_cmd: cmd, env: { VIVAMARK_NOTIFY_CMD: cmd } } });
  assert.equal(opened.status, 200);
  assert.equal((await sendNotes(s, [{ ...ELEMENT_NOTE, notify_cmd: cmd }])).status, 201);
  assert.equal((await w.cli(['end', w.page])).code, 0);
  await sleep(1000);
  assert.ok(eventLog(w).length >= 3, 'events happened');
  assert.equal(fs.existsSync(marker), false, 'no command ran');
  assert.match(daemonLog(w), /no notify command configured/);
});
