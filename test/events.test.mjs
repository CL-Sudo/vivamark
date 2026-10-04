// The event log: one metadata-only line per thing that happened to a review,
// and `vivamark events` to read or follow it without the server.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import WebSocket from 'ws';
import { FIXTURE, api, makeWorld, sendNotes, startCli } from './helpers/harness.mjs';

let world;

before(() => {
  world = makeWorld();
  world.env.VIVAMARK_DISCONNECT_GRACE_MS = '1000';
});

after(async () => {
  await world.cleanup();
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Words that must never reach the event log: each part of a review someone wrote. */
const SECRET = {
  comment: 'SECRET-COMMENT-7d1f',
  quote: 'Director or Attestor',
  prefix: 'A Setup screen where a ',
  answer: 'SECRET-ANSWER-55aa',
  reply: 'SECRET-REPLY-c3e9',
  question: 'SECRET-QUESTION-0b42',
  agentNote: 'SECRET-AGENT-NOTE-91fe',
  endMessage: 'SECRET-END-MESSAGE-4c2d',
};

function readLog() {
  const file = path.join(world.stateDir, 'events.jsonl');
  return fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
}

async function openPage(name, args = []) {
  const file = path.join(world.pageDir, name);
  fs.writeFileSync(file, fs.readFileSync(FIXTURE, 'utf8'));
  const r = await world.cli(['open', file, '--no-browser', '--json', ...args]);
  if (r.code !== 0) throw new Error(`open failed (${r.code}): ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  return { file, out, port: world.server().port, id: out.session.id, token: world.session(out.session.id).token };
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

let s;

test('a whole review is logged, one metadata-only event per step, and no text ever appears', async () => {
  s = await openPage('events.html', ['--label', 'task=ev1']);
  const ws = await connectBrowser(s);

  const sent = await sendNotes(s, [
    { kind: 'text', comment: SECRET.comment, intent: 'change', anchor: { stable_id: 'summary', selector: '#summary', quote: SECRET.quote, prefix: SECRET.prefix, suffix: ' enrols their own certif' } },
  ]);
  assert.equal(sent.status, 201, sent.text);
  assert.equal((await world.cli(['reply', s.file, '-m', SECRET.reply])).code, 0);
  assert.equal((await world.cli(['reply', s.file, '--note', 'n_0001', '--status', 'question', '-m', SECRET.question])).code, 0);
  const answered = await sendNotes(s, [{ kind: 'page', comment: SECRET.answer, answers: 'n_0001', anchor: null }]);
  assert.equal(answered.status, 201, answered.text);
  const resolved = await api(s.port, 'POST', `/api/s/${s.id}/resolve`, { token: s.token, origin: true, body: { note: 'n_0001' } });
  assert.equal(resolved.status, 201, resolved.text);
  assert.equal((await world.cli(['note', 'add', s.file, '--target', '#step-2', '--text', SECRET.agentNote, '--source', 'lint'])).code, 0);
  ws.close();
  await sleep(1500); // Past the short "page gone" grace.
  assert.equal((await world.cli(['end', s.file, '-m', SECRET.endMessage])).code, 0);

  const raw = fs.readFileSync(path.join(world.stateDir, 'events.jsonl'), 'utf8');
  for (const [what, word] of Object.entries(SECRET)) assert.ok(!raw.includes(word), `the event log carries no ${what}`);
  assert.equal(fs.statSync(path.join(world.stateDir, 'events.jsonl')).mode & 0o777, 0o600);

  const events = readLog().filter((e) => e.session === s.id);
  assert.deepEqual(
    events.map((e) => e.type),
    [
      'session.opened',
      'browser.connected',
      'feedback.sent',
      'reply.posted',
      'reply.posted',
      'note.status',
      'feedback.sent',
      'note.status',
      'note.status',
      'agent-note.added',
      'browser.disconnected',
      'session.ended',
    ],
  );
  for (const e of events) {
    for (const key of ['seq', 'at', 'type', 'session', 'labels']) assert.ok(key in e, `${e.type} has ${key}`);
    assert.deepEqual(e.labels, { task: 'ev1' });
    assert.equal(e.file, fs.realpathSync(s.file));
  }
  const all = readLog();
  all.forEach((e, i) => assert.equal(e.seq, i + 1, 'seq counts up from 1 across the log'));

  const [, , fb1, , qReply, qStatus, fb2, ans, res, agentNote, , endEv] = events;
  assert.deepEqual({ d: fb1.decision, n: fb1.notes, seq: fb1.feedback_seq }, { d: 'request-changes', n: 1, seq: { from: 1, to: 1 } });
  assert.deepEqual({ note: qReply.note, status: qReply.status }, { note: 'n_0001', status: 'question' });
  assert.deepEqual({ note: qStatus.note, status: qStatus.status, by: qStatus.by }, { note: 'n_0001', status: 'question', by: 'agent' });
  assert.deepEqual(fb2.feedback_seq, { from: 2, to: 2 });
  assert.deepEqual({ status: ans.status, by: ans.by }, { status: 'answered', by: 'reviewer' });
  assert.deepEqual({ status: res.status, by: res.by }, { status: 'resolved', by: 'reviewer' });
  assert.deepEqual({ note: agentNote.note, source: agentNote.source }, { note: 'a_0001', source: 'lint' });
  assert.deepEqual({ by: endEv.by, has_message: endEv.has_message }, { by: 'agent', has_message: true });
});

test('a page reload is not logged as a disconnect', async () => {
  const p = await openPage('events-reload.html');
  const first = await connectBrowser(p);
  first.close();
  await sleep(100);
  const second = await connectBrowser(p);
  await sleep(1300);
  const types = readLog()
    .filter((e) => e.session === p.id)
    .map((e) => e.type);
  assert.deepEqual(types, ['session.opened', 'browser.connected']);
  second.close();
});

test('events prints the log after a seq, as text or JSON, without the server', async () => {
  const total = readLog().length;
  assert.equal((await world.cli(['stop'])).code, 0);
  const json = await world.cli(['events', '--json']);
  assert.equal(json.code, 0, json.stderr);
  const lines = json.stdout.trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.length, total);
  const later = await world.cli(['events', '--after', String(total - 2), '--json']);
  assert.deepEqual(
    later.stdout.trim().split('\n').map((l) => JSON.parse(l).seq),
    [total - 1, total],
  );
  const text = await world.cli(['events']);
  assert.match(text.stdout, /^\[1\]  \S+  session\.opened  s_[a-z0-9]+  events\.html  labels: task=ev1$/m);
  assert.match(text.stdout, /feedback\.sent .*decision=request-changes  notes=1  feedback_seq=\{"from":1,"to":1\}/);
  assert.ok(!fs.existsSync(path.join(world.stateDir, 'server.json')), 'events started no server');
  assert.equal((await world.cli(['events', 'some-file.html'])).code, 2);
});

test('events --follow streams new events until interrupted', async () => {
  const before = readLog().length;
  const follow = startCli(['events', '--follow', '--json', '--after', String(before)], world.env);
  const p = await openPage('events-follow.html', ['--label', 'task=follow']);
  let out = '';
  follow.child.stdout.on('data', (d) => (out += d));
  for (let i = 0; i < 40 && !out.includes('session.opened'); i++) await sleep(100);
  const got = out.trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(got[0].type, 'session.opened');
  assert.equal(got[0].session, p.id);
  assert.equal(got[0].seq, before + 1);
  assert.equal(follow.child.exitCode, null, 'still following');
  follow.child.kill('SIGINT');
  await follow.done;
});
