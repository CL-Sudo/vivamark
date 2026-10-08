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
import { FIXTURE, makePng, makeWorld, startCli } from './helpers/harness.mjs';

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
  await pickAndAdd(doc.locator('p', { hasText: 'The save handler touches' }), 'Say how.');
  assert.equal(await page.locator('.note.queued').count(), 8);

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

  // F6: the agent asks back on one note; the page shows it, and the reviewer answers it.
  assert.equal(await page.getAttribute('#turn', 'data-turn'), 'agent');
  const ask = await world.cli(['reply', file, '--note', 'n_0002', '--status', 'question', '-m', 'Manual, or *scripted*?']);
  assert.equal(ask.code, 0, ask.stderr);
  await page.waitForSelector('.note[data-n="2"][data-status="question"] .note-reply.question em:text("scripted")');
  await page.click('.note[data-n="2"] button.answer');
  assert.equal(await page.textContent('#target-text'), 'answer to note 2');
  await page.fill('#comment', 'Scripted, in CI.');
  await page.click('#add');
  await page.click('#send');
  await page.waitForSelector('.note[data-n="2"][data-status="answered"]');
  const answered = JSON.parse((await world.cli(['wait', file, '--json', '--after', String(out1.seq.to)])).stdout);
  assert.equal(answered.notes[0].answers, 'n_0002');
  assert.equal(answered.notes[0].anchor.stable_id, 'step-3', 'the answer points where the question did');

  // F3: the agent rewords step 2, deletes step 3 and inserts a paragraph above the risks.
  fs.writeFileSync(
    file,
    original
      .replace('Applet scaffold, save handler and container page.', 'Applet scaffold and container page.')
      .replace(/\s*<li id="step-3">.*<\/li>/, '')
      .replace('<h2>Risks</h2>', '<h2>Risks</h2>\n  <p>Rollback is covered in step 4.</p>'),
  );
  await doc.locator('p', { hasText: 'Rollback is covered' }).waitFor({ timeout: 10_000 });
  await page.waitForSelector('.orphans .note[data-n="2"]');
  // The deleted step and the answer that pointed at it are listed apart, and nothing else.
  assert.deepEqual(await page.locator('.orphans .note').evaluateAll((els) => els.map((e) => e.dataset.n)), ['2', '9']);
  assert.match(await page.textContent('.orphans-head'), /Target gone · 2/);
  assert.equal(await page.locator('.note[data-n="8"] .pill.flag.moved').count(), 1);
  // The orphan is not drawn on the page; the moved note is drawn where its paragraph is now.
  const layerBadges = () =>
    frame().evaluate(() => [...(document.getElementById('__vivamark_layer')?.children ?? [])].map((c) => c.textContent).filter(Boolean));
  await frame().waitForFunction(() => [...(document.getElementById('__vivamark_layer')?.children ?? [])].some((c) => c.textContent === '8'));
  const badges = await layerBadges();
  assert.ok(!badges.includes('2'), `no badge for the orphaned note: ${badges}`);
  const markTop = await frame().evaluate(() => {
    const b = [...document.getElementById('__vivamark_layer').children].find((c) => c.textContent === '8');
    const p = [...document.querySelectorAll('p')].find((x) => x.textContent.startsWith('The save handler'));
    return { badge: b.getBoundingClientRect().top, para: p.getBoundingClientRect().top, bottom: p.getBoundingClientRect().bottom };
  });
  assert.ok(markTop.badge >= markTop.para - 12 && markTop.badge <= markTop.bottom, JSON.stringify(markTop));
  const reanchored = JSON.parse((await world.cli(['wait', file, '--json', '--after', '0'])).stdout);
  assert.deepEqual(reanchored.orphaned, ['n_0002', 'n_0009']);
  assert.equal(reanchored.notes[7].anchor.state, 'moved');

  // F2: what changed since the Send, highlighted only when asked for.
  await page.waitForFunction(() => !document.getElementById('show-changes').disabled);
  assert.match(await page.textContent('#show-changes'), /^Show changes · \d+$/);
  assert.equal(await page.locator('.note[data-n="1"] .pill.flag.changed').count(), 1, 'the reworded step is marked as changed');
  assert.equal(await page.locator('.note[data-n="8"] .pill.flag.changed').count(), 0, 'the moved paragraph did not change');
  assert.equal(await frame().locator('[data-vivamark-change]').count(), 0);
  await page.click('#show-changes');
  const changeMarks = (kind) => frame().locator(`[data-vivamark-change="${kind}"]`);
  await changeMarks('removal').first().waitFor();
  const removed = await changeMarks('removal').allTextContents();
  assert.ok(removed.some((t) => t.includes('save handler')), removed.join(' | '));
  assert.ok((await changeMarks('insert').count()) > 0, 'the inserted paragraph is highlighted');
  await page.click('#show-changes');
  await frame().waitForFunction(() => !document.querySelector('[data-vivamark-change]'));

  // F1: Approve with nothing queued sends a decision alone; wait exits 6.
  assert.equal(await page.textContent('#approve'), 'Approve');
  await page.click('#approve');
  await page.waitForSelector('.decision.approve');
  const approved = await world.cli(['wait', file, '--json', '--after', String(out1.seq.to)]);
  assert.equal(approved.code, 6, approved.stdout);
  assert.equal(JSON.parse(approved.stdout).decision, 'approve');
  // The approval took a new snapshot: nothing has changed since.
  await page.waitForFunction(() => document.getElementById('show-changes').disabled);

  // F7: a note from a tool shows on the page, labelled, and reaches no one by itself.
  const added = await world.cli(['note', 'add', file, '--target', '#step-1', '--text', 'Autoload refresh is untested.', '--source', 'lint']);
  assert.equal(added.code, 0, added.stderr);
  await page.waitForSelector('.note.agent[data-agent-id="a_0001"] >> text=From lint');
  await frame().waitForFunction(() => [...(document.getElementById('__vivamark_layer')?.children ?? [])].some((c) => c.textContent === 'A1'));

  // F2 again: a follow-up edit after the approval shows against the approved version.
  const approvedHtml = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, approvedHtml.replace('Nothing is written to the database.', 'Nothing is written to the database before approval.'));
  await page.waitForFunction(() => !document.getElementById('show-changes').disabled, null, { timeout: 10_000 });
  await page.click('#show-changes');
  await frame().locator('[data-vivamark-change="insert"]').first().waitFor();
  assert.deepEqual(await frame().locator('[data-vivamark-change="insert"]').allTextContents(), ['']);
  if (process.env.VIVAMARK_SCREENSHOT_DIR) {
    fs.mkdirSync(process.env.VIVAMARK_SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(process.env.VIVAMARK_SCREENSHOT_DIR, 'review-features.png') });
  }

  // F7: endorsing the tool's note makes it the reviewer's own, and only then does it reach wait.
  const beforeEndorse = JSON.parse((await world.cli(['wait', file, '--json', '--after', '0'])).stdout).seq.to;
  await page.click('.note.agent[data-agent-id="a_0001"] button.endorse');
  await page.waitForSelector('.note.queued >> text=Endorses A1');
  await page.click('#send');
  await page.waitForSelector('.note.agent[data-status="endorsed"]');
  const endorsed = JSON.parse((await world.cli(['wait', file, '--json', '--after', String(beforeEndorse)])).stdout);
  assert.equal(endorsed.notes.length, 1);
  assert.deepEqual([endorsed.notes[0].endorses, endorsed.notes[0].agent_note.source], ['a_0001', 'lint']);

  assert.deepEqual(offLoopback, [], 'the browser only talked to loopback');
  assert.deepEqual(problems, [], 'no script errors or CSP violations');
  await page.close();
  assert.deepEqual(world.egress(), [], 'no vivamark process tried to leave the machine');
});

