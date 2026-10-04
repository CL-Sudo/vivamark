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

// ---- F3 ---------------------------------------------------------------------------

const STEP3_NOTE = {
  kind: 'element',
  comment: 'Who verifies?',
  anchor: { stable_id: 'step-3', selector: '#step-3', tag: 'li', text: 'Deploy and rollback SQL, browser verification.' },
};
const RISKS_NOTE = {
  kind: 'element',
  comment: 'Say how.',
  anchor: { stable_id: null, selector: 'body > p:nth-of-type(2)', tag: 'p', text: 'The save handler touches the certificate store; a failed enrolment must leave no partial rows.' },
};

/** The agent's edit: step 2 reworded, step 3 deleted, a paragraph inserted before the risks. */
function agentEdit(html) {
  return html
    .replace('Applet scaffold, save handler and container page.', 'Applet scaffold and container page.')
    .replace(/\s*<li id="step-3">.*<\/li>/, '')
    .replace('<h2>Risks</h2>', '<h2>Risks</h2>\n  <p>Rollback is covered in step 4.</p>');
}

test('F3: after an edit each note is anchored, moved or orphaned, in wait output', async () => {
  const s = await openPage('f3.html');
  assert.equal((await send(s, [ELEMENT_NOTE, STEP3_NOTE, RISKS_NOTE, TEXT_NOTE])).status, 201);
  const before = await waitJson(s);
  assert.deepEqual(before.out.notes.map((n) => n.anchor.state), ['anchored', 'anchored', 'anchored', 'anchored']);
  assert.deepEqual(before.out.orphaned, []);

  fs.writeFileSync(s.file, agentEdit(fs.readFileSync(s.file, 'utf8')));
  const w = await waitJson(s);
  const [step2, step3, risks, quote] = w.out.notes;
  assert.equal(step2.anchor.state, 'anchored');
  assert.equal(step3.anchor.state, 'orphaned');
  assert.equal(step3.anchor.current, undefined);
  assert.equal(risks.anchor.state, 'moved');
  assert.equal(risks.anchor.current.selector, 'body > p:nth-of-type(3)');
  const edited = fs.readFileSync(s.file, 'utf8');
  assert.equal(risks.anchor.current.source_line, edited.slice(0, edited.indexOf('The save handler touches')).split('\n').length);
  assert.equal(quote.anchor.state, 'anchored');
  assert.deepEqual(w.out.orphaned, [step3.id]);

  // Orphaned notes in an earlier range are still reported to a reader that has moved on.
  assert.equal((await send(s, [{ kind: 'page', comment: 'Next round.', anchor: null }])).status, 201);
  const later = await waitJson(s, ['--after', String(before.out.seq.to)]);
  assert.equal(later.out.notes.length, 1);
  assert.deepEqual(later.out.orphaned, [step3.id]);

  const text = await world.cli(['wait', s.file, '--after', '0']);
  assert.match(text.stdout, /target: gone from the file \(orphaned\)/);
  assert.match(text.stdout, /target: moved to body > p:nth-of-type\(3\)/);
  assert.match(text.stdout, /orphaned \(target gone\): n_0002/);

  // The review page gets the same states.
  const v = await view(s);
  assert.deepEqual(v.notes.map((e) => e.note.anchor?.state ?? null), ['anchored', 'orphaned', 'moved', 'anchored', null]);
});

// ---- F2 ---------------------------------------------------------------------------

test('F2: a snapshot at each Send; after an edit, what changed and which targets changed', async () => {
  const s = await openPage('f2.html');
  assert.equal((await send(s, [ELEMENT_NOTE, RISKS_NOTE, TEXT_NOTE])).status, 201);
  const snapDir = path.join(world.stateDir, 'snapshots', s.id);
  const snaps = fs.readdirSync(snapDir);
  assert.equal(snaps.length, 1);
  assert.equal(fs.statSync(path.join(snapDir, snaps[0])).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(path.join(snapDir, snaps[0]), 'utf8'), fs.readFileSync(s.file, 'utf8'), 'the file as it was at Send');

  const unchanged = await view(s);
  assert.deepEqual([unchanged.changes.inserts, unchanged.changes.removals], [[], []]);
  assert.deepEqual(unchanged.notes.map((e) => e.note.target_changed), [false, false, false]);

  fs.writeFileSync(s.file, agentEdit(fs.readFileSync(s.file, 'utf8')));
  const v = await view(s);
  assert.ok(v.changes.removals.some((r) => r.text.includes('save handler')), JSON.stringify(v.changes));
  assert.ok(v.changes.removals.some((r) => r.text.includes('Deploy and rollback SQL')));
  assert.ok(v.changes.inserts.some((i) => i.text.includes('Rollback is covered in step 4.')));
  assert.equal(v.changes.batch, unchanged.notes[0].batch);
  // The step the agent reworded is marked; the moved paragraph and the untouched quote are not.
  assert.deepEqual(v.notes.map((e) => e.note.target_changed), [true, false, false]);
  const w = await waitJson(s);
  assert.deepEqual(w.out.notes.map((n) => n.target_changed), [true, false, false]);

  // A second Send takes a new snapshot; changes are now counted from it.
  assert.equal((await send(s, [], 'approve')).status, 201);
  assert.equal(fs.readdirSync(snapDir).length, 2);
  const after = await view(s);
  assert.deepEqual([after.changes.inserts, after.changes.removals], [[], []]);
});

