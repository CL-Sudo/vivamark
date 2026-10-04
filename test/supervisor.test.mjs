// What a supervisor sees without taking anything from the agent: status.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import WebSocket from 'ws';
import { ELEMENT_NOTE, FIXTURE, TEXT_NOTE, makeWorld, sendNotes } from './helpers/harness.mjs';

let world;

before(() => {
  world = makeWorld();
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

function connectBrowser(s) {
  const ws = new WebSocket(`ws://127.0.0.1:${s.port}/api/s/${s.id}/events`, ['vivamark.v1', `vivamark.token.${s.token}`], {
    headers: { Origin: `http://127.0.0.1:${s.port}` },
  });
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
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
  assert.equal(empty.out.reviewer, 'disconnected');
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
