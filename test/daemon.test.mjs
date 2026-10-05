// One daemon per state directory. The CLI must never start a second daemon
// beside one that is running but slow to answer: the review page stays
// connected to the first, so a second one would answer `wait` from a log that
// never sees the reviewer's notes. SIGSTOP stands in for a daemon too busy to
// answer its health check: its port still accepts connections, nothing replies.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import WebSocket from 'ws';
import { CLI, ELEMENT_NOTE, makeWorld, openSession, sendNotes, startCli } from './helpers/harness.mjs';

const posix = process.platform !== 'win32';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let world;

afterEach(async () => {
  if (!world) return;
  // Whatever the test did, no daemon of its own outlives it: resume and stop every one the log names.
  for (const pid of daemonPids(world)) {
    try {
      process.kill(pid, 'SIGCONT');
      process.kill(pid, 'SIGTERM');
    } catch {
      // Already gone.
    }
  }
  await world.cleanup();
  world = undefined;
});

/** Every daemon pid that ever logged "listening" for this world's state directory. */
function daemonPids(w) {
  const log = path.join(w.stateDir, 'daemon.log');
  if (!fs.existsSync(log)) return [];
  return [...fs.readFileSync(log, 'utf8').matchAll(/listening on \S+ \(pid (\d+)\)/g)].map((m) => Number(m[1]));
}

function connectPage(s) {
  const ws = new WebSocket(`ws://127.0.0.1:${s.port}/api/s/${s.id}/events`, ['vivamark.v1', `vivamark.token.${s.token}`], {
    headers: { Origin: `http://127.0.0.1:${s.port}` },
  });
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

test('a daemon that misses a health check is found again, not replaced', { skip: !posix && 'needs SIGSTOP' }, async () => {
  world = makeWorld();
  const s = await openSession(world);
  const ws = await connectPage(s);
  const first = world.server();

  // The daemon stops answering for longer than one health check (2 s), then recovers.
  process.kill(first.pid, 'SIGSTOP');
  const waiting = startCli(['wait', world.page, '--json', '--timeout', '30s'], world.env);
  try {
    await sleep(3_500);
  } finally {
    process.kill(first.pid, 'SIGCONT');
  }

  // The reviewer sends from the page, which is connected to the first daemon.
  const sent = await sendNotes(s, [ELEMENT_NOTE]);
  assert.equal(sent.status, 201, sent.text);
  const r = await waiting.done;
  ws.close();

  assert.equal(r.code, 0, `wait got the notes; stdout: ${r.stdout}\nstderr: ${r.stderr}`);
  assert.equal(JSON.parse(r.stdout).notes[0].comment, ELEMENT_NOTE.comment);
  assert.equal(world.server().pid, first.pid, 'server.json still names the first daemon');
  assert.equal(world.server().port, first.port);
  assert.deepEqual(daemonPids(world), [first.pid], 'no second daemon was started');
});

test('a daemon that stays stuck is left alone and the CLI says so', { skip: !posix && 'needs SIGSTOP' }, async () => {
  world = makeWorld();
  await openSession(world);
  const first = world.server();

  process.kill(first.pid, 'SIGSTOP');
  let r;
  let stop;
  try {
    r = await world.cli(['status', '--json']);
    stop = await world.cli(['stop']);
  } finally {
    process.kill(first.pid, 'SIGCONT');
  }

  assert.equal(r.code, 1, r.stdout);
  assert.match(r.stderr, new RegExp(`pid ${first.pid}`));
  assert.match(r.stderr, /no second one was started/);
  assert.equal(stop.code, 1, stop.stdout);
  assert.match(stop.stderr, /running but did not answer, so it was not stopped/);
  assert.deepEqual(world.server(), first, 'server.json is untouched');
  assert.deepEqual(daemonPids(world), [first.pid], 'no second daemon was started');

  // Once it answers again, the CLI uses it.
  const again = await world.cli(['status', '--json']);
  assert.equal(again.code, 0, again.stderr);
});

test('a second daemon on the same state directory exits and leaves the first in charge', async () => {
  world = makeWorld();
  await openSession(world);
  const first = world.server();

  const child = spawn(process.execPath, [CLI, '__daemon'], { env: world.env, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d));
  const code = await new Promise((resolve) => child.on('close', resolve));

  assert.equal(code, 1, stderr);
  assert.match(stderr, new RegExp(`already serves .* \\(pid ${first.pid}, port ${first.port}\\)`));
  assert.deepEqual(world.server(), first, 'server.json still names the first daemon');
  const again = await world.cli(['status', '--json']);
  assert.equal(again.code, 0, again.stderr);
});

test('a daemon that died without cleaning up is replaced', async () => {
  world = makeWorld();
  await openSession(world);
  const first = world.server();
  process.kill(first.pid, 'SIGKILL');
  for (let i = 0; i < 50; i++) {
    try {
      process.kill(first.pid, 0);
      await sleep(50);
    } catch {
      break;
    }
  }
  assert.ok(fs.existsSync(path.join(world.stateDir, 'server.json')), 'the dead daemon left server.json behind');

  const r = await world.cli(['status', '--json']);
  assert.equal(r.code, 0, r.stderr);
  assert.notEqual(world.server().pid, first.pid, 'a new daemon took over');
});

test('commands started at the same moment share one daemon', async () => {
  world = makeWorld();
  const results = await Promise.all([1, 2, 3, 4].map(() => world.cli(['status', '--json'])));
  for (const r of results) assert.equal(r.code, 0, r.stderr);
  const owner = world.server().pid;
  await sleep(300); // Let any daemon that lost the race finish exiting.
  const alive = daemonPids(world).filter((pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  });
  assert.deepEqual(alive, [owner], 'only the daemon named in server.json is running');
});
