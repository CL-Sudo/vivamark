// Opening the reviewer's browser: the browser named in BROWSER when it is
// set, else the platform's default opener. Every command runs as a local
// process from an argument array, never through a shell, so nothing in the
// URL or in BROWSER is ever interpreted by one.
//
// The rules for BROWSER (also in the README and `vivamark --help`):
//   - It is a list of commands, tried in order, separated by ':' (';' on
//     Windows, like Python's webbrowser). A ':' right after a lone drive
//     letter at the start of an entry (C:\ or C:/) is part of the path.
//   - An entry without %s is one program: the whole entry, spaces and all,
//     is its path or name, and the URL is its only argument. So
//     /mnt/c/Program Files/Google/Chrome/Application/chrome.exe needs no quoting.
//   - An entry with %s is a command line: split on whitespace, with '...' or
//     "..." keeping spaces in one word; %s in any word becomes the URL and
//     %% a literal %. The URL is not appended.
//   - An entry that fails to start (not found, not executable) gives way to
//     the next, and after the last to the platform default. A program that
//     starts and then fails is not detected.

import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import fs from 'node:fs';

export interface BrowserCommand {
  cmd: string;
  args: string[];
  from: 'BROWSER' | 'default';
}

export interface BrowserPlan {
  commands: BrowserCommand[];
  /** BROWSER entries that could not be read, each with why. */
  skipped: string[];
}

export interface Platform {
  platform: NodeJS.Platform;
  wsl: boolean;
  /** Whether a program of this name is on PATH. */
  has: (cmd: string) => boolean;
}

function isWsl(): boolean {
  try {
    return /microsoft/i.test(fs.readFileSync('/proc/version', 'utf8'));
  } catch {
    return false;
  }
}

function has(cmd: string): boolean {
  return spawnSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' }).status === 0;
}

function hostPlatform(): Platform {
  return { platform: process.platform, wsl: process.platform === 'linux' && isWsl(), has };
}

/** Today's opener for this platform, used when BROWSER is unset and after every BROWSER entry fails. */
export function defaultBrowser(url: string, p: Platform): BrowserCommand {
  if (p.platform === 'darwin') return { cmd: 'open', args: [url], from: 'default' };
  if (p.platform === 'win32') return { cmd: 'explorer.exe', args: [url], from: 'default' };
  if (p.wsl) {
    if (p.has('wslview')) return { cmd: 'wslview', args: [url], from: 'default' };
    return { cmd: 'powershell.exe', args: ['-NoProfile', '-Command', `Start-Process '${url}'`], from: 'default' };
  }
  return { cmd: 'xdg-open', args: [url], from: 'default' };
}

/** Splits BROWSER into its entries, keeping the colon of a drive letter (C:\, C:/) inside its entry. */
export function splitBrowserList(value: string, platform: NodeJS.Platform): string[] {
  if (platform === 'win32') return value.split(';').map((e) => e.trim()).filter(Boolean);
  const entries: string[] = [];
  let current = '';
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === ':' && !(/^\s*[A-Za-z]$/.test(current) && /[\\/]/.test(value[i + 1] ?? ''))) {
      entries.push(current);
      current = '';
    } else current += c;
  }
  entries.push(current);
  return entries.map((e) => e.trim()).filter(Boolean);
}

/** Splits a command line into words: whitespace separates, '...' and "..." group. Null on an unclosed quote. */
function words(line: string): string[] | null {
  const out: string[] = [];
  let word = '';
  let inWord = false;
  let q: string | null = null;
  for (const c of line) {
    if (q) {
      if (c === q) q = null;
      else word += c;
    } else if (c === '"' || c === "'") {
      q = c;
      inWord = true;
    } else if (/\s/.test(c)) {
      if (inWord) out.push(word);
      word = '';
      inWord = false;
    } else {
      word += c;
      inWord = true;
    }
  }
  if (q) return null;
  if (inWord) out.push(word);
  return out;
}

/** One BROWSER entry as a command for this URL, or why it cannot be one. */
export function browserEntry(entry: string, url: string): BrowserCommand | string {
  if (!entry.includes('%s')) return { cmd: entry, args: [url], from: 'BROWSER' };
  const w = words(entry);
  if (!w) return `unclosed quote in ${entry}`;
  if (!w.length || w[0].includes('%s')) return `no program before %s in ${entry}`;
  const fill = (s: string) => s.replace(/%%|%s/g, (m) => (m === '%%' ? '%' : url));
  return { cmd: w[0], args: w.slice(1).map(fill), from: 'BROWSER' };
}

/** The commands to try, in order: BROWSER's entries, then the platform default. */
export function browserCommands(url: string, env: NodeJS.ProcessEnv = process.env, p: Platform = hostPlatform()): BrowserPlan {
  const commands: BrowserCommand[] = [];
  const skipped: string[] = [];
  for (const entry of splitBrowserList(env.BROWSER ?? '', p.platform)) {
    const c = browserEntry(entry, url);
    if (typeof c === 'string') skipped.push(c);
    else commands.push(c);
  }
  commands.push(defaultBrowser(url, p));
  return { commands, skipped };
}

type Spawner = (cmd: string, args: string[], opts: SpawnOptions) => ChildProcess;

/**
 * Opens the URL in the person's browser. A local process only; the caller
 * always prints the URL as well. Each command that fails to start gives way
 * to the next. `spawner` and `p` are for tests.
 */
export function openBrowser(
  url: string,
  { env = process.env, platform, spawner = spawn, warn = (m: string) => void process.stderr.write(m) }: { env?: NodeJS.ProcessEnv; platform?: Platform; spawner?: Spawner; warn?: (m: string) => void } = {},
): void {
  const { commands, skipped } = browserCommands(url, env, platform ?? hostPlatform());
  for (const s of skipped) warn(`vivamark: ignoring a BROWSER entry: ${s}.\n`);
  const attempt = (i: number) => {
    const c = commands[i];
    const next = commands[i + 1];
    let failed = false;
    const fail = () => {
      if (failed) return;
      failed = true;
      if (next) {
        warn(`vivamark: could not start ${c.cmd} from BROWSER; trying ${next.cmd}.\n`);
        attempt(i + 1);
      } else warn(`vivamark: could not start ${c.cmd}; open the URL yourself.\n`);
    };
    try {
      const child = spawner(c.cmd, c.args, { detached: true, stdio: 'ignore' });
      child.on('error', fail);
      child.unref();
    } catch {
      fail();
    }
  };
  attempt(0);
}
