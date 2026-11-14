// Themes in a real browser: the switcher (Gumdrop by default, applied at
// once without a reload or a lost draft, remembered per browser, the
// configured default), the floor every theme keeps (every control there and
// labelled, a visible focus ring, text at 4.5:1, states in words, no motion
// when asked, nothing past the edge), the marks in the page following the
// theme, Pinboard's canvas, and a browser that only ever talks to loopback,
// fonts included.
//
// Skipped, with a message, when no Chromium can be launched.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { browserUrl, makeWorld, ROOT } from './helpers/harness.mjs';

const { THEMES } = await import(path.join(ROOT, 'dist', 'internal.js'));

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
    browser = await chromium.launch({ headless: true, executablePath: process.env.VIVAMARK_CHROME || undefined });
  } catch (err) {
    launchError = err;
  }
});
after(async () => {
  await browser?.close();
  await world.cleanup();
});

function skipWithoutBrowser(t) {
  if (browser) return false;
  t.skip(`Chromium is not available (${launchError?.message.split('\n')[0] ?? 'playwright-core not installed'})`);
  return true;
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** A review page that records every request, refuses any off loopback, and collects script errors. */
async function reviewPage(url, { width = 1280, height = 800, init, context } = {}) {
  const page = await (context ?? browser).newPage({ viewport: { width, height } });
  if (init) await page.addInitScript(init);
  const requests = [];
  const offLoopback = [];
  const problems = [];
  await page.route('**/*', (route) => {
    const u = new URL(route.request().url());
    requests.push(u);
    if (!LOOPBACK.has(u.hostname)) {
      offLoopback.push(u.href);
      return route.abort();
    }
    return route.continue();
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console: ${msg.text()}`);
  });
  await page.goto(browserUrl(url));
  const frame = () => page.frames().find((f) => f.url().includes('/a/'));
  return { page, requests, offLoopback, problems, frame };
}

async function openReview(file) {
  const opened = await world.cli(['open', file, '--no-browser', '--json']);
  assert.equal(opened.code, 0, opened.stderr);
  return JSON.parse(opened.stdout).url;
}

function copyReport(name) {
  const file = path.join(world.pageDir, name);
  fs.copyFileSync(path.join(ROOT, 'examples', 'report.html'), file);
  return file;
}

async function point(page, locator) {
  await page.click('#point');
  await locator.click();
  await page.waitForFunction(() => document.getElementById('target')?.dataset.kind === 'element');
}

test('the theme switcher: Gumdrop by default, applied at once with no reload and no lost draft, remembered in this browser', { timeout: 120_000 }, async (t) => {
  if (skipWithoutBrowser(t)) return;
  const file = copyReport('switch.html');
  const url = await openReview(file);
  const { page, offLoopback, problems, frame } = await reviewPage(url);
  const doc = page.frameLocator('#page');
  await doc.locator('#finding-stale').waitFor();
  assert.equal(await page.getAttribute('html', 'data-theme'), 'gumdrop');
  assert.equal(await page.inputValue('#theme'), 'gumdrop');
  assert.equal(await page.evaluate(() => localStorage.getItem('vivamark:theme')), null, 'nothing is stored until the reviewer chooses');
  const options = await page.evaluate(() => [...document.querySelectorAll('#theme option')].map((o) => [o.value, o.textContent]));
  assert.deepEqual(options, THEMES.map((t) => [t.id, t.name]));
  assert.equal(await page.getByRole('combobox', { name: 'Theme', exact: true }).count(), 1, 'the switcher is labelled');

  // A queued note, and a draft being written.
  await point(page, doc.locator('#finding-stale'));
  await page.fill('#comment', 'Name the cache key.');
  await page.click('#add');
  await point(page, doc.locator('#finding-speed'));
  await page.fill('#comment', 'A draft, half written');
  await page.evaluate(() => (window.__sameLoad = true));
  const frameLoads = await frame().evaluate(() => (window.__frameLoad = true));
  void frameLoads;

  /** The colour a token gives a queued pin, read in the review page, against the pin as the page draws it. */
  const pinColours = async () => {
    const want = await page.evaluate(() => {
      const probe = document.createElement('i');
      probe.style.cssText = 'background: var(--mk-pin-queued-bg); color: var(--mk-pin-queued-fg)';
      document.body.append(probe);
      const cs = getComputedStyle(probe);
      const out = { bg: cs.backgroundColor, fg: cs.color };
      probe.remove();
      return out;
    });
    await frame().waitForFunction(
      (w) => [...(document.getElementById('__vivamark_layer')?.children ?? [])].some((c) => c.dataset.vivamarkPin === 'queued' && getComputedStyle(c).backgroundColor === w.bg && getComputedStyle(c).color === w.fg),
      want,
    );
    return want;
  };
  const seen = new Set();
  for (const theme of [...THEMES.map((x) => x.id).slice(1), 'gumdrop']) {
    await page.selectOption('#theme', theme);
    assert.equal(await page.getAttribute('html', 'data-theme'), theme);
    assert.equal(await page.evaluate(() => window.__sameLoad), true, `${theme}: no reload`);
    assert.equal(await frame().evaluate(() => window.__frameLoad), true, `${theme}: the agent's page was not reloaded`);
    assert.equal(await page.inputValue('#comment'), 'A draft, half written', `${theme}: the draft stays`);
    assert.equal(await page.locator('.note.queued').count(), 1, `${theme}: the queue stays`);
    assert.match(await page.textContent('#target-text'), /finding-speed/, `${theme}: the target stays`);
    seen.add(JSON.stringify(await pinColours()));
    assert.equal(await page.evaluate(() => localStorage.getItem('vivamark:theme')), theme);
  }
  assert.ok(seen.size >= 6, `the pins in the page take each theme's colours: ${[...seen].join(' ')}`);

  // Remembered: a reload opens in the last choice.
  await page.selectOption('#theme', 'riso');
  await page.reload();
  await doc.locator('#finding-stale').waitFor();
  assert.equal(await page.getAttribute('html', 'data-theme'), 'riso');
  assert.equal(await page.inputValue('#theme'), 'riso');

  // With storage blocked the default applies and the switcher still works.
  const blocked = await reviewPage(url, {
    init: () => {
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new DOMException('blocked', 'SecurityError');
        },
      });
    },
  });
  await blocked.page.frameLocator('#page').locator('#finding-stale').waitFor();
  assert.equal(await blocked.page.getAttribute('html', 'data-theme'), 'gumdrop');
  await blocked.page.selectOption('#theme', 'signal');
  assert.equal(await blocked.page.getAttribute('html', 'data-theme'), 'signal');

  assert.deepEqual([...offLoopback, ...blocked.offLoopback], []);
  assert.deepEqual([...problems, ...blocked.problems], []);
  await page.close();
  await blocked.page.close();
});

