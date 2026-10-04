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

/** Finds the quote in [from, to) of the text, preferring the occurrence with its prefix and suffix. */
export function findQuote(doc: Doc, a: Pick<Anchor, 'quote' | 'prefix' | 'suffix'>, from = 0, to = doc.text.length): number {
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
    place.lines = [el.sourceCodeLocation.startLine, el.sourceCodeLocation.endLine];
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
