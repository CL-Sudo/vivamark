// Which browser `vivamark open` starts: BROWSER when it is set, else the
// platform default. The rules run against a stubbed spawn, and `open` itself
// against small recording scripts standing in for browsers, so no real
// browser ever opens.

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { browserCommands, openBrowser, splitBrowserList } from '../dist/internal.js';
import { makeWorld, runCli } from './helpers/harness.mjs';

const URL = 'http://127.0.0.1:47000/s/s_abc#t=0123abcd';
const CHROME = '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe';
const LINUX = { platform: 'linux', wsl: false, has: () => false };
const WSL = (wslview) => ({ platform: 'linux', wsl: true, has: (c) => wslview && c === 'wslview' });

/** A spawn stand-in: records each call; a command in `missing` fails to start, as spawn does, with an async error. */
function stubSpawn(missing = []) {
  const calls = [];
  const spawner = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    const child = new EventEmitter();
    child.unref = () => undefined;
    if (missing.includes(cmd)) process.nextTick(() => child.emit('error', Object.assign(new Error(`spawn ${cmd} ENOENT`), { code: 'ENOENT' })));
    return child;
  };
  return { spawner, calls };
}

const settle = () => new Promise((r) => setImmediate(r));

test('with BROWSER unset, the platform default is chosen as before', () => {
  const only = (env, p) => browserCommands(URL, env, p).commands.map(({ cmd, args }) => [cmd, ...args]);
  assert.deepEqual(only({}, LINUX), [['xdg-open', URL]]);
  assert.deepEqual(only({ BROWSER: '' }, LINUX), [['xdg-open', URL]]);
  assert.deepEqual(only({ BROWSER: ' : ' }, LINUX), [['xdg-open', URL]]);
  assert.deepEqual(only({}, WSL(true)), [['wslview', URL]]);
  assert.deepEqual(only({}, WSL(false)), [['powershell.exe', '-NoProfile', '-Command', `Start-Process '${URL}'`]]);
  assert.deepEqual(only({}, { platform: 'darwin', wsl: false, has: () => false }), [['open', URL]]);
  assert.deepEqual(only({}, { platform: 'win32', wsl: false, has: () => false }), [['explorer.exe', URL]]);
});

test('a single path with spaces is one program, given the URL, with no quoting', () => {
  const { commands, skipped } = browserCommands(URL, { BROWSER: CHROME }, WSL(true));
  assert.deepEqual(skipped, []);
  assert.deepEqual(commands[0], { cmd: CHROME, args: [URL], from: 'BROWSER' });
  assert.equal(commands[1].cmd, 'wslview', 'the platform default stays last, as the fallback');
});

test('a %s template is split into words, with quotes keeping spaces and %s as the URL', () => {
  const c = (BROWSER) => browserCommands(URL, { BROWSER }, LINUX).commands[0];
  assert.deepEqual(c(`"${CHROME}" --new-window %s`), { cmd: CHROME, args: ['--new-window', URL], from: 'BROWSER' });
  assert.deepEqual(c("firefox  -new-tab   '%s'"), { cmd: 'firefox', args: ['-new-tab', URL], from: 'BROWSER' });
  assert.deepEqual(c('mybrowser --open=%s --note=100%%'), { cmd: 'mybrowser', args: [`--open=${URL}`, '--note=100%'], from: 'BROWSER' });
  // A template that cannot be read is skipped, with why, and the rest still run.
  const bad = browserCommands(URL, { BROWSER: '"unclosed %s:%s:firefox' }, LINUX);
  assert.equal(bad.skipped.length, 2);
  assert.match(bad.skipped[0], /unclosed quote/);
  assert.match(bad.skipped[1], /no program before %s/);
  assert.deepEqual(bad.commands.map((x) => x.cmd), ['firefox', 'xdg-open']);
});

test('entries are split on colons, but not on the colon of a drive letter', () => {
  assert.deepEqual(splitBrowserList(`${CHROME}:firefox:wslview`, 'linux'), [CHROME, 'firefox', 'wslview']);
  assert.deepEqual(splitBrowserList('C:\\Program Files\\Chrome\\chrome.exe:firefox', 'linux'), ['C:\\Program Files\\Chrome\\chrome.exe', 'firefox']);
  assert.deepEqual(splitBrowserList('firefox:C:/Apps/b.exe', 'linux'), ['firefox', 'C:/Apps/b.exe']);
  assert.deepEqual(splitBrowserList('C:\\Apps\\a.exe;D:\\b.exe', 'win32'), ['C:\\Apps\\a.exe', 'D:\\b.exe']);
});

