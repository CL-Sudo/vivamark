// Version history: every version of a reviewed file vivamark has seen is kept,
// one timeline per file across all its reviews, viewable read-only through the
// one injected script tag, comparable, and printable for the agent to restore.
// vivamark never writes the reviewed file.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { WebSocket } from 'ws';
import { ELEMENT_NOTE, FIXTURE, api, makeWorld, startCli } from './helpers/harness.mjs';

let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  chromium = undefined;
}

let world;
let browser;
let launchError;

before(async () => {
  world = makeWorld({ guardEgress: true });
  if (!chromium) return;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (err) {
    launchError = err;
  }
});

after(async () => {
  await browser?.close();
  await world.cleanup();
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openPage(name, source = fs.readFileSync(FIXTURE, 'utf8'), write = true) {
  const file = path.join(world.pageDir, name);
  if (write) fs.writeFileSync(file, source);
  const r = await world.cli(['open', file, '--no-browser', '--json']);
  if (r.code !== 0) throw new Error(`open failed (${r.code}): ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  return { file, out, port: world.server().port, id: out.session.id, token: world.session(out.session.id).token };
}

async function versions(file) {
  const r = await world.cli(['versions', file, '--json']);
  assert.equal(r.code, 0, r.stderr);
  return JSON.parse(r.stdout);
}

function versionsDir(file) {
  const root = path.join(world.stateDir, 'versions');
  const real = fs.realpathSync(file);
  const key = fs.readdirSync(root).find((d) => JSON.parse(fs.readFileSync(path.join(root, d, 'file.json'), 'utf8')).file === real);
  return key ? path.join(root, key) : null;
}

const blobs = (dir) => fs.readdirSync(dir).filter((n) => /^[0-9a-f]{64}$/.test(n));

function events() {
  return fs
    .readFileSync(path.join(world.stateDir, 'events.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));
}

function connectBrowser(s) {
  const ws = new WebSocket(`ws://127.0.0.1:${s.port}/api/s/${s.id}/events`, ['vivamark.v1', `vivamark.token.${s.token}`], {
    headers: { Origin: `http://127.0.0.1:${s.port}` },
  });
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

async function until(fn, ms = 5_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(50);
  }
  return false;
}

const send = (s, notes, extra = {}) => api(s.port, 'POST', `/api/s/${s.id}/send`, { token: s.token, origin: true, body: { notes, ...extra } });

test('a version is kept on open, read, Send, save and end; identical content is stored once', async () => {
  const s = await openPage('capture.html');
  const original = fs.readFileSync(s.file, 'utf8');
  let v = await versions(s.file);
  assert.deepEqual(v.versions.map((e) => e.cause), ['open']);
  assert.equal(v.versions[0].hash.length, 64);
  assert.equal(v.versions[0].size, Buffer.byteLength(original));
  assert.equal(v.versions[0].session, s.id);
  assert.equal(v.current, 1);

  // A read with nothing changed keeps nothing new.
  assert.equal((await world.cli(['status', s.file, '--json'])).code, 0);
  assert.equal((await versions(s.file)).versions.length, 1);

  // A save made while no review page is open is caught at the next read (status).
  const edited = original.replace('Applet scaffold, save handler and container page.', 'Applet scaffold and container page.');
  fs.writeFileSync(s.file, edited);
  assert.equal((await world.cli(['status', s.file, '--json'])).code, 0);
  v = await versions(s.file);
  assert.deepEqual(v.versions.map((e) => e.cause), ['open', 'read']);
  // Writing the same content again is not a new version.
  fs.writeFileSync(s.file, edited);
  assert.equal((await versions(s.file)).versions.length, 2);

  // A Send is always recorded, with its batch, decision and note count, even when the content is unchanged.
  const sent = await send(s, [ELEMENT_NOTE]);
  assert.equal(sent.status, 201, sent.text);
  v = await versions(s.file);
  const sendV = v.versions.at(-1);
  assert.deepEqual([sendV.n, sendV.cause, sendV.decision, sendV.notes, sendV.batch], [3, 'send', 'request-changes', 1, sent.json.notes[0].batch]);
  assert.equal(sendV.hash, v.versions[1].hash);
  const dir = versionsDir(s.file);
  assert.equal(blobs(dir).length, 2, 'two distinct contents, stored once each');
  for (const b of blobs(dir)) assert.equal(fs.statSync(path.join(dir, b)).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(path.join(dir, sendV.hash), 'utf8'), edited);
  assert.equal(sendV.path, path.join(dir, sendV.hash));

  // A save the watcher sees while a review page is open.
  const ws = await connectBrowser(s);
  await sleep(100);
  fs.writeFileSync(s.file, edited.replace('<h2>Risks</h2>', '<h2>Risks</h2>\n  <p>Saved while watched.</p>'));
  assert.ok(await until(async () => (await versions(s.file)).versions.length === 4), 'the save was kept');
  // The read above may have beaten the watcher to it; either way exactly one version for the save.
  await sleep(400);
  v = await versions(s.file);
  assert.equal(v.versions.length, 4);
  assert.ok(['save', 'read'].includes(v.versions[3].cause));
  ws.close();

  // Ending the review keeps the file as it was at the end.
  fs.writeFileSync(s.file, original);
  assert.equal((await world.cli(['end', s.file])).code, 0);
  v = await versions(s.file);
  assert.equal(v.versions.at(-1).cause, 'end');
  assert.equal(v.versions.at(-1).hash, v.versions[0].hash);
  assert.equal(blobs(dir).length, 3, 'the end version has the content of v1, stored once');

  const index = fs.readFileSync(path.join(dir, 'index.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(index.map((e) => e.n), [1, 2, 3, 4, 5]);
  assert.equal(fs.statSync(path.join(dir, 'index.jsonl')).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(s.file, 'utf8'), original, 'vivamark never wrote the file');
});

test('a save the watcher sees while a review page is open is kept as cause save', async () => {
  const s = await openPage('watched.html');
  const ws = await connectBrowser(s);
  await sleep(100);
  fs.writeFileSync(s.file, fs.readFileSync(s.file, 'utf8').replace('<h2>Risks</h2>', '<h2>Risks</h2>\n  <p>New.</p>'));
  const dir = () => versionsDir(s.file);
  // Read the index from disk: a read through the CLI could itself keep the version first.
  assert.ok(
    await until(() => {
      const d = dir();
      return d && fs.readFileSync(path.join(d, 'index.jsonl'), 'utf8').trim().split('\n').length === 2;
    }),
  );
  const index = fs.readFileSync(path.join(dir(), 'index.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(index.map((e) => e.cause), ['open', 'save']);
  ws.close();
});

test('one timeline per file across reviews: a reopened file carries on', async () => {
  const s1 = await openPage('timeline.html');
  assert.equal((await send(s1, [], { decision: 'approve' })).status, 201);
  assert.equal((await world.cli(['end', s1.file])).code, 0);
  // Reopened unchanged: same timeline, no new version for identical content.
  const s2 = await openPage('timeline.html', undefined, false);
  assert.notEqual(s2.id, s1.id);
  let v = await versions(s2.file);
  assert.deepEqual(v.versions.map((e) => [e.n, e.cause, e.session]), [
    [1, 'open', s1.id],
    [2, 'send', s1.id],
  ]);
  fs.writeFileSync(s2.file, fs.readFileSync(s2.file, 'utf8').replace('Rollout', 'Roll-out'));
  assert.equal((await send(s2, [ELEMENT_NOTE])).status, 201);
  v = await versions(s2.file);
  assert.deepEqual(v.versions.map((e) => [e.n, e.cause, e.session]), [
    [1, 'open', s1.id],
    [2, 'send', s1.id],
    // The edit was first seen at the Send: one version, cause send.
    [3, 'send', s2.id],
  ]);
  // Both sessions see the same timeline.
  const viaS1 = await api(s1.port, 'GET', `/api/s/${s1.id}/versions`, { token: s1.token });
  assert.deepEqual(viaS1.json.versions.map((e) => e.n), [1, 2, 3]);
  // The notes of a Send are shown on its version, whichever review asks.
  const d = await api(s1.port, 'GET', `/api/s/${s1.id}/versions/3`, { token: s1.token });
  assert.equal(d.status, 200);
  assert.deepEqual(d.json.notes.map((n) => n.comment), [ELEMENT_NOTE.comment]);
  assert.equal(d.json.notes[0].anchor.stable_id, 'step-2');
});

test('Send snapshots kept before version history appear in the timeline', async () => {
  const s = await openPage('legacy.html');
  const sent = await send(s, [ELEMENT_NOTE]);
  assert.equal(sent.status, 201);
  const html = fs.readFileSync(s.file, 'utf8');
  assert.equal((await world.cli(['stop'])).code, 0);
  // Edited since, so the version kept at the next read is different content.
  fs.writeFileSync(s.file, html.replace('Rollout', 'Roll-out'));
  // Rewind the state directory to the old layout: the Send snapshot in snapshots/<session>/, no versions/.
  const dir = versionsDir(s.file);
  const hash = sent.json.notes[0].snapshot;
  fs.mkdirSync(path.join(world.stateDir, 'snapshots', s.id), { recursive: true });
  fs.renameSync(path.join(dir, hash), path.join(world.stateDir, 'snapshots', s.id, hash));
  fs.rmSync(dir, { recursive: true });

  const v = await versions(s.file);
  const legacy = v.versions[0];
  assert.deepEqual([legacy.n, legacy.cause, legacy.hash, legacy.legacy, legacy.notes, legacy.session], [1, 'send', hash, true, 1, s.id]);
  assert.equal(legacy.path, path.join(world.stateDir, 'snapshots', s.id, hash));
  const shown = await world.cli(['show', s.file, '--version', '1']);
  assert.equal(shown.code, 0, shown.stderr);
  assert.equal(shown.stdout, html);
  assert.equal(v.versions[1].cause, 'read');
  // F2 still finds the old snapshot: the edit shows as a change since the Send.
  const view = await api(world.server().port, 'GET', `/api/s/${s.id}`, { token: s.token });
  assert.ok(view.json.changes.inserts.length > 0, JSON.stringify(view.json.changes));
});

test('an earlier version is served read-only with exactly one script tag; bad hashes are refused', async () => {
  const s = await openPage('route.html');
  fs.writeFileSync(path.join(world.pageDir, 'route-note.txt'), 'sibling asset');
  const old = fs.readFileSync(s.file, 'utf8');
  fs.writeFileSync(s.file, old.replace('Applet scaffold, save handler and container page.', 'A new step two.'));
  const v = await versions(s.file);
  const view = (await api(s.port, 'GET', `/api/s/${s.id}`, { token: s.token })).json;
  const [, , id, key, name] = view.artifact_url.split('/');
  const url = (hash, rest = name) => `/v/${id}/${key}/${hash}/${rest}`;

  const page = await api(s.port, 'GET', url(v.versions[0].hash));
  assert.equal(page.status, 200);
  assert.match(page.headers['content-security-policy'], /^sandbox allow-scripts/);
  assert.equal(page.text.match(/<script src="\/_vivamark\/sdk\.js"/g).length, 1, 'exactly one script tag');
  assert.match(page.text, /Applet scaffold, save handler and container page\./);
  assert.equal(page.text.replace(/<script src="\/_vivamark\/sdk\.js" data-vivamark-load="[a-z0-9]*"><\/script>/, ''), old, 'the version byte for byte, plus the one tag');
  // Sibling assets come from beside the file as it is now.
  const asset = await api(s.port, 'GET', url(v.versions[0].hash, 'route-note.txt'));
  assert.equal(asset.status, 200);
  assert.equal(asset.text, 'sibling asset');

  assert.equal((await api(s.port, 'GET', url('0'.repeat(64)))).status, 404, 'a hash not in this file\'s timeline');
  assert.equal((await api(s.port, 'GET', url('xyz'))).status, 404, 'not a hash');
  assert.equal((await api(s.port, 'GET', url(v.versions[0].hash.toUpperCase()))).status, 404);
  assert.equal((await api(s.port, 'GET', `/v/${id}/${'f'.repeat(64)}/${v.versions[0].hash}/${name}`)).status, 404, 'wrong artifact key');
  // A hash from another file's timeline is not served through this session.
  const other = await openPage('route-other.html', '<!doctype html><title>other</title><p>other file</p>');
  const otherHash = (await versions(other.file)).versions[0].hash;
  assert.equal((await api(s.port, 'GET', url(otherHash))).status, 404);
  assert.equal((await api(s.port, 'GET', `/api/s/${s.id}/versions/99`, { token: s.token })).status, 404);
  assert.equal((await api(s.port, 'GET', `/api/s/${s.id}/versions/1`)).status, 401, 'the API needs the session token');
});

test('a Send from an earlier version is refused; from Current it goes through', async () => {
  const s = await openPage('readonly.html');
  fs.writeFileSync(s.file, fs.readFileSync(s.file, 'utf8').replace('Rollout', 'Roll-out'));
  const v = await versions(s.file);
  const [old, now] = v.versions;
  const refused = await send(s, [ELEMENT_NOTE], { version: old.hash });
  assert.equal(refused.status, 409);
  assert.match(refused.json.error, /earlier version/);
  assert.equal((await send(s, [ELEMENT_NOTE], { version: 42 })).status, 409);
  const w = await world.cli(['wait', s.file, '--timeout', '1s']);
  assert.equal(w.code, 5, 'nothing reached the agent');
  assert.equal((await send(s, [ELEMENT_NOTE], { version: now.hash })).status, 201);
});

test('show --version prints a version for the agent to write back; versions lists them', async () => {
  const s = await openPage('show.html');
  const first = fs.readFileSync(s.file, 'utf8');
  fs.writeFileSync(s.file, first.replace('Rollout', 'Roll-out'));
  await versions(s.file);
  const text = await world.cli(['show', s.file, '--version', '1']);
  assert.equal(text.code, 0, text.stderr);
  assert.equal(text.stdout, first, 'stdout is the content, unchanged');
  assert.match(text.stderr, /^v1 /);
  const json = JSON.parse((await world.cli(['show', s.file, '--version', '1', '--json'])).stdout);
  assert.equal(json.schema, 'vivamark.version/1');
  assert.equal(json.content, first);
  assert.equal(json.version.n, 1);
  assert.equal(json.version.cause, 'open');
  assert.ok(fs.existsSync(json.version.path));
  const byHash = await world.cli(['show', s.file, '--version', json.version.hash.slice(0, 10)]);
  assert.equal(byHash.stdout, first);
  assert.equal((await world.cli(['show', s.file, '--version', '9'])).code, 1);
  assert.equal((await world.cli(['show', s.file])).code, 2);
  const list = await world.cli(['versions', s.file]);
  assert.equal(list.code, 0);
  assert.match(list.stdout, /^2 versions of .*show\.html, oldest first:$/m);
  assert.match(list.stdout, /^  v1  \S+  opened/m);
  assert.match(list.stdout, /^  v2  \S+  read .*\(current\)$/m);
  assert.notEqual(fs.readFileSync(s.file, 'utf8'), first, 'show never writes the file');
});

test('compare: Show changes between any two versions', async () => {
  const s = await openPage('compare.html');
  fs.writeFileSync(s.file, fs.readFileSync(s.file, 'utf8').replace('<h2>Risks</h2>', '<h2>Risks</h2>\n  <p>Compared paragraph.</p>'));
  await versions(s.file);
  const c = await api(s.port, 'GET', `/api/s/${s.id}/compare?from=1&to=current`, { token: s.token });
  assert.equal(c.status, 200, c.text);
  assert.ok(c.json.inserts.some((i) => i.text.includes('Compared paragraph.')), c.text);
  const back = await api(s.port, 'GET', `/api/s/${s.id}/compare?from=2&to=1`, { token: s.token });
  assert.ok(back.json.removals.some((r) => r.text.includes('Compared paragraph.')));
  assert.equal((await api(s.port, 'GET', `/api/s/${s.id}/compare?from=../x&to=1`, { token: s.token })).status, 400);
});

test('version.saved events carry metadata only, never the content', async () => {
  const secret = 'Sekrit-version-content-7731';
  const s = await openPage('ev-versions.html', `<!doctype html><title>x</title><p id="p">${secret}</p>`);
  fs.writeFileSync(s.file, `<!doctype html><title>x</title><p id="p">${secret} 2</p>`);
  await versions(s.file);
  const saved = events().filter((e) => e.type === 'version.saved' && e.session === s.id);
  assert.deepEqual(saved.map((e) => [e.version, e.cause]), [
    [1, 'open'],
    [2, 'read'],
  ]);
  for (const e of saved) {
    assert.deepEqual(Object.keys(e).sort(), ['at', 'cause', 'file', 'hash', 'labels', 'seq', 'session', 'size', 'type', 'version']);
    assert.equal(e.hash.length, 64);
  }
  const raw = fs.readFileSync(path.join(world.stateDir, 'events.jsonl'), 'utf8');
  assert.ok(!raw.includes(secret), 'no content in the event log');
  assert.ok(!raw.includes(path.join(world.stateDir, 'versions')), 'no content path in the event log');
});

test('review page: the Versions picker shows an earlier version read-only, compares, and queues a restore note', { timeout: 90_000 }, async (t) => {
  if (!browser) {
    t.skip(`Playwright Chromium is not available (${launchError?.message.split('\n')[0] ?? 'playwright-core not installed'}); run: npx playwright install chromium`);
    return;
  }
  const s = await openPage('picker.html');
  const original = fs.readFileSync(s.file, 'utf8');
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const problems = [];
  await page.route('**/*', (route) => (['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort()));
  page.on('pageerror', (err) => problems.push(err.message));
  try {
    await page.goto(s.out.url);
    const frame = () => page.frames().find((f) => /\/(a|v)\//.test(f.url()));
    await page.frameLocator('#page').locator('#step-2').waitFor();
    fs.writeFileSync(s.file, original.replace('Applet scaffold, save handler and container page.', 'Applet scaffold and container page.'));
    await page.waitForFunction(() => document.getElementById('versions-btn').textContent === 'Versions · 2', null, { timeout: 10_000 });

    await page.click('#versions-btn');
    assert.equal(await page.locator('.version-row').count(), 3, 'Current and two versions');
    assert.equal(await page.locator('.version-row[aria-current="true"]').getAttribute('data-version'), 'current');
    await page.click('.version-row[data-version="1"]');
    await page.waitForFunction(() => !document.getElementById('version-bar').hidden);
    await page.waitForFunction(() => [...document.querySelectorAll('iframe')].some((f) => f.src.includes('/v/')));
    await page.frameLocator('#page').locator('#step-2', { hasText: 'save handler' }).waitFor();
    assert.match(frame().url(), /\/v\/s_[a-z0-9]+\/[0-9a-f]{64}\/[0-9a-f]{64}\/picker\.html\?vmload=/);
    assert.equal(await page.isHidden('#composer'), true, 'no composer on an earlier version');
    assert.equal(await page.isVisible('#readonly'), true);
    assert.match(await page.textContent('#readonly'), /can't be added or sent/);
    assert.equal(await page.isDisabled('#approve'), true);
    assert.equal(await page.isDisabled('#send'), true);
    // The page's own script cannot make a note on it.
    await frame().evaluate(() => {
      const load = document.querySelector('script[data-vivamark-load]').dataset.vivamarkLoad;
      window.parent.postMessage({ vivamark: 1, load, type: 'pick', kind: 'element', anchor: { stable_id: 'step-2', selector: '#step-2' } }, '*');
    });
    await sleep(200);
    assert.equal(await page.textContent('#target-text'), 'the whole page');

    // Compare with Current: Show changes lights up.
    await page.click('#versions-btn');
    await page.selectOption('#compare-select', 'current');
    await page.waitForFunction(() => document.getElementById('show-changes').getAttribute('aria-pressed') === 'true');
    await frame().locator('[data-vivamark-change]').first().waitFor();
    await page.keyboard.press('Escape');

    // Restore: an ordinary queued note; nothing is sent until Send.
    await page.click('#restore');
    await page.waitForFunction(() => document.getElementById('version-bar').hidden);
    await page.waitForSelector('.note.queued');
    const w = startCli(['wait', s.file, '--json'], world.env);
    await sleep(500);
    assert.equal(w.child.exitCode, null, 'the restore request waits for Send');
    await page.click('#send');
    const r = await w.done;
    assert.equal(r.code, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    const note = out.notes[0];
    const v1 = (await versions(s.file)).versions[0];
    assert.equal(note.kind, 'page');
    assert.match(note.comment, /restore version 1/);
    assert.ok(note.comment.includes(v1.hash), 'the hash');
    assert.ok(note.comment.includes(v1.path), 'the local snapshot path');
    assert.ok(note.comment.includes('--version 1'));
    assert.equal(fs.readFileSync(v1.path, 'utf8'), original);
    assert.notEqual(fs.readFileSync(s.file, 'utf8'), original, 'vivamark did not restore the file itself');
    assert.deepEqual(problems, []);
  } finally {
    await page.close();
  }
});
