// `vivamark render`: draws a saved page in a headless Chrome or Chromium that
// is already on this machine, and reports what only a real render shows: a
// shape painted black, text cut off by the figure or out of its box, a page
// that scrolls sideways. Writes PNGs of the page and of each figure for the
// author to look at. Never downloads a browser, never writes the page, and
// keeps the browser off the network twice over: launch flags that make every
// host lookup and proxy fail, and the DevTools Fetch domain refusing every
// request that is not for a local file. Page script is switched off.

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Readable, Writable } from 'node:stream';
import type { Problem } from './lint.js';

export const RENDER_SCHEMA = 'vivamark.render/1';

/**
 * The one name that bypasses the dead proxy, so the resolver rule is the
 * only thing between it and a connection: with the rule it cannot resolve;
 * without it, a .localhost name still means this machine (RFC 6761). A test
 * reads its error to prove the rule holds without ever running unguarded.
 */
export const RESOLVER_CHECK_HOST = 'vivamark-resolver-check.localhost';

/** Tried in order on PATH when VIVAMARK_CHROME is not set. */
export const CHROME_NAMES = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];

const MAC_CHROME = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'];

// Chrome cannot draw one image taller than this.
const MAX_SHOT_PX = 16_384;

export class RenderError extends Error {}

function executable(file: string): boolean {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function onPath(name: string, env: NodeJS.ProcessEnv): string | null {
  for (const dir of (env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of process.platform === 'win32' ? ['.exe', ''] : ['']) {
      const file = path.join(dir, name + ext);
      if (executable(file)) return file;
    }
  }
  return null;
}

export function isWsl(env: NodeJS.ProcessEnv = process.env): boolean {
  if (process.platform !== 'linux') return false;
  if (env.WSL_DISTRO_NAME) return true;
  try {
    return /microsoft/i.test(fs.readFileSync('/proc/version', 'utf8'));
  } catch {
    return false;
  }
}

/**
 * The browser render drives: VIVAMARK_CHROME when set (a path, or a name on
 * PATH), else the first of CHROME_NAMES on PATH, else null. Throws when
 * VIVAMARK_CHROME names something that cannot run here.
 */
export function findChrome(env: NodeJS.ProcessEnv = process.env, wsl = isWsl(env)): string | null {
  const named = env.VIVAMARK_CHROME?.trim();
  if (named) {
    const file = named.includes('/') || named.includes('\\') ? named : onPath(named, env);
    if (!file || !executable(file)) throw new RenderError(`VIVAMARK_CHROME=${named} is not a program that can run here`);
    if (wsl && /\.exe$/i.test(file)) {
      throw new RenderError(
        `VIVAMARK_CHROME=${named} is a Windows program: render drives the browser over a pipe, which does not cross from WSL to Windows. Install Chrome or Chromium inside WSL and point VIVAMARK_CHROME at it`,
      );
    }
    return file;
  }
  for (const name of CHROME_NAMES) {
    const file = onPath(name, env);
    if (file) return file;
  }
  if (process.platform === 'darwin') return MAC_CHROME.find(executable) ?? null;
  return null;
}

/** The launch flags: headless, a throwaway profile, and every way out of the machine closed. */
export function chromeArgs(profileDir: string): string[] {
  return [
    '--headless=new',
    '--remote-debugging-pipe',
    `--user-data-dir=${profileDir}`,
    // No host name resolves, and anything that would still connect goes to a
    // proxy that is not there, loopback included (all but the resolver check).
    '--host-resolver-rules=MAP * ~NOTFOUND',
    '--proxy-server=127.0.0.1:9',
    `--proxy-bypass-list=<-loopback>;${RESOLVER_CHECK_HOST}`,
    // None of the browser's own traffic: updates, sync, metrics, safe browsing.
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-domain-reliability',
    '--disable-client-side-phishing-detection',
    '--disable-breakpad',
    '--metrics-recording-only',
    '--no-pings',
    '--no-first-run',
    '--no-default-browser-check',
    '--mute-audio',
    '--hide-scrollbars',
    '--force-color-profile=srgb',
    'about:blank',
  ];
}

// ---- the DevTools protocol over a pipe ---------------------------------------------

type Json = Record<string, unknown>;

class Cdp {
  private next = 1;
  private pending = new Map<number, { resolve: (v: Json) => void; reject: (e: Error) => void; method: string }>();
  private listeners: ((method: string, params: Json, sessionId?: string) => void)[] = [];
  private buffer = '';

  constructor(
    private out: Writable,
    input: Readable,
  ) {
    input.setEncoding('utf8');
    input.on('data', (chunk: string) => {
      this.buffer += chunk;
      let end: number;
      while ((end = this.buffer.indexOf('\0')) >= 0) {
        const raw = this.buffer.slice(0, end);
        this.buffer = this.buffer.slice(end + 1);
        this.receive(JSON.parse(raw) as Json);
      }
    });
  }

  private receive(msg: Json): void {
    if (typeof msg.id === 'number') {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      const err = msg.error as { message?: string } | undefined;
      if (err) p.reject(new RenderError(`${p.method}: ${err.message ?? 'failed'}`));
      else p.resolve((msg.result as Json) ?? {});
    } else if (typeof msg.method === 'string') {
      for (const l of this.listeners) l(msg.method, (msg.params as Json) ?? {}, msg.sessionId as string | undefined);
    }
  }

  send(method: string, params: Json = {}, sessionId?: string): Promise<Json> {
    const id = this.next++;
    this.out.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject, method }));
  }

  on(listener: (method: string, params: Json, sessionId?: string) => void): void {
    this.listeners.push(listener);
  }

  failAll(err: Error): void {
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }
}

