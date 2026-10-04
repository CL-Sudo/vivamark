// The core loop through the CLI and the review UI's API: open, a note sent
// from the review page, wait, the non-destructive log with cursors, reply.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, before, test } from 'node:test';
import WebSocket from 'ws';
import { ELEMENT_NOTE, TEXT_NOTE, api, makeWorld, openSession, sendNotes, startCli } from './helpers/harness.mjs';

let world;
let s;
let original;

before(async () => {
  world = makeWorld();
  original = fs.readFileSync(world.page);
  s = await openSession(world, ['--label', 'task=core-loop']);
});

after(async () => {
  await world.cleanup();
});

function lineOf(needle) {
  const text = fs.readFileSync(world.page, 'utf8');
  return text.slice(0, text.indexOf(needle)).split('\n').length;
}

test('open creates a session, prints a tokened URL, and resumes on a second open', async () => {
  assert.equal(s.out.schema, 'vivamark.open/1');
  assert.match(s.id, /^s_[a-z0-9]{8}$/);
  assert.equal(s.out.session.file, fs.realpathSync(world.page));
  assert.deepEqual(s.out.session.labels, { task: 'core-loop' });
  assert.match(s.out.url, new RegExp(`^http://127\\.0\\.0\\.1:${s.port}/s/${s.id}#t=[0-9a-f]{64}$`));
  assert.equal(s.out.url.split('#t=')[1], s.token, 'the token travels in the fragment');
  assert.equal(s.out.created, true);

  const again = await world.cli(['open', world.page, '--no-browser', '--json']);
  assert.equal(again.code, 0, again.stderr);
  const out = JSON.parse(again.stdout);
  assert.equal(out.session.id, s.id);
  assert.equal(out.created, false);

  const mode = (p) => fs.statSync(p).mode & 0o777;
  assert.equal(mode(world.stateDir), 0o700);
  assert.equal(mode(`${world.stateDir}/sessions/${s.id}.json`), 0o600);
  assert.equal(mode(`${world.stateDir}/server.json`), 0o600);
});

test('open refuses Markdown and missing files', async () => {
  const md = `${world.pageDir}/plan.md`;
  fs.writeFileSync(md, '# plan\n');
  const r = await world.cli(['open', md, '--no-browser']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Markdown/);
  const missing = await world.cli(['open', `${world.pageDir}/nope.html`, '--no-browser']);
  assert.equal(missing.code, 1);
});

test('nothing reaches wait before Send', async () => {
  const r = await world.cli(['wait', world.page, '--timeout', '1s']);
  assert.equal(r.code, 5, r.stderr);
  assert.match(r.stdout, /No notes yet/);
});

