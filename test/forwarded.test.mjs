// The review page reached through a port forwarder that changes the port, as
// VS Code's WSL forwarding or `ssh -L` does: the browser's Host and Origin
// name the forwarder's port, not the daemon's.

import assert from 'node:assert/strict';
import net from 'node:net';
import { after, before, test } from 'node:test';
import WebSocket from 'ws';
import { ELEMENT_NOTE, api, makeWorld, openSession, sendNotes, startCli } from './helpers/harness.mjs';

let world;
let s;
let forwarder;
let fwdPort;

/** A TCP forwarder on 127.0.0.1:<explicit random port> that pipes every connection to `target`. */
async function startForwarder(target) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const port = 20000 + Math.floor(Math.random() * 12001);
    if (port === target) continue;
    const server = net.createServer((client) => {
      const upstream = net.connect({ host: '127.0.0.1', port: target });
      client.pipe(upstream).pipe(client);
      client.on('error', () => upstream.destroy());
      upstream.on('error', () => client.destroy());
    });
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', resolve);
      });
      return { server, port };
    } catch {
      server.close();
    }
  }
  throw new Error('no free port for the forwarder');
}

before(async () => {
  world = makeWorld();
  s = await openSession(world);
  ({ server: forwarder, port: fwdPort } = await startForwarder(s.port));
});

after(async () => {
  forwarder?.close();
  await world.cleanup();
});

test('open prints the daemon address, not a forwarded one', () => {
  assert.match(s.out.url, new RegExp(`^http://127\\.0\\.0\\.1:${s.port}/s/${s.id}#t=[0-9a-f]{64}$`));
});

test('a note sent through a forwarded port reaches wait', async () => {
  const fwd = { ...s, port: fwdPort };

  const chrome = await api(fwdPort, 'GET', `/s/${s.id}`);
  assert.equal(chrome.status, 200, 'the review page loads through the forwarder');
  const view = await api(fwdPort, 'GET', `/api/s/${s.id}`, { token: s.token });
  assert.equal(view.status, 200, view.text);
  assert.equal((await api(fwdPort, 'GET', `/api/s/${s.id}`)).status, 401, 'the token is still required');

  const events = await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${fwdPort}/api/s/${s.id}/events`, ['vivamark.v1', `vivamark.token.${s.token}`], {
      headers: { Origin: `http://127.0.0.1:${fwdPort}` },
    });
    ws.once('message', (data) => resolve({ ws, hello: JSON.parse(String(data)) }));
    ws.on('unexpected-response', (_req, res) => reject(new Error(`WebSocket refused: ${res.statusCode}`)));
    ws.on('error', reject);
  });
  assert.equal(events.hello.type, 'hello', 'live updates connect through the forwarder');
  events.ws.close();

  const waiting = startCli(['wait', world.page, '--json'], world.env);
  for (let i = 0; i < 50 && !waiting.stderr().includes('Waiting'); i++) await new Promise((r) => setTimeout(r, 100));

  const sent = await sendNotes(fwd, [ELEMENT_NOTE]);
  assert.equal(sent.status, 201, sent.text);

  const r = await waiting.done;
  assert.equal(r.code, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.notes.length, 1);
  assert.equal(out.notes[0].comment, ELEMENT_NOTE.comment);
});