test('End review on the page ends the review: the agent is told and the page takes nothing more', { timeout: 60_000 }, async (t) => {
  if (skipWithoutBrowser(t)) return;
  const file = path.join(world.pageDir, 'end-review.html');
  fs.writeFileSync(file, fs.readFileSync(FIXTURE, 'utf8'));
  const opened = await world.cli(['open', file, '--no-browser', '--json']);
  assert.equal(opened.code, 0, opened.stderr);
  const { page, offLoopback, problems } = await reviewPage(JSON.parse(opened.stdout).url);
  await page.frameLocator('#page').locator('#step-2').waitFor();
  assert.equal(await page.isHidden('#ended'), true);

  const waiting = startCli(['wait', file, '--json'], world.env);
  await page.waitForSelector('#presence[data-state="listening"]', { timeout: 10_000 });
  const dialogs = [];
  page.on('dialog', (d) => {
    dialogs.push(d.message());
    void d.accept();
  });
  await page.click('#end');
  const w = await waiting.done;
  assert.equal(w.code, 3, w.stderr);
  assert.equal(JSON.parse(w.stdout).ended.by, 'reviewer');
  assert.match(dialogs[0] ?? '', /End this review/);
  await page.waitForSelector('#ended:not([hidden])');
  assert.match(await page.textContent('#ended-head'), /You ended this review/);
  assert.equal(await page.isHidden('#composer'), true, 'nothing more can be written');

  // The agent's own end, with a message, shows the same way on a fresh review.
  const again = await world.cli(['open', file, '--no-browser', '--json']);
  const { page: page2 } = await reviewPage(JSON.parse(again.stdout).url);
  await page2.frameLocator('#page').locator('#step-2').waitFor();
  assert.equal((await world.cli(['end', file, '-m', 'Shipped; closing this one.'])).code, 0);
  await page2.waitForSelector('#ended:not([hidden])');
  assert.match(await page2.textContent('#ended-head'), /The agent ended this review/);
  assert.equal(await page2.textContent('#ended-message'), 'Shipped; closing this one.');

  assert.deepEqual(offLoopback, []);
  assert.deepEqual(problems, []);
  await page.close();
  await page2.close();
});

