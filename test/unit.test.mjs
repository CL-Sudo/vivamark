// Pure functions: script injection, source-line mapping, note validation,
// request guards, reply rendering. No sockets.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  Daemon,
  FEEDBACK_SCHEMA,
  hostAllowed,
  injectScript,
  originAllowed,
  parseDraft,
  parseWithLocations,
  renderReply,
  sourceLine,
  Store,
  tokenProof,
  tokensEqual,
  wsToken,
} from '../dist/internal.js';
import { parse } from 'parse5';
import { FIXTURE, runCli } from './helpers/harness.mjs';

const TAG = '<script src="/_vivamark/sdk.js"></script>';

function lineOf(text, needle) {
  const at = text.indexOf(needle);
  assert.ok(at >= 0, `fixture contains ${needle}`);
  return text.slice(0, at).split('\n').length;
}

test('injectScript adds exactly one tag and leaves every other byte alone', () => {
  const cases = [
    '<!doctype html><html><head><title>x</title></head><body><p>hi</p></body></html>',
    '<!DOCTYPE html>\n<html lang="en">\n<body><p>no head</p></body></html>',
    '<!doctype html>\n<p>no html, no head</p>',
    '<p>bare fragment</p>',
    '﻿<!doctype html><head></head><p>bom</p>',
    '<!-- comment first --><html><HEAD data-x="1"><meta charset="utf-8"></HEAD><body></body></html>',
  ];
  for (const html of cases) {
    const out = injectScript(html, TAG);
    assert.equal(out.length, html.length + TAG.length, html);
    const at = out.indexOf(TAG);
    assert.ok(at >= 0);
    assert.equal(out.slice(0, at) + out.slice(at + TAG.length), html, 'the rest is unchanged');
    assert.equal(out.indexOf(TAG, at + 1), -1, 'only one tag');
  }
  const withHead = injectScript('<html><head><title>x</title></head></html>', TAG);
  assert.ok(withHead.startsWith(`<html><head>${TAG}<title>`), 'goes first in an explicit head');
});

test('injectScript finds the head in a long page as a whole-page parse does', () => {
  // Long enough that only the start of the page is parsed when it has an explicit head.
  const body = `<body>${'<section><p>Some text &amp; more.</p></section>\n'.repeat(400)}</body></html>`;
  const cases = [
    // [page, what the tag must follow]
    [`<!doctype html><html><head><title>x</title></head>${body}`, '<html><head>'],
    [`<!doctype html><html><head data-x="a>b"><title>x</title></head>${body}`, '<head data-x="a>b">'],
    [`<!-- <head> in a comment --><html><HEAD lang=en><meta charset="utf-8"></HEAD>${body}`, '<HEAD lang=en>'],
    // A script before the head makes the head implied; the later <head> is ignored.
    [`<!doctype html><html lang="en"><script>"<head>"</script><head><title>x</title></head>${body}`, '<html lang="en">'],
    // The real head is past the window that follows a <head> in a comment.
    [`<!doctype html><html><!-- <head> -->${' '.repeat(5000)}<head><title>x</title></head>${body}`, `${' '.repeat(5000)}<head>`],
    [`<!doctype html><html lang="en">${body}`, '<html lang="en">'],
    [`<!doctype html>${body.replace('<body>', '<header>')}`, '<!doctype html>'],
  ];
  for (const [html, before] of cases) {
    const out = injectScript(html, TAG);
    const at = out.indexOf(TAG);
    assert.equal(out.slice(0, at) + out.slice(at + TAG.length), html, 'the rest is unchanged');
    assert.ok(out.slice(0, at).endsWith(before), `${html.slice(0, 80)}: after ${before}`);
  }
});

