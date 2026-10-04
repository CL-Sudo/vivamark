// Re-anchoring (F3) as a pure function: each note's anchor re-resolved
// against an edited file, by stable id, then quote with prefix and suffix,
// then selector, to anchored, moved or orphaned.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { cssEscape, cssPath, loadDoc, locate, resolveSelector } from '../dist/internal.js';
import { FIXTURE } from './helpers/harness.mjs';

const original = fs.readFileSync(FIXTURE, 'utf8');
const html = (s) => loadDoc('html', s);

const step2 = { stable_id: 'step-2', selector: '#step-2', tag: 'li', text: 'Applet scaffold, save handler and container page.' };
const risks = { stable_id: null, selector: 'body > p:nth-of-type(2)', tag: 'p', text: 'The save handler touches the certificate store; a failed enrolment must leave no partial rows.' };
const quote = { stable_id: 'summary', selector: '#summary', quote: 'Director or Attestor', prefix: 'A Setup screen where a ', suffix: ' enrols their own certif' };

test('an unchanged file leaves every anchor anchored', () => {
  const doc = html(original);
  for (const a of [step2, risks, quote]) assert.equal(locate(doc, a).state, 'anchored', JSON.stringify(a));
  assert.equal(locate(doc, quote).place.selector, '#summary');
});

test('a stable id finds its element wherever it went', () => {
  const doc = html(original.replace(/(<li id="step-2">.*<\/li>\n)/, '').replace('<ol id="plan">', `<ol id="plan">\n    <li id="step-2">Applet scaffold, save handler and container page.</li>`));
  const r = locate(doc, step2);
  assert.equal(r.state, 'anchored', 'same id, same selector');
  const wrapped = html(original.replace('<li id="step-2">', '<li><span id="step-2">').replace('container page.</li>', 'container page.</span></li>'));
  const w = locate(wrapped, { ...step2, selector: '#plan > li:nth-of-type(2)', stable_id: 'step-2', tag: 'span' });
  assert.equal(w.state, 'moved');
  assert.equal(w.place.selector, '#step-2');
});

test('an element without an id is found again by its text, and marked moved', () => {
  const doc = html(original.replace('<h2>Risks</h2>', '<h2>Risks</h2>\n  <p>A new paragraph before the old one.</p>'));
  const r = locate(doc, risks);
  assert.equal(r.state, 'moved');
  assert.equal(r.place.selector, 'body > p:nth-of-type(3)');
  assert.equal(r.place.source_line, doc.source.slice(0, doc.source.indexOf('The save handler touches')).split('\n').length);
});

test('an edited element at the same place stays anchored; a different one there is not taken for it', () => {
  const edited = html(original.replace('a failed enrolment must leave no partial rows', 'a failed enrolment must roll back every partial row'));
  assert.equal(locate(edited, risks).state, 'anchored');
  // The paragraph is deleted and the next one of the same tag slides into its selector.
  const replaced = html(original.replace(/<p>The save handler[^<]*<\/p>/, '<p>Completely unrelated closing remarks about lunch.</p>'));
  assert.equal(locate(replaced, risks).state, 'orphaned');
});

test('a deleted target is orphaned, never pinned to a guess', () => {
  const doc = html(original.replace(/\s*<li id="step-3">.*<\/li>/, ''));
  const r = locate(doc, { stable_id: 'step-3', selector: '#step-3', tag: 'li', text: 'Deploy and rollback SQL, browser verification.' });
  assert.equal(r.state, 'orphaned');
  assert.equal(r.place, null);
  const gone = html(original.replace('Director or Attestor', 'Director'));
  assert.equal(locate(gone, quote).state, 'orphaned');
});

test('a quote is found by its prefix and suffix after its container changed', () => {
  // The summary loses its id; the quote with its context is still there.
  const doc = html(original.replace('<p id="summary">', '<p>'));
  const r = locate(doc, quote);
  assert.equal(r.state, 'moved');
  assert.equal(r.place.selector, 'body > p:nth-of-type(1)');
  // A bare quote that now appears twice, with its context gone, is ambiguous: orphaned.
  const twice = html(original.replace('A Setup screen where a Director or Attestor enrols', 'Director or Attestor. Director or Attestor').replace('<p id="summary">', '<p>'));
  assert.equal(locate(twice, quote).state, 'orphaned');
});

test('Markdown anchors re-resolve the same way', () => {
  const before = loadDoc('markdown', '# Plan\n\nFirst paragraph here.\n\nSecond paragraph here.\n');
  const a = { stable_id: null, selector: 'body > p:nth-of-type(2)', tag: 'p', text: 'Second paragraph here.' };
  assert.equal(locate(before, a).state, 'anchored');
  const after = loadDoc('markdown', '# Plan\n\nFirst paragraph here.\n\nInserted.\n\nSecond paragraph here.\n');
  const r = locate(after, a);
  assert.equal(r.state, 'moved');
  assert.deepEqual(r.place.lines, [7, 7]);
});

test('cssPath matches the SDK, CSS.escape included', () => {
  assert.equal(cssEscape('1st'), '\\31 st');
  assert.equal(cssEscape('a b'), 'a\\ b');
  assert.equal(cssEscape('-'), '\\-');
  assert.equal(cssEscape('-1x'), '-\\31 x');
  const doc = html('<body><div id="1st"><p>a</p><p>b</p></div><div id="dup"></div><div id="dup"><i>x</i></div></body>');
  const p2 = resolveSelector(doc, '#\\31 st > p:nth-of-type(2)');
  assert.equal(cssPath(doc, p2), '#\\31 st > p:nth-of-type(2)');
  const i = resolveSelector(doc, 'body > div:nth-of-type(3) > i:nth-of-type(1)');
  assert.equal(cssPath(doc, i), 'body > div:nth-of-type(3) > i:nth-of-type(1)', 'a duplicated id is not used');
});
