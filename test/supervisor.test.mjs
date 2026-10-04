// What a supervisor sees without taking anything from the agent (status), how
// a review ends (end, End review on the page, a page that went away).

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import WebSocket from 'ws';
import { ELEMENT_NOTE, FIXTURE, TEXT_NOTE, api, makeWorld, sendNotes, startCli } from './helpers/harness.mjs';

const GRACE_MS = 1500;
let world;

before(() => {
  world = makeWorld();
  // A short disconnect grace, so the tests need not sit out the 10 s default.
  world.env.VIVAMARK_DISCONNECT_GRACE_MS = String(GRACE_MS);
});

after(async () => {
  await world.cleanup();
});

/** A fresh copy of the fixture under its own name, opened for review. */
async function openPage(name, args = []) {
  const file = path.join(world.pageDir, name);
  fs.writeFileSync(file, fs.readFileSync(FIXTURE, 'utf8'));
  const r = await world.cli(['open', file, '--no-browser', '--json', ...args]);
  if (r.code !== 0) throw new Error(`open failed (${r.code}): ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  const { port } = world.server();
  return { file, out, port, id: out.session.id, token: world.session(out.session.id).token };
}

async function status(args) {
  const started = Date.now();
  const r = await world.cli(['status', ...args, '--json']);
  return { code: r.code, out: r.stdout ? JSON.parse(r.stdout) : undefined, stderr: r.stderr, ms: Date.now() - started };
}

/** A stand-in for the review page's live socket; `events` collects what the server pushes. */
function connectBrowser(s) {
  const ws = new WebSocket(`ws://127.0.0.1:${s.port}/api/s/${s.id}/events`, ['vivamark.v1', `vivamark.token.${s.token}`], {
    headers: { Origin: `http://127.0.0.1:${s.port}` },
  });
  ws.events = [];
  ws.on('message', (d) => ws.events.push(JSON.parse(String(d))));
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Starts a wait and returns once its long poll has reached the server. */
async function startWait(args) {
  const w = startCli(['wait', ...args], world.env);
  // Observed, not timed: the server itself says the agent is listening.
  for (let i = 0; i < 100; i++) {
    if (w.child.exitCode !== null) throw new Error(`wait exited early (${w.child.exitCode}): ${w.stderr()}`);
    if ((await status([args[0]])).out?.agent === 'listening') return w;
    await sleep(100);
  }
  await w.stop();
  throw new Error(`wait never reached the server: ${w.stderr()}`);
}

test('status reports one session at once, and never moves a cursor', async () => {
  const s = await openPage('status-one.html', ['--label', 'task=t1']);
  const empty = await status([s.file]);
  assert.equal(empty.code, 0, empty.stderr);
  assert.equal(empty.out.schema, 'vivamark.status/1');
  assert.deepEqual(empty.out.session, { id: s.id, file: fs.realpathSync(s.file), status: 'open', labels: { task: 't1' } });
  assert.equal(empty.out.pending, 0);
  assert.equal(empty.out.last_seq, 0);
  assert.equal(empty.out.decision, null);
  assert.equal(empty.out.turn, 'reviewer');
  assert.equal(empty.out.reviewer, 'never-opened');
  assert.ok(empty.ms < 10_000, `status returned in ${empty.ms} ms`);

  assert.equal((await sendNotes(s, [ELEMENT_NOTE, TEXT_NOTE])).status, 201);
  const cursorsBefore = world.session(s.id).cursors;
  const st = await status([s.id]);
  assert.equal(st.code, 0, st.stderr);
  assert.equal(st.out.pending, 2);
  assert.equal(st.out.last_seq, 2);
  assert.equal(st.out.decision, 'request-changes');
  assert.equal(st.out.turn, 'agent');
  assert.equal(st.out.owner, 'agent');
  assert.deepEqual(world.session(s.id).cursors, cursorsBefore, 'status moved no cursor');

  // The agent still gets every note.
  const w = await world.cli(['wait', s.file, '--json']);
  assert.equal(w.code, 0, w.stderr);
  assert.deepEqual(JSON.parse(w.stdout).seq, { from: 1, to: 2 });

  // Once the agent acknowledges, its count drops; another owner's does not.
  assert.equal((await world.cli(['wait', s.file, '--after', '2', '--timeout', '200ms'])).code, 5);
  assert.equal((await status([s.file])).out.pending, 0);
  const sup = await status([s.file, '--owner', 'supervisor']);
  assert.equal(sup.out.pending, 2);
  assert.equal(sup.out.cursor, 0);

  const text = await world.cli(['status', s.file]);
  assert.equal(text.code, 0);
  assert.match(text.stdout, /status-one\.html \(session s_[a-z0-9]+\): open/);
  assert.match(text.stdout, /pending: 0 notes after seq 2 \(owner agent\); last seq 2, last decision request-changes/);
  assert.match(text.stdout, /labels: task=t1/);
});