test('sourceLine maps stable ids, selectors and quotes to lines of the saved file', () => {
  const html = fs.readFileSync(FIXTURE, 'utf8');
  assert.equal(sourceLine(html, { stable_id: 'step-2', selector: null }), lineOf(html, 'id="step-2"'));
  assert.equal(sourceLine(html, { stable_id: null, selector: '#plan > li:nth-of-type(3)' }), lineOf(html, 'id="step-3"'));
  assert.equal(sourceLine(html, { stable_id: null, selector: 'body > p:nth-of-type(2)' }), lineOf(html, 'The save handler touches'));
  assert.equal(
    sourceLine(html, { stable_id: 'summary', selector: '#summary', quote: 'Director or Attestor', prefix: '', suffix: '' }),
    lineOf(html, 'Director or Attestor'),
  );
  assert.equal(sourceLine(html, { stable_id: 'built-by-script', selector: '#nope > div' }), null);
  assert.equal(sourceLine(html, { stable_id: null, selector: 'body > table:nth-of-type(4)' }), null);
  // CSS-escaped ids, as CSS.escape produces for an id starting with a digit.
  const esc = '<body>\n<div id="1st">\n<p>a</p></div></body>';
  assert.equal(sourceLine(esc, { stable_id: null, selector: '#\\31 st > p:nth-of-type(1)' }), 3);
});

test('parseDraft accepts the three note kinds and refuses malformed notes', () => {
  const el = parseDraft({ kind: 'element', comment: ' fix ', anchor: { stable_id: 'a', selector: '#a', tag: 'li', text: 't', source_line: 99 } });
  assert.deepEqual(el, { kind: 'element', comment: 'fix', anchor: { stable_id: 'a', selector: '#a', tag: 'li', text: 't' } });
  assert.equal('source_line' in el.anchor, false, 'the client cannot set source_line');
  const tx = parseDraft({ kind: 'text', comment: 'q', anchor: { stable_id: null, selector: 'body', quote: 'x', prefix: 'p', suffix: 's' } });
  assert.equal(tx.anchor.quote, 'x');
  assert.deepEqual(parseDraft({ kind: 'page', comment: 'overall fine', anchor: { selector: 'x' } }), { kind: 'page', comment: 'overall fine', anchor: null });
  for (const bad of [
    null,
    'x',
    { kind: 'script', comment: 'x' },
    { kind: 'page', comment: '   ' },
    { kind: 'element', comment: 'x' },
    { kind: 'element', comment: 'x', anchor: { stable_id: null, selector: null } },
    { kind: 'text', comment: 'x', anchor: { selector: 'p', quote: '  ' } },
    { kind: 'page', comment: 'x'.repeat(10_001) },
  ]) {
    assert.equal(typeof parseDraft(bad), 'string', JSON.stringify(bad)?.slice(0, 80));
  }
});

test('parseDraft keeps the reviewer\'s own words on a decision, with an option or without one', () => {
  const anchor = { stable_id: 'idcheck-passport', selector: '#idcheck-passport', tag: 'input', text: '' };
  const withOption = parseDraft({
    kind: 'element',
    comment: 'MyKad or passport\nbut only for foreign staff',
    choice: { group: 'Which ID check?', group_id: 'decision-id', option: 'MyKad or passport', option_id: 'idcheck-passport', text: ' but only for foreign staff ' },
    anchor,
  });
  assert.deepEqual(withOption.choice, { group: 'Which ID check?', group_id: 'decision-id', option: 'MyKad or passport', option_id: 'idcheck-passport', text: 'but only for foreign staff' });
  assert.deepEqual(Object.keys(withOption).slice(0, 3), ['kind', 'comment', 'choice'], 'the words come before anything large');
  const alone = parseDraft({ kind: 'element', comment: 'none of these', choice: { group: 'Which ID check?', group_id: 'decision-id', option: null, option_id: 'ignored', text: 'none of these' }, anchor });
  assert.deepEqual(alone.choice, { group: 'Which ID check?', group_id: 'decision-id', option: null, option_id: null, text: 'none of these' });
  assert.equal(parseDraft({ kind: 'element', comment: 'x', anchor }).choice, undefined, 'no words, no choice: as before');
  for (const bad of [
    { kind: 'element', comment: 'x', choice: 'x', anchor },
    { kind: 'element', comment: 'x', choice: { group: 'g', option: null, text: '  ' }, anchor },
    { kind: 'element', comment: 'x', choice: { group: 'g', option: 3, text: 't' }, anchor },
    { kind: 'element', comment: 'x', choice: { group: 'g', option: null, text: 'x'.repeat(4001) }, anchor },
    { kind: 'page', comment: 'x', choice: { group: 'g', option: null, text: 't' } },
  ]) {
    assert.equal(typeof parseDraft(bad), 'string', JSON.stringify(bad).slice(0, 80));
  }
});