test('the configured default applies in a browser that has chosen nothing; a choice made in the browser wins', { timeout: 60_000 }, async (t) => {
  if (skipWithoutBrowser(t)) return;
  const other = makeWorld({ guardEgress: true });
  try {
    const cfg = path.join(other.env.XDG_CONFIG_HOME, 'vivamark');
    fs.mkdirSync(cfg, { recursive: true });
    fs.writeFileSync(path.join(cfg, 'config.json'), JSON.stringify({ theme: 'bauhaus' }));
    const file = path.join(other.pageDir, 'report.html');
    fs.copyFileSync(path.join(ROOT, 'examples', 'report.html'), file);
    const opened = await other.cli(['open', file, '--no-browser', '--json']);
    assert.equal(opened.code, 0, opened.stderr);
    const url = JSON.parse(opened.stdout).url;
    const context = await browser.newContext();
    const first = await reviewPage(url, { context });
    await first.page.frameLocator('#page').locator('#finding-stale').waitFor();
    assert.equal(await first.page.getAttribute('html', 'data-theme'), 'bauhaus');
    assert.equal(await first.page.inputValue('#theme'), 'bauhaus');
    await first.page.selectOption('#theme', 'raw');
    const second = await reviewPage(url, { context });
    await second.page.frameLocator('#page').locator('#finding-stale').waitFor();
    assert.equal(await second.page.getAttribute('html', 'data-theme'), 'raw');
    assert.deepEqual([...first.offLoopback, ...second.offLoopback], []);
    assert.deepEqual([...first.problems, ...second.problems], []);
    await context.close();
    assert.deepEqual(other.egress(), []);
  } finally {
    await other.cleanup();
  }
});

/**
 * Text in the review page below 4.5:1 (3:1 for large text) against what is
 * behind it. Disabled controls are exempt, as WCAG has them. The background
 * is the first opaque one up the tree, with translucent ones laid over it.
 */