test('status shows whether the reviewer has the page open', async () => {
  const s = await openPage('status-presence.html');
  const ws = await connectBrowser(s);
  assert.equal((await status([s.file])).out.reviewer, 'connected');
  ws.close();
  await new Promise((r) => setTimeout(r, 300));
  assert.equal((await status([s.file])).out.reviewer, 'disconnected');
});

test('status with no argument lists every session', async () => {
  const a = await openPage('status-list-a.html', ['--label', 'task=a']);
  const b = await openPage('status-list-b.html');
  const all = await status([]);
  assert.equal(all.code, 0, all.stderr);
  const ids = all.out.sessions.map((e) => e.session.id);
  assert.ok(ids.includes(a.id) && ids.includes(b.id));
  const ea = all.out.sessions.find((e) => e.session.id === a.id);
  assert.deepEqual(ea.session.labels, { task: 'a' });
  for (const key of ['pending', 'last_seq', 'decision', 'turn', 'reviewer']) assert.ok(key in ea, `list entries carry ${key}`);
});

test('status on a session that does not exist exits non-zero and says so', async () => {
  const r = await world.cli(['status', 's_nosuchid']);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /no review session for s_nosuchid/);
  const f = await world.cli(['status', path.join(world.pageDir, 'never-opened.html')]);
  assert.notEqual(f.code, 0);
  assert.match(f.stderr, /no review session/);
});

// ---- end ----------------------------------------------------------------------------