test('request guards: Host allowlist, Origin, tokens, proof', () => {
  const req = (headers) => ({ headers });
  // Loopback names on any port: a port forwarder may reach us on a different one.
  for (const host of ['127.0.0.1:4000', 'localhost:4000', '[::1]:4000', '127.0.0.1:47471', 'LOCALHOST:1', '[::1]:65535']) {
    assert.ok(hostAllowed(req({ host })), host);
  }
  for (const host of [
    'evil.example:4000',
    '127.0.0.1.evil.example:4000',
    'localhost.evil.example:4000',
    '127.0.0.1.evil.example',
    'evil@127.0.0.1:4000',
    '192.168.1.5:4000',
    '10.0.0.2:4000',
    '[fe80::1]:4000',
    '0.0.0.0:4000',
    '127.0.0.1',
    '127.0.0.1:0',
    '127.0.0.1:65536',
    '127.0.0.1:',
    '::1:4000',
    '',
    undefined,
  ]) {
    assert.equal(hostAllowed(req({ host })), false, String(host));
  }
  assert.ok(originAllowed(req({}), false), 'the CLI sends no Origin');
  assert.equal(originAllowed(req({}), true), false, 'a browser-only route needs one');
  for (const origin of ['http://127.0.0.1:4000', 'http://localhost:47471', 'http://[::1]:23456']) {
    assert.ok(originAllowed(req({ origin }), true), origin);
  }
  for (const origin of [
    'null',
    'http://evil.example',
    'http://evil.example:4000',
    'http://127.0.0.1.evil.example:4000',
    'http://localhost.evil.example:4000',
    'http://192.168.1.5:4000',
    'https://127.0.0.1:4000',
    'http://127.0.0.1',
    '127.0.0.1:4000',
  ]) {
    assert.equal(originAllowed(req({ origin }), false), false, origin);
  }

  assert.ok(tokensEqual('abc', 'abc'));
  assert.equal(tokensEqual('abd', 'abc'), false);
  assert.equal(tokensEqual(undefined, 'abc'), false);
  assert.equal(tokensEqual('ab', 'abc'), false);
  assert.equal(wsToken(req({ 'sec-websocket-protocol': 'vivamark.v1, vivamark.token.f00d' })), 'f00d');
  assert.equal(wsToken(req({})), undefined);
  assert.notEqual(tokenProof('a', 'c1'), tokenProof('b', 'c1'));
  assert.notEqual(tokenProof('a', 'c1'), tokenProof('a', 'c2'));
});

