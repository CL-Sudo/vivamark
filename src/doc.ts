// The reviewed file as the daemon sees it: parsed once, with the text the
// browser will show and the way back from an element or a quote to lines of
// the saved file. HTML is parsed as it is; Markdown is rendered first, with
// each block carrying the lines it came from.

import MarkdownIt from 'markdown-it';
import { parse } from 'parse5';
import type { DefaultTreeAdapterMap } from 'parse5';
import type { Anchor } from './schema.js';

type Node = DefaultTreeAdapterMap['node'];
export type Element = DefaultTreeAdapterMap['element'];
type Document = DefaultTreeAdapterMap['document'];
type TextNode = DefaultTreeAdapterMap['textNode'];

export type DocKind = 'html' | 'markdown';

export function docKind(file: string): DocKind | null {
  if (/\.html?$/i.test(file)) return 'html';
  if (/\.(md|markdown)$/i.test(file)) return 'markdown';
  return null;
}

// ---- Markdown -----------------------------------------------------------------

/** The attribute that carries a rendered Markdown block's source lines, `first-last`, 1-based. */
export const LINES_ATTR = 'data-vivamark-lines';

const md = new MarkdownIt({ html: false, linkify: false, typographer: false });
md.core.ruler.push('vivamark_lines', (state) => {
  for (const t of state.tokens) {
    if (!t.map || t.nesting === -1 || t.type === 'inline') continue;
    t.attrSet(LINES_ATTR, `${t.map[0] + 1}-${t.map[1]}`);
  }
});