test('a BROWSER command that fails to start gives way to the next, then to the default', async () => {
  const { spawner, calls } = stubSpawn(['/no/such/browser', 'also-missing']);
  const warnings = [];
  openBrowser(URL, { env: { BROWSER: '/no/such/browser:also-missing' }, platform: LINUX, spawner, warn: (m) => warnings.push(m) });
  for (let i = 0; i < 5; i++) await settle();
  assert.deepEqual(calls.map((c) => c.cmd), ['/no/such/browser', 'also-missing', 'xdg-open']);
  for (const c of calls) {
    assert.deepEqual(c.args, [URL]);
    assert.equal(c.opts.shell, undefined, 'never through a shell');
  }
  assert.equal(warnings.length, 2);
  assert.match(warnings[1], /could not start also-missing from BROWSER; trying xdg-open/);
});

test('a BROWSER command that starts is the only one run', async () => {
  const { spawner, calls } = stubSpawn([]);
  openBrowser(URL, { env: { BROWSER: `${CHROME}:firefox` }, platform: WSL(true), spawner, warn: () => undefined });
  for (let i = 0; i < 5; i++) await settle();
  assert.deepEqual(calls.map((c) => c.cmd), [CHROME]);
});

// ---- vivamark open itself, with recording scripts as browsers ----------------------

let world;
let bin;
let fakeChrome;

/** A shell script that writes its arguments, one per line, to `record`. */
function recorder(file, record) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `#!/bin/sh\nprintf '%s\\n' "$@" > '${record}.tmp' && mv '${record}.tmp' '${record}'\n`, { mode: 0o755 });
}

before(() => {
  world = makeWorld();
  // A path with spaces, like /mnt/c/Program Files/... on WSL.
  fakeChrome = path.join(world.base, 'Program Files', 'Fake Chrome', 'chrome');
  recorder(fakeChrome, path.join(world.base, 'chrome.args'));
  // Stand-ins for every platform default, first on PATH, so a fallback opens nothing real.
  bin = path.join(world.base, 'bin');
  for (const name of ['xdg-open', 'wslview', 'open']) recorder(path.join(bin, name), path.join(world.base, 'default.args'));
});

after(async () => {
  await world.cleanup();
});

function openEnv(BROWSER) {
  const env = { ...world.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, BROWSER };
  delete env.VIVAMARK_NO_BROWSER;
  return env;
}

async function recorded(name, ms = 5_000) {
  const file = path.join(world.base, name);
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

function clearRecords() {
  for (const n of ['chrome.args', 'default.args']) fs.rmSync(path.join(world.base, n), { force: true });
}

test('open starts the BROWSER program at a path with spaces, with the printed URL', async () => {
  clearRecords();
  const res = await runOpen(['--json'], fakeChrome);
  assert.equal(res.code, 0, res.stderr);
  const { url } = JSON.parse(res.stdout);
  assert.deepEqual(await recorded('chrome.args'), [url]);
  assert.equal(await recorded('default.args', 300), null, 'the platform default is not started');
});

test('open runs a %s template with the URL in place', async () => {
  clearRecords();
  const res = await runOpen(['--json'], `'${fakeChrome}' --new-window --app=%s`);
  assert.equal(res.code, 0, res.stderr);
  const { url } = JSON.parse(res.stdout);
  assert.deepEqual(await recorded('chrome.args'), ['--new-window', `--app=${url}`]);
});

test('open falls back to the platform default when the BROWSER command is missing, and still prints the URL', async () => {
  clearRecords();
  const res = await runOpen([], path.join(world.base, 'no such browser'));
  assert.equal(res.code, 0, res.stderr);
  const url = /^URL: (\S+)$/m.exec(res.stdout)?.[1];
  assert.ok(url, res.stdout);
  assert.match(res.stderr, /could not start .*no such browser from BROWSER; trying /);
  assert.deepEqual(await recorded('default.args'), [url]);
});

test('--no-browser opens nothing, whatever BROWSER says', async () => {
  clearRecords();
  const res = await runOpen(['--no-browser'], fakeChrome);
  assert.equal(res.code, 0, res.stderr);
  assert.match(res.stdout, /^URL: /m);
  assert.equal(await recorded('chrome.args', 1_000), null);
  assert.equal(await recorded('default.args', 0), null);
});

function runOpen(extra, BROWSER) {
  return runCli(['open', world.page, ...extra], openEnv(BROWSER));
}
