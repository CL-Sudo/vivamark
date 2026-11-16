// Themes in a real browser: the switcher (Gumdrop by default, applied at
// once without a reload or a lost draft, remembered per browser, the
// configured default), the floor every theme keeps (every control there and
// labelled, a visible focus ring, text at 4.5:1, states in words, no motion
// when asked, nothing past the edge), the marks in the page following the
// theme, the page tokens (an example page that uses them follows each theme
// from its first paint and keeps the floor; a page that does not is left as
// it is), Pinboard's canvas, and a browser that only ever talks to loopback,
// fonts included.
//
// Skipped, with a message, when no Chromium can be launched.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { browserUrl, makeWorld, ROOT } from './helpers/harness.mjs';

const { PAGE_THEMES, TEXT_SIZES, THEMES, layoutFolds } = await import(path.join(ROOT, 'dist', 'internal.js'));

/** `#rrggbb` as getComputedStyle writes it. */
const rgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

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

/** A CLI step that must succeed; its stderr says why when it does not. */
async function ok(run) {
  const r = await run;
  assert.equal(r.code, 0, r.stderr);
  return r;
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

test('every theme keeps the floor: every control there and labelled, a focus ring, text at 4.5:1, states in words, nothing past the edge, no motion when asked; the panel and index layouts folded too, and at every text size', { timeout: 600_000 }, async (t) => {
  if (skipWithoutBrowser(t)) return;
  const file = copyReport('floor.html');
  const url = await openReview(file);
  const { page, requests, offLoopback, problems, frame } = await reviewPage(url);
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
  await ok(world.cli(['reply', file, '--note', 'n_0001', '--status', 'addressed', '-m', 'Named it.']));
  await ok(world.cli(['reply', file, '--note', 'n_0002', '--status', 'question', '-m', 'Start at 00:00?']));
  await ok(world.cli(['note', 'add', file, '--target', '#finding-speed', '--text', 'Checked the logs.', '--source', 'agent']));
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
  const pageLooks = new Set();
  const folds = Object.fromEntries(THEMES.map((x) => [x.id, layoutFolds(x.layout)]));
  for (const theme of THEMES.map((x) => x.id)) {
    await page.selectOption('#theme', theme);
    // The themes whose panel folds (the panel and index layouts) at every text size; the chat and the table at Normal.
    for (const size of folds[theme] ? TEXT_SIZES.map((x) => x.id) : ['normal']) {
      await page.selectOption('#text-size', size);
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(150);
        const at = `${theme} at ${width}px${size === 'normal' ? '' : `, ${size} text`}`;
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
            controls: ['point', 'attach', 'add', 'send', 'approve', 'dismiss', 'end', 'show-changes', 'show-marks', 'theme', 'text-size', 'comment'].filter((id) => !shown(id)),
            // Send and Approve within the window, or in a panel that scrolls to them.
            unreachable: ['send', 'approve'].filter((id) => {
              const e = document.getElementById(id);
              const r = e.getBoundingClientRect();
              if (r.bottom <= innerHeight + 0.5 && r.right <= innerWidth + 0.5) return false;
              const box = e.closest('.side');
              return !(box && getComputedStyle(box).overflowY === 'auto' && box.scrollHeight > box.clientHeight);
            }),
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
        if (m.unreachable.length) failures.push(`${at}: past the window and out of reach: ${m.unreachable.join(', ')}`);
        if (m.unnamed.length) failures.push(`${at}: buttons without a label: ${m.unnamed.join(' | ')}`);
        if (m.states.length !== 4 || m.states.some((s) => !s)) failures.push(`${at}: note states not all in words: ${JSON.stringify(m.states)}`);
        if (m.answer !== 1) failures.push(`${at}: the Answer button is not there`);
        if (m.words.some((w) => !w)) failures.push(`${at}: turn or presence without words`);
        if (m.ticks.some((c) => !c.includes('✓'))) failures.push(`${at}: a pressed toggle shows no tick: ${m.ticks.join(' ')}`);
        if (m.barOut.length) failures.push(`${at}: past the bar's edge or cut: ${m.barOut.join(', ')}`);
        const low = await page.evaluate(contrastFailures);
        if (low.length) failures.push(`${at}: text under 4.5:1: ${low.join('; ')}`);
        // The example page uses the page tokens: it takes this theme's colours and keeps the floor too.
        const own = await frame().evaluate(() => ({
          bg: getComputedStyle(document.documentElement).backgroundColor,
          text: getComputedStyle(document.body).color,
          link: getComputedStyle(document.querySelector('main a')).color,
          heading: getComputedStyle(document.querySelector('h1')).fontFamily,
        }));
        const want = PAGE_THEMES[theme];
        if (own.bg !== rgb(want['--vivamark-bg']) || own.text !== rgb(want['--vivamark-text']) || own.link !== rgb(want['--vivamark-accent']))
          failures.push(`${at}: the example page is not in the theme's colours: ${JSON.stringify(own)}`);
        if (own.heading.replace(/\s+/g, ' ') !== want['--vivamark-font-heading'].replace(/\s+/g, ' ')) failures.push(`${at}: the example page's headings are in ${own.heading}`);
        pageLooks.add(JSON.stringify(own));
        const lowPage = await frame().evaluate(contrastFailures);
        if (lowPage.length) failures.push(`${at}: text in the example page under 4.5:1: ${lowPage.join('; ')}`);
        // A focus ring from the keyboard, at least 2 pixels on screen at any text size.
        await page.focus('#point');
        await page.keyboard.press('Tab');
        const ring = await page.evaluate(() => {
          const e = document.activeElement;
          const cs = getComputedStyle(e);
          return { id: e.id, ok: (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) * e.currentCSSZoom >= 1.99) || cs.boxShadow !== 'none' };
        });
        if (ring.id !== 'attach' || !ring.ok) failures.push(`${at}: no focus ring on ${ring.id}`);
        if (!folds[theme]) {
          if (await page.isVisible('#panel-toggle')) failures.push(`${at}: the panel toggle is offered outside the panel and index layouts`);
          continue;
        }
        // Folded to a strip: the page takes the room, the strip keeps the count and a labelled way back, the bar keeps the rest.
        await page.click('#panel-toggle');
        await page.waitForTimeout(150);
        const f = await page.evaluate(() => {
          const shown = (id) => {
            const e = document.getElementById(id);
            return !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
          };
          const bar = document.querySelector('.bar');
          const b = bar.getBoundingClientRect();
          const r = document.getElementById('page').getBoundingClientRect();
          const toggle = document.getElementById('panel-toggle');
          return {
            sideways: document.documentElement.scrollWidth > window.innerWidth,
            frame: { w: Math.round(r.width), h: Math.round(r.height) },
            shown: ['panel-toggle', 'note-count', 'strip-point', 'turn', 'presence', 'show-marks', 'theme', 'text-size'].filter((id) => !shown(id)),
            folded: ['comment', 'thread', 'point', 'send'].filter(shown),
            expanded: toggle.getAttribute('aria-expanded'),
            controls: toggle.getAttribute('aria-controls'),
            name: toggle.getAttribute('aria-label') ?? toggle.textContent,
            words: [document.getElementById('turn').textContent.trim(), document.getElementById('presence-text').textContent.trim(), toggle.textContent.trim()],
            barOut: [...bar.children]
              .filter((c) => getComputedStyle(c).display !== 'none')
              .filter((c) => {
                const x = c.getBoundingClientRect();
                return x.left < b.left - 0.5 || x.right > b.right + 0.5 || c.scrollWidth > c.clientWidth + 1;
              })
              .map((c) => c.id || c.className),
            stripOut: [...document.querySelectorAll('.side-title > *')]
              .filter((c) => c.getClientRects().length)
              .filter((c) => {
                const x = c.getBoundingClientRect();
                return x.right > window.innerWidth + 0.5 || x.bottom > window.innerHeight + 0.5 || c.scrollWidth > c.clientWidth + 1 || c.scrollHeight > c.clientHeight + 1;
              })
              .map((c) => c.id || c.className),
          };
        });
        if (f.sideways) failures.push(`${at}, folded: the page scrolls sideways`);
        if (width > 860 && f.frame.w < m.frame.w + 250) failures.push(`${at}, folded: the page did not take the room: ${m.frame.w} -> ${f.frame.w}`);
        if (width <= 860 && f.frame.h < m.frame.h + 100) failures.push(`${at}, folded: the page did not take the room: ${m.frame.h} -> ${f.frame.h}`);
        if (f.shown.length) failures.push(`${at}, folded: not shown: ${f.shown.join(', ')}`);
        if (f.folded.length) failures.push(`${at}, folded: still shown: ${f.folded.join(', ')}`);
        if (f.expanded !== 'false' || f.controls !== 'side' || !/^Show notes, \d+ notes?$/.test(f.name)) failures.push(`${at}, folded: the toggle says ${f.expanded} / ${f.controls} / ${f.name}`);
        if (f.words.some((w) => !w)) failures.push(`${at}, folded: turn, presence or toggle without words`);
        if (f.barOut.length) failures.push(`${at}, folded: past the bar's edge or cut: ${f.barOut.join(', ')}`);
        if (f.stripOut.length) failures.push(`${at}, folded: past the window or cut in the strip: ${f.stripOut.join(', ')}`);
        const lowFolded = await page.evaluate(contrastFailures);
        if (lowFolded.length) failures.push(`${at}, folded: text under 4.5:1: ${lowFolded.join('; ')}`);
        await page.focus('#strip-point');
        await page.keyboard.press('Shift+Tab');
        const foldedRing = await page.evaluate(() => {
          const e = document.activeElement;
          const cs = getComputedStyle(e);
          return { id: e.id, ok: (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) * e.currentCSSZoom >= 1.99) || cs.boxShadow !== 'none' };
        });
        if (foldedRing.id !== 'panel-toggle' || !foldedRing.ok) failures.push(`${at}, folded: no focus ring on ${foldedRing.id}`);
        await page.keyboard.press('Enter');
        if ((await page.getAttribute('#panel-toggle', 'aria-expanded')) !== 'true') failures.push(`${at}: the toggle did not open the panel from the keyboard`);
      }
      await page.setViewportSize({ width: 1280, height: 800 });
    }
    await page.selectOption('#text-size', 'normal');
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
  assert.equal(pageLooks.size, THEMES.length, 'each switch changed the example page: a look of its own per theme');
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

test('the page tokens are in place before the page first paints, in the theme the review page is in, and after a reload too', { timeout: 60_000 }, async (t) => {
  if (skipWithoutBrowser(t)) return;
  // The report, with a script at the very top of its body: it runs before the body is drawn, and
  // before any message from the review page could arrive (those come after the page is ready).
  const file = path.join(world.pageDir, 'first-paint.html');
  const probe = `<script>window.__first = { bg: getComputedStyle(document.documentElement).backgroundColor, token: getComputedStyle(document.documentElement).getPropertyValue('--vivamark-bg').trim(), load: Math.random() };</script>`;
  fs.writeFileSync(file, fs.readFileSync(path.join(ROOT, 'examples', 'report.html'), 'utf8').replace('<body>', `<body>\n${probe}`));
  const url = await openReview(file);
  const { page, offLoopback, problems, frame } = await reviewPage(url);
  await page.frameLocator('#page').locator('#finding-stale').waitFor();
  const first = await frame().evaluate(() => window.__first);
  assert.equal(first.token, PAGE_THEMES.gumdrop['--vivamark-bg']);
  assert.equal(first.bg, rgb(PAGE_THEMES.gumdrop['--vivamark-bg']), 'Gumdrop from the first paint: no flash of the page without it');

  // Switched, then the file changes: the page reloads straight into the theme it is in now.
  await page.selectOption('#theme', 'riso');
  await frame().waitForFunction((bg) => getComputedStyle(document.documentElement).backgroundColor === bg, rgb(PAGE_THEMES.riso['--vivamark-bg']));
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('The cache halves a typical run.', 'The cache halves a typical run, here.'));
  // The frame is replaced as it reloads: ask whichever page is in it now.
  let again = first;
  for (const until = Date.now() + 10_000; again.load === first.load && Date.now() < until; ) {
    await page.waitForTimeout(200);
    again = (await frame()?.evaluate(() => window.__first).catch(() => null)) ?? first;
  }
  assert.notEqual(again.load, first.load, 'the page reloaded');
  assert.equal(again.bg, rgb(PAGE_THEMES.riso['--vivamark-bg']), 'after a reload, Riso from the first paint');
  assert.deepEqual(offLoopback, []);
  assert.deepEqual(problems, []);
  await page.close();
});

