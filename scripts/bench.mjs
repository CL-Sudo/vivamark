// In-process timings of the daemon's per-request work on a large synthetic
// page and the examples. No server, no sockets: run `npm run build`, then
// `node scripts/bench.mjs [sections]` (default 2000, about 370 KB of HTML).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Daemon, diffText, injectScript, loadDoc, locate, namedTarget, Store } from '../dist/internal.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function time(label, fn, runs = 10) {
  fn();
  const t = performance.now();
  for (let i = 0; i < runs; i++) fn();
  console.log(`${label.padEnd(44)} ${((performance.now() - t) / runs).toFixed(2).padStart(8)} ms`);
}

const sections = Number(process.argv[2] ?? 2000);
let body = '';
for (let i = 0; i < sections; i++) {
  body += `<section><h2>Section ${i}</h2><div class="card"><div><p>Paragraph ${i} with some words alpha beta gamma delta ${i}.</p><ul><li>item a ${i}</li><li>item b ${i}</li></ul></div></div></section>\n`;
}
body += '<p id="last">The final paragraph here.</p>';
const html = `<!doctype html><html><head><title>bench</title></head><body>${body}</body></html>`;
const doc = loadDoc('html', html);
console.log(`synthetic page: ${html.length} bytes, ${doc.ranges.size} body elements`);

time('injectScript (every page load)', () => injectScript(html, '<script></script>'));
time('loadDoc (re-anchoring, Send)', () => loadDoc('html', html));
time('locate: element by text', () =>
  locate(doc, { selector: 'body > section:nth-of-type(3) > div:nth-of-type(1)', tag: 'div', text: 'Paragraph 2 with some words' }),
);
time('locate: element by stable id', () => locate(doc, { stable_id: 'last', selector: '#last', tag: 'p', text: 'The final' }));
time('locate: quote', () =>
  locate(doc, {
    selector: `body > section:nth-of-type(${sections}) > div:nth-of-type(1) > div:nth-of-type(1) > p:nth-of-type(1)`,
    quote: 'alpha beta',
    prefix: 'words ',
    suffix: ` gamma delta ${sections - 1}`,
  }),
);
// After an edit, every note is looked up afresh in the new parse; many carry an id.
{
  const withIds = html.replace(/<section><h2>Section (\d+)<\/h2>/g, '<section id="s$1"><h2 id="h$1">Section $1</h2>');
  const fresh = Array.from({ length: 11 }, () => loadDoc('html', withIds));
  const ids = Array.from({ length: 50 }, (_, k) => Math.floor(((k + 0.5) * sections) / 50));
  time('locate: 50 notes by id, freshly parsed page', () => {
    const d = fresh.pop();
    for (const i of ids) locate(d, { stable_id: `h${i}`, selector: `#h${i}`, tag: 'h2', text: `Section ${i}` });
  });
}
const edited = loadDoc('html', html.replace('Paragraph 5 ', 'Paragraph five '));
time('diffText (what changed since Send)', () => diffText(doc.text, edited.text));

for (const name of ['report.html', 'plan.html', 'plan.md']) {
  const source = fs.readFileSync(path.join(root, 'examples', name), 'utf8');
  const kind = name.endsWith('.md') ? 'markdown' : 'html';
  time(`examples/${name}: loadDoc`, () => loadDoc(kind, source, name));
  if (kind === 'html') time(`examples/${name}: injectScript`, () => injectScript(source, '<script></script>'));
}

// A long Markdown file: where a note sits, and `note add --target line:N`.
let md = '';
for (let i = 0; i < sections; i++) md += `## Section ${i}\n\nParagraph ${i} with some words alpha beta gamma delta ${i}.\n\n- item a ${i}\n- item b ${i}\n\n`;
const mdDoc = loadDoc('markdown', md, 'bench.md');
console.log(`synthetic markdown: ${md.length} bytes, ${md.split('\n').length} lines, ${mdDoc.ranges.size} body elements`);
const mid = Math.floor(sections / 2);
time('markdown: note add --target line:N', () => namedTarget(mdDoc, `line:${mid * 7 + 3}`), 3);
time('markdown: locate element by text', () => locate(mdDoc, { selector: 'body > p:nth-of-type(3)', tag: 'p', text: 'Paragraph 2 with some words' }));
time('markdown: locate quote', () =>
  locate(mdDoc, { selector: `body > p:nth-of-type(${mid + 1})`, quote: 'alpha beta', prefix: 'words ', suffix: ` gamma delta ${mid}` }),
);

// A Send and a resolve as the daemon handles them (its private methods, called
// directly): parse the file, keep a snapshot, log the note, re-anchor notes.
const state = fs.mkdtempSync(path.join(os.tmpdir(), 'vivamark-bench-'));
try {
  const file = path.join(state, 'page.html');
  fs.writeFileSync(file, html);
  const store = new Store(path.join(state, 'state'));
  const daemon = new Daemon(store, 60_000);
  const { session: s } = store.openSession(file, {});
  let round = 0;
  time('daemon: a Send, then the session read', () => {
    round += 1;
    const sent = daemon.readDoc(s);
    const hash = store.saveSnapshot(s, sent.source);
    const anchor = { selector: 'body > p:nth-of-type(1)', tag: 'p', text: `Paragraph ${round} with some words` };
    store.appendBatch(s, [{ kind: 'element', comment: 'c', anchor }], 'changes', hash, () => null);
    daemon.analyze(s);
  }, 5);
  time('daemon: a resolve, then the session read', () => {
    round += 1;
    store.appendAnnotation(s, { type: 'resolve', at: new Date().toISOString(), note: 'n_0001', resolved: round % 2 === 0 });
    daemon.analyze(s);
  }, 5);
  // Re-anchoring grows with the number of notes: add 40 more, then resolve again.
  const hash = store.saveSnapshot(s, daemon.readDoc(s).source);
  const more = Array.from({ length: 40 }, (_, i) => ({
    kind: 'element',
    comment: 'c',
    anchor: { selector: `body > section:nth-of-type(${i + 1}) > h2:nth-of-type(1)`, tag: 'h2', text: `Section ${i}` },
  }));
  store.appendBatch(s, more, 'changes', hash, () => null);
  time('daemon: a resolve with about 50 notes', () => {
    round += 1;
    store.appendAnnotation(s, { type: 'resolve', at: new Date().toISOString(), note: 'n_0001', resolved: round % 2 === 0 });
    daemon.analyze(s);
  }, 5);
  // A page load of the long Markdown file once the daemon has parsed it (a live
  // reload re-anchors notes first): the parse's rendered page is served.
  const mdFile = path.join(state, 'bench.md');
  fs.writeFileSync(mdFile, md);
  const { session: m } = store.openSession(mdFile, {});
  daemon.analyze(m);
  const res = { writeHead() {}, end() {} };
  time('daemon: a Markdown page load', () => daemon.serveArtifact(res, m, '', '', null), 5);
  // The review page reads the whole session on every reply, Send and resolve.
  for (let i = 0; i < 100; i++) store.appendReply(s, `Changed **section ${i}**:\n\n- moved the \`table\`\n- see [the link](#s${i})\n\n\`\`\`js\nconst x = ${i};\n\`\`\``);
  time('daemon: a session read with 100 replies', () => JSON.stringify(daemon.sessionView(s)), 5);
} finally {
  fs.rmSync(state, { recursive: true, force: true });
}
