// Times the review script's redraw in Playwright's headless Chromium: a long
// page with note marks and changes shown, in pick mode, hovered over one
// element per frame. Every request is served by request interception and
// anything else is aborted, so nothing reaches a socket.
// `npm run build && node scripts/bench-draw.mjs [sdk.js] [sections] [marks]`
// (defaults: dist/ui/sdk.js, 2000 sections, about 370 KB, and 40 marks).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sdk = fs.readFileSync(process.argv[2] ?? path.join(root, 'dist/ui/sdk.js'), 'utf8');
const sections = Number(process.argv[3] ?? 2000);
const nMarks = Number(process.argv[4] ?? 40);
let body = '';
for (let i = 0; i < sections; i++) body += `<section id="s${i}"><h2>Section ${i}</h2><div class="card"><div><p>Paragraph ${i} with some words alpha beta gamma delta ${i}.</p><ul><li>item a ${i}</li><li>item b ${i}</li></ul></div></div></section>\n`;
const page = `<!doctype html><html><head><title>b</title><script src="http://vivamark.invalid/sdk.js"></script></head><body>${body}</body></html>`;
const parent = `<!doctype html><html><body style="margin:0"><iframe id="f" src="http://vivamark.invalid/page" style="width:1200px;height:900px;border:0"></iframe></body></html>`;
const init = `(() => { if (window.parent === window) return; const raf = window.requestAnimationFrame.bind(window); window.__draws = [];
  window.requestAnimationFrame = (cb) => raf((t) => { const s = performance.now(); cb(t); window.__draws.push(performance.now() - s); }); })();`;
const browser = await chromium.launch({ headless: true, executablePath: process.env.VIVAMARK_CHROME || undefined });
try {
  const ctx = await browser.newContext();
  await ctx.route('**/*', (r) => {
    const u = r.request().url();
    if (u === 'http://vivamark.invalid/') return r.fulfill({ contentType: 'text/html', body: parent });
    if (u === 'http://vivamark.invalid/page') return r.fulfill({ contentType: 'text/html', body: page });
    if (u === 'http://vivamark.invalid/sdk.js') return r.fulfill({ contentType: 'text/javascript', body: sdk });
    return r.abort();
  });
  await ctx.addInitScript(init);
  const p = await ctx.newPage();
  await p.goto('http://vivamark.invalid/');
  const f = p.frames().find((x) => x.url() === 'http://vivamark.invalid/page');
  await f.waitForLoadState('load');
  const marks = [];
  for (let i = 0; i < nMarks; i++) {
    const k = Math.floor((i * sections) / nMarks);
    if (i % 2) marks.push({ n: i + 1, kind: 'element', queued: false, anchor: { stable_id: null, selector: `#s${k} > div:nth-of-type(1) > div:nth-of-type(1) > p:nth-of-type(1)` } });
    else marks.push({ n: i + 1, kind: 'text', queued: false, anchor: { stable_id: null, selector: `#s${k} > div:nth-of-type(1) > div:nth-of-type(1) > p:nth-of-type(1)`, quote: 'alpha beta', prefix: 'words ', suffix: ` gamma delta ${k}.` } });
  }
  const text = await f.evaluate(() => document.body.textContent.length);
  await p.evaluate(({ marks, text }) => {
    const w = document.getElementById('f').contentWindow;
    w.postMessage({ vivamark: 1, type: 'marks', marks, show: true }, '*');
    w.postMessage({ vivamark: 1, type: 'changes', show: true, inserts: [{ at: Math.floor(text / 2), text: 'x' }], removals: [{ at: 100, text: 'old words' }] }, '*');
    w.postMessage({ vivamark: 1, type: 'mode', pick: true }, '*');
  }, { marks, text });
  await p.waitForTimeout(300);
  const layerKids = await f.evaluate(() => document.getElementById('__vivamark_layer')?.childElementCount);
  // Hover over different elements, one per frame, as a moving mouse does.
  const res = await f.evaluate(async (sections) => {
    window.__draws.length = 0;
    for (let i = 0; i < 30; i++) {
      document.querySelector(`#s${(i * 37) % sections} h2`).dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    }
    return window.__draws.filter((d) => d > 0.05);
  }, sections);
  res.sort((a, b) => a - b);
  console.log(`redraw: sections=${sections} marks=${nMarks} layer=${layerKids} draws=${res.length} median ${res[res.length >> 1]?.toFixed(2)} ms, max ${res.at(-1)?.toFixed(2)} ms`);
} finally {
  await browser.close();
}
