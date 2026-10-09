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

// ---- paint, size and superseded terms ----------------------------------------------

const fixture = (name) => fs.readFileSync(path.join(ROOT, 'test', 'fixtures', name), 'utf8');

test('a shape nothing fills is painted black: an error, unless a class, an attribute or the page CSS fills it', () => {
  const svgEnd = '</svg>\n      <figcaption class="viz-caption">Author\'s summary of <a href="#orders">';
  const page = (shapes, css = '') => mutate([svgEnd, `${shapes}${svgEnd}`], ['</style>', `${css}</style>`]);
  const unfilled = (r) => r.problems.filter((p) => p.rule === 'unfilled-shape');
  // A bracket drawn as a .gridline path, a bare polygon and a bare rect: each painted black.
  const bad = lintPage(page('<path class="gridline" d="M10 10 H18 V90 H10"/><polygon points="1,1 9,1 5,9"/><rect x="1" y="1" width="9" height="9"/>'));
  assert.deepEqual(unfilled(bad).map((p) => p.severity), ['error', 'error', 'error'], JSON.stringify(bad.problems));
  assert.match(unfilled(bad)[0].message, /<path class="gridline"> is painted solid black: \.gridline is for <line> only.*\.edge path/);
  assert.equal(unfilled(bad)[0].figure, 'viz-orders');
  // Filled by the guide's classes, by an attribute or style (on it or a group), or by the page's own CSS; drawn only by reference.
  const ok = lintPage(
    page(
      '<path class="edge" d="M1 1 H9"/><path fill="none" d="M1 1 H9"/><g fill="none"><path d="M1 1 H9"/></g><path style="fill: none" d="M1 1 H9"/>' +
        '<circle class="blob" cx="5" cy="5" r="3"/><defs><marker id="m"><path d="M0 0 L9 5 L0 9 z"/></marker></defs><line class="gridline" x1="1" y1="1" x2="1" y2="9"/>',
      '.viz svg .blob { fill: var(--accent); }',
    ),
  );
  assert.deepEqual(unfilled(ok), [], JSON.stringify(ok.problems));
  // Once the page's CSS fills .gridline (as the design CSS now does), a gridline path is not black.
  const fixedCss = lintPage(page('<path class="gridline" d="M10 10 H18 V90 H10"/>', '.viz svg .gridline { fill: none; stroke: var(--line); }'));
  assert.deepEqual(unfilled(fixedCss), []);
});

