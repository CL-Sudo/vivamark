// Serving the saved HTML file: injecting the one script tag, and mapping an
// anchor back to a line of the file so the agent can jump straight to it.

import { parse } from 'parse5';
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

/** Maps an anchor to a 1-based line of the saved HTML file, or null for content built by scripts. */
export function sourceLine(html: string, anchor: Omit<Anchor, 'source_line'>): number | null {
  return placeAnchor(loadDoc('html', html), anchor)?.source_line ?? null;
}
