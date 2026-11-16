// Themes without a browser: which theme a review page starts in, the fonts
// the themes use (bundled, licensed, served by the daemon and nothing else),
// the marks in the agent's page drawn from theme tokens only, and the page
// tokens each theme offers the page (complete, opaque, at the floor), and the
// design CSS's own names mapped to them for pages written before them.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { api, makeWorld, openSession, ROOT } from './helpers/harness.mjs';

const { DEFAULT_THEME, GUIDE_NAMES, GUIDE_SIGNATURE, MARK_TOKENS, PAGE_CSS, PAGE_COLOURS, PAGE_FACES, PAGE_THEMES, PAGE_TOKENS, THEMES, contrast, guideNamesRule, pageContrastFailures, themeConfig } = await import(
  path.join(ROOT, 'dist', 'internal.js'),
);

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

test('every theme offers the page the same small set of page tokens, its colours opaque and at the floor', () => {
  assert.ok(PAGE_TOKENS.length <= 24, 'a small set');
  assert.ok(PAGE_TOKENS.every((n) => n.startsWith('--vivamark-')), 'one prefix, unlikely to be a page\'s own');
  assert.deepEqual(Object.keys(PAGE_THEMES).sort(), THEMES.map((t) => t.id).sort());
  // The contrast helper itself, on known pairs.
  assert.equal(contrast('#000000', '#ffffff').toFixed(1), '21.0');
  assert.equal(contrast('#777777', '#ffffff').toFixed(2), '4.48');
  for (const t of THEMES) {
    const tokens = PAGE_THEMES[t.id];
    assert.deepEqual(Object.keys(tokens), [...PAGE_TOKENS], `${t.id} sets every page token, in order`);
    for (const name of PAGE_COLOURS) assert.match(tokens[name], /^#[0-9a-f]{6}$/, `${t.id} ${name} is an opaque colour`);
    assert.equal(tokens['--vivamark-scheme'], 'light', `${t.id} is a light theme`);
    assert.match(tokens['--vivamark-radius'], /^\d+px$/);
    assert.doesNotMatch(Object.values(tokens).join(' '), /url\(|[;{}<>\\]/, `${t.id}: plain values, nothing to fetch`);
    assert.deepEqual(pageContrastFailures(tokens), [], `${t.id}: every pair a page may use at 4.5:1`);
  }
  // Each theme reads as itself: no two share background, text and accent.
  const looks = new Set(THEMES.map((t) => ['bg', 'text', 'accent'].map((k) => PAGE_THEMES[t.id][`--vivamark-${k}`]).join()));
  assert.equal(looks.size, THEMES.length);
});

test('the page tokens\' fonts are bundled faces under names of their own, the theme\'s own face first', () => {
  const dir = path.join(ROOT, 'src', 'ui', 'fonts');
  const fontsCss = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'fonts.css'), 'utf8');
  for (const f of PAGE_FACES) {
    assert.ok(fs.existsSync(path.join(dir, f.file)), `${f.file} is bundled`);
    assert.match(f.family, /^vivamark /, 'never the plain name a page might use for a font of its own');
    // The same face and weights as the review page's own @font-face.
    const plain = f.family.replace(/^vivamark /, '');
    assert.ok(fontsCss.includes(`font-family: "${plain}"; src: url("/_vivamark/fonts/${f.file}") format("woff2"); font-weight: ${f.weight};`), `${f.file} as in fonts.css`);
  }
  const families = new Set(PAGE_FACES.map((f) => f.family));
  for (const t of THEMES) {
    const css = t.id === 'smooth-glass' ? fs.readFileSync(path.join(ROOT, 'src', 'ui', 'chrome.css'), 'utf8') : fs.readFileSync(path.join(ROOT, 'src', 'ui', 'themes', `${t.id}.css`), 'utf8');
    const ui = /--ui: ([^;]+);/.exec(css)[1];
    const display = /--display: ([^;]+);/.exec(css)?.[1];
    for (const name of ['--vivamark-font-body', '--vivamark-font-heading']) {
      const first = PAGE_THEMES[t.id][name].split(',')[0].trim().replace(/"/g, '');
      if (t.id === 'smooth-glass') {
        assert.equal(first, 'Inter', 'Smooth glass, like its review page, has no bundled face');
        continue;
      }
      assert.ok(families.has(first), `${t.id} ${name}: ${first} is a bundled face`);
      const chromeFace = (name === '--vivamark-font-heading' && display && !display.startsWith('var(') ? display : ui).split(',')[0].trim().replace(/"/g, '');
      assert.equal(first, `vivamark ${chromeFace}`, `${t.id} ${name}: the face its review page uses`);
    }
  }
});

test('the agent\'s page is served with the reviewer\'s theme for its page tokens, and may use the bundled fonts, nothing more', async () => {
  const other = makeWorld({ guardEgress: true });
  try {
    const s = await openSession(other);
    const base = `/a/${s.id}/${s.record.artifact_key}/${path.basename(other.page)}`;
    const tag = (text) => /<script src="\/_vivamark\/sdk\.js"[^>]*><\/script>/.exec(text)?.[0];
    const served = await api(s.port, 'GET', `${base}?vmload=abc&vmtheme=riso`);
    assert.equal(served.status, 200);
    assert.equal(tag(served.text), '<script src="/_vivamark/sdk.js" data-vivamark-load="abc" data-vivamark-theme="riso"></script>');
    assert.equal((served.text.match(/<script/g) ?? []).length - (fs.readFileSync(other.page, 'utf8').match(/<script/g) ?? []).length, 1, 'still exactly one script tag added');
    // No theme, or one that is not a theme: the server's default, never the text as given.
    for (const q of ['', '&vmtheme=neon', '&vmtheme=%22%3E%3Cscript%3E']) {
      const r = await api(s.port, 'GET', `${base}?vmload=abc${q}`);
      assert.match(tag(r.text), / data-vivamark-theme="gumdrop"><\/script>$/, q);
    }
    // Fonts answer a frame of opaque origin, and only fonts do.
    const font = await api(s.port, 'GET', '/_vivamark/fonts/lexend.woff2');
    assert.equal(font.headers['access-control-allow-origin'], 'null');
    for (const p of ['/_vivamark/sdk.js', `/s/${s.id}`, base]) assert.equal((await api(s.port, 'GET', p)).headers['access-control-allow-origin'], undefined, p);
    assert.deepEqual(other.egress(), []);
  } finally {
    await other.cleanup();
  }
});

test("the design CSS's own names map to the page tokens exactly as PAGE_CSS reads them, for pages written before the tokens", () => {
  const start = PAGE_CSS.indexOf(':root {');
  const root = PAGE_CSS.slice(start, PAGE_CSS.indexOf('\n}', start));
  const darkStart = PAGE_CSS.indexOf('@media (prefers-color-scheme: dark)');
  const dark = PAGE_CSS.slice(darkStart, PAGE_CSS.indexOf('\n}\n', darkStart));
  // Each name PAGE_CSS reads from a token maps to that same token.
  const read = {};
  for (const [, name, token] of root.matchAll(/(--[a-z0-9-]+): var\((--vivamark-[a-z-]+), /g)) read[name] = `var(${token})`;
  assert.ok(Object.keys(read).length >= 20, Object.keys(read).join(' '));
  for (const [name, v] of Object.entries(read)) assert.equal(GUIDE_NAMES[name], v, `${name} maps as PAGE_CSS reads it`);
  // --r-sm is worked out from --r; everything else in the map is one of PAGE_CSS's names.
  assert.match(root, /--r-sm: calc\(var\(--r\) \* \.625\)/);
  assert.equal(GUIDE_NAMES['--r-sm'], 'calc(var(--vivamark-radius) * .625)');
  assert.deepEqual(Object.keys(GUIDE_NAMES).sort(), [...Object.keys(read), '--r-sm'].sort());
  // Every name an older page changes for dark is mapped, so a dark system never shows through.
  for (const [, name] of dark.matchAll(/(--[a-z0-9-]+):/g)) assert.ok(name in GUIDE_NAMES, `${name}, set for dark, is mapped`);
  for (const name of GUIDE_SIGNATURE) assert.ok(name in GUIDE_NAMES, `the signature name ${name} is one of the design CSS's`);
  // Only tokens, nothing loaded; important, so it wins over the page's own :root, light or dark.
  const rule = guideNamesRule();
  assert.match(rule, /^:root\{color-scheme:var\(--vivamark-scheme\) !important;--bg:var\(--vivamark-bg\) !important;/);
  assert.doesNotMatch(rule, /url\(|@|#[0-9a-f]{3}/i);
  for (const v of Object.values(GUIDE_NAMES)) for (const [, token] of v.matchAll(/var\((--vivamark-[a-z-]+)\)/g)) assert.ok(PAGE_TOKENS.includes(token), token);
});
