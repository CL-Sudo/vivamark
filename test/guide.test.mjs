// vivamark guide: the index, each topic, --json, unknown topics, and the
// promises the topics make (no external URLs in the page CSS).

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { GUIDE_SCHEMA, PAGE_CSS, TOPICS, skillMarkdown } from '../dist/internal.js';
import { ROOT, runCli } from './helpers/harness.mjs';

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

test('the plan playbook ends on decisions, and decisions are answered by pointing', () => {
  const plan = TOPICS.find((t) => t.name === 'plan').text;
  const order = ['Risks', 'Open questions', 'Decisions for the reviewer'].map((h) => plan.indexOf(h));
  assert.ok(order.every((i) => i > 0) && order[0] < order[1] && order[1] < order[2], 'risks, then questions, then decisions');
  const d = TOPICS.find((t) => t.name === 'decisions').text;
  assert.match(d, /Looks good/);
  assert.match(d, /"looks-good"/);
});

test('the guide never names a particular orchestrator or harness', () => {
  for (const t of TOPICS) assert.doesNotMatch(t.text, /orchestrator|\borc\b|claude|codex|cursor|copilot/i, t.name);
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
