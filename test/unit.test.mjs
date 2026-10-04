// Pure functions: script injection, source-line mapping, note validation,
// request guards, reply rendering. No sockets.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import {
  FEEDBACK_SCHEMA,
  hostAllowed,
  injectScript,
  originAllowed,
  parseDraft,
  renderReply,
  sourceLine,
  tokenProof,
  tokensEqual,
  wsToken,
} from '../dist/internal.js';
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

test('request guards: Host allowlist, Origin, tokens, proof', () => {
  const req = (headers) => ({ headers });
  assert.ok(hostAllowed(req({ host: '127.0.0.1:4000' }), 4000));
  assert.ok(hostAllowed(req({ host: 'localhost:4000' }), 4000));
  assert.ok(hostAllowed(req({ host: '[::1]:4000' }), 4000));
  for (const host of ['evil.example:4000', '127.0.0.1:4001', '127.0.0.1', '192.168.1.5:4000', undefined]) {
    assert.equal(hostAllowed(req({ host }), 4000), false, String(host));
  }
  assert.ok(originAllowed(req({}), 4000, false), 'the CLI sends no Origin');
  assert.equal(originAllowed(req({}), 4000, true), false, 'a browser-only route needs one');
  assert.ok(originAllowed(req({ origin: 'http://127.0.0.1:4000' }), 4000, true));
  assert.equal(originAllowed(req({ origin: 'null' }), 4000, false), false, 'the sandboxed page');
  assert.equal(originAllowed(req({ origin: 'http://evil.example' }), 4000, false), false);

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