test('text that likely runs out of its box or the viewBox is a warning, estimated from its length', () => {
  const svgEnd = '</svg>\n      <figcaption class="viz-caption">Author\'s summary of <a href="#orders">';
  const page = (parts) => mutate([svgEnd, `${parts}${svgEnd}`]);
  const over = (r) => r.problems.filter((p) => p.rule === 'text-overflow');
  // 12px at about 0.55 em a character: 40 characters are about 264 wide.
  const forty = 'Wednesday orders Wednesday orders Wedne';
  const r = lintPage(
    page(
      `<g id="viz-box"><title>Wednesday</title><rect class="box" x="10" y="100" width="200" height="40"/><text x="110" y="124" text-anchor="middle">${forty}</text></g>` +
        `<text x="500" y="140">${forty}</text><text x="630" y="150" text-anchor="end">${forty}</text>`,
    ),
  );
  const ws = over(r);
  assert.equal(ws.length, 2, JSON.stringify(r.problems));
  assert.ok(ws.every((p) => p.severity === 'warning'));
  assert.match(ws[0].message, /is about \d+ wide; its box is 200 \(x 10\.\.210\)/);
  assert.equal(ws[0].element, 'viz-box');
  assert.match(ws[1].message, /about \d+ wide and runs to about x=\d+, past the viewBox \(0\.\.640\)/);
  // Under a transform it is not estimated; each <tspan> line is measured on its own.
  const skipped = lintPage(page(`<g transform="translate(600 0)"><text x="0" y="140">${forty}</text></g><text x="600" y="140" transform="rotate(90)">${forty}</text>`));
  assert.deepEqual(over(skipped), []);
  const spans = lintPage(page(`<text y="140"><tspan x="500">Wednesday</tspan><tspan x="500" dy="14">${forty}</tspan></text>`));
  assert.equal(over(spans).length, 1);
  assert.match(over(spans)[0].message, /^"Wednesday orders/);
});

test('a term a decision supersedes, still in the lede, a card or a figure, is a warning; marked or inside the decision it is not', () => {
  const html = fixture('amend-after.html');
  const terms = (h) => lintPage(h).problems.filter((p) => p.rule === 'superseded-term');
  // The decision itself and the .superseded block say "JSON files" and pass.
  assert.match(html, /class="superseded"[^>]*><p>The store kept drafts in JSON files/);
  assert.deepEqual(terms(html), []);
  const stale = (from, to) => {
    assert.equal(html.split(from).length, 2, from);
    return terms(html.replace(from, to));
  };
  assert.match(stale('one SQLite database by the store', 'JSON files by the store')[0].message, /^the lede #lede still says "JSON files", which #decided-storage supersedes.*vivamark guide amend/);
  const card = stale('<section id="design">', '<div class="card" id="glance-store"><p>Drafts live in json   files.</p></div><section id="design">');
  assert.match(card[0].message, /^the card #glance-store still says "JSON files"/, 'any case, any spacing');
  const fig = stale('>to one SQLite database</text>', '>to JSON files</text>');
  assert.equal(fig[0].figure, 'viz-store');
  assert.equal(fig[0].element, 'node-store');
  // Whole words only, several terms split on ";".
  assert.deepEqual(stale('one SQLite database by the store', 'JSON filesystem by the store'), []);
  const two = terms(html.replace('data-vivamark-supersedes="JSON files"', 'data-vivamark-supersedes="JSON files; one per draft"').replace('>to one SQLite database</text>', '>one per draft</text>'));
  assert.deepEqual(two.map((p) => p.message.match(/"([^"]+)", which/)[1]), ['one per draft']);
});

test('a page amended badly fails as the guide says; amended as vivamark guide amend says, it is clean', async () => {
  const before = await lint('amend-before.html', fixture('amend-before.html'));
  assert.equal(before.code, 1);
  assert.deepEqual(rules(before, 'error'), ['unfilled-shape']);
  const over = before.problems.filter((p) => p.rule === 'text-overflow');
  assert.deepEqual(over.map((p) => /^"([^"]+)"/.exec(p.message)[1]), ['writes each draft to one of the JSON files on save', 'keeps drafts in JSON files, one per draft']);
  const terms = before.problems.filter((p) => p.rule === 'superseded-term');
  assert.ok(terms.some((p) => p.element === 'lede'), 'the lede');
  assert.ok(terms.some((p) => p.figure === 'viz-store' && p.element === 'node-store'), 'the figure');
  const after = await lint('amend-after.html', fixture('amend-after.html'));
  assert.equal(after.code, 0, JSON.stringify(after.problems));
});

// ---- what pins each new condition (each case fails under the mutation named) -------

const SVG_END = '</svg>\n      <figcaption class="viz-caption">Author\'s summary of <a href="#orders">';
const withParts = (parts, css = '') => mutate([SVG_END, `${parts}${SVG_END}`], ['</style>', `${css}</style>`]);
const ruleOf = (r, rule) => r.problems.filter((p) => p.rule === rule);

test('text-overflow: text that leaves its box on the right only is caught (not just text overflowing both sides)', () => {
  // Starts inside the box, ends past its right edge and well inside the viewBox: only the box's right check sees it.
  const r = lintPage(withParts('<g id="viz-right"><title>Wednesday</title><rect class="box" x="10" y="100" width="200" height="40"/><text x="20" y="124">Wednesday orders Wednesday ord</text></g>'));
  const w = ruleOf(r, 'text-overflow');
  assert.equal(w.length, 1, JSON.stringify(r.problems));
  assert.match(w[0].message, /its box is 200 \(x 10\.\.210\)/);
});

test('text-overflow: the width is 0.55 em a character, pinned from both sides', () => {
  // 17 characters at 12px: 0.55 gives 112.2. Over a 100-wide box (needs k > 0.49); inside a 115-wide one (needs k <= 0.56).
  const label = 'Wednesday orders.';
  assert.equal(label.length, 17);
  const inBox = (w) => ruleOf(lintPage(withParts(`<g id="viz-k"><title>Wednesday</title><rect class="box" x="10" y="100" width="${w}" height="40"/><text x="10" y="124">${label}</text></g>`)), 'text-overflow');
  assert.equal(inBox(100).length, 1, 'over a 100-wide box');
  assert.match(inBox(100)[0].message, /is about 112 wide/);
  assert.equal(inBox(115).length, 0, 'inside a 115-wide box');
});

test('superseded-term: a .superseded card or figure group holding the term is exempt; the same without the class is not', () => {
  const html = fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'amend-after.html'), 'utf8');
  const terms = (from, to) => {
    assert.equal(html.split(from).length, 2, from);
    return lintPage(html.replace(from, to)).problems.filter((p) => p.rule === 'superseded-term');
  };
  const card = (cls) => terms('<section id="design">', `<div class="${cls}" id="glance-old"><p>Drafts lived in JSON files.</p></div><section id="design">`);
  assert.equal(card('card').length, 1, 'a card saying it');
  assert.deepEqual(card('card superseded'), [], 'a .card.superseded saying it');
  const group = (cls) => terms('</svg>', `<g${cls ? ` class="${cls}"` : ''}><text class="muted" x="8" y="190">JSON files</text></g></svg>`);
  assert.equal(group('').length, 1, 'a figure group saying it');
  assert.deepEqual(group('superseded'), [], 'a .superseded figure group saying it');
});

test('unfilled-shape counts every way the page sets fill: element, descendant and id selectors, the <svg> and its groups', () => {
  // The idioms of a valid page that drew no black shape (found by an independent check against a real render).
  const page =
    '<!doctype html><html><head><meta charset="utf-8"><title>t</title><style>:root{--a:#123}\n' +
    '.viz svg rect.el { } .viz svg rect { fill: var(--a); } .viz svg .legend circle { fill: var(--a); } #viz-c path { fill: none; stroke: var(--a); }' +
    ' figure.plain svg g:not(.x) polygon { fill: none; } .viz svg g[id]:hover ellipse { fill: none; }</style></head><body><main>\n' +
    '<figure class="viz" id="viz-a"><svg viewBox="0 0 640 100" role="img" aria-label="a"><rect x="1" y="1" width="9" height="9"/><g class="legend"><circle cx="30" cy="5" r="4"/></g></svg><figcaption class="viz-caption">Author\'s summary of <a href="#s">S</a>.</figcaption></figure>\n' +
    '<figure class="viz" id="viz-b"><svg viewBox="0 0 640 100" role="img" aria-label="b" fill="none"><path d="M1 1 H90 V50" stroke="currentColor"/></svg><figcaption class="viz-caption">Author\'s summary of <a href="#s">S</a>.</figcaption></figure>\n' +
    '<figure class="viz" id="viz-c"><svg viewBox="0 0 640 100" role="img" aria-label="c"><path d="M1 1 H90 V50"/></svg><figcaption class="viz-caption">Author\'s summary of <a href="#s">S</a>.</figcaption></figure>\n' +
    '<figure class="viz plain" id="viz-d"><svg viewBox="0 0 640 100" role="img" aria-label="d"><g fill="none"><path d="M1 1 H9"/></g><g><polygon points="1,1 9,1 5,9"/></g>LATER</svg><figcaption class="viz-caption">Author\'s summary of <a href="#s">S</a>.</figcaption></figure>\n' +
    '<section id="s"><h2>S</h2><p>a</p></section></main></body></html>';
  const unfilled = (h) => lintPage(h).problems.filter((p) => p.rule === 'unfilled-shape');
  assert.deepEqual(unfilled(page.replace('LATER', '')), [], 'every shape here is filled');
  // Still caught: an id rule reaches only its own figure, a :hover rule is not the drawing at rest.
  const caught = unfilled(page.replace('LATER', '<g id="viz-d-more"><title>more</title><path d="M1 1 H9"/><ellipse cx="5" cy="5" rx="3" ry="2"/></g>'));
  assert.deepEqual(caught.map((p) => p.message.slice(0, 10)), ['<path> is ', '<ellipse> '], JSON.stringify(caught));
  assert.ok(caught.every((p) => p.severity === 'error' && p.figure === 'viz-d'));
});

test('text-overflow: a label below its box is not judged against the box; .strong text runs 7% wider', () => {
  // 30 characters, about 198 wide, under a 100-wide box: a label of the drawing, not of the box.
  const below = lintPage(withParts('<g id="viz-below"><title>Wednesday</title><rect class="box" x="10" y="100" width="100" height="40"/><text x="10" y="160">Wednesday orders Wednesday ord</text></g>'));
  assert.deepEqual(ruleOf(below, 'text-overflow'), [], JSON.stringify(below.problems));
  // 16 characters: about 106 plain, about 113 as .strong; the box is 110.
  const label = 'Wednesday orders';
  const inBox = (cls) => ruleOf(lintPage(withParts(`<g id="viz-strong"><title>Wednesday</title><rect class="box" x="10" y="100" width="110" height="40"/><text${cls} x="10" y="124">${label}</text></g>`)), 'text-overflow');
  assert.equal(inBox('').length, 0, 'plain text fits');
  assert.equal(inBox(' class="strong"').length, 1, '.strong text does not');
  assert.match(inBox(' class="strong"')[0].message, /is about 113 wide/);
});

test('superseded-term: an aria-label counts; a figure inside the decision (a before and after) does not', () => {
  const html = fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'amend-after.html'), 'utf8');
  const terms = (h) => lintPage(h).problems.filter((p) => p.rule === 'superseded-term');
  const aria = terms(html.replace('which keeps them in one SQLite database.">', 'which keeps them in JSON files.">'));
  assert.equal(aria.length, 1, JSON.stringify(aria));
  assert.match(aria[0].message, /^#viz-store's aria-label still says "JSON files"/);
  const before =
    '<figure class="viz card" id="viz-before"><svg viewBox="0 0 640 60" role="img" aria-label="Before: drafts in JSON files.">' +
    '<g id="before-store"><title>Before: JSON files</title><text x="8" y="30">JSON files</text></g></svg>' +
    '<figcaption class="viz-caption">Author\'s summary of <a href="#decided-heading">the decision</a>: before. Shows the old store only.</figcaption></figure>';
  const inside = html.replace('<p id="decided-text">', `${before}<p id="decided-text">`);
  assert.notEqual(inside, html);
  assert.deepEqual(terms(inside), [], 'inside the decision: its own before and after');
});