test('attachments: images and other files by file picker, paste or drop, shown as thumbnails or chips, removable, and sent only with the note', { timeout: 90_000 }, async (t) => {
  if (skipWithoutBrowser(t)) return;
  const file = path.join(world.pageDir, 'images.html');
  fs.writeFileSync(file, fs.readFileSync(FIXTURE, 'utf8'));
  const opened = await world.cli(['open', file, '--no-browser', '--json']);
  assert.equal(opened.code, 0, opened.stderr);
  const { page, offLoopback, problems } = await reviewPage(JSON.parse(opened.stdout).url);
  await page.frameLocator('#page').locator('#step-2').waitFor();

  const red = makePng(48, 32, [220, 38, 38]);
  const green = makePng(20, 20, [22, 163, 74]);
  const blue = makePng(30, 10, [37, 99, 235]);

  // The file picker, onto the note being written.
  await page.setInputFiles('#file-input', { name: 'red.png', mimeType: 'image/png', buffer: red });
  await page.waitForSelector('#composer-images .thumb img[src^="data:image/png"]');
  // A paste into the note.
  await page.focus('#comment');
  await page.evaluate((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'pasted.png', { type: 'image/png' }));
    document.getElementById('comment').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, green.toString('base64'));
  await page.waitForFunction(() => document.querySelectorAll('#composer-images .thumb').length === 2);
  // Removed before sending.
  await page.click('#composer-images .thumb:nth-child(2) .remove-image');
  assert.equal(await page.locator('#composer-images .thumb').count(), 1);
  // Not an image, whatever its name says: a chip with its name and size, never rendered.
  await page.setInputFiles('#file-input', { name: 'fake.png', mimeType: 'image/png', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="parent.pwned=1"/>') });
  await page.waitForSelector('#composer-images .thumb.attached-file');
  assert.equal(await page.textContent('#composer-images .thumb.attached-file .file-name'), 'fake.png');
  assert.equal(await page.locator('#composer-images .thumb.attached-file img').count(), 0);
  await page.click('#composer-images .thumb.attached-file .remove-image');
  assert.equal(await page.locator('#composer-images .thumb').count(), 1);
  // Over the per-file limit: refused with a message, nothing attached.
  await page.setInputFiles('#file-input', { name: 'huge.csv', mimeType: 'text/csv', buffer: Buffer.alloc(11 * 1024 * 1024, 'a') });
  await page.waitForFunction(() => /Not attached \(huge\.csv\): that file is 11 MB; a file may be at most 10 MB/.test(document.getElementById('banner').textContent));
  assert.equal(await page.locator('#composer-images .thumb').count(), 1);

  await page.fill('#comment', 'The header overlaps the table here, see the screenshot.');
  await page.click('#add');
  await page.waitForSelector('.note.queued .thumb img[src^="data:image/png"]');
  assert.equal(await page.isHidden('#composer-images'), true);

  // A drop onto the queued note adds to it.
  await page.evaluate((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'blue.png', { type: 'image/png' }));
    const card = document.querySelector('.note.queued');
    card.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
    card.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, blue.toString('base64'));
  await page.waitForFunction(() => document.querySelectorAll('.note.queued .thumb').length === 2);
  // So does any other file: the exported report the reviewer was asked for.
  const report = '<!doctype html><title>Detailed Report</title><script>parent.pwned = 1</script><p>Profit 12.5</p>';
  await page.evaluate((text) => {
    const dt = new DataTransfer();
    dt.items.add(new File([text], 'MT4 Detailed Report.htm', { type: 'text/html' }));
    const card = document.querySelector('.note.queued');
    card.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
    card.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, report);
  await page.waitForSelector('.note.queued .thumb.attached-file');
  assert.equal(await page.textContent('.note.queued .thumb.attached-file .file-name'), 'MT4 Detailed Report.htm');

  // Nothing has reached the agent.
  assert.equal((await world.cli(['wait', file, '--timeout', '800ms'])).code, 5);

  await page.click('#send');
  await page.waitForSelector('.note:not(.queued) .thumb img[src^="data:image/png"]');
  const w = await world.cli(['wait', file, '--json']);
  assert.equal(w.code, 0, w.stderr);
  const [note] = JSON.parse(w.stdout).notes;
  assert.deepEqual(note.attachments.map((a) => [a.mime, a.width, a.height, a.bytes, a.name]), [
    ['image/png', 48, 32, red.length, 'red.png'],
    ['image/png', 30, 10, blue.length, 'blue.png'],
    ['application/octet-stream', undefined, undefined, Buffer.byteLength(report), 'MT4 Detailed Report.htm'],
  ]);
  assert.deepEqual(fs.readFileSync(note.attachments[0].path), red);
  assert.equal(fs.readFileSync(note.attachments[2].path, 'utf8'), report);
  assert.match(await page.textContent('.note:not(.queued) .thumb.attached-file'), /MT4 Detailed Report\.htm/);
  // The file was never run or shown on the review page.
  assert.equal(await page.evaluate(() => window.pwned), undefined);

  assert.deepEqual(offLoopback, []);
  assert.deepEqual(problems, []);
  await page.close();
});

const ANSWER_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Decide</title></head>
<body>
<section id="decision-id" class="your-input">
  <h2>Which ID check?</h2>
  <label><input type="radio" name="idcheck" id="idcheck-mykad" value="mykad" data-vivamark-suggest="looks-good"> MyKad only (recommended)</label>
  <label><input type="radio" name="idcheck" id="idcheck-passport" value="passport" data-vivamark-suggest="looks-good"> MyKad or passport</label>
  <label><input type="radio" name="idcheck" id="idcheck-none" value="none" data-vivamark-suggest="looks-good"> No ID check</label>
</section>
<section id="decision-extras" class="your-input">
  <label><input type="checkbox" id="extra-audit" data-vivamark-suggest="change"> Also log every enrolment</label>
  <label for="region">Region</label>
  <select id="region">
    <option value="">Choose…</option>
    <option id="region-my" data-vivamark-suggest="looks-good">Malaysia first</option>
    <option id="region-all" data-vivamark-suggest="looks-good">All regions</option>
  </select>
</section>
<button type="button" id="fake">Page script: fake a choice</button>
<script>
  // A page script tries to answer for the reviewer, with an untrusted event.
  document.getElementById('fake').addEventListener('click', () => {
    const r = document.getElementById('idcheck-none');
    r.checked = true;
    r.dispatchEvent(new Event('change', { bubbles: true }));
  });
</script>
</body></html>
`;

test('click-to-answer: a marked control queues one note per group, from the page, sent only with Send', { timeout: 90_000 }, async (t) => {
  if (skipWithoutBrowser(t)) return;
  const file = path.join(world.pageDir, 'answer.html');
  fs.writeFileSync(file, ANSWER_PAGE);
  const opened = await world.cli(['open', file, '--no-browser', '--json']);
  assert.equal(opened.code, 0, opened.stderr);
  const { page, offLoopback, problems } = await reviewPage(JSON.parse(opened.stdout).url);
  const doc = page.frameLocator('#page');
  await doc.locator('#idcheck-mykad').waitFor();
  const suggested = () => page.locator('.note.queued.suggested').evaluateAll((els) => els.map((e) => e.querySelector('p.comment').textContent));

  // A real click queues one note, marked as from the page.
  await doc.locator('#idcheck-mykad').check();
  await page.waitForSelector('.note.queued.suggested >> text=From the page');
  assert.deepEqual(await suggested(), ['MyKad only (recommended)']);
  assert.equal(await page.locator('.note.queued.suggested .pill.intent.looks-good').count(), 1);
  // Another choice in the same group replaces it.
  await doc.locator('#idcheck-passport').check();
  await page.waitForFunction(() => document.querySelector('.note.queued.suggested p.comment')?.textContent === 'MyKad or passport');
  assert.equal(await page.locator('.note.queued').count(), 1);

  // A page script's synthetic change queues nothing. A trusted tick after it
  // proves the frame's messages have all arrived: they come in order.
  await doc.locator('#fake').click();
  await doc.locator('#extra-audit').check();
  await page.waitForFunction(() => document.querySelectorAll('.note.queued.suggested').length === 2);
  assert.deepEqual(await suggested(), ['MyKad or passport', 'Also log every enrolment']);
  // Unticking the checkbox withdraws its note.
  await doc.locator('#extra-audit').uncheck();
  await page.waitForFunction(() => document.querySelectorAll('.note.queued.suggested').length === 1);
  // A select, chosen with the keyboard (Playwright's selectOption fires an
  // untrusted change, which is exactly what must not count): a marked option
  // queues, the next one replaces it, an unmarked one withdraws it.
  const regionNotes = () => page.locator('.note.queued.suggested p.comment').evaluateAll((els) => els.map((p) => p.textContent).filter((x) => x.startsWith('Region')));
  await doc.locator('#region').focus();
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction(() => [...document.querySelectorAll('.note.queued.suggested p.comment')].some((p) => p.textContent === 'Region: Malaysia first'));
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction(() => [...document.querySelectorAll('.note.queued.suggested p.comment')].some((p) => p.textContent === 'Region: All regions'));
  assert.deepEqual(await regionNotes(), ['Region: All regions']);
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.waitForFunction(() => document.querySelectorAll('.note.queued.suggested').length === 1);
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction(() => document.querySelectorAll('.note.queued.suggested').length === 2);

  // The reviewer can make one their own: Edit moves it into the composer.
  await page.click('.note.queued.suggested:has-text("Region") button.edit');
  assert.equal(await page.inputValue('#comment'), 'Region: Malaysia first');
  await page.fill('#comment', 'Malaysia first, then Singapore.');
  await page.click('#add');
  assert.equal(await page.locator('.note.queued').count(), 2);
  assert.equal(await page.locator('.note.queued.suggested').count(), 1);

  // Nothing has reached the agent.
  const early = await world.cli(['wait', file, '--timeout', '800ms']);
  assert.equal(early.code, 5, early.stdout);

  await page.click('#send');
  await page.waitForSelector('.note:not(.queued) >> text=Sent');
  const w = await world.cli(['wait', file, '--json']);
  assert.equal(w.code, 0, w.stderr);
  const [radio, region] = JSON.parse(w.stdout).notes;
  assert.equal(radio.comment, 'MyKad or passport');
  assert.equal(radio.intent, 'looks-good');
  assert.equal(radio.anchor.stable_id, 'idcheck-passport');
  assert.deepEqual(radio.anchor.control, { role: 'radio', name: 'MyKad or passport' });
  assert.ok(radio.anchor.source_line > 1);
  assert.equal(radio.suggested, undefined, 'the page-only marker is not sent');
  assert.equal(region.comment, 'Malaysia first, then Singapore.');
  assert.equal(region.anchor.stable_id, 'region-my');

  assert.deepEqual(offLoopback, []);
  assert.deepEqual(problems, []);
  await page.close();
});
