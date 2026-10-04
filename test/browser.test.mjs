// The review UI in a real browser (Playwright's headless Chromium): point at
// an element, select a text range, queue both, and nothing reaches the agent
// until Send is clicked. Then the agent's reply appears, and an edit to the
// file reloads the page. The browser may only talk to loopback, and every
// vivamark process runs under the egress guard.
//
// Skipped, with a message, when Playwright's Chromium is not installed.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { FIXTURE, makeWorld, startCli } from './helpers/harness.mjs';

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

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** A review page with the loopback-only guard and error collection the tests share. */
async function reviewPage(url) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const offLoopback = [];
  const problems = [];
  await page.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (!LOOPBACK.has(u.hostname)) {
      offLoopback.push(u.href);
      return route.abort();
    }
    return route.continue();
  });
  page.on('websocket', (ws) => {
    if (!LOOPBACK.has(new URL(ws.url()).hostname)) offLoopback.push(ws.url());
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console: ${msg.text()}`);
  });
  await page.goto(url);
  return { page, offLoopback, problems, frame: () => page.frames().find((f) => f.url().includes('/a/')) };
}

function skipWithoutBrowser(t) {
  if (browser) return false;
  t.skip(`Playwright Chromium is not available (${launchError?.message.split('\n')[0] ?? 'playwright-core not installed'}); run: npx playwright install chromium`);
  return true;
}

test('element pick and text selection become notes only when Send is clicked', { timeout: 90_000 }, async (t) => {
  if (!browser) {
    t.skip(`Playwright Chromium is not available (${launchError?.message.split('\n')[0] ?? 'playwright-core not installed'}); run: npx playwright install chromium`);
    return;
  }
  const original = fs.readFileSync(world.page, 'utf8');
  const opened = await world.cli(['open', world.page, '--no-browser', '--json']);
  assert.equal(opened.code, 0, opened.stderr);
  const { url } = JSON.parse(opened.stdout);

  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const offLoopback = [];
  const problems = [];
  await page.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (!LOOPBACK.has(u.hostname)) {
      offLoopback.push(u.href);
      return route.abort();
    }
    return route.continue();
  });
  page.on('websocket', (ws) => {
    if (!LOOPBACK.has(new URL(ws.url()).hostname)) offLoopback.push(ws.url());
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console: ${msg.text()}`);
  });

  await page.goto(url);
  const doc = page.frameLocator('#page');
  await doc.locator('#step-2').waitFor();
  assert.equal(new URL(page.url()).hash, '', 'the token is removed from the address bar');

  // 1. Point at an element.
  await page.click('#point');
  assert.equal(await page.getAttribute('#point', 'aria-pressed'), 'true');
  await doc.locator('#step-2').click();
  await page.waitForFunction(() => document.getElementById('target-text')?.textContent?.includes('li#step-2'));
  await page.fill('#comment', 'Split this step: the scaffold and the save handler are separate risks.');
  await page.click('#add');

  // 2. Select a text range with the mouse.
  const frameBox = await page.locator('#page').boundingBox();
  const frame = page.frames().find((f) => f.url().includes('/a/'));
  const r = await frame.evaluate(() => {
    const text = document.getElementById('summary').firstChild;
    const at = text.data.indexOf('Director or Attestor');
    const range = document.createRange();
    range.setStart(text, at);
    range.setEnd(text, at + 'Director or Attestor'.length);
    const rects = range.getClientRects();
    const a = rects[0];
    const b = rects[rects.length - 1];
    return { x1: a.left + 1, y1: a.top + a.height / 2, x2: b.right - 1, y2: b.top + b.height / 2 };
  });
  await page.mouse.move(frameBox.x + r.x1, frameBox.y + r.y1);
  await page.mouse.down();
  await page.mouse.move(frameBox.x + r.x2, frameBox.y + r.y2, { steps: 10 });
  await page.mouse.up();
  await page.waitForFunction(() => document.getElementById('target')?.dataset.kind === 'text');
  await page.fill('#comment', 'Can an Attestor really enrol on their own?');
  await page.keyboard.press('Control+Enter');

  assert.equal(await page.textContent('#note-count'), '2');
  assert.equal(await page.textContent('#send'), 'Send 2');
  assert.equal(await page.locator('.note.queued').count(), 2);
  // Each queued note is marked on the page: an outline or highlight, plus a numbered badge.
  await frame.waitForFunction(() => (document.getElementById('__vivamark_layer')?.children.length ?? 0) >= 4);

  // 3. Nothing has reached the agent yet.
  const early = await world.cli(['wait', world.page, '--timeout', '1500ms']);
  assert.equal(early.code, 5, `nothing before Send: ${early.stdout}`);

  // 4. An agent waits; the page shows it listening; Send wakes it.
  const waiting = startCli(['wait', world.page, '--json'], world.env);
  await page.waitForSelector('#presence[data-state="listening"]', { timeout: 10_000 });
  if (process.env.VIVAMARK_SCREENSHOT_DIR) {
    fs.mkdirSync(process.env.VIVAMARK_SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(process.env.VIVAMARK_SCREENSHOT_DIR, 'review-queued.png') });
  }
  await page.click('#send');
  const w = await waiting.done;
  assert.equal(w.code, 0, w.stderr);
  const out = JSON.parse(w.stdout);
  assert.deepEqual(out.seq, { from: 1, to: 2 });
  const [el, tx] = out.notes;
  assert.equal(el.kind, 'element');
  assert.equal(el.anchor.stable_id, 'step-2');
  assert.equal(el.anchor.tag, 'li');
  assert.match(el.anchor.text, /^Applet scaffold/);
  assert.ok(el.anchor.source_line > 1);
  assert.equal(tx.kind, 'text');
  assert.match(tx.anchor.quote, /Director or Attesto/);
  assert.match(tx.anchor.prefix, /Setup screen where a ?$/);
  assert.equal(tx.anchor.stable_id, 'summary');
  assert.equal(tx.comment, 'Can an Attestor really enrol on their own?');
  await page.waitForSelector('.note:not(.queued) >> text=Sent');
  assert.equal(await page.locator('.note.queued').count(), 0);

  // 5. The agent replies; the page shows it, rendered.
  const reply = await world.cli(['reply', world.page, '-m', 'Split it into **two** steps.']);
  assert.equal(reply.code, 0, reply.stderr);
  await page.waitForSelector('.reply strong:text("two")');

  // 6. The agent edits the file; the page reloads in place.
  fs.writeFileSync(world.page, original.replace('Applet scaffold, save handler and container page.', 'Applet scaffold and container page.'));
  await doc.locator('#step-2', { hasText: 'Applet scaffold and container page.' }).waitFor({ timeout: 10_000 });
  await page.waitForFunction(() => !document.getElementById('reload-chip')?.hidden);

  if (process.env.VIVAMARK_SCREENSHOT_DIR) {
    await page.screenshot({ path: path.join(process.env.VIVAMARK_SCREENSHOT_DIR, 'review-sent.png') });
  }

  assert.deepEqual(offLoopback, [], 'the browser only talked to loopback');
  assert.deepEqual(problems, [], 'no script errors or CSP violations');
  await page.close();
  assert.equal((await world.cli(['stop'])).code, 0);
  assert.deepEqual(world.egress(), [], 'no vivamark process tried to leave the machine');
});

