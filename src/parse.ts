// parse5 with source locations, made cheaper. The stock tree adapter extends a
// node's location with an object spread every time a text node grows by one
// token (each word, each run of spaces) and every time an element closes: about
// a fifth of a parse's time on a large page. This adapter builds the same
// location from the fields parse5's location types allow (the six positions,
// then attrs, startTag and endTag), in the same key order, without changing
// any object in place.

import { defaultTreeAdapter, parse } from 'parse5';
import type { DefaultTreeAdapterMap, TreeAdapter } from 'parse5';

type Document = DefaultTreeAdapterMap['document'];
type Location = NonNullable<DefaultTreeAdapterMap['element']['sourceCodeLocation']>;

const adapter: TreeAdapter<DefaultTreeAdapterMap> = {
  ...defaultTreeAdapter,
  updateNodeSourceCodeLocation(node, end) {
    const l = node.sourceCodeLocation as Location | null | undefined;
    if (!l) return defaultTreeAdapter.updateNodeSourceCodeLocation(node, end);
    const o = {
      startLine: l.startLine,
      startCol: l.startCol,
      startOffset: l.startOffset,
      endLine: end.endLine,
      endCol: end.endCol,
      endOffset: end.endOffset,
    } as Location;
    if (l.attrs) o.attrs = l.attrs;
    if (l.startTag) o.startTag = l.startTag;
    const endTag = (end as Partial<Location>).endTag ?? l.endTag;
    if (endTag) o.endTag = endTag;
    node.sourceCodeLocation = o;
  },
};

/** parse5's parse with source locations: the same tree and locations as the stock adapter gives, sooner. */
export function parseWithLocations(html: string): Document {
  return parse(html, { sourceCodeLocationInfo: true, treeAdapter: adapter }) as Document;
}