const MD_CSS = `
  body { font: 16px/1.65 Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #33415c; max-width: 46rem; margin: 40px 56px; }
  h1, h2, h3, h4 { color: #0b1324; line-height: 1.25; margin: 1.6em 0 .6em; }
  h1 { font-size: 30px; margin-top: 0; } h2 { font-size: 21px; } h3 { font-size: 17px; }
  a { color: #0369a1; }
  code { font: 13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: #f1f5f9; border-radius: 4px; padding: 1px 4px; }
  pre { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 14px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  blockquote { margin: 0; padding: 2px 16px; border-left: 3px solid #bae6fd; color: #475569; }
  table { border-collapse: collapse; } th, td { border: 1px solid #e2e8f0; padding: 6px 10px; text-align: left; }
  img { max-width: 100%; }
`;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** A whole page for a Markdown file: raw HTML in the source is shown as text, never run. */
export function renderMarkdownPage(source: string, title: string): string {
  return (
    `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
    `<title>${escapeHtml(title)}</title>\n<style>${MD_CSS}</style>\n</head>\n<body>\n${md.render(source)}</body>\n</html>\n`
  );
}

// ---- the parsed document -------------------------------------------------------

export interface Doc {
  kind: DocKind;
  /** The saved file. */
  source: string;
  /** The page as served, before the script tag is added. */
  html: string;
  root: Document;
  body: Element | null;
  /** The text of the body, as the browser's text nodes join it. */
  text: string;
  /** Each text node of the body and where its text starts in `text`. */
  spans: { node: TextNode; start: number }[];
  /** Where each body element's text starts and ends in `text`. */
  ranges: Map<Element, [number, number]>;
  /** How many elements carry each id. */
  ids: Map<string, number>;
}

export function isElement(n: Node): n is Element {
  return 'tagName' in n;
}

function children(n: Node): Element[] {
  return 'childNodes' in n ? (n.childNodes as Node[]).filter(isElement) : [];
}

export function attr(el: Element, name: string): string | undefined {
  return el.attrs.find((a) => a.name === name)?.value;
}

function parent(el: Element): Element | null {
  const p = el.parentNode;
  return p && isElement(p as Node) ? (p as Element) : null;
}

/** Breadth-first search, into template contents as well. */
function find(root: Node, pred: (el: Element) => boolean): Element | null {
  const stack: Node[] = [root];
  while (stack.length) {
    const n = stack.shift()!;
    if (isElement(n) && pred(n)) return n;
    if ('childNodes' in n) stack.push(...(n.childNodes as Node[]));
    if (isElement(n) && n.tagName === 'template') stack.push((n as unknown as { content: Node }).content);
  }
  return null;
}

export function loadDoc(kind: DocKind, source: string, title = ''): Doc {
  const html = kind === 'markdown' ? renderMarkdownPage(source, title) : source;
  const root = parse(html, { sourceCodeLocationInfo: true }) as Document;
  const htmlEl = children(root).find((e) => e.tagName === 'html');
  const body = (htmlEl && children(htmlEl).find((e) => e.tagName === 'body')) ?? null;
  const doc: Doc = { kind, source, html, root, body, text: '', spans: [], ranges: new Map(), ids: new Map() };
  const parts: string[] = [];
  let pos = 0;
  // Like a browser's TreeWalker over the body: template contents are not children.
  const walk = (n: Node) => {
    if (n.nodeName === '#text') {
      const t = n as TextNode;
      doc.spans.push({ node: t, start: pos });
      parts.push(t.value);
      pos += t.value.length;
      return;
    }
    if (!isElement(n)) return;
    const start = pos;
    for (const c of n.childNodes as Node[]) walk(c);
    doc.ranges.set(n, [start, pos]);
  };
  if (body) walk(body);
  doc.text = parts.join('');
  const countIds = (n: Node) => {
    if (isElement(n)) {
      const id = attr(n, 'id');
      if (id) doc.ids.set(id, (doc.ids.get(id) ?? 0) + 1);
    }
    if ('childNodes' in n) for (const c of n.childNodes as Node[]) countIds(c);
  };
  countIds(root);
  return doc;
}

// ---- selectors -------------------------------------------------------------------

/** CSS.escape, as the CSSOM specification defines it, for ids in selectors. */
export function cssEscape(value: string): string {
  let out = '';
  const first = value.charCodeAt(0);
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c === 0) out += '�';
    else if ((c >= 1 && c <= 0x1f) || c === 0x7f || (i === 0 && c >= 0x30 && c <= 0x39) || (i === 1 && c >= 0x30 && c <= 0x39 && first === 0x2d)) {
      out += `\\${c.toString(16)} `;
    } else if (i === 0 && c === 0x2d && value.length === 1) out += `\\${value[i]}`;
    else if (c >= 0x80 || c === 0x2d || c === 0x5f || (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)) {
      out += value[i];
    } else out += `\\${value[i]}`;
  }
  return out;
}

function unescapeCss(s: string): string {
  return s
    .replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/\\(.)/g, '$1');
}

/** The review SDK's selector for an element: `#nearest-unique-id` or `body`, then `tag:nth-of-type(n)` steps. */
export function cssPath(doc: Doc, el: Element): string {
  const steps: string[] = [];
  let cur: Element | null = el;
  while (cur && cur.tagName !== 'html') {
    const id = attr(cur, 'id');
    if (id && doc.ids.get(id) === 1) {
      steps.unshift(`#${cssEscape(id)}`);
      break;
    }
    if (cur === doc.body) {
      steps.unshift('body');
      break;
    }
    const tag = cur.tagName;
    let nth = 1;
    const p: Element | null = parent(cur);
    if (p) for (const sib of children(p)) {
      if (sib === cur) break;
      if (sib.tagName === tag) nth++;
    }
    steps.unshift(`${tag}:nth-of-type(${nth})`);
    cur = p;
  }
  return steps.join(' > ');
}

/** Resolves the selector shape the review SDK produces. Anything else resolves to nothing. */
export function resolveSelector(doc: Doc, selector: string): Element | null {
  const steps = selector.split(/\s*>\s*/).filter(Boolean);
  if (!steps.length) return null;
  let current: Element | null;
  const first = steps[0];
  if (first.startsWith('#')) {
    const id = unescapeCss(first.slice(1));
    current = find(doc.root, (el) => attr(el, 'id') === id);
  } else {
    if (!/^[a-zA-Z][a-zA-Z0-9-]*$/.test(first)) return null;
    current = find(doc.root, (el) => el.tagName.toLowerCase() === first.toLowerCase());
  }
  for (const step of steps.slice(1)) {
    if (!current) return null;
    const m = /^([a-zA-Z][a-zA-Z0-9-]*)(?::nth-of-type\((\d+)\))?$/.exec(step);
    if (!m) return null;
    const tag = m[1].toLowerCase();
    const nth = m[2] ? Number(m[2]) : 1;
    const host: Node = current.tagName === 'template' ? (current as unknown as { content: Node }).content : current;
    current = children(host).filter((e) => e.tagName.toLowerCase() === tag)[nth - 1] ?? null;
  }
  return current;
}

export function byStableId(doc: Doc, id: string): Element | null {
  return find(doc.root, (e) => attr(e, 'id') === id || attr(e, 'data-vivamark-id') === id);
}

export function stableIdOf(el: Element): string | null {
  return attr(el, 'id') || attr(el, 'data-vivamark-id') || null;
}

// ---- text --------------------------------------------------------------------------

export const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

export function textOf(doc: Doc, el: Element): string {
  const r = doc.ranges.get(el);
  return r ? doc.text.slice(r[0], r[1]) : '';
}

/** The text node holding offset `at`, and the offset within it. */
function spanAt(doc: Doc, at: number): { node: TextNode; offset: number } | null {
  let lo = 0;
  let hi = doc.spans.length - 1;
  let hit = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (doc.spans[mid].start <= at) {
      hit = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (hit < 0) return null;
  // Skip empty nodes that share a start with the one that really holds the text.
  while (hit + 1 < doc.spans.length && doc.spans[hit + 1].start === doc.spans[hit].start && doc.spans[hit].node.value.length === 0) hit++;
  const s = doc.spans[hit];
  return { node: s.node, offset: at - s.start };
}

/** The deepest element whose text covers [start, end). */
export function containerOf(doc: Doc, start: number, end: number): Element | null {
  const span = spanAt(doc, start);
  let el = span ? (span.node.parentNode as Element | null) : null;
  while (el && isElement(el)) {
    const r = doc.ranges.get(el);
    if (r && r[0] <= start && r[1] >= end) return el;
    el = parent(el);
  }
  return doc.body;
}

/**
 * Finds the quote in [from, to) of the text, preferring the occurrence with
 * its prefix and suffix. With `bare` false, a quote without either is not enough.
 */
export function findQuote(doc: Doc, a: Pick<Anchor, 'quote' | 'prefix' | 'suffix'>, from = 0, to = doc.text.length, bare = true): number {
  const q = a.quote ?? '';
  if (!q) return -1;
  const hay = doc.text.slice(from, to);
  const p = a.prefix ?? '';
  const s = a.suffix ?? '';
  for (const [lead, tail] of [
    [p, s],
    [p, ''],
    ['', s],
  ]) {
    if (!lead && !tail) continue;
    const at = hay.indexOf(lead + q + tail);
    if (at >= 0) return from + at + lead.length;
  }
  if (!bare) return -1;
  const at = hay.indexOf(q);
  return at >= 0 ? from + at : -1;
}

// ---- lines -----------------------------------------------------------------------------

export interface Place {
  stable_id: string | null;
  selector: string;
  source_line: number | null;
  lines: [number, number] | null;
}

function lineOfText(doc: Doc, at: number): number | null {
  const span = spanAt(doc, at);
  const loc = span?.node.sourceCodeLocation;
  if (!span || !loc) return null;
  let line = loc.startLine;
  const v = span.node.value;
  for (let i = 0; i < span.offset && i < v.length; i++) if (v.charCodeAt(i) === 10) line++;
  return line;
}

function markdownBlockLines(el: Element | null): [number, number] | null {
  for (let cur = el; cur; cur = parent(cur)) {
    const v = attr(cur, LINES_ATTR);
    const m = v ? /^(\d+)-(\d+)$/.exec(v) : null;
    if (m) return [Number(m[1]), Number(m[2])];
  }
  return null;
}

/** A Markdown block's range, without the blank lines markdown-it counts at its end. */
function trimBlank(doc: Doc, [first, last]: [number, number]): [number, number] {
  const lines = doc.source.split('\n');
  while (last > first && !(lines[last - 1] ?? '').trim()) last--;
  return [first, last];
}

/** For a quote in a Markdown block, the lines it is on, when the source has it close to verbatim. */
function markdownQuoteLines(doc: Doc, block: [number, number], quote: string): [number, number] {
  const lines = doc.source.split('\n');
  const parts = quote.split('\n').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return block;
  const head = parts[0].slice(0, 40);
  const tail = parts[parts.length - 1].slice(-40);
  let first = -1;
  for (let l = block[0]; l <= block[1]; l++) if ((lines[l - 1] ?? '').includes(head)) {
    first = l;
    break;
  }
  if (first < 0) return block;
  for (let l = first; l <= block[1]; l++) if ((lines[l - 1] ?? '').includes(tail)) return [first, l];
  return [first, first];
}

/** Where an element, or a quote at [start, end) inside it, is in the saved file. */
export function placeOf(doc: Doc, el: Element, quote?: { start: number; end: number; text: string }): Place {
  const place: Place = { stable_id: stableIdOf(el), selector: cssPath(doc, el), source_line: null, lines: null };
  if (doc.kind === 'markdown') {
    const block = markdownBlockLines(el);
    if (block) {
      const range = trimBlank(doc, block);
      place.lines = quote ? markdownQuoteLines(doc, range, quote.text) : range;
    }
  } else if (quote) {
    const first = lineOfText(doc, quote.start);
    const last = lineOfText(doc, Math.max(quote.start, quote.end - 1));
    if (first !== null) place.lines = [first, last ?? first];
  } else if (el.sourceCodeLocation) {
    const loc = el.sourceCodeLocation;
    place.lines = [loc.startLine, loc.endLine ?? loc.startLine];
  }
  place.source_line = place.lines ? place.lines[0] : null;
  return place;
}

/**
 * Where an anchor is in the document at the moment of sending: by stable id,
 * then selector; a quote is looked for inside that element.
 */
export function placeAnchor(doc: Doc, a: Omit<Anchor, 'source_line'>): Place | null {
  let el: Element | null = a.stable_id ? byStableId(doc, a.stable_id) : null;
  if (!el && a.selector) el = resolveSelector(doc, a.selector);
  if (!el) return null;
  if (a.quote !== undefined) {
    const r = doc.ranges.get(el);
    const at = r ? findQuote(doc, a, r[0], r[1]) : -1;
    if (at >= 0) {
      const end = at + a.quote.length;
      return placeOf(doc, el, { start: at, end, text: a.quote });
    }
  }
  return placeOf(doc, el);
}

// ---- re-anchoring (F3) ------------------------------------------------------------------

/**
 * Where a note's target is after the file changed:
 * - `anchored`: found where it was;
 * - `moved`: found, but somewhere else (`place` says where);
 * - `orphaned`: gone. Never pinned to a guess.
 */
export type AnchorState = 'anchored' | 'moved' | 'orphaned';

export interface Located {
  state: AnchorState;
  el: Element | null;
  place: Place | null;
}

const ORPHANED: Located = { state: 'orphaned', el: null, place: null };

/** Lower case, no whitespace: browsers' innerText and the parsed text differ in spacing and text-transform. */
const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();
const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/** An element's recorded text, without the ellipsis the SDK adds when it clips it. */
const recordedText = (t: string | undefined) => (t ?? '').replace(/…$/, '');

/** Enough words in common that an edited element is still the one the note was about. */
function similar(before: string, after: string): boolean {
  const a = words(before);
  if (a.length < 3) return true;
  const b = new Set(words(after));
  return a.filter((w) => b.has(w)).length / a.length >= 0.34;
}

function bodyElements(doc: Doc): Element[] {
  return [...doc.ranges.keys()];
}

function locateElement(doc: Doc, a: Omit<Anchor, 'source_line'>): Located {
  const original = a.selector ? resolveSelector(doc, a.selector) : null;
  const tag = (a.tag ?? '').toLowerCase();
  const found = (el: Element, state: AnchorState): Located => ({ state, el, place: placeOf(doc, el) });
  // 1. The stable id: the same element, wherever it is now.
  if (a.stable_id) {
    const el = byStableId(doc, a.stable_id);
    if (el) return found(el, !a.selector || cssPath(doc, el) === a.selector ? 'anchored' : 'moved');
  }
  // 2. The element's text: an element of the same tag that still starts with it.
  const want = norm(recordedText(a.text));
  if (want) {
    const matches = bodyElements(doc).filter((el) => (!tag || el.tagName.toLowerCase() === tag) && norm(textOf(doc, el)).startsWith(want));
    if (original && matches.includes(original)) return found(original, 'anchored');
    if (matches.length === 1) return found(matches[0], 'moved');
  }
  // 3. The selector, if what is there now is still recognisably the same element.
  if (original && (!tag || original.tagName.toLowerCase() === tag) && similar(recordedText(a.text), textOf(doc, original))) {
    return found(original, 'anchored');
  }
  return ORPHANED;
}

function count(hay: string, needle: string): number {
  let n = 0;
  for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + 1)) n++;
  return n;
}

function locateText(doc: Doc, a: Omit<Anchor, 'source_line'>): Located {
  const q = a.quote ?? '';
  if (!q) return ORPHANED;
  const byId = a.stable_id ? byStableId(doc, a.stable_id) : null;
  const bySelector = a.selector ? resolveSelector(doc, a.selector) : null;
  const original = byId ?? bySelector;
  const within = (el: Element | null, bare: boolean) => {
    const r = el ? doc.ranges.get(el) : undefined;
    return r ? findQuote(doc, a, r[0], r[1], bare) : -1;
  };
  const inside = (el: Element | null, at: number) => {
    const r = el ? doc.ranges.get(el) : undefined;
    return !!r && r[0] <= at && at + q.length <= r[1];
  };
  const found = (at: number, state: AnchorState, el?: Element | null): Located => {
    const container = el ?? containerOf(doc, at, at + q.length) ?? doc.body;
    if (!container) return ORPHANED;
    return { state, el: container, place: placeOf(doc, container, { start: at, end: at + q.length, text: q }) };
  };
  // 1. The stable id's element still holds the quote.
  let at = within(byId, true);
  if (at >= 0) return found(at, 'anchored', byId);
  // 2. The quote with its prefix or suffix, anywhere on the page.
  at = within(original, false);
  if (at < 0) at = findQuote(doc, a, 0, doc.text.length, false);
  if (at >= 0) return inside(original, at) ? found(at, 'anchored', original) : found(at, 'moved');
  // 3. The selector's element still holds the bare quote.
  at = within(bySelector, true);
  if (at >= 0) return found(at, 'anchored', bySelector);
  // Last, the bare quote, but only where it is unambiguous.
  if (count(doc.text, q) === 1) return found(doc.text.indexOf(q), 'moved');
  return ORPHANED;
}

/** Re-resolves a note's anchor against the document as it is now. */
export function locate(doc: Doc, a: Omit<Anchor, 'source_line'>): Located {
  return a.quote !== undefined ? locateText(doc, a) : locateElement(doc, a);
}

// ---- targets named by the agent (F7) --------------------------------------------------------

export interface NamedTarget {
  kind: 'element' | 'text';
  anchor: Omit<Anchor, 'source_line' | 'lines'>;
}

const CONTEXT = 32;

function elementTarget(doc: Doc, el: Element): NamedTarget {
  const text = squash(textOf(doc, el));
  return {
    kind: 'element',
    anchor: { stable_id: stableIdOf(el), selector: cssPath(doc, el), tag: el.tagName, text: text.length > 200 ? text.slice(0, 199) + '…' : text },
  };
}

/** The smallest body element covering a line of the saved file. */
function elementAtLine(doc: Doc, line: number): Element | null {
  let best: Element | null = null;
  let bestSpan = Infinity;
  for (const el of doc.ranges.keys()) {
    let range: [number, number] | null = null;
    if (doc.kind === 'markdown') {
      const v = attr(el, LINES_ATTR);
      const m = v ? /^(\d+)-(\d+)$/.exec(v) : null;
      if (m) range = trimBlank(doc, [Number(m[1]), Number(m[2])]);
    } else if (el.sourceCodeLocation && el !== doc.body) {
      range = [el.sourceCodeLocation.startLine, el.sourceCodeLocation.endLine ?? el.sourceCodeLocation.startLine];
    }
    if (!range || line < range[0] || line > range[1]) continue;
    const span = range[1] - range[0];
    // Ties go to the deeper element, which comes later in document order.
    if (span <= bestSpan) {
      best = el;
      bestSpan = span;
    }
  }
  return best;
}

/**
 * What `vivamark note add --target` names: `line:12` or `12`, `css:<selector>`
 * or a selector starting with `#` or `body`, `quote:<text>` or any other
 * text found on the page. Returns an error message when it names nothing.
 */
export function namedTarget(doc: Doc, target: string): NamedTarget | string {
  const t = target.trim();
  let m: RegExpExecArray | null;
  if ((m = /^(?:line:)?(\d+)$/.exec(t))) {
    const el = elementAtLine(doc, Number(m[1]));
    return el ? elementTarget(doc, el) : `line ${m[1]} is not in the page's body`;
  }
  const explicit = /^(css|quote):([\s\S]+)$/.exec(t);
  const selector = explicit?.[1] === 'css' ? explicit[2].trim() : !explicit && /^(#|body\b)/.test(t) ? t : null;
  if (selector !== null) {
    const el = resolveSelector(doc, selector);
    return el ? elementTarget(doc, el) : `no element matches ${selector} (selectors are #id or body, then tag:nth-of-type(n) steps)`;
  }
  const quote = explicit?.[1] === 'quote' ? explicit[2] : t;
  const at = doc.text.indexOf(quote);
  if (!quote || at < 0) return `the page has no text "${quote}"`;
  const end = at + quote.length;
  const el = containerOf(doc, at, end);
  if (!el) return `the page has no text "${quote}"`;
  const r = doc.ranges.get(el) ?? [0, doc.text.length];
  return {
    kind: 'text',
    anchor: {
      stable_id: stableIdOf(el),
      selector: cssPath(doc, el),
      quote,
      prefix: doc.text.slice(Math.max(r[0], at - CONTEXT), at),
      suffix: doc.text.slice(end, Math.min(r[1], end + CONTEXT)),
    },
  };
}