// ---- F6 ---------------------------------------------------------------------------

test('F6: per-note status from the agent, answers from the reviewer, and whose turn it is', async () => {
  const s = await openPage('f6.html');
  const turn = async () => (await view(s)).turn;
  const statuses = async () => (await view(s)).notes.map((e) => e.note.status);
  assert.equal(await turn(), 'reviewer', 'nothing sent yet');

  assert.equal((await send(s, [ELEMENT_NOTE, TEXT_NOTE])).status, 201);
  let w = await waitJson(s);
  assert.equal(w.out.turn, 'agent');
  assert.deepEqual(w.out.notes.map((n) => n.status), ['open', 'open']);

  const done = await world.cli(['reply', s.file, '--note', 'n_0001', '--status', 'addressed', '--json']);
  assert.equal(done.code, 0, done.stderr);
  assert.equal(JSON.parse(done.stdout).status, 'addressed');
  assert.deepEqual(await statuses(), ['addressed', 'open']);
  assert.equal(await turn(), 'agent', 'one note still waits on the agent');

  const ask = await world.cli(['reply', s.file, '--note', 'n_0002', '--status', 'question', '-m', 'Should a Viewer enrol too?']);
  assert.equal(ask.code, 0, ask.stderr);
  assert.match(ask.stdout, /Marked n_0002 question/);
  assert.deepEqual(await statuses(), ['addressed', 'question']);
  assert.equal(await turn(), 'reviewer');
  const v = await view(s);
  assert.deepEqual(
    v.replies.map((r) => [r.note, r.status, r.text]),
    [
      ['n_0001', 'addressed', ''],
      ['n_0002', 'question', 'Should a Viewer enrol too?'],
    ],
  );

  // The reviewer answers: a new note linked to the question.
  const answer = { kind: TEXT_NOTE.kind, comment: 'No, Directors and Attestors only.', anchor: TEXT_NOTE.anchor, answers: 'n_0002' };
  assert.equal((await send(s, [answer])).status, 201);
  w = await waitJson(s, ['--after', '2']);
  assert.equal(w.out.notes[0].answers, 'n_0002');
  assert.equal(w.out.notes[0].motivation, 'commenting');
  assert.equal(w.out.turn, 'agent');
  assert.deepEqual(await statuses(), ['addressed', 'answered', 'open']);
  assert.match((await world.cli(['wait', s.file, '--after', '2'])).stdout, /n_0003 \(answers n_0002\)/);

  // A general reply after the answer hands the turn back.
  assert.equal((await world.cli(['reply', s.file, '-m', 'Understood, restricted it.'])).code, 0);
  assert.equal(await turn(), 'reviewer');

  // Only the reviewer resolves, from the review page.
  const resolve = (origin, body) => api(s.port, 'POST', `/api/s/${s.id}/resolve`, { token: s.token, origin, body });
  assert.equal((await resolve(false, { note: 'n_0001' })).status, 403, 'not from the CLI');
  const r = await resolve(true, { note: 'n_0001' });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.status, 'resolved');
  assert.deepEqual(await statuses(), ['resolved', 'answered', 'open']);
  assert.equal((await resolve(true, { note: 'n_0001', resolved: false })).status, 201);
  assert.deepEqual((await statuses())[0], 'addressed', 'reopened');
  assert.equal((await resolve(true, { note: 'n_9999' })).status, 400);

  const agentResolve = await world.cli(['reply', s.file, '--note', 'n_0001', '--status', 'resolved']);
  assert.equal(agentResolve.code, 2);
  assert.match(agentResolve.stderr, /only the reviewer resolves/);
  const raw = await api(s.port, 'POST', `/api/s/${s.id}/replies`, { token: s.token, body: { note: 'n_0001', status: 'resolved' } });
  assert.equal(raw.status, 400, 'the server refuses it too');
  const unknown = await world.cli(['reply', s.file, '--note', 'n_0042', '--status', 'addressed']);
  assert.equal(unknown.code, 1);
  assert.match(unknown.stderr, /no note n_0042/);
  assert.equal((await world.cli(['reply', s.file, '--note', 'n_0001', '--status', 'question'])).code, 2, 'a question needs its text');
  assert.equal((await send(s, [{ ...answer, answers: 'n_0077' }])).status, 400, 'answers must name a note of this review');
});