test('agent replies render as Markdown without raw HTML or script links', () => {
  const html = renderReply('Done: **split** step 2.\n\n<script>alert(1)</script>\n\n[x](javascript:alert(1)) [ok](https://example.com)');
  assert.match(html, /<strong>split<\/strong>/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /href="javascript:/);
  assert.match(html, /href="https:\/\/example.com" target="_blank" rel="noopener noreferrer"/);
});

test('the schema name is versioned', () => {
  assert.equal(FEEDBACK_SCHEMA, 'vivamark.feedback/1');
});

test('--version and --help answer without starting a server', async () => {
  const env = { ...process.env, VIVAMARK_STATE_DIR: '/nonexistent/vivamark-should-not-be-created' };
  const v = await runCli(['--version'], env);
  assert.equal(v.code, 0);
  assert.match(v.stdout, /^\d+\.\d+\.\d+/);
  const h = await runCli(['--help'], env);
  assert.equal(h.code, 0);
  assert.match(h.stdout, /vivamark open <file\.html>/);
  assert.match(h.stdout, /vivamark wait/);
  assert.match(h.stdout, /vivamark reply/);
  assert.equal(fs.existsSync('/nonexistent/vivamark-should-not-be-created'), false);
  const bad = await runCli(['frobnicate'], env);
  assert.equal(bad.code, 2);
});

test('each note is re-anchored once per parsed file, and anew when the file changes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vivamark-locate-'));
  try {
    const file = path.join(dir, 'page.html');
    const page = (body) => `<!doctype html><html><head><title>t</title></head><body>${body}</body></html>`;
    fs.writeFileSync(file, page('<p>one two one three, then words enough to keep the edit out of reach.</p><h2>Plan</h2><p>Second paragraph.</p>'));
    const store = new Store(path.join(dir, 'state'));
    const daemon = new Daemon(store, 60_000);
    const { session: s } = store.openSession(file, {});
    const doc = daemon.readDoc(s);
    const hash = store.saveSnapshot(s, doc.source);
    const quote = { selector: 'body > p:nth-of-type(1)', quote: 'one', prefix: 'two ', suffix: ' three' };
    const heading = { selector: 'body > h2:nth-of-type(1)', tag: 'h2', text: 'Plan' };
    store.appendBatch(s, [{ kind: 'text', comment: 'q', anchor: quote }, { kind: 'element', comment: 'h', anchor: heading }], 'changes', hash, () => null);
    // The same anchor, even as another object, is found once per parsed file.
    const found = daemon.locate(doc, quote);
    assert.equal(daemon.locate(doc, { ...quote }), found);
    assert.equal(daemon.locate(daemon.snapshotDoc(s, hash), quote), found, 'the snapshot is the same parse');
    // Any field locate reads tells anchors apart.
    assert.notEqual(daemon.locate(doc, { ...quote, prefix: undefined }), found);
    assert.equal(daemon.locate(doc, { ...quote, prefix: '', suffix: '' }).state, 'anchored');
    assert.equal(daemon.locate(doc, { ...heading, tag: 'p' }).state, 'orphaned');
    assert.equal(daemon.locate(doc, heading).state, 'anchored');
    assert.equal(daemon.locate(doc, { ...heading, quote: 'Plan' }).state, 'anchored');
    assert.equal(daemon.analyze(s).notes.get('n_0002').state, 'anchored');
    // An edit is a new parse: notes are found afresh there, and compared with the snapshot.
    fs.writeFileSync(file, page('<p>one two one three, then words enough to keep the edit out of reach.</p><p>Second paragraph.</p><h2>Plan, revised</h2>'));
    const after = daemon.analyze(s);
    assert.equal(after.notes.get('n_0001').state, 'anchored');
    assert.equal(after.notes.get('n_0001').changed, false);
    assert.equal(after.notes.get('n_0002').state, 'anchored');
    assert.equal(after.notes.get('n_0002').changed, true);
    fs.writeFileSync(file, page('<p>Second paragraph.</p>'));
    store.appendAnnotation(s, { type: 'resolve', at: new Date().toISOString(), note: 'n_0001', resolved: true });
    const gone = daemon.analyze(s);
    assert.equal(gone.notes.get('n_0001').state, 'orphaned');
    assert.equal(gone.notes.get('n_0002').state, 'orphaned');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the faster parse gives the same tree and source locations as parse5 itself', () => {
  // Every node with its location, keys in order: a location built differently would show here.
  const dump = (n, out = []) => {
    out.push(n.nodeName, n.value ?? '', n.data ?? '', JSON.stringify(n.attrs ?? null), JSON.stringify(n.sourceCodeLocation ?? null));
    for (const c of n.childNodes ?? []) dump(c, out);
    if (n.content) dump(n.content, out.concat('#content'));
    out.push('/');
    return out;
  };
  const pages = [
    fs.readFileSync(FIXTURE, 'utf8'),
    '<!doctype html><html lang=en><head><title>t</title></head><body x=1><p a=1 a=2>one <b>two <i>three</b> four</i> five</p><p>six',
    '<table><tr><td>cell</td>stray text<td>more</table><template><p>inside</p></template><select><option>o</select>',
    '<svg><text>t</text><foreignObject><p>f</p></foreignObject></svg><math><mi>x</mi></math><br></br><img src=a>',
    '<!-- c --><head><title>a</title></head>  <body><h1>x</h2><pre>\n\ny</pre><textarea>a</b></textarea><script>x<y</script>',
    'Σ é &amp; &nbsp;\0 <ul><li>a<li>b</ul><frameset><noscript>n</noscript><plaintext>rest </p> is text',
  ];
  for (const html of pages) {
    assert.deepEqual(dump(parseWithLocations(html)), dump(parse(html, { sourceCodeLocationInfo: true })), html.slice(0, 60));
  }
});

