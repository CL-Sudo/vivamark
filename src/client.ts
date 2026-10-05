// The CLI's side of the loopback API: find or start the daemon, prove it is
// ours, and make requests to it.

import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tokenProof } from './guard.js';
import { ensureDir, readServerInfo, stateDir } from './store.js';
import type { ServerInfo } from './store.js';
import { VERSION } from './version.js';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface RequestOptions {
  token?: string;
  body?: unknown;
  timeoutMs?: number;
}

export function request<T = unknown>(port: number, method: string, urlPath: string, opts: RequestOptions = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const payload = opts.body === undefined ? undefined : Buffer.from(JSON.stringify(opts.body));
    const headers: Record<string, string> = { Host: `127.0.0.1:${port}`, Accept: 'application/json' };
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = String(payload.length);
    }
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed: unknown = undefined;
        try {
          parsed = text ? JSON.parse(text) : undefined;
        } catch {
          parsed = undefined;
        }
        const status = res.statusCode ?? 0;
        if (status >= 400) {
          const msg = (parsed as { error?: string } | undefined)?.error ?? `HTTP ${status}`;
          reject(new ApiError(status, msg));
        } else {
          resolve(parsed as T);
        }
      });
      res.on('error', reject);
    });
    if (opts.timeoutMs) {
      req.setTimeout(opts.timeoutMs, () => req.destroy(new Error('request timed out')));
    }
    req.on('error', reject);
    req.end(payload);
  });
}

interface Health {
  app: string;
  version: string;
  pid: number;
  proof?: string;
}

/** Returns the daemon's health if, and only if, it proves it holds the admin token in server.json. */
async function verify(info: ServerInfo): Promise<Health | null> {
  const challenge = randomBytes(16).toString('hex');
  try {
    const h = await request<Health>(info.port, 'GET', `/health?challenge=${challenge}`, { timeoutMs: 2_000 });
    if (h?.app !== 'vivamark' || h.proof !== tokenProof(info.admin_token, challenge)) return null;
    return h;
  } catch {
    return null;
  }
}

/** The running daemon for this state directory, verified, or null. */
export async function runningDaemon(dir = stateDir()): Promise<ServerInfo | null> {
  const info = readServerInfo(dir);
  if (!info) return null;
  return (await verify(info)) ? info : null;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Whether the daemon that server.json names may still be running: its
 * process exists and its port still accepts connections. A daemon too busy
 * to answer passes (the kernel accepts for it); one that crashed, or a pid
 * reused by another program, does not.
 */
export function mayBeRunning(info: ServerInfo): Promise<boolean> {
  if (info.pid === process.pid || !pidAlive(info.pid)) return Promise.resolve(false);
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port: info.port });
    const done = (alive: boolean) => {
      socket.destroy();
      resolve(alive);
    };
    socket.setTimeout(1_000, () => done(true));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

/** How long a daemon that is alive but not answering gets before the CLI gives up on it. */
const UNANSWERED_MS = 10_000;

export function stuckMessage(info: ServerInfo, dir: string): string {
  return (
    `the vivamark daemon for ${dir} (pid ${info.pid}, port ${info.port}) is running but did not answer, ` +
    `so no second one was started: open review pages are connected to it. ` +
    `If it stays stuck, stop it (kill ${info.pid}) and run the command again.`
  );
}

function cliPath(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), 'cli.js');
}

async function waitFor<T>(fn: () => Promise<T | null>, ms: number): Promise<T | null> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

export async function stopDaemon(info: ServerInfo): Promise<void> {
  await request(info.port, 'POST', '/api/shutdown', { token: info.admin_token, timeoutMs: 5_000 }).catch(() => undefined);
  await waitFor(async () => ((await verify(info)) ? null : true), 5_000);
}

/**
 * Finds the daemon, restarting one from another vivamark version, or starts a
 * new one. Never starts a second daemon beside one that is alive but slow to
 * answer: review pages stay connected to the first, so a second would answer
 * from a log that never sees their notes. The daemon itself refuses to start
 * while another one holds server.json (Daemon.claimServerInfo).
 */
export async function ensureDaemon(dir = stateDir()): Promise<ServerInfo> {
  const info = readServerInfo(dir);
  if (info) {
    let health = await verify(info);
    if (!health && (await mayBeRunning(info))) {
      health = await waitFor(() => verify(info), UNANSWERED_MS);
      if (!health) throw new Error(stuckMessage(info, dir));
    }
    if (health && health.version === VERSION) return info;
    if (health) await stopDaemon(info);
    // Otherwise it is gone; the new daemon replaces its server.json.
  }
  ensureDir(dir);
  const log = fs.openSync(path.join(dir, 'daemon.log'), 'a', 0o600);
  const child = spawn(process.execPath, [cliPath(), '__daemon'], {
    detached: true,
    stdio: ['ignore', log, log],
    env: { ...process.env, VIVAMARK_STATE_DIR: dir },
  });
  child.unref();
  fs.closeSync(log);
  // Ours, or one another command started at the same moment: ours then exits.
  const started = await waitFor(async () => {
    const next = readServerInfo(dir);
    return next && next.version === VERSION && (await verify(next)) ? next : null;
  }, 10_000);
  if (!started) throw new Error(`the vivamark daemon did not start; see ${path.join(dir, 'daemon.log')}`);
  return started;
}
