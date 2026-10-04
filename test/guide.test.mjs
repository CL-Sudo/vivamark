// vivamark guide: the index, each topic, --json, unknown topics, and the
// promises the topics make (no external URLs in the page CSS).

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { GUIDE_SCHEMA, PAGE_CSS, TOPICS, skillMarkdown } from '../dist/internal.js';
import { ROOT, makeWorld, runCli } from './helpers/harness.mjs';

const NO_STATE = '/nonexistent/vivamark-guide-should-not-be-created';
const env = { ...process.env, VIVAMARK_STATE_DIR: NO_STATE };
const REQUIRED = ['workflow', 'design', 'ids', 'plan', 'report', 'comparison', 'explainer', 'diff', 'markdown'];

test('guide prints an index of every topic, without a server or state', async () => {
  const r = await runCli(['guide'], env);
  assert.equal(r.code, 0);
  for (const name of REQUIRED) assert.ok(TOPICS.some((t) => t.name === name), `topic ${name} exists`);
  for (const t of TOPICS) assert.match(r.stdout, new RegExp(`^  ${t.name} +${t.summary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
  assert.equal(fs.existsSync(NO_STATE), false);
});

test('guide <topic> prints that topic, and --json gives the same content', async () => {
  for (const t of TOPICS) {
    const r = await runCli(['guide', t.name], env);
    assert.equal(r.code, 0, t.name);
    assert.equal(r.stdout, t.text);
    const j = JSON.parse((await runCli(['guide', t.name, '--json'], env)).stdout);
    assert.deepEqual(j, { schema: GUIDE_SCHEMA, topic: t.name, summary: t.summary, text: t.text });
  }
  const index = JSON.parse((await runCli(['guide', '--json'], env)).stdout);
  assert.deepEqual(index, { schema: GUIDE_SCHEMA, topics: TOPICS.map(({ name, summary }) => ({ name, summary })) });
});

test('an unknown topic exits non-zero and lists the valid ones', async () => {
  const r = await runCli(['guide', 'frobnicate'], env);
  assert.equal(r.code, 2);
  assert.equal(r.stdout, '');
  for (const t of TOPICS) assert.match(r.stderr, new RegExp(`\\b${t.name}\\b`));
  assert.equal((await runCli(['guide', 'plan', 'report'], env)).code, 2);
});

test('topics stay compact: a few screens at most', () => {
  for (const t of TOPICS) assert.ok(t.text.split('\n').length <= 130, `${t.name} has ${t.text.split('\n').length} lines`);
});

test('the design CSS fetches nothing and covers light, dark and a page background', () => {
  assert.doesNotMatch(PAGE_CSS, /https?:|\/\/[a-z]|url\(|@import|@font-face/i);
  assert.match(PAGE_CSS, /@media \(prefers-color-scheme: dark\)/);
  assert.match(PAGE_CSS, /html \{ background: var\(--bg\); \}/);
  assert.match(PAGE_CSS, /max-width: var\(--measure\)/);
  assert.match(PAGE_CSS, /\.scroll \{ overflow-x: auto;/);
  const design = TOPICS.find((t) => t.name === 'design').text;
  assert.ok(design.includes(PAGE_CSS), 'the design topic carries the CSS verbatim');
});

test('the workflow topic covers waiting, ended, disconnected and per-note replies', () => {
  const w = TOPICS.find((t) => t.name === 'workflow').text;
  assert.match(w, /Never nohup, never a trailing &/);
  assert.match(w, /sure to wake this same\s+agent/);
  assert.match(w, /3 +ended/);
  assert.match(w, /4 +disconnected/);
  assert.match(w, /reply <file> --note n_0001 --status addressed/);
  assert.match(w, /--after <seq>/);
});

test('the plan playbook ends on decisions, and decisions are answered with real controls in a Your input card', () => {
  const plan = TOPICS.find((t) => t.name === 'plan').text;
  const order = ['Risks', 'Open questions', 'Decisions for the reviewer'].map((h) => plan.indexOf(h));
  assert.ok(order.every((i) => i > 0) && order[0] < order[1] && order[1] < order[2], 'risks, then questions, then decisions');
  assert.match(plan, /\.your-input card/);
  assert.match(plan, /data-vivamark-suggest/);
  const d = TOPICS.find((t) => t.name === 'decisions').text;
  // Controls first; pointing is the fallback for free-form questions.
  const controls = d.indexOf('data-vivamark-suggest');
  const fallback = d.indexOf('Free-form questions: the fallback');
  assert.ok(controls > 0 && fallback > controls, 'controls lead, pointing follows');
  assert.match(d, /class="your-input"/);
  assert.match(d, /type="radio"/);
  assert.match(d, /"looks-good"/);
  assert.match(d, /Nothing is sent by the click/);
  assert.match(d, /Press Point, clicks it and writes a note|presses Point, clicks it and writes a note/);
  assert.match(PAGE_CSS, /\.your-input::before \{ content: "Your input";/);
});

test('the workflow topic says where images arrive in wait output', () => {
  const w = TOPICS.find((t) => t.name === 'workflow').text;
  assert.match(w, /attachments lists them as \{id, path, mime, width, height, bytes\}/);
  assert.match(w, /path is a\s+local file/);
});

test('the guide never names a particular orchestrator or harness', () => {
  // cursor, but not the CSS property `cursor:` in the design CSS.
  for (const t of TOPICS) assert.doesNotMatch(t.text, /orchestrator|\borc\b|claude|codex|cursor(?!\s*:)|copilot/i, t.name);
});

test('the committed skill stub matches its generator, and the check catches drift', async () => {
  const stub = path.join(ROOT, 'skills', 'vivamark', 'SKILL.md');
  assert.equal(fs.readFileSync(stub, 'utf8'), skillMarkdown(), 'regenerate with: npm run skill');
  const script = path.join(ROOT, 'scripts', 'build-skill.mjs');
  const ok = spawnSync(process.execPath, [script, '--check'], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vivamark-skill-'));
  try {
    const copy = path.join(dir, 'SKILL.md');
    fs.writeFileSync(copy, skillMarkdown().replace('vivamark guide', 'vivamark guide --old'));
    const drift = spawnSync(process.execPath, [script, '--check', copy], { encoding: 'utf8' });
    assert.equal(drift.status, 1);
    assert.match(drift.stderr, /out of date/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the skill stub is an Agent Skill that only points at the guide', () => {
  const md = skillMarkdown();
  const m = /^---\nname: vivamark\ndescription: ([^\n]+)\n---\n/.exec(md);
  assert.ok(m, 'front matter with name and description');
  assert.ok(m[1].length <= 1024 && !/: /.test(m[1]), 'a short plain YAML description');
  assert.match(md, /vivamark guide/);
  for (const t of TOPICS) assert.ok(md.includes(`\`${t.name}\`: ${t.summary}`), t.name);
  // No rules of its own: none of the guide's instructions are repeated here.
  assert.doesNotMatch(md, /nohup|--after|data-vivamark-id|prefers-color-scheme|--status/);
});

