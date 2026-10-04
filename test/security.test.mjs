// What the server refuses: requests without the session token, foreign Host
// headers and Origins, the sandboxed page reaching the API, and files
// outside the reviewed page's directory.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import WebSocket from 'ws';
import { ELEMENT_NOTE, api, makeWorld, openSession, sendNotes } from './helpers/harness.mjs';

let world;
let s;

before(async () => {
  world = makeWorld();
  s = await openSession(world);
});

after(async () => {
  await world.cleanup();
});

test('a request without the session token is refused', async () => {
  const routes = [
    ['GET', `/api/s/${s.id}`],
    ['GET', `/api/s/${s.id}/feedback?hold=0`],
    ['POST', `/api/s/${s.id}/replies`, { text: 'hi' }],
    ['POST', `/api/s/${s.id}/send`, { notes: [ELEMENT_NOTE] }],
  ];
  for (const [method, url, body] of routes) {
    const none = await api(s.port, method, url, { body, origin: true });
    assert.equal(none.status, 401, `${method} ${url} without a token`);
    const wrong = await api(s.port, method, url, { body, origin: true, token: 'f'.repeat(64) });
    assert.equal(wrong.status, 401, `${method} ${url} with a wrong token`);
    const admin = await api(s.port, method, url, { body, origin: true, token: s.adminToken });
    assert.equal(admin.status, 401, `${method} ${url} with the admin token instead of the session's`);
  }
  // Another session's token does not open this one.
  const other = path.join(world.pageDir, 'other.html');
  fs.writeFileSync(other, '<p>other</p>');
  const r = await world.cli(['open', other, '--no-browser', '--json']);
  const otherToken = world.session(JSON.parse(r.stdout).session.id).token;
  assert.equal((await api(s.port, 'GET', `/api/s/${s.id}`, { token: otherToken })).status, 401);

  assert.equal((await api(s.port, 'POST', '/api/sessions', { body: { file: world.page } })).status, 401);
  assert.equal((await api(s.port, 'POST', '/api/shutdown', { token: s.token })).status, 401);
  const view = await api(s.port, 'GET', `/api/s/${s.id}`, { token: s.token });
  assert.equal(view.status, 200);
  assert.equal(view.json.notes.length, 0, 'none of the refused sends was stored');
});

test('the WebSocket refuses a missing token and a foreign Origin', async () => {
  const tryWs = (protocols, origin) =>
    new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${s.port}/api/s/${s.id}/events`, protocols, { headers: origin ? { Origin: origin } : {} });
      ws.on('open', () => {
        ws.close();
        resolve('open');
      });
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode));
      ws.on('error', () => resolve('error'));
    });
  const own = `http://127.0.0.1:${s.port}`;
  assert.equal(await tryWs(['vivamark.v1'], own), 401);
  assert.equal(await tryWs(['vivamark.v1', `vivamark.token.${'0'.repeat(64)}`], own), 401);
  assert.equal(await tryWs(['vivamark.v1', `vivamark.token.${s.token}`], 'http://evil.example'), 403);
  assert.equal(await tryWs(['vivamark.v1', `vivamark.token.${s.token}`], 'null'), 403);
  assert.equal(await tryWs(['vivamark.v1', `vivamark.token.${s.token}`], own), 'open');
});

test('Host and Origin guards block DNS rebinding and cross-site posts', async () => {
  const rebinding = await api(s.port, 'GET', `/api/s/${s.id}`, { token: s.token, host: `attacker.example:${s.port}` });
  assert.equal(rebinding.status, 403);
  assert.equal((await api(s.port, 'GET', '/health', { host: 'attacker.example' })).status, 403);

  const crossSite = await api(s.port, 'POST', `/api/s/${s.id}/send`, {
    token: s.token,
    headers: { Origin: 'http://evil.example' },
    body: { notes: [ELEMENT_NOTE] },
  });
  assert.equal(crossSite.status, 403);
  const fromSandbox = await api(s.port, 'POST', `/api/s/${s.id}/send`, { token: s.token, headers: { Origin: 'null' }, body: { notes: [ELEMENT_NOTE] } });
  assert.equal(fromSandbox.status, 403, 'the sandboxed page has the opaque origin "null"');
  const noOrigin = await api(s.port, 'POST', `/api/s/${s.id}/send`, { token: s.token, body: { notes: [ELEMENT_NOTE] } });
  assert.equal(noOrigin.status, 403, 'notes are sent from the review page only');

  const malformed = await sendNotes(s, [{ kind: 'element', comment: 'no anchor' }]);
  assert.equal(malformed.status, 400);
});

test('the review page and the reviewed page carry their isolation headers', async () => {
  const chrome = await api(s.port, 'GET', `/s/${s.id}`);
  assert.equal(chrome.status, 200);
  assert.match(chrome.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.match(chrome.headers['content-security-policy'], /script-src 'self'/);
  assert.equal(chrome.headers['x-frame-options'], 'DENY');
  assert.doesNotMatch(chrome.text, /https?:\/\/(?!127\.0\.0\.1)/, 'the review UI references no remote resource');

  const view = (await api(s.port, 'GET', `/api/s/${s.id}`, { token: s.token })).json;
  const page = await api(s.port, 'GET', view.artifact_url);
  assert.equal(page.status, 200);
  assert.match(page.headers['content-security-policy'], /^sandbox allow-scripts/);
  assert.doesNotMatch(page.headers['content-security-policy'], /allow-same-origin/);

  const original = fs.readFileSync(world.page, 'utf8');
  const tags = page.text.match(/<script src="\/_vivamark\/sdk\.js"[^>]*><\/script>/g);
  assert.equal(tags.length, 1, 'exactly one script tag is added');
  assert.equal(page.text.replace(tags[0], ''), original, 'and nothing else changes');

  const wrongKey = view.artifact_url.replace(/\/[0-9a-f]{64}\//, `/${'0'.repeat(64)}/`);
  assert.equal((await api(s.port, 'GET', wrongKey)).status, 404);
});

test('assets are confined to the page directory, with no dotfiles and no symlink escapes', async () => {
  const view = (await api(s.port, 'GET', `/api/s/${s.id}`, { token: s.token })).json;
  const base = view.artifact_url.replace(/[^/]+$/, '');
  fs.writeFileSync(path.join(world.pageDir, 'style.css'), 'p { color: red }');
  fs.writeFileSync(path.join(world.pageDir, '.env'), 'SECRET=1');
  fs.writeFileSync(path.join(world.base, 'outside.txt'), 'outside');
  fs.symlinkSync(path.join(world.base, 'outside.txt'), path.join(world.pageDir, 'link.txt'));

  const css = await api(s.port, 'GET', `${base}style.css`);
  assert.equal(css.status, 200);
  assert.match(css.headers['content-type'], /text\/css/);
  for (const p of ['.env', 'link.txt', '..%2Foutside.txt', '%2E%2E/outside.txt', 'sub/../../outside.txt']) {
    const r = await api(s.port, 'GET', `${base}${p}`);
    assert.equal(r.status, 404, p);
    assert.doesNotMatch(r.text, /SECRET|outside/);
  }
});