test('features: intents, targets, decisions, re-anchoring and changes in the review UI', { timeout: 120_000 }, async (t) => {
  if (skipWithoutBrowser(t)) return;
  const file = path.join(world.pageDir, 'features.html');
  const original = fs.readFileSync(FIXTURE, 'utf8');
  fs.writeFileSync(file, original);
  const opened = await world.cli(['open', file, '--no-browser', '--json']);
  assert.equal(opened.code, 0, opened.stderr);
  const { url } = JSON.parse(opened.stdout);
  const { page, offLoopback, problems, frame } = await reviewPage(url);
  const doc = page.frameLocator('#page');
  await doc.locator('#step-2').waitFor();

  const point = async (locator, position) => {
    await page.click('#point');
    await locator.click(position ? { position } : undefined);
    await page.waitForFunction(() => document.getElementById('target')?.dataset.kind === 'element');
  };

  // F4: intent and severity chosen in the composer before adding.
  await point(doc.locator('#step-2'));
  await page.click('#tags [data-intent="change"]');
  await page.click('#tags [data-severity="blocking"]');
  await page.fill('#comment', 'Split this step.');
  await page.click('#add');
  // ...and with one keystroke on the queued card, which has the focus after adding.
  await point(doc.locator('#step-3'));
  await page.fill('#comment', 'Is browser verification manual?');
  await page.keyboard.press('Control+Enter');
  await page.keyboard.press('q');
  await page.keyboard.press('n');
  await page.waitForSelector('.note.queued[data-n="2"] .pill.intent.question');
  assert.equal(await page.locator('.note.queued[data-n="2"] .pill.sev.nit').count(), 1);
  assert.equal(await page.locator('.note.queued[data-n="1"] .pill.intent.change').count(), 1);

  // F8: a table cell by row and column, controls by accessible name, a point on a chart.
  const pickAndAdd = async (locator, comment, position) => {
    await point(locator, position);
    const described = await page.textContent('#target-text');
    await page.fill('#comment', comment);
    await page.click('#add');
    return described;
  };
  assert.equal(await pickAndAdd(doc.locator('#rollout td', { hasText: 'Platform team' }), 'Which person?'), 'cell Shadow traffic · Owner');
  await pickAndAdd(doc.locator('#controls button'), 'Needs a confirmation step.');
  await pickAndAdd(doc.locator('#region'), 'Add APAC.');
  await pickAndAdd(doc.locator('#merged td', { hasText: 'Monday' }), 'Which Monday?');
  await pickAndAdd(doc.locator('#chart'), 'Why the spike here?', { x: 180, y: 30 });
  assert.equal(await page.locator('.note.queued').count(), 7);

  // F1: with notes queued, Approve becomes Approve with notes and Dismiss waits.
  assert.equal(await page.textContent('#approve'), 'Approve with notes');
  assert.equal(await page.isDisabled('#dismiss'), true);

  await page.click('#send');
  await page.waitForSelector('.note:not(.queued) >> text=Sent');
  const first = await world.cli(['wait', file, '--json']);
  assert.equal(first.code, 0, first.stderr);
  const out1 = JSON.parse(first.stdout);
  assert.equal(out1.decision, 'request-changes');
  assert.deepEqual(out1.notes.slice(0, 2).map((n) => [n.intent, n.severity]), [['change', 'blocking'], ['question', 'nit']]);
  const [, , cell, button, select, merged, chart] = out1.notes;
  assert.deepEqual(cell.anchor.cell, { row: 'Shadow traffic', column: 'Owner' });
  assert.equal(cell.anchor.tag, 'td');
  assert.deepEqual(button.anchor.control, { role: 'button', name: 'Approve rollout' });
  assert.deepEqual(select.anchor.control, { role: 'combobox', name: 'Region' });
  assert.equal(merged.anchor.tag, 'td');
  assert.equal(merged.anchor.cell, undefined, 'no cell name where a span makes the header a guess');
  assert.equal(chart.anchor.stable_id, 'chart');
  assert.equal(chart.anchor.tag, 'svg');
  const pt = chart.anchor.point;
  assert.deepEqual([pt.width, pt.height], [240, 120]);
  assert.ok(Math.abs(pt.x - 180) <= 1 && Math.abs(pt.y - 30) <= 1, JSON.stringify(pt));

  // F1: Approve with nothing queued sends a decision alone; wait exits 6.
  assert.equal(await page.textContent('#approve'), 'Approve');
  await page.click('#approve');
  await page.waitForSelector('.decision.approve');
  const approved = await world.cli(['wait', file, '--json', '--after', String(out1.seq.to)]);
  assert.equal(approved.code, 6, approved.stdout);
  assert.equal(JSON.parse(approved.stdout).decision, 'approve');

  assert.deepEqual(offLoopback, [], 'the browser only talked to loopback');
  assert.deepEqual(problems, [], 'no script errors or CSP violations');
  await page.close();
  assert.deepEqual(world.egress(), [], 'no vivamark process tried to leave the machine');
});
