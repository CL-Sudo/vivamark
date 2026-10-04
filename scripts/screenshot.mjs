// Regenerates docs/screenshots/review-ui.png: drives the review UI in headless
// Chromium to a state that shows intents and severities, an approval, a note
// from the agent, and Show changes. Run after npm run build:
//   node scripts/screenshot.mjs [out.png]
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { makeWorld, ROOT } from '../test/helpers/harness.mjs';

const out = process.argv[2] ?? path.join(ROOT, 'docs', 'screenshots', 'review-ui.png');
const world = makeWorld();
const file = path.join(world.pageDir, 'plan.html');
const original = fs.readFileSync(path.join(ROOT, 'examples', 'plan.html'), 'utf8');
fs.writeFileSync(file, original);
const browser = await chromium.launch({ headless: true });
try {
  const opened = JSON.parse((await world.cli(['open', file, '--no-browser', '--json'])).stdout);
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.route('**/*', (r) => (['127.0.0.1', 'localhost'].includes(new URL(r.request().url()).hostname) ? r.continue() : r.abort()));
  await page.goto(opened.url);
  const doc = page.frameLocator('#page');
  await doc.locator('#step-2').waitFor();
  const note = async (locator, text, intent, severity, position) => {
    await page.click('#point');
    await locator.click(position ? { position } : undefined);
    await page.waitForFunction(() => document.getElementById('target')?.dataset.kind === 'element');
    if (intent) await page.click(`#tags [data-intent="${intent}"]`);
    if (severity) await page.click(`#tags [data-severity="${severity}"]`);
    await page.fill('#comment', text);
    await page.click('#add');
  };
  await note(doc.locator('#step-2'), 'Split this: the scaffold and the save handler are separate risks.', 'change', 'blocking');
  await note(doc.locator('#rollout td', { hasText: 'Payments team' }), 'Who on the payments team signs this off?', 'question', 'important');
  await note(doc.locator('#summary'), 'Clear and short. Keep it.', 'looks-good', 'nit');
  await page.click('#send');
  await page.waitForSelector('.note:not(.queued) >> text=Sent');
  // The agent works: it splits step 2, answers one note and asks back on another.
  fs.writeFileSync(file, original.replace(
    '<li id="step-2">Applet scaffold, save handler and container page.</li>',
    '<li id="step-2">Applet scaffold and container page.</li>\n    <li id="step-2b">Save handler, with a rollback test for a failed enrolment.</li>',
  ));
  await world.cli(['reply', file, '--note', 'n_0001', '--status', 'addressed', '-m', 'Split into two steps.']);
  await world.cli(['reply', file, '--note', 'n_0002', '--status', 'question', '-m', 'The team lead, or the on-call engineer?']);
  await world.cli(['note', 'add', file, '--target', '#error-rate', '--text', 'The spike is a deploy, not a bug. I checked the logs.', '--source', 'agent']);
  await page.waitForSelector('.note-reply.question');
  await page.waitForSelector('.note.agent');
  // The reviewer approves, then the agent tidies the summary: Show changes.
  await page.click('#approve');
  await page.waitForSelector('.decision.approve');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('Nothing is written to the database.', 'Nothing is written to the database until the enrolment succeeds.'));
  await page.waitForFunction(() => !document.getElementById('show-changes').disabled, null, { timeout: 10_000 });
  await page.click('#show-changes');
  await page.frames().find((f) => f.url().includes('/a/')).locator('[data-vivamark-change="insert"]').first().waitFor();
  await page.waitForSelector('#banner', { state: 'hidden', timeout: 10_000 });
  // Show the second and third notes, the approval and the agent's own note.
  await page.evaluate(() => {
    const t = document.getElementById('thread');
    t.scrollTop = t.scrollHeight;
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: out });
  console.log('saved', out);
} finally {
  await browser.close();
  await world.cleanup();
}
