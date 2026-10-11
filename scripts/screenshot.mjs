// Regenerates the README screenshots by driving the review UI in headless
// Chromium. review-ui.png shows intents and severities, an approval, a note
// from the agent, and Show changes. attach-answer.png shows a queued note with
// an attached screenshot, and a decision answered by clicking a radio button.
// Run after npm run build:
//   node scripts/screenshot.mjs [out-dir]
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { makeWorld, ROOT } from '../test/helpers/harness.mjs';

const outDir = process.argv[2] ?? path.join(ROOT, 'docs', 'screenshots');
const original = fs.readFileSync(path.join(ROOT, 'examples', 'plan.html'), 'utf8');
const browser = await chromium.launch({ headless: true });
try {
  await shoot('review-ui.png', { width: 1280, height: 800 }, reviewUi);
  await shoot('attach-answer.png', { width: 1360, height: 860 }, attachAnswer);
} finally {
  await browser.close();
}

/** Opens a fresh copy of examples/plan.html for review, runs scene, and saves the page. */
async function shoot(name, viewport, scene) {
  const world = makeWorld();
  const file = path.join(world.pageDir, 'plan.html');
  fs.writeFileSync(file, original);
  try {
    const opened = JSON.parse((await world.cli(['open', file, '--no-browser', '--json'])).stdout);
    const page = await browser.newPage({ viewport });
    await page.route('**/*', (r) => (['127.0.0.1', 'localhost'].includes(new URL(r.request().url()).hostname) ? r.continue() : r.abort()));
    await page.goto(opened.url);
    const doc = page.frameLocator('#page');
    await doc.locator('#step-2').waitFor();
    await scene(page, doc, world, file);
    const out = path.join(outDir, name);
    await page.screenshot({ path: out });
    console.log('saved', out);
  } finally {
    await world.cleanup();
  }
}

async function reviewUi(page, doc, world, file) {
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
}

async function attachAnswer(page, doc) {
  // A note on the canary owner, with a screenshot of the owner column attached.
  await page.click('#point');
  await doc.locator('#rollout td', { hasText: 'Shadow traffic' }).click();
  await page.waitForFunction(() => document.getElementById('target')?.dataset.kind === 'element');
  await page.click('#tags [data-intent="change"]');
  await page.fill('#comment', 'Name a person, not a team: see the highlighted owner column in the screenshot.');
  const box = await doc.locator('#rollout th', { hasText: 'Owner' }).boundingBox();
  const table = await doc.locator('#rollout').boundingBox();
  const shot = await page.screenshot({ clip: { x: box.x - 24, y: table.y, width: box.width + 120, height: table.height } });
  await page.setInputFiles('#file-input', { name: 'owners.png', mimeType: 'image/png', buffer: shot });
  await page.waitForSelector('#composer img');
  await page.click('#add');
  // The reviewer answers a decision by clicking its radio button.
  await doc.locator('#decision-rollout-staged').click();
  await page.waitForSelector('.note.queued >> text=From the page');
  await doc.locator('#decision-placement').evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(300);
}
