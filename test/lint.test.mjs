// vivamark lint and vivamark figures: each rule against one clean fixture page
// and a mutation of it, the exit codes, the read-only promise, and the output
// shapes. Neither command needs a server or a state directory.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { FIGURES_SCHEMA, LINT_SCHEMA, TOPICS, lintPage, pageFigures } from '../dist/internal.js';
import { ROOT, makeWorld, runCli } from './helpers/harness.mjs';

const CLEAN = fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'figures.html'), 'utf8');
const NO_STATE = '/nonexistent/vivamark-lint-should-not-be-created';
const env = { ...process.env, VIVAMARK_STATE_DIR: NO_STATE };

let dir;
before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vivamark-lint-'));
});
after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** The clean page with each [from, to] replaced exactly once. */
function mutate(...edits) {
  let html = CLEAN;
  for (const [from, to] of edits) {
    assert.equal(html.split(from).length, 2, `the fixture holds exactly one ${from}`);
    html = html.replace(from, to);
  }
  return html;
}

function write(name, html) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, html);
  return file;
}

async function lint(name, html) {
  const r = await runCli(['lint', write(name, html), '--json'], env);
  return { code: r.code, stderr: r.stderr, ...JSON.parse(r.stdout) };
}

const rules = (r, severity) => r.problems.filter((p) => p.severity === severity).map((p) => p.rule);

test('a clean page: exit 0, no problems, the text form says clean', async () => {
  const r = await lint('clean.html', CLEAN);
  assert.equal(r.code, 0, JSON.stringify(r.problems));
  assert.equal(r.schema, LINT_SCHEMA);
  assert.deepEqual([r.errors, r.warnings, r.figures], [0, 0, 2]);
  const text = await runCli(['lint', path.join(dir, 'clean.html')], env);
  assert.equal(text.code, 0);
  assert.match(text.stdout, /: clean \(2 figures checked\)$/m);
  assert.equal(fs.existsSync(NO_STATE), false, 'no state directory');
});

