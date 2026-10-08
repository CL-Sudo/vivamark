// Test helpers: an isolated state directory per test, the built CLI run as a
// child process, and a small HTTP client for the review UI's API. Each world
// gets an explicit random port from 20000-32000, below the ephemeral range.
// Not port 0: in some agent sandboxes a socket on an OS-assigned port cannot
// be connected to. If the port is taken, the daemon retries other explicit
// ports in the same range, and tests read the real one from server.json.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CLI = path.join(ROOT, 'dist', 'cli.js');
export const FIXTURE = path.join(ROOT, 'test', 'fixtures', 'plan.html');
export const EGRESS_GUARD = path.join(ROOT, 'test', 'helpers', 'egress-guard.mjs');

/** A fresh state directory and a copy of the fixture page, both under the OS temp dir. */
export function makeWorld({ guardEgress = false } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'vivamark-test-'));
  const stateDir = path.join(base, 'state');
  const pageDir = path.join(base, 'pages');
  fs.mkdirSync(pageDir);
  const page = path.join(pageDir, 'plan.html');
  fs.copyFileSync(FIXTURE, page);
  const egressLog = path.join(base, 'egress.jsonl');
  const env = {
    ...process.env,
    // The user's own notify hook and config file stay out of tests.
    VIVAMARK_NOTIFY_CMD: '',
    XDG_CONFIG_HOME: path.join(base, 'config'),
    VIVAMARK_STATE_DIR: stateDir,
    VIVAMARK_PORT: String(randomTestPort()),
    VIVAMARK_NO_BROWSER: '1',
    VIVAMARK_IDLE_MS: '120000',
  };
  if (guardEgress) {
    env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ''} --import ${pathToImport(EGRESS_GUARD)}`.trim();
    env.VIVAMARK_EGRESS_LOG = egressLog;
  }
  return {
    base,
    stateDir,
    pageDir,
    page,
    env,
    egressLog,
    cli: (args, opts) => runCli(args, env, opts),
    server: () => JSON.parse(fs.readFileSync(path.join(stateDir, 'server.json'), 'utf8')),
    session: (id) => JSON.parse(fs.readFileSync(path.join(stateDir, 'sessions', `${id}.json`), 'utf8')),
    egress: () => (fs.existsSync(egressLog) ? fs.readFileSync(egressLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []),
    async cleanup() {
      // First any child a failed test left running: a leftover wait would start the daemon again after stop.
      killChildren();
      await runCli(['stop'], env).catch(() => undefined);
      fs.rmSync(base, { recursive: true, force: true });
    },
  };
}

function randomTestPort() {
  return 20000 + Math.floor(Math.random() * 12001);
}

function pathToImport(p) {
  return new URL(`file://${p}`).href;
}

/** Runs the built CLI. Resolves with { code, stdout, stderr }; never rejects on a non-zero exit. */
export function runCli(args, env, { input, timeoutMs = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`vivamark ${args.join(' ')} timed out\nstdout: ${stdout}\nstderr: ${stderr}`));
    }, timeoutMs);
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(input ?? '');
  });
}

/** Children started by startCli and not yet exited, so cleanup can kill any a failed test left behind. */
const liveChildren = new Set();

/** Kills every child startCli started that is still running. */
export function killChildren() {
  for (const child of liveChildren) child.kill('SIGKILL');
  liveChildren.clear();
}

/**
 * Starts a CLI command without waiting for it, for long polls that a test
 * completes later. Bounded: after `timeoutMs` the child is killed and `done`
 * resolves with `timedOut: true`, so a test that never completes the poll
 * fails instead of hanging the suite. `waitForStdout` waits for output a test
 * can observe; `stop` kills the child and waits for it, on any path.
 */
