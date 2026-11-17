// Re-anchoring (F3) as a pure function: each note's anchor re-resolved
// against an edited file, by stable id, then quote with prefix and suffix,
// then selector, to anchored, moved or orphaned.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { cssEscape, cssPath, loadDoc, locate, namedTarget, resolveSelector } from '../dist/internal.js';
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

test('Markdown line targets and places skip trailing blank lines, and stay quick on a long file', () => {
  const src = '# Plan\n\nFirst line of a paragraph\nand its second line.\n\n\n- one\n- two\n\n```\ncode\n\n```\n\nLast.\n';
  const doc = loadDoc('markdown', src);
  const at = (line) => {
    const t = namedTarget(doc, `line:${line}`);
    return typeof t === 'string' ? t : [t.anchor.selector, locate(doc, t.anchor).place.lines];
  };
  assert.deepEqual(at(1), ['body > h1:nth-of-type(1)', [1, 1]]);
  assert.deepEqual(at(4), ['body > p:nth-of-type(1)', [3, 4]]);
  assert.match(at(5), /line 5 is not in the page's body/);
  assert.match(at(6), /line 6 is not in the page's body/);
  assert.deepEqual(at(8), ['body > ul:nth-of-type(1) > li:nth-of-type(2)', [8, 8]]);
  assert.deepEqual(at(12), ['body > pre:nth-of-type(1) > code:nth-of-type(1)', [10, 13]]);
  assert.deepEqual(at(15), ['body > p:nth-of-type(2)', [15, 15]]);
  const quote = namedTarget(doc, 'quote:second line');
  assert.deepEqual(locate(doc, quote.anchor).place.lines, [4, 4]);

  // Every element once used to split the whole file again: seconds here.
  let long = '';
  for (let i = 0; i < 2000; i++) long += `## Section ${i}\n\nParagraph ${i} with some words.\n\n- item a ${i}\n- item b ${i}\n\n`;
  const big = loadDoc('markdown', long);
  const t = performance.now();
  const hit = namedTarget(big, `line:${1000 * 7 + 3}`);
  assert.ok(performance.now() - t < 1000, `line target took ${performance.now() - t} ms`);
  assert.equal(hit.anchor.text, 'Paragraph 1000 with some words.');
});

test('finding an element by its text reads only its start, with the same result as the whole text', () => {
  // The whole-text comparison, as the re-anchoring rule states it.
  const norm = (s) => s.replace(/\s+/g, '').toLowerCase();
  const tail = ' more words'.repeat(60);
  const cases = [
    // [element text, recorded text, found by it]
    [`Hello brave world.${tail}`, 'Hello brave world.', true],
    [`Hello brave world.${tail}`, 'Hello brave wor1d.', false],
    // Mostly whitespace at the start: the slice holds too little, so the whole text is read.
    [`${' \n'.repeat(200)}Hello world${tail}`, 'Hello world', true],
    // A capital sigma lower-cases by what follows it, however far: Σ then 300 apostrophes then a letter is σ, not ς.
    [`ΑΣ${"'".repeat(300)}B${tail}`, `ΑΣ${"'".repeat(10)}`, false],
    [`ΑΣ${"'".repeat(300)}B${tail}`, `ας${"'".repeat(10)}`, false],
    [`ΑΣ${"'".repeat(300)}B${tail}`, `ασ${"'".repeat(10)}`, true],
    // ASCII whitespace of every kind, upper case, punctuation either side of the letters.
    [`  \t\v\fHELLO [Brave]\r\n World@${tail}`, 'hello [brave] world@', true],
    [`Hello [brave] world${tail}`, 'Hello {brave} world', false],
    // ASCII, then not: the rest is compared as normalised text.
    [`Plain café CRÈME${tail}`, 'plaincafécrème', true],
    [`Plain café CRÈME${tail}`, 'plain cafe creme', false],
    [`Plain KELVIN \u212a${tail}`, 'plain kelvin k', true],
    // A text shorter than the recorded one.
    ['Short', 'Short but recorded longer', false],
    // Characters that grow when lower-cased, and astral ones.
    [`İstanbul 𐐀𐐁 notes${tail}`, 'i̇stanbul 𐐨𐐩 notes', true],
    [`${'x'.repeat(87)}𐐀${tail}`, 'x'.repeat(12), true],
  ];
  for (const [text, recorded, hit] of cases) {
    assert.equal(norm(text).startsWith(norm(recorded)), hit, `the case itself: ${recorded}`);
    const doc = html(`<!doctype html><html><body><div><p>Other.</p><p>${text}</p></div></body></html>`);
    const r = locate(doc, { stable_id: null, selector: 'body > p:nth-of-type(9)', tag: 'p', text: recorded });
    assert.equal(r.state, hit ? 'moved' : 'orphaned', recorded);
    if (hit) assert.equal(r.place.selector, 'body > div:nth-of-type(1) > p:nth-of-type(2)');
  }
});

test('finding an element by its text matches the tag in any case, and any tag when none was recorded', () => {
  const doc = html(
    '<!doctype html><html><body><svg><foreignObject><p>Inside the drawing</p></foreignObject><text>Drawing label</text></svg>' +
      '<ul><li>Same words twice</li></ul><p>Same words twice</p><div><p>Only here</p></div></body></html>',
  );
  const where = (tag, text) => {
    const r = locate(doc, { stable_id: null, selector: 'body > p:nth-of-type(9)', tag, text });
    return r.state === 'orphaned' ? null : r.place.selector;
  };
  // SVG tag names keep their case in the parse; the browser may record them in either.
  assert.equal(where('foreignObject', 'Inside the'), 'body > svg:nth-of-type(1) > foreignObject:nth-of-type(1)');
  assert.equal(where('FOREIGNOBJECT', 'Inside the'), 'body > svg:nth-of-type(1) > foreignObject:nth-of-type(1)');
  assert.equal(where('TEXT', 'Drawing label'), 'body > svg:nth-of-type(1) > text:nth-of-type(1)');
  // The tag picks one of several elements with the same text.
  assert.equal(where('LI', 'Same words'), 'body > ul:nth-of-type(1) > li:nth-of-type(1)');
  assert.equal(where('p', 'Same words'), 'body > p:nth-of-type(1)');
  assert.equal(where('h1', 'Same words'), null);
  // With no tag, every element starting with the text counts: li, ul and p here, too many to choose.
  assert.equal(where('', 'Same words'), null);
  assert.equal(where(undefined, 'Same words'), null);
  // div and p both start with "Only here": with no tag that is ambiguous, with one it is not.
  assert.equal(where(undefined, 'Only here'), null);
  assert.equal(where('DIV', 'Only here'), 'body > div:nth-of-type(1)');
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

test('an id finds the first element carrying it, as a breadth-first search of the page does, and stays quick on a long page', () => {
  // The rule as it was before ids were indexed: breadth first, template contents after an element's children.
  const children = (n) => n.childNodes ?? [];
  const first = (doc, pred) => {
    const queue = [doc.root];
    for (let i = 0; i < queue.length; i++) {
      const n = queue[i];
      if (n.tagName && pred(n)) return n;
      queue.push(...children(n));
      if (n.tagName === 'template') queue.push(n.content);
    }
    return null;
  };
  const attr = (el, name) => el.attrs.find((a) => a.name === name)?.value;
  const at = (el) => (el ? `${el.tagName}@${el.sourceCodeLocation.startOffset}` : null);
  const pages = [
    // A deeper id comes after a shallower one later in the page; data-vivamark-id counts for the stable id only.
    '<body><div><p id="a">deep</p></div><p id="a">shallow</p><span data-vivamark-id="a">own</span></body>',
    '<body><div><i data-vivamark-id="b">deep</i></div><b data-vivamark-id="b">shallow</b><u id="b">id</u></body>',
    // Head elements, the body itself, an empty id, and the first of two id attributes.
    '<html><head id="h"><title id="t">x</title></head><body id="main"><p id="">empty</p><p id="d" id="e">two</p></body></html>',
    // Template contents come after the template's siblings' turn, and still count.
    '<body><template><p id="tpl">inside</p></template><div><div><p id="tpl">outside, deeper</p></div></div></body>',
    // Ids that need escaping in a selector.
    '<body><div id="1st"><p>a</p></div><div id="x y"><p>b</p></div><div id="é"><p>c</p></div></body>',
  ];
  for (const source of pages) {
    const doc = html(source);
    const ids = new Set(['missing', 'nope']);
    for (const m of source.matchAll(/(?:id|data-vivamark-id)="([^"]*)"/g)) ids.add(m[1]);
    for (const id of ids) {
      const stable = first(doc, (e) => attr(e, 'id') === id || attr(e, 'data-vivamark-id') === id);
      const byId = first(doc, (e) => attr(e, 'id') === id);
      const want = stable ? { state: 'anchored', place: cssPath(doc, stable) } : { state: 'orphaned', place: null };
      const got = locate(doc, { stable_id: id || null, tag: 'nothing-has-this-tag' });
      if (id) assert.deepEqual({ state: got.state, place: got.place?.selector ?? null }, want, `stable id ${JSON.stringify(id)} in ${source}`);
      assert.equal(at(resolveSelector(doc, `#${cssEscape(id)}`)), at(byId), `#${id} in ${source}`);
      const child = byId && children(byId).find((n) => n.tagName === 'p');
      assert.equal(at(resolveSelector(doc, `#${cssEscape(id)} > p`)), at(child ?? null), `#${id} > p in ${source}`);
    }
  }
  // Fifty notes by id on a freshly parsed long page: about 70 ms when each lookup searched the whole page.
  let body = '';
  for (let i = 0; i < 2000; i++) body += `<section id="s${i}"><h2 id="h${i}">Section ${i}</h2><div><p>Paragraph ${i} alpha beta.</p><ul><li>a</li><li>b</li></ul></div></section>\n`;
  const long = `<!doctype html><html><head><title>t</title></head><body>${body}</body></html>`;
  html(long);
  const doc = html(long);
  const t = performance.now();
  for (let k = 0; k < 50; k++) {
    const i = k * 40 + 1;
    assert.equal(locate(doc, { stable_id: `h${i}`, selector: `#h${i}`, tag: 'h2', text: `Section ${i}` }).state, 'anchored');
  }
  assert.ok(performance.now() - t < 40, `50 lookups by id took ${(performance.now() - t).toFixed(1)} ms`);
});