// ---- what is measured in the page ----------------------------------------------------

interface Measured {
  problems: { severity: 'error' | 'warning'; rule: string; figure: string | null; element: string | null; message: string }[];
  figures: { id: string; x: number; y: number; width: number; height: number }[];
  width: number;
  height: number;
}

/**
 * Runs in the page. Positions are taken in each SVG's own units (its viewBox),
 * through the element's transforms, so they compare with the viewBox and the
 * box beside the text. Kept free of closures: it is sent as source.
 */
function measure(): Measured {
  const problems: Measured['problems'] = [];
  const NOT_DRAWN = 'defs, marker, clipPath, mask, pattern, symbol';
  const outer = [...document.querySelectorAll<HTMLElement>('.viz')].filter((f) => !f.parentElement?.closest('.viz'));
  const figOf = (el: Element) => {
    const f = outer.find((o) => o.contains(el));
    return f ? f.id || `figure-${outer.indexOf(f) + 1}` : null;
  };
  const owner = (el: Element) => el.closest('g[id]')?.id || el.id || null;
  const short = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 60);
  const r0 = (n: number) => Math.round(n);
  for (const svg of document.querySelectorAll<SVGSVGElement>('.viz svg')) {
    if (svg.parentElement?.closest('svg')) continue;
    const toSvg = svg.getScreenCTM()?.inverse();
    if (!toSvg) continue;
    const boxIn = (el: SVGGraphicsElement) => {
      const b = el.getBBox();
      const m = toSvg.multiply(el.getScreenCTM()!);
      const pts = [
        [b.x, b.y],
        [b.x + b.width, b.y],
        [b.x, b.y + b.height],
        [b.x + b.width, b.y + b.height],
      ].map(([x, y]) => new DOMPoint(x, y).matrixTransform(m));
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
    };
    const vb = svg.viewBox.baseVal;
    const view = vb && vb.width > 0 && vb.height > 0 ? { x0: vb.x, x1: vb.x + vb.width, y0: vb.y, y1: vb.y + vb.height } : null;
    const fig = figOf(svg);
    for (const t of svg.querySelectorAll<SVGTextElement>('text')) {
      if (t.closest(NOT_DRAWN) || t.parentElement?.closest('text')) continue;
      const tb = boxIn(t);
      if (tb.x1 - tb.x0 < 0.5) continue;
      const text = short(t.textContent ?? '');
      const parent = t.parentElement;
      const rect = parent && parent !== (svg as Element) ? [...parent.children].find((c) => c.tagName === 'rect' && c.classList.contains('box')) : undefined;
      const mid = (tb.y0 + tb.y1) / 2;
      if (rect) {
        const bb = boxIn(rect as SVGGraphicsElement);
        if (mid >= bb.y0 && mid <= bb.y1 && (tb.x0 < bb.x0 - 0.5 || tb.x1 > bb.x1 + 0.5)) {
          problems.push({ severity: 'warning', rule: 'text-overflow', figure: fig, element: owner(t), message: `"${text}" is ${r0(tb.x1 - tb.x0)} wide (x ${r0(tb.x0)}..${r0(tb.x1)}) and runs out of its box (x ${r0(bb.x0)}..${r0(bb.x1)})` });
        }
      }
      if (view && (tb.x0 < view.x0 - 0.5 || tb.x1 > view.x1 + 0.5 || tb.y0 < view.y0 - 0.5 || tb.y1 > view.y1 + 0.5)) {
        problems.push({ severity: 'error', rule: 'text-clipped', figure: fig, element: owner(t), message: `"${text}" spans x ${r0(tb.x0)}..${r0(tb.x1)}, y ${r0(tb.y0)}..${r0(tb.y1)}, outside the viewBox (${view.x0} ${view.y0} ${view.x1 - view.x0} ${view.y1 - view.y0}): the part outside is cut off` });
      }
    }
    for (const s of svg.querySelectorAll<SVGGraphicsElement>('path, polyline, polygon, rect, circle, ellipse')) {
      if (s.closest(NOT_DRAWN)) continue;
      const fill = getComputedStyle(s).fill;
      if (fill !== 'rgb(0, 0, 0)' && fill !== '#000000' && fill !== 'black') continue;
      let set = false;
      for (let p: Element | null = s; p && p !== svg; p = p.parentElement) if (p.hasAttribute('fill') || /(^|;)\s*fill\s*:/i.test(p.getAttribute('style') ?? '')) set = true;
      if (set) continue;
      const cls = s.getAttribute('class');
      problems.push({ severity: 'error', rule: 'unfilled-shape', figure: fig, element: owner(s), message: `<${s.tagName}${cls ? ` class="${cls}"` : ''}> is drawn solid black: nothing sets its fill. Draw a line or bracket as an .edge path; give a shape a filled class or fill="none"` });
    }
  }
  const doc = document.documentElement;
  if (doc.scrollWidth > window.innerWidth + 1) {
    problems.push({ severity: 'warning', rule: 'page-sideways', figure: null, element: null, message: `the page is ${doc.scrollWidth} px wide at a ${window.innerWidth} px window: it scrolls sideways (wrap the wide part in .scroll)` });
  }
  const figures = outer.map((f, k) => {
    const b = f.getBoundingClientRect();
    return { id: f.id || `figure-${k + 1}`, x: b.left + window.scrollX, y: b.top + window.scrollY, width: b.width, height: b.height };
  });
  return { problems, figures, width: Math.max(doc.scrollWidth, window.innerWidth), height: doc.scrollHeight };
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Runs in the page: widens figure k to its scrolled width if it scrolls sideways; its box on the page. Sent as source. */
function widen(k: number): Box & { whole: boolean } {
  const f = [...document.querySelectorAll<HTMLElement>('.viz')].filter((e) => !e.parentElement?.closest('.viz'))[k];
  let whole = false;
  if (f.scrollWidth > f.clientWidth + 1) {
    f.dataset.vivamarkStyle = f.getAttribute('style') ?? '';
    for (let i = 0; i < 3 && f.scrollWidth > f.clientWidth + 1; i++) {
      f.style.setProperty('width', `${f.offsetWidth + f.scrollWidth - f.clientWidth}px`, 'important');
      f.style.setProperty('max-width', 'none', 'important');
      f.style.setProperty('overflow', 'visible', 'important');
    }
    whole = true;
  }
  const b = f.getBoundingClientRect();
  return { x: b.left + window.scrollX, y: b.top + window.scrollY, width: b.width, height: b.height, whole };
}

