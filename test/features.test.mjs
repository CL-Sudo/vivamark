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

// ---- F4 ---------------------------------------------------------------------------

test('F4: intent and severity travel with each note, with the W3C motivation', async () => {
  const s = await openPage('f4.html');
  const r = await send(s, [
    { ...ELEMENT_NOTE, intent: 'change', severity: 'blocking' },
    { ...TEXT_NOTE, intent: 'question' },
    { kind: 'page', comment: 'The structure works.', intent: 'looks-good', severity: 'nit', anchor: null },
    { kind: 'page', comment: 'Plain note.', anchor: null },
  ]);
  assert.equal(r.status, 201, r.text);
  const w = await waitJson(s);
  const [a, b, c, d] = w.out.notes;
  assert.deepEqual([a.intent, a.severity, a.motivation], ['change', 'blocking', 'editing']);
  assert.deepEqual([b.intent, b.severity, b.motivation], ['question', undefined, 'questioning']);
  assert.deepEqual([c.intent, c.severity, c.motivation], ['looks-good', 'nit', 'assessing']);
  assert.deepEqual([d.intent, d.severity, d.motivation], [undefined, undefined, 'commenting']);
  const keys = Object.keys(a);
  assert.ok(keys.indexOf('comment') < keys.indexOf('intent') && keys.indexOf('severity') < keys.indexOf('anchor'), 'small fields before the anchor');
  const text = await world.cli(['wait', s.file]);
  assert.match(text.stdout, /n_0001 \(change, blocking\) on <li#step-2>/);

  for (const bad of [{ intent: 'shout' }, { severity: 'urgent' }, { intent: 3 }]) {
    const res = await send(s, [{ kind: 'page', comment: 'x', anchor: null, ...bad }]);
    assert.equal(res.status, 400, JSON.stringify(bad));
  }
});

// ---- F8 ---------------------------------------------------------------------------

test('F8: cell, control and point names are kept, checked and shown to the agent', async () => {
  const s = await openPage('f8.html');
  const cellNote = {
    kind: 'element',
    comment: 'Which person?',
    anchor: { stable_id: null, selector: '#rollout > tbody:nth-of-type(1) > tr:nth-of-type(1) > td:nth-of-type(2)', tag: 'td', text: 'Platform team', cell: { row: 'Shadow traffic', column: 'Owner' } },
  };
  const controlNote = {
    kind: 'element',
    comment: 'Confirm first.',
    anchor: { stable_id: null, selector: '#controls > button:nth-of-type(1)', tag: 'button', text: '✓', control: { role: 'button', name: 'Approve rollout' } },
  };
  const pointNote = {
    kind: 'element',
    comment: 'Spike?',
    anchor: { stable_id: 'chart', selector: '#chart', tag: 'svg', text: '', point: { x: 180.04, y: 30, width: 240, height: 120 } },
  };
  assert.equal((await send(s, [cellNote, controlNote, pointNote])).status, 201);
  const w = await waitJson(s);
  const [c, b, p] = w.out.notes;
  assert.deepEqual(c.anchor.cell, { row: 'Shadow traffic', column: 'Owner' });
  assert.deepEqual(b.anchor.control, { role: 'button', name: 'Approve rollout' });
  assert.deepEqual(p.anchor.point, { x: 180, y: 30, width: 240, height: 120 });
  assert.ok(c.anchor.source_line > 1);

  const text = await world.cli(['wait', s.file]);
  assert.match(text.stdout, /cell row "Shadow traffic", column "Owner" <td>/);
  assert.match(text.stdout, /button "Approve rollout"/);
  assert.match(text.stdout, /point: x 180, y 30 in a 240 x 120 box/);

  const bad = { ...pointNote, anchor: { ...pointNote.anchor, point: { x: -1, y: 0, width: 1, height: 1 } } };
  assert.equal((await send(s, [bad])).status, 400);
  const nan = { ...pointNote, anchor: { ...pointNote.anchor, point: { x: 'a' } } };
  assert.equal((await send(s, [nan])).status, 400);
});

// ---- F5 ---------------------------------------------------------------------------

const PLAN_MD = [
  '# Rollout plan', //                     1
  '',
  'Ship the **enrolment** screen', //      3
  'behind a feature flag.', //             4
  '',
  '- Step one: scaffold', //               6
  '- Step two: save handler', //           7
  '',
  '<script>alert(1)</script>', //          9
  '',
  '```sh', //                              11
  'npm test',
  '```', //                                13
  '',
].join('\n');

test('F5: a Markdown file is rendered without raw HTML, and the file is never written', async () => {
  const s = await openPage('plan.md', PLAN_MD);
  assert.equal(s.out.session.file, fs.realpathSync(s.file));
  const v = await view(s);
  const page = await api(s.port, 'GET', v.artifact_url);
  assert.equal(page.status, 200);
  assert.match(page.headers['content-type'], /text\/html/);
  assert.match(page.headers['content-security-policy'], /^sandbox allow-scripts/);
  assert.match(page.text, /<h1 data-vivamark-lines="1-1">Rollout plan<\/h1>/);
  assert.match(page.text, /<strong>enrolment<\/strong>/);
  assert.match(page.text, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(page.text, /<script>alert/);
  assert.equal(page.text.match(/<script src="\/_vivamark\/sdk\.js"/g).length, 1, 'only the one script tag');
  assert.equal(fs.readFileSync(s.file, 'utf8'), PLAN_MD);
});

test('F5: every note on a Markdown page carries lines: [first, last] from the source map', async () => {
  const s = await openPage('lines.md', PLAN_MD);
  const r = await send(s, [
    { kind: 'element', comment: 'Paragraph.', anchor: { stable_id: null, selector: 'body > p:nth-of-type(1)', tag: 'p', text: 'Ship the enrolment screen behind a feature flag.' } },
    { kind: 'element', comment: 'Item.', anchor: { stable_id: null, selector: 'body > ul:nth-of-type(1) > li:nth-of-type(2)', tag: 'li', text: 'Step two: save handler' } },
    { kind: 'text', comment: 'Which flag?', anchor: { stable_id: null, selector: 'body > p:nth-of-type(1)', quote: 'feature flag', prefix: 'behind a ', suffix: '.' } },
    { kind: 'element', comment: 'Code.', anchor: { stable_id: null, selector: 'body > pre:nth-of-type(1) > code:nth-of-type(1)', tag: 'code', text: 'npm test' } },
    { kind: 'element', comment: 'List.', anchor: { stable_id: null, selector: 'body > ul:nth-of-type(1)', tag: 'ul', text: 'Step one' } },
  ]);
  assert.equal(r.status, 201, r.text);
  const w = await waitJson(s);
  const lines = w.out.notes.map((n) => n.anchor.lines);
  assert.deepEqual(lines, [[3, 4], [7, 7], [4, 4], [11, 13], [6, 7]]);
  assert.deepEqual(w.out.notes.map((n) => n.anchor.source_line), [3, 7, 4, 11, 6]);
  const text = await world.cli(['wait', s.file]);
  assert.match(text.stdout, /n_0001 on <p> \(lines 3-4\)/);
  assert.match(text.stdout, /n_0002 on <li> \(line 7\)/);
});

test('F5: HTML notes carry lines too', async () => {
  const s = await openPage('f5.html');
  assert.equal((await send(s, [ELEMENT_NOTE, TEXT_NOTE])).status, 201);
  const w = await waitJson(s);
  const html = fs.readFileSync(s.file, 'utf8');
  const lineOf = (needle) => html.slice(0, html.indexOf(needle)).split('\n').length;
  assert.deepEqual(w.out.notes[0].anchor.lines, [lineOf('id="step-2"'), lineOf('id="step-2"')]);
  assert.deepEqual(w.out.notes[1].anchor.lines, [lineOf('Director or Attestor'), lineOf('Director or Attestor')]);
});