export function startCli(args, env, { timeoutMs = 60_000 } = {}) {
  const child = spawn(process.execPath, [CLI, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  liveChildren.add(child);
  let stdout = '';
  let stderr = '';
  let timedOut = false;
  const watchers = new Set();
  const check = () => {
    for (const w of watchers) w();
  };
  child.stdout.on('data', (d) => {
    stdout += d;
    check();
  });
  child.stderr.on('data', (d) => (stderr += d));
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGKILL');
  }, timeoutMs);
  timer.unref();
  const done = new Promise((resolve) =>
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      liveChildren.delete(child);
      check();
      resolve({ code, signal, stdout, stderr, timedOut });
    }),
  );
  /** Resolves with stdout once `pred(stdout)` holds; rejects if the child exits first or `ms` passes. */
  const waitForStdout = (pred, ms = 10_000) =>
    new Promise((resolve, reject) => {
      const finish = (err) => {
        clearTimeout(t);
        watchers.delete(w);
        if (err) reject(err);
        else resolve(stdout);
      };
      const w = () => {
        if (pred(stdout)) finish();
        else if (child.exitCode !== null || child.signalCode !== null) finish(new Error(`vivamark ${args.join(' ')} exited before the expected output\nstdout: ${stdout}\nstderr: ${stderr}`));
      };
      const t = setTimeout(() => finish(new Error(`no expected output from vivamark ${args.join(' ')} within ${ms} ms\nstdout: ${stdout}\nstderr: ${stderr}`)), ms);
      watchers.add(w);
      w();
    });
  const stop = async (signal = 'SIGKILL') => {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
    return done;
  };
  return { child, done, stderr: () => stderr, stdout: () => stdout, waitForStdout, stop };
}

/**
 * One request to the daemon. `origin: true` adds the review UI's own Origin,
 * as a browser would on a POST from the review page.
 */
export function api(port, method, urlPath, { token, body, headers = {}, origin = false, host } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const h = { Host: host ?? `127.0.0.1:${port}`, ...headers };
    if (token) h.Authorization = `Bearer ${token}`;
    if (origin) h.Origin = `http://127.0.0.1:${port}`;
    if (payload) {
      h['Content-Type'] = 'application/json';
      h['Content-Length'] = String(payload.length);
    }
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers: h }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json;
        try {
          json = JSON.parse(text);
        } catch {
          json = undefined;
        }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    req.end(payload);
  });
}

/** Opens a session on the world's page and returns what a test needs to drive it. */
export async function openSession(world, extraArgs = []) {
  const r = await world.cli(['open', world.page, '--no-browser', '--json', ...extraArgs]);
  if (r.code !== 0) throw new Error(`open failed (${r.code}): ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  const { port, admin_token } = world.server();
  const rec = world.session(out.session.id);
  return { out, port, adminToken: admin_token, id: out.session.id, token: rec.token, record: rec };
}

/**
 * Resolves once the session's agent shows as listening: a wait started with
 * startCli has its long poll on the server. Rejects if the wait exits first.
 */
export async function untilListening(s, waiting, ms = 10_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (waiting.child.exitCode !== null) throw new Error(`wait exited early (${waiting.child.exitCode}): ${waiting.stderr()}`);
    const view = await api(s.port, 'GET', `/api/s/${s.id}`, { token: s.token });
    if (view.json?.agent === 'listening') return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`wait never reached the server: ${waiting.stderr()}`);
}

/** Posts notes the way the review UI's Send button does. */
export function sendNotes(s, notes) {
  return api(s.port, 'POST', `/api/s/${s.id}/send`, { token: s.token, origin: true, body: { notes } });
}

export const ELEMENT_NOTE = {
  kind: 'element',
  comment: 'Split this step: the scaffold and the save handler are separate risks.',
  anchor: { stable_id: 'step-2', selector: '#step-2', tag: 'li', text: 'Applet scaffold, save handler and container page.' },
};

export const TEXT_NOTE = {
  kind: 'text',
  comment: 'Can an Attestor really enrol on their own?',
  anchor: { stable_id: 'summary', selector: '#summary', quote: 'Director or Attestor', prefix: 'A Setup screen where a ', suffix: ' enrols their own certif' },
};

/** A real PNG of one colour, made by hand: tests need images without an image library. */
export function makePng(width, height, [r, g, b] = [14, 165, 233]) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) row.set([r, g, b], 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Uploads a file, an image or not, the way the review page does: raw bytes, its name, the session token and the page's Origin. */
export function uploadImage(s, bytes, { origin = true, token = s.token, name } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { Host: `127.0.0.1:${s.port}`, 'Content-Type': 'application/octet-stream', 'Content-Length': String(bytes.length) };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (origin === true) headers.Origin = `http://127.0.0.1:${s.port}`;
    else if (origin) headers.Origin = origin;
    const req = http.request({ host: '127.0.0.1', port: s.port, method: 'POST', path: `/api/s/${s.id}/attachments${name === undefined ? '' : `?name=${encodeURIComponent(name)}`}`, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json;
        try {
          json = JSON.parse(text);
        } catch {
          json = undefined;
        }
        resolve({ status: res.statusCode, text, json });
      });
    });
    req.on('error', reject);
    req.end(bytes);
  });
}
