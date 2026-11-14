// Themes without a browser: which theme a review page starts in, the fonts
// the themes use (bundled, licensed, served by the daemon and nothing else),
// and the marks in the agent's page drawn from theme tokens only.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { api, makeWorld, openSession, ROOT } from './helpers/harness.mjs';

const { DEFAULT_THEME, MARK_TOKENS, THEMES, themeConfig } = await import(path.join(ROOT, 'dist', 'internal.js'));

let world;
before(() => {
  world = makeWorld({ guardEgress: true });
});
after(async () => {
  await world.cleanup();
});

function configDir(json) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vivamark-theme-'));
  fs.mkdirSync(path.join(dir, 'vivamark'));
  if (json !== undefined) fs.writeFileSync(path.join(dir, 'vivamark', 'config.json'), JSON.stringify(json));
  return dir;
}

test('the default theme: VIVAMARK_THEME, else "theme" in config.json, else Gumdrop; a name that is no theme is ignored', () => {
  assert.equal(DEFAULT_THEME, 'gumdrop');
  assert.deepEqual(
    THEMES.map((t) => t.id),
    ['gumdrop', 'raster', 'raw', 'pinboard', 'signal', 'sticker', 'riso', 'bauhaus', 'smooth-glass'],
  );
  const none = configDir();
  const file = configDir({ theme: 'Raster' });
  const bad = configDir({ theme: 'neon' });
  const errors = [];
  const orig = console.error;
  console.error = (m) => errors.push(String(m));
  try {
    assert.equal(themeConfig({ XDG_CONFIG_HOME: none }).theme, 'gumdrop');
    assert.equal(themeConfig({ XDG_CONFIG_HOME: file }).theme, 'raster');
    assert.equal(themeConfig({ XDG_CONFIG_HOME: file, VIVAMARK_THEME: 'pinboard' }).theme, 'pinboard');
    assert.equal(themeConfig({ XDG_CONFIG_HOME: file, VIVAMARK_THEME: 'nope' }).theme, 'raster');
    assert.equal(themeConfig({ XDG_CONFIG_HOME: bad }).theme, 'gumdrop');
  } finally {
    console.error = orig;
  }
  assert.equal(errors.length, 2, errors.join('\n'));
  assert.ok(errors.every((e) => /not one of gumdrop, raster/.test(e)), errors.join('\n'));
  for (const d of [none, file, bad]) fs.rmSync(d, { recursive: true, force: true });
});

test('the review page is served in the configured theme, with every font from the daemon itself and nothing from elsewhere', async () => {
  const cfg = path.join(world.env.XDG_CONFIG_HOME, 'vivamark');
  fs.mkdirSync(cfg, { recursive: true });
  fs.writeFileSync(path.join(cfg, 'config.json'), JSON.stringify({ theme: 'bauhaus' }));
  const s = await openSession(world);
  const chrome = await api(s.port, 'GET', `/s/${s.id}`);
  assert.equal(chrome.status, 200);
  assert.match(chrome.text, /<html lang="en" data-default-theme="bauhaus">/);
  assert.match(chrome.headers['content-security-policy'], /font-src 'self'/);
  // The boot script that applies it before the first paint.
  assert.match(chrome.text, /<script src="\/_vivamark\/theme\.js"><\/script>\s*<link rel="stylesheet"/);
  assert.equal((await api(s.port, 'GET', '/_vivamark/theme.js')).status, 200);

  const css = await api(s.port, 'GET', '/_vivamark/chrome.css');
  assert.equal(css.status, 200);
  assert.doesNotMatch(css.text, /@import/i);
  const urls = [...css.text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map((m) => m[1]);
  const fonts = urls.filter((u) => !u.startsWith('data:'));
  assert.ok(fonts.length >= 11, `the stylesheet names the bundled fonts: ${fonts.join(', ')}`);
  for (const u of fonts) {
    assert.match(u, /^\/_vivamark\/fonts\/[a-z0-9-]+\.woff2$/, `${u} is served by the daemon`);
    const r = await api(s.port, 'GET', u);
    assert.equal(r.status, 200, u);
    assert.equal(r.headers['content-type'], 'font/woff2', u);
    assert.ok(r.text.startsWith('wOF2'), `${u} is a WOFF2 file`);
  }
  for (const bad of ['/_vivamark/fonts/../cli.js', '/_vivamark/fonts/nope.woff2', '/_vivamark/fonts/lexend.OFL.txt']) {
    assert.equal((await api(s.port, 'GET', bad)).status, 404, bad);
  }
  assert.equal((await world.cli(['stop'])).code, 0);
  assert.deepEqual(world.egress(), [], 'no vivamark process tried to leave the machine');
});

test('every bundled font has its licence beside it and an entry in THIRD-PARTY-NOTICES.md', () => {
  const dir = path.join(ROOT, 'src', 'ui', 'fonts');
  const notices = fs.readFileSync(path.join(ROOT, 'THIRD-PARTY-NOTICES.md'), 'utf8');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.woff2'));
  assert.ok(files.length >= 11);
  for (const f of files) {
    const family = f.replace(/(-[47]00)?\.woff2$/, '');
    const licence = fs.readFileSync(path.join(dir, `${family}.OFL.txt`), 'utf8');
    assert.match(licence, /SIL Open Font License, Version 1\.1/, family);
    assert.ok(notices.includes(`\`${f}\``), `${f} is listed in THIRD-PARTY-NOTICES.md`);
    assert.ok(fs.existsSync(path.join(ROOT, 'dist', 'ui', 'fonts', f)), `${f} ships in dist/`);
  }
});

test('the marks in the page are drawn from theme tokens only, and every theme sets all of them', () => {
  const sdk = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'sdk.ts'), 'utf8');
  // Today's sky blue and yellow, and their rgba forms, are gone from the page script.
  for (const old of ['#0ea5e9', '14,165,233', '14, 165, 233', '250,204,21', '250, 204, 21', '#0369a1', '#8b5cf6', '#be123c']) {
    assert.ok(!sdk.includes(old), `sdk.ts still has ${old}`);
  }
  // Its only colours are the plain ink it draws with before a theme arrives.
  const colours = new Set(sdk.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []);
  assert.deepEqual([...colours].sort(), ['#111111', '#ffffff']);
  const base = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'chrome.css'), 'utf8');
  for (const name of MARK_TOKENS) assert.ok(base.includes(`${name}:`), `chrome.css sets ${name}`);
  for (const t of THEMES) {
    if (t.id === 'smooth-glass') continue; // its values are the base ones
    const css = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'themes', `${t.id}.css`), 'utf8');
    assert.ok(css.includes(`:root[data-theme="${t.id}"]`), `${t.id}.css is scoped to its theme`);
    for (const name of MARK_TOKENS) assert.ok(css.includes(`${name}:`), `${t.id}.css sets ${name}`);
    assert.doesNotMatch(css, /url\(\s*["']?(https?:)?\/\//, `${t.id}.css fetches nothing`);
  }
});
