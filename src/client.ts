// The CLI's side of the loopback API: find or start the daemon, prove it is
// ours, and make requests to it.

import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tokenProof } from './guard.js';
import { ensureDir, readServerInfo, serverInfoPath, stateDir } from './store.js';
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

/** Finds the daemon, restarting one from another vivamark version, or starts a new one. */
export async function ensureDaemon(dir = stateDir()): Promise<ServerInfo> {
  const info = readServerInfo(dir);
  if (info) {
    const health = await verify(info);
    if (health && health.version === VERSION) return info;
    if (health) await stopDaemon(info);
    else fs.rmSync(serverInfoPath(dir), { force: true });
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
  const started = await waitFor(async () => {
    const next = readServerInfo(dir);
    return next && next.pid === child.pid && (await verify(next)) ? next : null;
  }, 10_000);
  if (!started) throw new Error(`the vivamark daemon did not start; see ${path.join(dir, 'daemon.log')}`);
  return started;
}
