// Reading the saved HTML file: injecting the one script tag, and mapping an
// anchor back to a line of the file so the agent can jump straight to it.

import { parse } from 'parse5';
import type { DefaultTreeAdapterMap } from 'parse5';
import type { Anchor } from './schema.js';

type Node = DefaultTreeAdapterMap['node'];
type Element = DefaultTreeAdapterMap['element'];
type Document = DefaultTreeAdapterMap['document'];

function isElement(n: Node): n is Element {
  return 'tagName' in n;
}

function children(n: Node): Element[] {
  return 'childNodes' in n ? (n.childNodes as Node[]).filter(isElement) : [];
}

function attr(el: Element, name: string): string | undefined {
  return el.attrs.find((a) => a.name === name)?.value;
}

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

/**
 * Returns the page with exactly one script tag added, early in the head. The
 * rest of the file is passed through byte for byte.
 */
export function injectScript(html: string, tag: string): string {
  const doc = parse(html, { sourceCodeLocationInfo: true }) as Document;
  const htmlEl = children(doc).find((e) => e.tagName === 'html');
  const head = htmlEl && children(htmlEl).find((e) => e.tagName === 'head');
  let offset = 0;
  const headTag = head?.sourceCodeLocation?.startTag;
  const htmlTag = htmlEl?.sourceCodeLocation?.startTag;
  if (headTag) {
    offset = headTag.endOffset;
  } else if (htmlTag) {
    offset = htmlTag.endOffset;
  } else {
    const doctype = (doc.childNodes as Node[]).find((n) => n.nodeName === '#documentType');
    offset = doctype?.sourceCodeLocation?.endOffset ?? (html.startsWith('﻿') ? 1 : 0);
  }
  return html.slice(0, offset) + tag + html.slice(offset);
}

function unescapeCss(s: string): string {
  return s
    .replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/\\(.)/g, '$1');
}

/** Resolves the selector shape the review SDK produces: `#id` or `body`, then `tag:nth-of-type(n)` steps. */
function resolveSelector(doc: Document, selector: string): Element | null {
  const steps = selector.split(/\s*>\s*/).filter(Boolean);
  if (!steps.length) return null;
  let current: Element | null;
  const first = steps[0];
  if (first.startsWith('#')) {
    const id = unescapeCss(first.slice(1));
    current = find(doc, (el) => attr(el, 'id') === id);
  } else {
    current = find(doc, (el) => el.tagName.toLowerCase() === first.toLowerCase());
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

function lineAt(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/** Maps an anchor to a 1-based line of the saved file, or null for content built by scripts. */
export function sourceLine(html: string, anchor: Omit<Anchor, 'source_line'>): number | null {
  let doc: Document;
  try {
    doc = parse(html, { sourceCodeLocationInfo: true }) as Document;
  } catch {
    return null;
  }
  let el: Element | null = null;
  if (anchor.stable_id) {
    const id = anchor.stable_id;
    el = find(doc, (e) => attr(e, 'id') === id || attr(e, 'data-vivamark-id') === id);
  }
  if (!el && anchor.selector) el = resolveSelector(doc, anchor.selector);
  const loc = el?.sourceCodeLocation;
  if (!el || !loc) return null;
  if (anchor.quote) {
    // A text note: prefer the line the quote itself is on, when it appears verbatim.
    const inside = html.slice(loc.startOffset, loc.endOffset);
    const at = inside.indexOf(anchor.quote.trim());
    if (at >= 0) return lineAt(html, loc.startOffset + at);
  }
  return loc.startLine;
}