/** Runs in the page: puts figure k back as it was. */
function unwiden(k: number): void {
  const f = [...document.querySelectorAll<HTMLElement>('.viz')].filter((e) => !e.parentElement?.closest('.viz'))[k];
  const was = f.dataset.vivamarkStyle;
  delete f.dataset.vivamarkStyle;
  if (was) f.setAttribute('style', was);
  else f.removeAttribute('style');
}

// ---- rendering ---------------------------------------------------------------------

export interface RenderOptions {
  outDir?: string;
  dark?: boolean;
  width?: number;
  chrome?: string;
  timeoutMs?: number;
  /** Refuse non-file requests in the page through DevTools too. Off only in the test that proves the launch flags alone hold. */
  intercept?: boolean;
}

export interface RenderResult {
  schema: string;
  file: string;
  browser: string;
  mode: 'light' | 'dark';
  width: number;
  page_png: string;
  /** False when the page is taller than one image can be: the PNG shows the top of it. */
  page_complete: boolean;
  /** whole: the figure scrolls sideways on the page, and the PNG shows all of it, not the visible part. */
  figure_pngs: { figure: string; path: string; whole: boolean }[];
  /** Requests the page made for anything but a local file; all refused. */
  blocked: string[];
  /** Every such request as it failed in the browser, with Chrome's network error (net::ERR_BLOCKED_BY_CLIENT when refused). */
  failed: { url: string; error: string }[];
  errors: number;
  warnings: number;
  problems: Problem[];
}

