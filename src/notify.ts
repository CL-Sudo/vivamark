// The notify hook: a command the user configures, which the daemon runs once
// per event with that event's JSON on stdin (the same line as in
// events.jsonl, so no note text). Fire-and-forget: it never blocks the
// daemon, is never retried, and is killed at a timeout. A failing or slow
// command is logged in daemon.log and otherwise ignored.
//
// Only the user's own environment or config file sets it: VIVAMARK_NOTIFY_CMD
// in the environment of the CLI that starts the daemon, or "notify_cmd" in
// $XDG_CONFIG_HOME/vivamark/config.json (~/.config/vivamark/config.json).
// Both are read when the daemon starts. Nothing on a reviewed page or in a
// request can set it.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { VivamarkEvent } from './events.js';

export const NOTIFY_TIMEOUT_MS = 5_000;
/** Commands still running beyond this many are not started; the event is logged as skipped. */
const MAX_RUNNING = 8;

export interface NotifyConfig {
  cmd: string;
  timeoutMs: number;
  /** Where the command came from, for the daemon log. */
  from: string;
}

export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  const xdg = env.XDG_CONFIG_HOME;
  const base = xdg && path.isAbsolute(xdg) ? xdg : path.join(os.homedir(), '.config');
  return path.join(base, 'vivamark', 'config.json');
}

/** The notify command, or null when none is configured. The environment wins over the config file. */
export function notifyConfig(env: NodeJS.ProcessEnv = process.env): NotifyConfig | null {
  let file: { notify_cmd?: unknown; notify_timeout_ms?: unknown } = {};
  const cfgPath = configPath(env);
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    if (parsed && typeof parsed === 'object') file = parsed as typeof file;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') console.error(`vivamark: ignoring ${cfgPath}: ${(err as Error).message}`);
  }
  const fromEnv = env.VIVAMARK_NOTIFY_CMD?.trim();
  const fromFile = typeof file.notify_cmd === 'string' ? file.notify_cmd.trim() : '';
  const cmd = fromEnv || fromFile;
  if (!cmd) return null;
  const rawTimeout = Number(env.VIVAMARK_NOTIFY_TIMEOUT_MS) || Number(file.notify_timeout_ms) || NOTIFY_TIMEOUT_MS;
  const timeoutMs = Math.min(60_000, Math.max(100, rawTimeout));
  return { cmd, timeoutMs, from: fromEnv ? 'VIVAMARK_NOTIFY_CMD' : cfgPath };
}

export class Notifier {
  private running = 0;

  constructor(readonly config: NotifyConfig) {}

  /** Starts the command for one event and returns at once. */
  run(event: VivamarkEvent): void {
    const what = `notify command for event ${event.seq} (${event.type})`;
    if (this.running >= MAX_RUNNING) {
      console.error(`vivamark: skipped the ${what}: ${MAX_RUNNING} are still running`);
      return;
    }
    let child: ReturnType<typeof spawn>;
    try {
      // Its own process group, so a timeout kills whatever the shell started too.
      child = spawn(this.config.cmd, { shell: true, stdio: ['pipe', 'ignore', 'pipe'], detached: process.platform !== 'win32', windowsHide: true });
    } catch (err) {
      console.error(`vivamark: could not start the ${what}: ${(err as Error).message}`);
      return;
    }
    this.running += 1;
    let stderr = '';
    let timedOut = false;
    child.stderr?.on('data', (d: Buffer) => {
      if (stderr.length < 2_000) stderr += d.toString('utf8');
    });
    // A command that does not read its stdin closes the pipe early: not an error.
    child.stdin?.on('error', () => undefined);
    child.stdin?.end(JSON.stringify(event) + '\n');
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (child.pid !== undefined && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }, this.config.timeoutMs);
    timer.unref();
    let finished = false;
    const finish = (message: string | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      this.running -= 1;
      if (message) console.error(`vivamark: ${message}`);
    };
    child.on('error', (err) => finish(`the ${what} failed to start: ${err.message}`));
    // 'exit', not 'close': a grandchild that keeps stderr open must not hold the count.
    child.on('exit', (code, signal) => {
      if (timedOut) finish(`killed the ${what} after ${this.config.timeoutMs} ms`);
      else if (code !== 0) finish(`the ${what} exited with ${code ?? signal}${stderr.trim() ? `: ${stderr.trim().slice(0, 500)}` : ''}`);
      else finish(null);
    });
    child.unref();
  }
}