test('end: the agent ends a review; wait returns ended (3), the page is told, sends are refused', async () => {
  const s = await openPage('end-agent.html', ['--label', 'task=e1']);
  const ws = await connectBrowser(s);
  const waiting = await startWait([s.file, '--json']);

  const r = await world.cli(['end', s.file, '-m', 'Merged, thanks for the review.']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Ended the review of end-agent\.html/);

  const w = await waiting.done;
  assert.equal(w.code, 3, w.stderr);
  const out = JSON.parse(w.stdout);
  assert.equal(out.status, 'ended');
  assert.equal(out.session.status, 'ended');
  assert.equal(out.ended.by, 'agent');
  assert.equal(out.ended.message, 'Merged, thanks for the review.');
  assert.match(out.next, /vivamark open/);

  for (let i = 0; i < 30 && !ws.events.some((e) => e.type === 'ended'); i++) await sleep(50);
  const ev = ws.events.find((e) => e.type === 'ended');
  assert.ok(ev, `the page was told; got ${JSON.stringify(ws.events)}`);
  assert.equal(ev.ended.message, 'Merged, thanks for the review.');
  const view = (await api(s.port, 'GET', `/api/s/${s.id}`, { token: s.token })).json;
  assert.equal(view.status, 'ended');
  assert.equal(view.ended.by, 'agent');
  ws.close();

  const refused = await sendNotes(s, [ELEMENT_NOTE]);
  assert.equal(refused.status, 409);
  assert.match(refused.json.error, /ended/);
  assert.equal((await world.cli(['reply', s.file, '-m', 'one more thing'])).code, 1);

  // wait, again, keeps saying so, by file or by id; and text output says it too.
  const again = await world.cli(['wait', s.id]);
  assert.equal(again.code, 3);
  assert.match(again.stdout, /has ended \(by the agent/);
  assert.match(again.stdout, /> Merged, thanks for the review\./);
  assert.equal((await status([s.file])).out.session.status, 'ended');
  const twice = await world.cli(['end', s.file]);
  assert.equal(twice.code, 0);
  assert.match(twice.stdout, /already ended/);

  // A later open starts a fresh review instead of reviving the ended one.
  const reopened = await world.cli(['open', s.file, '--no-browser', '--json']);
  assert.equal(reopened.code, 0, reopened.stderr);
  const fresh = JSON.parse(reopened.stdout);
  assert.equal(fresh.created, true);
  assert.notEqual(fresh.session.id, s.id);
  assert.equal((await status([s.file])).out.session.id, fresh.session.id);
  assert.equal((await status([s.id])).out.session.status, 'ended');
  assert.equal((await world.cli(['wait', s.file, '--timeout', '300ms'])).code, 5, 'wait on the file follows the new review');
  assert.equal((await world.cli(['wait', s.id])).code, 3, 'the old one stays ended');
});

test('end: the reviewer ends a review from the page; a waiting agent gets ended (3)', async () => {
  const s = await openPage('end-reviewer.html');
  const ws = await connectBrowser(s);
  const waiting = await startWait([s.file, '--json']);
  const r = await api(s.port, 'POST', `/api/s/${s.id}/end`, { token: s.token, origin: true, body: {} });
  assert.equal(r.status, 200, r.text);
  const w = await waiting.done;
  assert.equal(w.code, 3, w.stderr);
  assert.equal(JSON.parse(w.stdout).ended.by, 'reviewer');
  ws.close();
});

test('end: notes sent before the end are still delivered first', async () => {
  const s = await openPage('end-after-notes.html');
  assert.equal((await sendNotes(s, [TEXT_NOTE])).status, 201);
  assert.equal((await api(s.port, 'POST', `/api/s/${s.id}/end`, { token: s.token, origin: true, body: {} })).status, 200);
  const first = await world.cli(['wait', s.file, '--json']);
  assert.equal(first.code, 0, first.stderr);
  assert.equal(JSON.parse(first.stdout).notes[0].comment, TEXT_NOTE.comment);
  assert.equal((await world.cli(['wait', s.file, '--after', '1'])).code, 3);
});

// ---- disconnected -------------------------------------------------------------------

test('disconnected: a page never opened keeps the agent waiting past the grace', async () => {
  const s = await openPage('never-opened.html');
  assert.equal((await status([s.file])).out.reviewer, 'never-opened');
  const waiting = await startWait([s.file, '--json']);
  await sleep(GRACE_MS * 2.5);
  assert.equal(waiting.child.exitCode, null, `still waiting: ${waiting.stderr()}`);
  assert.equal((await sendNotes(s, [ELEMENT_NOTE])).status, 201);
  const w = await waiting.done;
  assert.equal(w.code, 0, w.stderr);
  assert.deepEqual(JSON.parse(w.stdout).seq, { from: 1, to: 1 });
});

test('disconnected: once a page has connected and gone past the grace, wait returns 4 and consumes nothing', async () => {
  const s = await openPage('gone.html');
  const ws = await connectBrowser(s);
  ws.close();
  await sleep(200);
  assert.equal((await status([s.file])).out.reviewer, 'disconnected');
  const started = Date.now();
  const r = await world.cli(['wait', s.file, '--json']);
  const took = Date.now() - started;
  assert.equal(r.code, 4, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'disconnected');
  assert.equal(out.session.status, 'open');
  assert.ok(took >= GRACE_MS - 100 && took < GRACE_MS + 8_000, `returned after ${took} ms`);
  assert.deepEqual(world.session(s.id).cursors, {}, 'no cursor moved');
  assert.ok(world.session(s.id).browser_seen, 'the first connection is remembered');
  const text = await world.cli(['wait', s.file]);
  assert.equal(text.code, 4);
  assert.match(text.stdout, /No review page is open/);

  // It is remembered across a server restart.
  assert.equal((await world.cli(['stop'])).code, 0);
  assert.equal((await world.cli(['wait', s.file])).code, 4);

  // Nothing consumed: notes sent later all arrive.
  const port = world.server().port;
  assert.equal((await sendNotes({ ...s, port }, [ELEMENT_NOTE])).status, 201);
  const w = await world.cli(['wait', s.file, '--json']);
  assert.equal(w.code, 0);
  assert.deepEqual(JSON.parse(w.stdout).seq, { from: 1, to: 1 });
});

test('disconnected: a page that comes back within the grace keeps the agent waiting', async () => {
  const s = await openPage('flaky.html');
  let ws = await connectBrowser(s);
  const waiting = await startWait([s.file, '--json']);
  ws.close();
  await sleep(GRACE_MS / 2);
  ws = await connectBrowser(s);
  // Well past the grace in total, with the page connected again.
  await sleep(GRACE_MS * 2);
  assert.equal(waiting.child.exitCode, null, `still waiting: ${waiting.stderr()}`);
  assert.equal((await sendNotes(s, [ELEMENT_NOTE])).status, 201);
  const w = await waiting.done;
  assert.equal(w.code, 0, w.stderr);
  ws.close();
});