export function defaultOutDir(file: string): string {
  const base = path.basename(file).replace(/\.[^.]+$/, '');
  return path.join(os.tmpdir(), 'vivamark-render', `${base}-${createHash('sha256').update(file).digest('hex').slice(0, 8)}`);
}

const safeName = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'figure';

/** The 1-based line of the first id="..." in the source, to point at the element in the file. */
function lineOfId(html: string, id: string | null): number | null {
  if (!id) return null;
  const re = new RegExp(`\\bid\\s*=\\s*["']?${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'\\s>]`);
  const m = re.exec(html);
  return m ? html.slice(0, m.index).split('\n').length : null;
}

export async function renderPage(file: string, opts: RenderOptions = {}): Promise<RenderResult> {
  const chrome = opts.chrome ?? findChrome();
  if (!chrome) {
    throw new RenderError(`no Chrome or Chromium found: looked for VIVAMARK_CHROME, then ${CHROME_NAMES.join(', ')} on PATH. Install one (vivamark never downloads a browser) or set VIVAMARK_CHROME to its path`);
  }
  const html = fs.readFileSync(file, 'utf8');
  const width = opts.width ?? 1000;
  const mode = opts.dark ? 'dark' : 'light';
  const outDir = path.resolve(opts.outDir ?? defaultOutDir(file));
  fs.mkdirSync(outDir, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'vivamark-chrome-'));
  const child: ChildProcess = spawn(chrome, chromeArgs(profile), { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (d: string) => {
    stderr = (stderr + d).slice(-4000);
  });
  const cdp = new Cdp(child.stdio[3] as Writable, child.stdio[4] as Readable);
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  child.once('error', (err) => cdp.failAll(new RenderError(`could not start ${chrome}: ${err.message}`)));
  child.once('exit', (code, signal) => cdp.failAll(new RenderError(`${chrome} exited (${signal ?? code}) before the page was drawn${stderr ? `:\n${stderr.trim().split('\n').slice(-5).join('\n')}` : ''}`)));
  (child.stdio[3] as Writable).on('error', () => {});

  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RenderError(`the browser did not finish within ${Math.round((opts.timeoutMs ?? 30_000) / 1000)} s`)), opts.timeoutMs ?? 30_000);
  });

  const blocked: string[] = [];
  const requested = new Map<string, string>();
  const failed: RenderResult['failed'] = [];
  const local = (url: string) => /^(file|data|blob|about):/i.test(url);
  const work = async (): Promise<RenderResult> => {
    const { targetId } = (await cdp.send('Target.createTarget', { url: 'about:blank' })) as { targetId: string };
    const { sessionId } = (await cdp.send('Target.attachToTarget', { targetId, flatten: true })) as { sessionId: string };
    const send = (method: string, params: Json = {}) => cdp.send(method, params, sessionId);
    let loaded: () => void = () => {};
    const load = new Promise<void>((resolve) => (loaded = resolve));
    cdp.on((method, params, sid) => {
      if (sid !== sessionId) return;
      if (method === 'Page.loadEventFired') loaded();
      if (method === 'Network.requestWillBeSent') requested.set(params.requestId as string, String((params.request as { url?: string })?.url ?? ''));
      if (method === 'Network.loadingFailed') {
        const url = requested.get(params.requestId as string) ?? '';
        if (url && !local(url)) failed.push({ url, error: String(params.errorText ?? '') });
      }
      if (method === 'Fetch.requestPaused') {
        const url = String((params.request as { url?: string })?.url ?? '');
        const requestId = params.requestId as string;
        if (local(url)) void send('Fetch.continueRequest', { requestId }).catch(() => {});
        else {
          blocked.push(url);
          void send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }).catch(() => {});
        }
      }
    });
    if (opts.intercept !== false) await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    await send('Page.enable');
    await send('Network.enable');
    // Review pages carry no script of their own (lint errors on one): none runs here either, so the
    // drawing is the saved markup, and nothing in the page can open a socket.
    await send('Emulation.setScriptExecutionDisabled', { value: true });
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Emulation.setEmulatedMedia', { media: 'screen', features: [{ name: 'prefers-color-scheme', value: mode }] });
    await send('Page.navigate', { url: pathToFileURL(file).href });
    await load;
    const evaluated = (await send('Runtime.evaluate', {
      expression: `document.fonts.ready.then(() => (${measure.toString()})())`,
      awaitPromise: true,
      returnByValue: true,
    })) as { result?: { value?: Measured }; exceptionDetails?: { text?: string } };
    if (evaluated.exceptionDetails || !evaluated.result?.value) throw new RenderError(`measuring the page failed: ${evaluated.exceptionDetails?.text ?? 'no result'}`);
    const m = evaluated.result.value;

    const base = path.basename(file).replace(/\.[^.]+$/, '');
    const shot = async (clip: { x: number; y: number; width: number; height: number }, name: string) => {
      const r = (await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { ...clip, scale: 1 } })) as { data: string };
      const out = path.join(outDir, name);
      fs.writeFileSync(out, Buffer.from(r.data, 'base64'));
      return out;
    };
    const pageHeight = Math.min(Math.ceil(m.height), MAX_SHOT_PX);
    const page_png = await shot({ x: 0, y: 0, width: Math.ceil(m.width), height: pageHeight }, `${base}.${mode}.${width}.png`);
    const figure_pngs: RenderResult['figure_pngs'] = [];
    for (const [k, f] of m.figures.entries()) {
      if (f.width < 1 || f.height < 1) continue;
      // A figure that scrolls sideways (.viz does on a narrow screen) is widened while it is
      // drawn, so the PNG holds all of it, then put back.
      const widened = (await send('Runtime.evaluate', { expression: `(${widen.toString()})(${k})`, returnByValue: true })) as { result?: { value?: Box & { whole: boolean } } };
      const b = widened.result?.value ?? { ...f, whole: false };
      const pad = 8;
      const clip = { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: Math.ceil(b.width + 2 * pad), height: Math.min(Math.ceil(b.height + 2 * pad), MAX_SHOT_PX) };
      figure_pngs.push({ figure: f.id, path: await shot(clip, `${base}.${safeName(f.id)}.${mode}.${width}.png`), whole: b.whole });
      if (b.whole) await send('Runtime.evaluate', { expression: `(${unwiden.toString()})(${k})` });
    }

    const problems: Problem[] = m.problems.map((p) => ({ ...p, line: lineOfId(html, p.element) }));
    for (const url of [...new Set(blocked)]) {
      problems.push({ severity: 'error', rule: 'outbound-request', figure: null, element: null, line: null, message: `the page asked for ${url.slice(0, 120)}; refused. Inline it instead: review pages fetch nothing` });
    }
    const errors = problems.filter((p) => p.severity === 'error').length;
    return {
      schema: RENDER_SCHEMA,
      file,
      browser: chrome,
      mode,
      width,
      page_png,
      page_complete: m.height <= MAX_SHOT_PX,
      figure_pngs,
      blocked: [...new Set(blocked)],
      failed,
      errors,
      warnings: problems.length - errors,
      problems,
    };
  };

  try {
    return await Promise.race([work(), timeout]);
  } finally {
    clearTimeout(timer);
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    try {
      await Promise.race([cdp.send('Browser.close'), wait(2000)]);
    } catch {
      // Already gone.
    }
    // Let the browser and its helpers finish writing the profile before it is removed.
    await Promise.race([exited, wait(5000)]);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await Promise.race([exited, wait(2000)]);
    }
    try {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch {
      // A helper still writing: the throwaway profile is left in the temp directory, the render stands.
    }
  }
}