test('a note sent from the review page reaches a waiting agent with its anchor', async () => {
  const waiting = startCli(['wait', world.page, '--json'], world.env);
  // Let the agent's long poll arrive first, so this proves a wake-up, not a read.
  for (let i = 0; i < 50 && !waiting.stderr().includes('Waiting'); i++) await new Promise((r) => setTimeout(r, 100));
  const view = await api(s.port, 'GET', `/api/s/${s.id}`, { token: s.token });
  assert.equal(view.json.agent, 'listening');

  const sent = await sendNotes(s, [ELEMENT_NOTE, TEXT_NOTE]);
  assert.equal(sent.status, 201, sent.text);
  assert.deepEqual(sent.json.seq, { from: 1, to: 2 });

  const r = await waiting.done;
  assert.equal(r.code, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(Object.keys(out).slice(0, 6), ['schema', 'session', 'status', 'seq', 'notes', 'next']);
  assert.equal(out.schema, 'vivamark.feedback/1');
  assert.equal(out.status, 'feedback');
  assert.deepEqual(out.seq, { from: 1, to: 2 });
  assert.deepEqual(out.session.labels, { task: 'core-loop' });
  const [el, tx] = out.notes;

  assert.equal(el.id, 'n_0001');
  assert.equal(el.kind, 'element');
  assert.equal(el.comment, ELEMENT_NOTE.comment);
  assert.equal(el.source, 'reviewer');
  assert.ok(Object.keys(el).indexOf('comment') < Object.keys(el).indexOf('anchor'), "the reviewer's words come first");
  assert.equal(el.anchor.stable_id, 'step-2');
  assert.equal(el.anchor.selector, '#step-2');
  assert.equal(el.anchor.source_line, lineOf('id="step-2"'));

  assert.equal(tx.kind, 'text');
  assert.equal(tx.anchor.quote, 'Director or Attestor');
  assert.equal(tx.anchor.prefix, TEXT_NOTE.anchor.prefix);
  assert.equal(tx.anchor.suffix, TEXT_NOTE.anchor.suffix);
  assert.equal(tx.anchor.source_line, lineOf('Director or Attestor'));
  assert.match(out.next, /--after 2/);
});

test('wait is non-destructive: re-running returns the same notes until --after skips them', async () => {
  const again = await world.cli(['wait', world.page, '--json']);
  assert.equal(again.code, 0, again.stderr);
  const out = JSON.parse(again.stdout);
  assert.deepEqual(out.seq, { from: 1, to: 2 });
  assert.deepEqual(out.notes.map((n) => n.id), ['n_0001', 'n_0002']);

  const text = await world.cli(['wait', s.id]);
  assert.equal(text.code, 0);
  assert.match(text.stdout, /2 notes on .*plan\.html \(seq 1-2/);
  assert.match(text.stdout, /> Split this step/);
  assert.match(text.stdout, /Director or Attestor/);

  const skipped = await world.cli(['wait', world.page, '--after', '2', '--timeout', '1s', '--json']);
  assert.equal(skipped.code, 5, skipped.stderr);
  assert.equal(JSON.parse(skipped.stdout).status, 'timeout');

  // --after is stored as the agent's cursor, so a plain wait now waits for new notes.
  const plain = await world.cli(['wait', world.page, '--timeout', '1s']);
  assert.equal(plain.code, 5);

  // Another reader has its own cursor and still sees everything.
  const supervisor = await world.cli(['wait', world.page, '--owner', 'supervisor', '--json']);
  assert.equal(supervisor.code, 0);
  assert.deepEqual(JSON.parse(supervisor.stdout).seq, { from: 1, to: 2 });

  // Replaying from an earlier point is always possible.
  const replay = await world.cli(['wait', world.page, '--after', '1', '--json']);
  assert.equal(replay.code, 0);
  assert.deepEqual(JSON.parse(replay.stdout).notes.map((n) => n.id), ['n_0002']);

  const third = await sendNotes(s, [{ kind: 'page', comment: 'Overall this reads well.', anchor: null }]);
  assert.equal(third.status, 201);
  const next = await world.cli(['wait', world.page, '--after', '2', '--json']);
  assert.equal(next.code, 0);
  const n = JSON.parse(next.stdout);
  assert.deepEqual(n.seq, { from: 3, to: 3 });
  assert.equal(n.notes[0].kind, 'page');
  assert.equal(n.notes[0].anchor, null);
});

test('reply posts a message that the review UI receives', async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${s.port}/api/s/${s.id}/events`, ['vivamark.v1', `vivamark.token.${s.token}`], {
    headers: { Origin: `http://127.0.0.1:${s.port}` },
  });
  const events = [];
  ws.on('message', (d) => events.push(JSON.parse(String(d))));
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });

  const r = await world.cli(['reply', world.page, '-m', 'Split step 2 into **two** steps.', '--json']);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).seq, 1);

  for (let i = 0; i < 50 && !events.some((e) => e.type === 'reply'); i++) await new Promise((r2) => setTimeout(r2, 50));
  const ev = events.find((e) => e.type === 'reply');
  assert.ok(ev, `reply event received; got ${JSON.stringify(events)}`);
  assert.equal(ev.reply.text, 'Split step 2 into **two** steps.');
  assert.match(ev.reply.html, /<strong>two<\/strong>/);
  assert.equal(events[0].type, 'hello');
  ws.close();

  // The reply is kept, so a reloaded review page shows it too.
  const view = await api(s.port, 'GET', `/api/s/${s.id}`, { token: s.token });
  assert.equal(view.json.replies.length, 1);

  // wait -m replies and waits in one step.
  const combined = await world.cli(['wait', world.page, '--after', '3', '-m', 'Done, have another look.', '--timeout', '1s']);
  assert.equal(combined.code, 5);
  const view2 = await api(s.port, 'GET', `/api/s/${s.id}`, { token: s.token });
  assert.equal(view2.json.replies[1].text, 'Done, have another look.');

  const empty = await world.cli(['reply', world.page]);
  assert.equal(empty.code, 2);
});

test('the log survives a daemon restart', async () => {
  const stop = await world.cli(['stop']);
  assert.equal(stop.code, 0);
  assert.match(stop.stdout, /Stopped/);
  const r = await world.cli(['wait', world.page, '--after', '0', '--json']);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).seq, { from: 1, to: 3 });
});

test('vivamark never writes to the reviewed file', () => {
  assert.deepEqual(fs.readFileSync(world.page), original);
});
