// The server listens on loopback only. Every non-loopback address this
// machine has is tried, and none of them may reach the server.

import assert from 'node:assert/strict';
import net from 'node:net';
import os from 'node:os';
import { after, before, test } from 'node:test';
import { api, makeWorld, openSession } from './helpers/harness.mjs';

let world;
let s;

before(async () => {
  world = makeWorld();
  s = await openSession(world);
});

after(async () => {
  await world.cleanup();
});

function tryConnect(host, port, scopeId) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: scopeId ? `${host}%${scopeId}` : host, port, timeout: 1500 });
    socket.once('connect', () => {
      socket.destroy();
      resolve('connected');
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve('timeout');
    });
    socket.once('error', (err) => resolve(err.code ?? 'error'));
  });
}

test('the server answers on loopback', async () => {
  const v4 = await api(s.port, 'GET', '/health');
  assert.equal(v4.status, 200);
  assert.equal(v4.json.app, 'vivamark');
  // ::1 as well, when this machine has IPv6 loopback.
  const v6 = await tryConnect('::1', s.port);
  assert.ok(v6 === 'connected' || v6 === 'EADDRNOTAVAIL' || v6 === 'EAFNOSUPPORT' || v6 === 'ECONNREFUSED', v6);
});

test('the server is not reachable on any non-loopback address of this machine', async (t) => {
  const addrs = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.internal) continue;
      addrs.push({ name, address: a.address, family: a.family, scopeId: a.family === 'IPv6' && a.address.startsWith('fe80') ? name : undefined });
    }
  }
  if (!addrs.length) {
    t.skip('this machine has no non-loopback address to try');
    return;
  }
  const reached = [];
  for (const a of addrs) {
    const result = await tryConnect(a.address, s.port, a.scopeId);
    if (result === 'connected') reached.push(`${a.name} ${a.address}`);
  }
  assert.deepEqual(reached, [], `reachable on: ${reached.join(', ')}`);
  t.diagnostic(`tried ${addrs.length} addresses: ${addrs.map((a) => a.address).join(', ')}`);
});

test('there is no option that widens the bind address', async () => {
  const help = await world.cli(['--help']);
  assert.doesNotMatch(help.stdout, /--listen|--host|0\.0\.0\.0/);
  const r = await world.cli(['open', world.page, '--no-browser', '--listen', '0.0.0.0']);
  assert.equal(r.code, 2, 'unknown option');
});
