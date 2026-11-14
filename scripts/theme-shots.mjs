// Screenshots of one review in every theme, at desktop and phone width:
// examples/report.html with two sent notes (one addressed, one the agent asks
// back on), a note from the agent, a queued note, a draft in the composer
// and Show changes on. The theme is switched on the page between shots, so
// the draft and the queue carry through each switch.
// Run after npm run build:
//   node scripts/theme-shots.mjs <out-dir> [theme ...]
// VIVAMARK_PORT picks the server's port; VIVAMARK_CHROME the browser.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { browserUrl, makeWorld, ROOT } from '../test/helpers/harness.mjs';

const outDir = path.resolve(process.argv[2] ?? 'theme-shots');
const only = process.argv.slice(3);
fs.mkdirSync(outDir, { recursive: true });
const original = fs.readFileSync(path.join(ROOT, 'examples', 'report.html'), 'utf8');
const world = makeWorld();
if (process.env.VIVAMARK_PORT) world.env.VIVAMARK_PORT = process.env.VIVAMARK_PORT;
const browser = await chromium.launch({ headless: true, executablePath: process.env.VIVAMARK_CHROME || undefined });
try {
  const file = path.join(world.pageDir, 'report.html');
  fs.writeFileSync(file, original);
  const opened = JSON.parse((await world.cli(['open', file, '--no-browser', '--json'])).stdout);
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.route('**/*', (r) => (['127.0.0.1', 'localhost'].includes(new URL(r.request().url()).hostname) ? r.continue() : r.abort()));
  await page.goto(browserUrl(opened.url));
  const doc = page.frameLocator('#page');
  await doc.locator('#finding-stale').waitFor();

  const point = async (locator, position) => {
    await page.click('#point');
    await locator.click(position ? { position } : undefined);
    await page.waitForFunction(() => document.getElementById('target')?.dataset.kind === 'element');
  };
  await point(doc.locator('#finding-stale'));
  await page.fill('#comment', 'Name the cache key that went stale, and the runs it broke.');
  await page.click('#add');
  await point(doc.locator('#viz-runs'), { x: 120, y: 60 });
  await page.fill('#comment', "Use the same time axis as last week's report.");
  await page.click('#add');
  await page.click('#send');
  await page.waitForSelector('.note[data-status="open"]');
  await world.cli(['reply', file, '--note', 'n_0001', '--status', 'addressed', '-m', 'Named both: the branch-only key, and runs 04 and 09.']);
  await world.cli(['reply', file, '--note', 'n_0002', '--status', 'question', '-m', 'Last week starts at 00:00, this one at 01:30. Start both at 00:00?']);
  await world.cli(['note', 'add', file, '--target', '#finding-cold', '--text', 'The cold start is the runner image, not the cache.', '--source', 'agent']);
  await page.waitForSelector('.note-reply.question');
  await page.waitForSelector('.note.agent');
  fs.writeFileSync(file, original.replace('The cache key was the branch name only,', 'The cache key was the branch name only (not the lockfile hash),'));
  await page.waitForFunction(() => !document.getElementById('show-changes').disabled, null, { timeout: 10_000 });
  await page.click('#show-changes');
  await point(doc.locator('#run-04 td').nth(1));
  await page.fill('#comment', 'Is this the time the build failed, or when the job gave up?');
  await page.click('#add');
  await point(doc.locator('#finding-speed'));
  await page.fill('#comment', 'Say how many runs the median is over.');
  await page.waitForSelector('#banner', { state: 'hidden', timeout: 10_000 });

  const themes = await page.evaluate(() => [...document.querySelectorAll('#theme option')].map((o) => o.value));
  for (const id of themes) {
    if (only.length && !only.includes(id)) continue;
    await page.selectOption('#theme', id);
    for (const [label, viewport] of [
      ['desktop', { width: 1440, height: 900 }],
      ['phone', { width: 390, height: 844 }],
    ]) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(400);
      const out = path.join(outDir, `${id}-${label}.png`);
      await page.screenshot({ path: out, fullPage: label === 'phone' });
      console.log('saved', out);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  }
  const draft = await page.inputValue('#comment');
  if (draft !== 'Say how many runs the median is over.') throw new Error(`the draft did not survive the theme switches: ${JSON.stringify(draft)}`);
} finally {
  await browser.close();
  await world.cleanup();
}
