// The first-version features F1-F8 through the CLI and the review UI's API.
// Each test opens its own page in one shared world, so a feature's state
// never leaks into another's.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { ELEMENT_NOTE, FIXTURE, TEXT_NOTE, api, makeWorld, sendNotes, startCli } from './helpers/harness.mjs';

let world;

before(() => {
  world = makeWorld();
});

after(async () => {
  await world.cleanup();
});

/** A fresh copy of `source` (the fixture by default) under its own name, opened for review. */
async function openPage(name, source = fs.readFileSync(FIXTURE, 'utf8')) {
  const file = path.join(world.pageDir, name);
  fs.writeFileSync(file, source);
  const r = await world.cli(['open', file, '--no-browser', '--json']);
  if (r.code !== 0) throw new Error(`open failed (${r.code}): ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  const { port } = world.server();
  const token = world.session(out.session.id).token;
  return { file, out, port, id: out.session.id, token };
}

const send = (s, notes, decision) =>
  api(s.port, 'POST', `/api/s/${s.id}/send`, { token: s.token, origin: true, body: decision === undefined ? { notes } : { notes, decision } });

const view = async (s) => (await api(s.port, 'GET', `/api/s/${s.id}`, { token: s.token })).json;

async function waitJson(s, args = []) {
  const r = await world.cli(['wait', s.file, '--json', ...args]);
  return { code: r.code, out: r.stdout ? JSON.parse(r.stdout) : undefined, stderr: r.stderr };
}

// ---- F1 ---------------------------------------------------------------------------

test('F1: a plain Send requests changes; wait says so and exits 0', async () => {
  const s = await openPage('f1-request.html');
  assert.equal((await send(s, [ELEMENT_NOTE])).status, 201);
  const w = await waitJson(s);
  assert.equal(w.code, 0, w.stderr);
  assert.equal(w.out.decision, 'request-changes');
  const text = await world.cli(['wait', s.file]);
  assert.match(text.stdout, /decision: request-changes/);
});

test('F1: approve, approve with notes and dismiss each reach wait with their own exit code', async () => {
  const s = await openPage('f1-decide.html');

  // Approve sends no notes, and still wakes a waiting agent.
  const waiting = startCli(['wait', s.file, '--json'], world.env);
  for (let i = 0; i < 50 && !waiting.stderr().includes('Waiting'); i++) await new Promise((r) => setTimeout(r, 100));
  const approved = await send(s, [], 'approve');
  assert.equal(approved.status, 201, approved.text);
  assert.deepEqual(approved.json.seq, { from: 1, to: 1 });
  const w1 = await waiting.done;
  assert.equal(w1.code, 6, w1.stderr);
  const o1 = JSON.parse(w1.stdout);
  assert.equal(o1.decision, 'approve');
  assert.deepEqual(o1.notes, []);
  assert.match(o1.next, /carry on/);

  const withNotes = await send(s, [TEXT_NOTE], 'approve-with-notes');
  assert.equal(withNotes.status, 201, withNotes.text);
  const w2 = await waitJson(s, ['--after', '1']);
  assert.equal(w2.code, 6);
  assert.equal(w2.out.decision, 'approve-with-notes');
  assert.equal(w2.out.notes.length, 1);
  assert.equal(w2.out.notes[0].comment, TEXT_NOTE.comment);

  assert.equal((await send(s, [], 'dismiss')).status, 201);
  const w3 = await waitJson(s, ['--after', '2']);
  assert.equal(w3.code, 7);
  assert.equal(w3.out.decision, 'dismiss');
  const text = await world.cli(['wait', s.file, '--after', '2']);
  assert.equal(text.code, 7);
  assert.match(text.stdout, /dismissed/);

  // When a range spans several Sends, the latest decides.
  const all = await waitJson(s, ['--after', '0']);
  assert.equal(all.out.decision, 'dismiss');
  assert.equal(all.out.notes.length, 1);

  const v = await view(s);
  assert.deepEqual(v.decisions.map((d) => d.decision), ['approve', 'approve-with-notes', 'dismiss']);
});

test('F1: a decision must match its notes', async () => {
  const s = await openPage('f1-bad.html');
  for (const [notes, decision] of [
    [[], undefined],
    [[], 'request-changes'],
    [[], 'approve-with-notes'],
    [[ELEMENT_NOTE], 'approve'],
    [[ELEMENT_NOTE], 'dismiss'],
    [[ELEMENT_NOTE], 'merge'],
  ]) {
    const r = await send(s, notes, decision);
    assert.equal(r.status, 400, `${decision} with ${notes.length} notes: ${r.text}`);
  }
  // A decision is a human action too: the review page's Origin is required.
  const fromCli = await api(s.port, 'POST', `/api/s/${s.id}/send`, { token: s.token, body: { notes: [], decision: 'approve' } });
  assert.equal(fromCli.status, 403);
  assert.equal((await view(s)).notes.length, 0);
});

test('F1: --help documents the decision exit codes', async () => {
  const h = await world.cli(['--help']);
  assert.match(h.stdout, /6\s+approved/);
  assert.match(h.stdout, /7\s+dismissed/);
});
