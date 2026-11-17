// Serving the saved HTML file: injecting the one script tag, and mapping an
// anchor back to a line of the file so the agent can jump straight to it.

import { parseWithLocations } from './parse.js';
import type { DefaultTreeAdapterMap } from 'parse5';
import { loadDoc, placeAnchor } from './doc.js';
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

/**
 * Returns the page with exactly one script tag added, early in the head. The
 * rest of the file is passed through byte for byte.
 */
export function injectScript(html: string, tag: string): string {
  const offset = headStart(html) ?? insertionPoint(html);
  return html.slice(0, offset) + tag + html.slice(offset);
}

/** How far past a likely `<head` tag to parse: room for its attributes. */
const HEAD_WINDOW = 4096;

/**
 * Where an explicit head's start tag ends, found by parsing only the start of
 * the page. The parser reads left to right, so a head start tag it has finished
 * in a prefix is the one it finds in the whole page; anything less certain
 * (no explicit head in the prefix) returns null and the whole page is parsed.
 */
function headStart(html: string): number | null {
  const m = /<head[\s/>]/i.exec(html);
  if (!m) return null;
  const cut = m.index + HEAD_WINDOW;
  if (cut >= html.length) return null;
  const doc = parseWithLocations(html.slice(0, cut));
  const htmlEl = children(doc).find((e) => e.tagName === 'html');
  const head = htmlEl && children(htmlEl).find((e) => e.tagName === 'head');
  return head?.sourceCodeLocation?.startTag?.endOffset ?? null;
}

/** Where the tag goes, from a parse of the whole page. */
function insertionPoint(html: string): number {
  const doc = parseWithLocations(html);
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
  return offset;
}

/** Maps an anchor to a 1-based line of the saved HTML file, or null for content built by scripts. */
export function sourceLine(html: string, anchor: Omit<Anchor, 'source_line'>): number | null {
  return placeAnchor(loadDoc('html', html), anchor)?.source_line ?? null;
}