function contrastFailures() {
  const parse = (c) => {
    const m = /rgba?\(([^)]+)\)/.exec(c);
    if (!m) return null;
    const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r, g, b, a };
  };
  const over = (top, under) => ({
    r: top.r * top.a + under.r * (1 - top.a),
    g: top.g * top.a + under.g * (1 - top.a),
    b: top.b * top.a + under.b * (1 - top.a),
    a: 1,
  });
  const lum = (c) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const behind = (el) => {
    const layers = [];
    for (let e = el; e; e = e.parentElement) {
      const c = parse(getComputedStyle(e).backgroundColor);
      if (c && c.a > 0) {
        layers.push(c);
        if (c.a >= 1) break;
      }
    }
    let bg = { r: 255, g: 255, b: 255, a: 1 };
    for (const c of layers.reverse()) bg = over(c, bg);
    return bg;
  };
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!(el instanceof HTMLElement) || el.closest('[aria-hidden="true"], :disabled, iframe, .pb-mini')) continue;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || !el.getClientRects().length) continue;
    let opacity = 1;
    for (let e = el; e; e = e.parentElement) opacity *= Number(getComputedStyle(e).opacity);
    const bg = behind(el);
    const fg = parse(cs.color);
    const text = over({ ...fg, a: fg.a * opacity }, bg);
    const [L1, L2] = [lum(text), lum(bg)].sort((a, b) => b - a);
    const ratio = (L1 + 0.05) / (L2 + 0.05);
    const size = parseFloat(cs.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
    if (ratio < (large ? 3 : 4.5)) out.push(`${el.id || el.className || el.localName} "${el.textContent.trim().slice(0, 30)}" ${ratio.toFixed(2)}`);
  }
  return out;
}