test('a Markdown page load reuses the page its parse rendered, and renders an edited file afresh', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vivamark-md-'));
  const served = (daemon, s) => {
    let body = '';
    daemon.serveArtifact({ writeHead() {}, end(b) { body = String(b); } }, s, '', '', null);
    return body;
  };
  try {
    const file = path.join(dir, 'plan.md');
    fs.writeFileSync(file, '# Plan\n\nFirst paragraph.\n');
    const store = new Store(path.join(dir, 'state'));
    const daemon = new Daemon(store, 60_000);
    const { session: s } = store.openSession(file, {});
    const fresh = served(daemon, s);
    assert.match(fresh, /<p data-vivamark-lines="3-3">First paragraph.<\/p>/);
    const doc = daemon.readDoc(s);
    assert.equal(served(daemon, s), fresh, 'the same page as a fresh render');
    // The parsed version's page is the one served: mark it, and the mark shows.
    const key = [...daemon.parsedDocs.keys()].find((k) => daemon.parsedDocs.get(k) === doc);
    daemon.parsedDocs.set(key, { ...doc, html: doc.html.replace('</body>', '<!--from the parse--></body>') });
    assert.match(served(daemon, s), /<!--from the parse-->/);
    // An edit not parsed yet is rendered from the file as it is now.
    fs.writeFileSync(file, '# Plan\n\nAn edited paragraph.\n');
    const edited = served(daemon, s);
    assert.match(edited, /An edited paragraph/);
    assert.doesNotMatch(edited, /from the parse/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("each reply's Markdown is rendered once, and every session read reuses it", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vivamark-replies-'));
  try {
    const file = path.join(dir, 'page.html');
    fs.writeFileSync(file, '<!doctype html><html><head><title>t</title></head><body><p>Hi</p></body></html>');
    const store = new Store(path.join(dir, 'state'));
    const daemon = new Daemon(store, 60_000);
    const { session: s } = store.openSession(file, {});
    const texts = ['**Done**, see [the plan](https://example.test/p)', '<script>x</script> and `code`', '**Done**, see [the plan](https://example.test/p)'];
    for (const t of texts) store.appendReply(s, t);
    const html = () => daemon.sessionView(s).replies.map((r) => r.html);
    const fresh = texts.map((t) => renderReply(t));
    assert.deepEqual(html(), fresh, 'the same HTML as a fresh render');
    assert.deepEqual(html(), fresh, 'and the same again on the next read');
    // The rendered HTML is kept per reply: mark the kept copy, and the next read shows the mark.
    const kept = daemon.replyHtml.get(s.replies[1]);
    daemon.replyHtml.set(s.replies[1], { ...kept, html: kept.html + '<!--kept-->' });
    assert.deepEqual(html(), [fresh[0], fresh[1] + '<!--kept-->', fresh[2]]);
    // A reply whose text is not what was rendered is rendered again.
    s.replies[1].text = 'changed';
    assert.equal(html()[1], renderReply('changed'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the file as it is now and its Send snapshots share one parse per content', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vivamark-parse-'));
  try {
    const file = path.join(dir, 'page.html');
    const page = (lead) => `<!doctype html><html><head><title>t</title></head><body><p>${lead}</p><p>Second paragraph.</p></body></html>`;
    fs.writeFileSync(file, page('First paragraph.'));
    const store = new Store(path.join(dir, 'state'));
    const daemon = new Daemon(store, 60_000);
    const { session: s } = store.openSession(file, {});
    // What a Send does: parse the file, keep it as a snapshot, log the note.
    const doc = daemon.readDoc(s);
    const hash = store.saveSnapshot(s, doc.source);
    store.appendBatch(s, [{ kind: 'text', comment: 'c', anchor: { quote: 'Second paragraph', selector: 'body' } }], 'changes', hash, () => null);
    assert.equal(daemon.snapshotDoc(s, hash), doc, 'the snapshot is the parse the Send made');
    const first = daemon.analyze(s);
    assert.equal(first.changes.inserts.length + first.changes.removals.length, 0);
    store.appendAnnotation(s, { type: 'resolve', at: new Date().toISOString(), note: 'n_0001', resolved: true });
    daemon.analyze(s);
    assert.equal(daemon.readDoc(s), doc, 'a change to the log alone does not parse the file again');
    // An edited file is parsed afresh; the snapshot keeps the file as it was sent.
    fs.writeFileSync(file, page('A new first paragraph.'));
    const edited = daemon.readDoc(s);
    assert.notEqual(edited, doc);
    assert.match(edited.text, /A new first/);
    assert.equal(daemon.snapshotDoc(s, hash).text, doc.text);
    const after = daemon.analyze(s);
    assert.equal(after.notes.get('n_0001').state, 'anchored', 'the quote is still on the page');
    assert.ok(after.changes.inserts.length > 0, 'the edit shows as changed since the Send');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a CLI command loads the HTML parser, Markdown renderer and WebSocket server only when it needs them', async () => {
  const { ROOT } = await import('./helpers/harness.mjs');
  const dist = path.join(ROOT, 'dist');
  const heavy = ['parse5', 'markdown-it', 'ws'];
  // The modules node loads before cli.js runs: its static imports, followed through the chunks beside it.
  const staticImports = (file) => {
    const code = fs.readFileSync(file, 'utf8');
    return [...code.matchAll(/^(?:import|export)\b[^;]*?\bfrom\s*"([^"]+)";|^import\s*"([^"]+)";/gms)].map((m) => m[1] ?? m[2]);
  };
  const seen = new Set();
  const external = new Set();
  const walk = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const spec of staticImports(file)) {
      if (spec.startsWith('.')) walk(path.join(path.dirname(file), spec));
      else external.add(spec);
    }
  };
  walk(path.join(dist, 'cli.js'));
  assert.ok(external.has('node:net'), 'the walk sees the static imports');
  for (const name of heavy) assert.ok(!external.has(name), `${name} is not loaded at start-up`);
  // They are still in the build, loaded by the daemon and the linter when those run.
  const all = new Set(fs.readdirSync(dist).filter((f) => f.endsWith('.js') && f !== 'internal.js').flatMap((f) => staticImports(path.join(dist, f))));
  for (const name of heavy) assert.ok(all.has(name), `${name} is imported by some chunk`);
});

test('neither the CLI nor the daemon loads undici, which an ES import of node:http would', async () => {
  const { ROOT } = await import('./helpers/harness.mjs');
  const dist = path.join(ROOT, 'dist');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vivamark-undici-'));
  try {
    // Reports, as the process exits, whether node loaded its bundled undici (fetch, WebSocket).
    const preload = path.join(tmp, 'report.cjs');
    fs.writeFileSync(preload, "process.on('exit', () => require('fs').writeSync(2, '\\nundici:' + process.moduleLoadList.some((m) => /undici/.test(m)) + '\\n'));\n");
    const undici = (args) => {
      const r = spawnSync(process.execPath, ['--require', preload, ...args], { encoding: 'utf8', env: { ...process.env, VIVAMARK_STATE_DIR: tmp } });
      const m = /\nundici:(true|false)\n/.exec(r.stderr);
      assert.ok(m, `the report was printed: ${r.stderr}`);
      return m[1] === 'true';
    };
    assert.equal(undici(['--input-type=module', '-e', "import 'node:http';"]), true, 'the check sees undici when an ES import of node:http loads it');
    assert.equal(undici([path.join(dist, 'cli.js'), '--version']), false, 'a CLI command');
    assert.equal(undici([path.join(dist, 'cli.js'), 'status', '--json']), false, 'a CLI command that looks for the daemon');
    const chunks = fs.readdirSync(dist).filter((f) => f.startsWith('cli-') && f.endsWith('.js'));
    assert.ok(chunks.some((f) => fs.readFileSync(path.join(dist, f), 'utf8').includes('createServer')), 'the daemon is among the chunks');
    const importAll = chunks.map((f) => `await import(${JSON.stringify(pathToFileURL(path.join(dist, f)).href)});`).join(' ');
    assert.equal(undici(['--input-type=module', '-e', importAll]), false, 'the daemon, the linter and the rest of the build');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