/** 0 clean, 1 errors, 2 warnings only: as lint. */
export function renderExitCode(r: RenderResult): number {
  return r.errors ? 1 : r.warnings ? 2 : 0;
}

export function renderRenderResult(r: RenderResult): string {
  const n = (k: number, w: string) => `${k} ${w}${k === 1 ? '' : 's'}`;
  const lines = [
    `${r.file}: rendered ${r.mode} at ${r.width} px with ${r.browser}; ${r.problems.length ? `${n(r.errors, 'error')}, ${n(r.warnings, 'warning')}` : 'clean'}`,
    `  page    ${r.page_png}${r.page_complete ? '' : ` (the top ${MAX_SHOT_PX} px only)`}`,
    ...r.figure_pngs.map((f) => `  #${f.figure}  ${f.path}${f.whole ? ' (scrolls sideways on the page; drawn whole)' : ''}`),
  ];
  for (const p of r.problems) {
    const at = [p.line ? `line ${p.line}` : '', p.figure ? `#${p.figure}` : ''].filter(Boolean).join(' ');
    lines.push(`  ${p.severity.padEnd(7)} ${p.rule.padEnd(16)} ${at ? `${at}: ` : ''}${p.message}`);
  }
  lines.push('Look at the PNGs: they show what the reviewer will see.');
  return lines.join('\n') + '\n';
}