test('every theme keeps the floor: every control there and labelled, a focus ring, text at 4.5:1, states in words, nothing past the edge, no motion when asked', { timeout: 240_000 }, async (t) => {
  if (skipWithoutBrowser(t)) return;
  const file = copyReport('floor.html');
  const url = await openReview(file);
  const { page, requests, offLoopback, problems } = await reviewPage(url);
  const doc = page.frameLocator('#page');
  await doc.locator('#finding-stale').waitFor();
  // A review with every kind of state: addressed, asked back, from the agent, queued, a changed page.
  await point(page, doc.locator('#finding-stale'));
  await page.fill('#comment', 'Name the cache key.');
  await page.click('#add');
  await point(page, doc.locator('#finding-cold'));
  await page.fill('#comment', 'Same axis as last week?');
  await page.click('#add');
  await page.click('#send');
  await page.waitForSelector('.note[data-status="open"]');
  for (const r of [await world.cli(['reply', file, '--note', 'n_0001', '--status', 'addressed', '-m', 'Named it.'])]) assert.equal(r.code, 0, r.stderr);
  for (const r of [await world.cli(['reply', file, '--note', 'n_0002', '--status', 'question', '-m', 'Start at 00:00?'])]) assert.equal(r.code, 0, r.stderr);
  for (const r of [await world.cli(['note', 'add', file, '--target', '#finding-speed', '--text', 'Checked the logs.', '--source', 'agent'])]) assert.equal(r.code, 0, r.stderr);
  await page.waitForSelector('.note-reply.question');
  await page.waitForSelector('.note.agent');
  await point(page, doc.locator('#finding-steps'));
  await page.fill('#comment', 'Queued, not sent.');
  await page.click('#add');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('The cache halves a typical run.', 'The cache halves a typical run, here.'));
  await page.waitForFunction(() => !document.getElementById('show-changes').disabled, null, { timeout: 10_000 });
  await page.click('#show-changes');
  await page.waitForSelector('#banner', { state: 'hidden', timeout: 10_000 });

  const failures = [];
  for (const theme of THEMES.map((x) => x.id)) {
    await page.selectOption('#theme', theme);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(150);
      const at = `${theme} at ${width}px`;
      const m = await page.evaluate(() => {
        const shown = (id) => {
          const e = document.getElementById(id);
          return !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
        };
        const bar = document.querySelector('.bar');
        const b = bar.getBoundingClientRect();
        return {
          sideways: document.documentElement.scrollWidth > window.innerWidth,
          frame: (() => {
            const r = document.getElementById('page').getBoundingClientRect();
            return { w: Math.round(r.width), h: Math.round(r.height) };
          })(),
          controls: ['point', 'attach', 'add', 'send', 'approve', 'dismiss', 'end', 'show-changes', 'show-marks', 'theme', 'comment'].filter((id) => !shown(id)),
          unnamed: [...document.querySelectorAll('button')].filter((x) => x.getClientRects().length && !(x.getAttribute('aria-label') || x.textContent).trim()).map((x) => x.outerHTML.slice(0, 60)),
          states: [...document.querySelectorAll('#thread .note .note-head .state')].map((x) => x.textContent.trim()),
          answer: [...document.querySelectorAll('.btn.answer')].filter((x) => x.getClientRects().length).length,
          words: [document.getElementById('turn').textContent.trim(), document.getElementById('presence-text').textContent.trim()],
          ticks: [...document.querySelectorAll('[aria-pressed="true"]')].map((x) => getComputedStyle(x, '::before').content),
          barOut: [...bar.children]
            .filter((c) => getComputedStyle(c).display !== 'none')
            .filter((c) => {
              const r = c.getBoundingClientRect();
              return r.left < b.left - 0.5 || r.right > b.right + 0.5 || c.scrollWidth > c.clientWidth + 1;
            })
            .map((c) => c.id || c.className),
        };
      });
      if (m.sideways) failures.push(`${at}: the page scrolls sideways`);
      if (m.frame.w < Math.min(320, width - 40) || m.frame.h < 200) failures.push(`${at}: the agent's page is squeezed to ${m.frame.w} x ${m.frame.h}`);
      if (m.controls.length) failures.push(`${at}: not shown: ${m.controls.join(', ')}`);
      if (m.unnamed.length) failures.push(`${at}: buttons without a label: ${m.unnamed.join(' | ')}`);
      if (m.states.length !== 4 || m.states.some((s) => !s)) failures.push(`${at}: note states not all in words: ${JSON.stringify(m.states)}`);
      if (m.answer !== 1) failures.push(`${at}: the Answer button is not there`);
      if (m.words.some((w) => !w)) failures.push(`${at}: turn or presence without words`);
      if (m.ticks.some((c) => !c.includes('✓'))) failures.push(`${at}: a pressed toggle shows no tick: ${m.ticks.join(' ')}`);
      if (m.barOut.length) failures.push(`${at}: past the bar's edge or cut: ${m.barOut.join(', ')}`);
      const low = await page.evaluate(contrastFailures);
      if (low.length) failures.push(`${at}: text under 4.5:1: ${low.join('; ')}`);
      // A focus ring from the keyboard.
      await page.focus('#point');
      await page.keyboard.press('Tab');
      const ring = await page.evaluate(() => {
        const e = document.activeElement;
        const cs = getComputedStyle(e);
        return { id: e.id, ok: (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2) || cs.boxShadow !== 'none' };
      });
      if (ring.id !== 'attach' || !ring.ok) failures.push(`${at}: no focus ring on ${ring.id}`);
    }
    await page.setViewportSize({ width: 1280, height: 800 });
  }
  // No motion for a reader who asks for less, in any theme.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const theme of THEMES.map((x) => x.id)) {
    await page.selectOption('#theme', theme);
    const moving = await page.evaluate(() =>
      [...document.querySelectorAll('*')]
        .filter((e) => {
          const cs = getComputedStyle(e);
          return cs.animationName !== 'none' || cs.transitionDuration.split(',').some((d) => parseFloat(d) > 0);
        })
        .map((e) => e.id || e.className),
    );
    if (moving.length) failures.push(`${theme}: moves with reduced motion: ${moving.slice(0, 5).join(', ')}`);
  }
  assert.deepEqual(failures, []);
  const fonts = requests.filter((u) => u.pathname.startsWith('/_vivamark/fonts/'));
  assert.ok(fonts.length >= 8, `the themes' fonts were loaded: ${fonts.map((u) => u.pathname).join(', ')}`);
  assert.deepEqual(
    requests.filter((u) => /\.(woff2?|ttf|otf)$/.test(u.pathname) && !u.pathname.startsWith('/_vivamark/fonts/')).map((u) => u.href),
    [],
    'no font from anywhere else',
  );
  assert.deepEqual(offLoopback, [], 'the browser only talked to loopback');
  assert.deepEqual(problems, []);
  await page.close();
  assert.deepEqual(world.egress(), [], 'no vivamark process tried to leave the machine');
});