test('a page with its own colours and fonts that ignores the page tokens renders exactly as it does without vivamark, in every theme', { timeout: 120_000 }, async (t) => {
  if (skipWithoutBrowser(t)) return;
  // Its own palette, custom properties of its own (one named like ours, --bg), and fonts named like
  // the bundled faces, which it does not have: it must get its own fallbacks, never vivamark's faces.
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Own look</title>
<style>
:root { --bg: #202830; --ink: #f0e0c0; }
html { background: var(--bg); }
body { margin: 0; color: var(--ink); font: 16px/1.5 "Lexend", Georgia, serif; }
main { width: 320px; padding: 16px; }
h1 { color: #ff8800; font-family: "Archivo", "Courier New", monospace; }
a { color: #7fdbff; }
.card { background: #334455; border: 2px solid #aabbcc; border-radius: 4px; padding: 8px; }
.pill { background: #ffdc00; color: #111111; }
</style>
</head>
<body>
<main>
  <h1 id="title">Own look</h1>
  <p id="lede">A page with a design of its own and a <a id="link" href="#lede">link</a>.</p>
  <div class="card" id="card"><span class="pill" id="pill">Blocked</span> on review.</div>
</main>
</body>
</html>
`;
  const file = path.join(world.pageDir, 'own-look.html');
  fs.writeFileSync(file, html);
  const styles = () =>
    [...document.querySelectorAll('html, body, body *')]
      .filter((e) => e.id !== '__vivamark_layer' && !e.closest('#__vivamark_layer'))
      .map((e) => {
        const cs = getComputedStyle(e);
        return [e.id || e.localName, cs.color, cs.backgroundColor, cs.fontFamily, cs.fontSize, cs.borderTopColor, cs.borderTopWidth, cs.borderRadius, cs.colorScheme].join(' | ');
      });

  // Without vivamark: the saved file, opened as it is.
  const plain = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await plain.goto(`file://${file}`);
  const alone = await plain.evaluate(styles);
  await plain.close();

  const url = await openReview(file);
  const { page, offLoopback, problems, frame } = await reviewPage(url);
  const frameFonts = [];
  page.on('request', (r) => {
    if (r.frame() !== page.mainFrame() && r.url().includes('/_vivamark/fonts/')) frameFonts.push(r.url());
  });
  await page.frameLocator('#page').locator('#card').waitFor();
  for (const theme of ['gumdrop', 'raster', 'raw', 'riso', 'smooth-glass']) {
    await page.selectOption('#theme', theme);
    // The switch has reached the page: its tokens are this theme's, unused.
    await frame().waitForFunction((bg) => getComputedStyle(document.documentElement).getPropertyValue('--vivamark-bg').trim() === bg, PAGE_THEMES[theme]['--vivamark-bg']);
    await page.evaluate(() => document.fonts.ready);
    assert.deepEqual(await frame().evaluate(styles), alone, `${theme}: every element as without vivamark`);
    assert.deepEqual(await frame().evaluate(() => [...document.fonts].filter((f) => f.status !== 'unloaded').map((f) => f.family)), [], `${theme}: no bundled face in use`);
  }
  assert.deepEqual(frameFonts, [], 'the page fetched none of the bundled faces');
  assert.deepEqual(offLoopback, []);
  assert.deepEqual(problems, []);
  await page.close();
});

test("a page written before the page tokens, with the design CSS's names and fixed values, follows the theme too: from the first paint, at once on a switch, light whatever the system prefers", { timeout: 120_000 }, async (t) => {
  if (skipWithoutBrowser(t)) return;
  // The system prefers dark, which such a page answers with its own dark palette; in vivamark it takes the theme's.
  const context = await browser.newContext({ colorScheme: 'dark' });
  const file = path.join(world.pageDir, 'before-tokens.html');
  const probe = `<script>window.__first = { bg: getComputedStyle(document.documentElement).backgroundColor, ink: getComputedStyle(document.documentElement).getPropertyValue('--fg2').trim() };</script>`;
  fs.writeFileSync(file, fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'report-before-tokens.html'), 'utf8').replace('<body>', `<body>\n${probe}`));
  const url = await openReview(file);
  const { page, offLoopback, problems, frame } = await reviewPage(url, { context });
  await page.frameLocator('#page').locator('#finding-stale').waitFor();
  const first = await frame().evaluate(() => window.__first);
  assert.equal(first.bg, rgb(PAGE_THEMES.gumdrop['--vivamark-bg']), 'Gumdrop from the first paint');
  await frame().evaluate(() => (window.__frameLoad = true));

  const face = (list) => list.split(',')[0].replace(/"/g, '').trim();
  const shown = () =>
    frame().evaluate(() => {
      const cs = (sel) => getComputedStyle(document.querySelector(sel));
      return {
        bg: cs('html').backgroundColor,
        text: cs('body').color,
        heading: cs('h1').color,
        surface: cs('.card').backgroundColor,
        border: cs('.card').borderBottomColor,
        accent: cs('.eyebrow').color,
        figure: getComputedStyle(document.querySelector('.viz svg text:not(.muted):not(.strong)')).fill,
        scheme: cs('html').colorScheme,
        font: cs('body').fontFamily,
      };
    });
  const looks = new Set();
  for (const theme of [...THEMES.map((x) => x.id).slice(1), 'gumdrop']) {
    await page.selectOption('#theme', theme);
    const k = PAGE_THEMES[theme];
    await frame().waitForFunction((bg) => getComputedStyle(document.documentElement).backgroundColor === bg, rgb(k['--vivamark-bg']));
    const got = await shown();
    assert.deepEqual(
      { ...got, font: face(got.font) },
      {
        bg: rgb(k['--vivamark-bg']),
        text: rgb(k['--vivamark-text']),
        heading: rgb(k['--vivamark-text']),
        surface: rgb(k['--vivamark-surface']),
        border: rgb(k['--vivamark-border']),
        accent: rgb(k['--vivamark-accent']),
        figure: rgb(k['--vivamark-text']),
        scheme: k['--vivamark-scheme'],
        font: face(k['--vivamark-font-body']),
      },
      `${theme}: the older page in the theme's colours and face`,
    );
    looks.add(JSON.stringify(got));
    assert.equal(await frame().evaluate(() => window.__frameLoad), true, `${theme}: the page was not reloaded`);
  }
  assert.equal(looks.size, THEMES.length, 'each theme gives the page its own look');
  assert.deepEqual(offLoopback, []);
  assert.deepEqual(problems, []);
  await context.close();
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
  // Each card beside the sheet at its target, with a thread. The page takes Pinboard's page tokens
  // as it switches and moves once more when their face arrives: the cards follow it there.
  const at = async () => {
    const cards = await page.evaluate(() => [...document.querySelectorAll('.pb-world .thread > .note')].map((c) => ({ n: c.dataset.n, left: parseFloat(c.style.left), top: parseFloat(c.style.top) })));
    const targets = await frame().evaluate(() => ['finding-stale', 'sources'].map((id) => document.getElementById(id).getBoundingClientRect().top + scrollY));
    return { cards, targets, ok: cards.length === 2 && Math.abs(cards[0].top - targets[0]) < 60 && Math.abs(cards[1].top - targets[1]) < 60 };
  };
  let placedNow = await at();
  for (const until = Date.now() + 5000; !placedNow.ok && Date.now() < until; placedNow = await at()) await page.waitForTimeout(100);
  const { cards, targets } = placedNow;
  assert.equal(cards.length, 2);
  assert.ok(cards.every((c) => c.left > 880), JSON.stringify(cards));
  assert.ok(placedNow.ok, `cards sit at their targets: ${JSON.stringify({ cards, targets })}`);
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

// ---- text size --------------------------------------------------------------------------

/**
 * How big the panel's and the page's text is drawn, in the window's pixels.
 * The page's text is an h2: a size of its own, which neither example page
 * changes on a narrow window.
 */
async function drawnText(page, frame) {
  const panel = await page.evaluate(() => document.querySelector('.side-name, .side-title').getBoundingClientRect().height);
  const scale = await page.evaluate(() => document.getElementById('page').getBoundingClientRect().width);
  const own = await frame().evaluate(() => ({ size: parseFloat(getComputedStyle(document.querySelector('h2')).fontSize), width: innerWidth }));
  return { panel, page: (own.size * scale) / own.width };
}

test('the text size: Normal by default with nothing zoomed; each size draws the bar, the notes and the page larger or smaller at once, with no reload, no lost draft and the marks on their items; remembered and in place before the first paint', { timeout: 120_000 }, async (t) => {
  if (skipWithoutBrowser(t)) return;
  const file = copyReport('text-size.html');
  const url = await openReview(file);
  // Records the text size when the bar is first parsed, before the review page's script ran.
  const firstPaint = () => {
    new MutationObserver((_, obs) => {
      if (!document.querySelector('.bar')) return;
      window.__sizeAtParse = [document.documentElement.dataset.textSize, document.documentElement.style.getPropertyValue('--vm-zoom')];
      obs.disconnect();
    }).observe(document, { childList: true, subtree: true });
  };
  const { page, offLoopback, problems, frame } = await reviewPage(url, { init: firstPaint });
  const doc = page.frameLocator('#page');
  await doc.locator('#finding-stale').waitFor();

  // Normal: nothing zoomed, nothing stored, a picker labelled in words beside Theme.
  assert.equal(await page.getAttribute('html', 'data-text-size'), 'normal');
  assert.equal(await page.inputValue('#text-size'), 'normal');
  assert.deepEqual(await page.evaluate(() => [document.documentElement.style.getPropertyValue('--vm-zoom'), document.documentElement.currentCSSZoom]), ['', 1]);
  assert.equal(await frame().evaluate(() => devicePixelRatio), 1, 'the page is not zoomed either');
  assert.equal(await page.evaluate(() => localStorage.getItem('vivamark:text-size')), null, 'nothing is stored until the reviewer chooses');
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#text-size option')].map((o) => [o.value, o.textContent])), TEXT_SIZES.map((x) => [x.id, x.name]));
  assert.equal(await page.getByRole('combobox', { name: 'Text size', exact: true }).count(), 1, 'the picker is labelled');
  assert.equal(await page.evaluate(() => document.getElementById('theme').closest('label').nextElementSibling?.contains(document.getElementById('text-size'))), true, 'next to Theme');

  // A queued note with its pin, and a draft being written.
  await point(page, doc.locator('#finding-stale'));
  await page.fill('#comment', 'Name the cache key.');
  await page.click('#add');
  await page.fill('#comment', 'A draft, half written');
  /** Where note 1's pin sits against its item, in the page's own pixels: just past its right edge, centred on it. */
  const pin = () =>
    frame().evaluate(() => {
      const p = [...(document.getElementById('__vivamark_layer')?.children ?? [])].find((c) => c.dataset.vivamarkPin && c.textContent === '1');
      if (!p) return null;
      const a = p.getBoundingClientRect();
      const b = document.getElementById('finding-stale').getBoundingClientRect();
      return { dx: Math.round(a.left - b.right), dy: Math.round(a.top + a.height / 2 - (b.top + b.height / 2)) };
    });
  await frame().waitForFunction(() => [...(document.getElementById('__vivamark_layer')?.children ?? [])].some((c) => c.textContent === '1'));
  const pinAt = await pin();
  assert.ok(pinAt);
  const base = await drawnText(page, frame);
  await page.evaluate(() => (window.__sameLoad = true));
  await frame().evaluate(() => (window.__frameLoad = true));

  for (const size of [...TEXT_SIZES.filter((x) => x.id !== 'normal'), TEXT_SIZES.find((x) => x.id === 'normal')]) {
    await page.selectOption('#text-size', size.id);
    assert.equal(await page.getAttribute('html', 'data-text-size'), size.id);
    assert.ok(Math.abs((await page.evaluate(() => document.documentElement.currentCSSZoom)) - size.zoom) < 0.001, `${size.id}: the review is drawn at ${size.zoom}`);
    await frame().waitForFunction((z) => Math.abs(devicePixelRatio - z) < 0.001, size.zoom);
    // The frame takes its new width a moment after the zoom.
    let now = await drawnText(page, frame);
    for (const until = Date.now() + 3000; Math.abs(now.page / base.page - size.zoom) >= 0.02 && Date.now() < until; now = await drawnText(page, frame)) await page.waitForTimeout(50);
    assert.ok(Math.abs(now.panel / base.panel - size.zoom) < 0.06, `${size.id}: the panel's text grows with it: ${base.panel} -> ${now.panel}`);
    assert.ok(Math.abs(now.page / base.page - size.zoom) < 0.02, `${size.id}: the page's text grows with it: ${base.page} -> ${now.page}`);
    assert.equal(await page.evaluate(() => window.__sameLoad), true, `${size.id}: no reload`);
    assert.equal(await frame().evaluate(() => window.__frameLoad), true, `${size.id}: the agent's page was not reloaded`);
    assert.equal(await page.inputValue('#comment'), 'A draft, half written', `${size.id}: the draft stays`);
    assert.equal(await page.locator('.note.queued').count(), 1, `${size.id}: the queue stays`);
    // The page reflows at its new width; the pin follows its item there.
    await frame().waitForFunction((w) => {
      const p = [...(document.getElementById('__vivamark_layer')?.children ?? [])].find((c) => c.dataset.vivamarkPin && c.textContent === '1');
      if (!p) return false;
      const a = p.getBoundingClientRect();
      const b = document.getElementById('finding-stale').getBoundingClientRect();
      return Math.abs(a.left - b.right - w.dx) <= 1 && Math.abs(a.top + a.height / 2 - (b.top + b.height / 2) - w.dy) <= 1;
    }, pinAt, { timeout: 5000 }).catch(async () => assert.fail(`${size.id}: the pin left its item: ${JSON.stringify(await pin())} vs ${JSON.stringify(pinAt)}`));
    assert.equal(await page.evaluate(() => localStorage.getItem('vivamark:text-size')), size.id);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${size.id}: no sideways scroll`);
  }
  assert.deepEqual(await page.evaluate(() => [document.documentElement.style.getPropertyValue('--vm-zoom'), document.documentElement.currentCSSZoom]), ['', 1], 'back at Normal, nothing is zoomed');

  // Remembered, and in place before the first paint: a reload opens at the last choice.
  await page.selectOption('#text-size', 'x-large');
  await page.reload();
  await doc.locator('#finding-stale').waitFor();
  assert.deepEqual(await page.evaluate(() => window.__sizeAtParse), ['x-large', '1.3']);
  assert.equal(await page.inputValue('#text-size'), 'x-large');
  assert.ok(Math.abs((await frame().evaluate(() => devicePixelRatio)) - 1.3) < 0.001, 'the page is drawn larger from its first load');
  await page.selectOption('#text-size', 'normal');

  // With storage blocked Normal applies and the picker still works.
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
  assert.equal(await blocked.page.getAttribute('html', 'data-text-size'), 'normal');
  await blocked.page.selectOption('#text-size', 'large');
  assert.equal(await blocked.page.getAttribute('html', 'data-text-size'), 'large');
  assert.ok(Math.abs((await blocked.page.evaluate(() => document.documentElement.currentCSSZoom)) - 1.15) < 0.001);

  assert.deepEqual([...offLoopback, ...blocked.offLoopback], []);
  assert.deepEqual([...problems, ...blocked.problems], []);
  await page.close();
  await blocked.page.close();
});

test('the text size scales a page sized in pixels too: at the largest size on a phone it reflows, its table scrolls in its own box, its figure fits, nothing scrolls sideways', { timeout: 60_000 }, async (t) => {
  if (skipWithoutBrowser(t)) return;
  const file = path.join(world.pageDir, 'px-page.html');
  fs.copyFileSync(path.join(ROOT, 'test', 'fixtures', 'px-page.html'), file);
  const url = await openReview(file);
  const { page, offLoopback, problems, frame } = await reviewPage(url, { width: 390, height: 844 });
  await page.frameLocator('#page').locator('#figure').waitFor();
  const base = await drawnText(page, frame);
  await page.selectOption('#text-size', 'x-large');
  await frame().waitForFunction(() => Math.abs(devicePixelRatio - 1.3) < 0.001);
  let now = await drawnText(page, frame);
  for (const until = Date.now() + 3000; Math.abs(now.page / base.page - 1.3) >= 0.02 && Date.now() < until; now = await drawnText(page, frame)) await page.waitForTimeout(50);
  assert.ok(Math.abs(now.page / base.page - 1.3) < 0.02, `the page's 20px heading is drawn 1.3 times as large: ${base.page} -> ${now.page}`);
  const m = await frame().evaluate(() => {
    const box = document.getElementById('table-box');
    const fig = document.querySelector('#figure svg').getBoundingClientRect();
    const main = document.querySelector('main').getBoundingClientRect();
    return {
      width: innerWidth,
      sideways: document.documentElement.scrollWidth > innerWidth,
      tableScrolls: box.scrollWidth > box.clientWidth,
      boxRight: box.getBoundingClientRect().right,
      fig: { left: fig.left, right: fig.right, width: fig.width },
      column: main.width,
    };
  });
  assert.ok(m.width < 390 / 1.2, `the page lays out at the narrower width its text needs: ${m.width}`);
  assert.equal(m.sideways, false, 'nothing scrolls the page sideways');
  assert.equal(m.tableScrolls, true, 'the table scrolls in its own box');
  assert.ok(m.boxRight <= m.width + 0.5, `the table's box stays in the page: ${m.boxRight} of ${m.width}`);
  assert.ok(m.fig.left >= 0 && m.fig.right <= m.width + 0.5, `the figure fits: ${JSON.stringify(m.fig)}`);
  assert.ok(m.fig.width > m.width * 0.8, `the figure keeps the column's width, readable: ${m.fig.width} of ${m.width}`);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'the review page does not scroll sideways');
  assert.deepEqual(offLoopback, []);
  assert.deepEqual(problems, []);
  await page.close();
});

test('Pinboard at a larger text size: the cards sit at their targets, the table follows the pointer, and a window it leaves too narrow stacks', { timeout: 120_000 }, async (t) => {
  if (skipWithoutBrowser(t)) return;
  const file = copyReport('pinboard-size.html');
  const url = await openReview(file);
  const { page, offLoopback, problems, frame } = await reviewPage(url, { width: 1440, height: 900 });
  const doc = page.frameLocator('#page');
  await doc.locator('#finding-stale').waitFor();
  await point(page, doc.locator('#finding-stale'));
  await page.fill('#comment', 'Name the cache key.');
  await page.click('#add');
  await frame().evaluate(() => scrollTo(0, 0));
  await page.selectOption('#text-size', 'x-large');
  await page.selectOption('#theme', 'pinboard');
  await page.waitForSelector('.pb-canvas');
  // The card beside its target, in table pixels, the sheet as tall as the page.
  const placed = async () => {
    const card = await page.evaluate(() => {
      const c = document.querySelector('.pb-world .thread > .note');
      return c ? { top: parseFloat(c.style.top), sheet: parseFloat(document.getElementById('sheet').style.height) } : null;
    });
    const target = await frame().evaluate(() => ({ top: document.getElementById('finding-stale').getBoundingClientRect().top + scrollY, height: document.documentElement.scrollHeight }));
    return { card, target, ok: !!card && Math.abs(card.top - target.top) < 60 && Math.abs(card.sheet - target.height) <= 2 };
  };
  let now = await placed();
  for (const until = Date.now() + 5000; !now.ok && Date.now() < until; now = await placed()) await page.waitForTimeout(100);
  assert.ok(now.ok, `the card sits at its target: ${JSON.stringify(now)}`);
  // Dragging the table moves it as far as the pointer went.
  const stage = await page.evaluate(() => {
    const r = document.querySelector('.stage').getBoundingClientRect();
    return { x: r.left + 4, y: r.top + r.height / 2 };
  });
  assert.equal(await page.evaluate((p) => document.elementFromPoint(p.x, p.y)?.matches('.stage, .pb-world, .pb-wires'), stage), true, 'the drag starts on the table');
  const left = () => page.evaluate(() => document.getElementById('sheet').getBoundingClientRect().left);
  const before = await left();
  await page.mouse.move(stage.x, stage.y);
  await page.mouse.down();
  await page.mouse.move(stage.x + 60, stage.y, { steps: 3 });
  await page.mouse.move(stage.x + 100, stage.y, { steps: 3 });
  await page.mouse.up();
  const moved = (await left()) - before;
  assert.ok(Math.abs(moved - 100) <= 2, `the sheet moved with the pointer: ${moved}`);
  // At 1000 px the table has room at Normal; at Extra large the window is too narrow for it, and Pinboard stacks.
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.waitForFunction(() => !document.querySelector('.pb-canvas') && document.getElementById('thread').parentElement.matches('aside.side'));
  await page.selectOption('#text-size', 'normal');
  await page.waitForSelector('.pb-canvas');
  assert.deepEqual(offLoopback, []);
  assert.deepEqual(problems, []);
  await page.close();
});