test('--help lists guide', async () => {
  const h = await runCli(['--help'], env);
  assert.match(h.stdout, /^  vivamark guide \[<topic>\] \[--json\]$/m);
});

test('open points at the guide; for a .md file, at the markdown topic', async () => {
  const world = makeWorld();
  try {
    const html = await world.cli(['open', world.page, '--no-browser']);
    assert.equal(html.code, 0, html.stderr);
    assert.match(html.stdout, /^next: vivamark wait .*plan\.html$/m, 'next stays the wait command');
    assert.match(html.stdout, /^guide: .*vivamark guide$/m);
    const md = path.join(world.pageDir, 'notes.md');
    fs.writeFileSync(md, '# Notes\n\nA short draft.\n');
    const text = await world.cli(['open', md, '--no-browser']);
    assert.match(text.stdout, /^guide: .*structured HTML page is often better: vivamark guide markdown$/m);
    const json = JSON.parse((await world.cli(['open', md, '--no-browser', '--json'])).stdout);
    assert.match(json.guide, /vivamark guide markdown$/);
    assert.match(json.next, /^vivamark wait /);
  } finally {
    await world.cleanup();
  }
});

test('examples/plan.html follows the plan playbook and carries the design CSS', () => {
  const html = fs.readFileSync(path.join(ROOT, 'examples', 'plan.html'), 'utf8');
  assert.ok(html.includes(PAGE_CSS), 'the design CSS, verbatim');
  assert.doesNotMatch(html, /\b(src|href)=["']?(https?:)?\/\//i, 'no external URLs');
  assert.doesNotMatch(html, /<script|<link /i);
  const order = ['id="steps"', 'id="testing"', 'id="risks"', 'id="open-questions"', 'id="decisions"'].map((s) => html.indexOf(s));
  assert.ok(order.every((i, k) => i > 0 && (k === 0 || i > order[k - 1])), 'steps, testing, risks, open questions, then decisions last');
  for (const li of html.match(/<li\b[^>]*>/g)) assert.match(li, /\bid="[a-z0-9-]+"/, `every list item has an id: ${li}`);
  for (const tr of html.match(/<tbody>[\s\S]*?<\/tbody>/)[0].match(/<tr\b[^>]*>/g)) assert.match(tr, /\bid="/, 'every body row has an id');
  // Decisions: each in a Your input card, answered with marked radio buttons.
  const cards = html.match(/<section id="decision-[a-z-]+" class="your-input">/g) ?? [];
  assert.ok(cards.length >= 2, 'decisions in Your input cards');
  const radios = html.match(/<input type="radio" name="decision-[a-z-]+" id="decision-[a-z-]+"[^>]*data-vivamark-suggest="looks-good">/g) ?? [];
  assert.ok(radios.length >= 4, 'options as radio buttons marked data-vivamark-suggest');
  assert.doesNotMatch(html, /<input[^>]*\bchecked\b/, 'nothing pre-selected');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
});
