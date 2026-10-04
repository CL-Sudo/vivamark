// No outbound network. Every vivamark process in the loop runs with a guard
// that records and refuses any connection to a non-loopback address, any DNS
// lookup of a host name, and any UDP send. The loop must leave no record.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { after, before, test } from 'node:test';
import { EGRESS_GUARD, ELEMENT_NOTE, TEXT_NOTE, api, makeWorld, openSession, sendNotes, startCli, untilListening } from './helpers/harness.mjs';

let world;

before(() => {
  world = makeWorld({ guardEgress: true });
});

after(async () => {
  await world.cleanup();
});

test('the guard itself catches an outbound connection (so a clean run means something)', () => {
  const log = `${world.base}/guard-check.jsonl`;
  const script = `
    const net = require('node:net');
    try { net.connect({ host: '192.0.2.1', port: 80 }); } catch (e) { console.log(e.message); }
    try { require('node:dns').lookup('example.com', () => {}); } catch (e) { console.log(e.message); }
  `;
  const r = spawnSync(process.execPath, ['--import', `file://${EGRESS_GUARD}`, '-e', script], {
    env: { ...process.env, VIVAMARK_EGRESS_LOG: log },
    encoding: 'utf8',
  });
  assert.match(r.stdout, /egress blocked/);
  const records = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(records.map((x) => x.kind), ['tcp', 'dns.lookup']);
});

test('the whole loop makes no outbound connection', async () => {
  const s = await openSession(world);
  const daemonPid = world.server().pid;

  const waiting = startCli(['wait', world.page, '--json'], world.env);
  await untilListening(s, waiting);
  assert.equal((await sendNotes(s, [ELEMENT_NOTE, TEXT_NOTE])).status, 201);
  const w = await waiting.done;
  assert.equal(w.code, 0, w.stderr);

  const reply = await world.cli(['reply', world.page, '-m', 'Thanks, fixed.']);
  assert.equal(reply.code, 0, reply.stderr);
  const view = await api(s.port, 'GET', `/api/s/${s.id}`, { token: s.token });
  assert.equal((await api(s.port, 'GET', view.json.artifact_url)).status, 200);
  assert.equal((await api(s.port, 'GET', `/s/${s.id}`)).status, 200);
  assert.equal((await world.cli(['wait', world.page, '--after', '2', '--timeout', '1s'])).code, 5);

  // The guard was really loaded into the daemon, not just into the CLI.
  if (process.platform === 'linux') {
    const env = fs.readFileSync(`/proc/${daemonPid}/environ`, 'utf8').split('\0');
    assert.ok(env.some((e) => e.startsWith('NODE_OPTIONS=') && e.includes('egress-guard')), 'daemon runs under the guard');
  }

  assert.equal((await world.cli(['stop'])).code, 0);
  assert.deepEqual(world.egress(), [], 'outbound attempts were recorded');
});