test('an invented number is an error, with the line and the figure', async () => {
  const r = await lint('invented.html', mutate(['<text class="muted" x="80" y="120">', '<text x="1" y="1">73 orders</text><text class="muted" x="80" y="120">']));
  assert.equal(r.code, 1);
  const p = r.problems.find((x) => x.rule === 'number-provenance');
  assert.ok(p, JSON.stringify(r.problems));
  assert.equal(p.severity, 'error');
  assert.equal(p.figure, 'viz-orders');
  assert.match(p.message, /"73"/);
  assert.match(p.message, /#orders/);
  assert.equal(typeof p.line, 'number');
});

test('number provenance: thousands separators, single digits, axis ticks and worked sums', () => {
  // 1,240 in the figure matches 1240 in the text (the clean page relies on it).
  assert.match(CLEAN, />1,240 orders this month</);
  assert.match(CLEAN, /That makes 1240 orders/);
  // A single digit is not checked; an axis tick is a scale, not a claim.
  const ticks = lintPage(mutate(['<text x="480" y="150">200</text>', '<text x="480" y="150">200</text><text x="680" y="150">300</text>'], ['<text class="muted" x="80" y="120">', '<text>7 kinds</text><text class="muted" x="80" y="120">']));
  assert.equal(ticks.errors, 0, JSON.stringify(ticks.problems));
  // A total the text does not give is an error, unless the caption works it out.
  const total = mutate(['>1,240 orders this month</text>', '>355 orders in three days</text>']);
  assert.ok(rules(lintPage(total), 'error').includes('number-provenance'));
  const worked = total.replace('bar length on one scale.', 'bar length on one scale; 120 + 95 + 140 = 355.');
  assert.equal(lintPage(worked).errors, 0, JSON.stringify(lintPage(worked).problems));
  // Hash-like ids in the text do not vouch for a number (816e73d holds no 73).
  const hash = mutate(['>1,240 orders this month</text>', '>73 orders</text>'], ['so far.</p>', 'so far (commit 816e73d).</p>']);
  assert.ok(rules(lintPage(hash), 'error').includes('number-provenance'));
});

test('swapped bar values break proportionality, though every number is in the text', async () => {
  const r = await lint(
    'swapped.html',
    mutate(['<title>Monday: 120 orders</title>', '<title>Monday: 140 orders</title>'], ['<title>Wednesday: 140 orders</title>', '<title>Wednesday: 120 orders</title>']),
  );
  assert.equal(r.code, 1);
  assert.deepEqual(rules(r, 'error'), ['bar-proportion', 'bar-proportion']);
  assert.deepEqual(r.problems.map((p) => p.element).sort(), ['viz-orders-mon', 'viz-orders-wed']);
  // Within 2% passes: 240 for 120 against 239 drawn.
  assert.equal(lintPage(mutate(['width="240" height="16"', 'width="238" height="16"'])).errors, 0);
});

test('a missing aria-label or role is an error', async () => {
  const r = await lint('no-label.html', mutate([' aria-label="Orders per day: Wednesday busiest with 140, then Monday with 120 and Tuesday with 95."', '']));
  assert.equal(r.code, 1);
  assert.deepEqual(rules(r, 'error'), ['svg-label']);
  const role = lintPage(mutate(['<svg viewBox="0 0 640 100" role="img"', '<svg viewBox="0 0 640 100"']));
  assert.deepEqual(rules(role, 'error'), ['svg-role']);
});

test('a hex fill or stroke is an error, in an attribute or a style', async () => {
  const r = await lint('hex.html', mutate(['<rect class="bar" x="80" y="18"', '<rect class="bar" fill="#ff0000" x="80" y="18"']));
  assert.equal(r.code, 1);
  assert.deepEqual(rules(r, 'error'), ['no-hex-colour']);
  assert.deepEqual(rules(lintPage(mutate(['<path class="edge" d="M170 45 H230"/>', '<path class="edge" style="stroke: #333" d="M170 45 H230"/>'])), 'error'), ['no-hex-colour']);
});

test('a script is an error', async () => {
  const r = await lint('script.html', mutate(['</main>', '</main><script>document.title = "x";</script>']));
  assert.equal(r.code, 1);
  assert.deepEqual(rules(r, 'error'), ['no-script']);
});

test('an external URL is an error: src, link href, @import, url()', async () => {
  const r = await lint('external.html', mutate(['<p class="eyebrow">', '<img src="https://example.com/logo.png" alt=""><p class="eyebrow">']));
  assert.equal(r.code, 1);
  assert.deepEqual(rules(r, 'error'), ['no-external-url']);
  for (const [from, to] of [
    ['<style>', '<link rel="stylesheet" href="//cdn.example.com/a.css"><style>'],
    ['<style>', '<style>@import url("https://example.com/a.css");'],
    ['<style>', '<style>body { background: url(http://example.com/a.png); }'],
    ['<rect class="box" x="10"', '<image href="https://example.com/a.png"/><rect class="box" x="10"'],
  ]) {
    assert.deepEqual(rules(lintPage(mutate([from, to])), 'error'), ['no-external-url'], to);
  }
  // A link the reader may follow is not a request the page makes.
  assert.equal(lintPage(mutate(['<p class="eyebrow">', '<p><a href="https://example.com/">source</a></p><p class="eyebrow">'])).errors, 0);
});

test('a caption with a dangling link, no link, or not saying whose summary it is', async () => {
  const r = await lint('dangling.html', mutate(['<a href="#flow-steps">', '<a href="#flow-stepz">']));
  assert.equal(r.code, 1);
  const p = r.problems.find((x) => x.rule === 'caption-link');
  assert.ok(p);
  assert.match(p.message, /#flow-stepz, which is not on the page/);
  assert.equal(p.figure, 'viz-flow');
  const none = lintPage(mutate(['Author\'s summary of <a href="#flow-steps">the steps below</a>', 'Author\'s summary of the steps below']));
  assert.ok(rules(none, 'error').includes('caption-link'));
  const whose = lintPage(mutate(['Author\'s summary of <a href="#flow-steps">', 'From <a href="#flow-steps">']));
  assert.deepEqual(rules(whose, 'error'), ['caption-source']);
});

test('a duplicate part id is an error', () => {
  const r = lintPage(mutate(['<p id="orders-month">', '<p id="node-till">']));
  assert.ok(rules(r, 'error').includes('unique-id'), JSON.stringify(r.problems));
});

test('no coverage line where the section has more steps than the figure has parts: a warning, exit 2', async () => {
  const more = '<li id="step-pay">The customer pays at the till.</li>\n      <li id="step-collect">The customer collects the order.</li>\n    </ol>';
  const r = await lint('coverage.html', mutate(['</ol>', more]));
  assert.equal(r.code, 2);
  assert.deepEqual(rules(r, 'warning'), ['coverage-line']);
  assert.equal(r.errors, 0);
  assert.match(r.problems[0].message, /5 numbered items in #flow-steps and the figure has 3 parts/);
  // A coverage line answers it.
  const covered = mutate(['</ol>', more], ['who hands the order to whom.', 'who hands the order to whom. Shows 3 of the 5 steps; paying and collecting are in the text.']);
  assert.equal(lintPage(covered).problems.length, 0);
});

test('an arrow without data-from or data-to, or outside any group, is a warning', async () => {
  const r = await lint('edge.html', mutate([' data-from="node-customer" data-to="node-till"', ' data-to="node-till"']));
  assert.equal(r.code, 2);
  assert.deepEqual(rules(r, 'warning'), ['edge-ends']);
  assert.match(r.problems[0].message, /#edge-customer-places-till has no data-from/);
  const missing = lintPage(mutate(['data-to="node-kitchen"', 'data-to="node-oven"']));
  assert.match(missing.problems[0].message, /data-to="node-oven", which is not on the page/);
  const bare = lintPage(mutate(['<path class="edge" d="M390 45 H450"/><text class="muted" x="420" y="38" text-anchor="middle">sends</text>', '<text class="muted" x="420" y="38" text-anchor="middle">sends</text>'], ['</svg>\n      <figcaption class="viz-caption">Author\'s summary of <a href="#flow-steps">', '<path class="edge" d="M10 90 H600"/></svg>\n      <figcaption class="viz-caption">Author\'s summary of <a href="#flow-steps">']));
  assert.ok(bare.problems.some((p) => p.rule === 'edge-ends' && /outside any <g id>/.test(p.message)), JSON.stringify(bare.problems));
});

test('a label whose words are not in the section is a warning; shortened names pass', () => {
  const r = lintPage(mutate(['text-anchor="middle">kitchen</text>', 'text-anchor="middle">barista bar</text>']));
  assert.deepEqual(rules(r, 'warning'), ['label-words']);
  assert.match(r.problems[0].message, /"barista"/);
  assert.equal(lintPage(mutate(['text-anchor="middle">customer</text>', 'text-anchor="middle">cust.</text>'])).problems.length, 0);
});

test('errors and warnings together exit 1; the text form lists each with its rule', async () => {
  const file = write('both.html', mutate(['<a href="#flow-steps">', '<a href="#nowhere">'], [' data-from="node-till" data-to="node-kitchen"', '']));
  const r = await runCli(['lint', file], env);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /: 1 error, 2 warnings \(2 figures checked\)/);
  assert.match(r.stdout, /^ {2}error +caption-link +line \d+ #viz-flow: /m);
  assert.match(r.stdout, /^ {2}warning +edge-ends +/m);
});

test('lint never writes the page, and is fast', async () => {
  const file = write('readonly.html', mutate(['</main>', '</main><script></script>']));
  const hash = () => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const before = [hash(), fs.statSync(file).mtimeMs];
  await runCli(['lint', file], env);
  await runCli(['lint', file, '--json'], env);
  await runCli(['figures', file], env);
  assert.deepEqual([hash(), fs.statSync(file).mtimeMs], before);
  const report = fs.readFileSync(path.join(ROOT, 'examples', 'report.html'), 'utf8');
  lintPage(report);
  const t = performance.now();
  for (let i = 0; i < 10; i++) lintPage(report);
  assert.ok((performance.now() - t) / 10 < 100, 'well under 100 ms a page');
});

test('bad usage exits 1, since 2 means warnings', async () => {
  for (const args of [['lint'], ['lint', 'a.html', 'b.html'], ['lint', path.join(dir, 'missing.html')], ['lint', path.join(ROOT, 'examples', 'plan.md')], ['lint', '--frobnicate', 'x.html'], ['figures']]) {
    const r = await runCli(args, env);
    assert.equal(r.code, 1, args.join(' '));
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /^vivamark: /);
  }
});

test('the examples pass their own lint', async () => {
  for (const name of ['report.html', 'plan.html']) {
    const r = await runCli(['lint', path.join(ROOT, 'examples', name)], env);
    assert.equal(r.code, 0, r.stdout);
  }
});

test('figures prints each figure apart from the text it summarises', async () => {
  const file = write('figures.html', CLEAN);
  const r = await runCli(['figures', file, '--json'], env);
  assert.equal(r.code, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.schema, FIGURES_SCHEMA);
  assert.equal(j.file, file);
  assert.deepEqual(j.figures.map((f) => [f.id, f.index, f.kind, f.read_back]), [
    ['viz-orders', 1, 'bars', false],
    ['viz-flow', 2, 'relations', true],
  ]);
  const flow = j.figures[1];
  assert.deepEqual(Object.keys(flow).sort(), ['caption', 'html', 'id', 'index', 'kind', 'line', 'links', 'read_back', 'sections']);
  assert.ok(flow.html.startsWith('<figure class="viz card" id="viz-flow">') && flow.html.endsWith('</figure>'));
  assert.ok(CLEAN.includes(flow.html), 'the figure exactly as saved');
  assert.match(flow.html, /<svg[\s\S]*<figcaption class="viz-caption">/);
  assert.match(flow.caption, /^Author's summary of the steps below/);
  assert.deepEqual(flow.links, ['flow-steps']);
  assert.deepEqual(flow.sections, [
    {
      id: 'flow-steps',
      found: true,
      heading: '',
      text: '1. The customer places an order at the till.\n2. The till sends the order to the kitchen.\n3. The kitchen marks it ready within about 12 minutes.',
    },
  ]);
  // A table section reads as rows; the figure's own text is never part of the section.
  const orders = j.figures[0].sections;
  assert.equal(orders[0].text, 'Day | Orders\nMonday | 120\nTuesday | 95\nWednesday | 140');
  assert.deepEqual(pageFigures(CLEAN), j.figures);
  // The text form: the figure first, then each section, marked for the read-back.
  const t = await runCli(['figures', file], env);
  assert.equal(t.code, 0);
  const at = (s) => t.stdout.indexOf(s);
  assert.ok(at('=== figure 2 of 2: #viz-flow') > 0);
  assert.match(t.stdout, /#viz-flow \(line \d+\), relations; read back: yes/);
  assert.ok(at('--- the figure and its caption') > 0 && at('--- the figure and its caption') < at('<figure class="viz card" id="viz-orders">'));
  assert.ok(at('<figure class="viz card" id="viz-flow">') < at('--- section #flow-steps'));
  assert.ok(t.stdout.includes('--- section #flow-steps (give the reader this only after it has listed the claims)\n1. The customer places'));
});

test('a heading link stands for the heading and what follows it, up to the next heading of its level', () => {
  const html = `<main><h2 id="a">A</h2><p>Part one has 41 items.</p><h3 id="a-sub">Sub</h3><p>And 42 more.</p><h2 id="b">B</h2><p>Not this: 43.</p>
    <figure class="viz" id="viz-a"><svg role="img" aria-label="Forty-one, forty-two."><text>41</text><text>42</text><text>43</text></svg>
    <figcaption class="viz-caption">Author's summary of <a href="#a">A</a>.</figcaption></figure></main>`;
  const [f] = pageFigures(html);
  assert.equal(f.sections[0].heading, 'A');
  assert.equal(f.sections[0].text, 'A\nPart one has 41 items.\nSub\nAnd 42 more.');
  const r = lintPage(html);
  assert.deepEqual(r.problems.filter((p) => p.rule === 'number-provenance').map((p) => p.message.slice(0, 4)), ['"43"']);
});

test('open lints the page and prints what it finds, and opens it anyway', async () => {
  const world = makeWorld();
  try {
    const page = path.join(world.pageDir, 'figures.html');
    fs.writeFileSync(page, mutate(['<rect class="bar" x="80" y="18"', '<rect class="bar" fill="#ff0000" x="80" y="18"']));
    const r = await world.cli(['open', page, '--no-browser']);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /^Opened figures\.html for review/m);
    assert.match(r.stderr, /^lint: 1 error, 0 warnings \(the page opened anyway; details: vivamark lint .*figures\.html\)$/m);
    assert.match(r.stderr, /error no-hex-colour \(line \d+\)/);
    const json = await world.cli(['open', page, '--no-browser', '--json']);
    assert.equal(json.code, 0);
    assert.equal(JSON.parse(json.stdout).schema, 'vivamark.open/1', 'stdout stays the result');
    fs.writeFileSync(page, CLEAN);
    const clean = await world.cli(['open', page, '--no-browser']);
    assert.doesNotMatch(clean.stderr, /lint:/);
  } finally {
    await world.cleanup();
  }
});

test('the figures guide: the checklist, the coverage line, the map, the checks', () => {
  const g = TOPICS.find((t) => t.name === 'figures').text;
  assert.match(g, /adds nothing, distorts\s+nothing, and says what it left out/);
  for (let n = 1; n <= 14; n++) assert.match(g, new RegExp(`^ +${n}\\. `, 'm'), `rule ${n}`);
  assert.match(g, /Whenever the figure covers less than its\s+section, the caption ends with a coverage line/);
  assert.match(g, /data-from="node-api" data-to="node-db"/);
  for (const shape of ['Steps in order', 'Branching rules', 'Status or lifecycle', 'Actors exchanging', 'Components, and who', 'Before and after', 'Who can do what', 'A number per item', 'Durations or sizes', 'Counts through stages', 'Part of a whole', 'Dated events', 'Causes of one effect', 'Hierarchy, ownership', 'Cases, failure modes', 'Two-axis positioning', 'Ranked ideas', 'Cycle or feedback', 'Definitions, reasoning']) {
    assert.ok(g.includes(shape), shape);
  }
  assert.match(g, /vivamark lint <file>/);
  assert.match(g, /Exit 0 clean, 1 errors, 2 warnings/);
  assert.match(g, /vivamark figures <file>/);
  assert.match(g, /fresh subagent the figure and caption alone/);
  assert.match(g, /flow, sequence, state and architecture/);
  const report = TOPICS.find((t) => t.name === 'report').text;
  assert.match(report, /vivamark guide figures/);
  assert.match(report, /coverage line/);
  assert.match(TOPICS.find((t) => t.name === 'workflow').text, /vivamark lint <file>/);
});