test('Pinboard: the page as a sheet on a table, notes pinned beside it with threads, zoom, fit, pills and minimap; the panel comes back', { timeout: 120_000 }, async (t) => {
  if (skipWithoutBrowser(t)) return;
  const file = copyReport('pinboard.html');
  const url = await openReview(file);
  const { page, offLoopback, problems, frame } = await reviewPage(url, { width: 1440, height: 900 });
  const doc = page.frameLocator('#page');
  await doc.locator('#finding-stale').waitFor();
  await point(page, doc.locator('#finding-stale'));
  await page.fill('#comment', 'Name the cache key.');
  await page.click('#add');
  await point(page, doc.locator('#sources'));
  await page.fill('#comment', 'Far down the page.');
  await page.click('#add');
  await page.fill('#comment', 'A draft.');
  // The table opens where the reader was on the page: at the top.
  await frame().evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(400);
  await page.selectOption('#theme', 'pinboard');

  // The page is shown whole: the sheet is as tall as the page, and the panel is gone.
  await page.waitForFunction(() => parseFloat(document.getElementById('sheet').style.height) > 2000);
  const pageHeight = await frame().evaluate(() => document.documentElement.scrollHeight);
  assert.ok(Math.abs(parseFloat(await page.evaluate(() => document.getElementById('sheet').style.height)) - pageHeight) <= 2);
  assert.equal(await page.isVisible('aside.side'), false);
  assert.equal(await page.evaluate(() => document.getElementById('thread').parentElement.className), 'pb-world');
  // Each card beside the sheet at its target, with a thread.
  const cards = await page.evaluate(() => [...document.querySelectorAll('.pb-world .thread > .note')].map((c) => ({ n: c.dataset.n, left: parseFloat(c.style.left), top: parseFloat(c.style.top) })));
  assert.equal(cards.length, 2);
  assert.ok(cards.every((c) => c.left > 880), JSON.stringify(cards));
  const targets = await frame().evaluate(() => ['finding-stale', 'sources'].map((id) => document.getElementById(id).getBoundingClientRect().top + scrollY));
  assert.ok(Math.abs(cards[0].top - targets[0]) < 60 && Math.abs(cards[1].top - targets[1]) < 60, `cards sit at their targets: ${JSON.stringify({ cards, targets })}`);
  assert.equal(await page.locator('.pb-wires path').count(), 2);
  // The far note is off screen: a pill takes the reader there.
  const pill = page.locator('.pb-pill', { hasText: '2' });
  await pill.waitFor();
  const before = await page.evaluate(() => document.querySelector('.pb-world').style.transform);
  await pill.click();
  await page.waitForFunction((b) => document.querySelector('.pb-world').style.transform !== b, before);
  await page.waitForFunction(() => ![...document.querySelectorAll('.pb-pill')].some((p) => p.textContent.startsWith('2')));
  // Zoom and Fit, from buttons a keyboard reaches; the sheet and the cards move together.
  const zoom = () => page.textContent('.pb-zoom');
  const z0 = await zoom();
  await page.click('button[aria-label="Zoom in"]');
  assert.notEqual(await zoom(), z0);
  assert.equal(await page.evaluate(() => document.getElementById('sheet').style.transform), await page.evaluate(() => document.querySelector('.pb-world').style.transform));
  await page.click('.pb-fit');
  assert.equal(await zoom(), z0);
  assert.equal(await page.locator('.pb-mini .pb-mini-card').count(), 2);
  // The draft and every control are in the dock and work: Send sends.
  assert.equal(await page.inputValue('#comment'), 'A draft.');
  await page.click('#send');
  await page.waitForFunction(() => document.querySelectorAll('.pb-world .note[data-status="open"]').length === 2);
  assert.equal((await world.cli(['wait', file, '--json', '--timeout', '5s'])).code, 0);
  // Narrow, Pinboard stacks; back to a panel theme, the panel is whole again and the page scrolls.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => !document.querySelector('.pb-canvas') && document.getElementById('thread').parentElement.matches('aside.side'));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForSelector('.pb-canvas');
  await page.selectOption('#theme', 'gumdrop');
  assert.equal(await page.evaluate(() => [...document.querySelector('aside.side').children].map((c) => c.id || c.className).slice(-3).join(' ')), 'thread ended composer');
  assert.equal(await page.evaluate(() => document.getElementById('sheet').style.cssText), '');
  assert.equal(await page.inputValue('#comment'), 'A draft.');
  await frame().waitForFunction(() => document.documentElement.scrollHeight > innerHeight + 100);
  assert.deepEqual(offLoopback, []);
  assert.deepEqual(problems, []);
  await page.close();
});
