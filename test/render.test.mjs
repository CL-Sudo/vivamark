// vivamark render: finding the browser (never downloading one), the launch
// flags that keep it off the network, a page that asks for external things
// making no request at all, what the drawing reports, the PNGs, and the
// read-only promise. The tests that draw are skipped where no Chrome or
// Chromium is installed.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import zlib from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { CHROME_NAMES, RENDER_SCHEMA, RESOLVER_CHECK_HOST, RenderError, chromeArgs, findChrome, renderPage } from '../dist/internal.js';
import { EGRESS_GUARD, ROOT, runCli } from './helpers/harness.mjs';

const NO_STATE = '/nonexistent/vivamark-render-should-not-be-created';
const env = { ...process.env, VIVAMARK_STATE_DIR: NO_STATE };
const fixture = (name) => path.join(ROOT, 'test', 'fixtures', name);

let chrome = null;
try {
  chrome = findChrome();
} catch {
  // VIVAMARK_CHROME set to something unusable: draw nothing.
}
const needsChrome = chrome ? false : 'no Chrome or Chromium on this machine';

let dir;
before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vivamark-render-test-'));
});
after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

async function render(file, args = [], extraEnv = {}) {
  const out = path.join(dir, `out-${Math.random().toString(36).slice(2)}`);
  const r = await runCli(['render', file, '--out', out, '--json', ...args], { ...env, ...extraEnv }, { timeoutMs: 60_000 });
  return { code: r.code, stderr: r.stderr, out, ...(r.stdout ? JSON.parse(r.stdout) : {}) };
}

/** A PNG's width and height, from its header. */
function pngSize(file) {
  const b = fs.readFileSync(file);
  assert.equal(b.subarray(1, 4).toString('latin1'), 'PNG', `${file} is a PNG`);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

test('the launch flags close every way out: no host resolves, a dead proxy for everything, no background traffic', () => {
  const args = chromeArgs('/tmp/profile');
  for (const flag of [
    '--headless=new',
    '--remote-debugging-pipe',
    '--user-data-dir=/tmp/profile',
    '--host-resolver-rules=MAP * ~NOTFOUND',
    '--proxy-server=127.0.0.1:9',
    `--proxy-bypass-list=<-loopback>;${RESOLVER_CHECK_HOST}`,
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--no-pings',
  ]) {
    assert.ok(args.includes(flag), flag);
  }
  assert.ok(!args.some((a) => /remote-debugging-port/.test(a)), 'no debugging port: a pipe only');
  // The one name that skips the proxy can only ever mean this machine.
  assert.match(RESOLVER_CHECK_HOST, /^[a-z-]+\.localhost$/);
});

test('finding the browser: VIVAMARK_CHROME first, then the names on PATH, never a download', () => {
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const fake = path.join(bin, 'chromium');
  fs.writeFileSync(fake, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  assert.equal(findChrome({ PATH: bin }, false), fake, 'a name on PATH');
  assert.equal(findChrome({ PATH: '', VIVAMARK_CHROME: fake }, false), fake, 'a path in VIVAMARK_CHROME');
  assert.equal(findChrome({ PATH: bin, VIVAMARK_CHROME: 'chromium' }, false), fake, 'a name in VIVAMARK_CHROME');
  if (process.platform !== 'darwin') assert.equal(findChrome({ PATH: '' }, false), null, 'none');
  assert.throws(() => findChrome({ PATH: '', VIVAMARK_CHROME: path.join(dir, 'missing') }, false), (e) => e instanceof RenderError && /is not a program/.test(e.message));
  const exe = path.join(bin, 'chrome.exe');
  fs.writeFileSync(exe, '', { mode: 0o755 });
  assert.throws(() => findChrome({ PATH: '', VIVAMARK_CHROME: exe }, true), (e) => e instanceof RenderError && /Windows program.*Install Chrome or Chromium inside WSL/s.test(e.message));
  assert.deepEqual(CHROME_NAMES, ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']);
});

test('no browser: a clear error naming what was looked for, exit 1, nothing written', async () => {
  const out = path.join(dir, 'none');
  const r = await runCli(['render', fixture('amend-after.html'), '--out', out], { ...env, PATH: '', VIVAMARK_CHROME: '' });
  if (process.platform === 'darwin' && r.code === 0) return; // A Chrome in /Applications was found.
  assert.equal(r.code, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /^vivamark: no Chrome or Chromium found: looked for VIVAMARK_CHROME, then google-chrome, google-chrome-stable, chromium, chromium-browser on PATH\. .*never downloads a browser/);
  assert.equal(fs.existsSync(out), false);
});

test('bad usage exits 1', async () => {
  for (const args of [['render'], ['render', 'a.html', 'b.html'], ['render', path.join(ROOT, 'examples', 'plan.md')], ['render', path.join(dir, 'missing.html')], ['render', fixture('amend-after.html'), '--width', '50'], ['render', '--frobnicate', 'x.html']]) {
    const r = await runCli(args, env);
    assert.equal(r.code, 1, args.join(' '));
    assert.match(r.stderr, /^vivamark: /);
  }
});

test('a page amended badly: the black bracket and the cut-off label are errors, measured; amended well it is clean', { skip: needsChrome }, async () => {
  const bad = await render(fixture('amend-before.html'));
  assert.equal(bad.code, 1, bad.stderr);
  assert.equal(bad.schema, RENDER_SCHEMA);
  const of = (rule) => bad.problems.filter((p) => p.rule === rule);
  assert.equal(of('unfilled-shape').length, 1, JSON.stringify(bad.problems));
  assert.equal(of('unfilled-shape')[0].element, 'bracket-readers');
  assert.equal(of('unfilled-shape')[0].figure, 'viz-store');
  assert.equal(typeof of('unfilled-shape')[0].line, 'number');
  assert.ok(of('text-clipped').some((p) => /^"keeps drafts in JSON files, one per draft" spans x 514\.\./.test(p.message)), JSON.stringify(bad.problems));
  assert.ok(of('text-overflow').some((p) => p.element === 'node-store' && /runs out of its box \(x 380\.\.632\)/.test(p.message)), JSON.stringify(bad.problems));
  const good = await render(fixture('amend-after.html'));
  assert.equal(good.code, 0, JSON.stringify(good.problems));
  const dark = await render(fixture('amend-after.html'), ['--dark', '--width', '390']);
  assert.equal(dark.code, 0, JSON.stringify(dark.problems));
  assert.equal(dark.mode, 'dark');
});

test('it writes a PNG of the page at the asked width and one per figure, and never writes the page', { skip: needsChrome }, async () => {
  const file = path.join(dir, 'page.html');
  fs.copyFileSync(fixture('amend-after.html'), file);
  const hash = () => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const before = [hash(), fs.statSync(file).mtimeMs, fs.readdirSync(dir).length];
  const r = await render(file, ['--width', '800']);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual([hash(), fs.statSync(file).mtimeMs, fs.readdirSync(dir).length - 1], before, 'the page untouched, nothing beside it but the out folder');
  assert.equal(path.dirname(r.page_png), r.out);
  assert.equal(pngSize(r.page_png)[0], 800);
  assert.deepEqual(r.figure_pngs.map((f) => f.figure), ['viz-store']);
  const [w, h] = pngSize(r.figure_pngs[0].path);
  assert.ok(w > 300 && w < 800 && h > 100, `a figure-sized PNG: ${w}x${h}`);
  assert.equal(fs.existsSync(NO_STATE), false, 'no state directory');
  // The text form lists the PNGs.
  const text = await runCli(['render', file, '--out', path.join(dir, 'text')], env, { timeoutMs: 60_000 });
  assert.equal(text.code, 0);
  assert.match(text.stdout, /rendered light at 1000 px with .*; clean\n  page    .*page\.light\.1000\.png\n  #viz-store  .*page\.viz-store\.light\.1000\.png\n/);
});

test('a page that asks for external things makes no request: refused by the browser, and stopped by each launch flag alone', { skip: needsChrome }, async () => {
  // A listener on loopback, at an explicit port, counting every request that reaches it.
  let hits = 0;
  const server = http.createServer((req, res) => {
    hits++;
    res.end();
  });
  const port = 20000 + Math.floor(Math.random() * 12000);
  await new Promise((resolve, reject) => server.once('error', reject).listen(port, '127.0.0.1', resolve));
  try {
    // The listener works, so a silent run means something.
    await new Promise((resolve) => http.get(`http://127.0.0.1:${port}/check`, (res) => res.resume().on('end', resolve)));
    assert.equal(hits, 1);
    hits = 0;
    const local = `http://127.0.0.1:${port}`;
    const file = path.join(dir, 'outbound.html');
    fs.writeFileSync(
      file,
      `<!doctype html><html><head><meta charset="utf-8"><title>Outbound</title>` +
        `<link rel="stylesheet" href="${local}/style.css"><style>@import url("${local}/import.css"); body { background: url(${local}/bg.png); }</style></head>` +
        `<body><main><p>One page.</p><img src="${local}/pixel.png" alt="x"><img src="http://example.invalid/pixel.png" alt="y">` +
        `<img src="http://localhost:${port}/name.png" alt="z"><img src="https://example.com/pixel.png" alt="w"><img src="http://${RESOLVER_CHECK_HOST}:${port}/resolver.png" alt="v">` +
        `<iframe src="https://example.invalid/"></iframe></main></body></html>`,
    );
    const log = path.join(dir, 'egress.jsonl');
    const r = await render(file, [], { NODE_OPTIONS: `--import ${new URL(`file://${EGRESS_GUARD}`).href}`, VIVAMARK_EGRESS_LOG: log });
    assert.equal(r.code, 1, r.stderr);
    assert.ok(r.blocked.includes(`${local}/pixel.png`), JSON.stringify(r.blocked));
    assert.ok(r.blocked.includes('http://example.invalid/pixel.png'), JSON.stringify(r.blocked));
    for (const asked of ['style.css', 'import.css']) assert.ok(r.blocked.includes(`${local}/${asked}`), `${asked}: ${JSON.stringify(r.blocked)}`);
    assert.ok(r.problems.some((p) => p.rule === 'outbound-request' && p.severity === 'error' && p.message.includes(`${local}/pixel.png`)));
    assert.equal(hits, 0, 'nothing reached the listener');
    assert.equal(fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '', '', 'and the CLI itself made no connection');
    const asked = [`${local}/pixel.png`, `${local}/style.css`, `${local}/import.css`, `http://localhost:${port}/name.png`, 'http://example.invalid/pixel.png', 'https://example.com/pixel.png'];
    const errorOf = (res, url) => res.failed.find((f) => f.url === url)?.error;
    for (const url of [...asked, `http://${RESOLVER_CHECK_HOST}:${port}/resolver.png`]) assert.equal(errorOf(r, url), 'net::ERR_BLOCKED_BY_CLIENT.Inspector', `refused by render: ${url}`);
    // Without the DevTools refusal, the launch flags stop each request themselves, and the browser says which:
    // every one at the dead proxy (loopback included), and the one name that skips the proxy at the resolver rule.
    const flagsOnly = await renderPage(file, { outDir: path.join(dir, 'flags-only'), intercept: false });
    assert.deepEqual(flagsOnly.blocked, []);
    for (const url of asked) assert.equal(errorOf(flagsOnly, url), 'net::ERR_PROXY_CONNECTION_FAILED', `stopped at the dead proxy: ${url} ${JSON.stringify(flagsOnly.failed)}`);
    assert.equal(errorOf(flagsOnly, `http://${RESOLVER_CHECK_HOST}:${port}/resolver.png`), 'net::ERR_NAME_NOT_RESOLVED', `stopped by the resolver rule: ${JSON.stringify(flagsOnly.failed)}`);
    assert.equal(hits, 0, 'nothing reached the listener with the flags alone');
  } finally {
    server.close();
  }
});

/** A page holding one figure: the SVG parts given, with the design CSS's box and text rules. */
function figurePage(name, parts, body = '') {
  const file = path.join(dir, name);
  fs.writeFileSync(
    file,
    `<!doctype html><html><head><meta charset="utf-8"><title>${name}</title><style>:root { --panel: #fff; --muted: #789; --fg2: #333; }` +
      ` .viz svg { display: block; width: 640px; } .viz svg text { fill: var(--fg2); font: 12px sans-serif; } .viz svg .box { fill: var(--panel); stroke: var(--muted); }</style></head>` +
      `<body><main><figure class="viz" id="viz-one"><svg viewBox="0 0 640 200" role="img" aria-label="one">${parts}</svg></figure>${body}</main></body></html>`,
  );
  return file;
}

test('render: text that leaves its box on the right only is a warning, measured; inside the figure it is not clipped', { skip: needsChrome }, async () => {
  const long = 'orders this week and orders the week before that one';
  const r = await render(figurePage('right.html', `<g id="node-right"><rect class="box" x="10" y="40" width="200" height="40"/><text x="20" y="64">${long}</text></g>`));
  assert.equal(r.code, 2, JSON.stringify(r.problems));
  assert.deepEqual(r.problems.map((p) => p.rule), ['text-overflow']);
  assert.match(r.problems[0].message, /^"orders this week.*" is \d+ wide \(x 20\.\.\d+\) and runs out of its box \(x 10\.\.210\)$/);
  assert.equal(r.problems[0].element, 'node-right');
  const fits = await render(figurePage('fits.html', '<g id="node-fits"><rect class="box" x="10" y="40" width="200" height="40"/><text x="20" y="64">orders</text></g>'));
  assert.equal(fits.code, 0, JSON.stringify(fits.problems));
});

test('render: page script does not run, so what is drawn is the saved markup', { skip: needsChrome }, async () => {
  const script =
    '<script>const d = document.createElement("figure"); d.className = "viz"; d.id = "viz-script-ran"; d.style.cssText = "width:40px;height:40px"; document.body.append(d);' +
    ' document.querySelector("#viz-one text").textContent = "changed by script";</script>';
  const r = await render(figurePage('script.html', '<g id="node-s"><rect class="box" x="10" y="40" width="200" height="40"/><text x="20" y="64">orders</text></g>', script));
  assert.deepEqual(r.figure_pngs.map((f) => f.figure), ['viz-one'], 'no figure added by script');
  assert.equal(r.code, 0, JSON.stringify(r.problems));
});

/** The first pixel of a PNG: on the first row every filter leaves it as stored. */
function firstPixel(file) {
  const b = fs.readFileSync(file);
  const idat = [];
  for (let at = 8; at < b.length; ) {
    const len = b.readUInt32BE(at);
    if (b.toString('latin1', at + 4, at + 8) === 'IDAT') idat.push(b.subarray(at + 8, at + 8 + len));
    at += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  return [raw[1], raw[2], raw[3]];
}

test('render --dark draws the page in its dark colours', { skip: needsChrome }, async () => {
  const file = path.join(dir, 'scheme.html');
  fs.writeFileSync(file, '<!doctype html><html><head><meta charset="utf-8"><title>scheme</title><style>html, body { margin: 0; background: #ffffff; } @media (prefers-color-scheme: dark) { html, body { background: #0b1220; } }</style></head><body><main><p>Orders.</p></main></body></html>');
  const dark = await render(file, ['--dark']);
  assert.equal(dark.code, 0, JSON.stringify(dark.problems));
  assert.deepEqual(firstPixel(dark.page_png), [0x0b, 0x12, 0x20]);
  const light = await render(file);
  assert.deepEqual(firstPixel(light.page_png), [0xff, 0xff, 0xff]);
});

test('a figure that scrolls sideways on a narrow page is drawn whole, then put back', { skip: needsChrome }, async () => {
  const file = figurePage('narrow.html', '<g id="node-wide"><rect class="box" x="10" y="40" width="600" height="40"/><text x="600" y="64" text-anchor="end">orders</text></g>');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('</style>', ' .viz { overflow-x: auto; margin: 0; }</style>'));
  const r = await render(file, ['--width', '390']);
  assert.equal(r.code, 0, JSON.stringify(r.problems));
  assert.deepEqual(r.figure_pngs.map((f) => [f.figure, f.whole]), [['viz-one', true]]);
  const [w] = pngSize(r.figure_pngs[0].path);
  assert.ok(w >= 640, `the whole 640-wide SVG, not the 390 px slice: ${w}`);
  // The page PNG is taken after the figures, measured again: a figure left widened would make it wider.
  assert.equal(pngSize(r.page_png)[0], 390, 'the figure put back: the page drawn as the reviewer sees it');
  const wide = await render(file, ['--width', '1000']);
  assert.deepEqual(wide.figure_pngs.map((f) => f.whole), [false], 'a figure that fits is drawn as it is');
});
