// Runs inside the reviewed page, in a sandboxed frame with an opaque origin.
// It has no token and no API access. It reports what the reviewer points at
// to the review UI through postMessage, and draws the note marks it is told
// to draw. It never changes the saved file and never talks to the network.
// A control the author marked with data-vivamark-suggest proposes a note when
// the reviewer changes it; the review UI only queues it, never sends it.
// Every mark is drawn from the review page's theme tokens (mark-tokens.ts);
// until they arrive, in plain ink. The theme's page tokens (page-tokens.ts)
// are offered to the page itself as custom properties on :root, from the
// first paint; a page that never reads them is untouched.

import { MARK_TOKENS } from './mark-tokens.js';
import { PAGE_FACES, PAGE_THEMES, PAGE_TOKENS } from './page-tokens.js';

(() => {
  const script = document.currentScript as HTMLScriptElement | null;
  if (!script || window.parent === window) return;
  const load = script.dataset.vivamarkLoad ?? '';
  const parentOrigin = new URL(script.src).origin;
  const LAYER_ID = '__vivamark_layer';

  type Anchor = {
    stable_id: string | null;
    selector: string | null;
    tag?: string;
    text?: string;
    quote?: string;
    prefix?: string;
    suffix?: string;
    cell?: { row?: string; column?: string };
    control?: { role: string; name: string };
    point?: { x: number; y: number; width: number; height: number };
  };
  /**
   * A note to draw. `agent` marks a note from the agent or a tool (F7), drawn
   * in its own colour and line. `state` is the note's: queued, agent, or the
   * status of a sent note (open, addressed, question...).
   */
  type Mark = { n: number | string; kind: 'element' | 'text' | 'page'; anchor: Anchor | null; queued: boolean; agent?: boolean; state?: string };

  const post = (msg: Record<string, unknown>) => window.parent.postMessage({ vivamark: 1, load, ...msg }, parentOrigin);

  // ---- page tokens ----------------------------------------------------------------

  /**
   * The --vivamark-* custom properties, in a stylesheet of our own adopted by
   * the document: nothing is added to the page's markup, and they do nothing
   * until the page's own CSS uses them. Set through the CSSOM, never as text.
   */
  let pageSheet: CSSStyleSheet | null = null;
  function pageStyle(): CSSStyleDeclaration {
    try {
      if (!pageSheet) {
        pageSheet = new CSSStyleSheet();
        pageSheet.replaceSync(':root{}');
      }
      // A page script may have replaced the list; ours goes back at the end.
      if (!document.adoptedStyleSheets.includes(pageSheet)) document.adoptedStyleSheets = [...document.adoptedStyleSheets, pageSheet];
      return (pageSheet.cssRules[0] as CSSStyleRule).style;
    } catch {
      // No constructable stylesheets: the root element's own style instead.
      return document.documentElement.style;
    }
  }

  function setPageTokens(given: unknown): void {
    if (!given || typeof given !== 'object') return;
    const values = given as Record<string, unknown>;
    const style = pageStyle();
    for (const name of PAGE_TOKENS) {
      const v = values[name];
      if (typeof v === 'string' && v.trim() && v.length <= 200) style.setProperty(name, v.trim());
      else style.removeProperty(name);
    }
  }

  /** The bundled faces, under names of their own, from the daemon; each loads only if the page uses it. */
  try {
    for (const f of PAGE_FACES) {
      const url = new URL(`/_vivamark/fonts/${f.file}`, script.src).href;
      document.fonts.add(new FontFace(f.family, `url("${url}") format("woff2")`, { weight: f.weight, display: 'block' }));
    }
  } catch {
    // No font loading API: the font tokens fall back to their system faces.
  }
  // The theme the review page is in when it loads us: in place before the page's body is parsed.
  const startTheme = script.dataset.vivamarkTheme ?? '';
  if (Object.prototype.hasOwnProperty.call(PAGE_THEMES, startTheme)) setPageTokens(PAGE_THEMES[startTheme]);

  // ---- anchors ----------------------------------------------------------------

  const stableId = (el: Element): string | null => el.id || el.getAttribute('data-vivamark-id') || null;

  function uniqueId(el: Element): boolean {
    if (!el.id) return false;
    try {
      return document.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1;
    } catch {
      return false;
    }
  }

  /** `#nearest-id > tag:nth-of-type(n) > …`, or from `body`. The server maps the same shape to a source line. */
  function cssPath(el: Element): string {
    const steps: string[] = [];
    let cur: Element | null = el;
    while (cur && cur !== document.documentElement) {
      if (uniqueId(cur)) {
        steps.unshift(`#${CSS.escape(cur.id)}`);
        break;
      }
      if (cur === document.body) {
        steps.unshift('body');
        break;
      }
      const tag = cur.localName;
      let nth = 1;
      for (let sib = cur.previousElementSibling; sib; sib = sib.previousElementSibling) if (sib.localName === tag) nth++;
      steps.unshift(`${tag}:nth-of-type(${nth})`);
      cur = cur.parentElement;
    }
    return steps.join(' > ');
  }

  const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

  const clipText = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  const textOf = (el: Element | null | undefined) => squash((el as HTMLElement | null)?.innerText ?? el?.textContent ?? '');

  /**
   * A table cell named by its row's first cell and its column's header, as
   * an agent would grep for them. Omitted when any cell of the table spans
   * rows or columns: the header above a cell is then a guess.
   */
  function cellName(el: Element): Anchor['cell'] {
    const cell = el.closest('td, th') as HTMLTableCellElement | null;
    const table = cell?.closest('table');
    if (!cell || !table) return undefined;
    for (const c of table.querySelectorAll<HTMLTableCellElement>('td, th')) {
      if (c.closest('table') === table && (c.rowSpan > 1 || c.colSpan > 1)) return undefined;
    }
    const row = cell.parentElement as HTMLTableRowElement;
    const rows = [...table.rows];
    const first = rows[0];
    const header = table.tHead?.rows[table.tHead.rows.length - 1] ?? (first && [...first.cells].every((c) => c.localName === 'th') ? first : undefined);
    const out: { row?: string; column?: string } = {};
    const column = header ? textOf(header.cells[cell.cellIndex]) : '';
    if (column) out.column = clipText(column, 120);
    if (row !== header) {
      const name = textOf(row.cells[0]);
      if (name) out.row = clipText(name, 120);
    }
    return out.row || out.column ? out : undefined;
  }

  const CONTROLS =
    'button, a[href], input, select, textarea, summary, [role="button"], [role="link"], [role="checkbox"], [role="radio"], ' +
    '[role="switch"], [role="tab"], [role="menuitem"], [role="combobox"], [role="slider"], [role="textbox"], [role="option"]';

  function implicitRole(el: Element): string {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit.split(/\s+/)[0];
    switch (el.localName) {
      case 'a':
        return 'link';
      case 'select':
        return (el as HTMLSelectElement).multiple ? 'listbox' : 'combobox';
      case 'textarea':
        return 'textbox';
      case 'input': {
        const type = (el as HTMLInputElement).type;
        if (type === 'checkbox' || type === 'radio') return type;
        if (type === 'range') return 'slider';
        if (['button', 'submit', 'reset', 'image'].includes(type)) return 'button';
        return 'textbox';
      }
      default:
        return 'button';
    }
  }

  /** Text of a label without the control inside it (a wrapping label holds the select's options too). */
  function labelText(label: Element): string {
    const copy = label.cloneNode(true) as Element;
    for (const c of copy.querySelectorAll('input, select, textarea, button')) c.remove();
    return squash(copy.textContent ?? '');
  }

  /** The control's accessible name, by the usual precedence: labelledby, aria-label, label, alt or value, text, title, placeholder. */
  function accessibleName(el: Element): string {
    const ids = el.getAttribute('aria-labelledby');
    if (ids) {
      const t = squash(ids.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' '));
      if (t) return t;
    }
    const aria = squash(el.getAttribute('aria-label') ?? '');
    if (aria) return aria;
    const labels = (el as HTMLInputElement).labels;
    if (labels && labels.length) {
      const t = squash([...labels].map((l) => labelText(l)).join(' '));
      if (t) return t;
    }
    if (el.localName === 'input') {
      const input = el as HTMLInputElement;
      if (input.type === 'image' && input.alt) return squash(input.alt);
      if (['button', 'submit', 'reset'].includes(input.type) && input.value) return squash(input.value);
    }
    if (!['input', 'select', 'textarea'].includes(el.localName)) {
      const t = textOf(el) || squash([...el.querySelectorAll('img[alt]')].map((i) => i.getAttribute('alt') ?? '').join(' '));
      if (t) return t;
    }
    return squash(el.getAttribute('title') ?? el.getAttribute('placeholder') ?? '');
  }

  function controlName(el: Element): Anchor['control'] {
    const control = el.closest(CONTROLS);
    if (!control) return undefined;
    const name = accessibleName(control);
    return name ? { role: implicitRole(control), name: clipText(name, 200) } : undefined;
  }

  /** The image, canvas or outermost svg a click landed on, if any. */
  function graphicOf(el: Element): Element | null {
    if (el.localName === 'img' || el.localName === 'canvas') return el;
    let svg = el.closest('svg');
    while (svg?.parentElement?.closest('svg')) svg = svg.parentElement.closest('svg');
    return svg;
  }

  const round1 = (n: number) => Math.round(n * 10) / 10;

  /**
   * What a picked element is called. A click on an image, canvas or chart
   * names the graphic and the point within it, in CSS pixels of its box, so
   * the point scales to the viewBox or the image's natural size.
   */
  function elementAnchor(picked: Element, at?: { x: number; y: number }): Anchor {
    const graphic = at ? graphicOf(picked) : null;
    const el = graphic ?? picked;
    const text = textOf(el);
    const anchor: Anchor = { stable_id: stableId(el), selector: cssPath(el), tag: el.localName, text: clipText(text, 200) };
    const cell = cellName(el);
    if (cell) anchor.cell = cell;
    const control = controlName(el);
    if (control) anchor.control = control;
    if (graphic && at) {
      const r = graphic.getBoundingClientRect();
      anchor.point = {
        x: round1(Math.min(Math.max(at.x - r.left, 0), r.width)),
        y: round1(Math.min(Math.max(at.y - r.top, 0), r.height)),
        width: round1(r.width),
        height: round1(r.height),
      };
    }
    return anchor;
  }

  function textAnchor(range: Range): Anchor | null {
    const raw = range.toString();
    const quote = raw.trim();
    if (!quote) return null;
    let container: Node | null = range.commonAncestorContainer;
    if (container.nodeType !== Node.ELEMENT_NODE) container = container.parentElement;
    if (!container || !(container instanceof Element)) return null;
    const before = document.createRange();
    before.selectNodeContents(container);
    before.setEnd(range.startContainer, range.startOffset);
    const after = document.createRange();
    after.selectNodeContents(container);
    after.setStart(range.endContainer, range.endOffset);
    const lead = raw.slice(0, raw.length - raw.trimStart().length);
    const trail = raw.slice(raw.trimEnd().length);
    return {
      stable_id: stableId(container),
      selector: cssPath(container),
      quote,
      prefix: (before.toString() + lead).slice(-32),
      suffix: (trail + after.toString()).slice(0, 32),
    };
  }

  function resolveElement(a: Anchor): Element | null {
    if (a.stable_id) {
      const el = document.getElementById(a.stable_id) ?? document.querySelector(`[data-vivamark-id="${CSS.escape(a.stable_id)}"]`);
      if (el) return el;
    }
    if (a.selector) {
      try {
        return document.querySelector(a.selector);
      } catch {
        return null;
      }
    }
    return null;
  }

  /** Finds the quote under its container, preferring the occurrence that matches the prefix. */
  function resolveText(a: Anchor): Range | null {
    if (!a.quote) return null;
    const root = resolveElement(a);
    return (root && findText(root, a, a.quote)) || findText(document.body, a, a.quote);
  }

  function findText(root: Element, a: Anchor, quote: string): Range | null {
    const nodes: Text[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
    const full = nodes.map((n) => n.data).join('');
    let at = a.prefix ? full.indexOf(a.prefix + quote) : -1;
    at = at >= 0 ? at + (a.prefix ?? '').length : full.indexOf(quote);
    if (at < 0) return null;
    return rangeAt(nodes, at, at + quote.length);
  }

  /** A DOM range over [at, end) of the joined text of `nodes`. */
  function rangeAt(nodes: Text[], at: number, end: number): Range | null {
    const range = document.createRange();
    let pos = 0;
    let startSet = false;
    for (const n of nodes) {
      const next = pos + n.data.length;
      if (!startSet && at < next) {
        range.setStart(n, at - pos);
        startSet = true;
      }
      if (startSet && end <= next) {
        range.setEnd(n, end - pos);
        return range;
      }
      pos = next;
    }
    return null;
  }

  // ---- drawing ------------------------------------------------------------------

  /** Plain ink until the review page sends its theme. */
  const INK: Record<string, string> = {
    '--mk-font': '600 12px/1 ui-sans-serif, system-ui, sans-serif',
    '--mk-pin-bg': '#111111',
    '--mk-pin-fg': '#ffffff',
    '--mk-pin-border': '0 solid transparent',
    '--mk-pin-radius': '999px',
    '--mk-pin-shadow': 'none',
    '--mk-pin-queued-bg': '#ffffff',
    '--mk-pin-queued-fg': '#111111',
    '--mk-pin-queued-border': '1.5px dashed #111111',
    '--mk-pin-agent-bg': '#ffffff',
    '--mk-pin-agent-fg': '#111111',
    '--mk-pin-agent-border': '1.5px dotted #111111',
    '--mk-pin-done-bg': '#111111',
    '--mk-pin-done-fg': '#ffffff',
    '--mk-pin-done-border': '0 solid transparent',
    '--mk-pin-ask-bg': '#111111',
    '--mk-pin-ask-fg': '#ffffff',
    '--mk-pin-ask-border': '0 solid transparent',
    '--mk-target-line': '2px solid #111111',
    '--mk-target-line-queued': '2px dashed #111111',
    '--mk-target-line-agent': '2px dotted #111111',
    '--mk-target-offset': '2px',
    '--mk-target-radius': '4px',
    '--mk-target-bg': 'transparent',
    '--mk-target-bg-agent': 'transparent',
    '--mk-target-shadow': 'none',
    '--mk-text-bg': 'rgba(0,0,0,.12)',
    '--mk-text-bg-agent': 'rgba(0,0,0,.08)',
    '--mk-text-line': 'inset 0 -2px 0 #111111',
    '--mk-hover-line': '2px solid #111111',
    '--mk-hover-bg': 'rgba(0,0,0,.05)',
    '--mk-insert-bg': 'rgba(0,0,0,.08)',
    '--mk-insert-line': '2px solid #111111',
    '--mk-removal-fg': '#111111',
    '--mk-removal-bg': '#ffffff',
    '--mk-removal-border': '1px solid #111111',
  };
  let tokens: Record<string, string> = { ...INK };
  /** Theme rules beyond colour: words before a pin's number, and the state as the pin's shape. */
  let pinPrefix = '';
  let pinShapes = false;

  /** The theme's values, as custom properties on the layer: they reach every mark and nothing of the page. */
  function applyTokens(el: HTMLElement): void {
    for (const name of MARK_TOKENS) el.style.setProperty(name, tokens[name] ?? INK[name]);
  }

  function setTheme(d: { [k: string]: unknown }): void {
    const next: Record<string, string> = { ...INK };
    const given = d.tokens && typeof d.tokens === 'object' ? (d.tokens as Record<string, unknown>) : {};
    for (const name of MARK_TOKENS) {
      const v = given[name];
      if (typeof v === 'string' && v.trim() && v.length <= 400) next[name] = v.trim();
    }
    tokens = next;
    pinPrefix = typeof d.pinPrefix === 'string' ? d.pinPrefix.slice(0, 12) : '';
    pinShapes = d.pinShapes === true;
    const l = document.getElementById(LAYER_ID);
    if (l) applyTokens(l);
  }

  function layer(): HTMLElement {
    let el = document.getElementById(LAYER_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = LAYER_ID;
      el.setAttribute('aria-hidden', 'true');
      el.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;z-index:2147483647;';
      applyTokens(el);
      document.documentElement.appendChild(el);
    }
    return el;
  }

  function box(rect: DOMRect, css: string): HTMLElement {
    const d = document.createElement('div');
    d.style.cssText = `position:absolute;left:${rect.left + scrollX}px;top:${rect.top + scrollY}px;width:${rect.width}px;height:${rect.height}px;${css}`;
    return d;
  }

  /** Which of the theme's pin styles a note's state takes. */
  function pinStyle(m: Mark): string {
    if (m.agent) return 'agent';
    if (m.queued) return 'queued';
    if (m.state === 'addressed' || m.state === 'resolved') return 'done';
    if (m.state === 'question' || m.state === 'declined') return 'ask';
    return '';
  }

  /**
   * Bauhaus's shape code: a circle once the agent has addressed it, a
   * triangle when it asks you, a square while it is yours (dashed while
   * queued), a diamond for a note from the agent.
   */
  function pinShape(style: string): string {
    switch (style) {
      case 'done':
        return 'border-radius:50%;';
      case 'ask':
        return 'border-radius:0;border:0;clip-path:polygon(50% 0,100% 100%,0 100%);height:24px;min-width:26px;padding:6px 4px 0;line-height:18px;';
      case 'agent':
        return 'border-radius:2px;clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%);min-width:28px;height:28px;padding:0 4px;';
      default:
        return 'border-radius:0;';
    }
  }

  function badge(m: Mark, x: number, y: number): HTMLElement {
    const b = document.createElement('div');
    b.textContent = `${pinPrefix}${m.n}`;
    const style = pinStyle(m);
    const v = (part: string) => `var(--mk-pin${style ? `-${style}` : ''}-${part})`;
    b.dataset.vivamarkPin = style || 'sent';
    b.style.cssText =
      `position:absolute;left:${x + scrollX}px;top:${y + scrollY}px;min-width:22px;height:22px;padding:0 6px;box-sizing:border-box;` +
      `display:flex;align-items:center;justify-content:center;white-space:nowrap;font:var(--mk-font);text-align:center;` +
      `background:${v('bg')};color:${v('fg')};border:${v('border')};border-radius:var(--mk-pin-radius);box-shadow:var(--mk-pin-shadow);` +
      (pinShapes ? pinShape(style) : '');
    return b;
  }

  type Change = { at: number; text: string };
  let changes: { show: boolean; inserts: Change[]; removals: Change[] } = { show: false, inserts: [], removals: [] };

  /** The body's text nodes and the joined text, as the server computes it. */
  function bodyText(): { nodes: Text[]; full: string } {
    const nodes: Text[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
    return { nodes, full: nodes.map((n) => n.data).join('') };
  }

  /** Inserted text highlighted; removed text shown struck through where it was. Nothing in the page is changed. */
  function drawChanges(l: HTMLElement): void {
    if (!changes.show || !document.body) return;
    const { nodes, full } = bodyText();
    for (const c of changes.inserts) {
      // A page script may have changed the text since: only draw what still lines up.
      if (full.slice(c.at, c.at + c.text.length) !== c.text) continue;
      const r = rangeAt(nodes, c.at, c.at + c.text.length);
      if (!r) continue;
      for (const rect of r.getClientRects()) {
        const d = box(rect, 'background:var(--mk-insert-bg);border-bottom:var(--mk-insert-line);border-radius:2px;');
        d.dataset.vivamarkChange = 'insert';
        l.appendChild(d);
      }
    }
    for (const c of changes.removals) {
      if (c.at > full.length) continue;
      const r = rangeAt(nodes, c.at, c.at);
      const rect = r?.getBoundingClientRect();
      if (!rect) continue;
      const text = c.text.replace(/\s+/g, ' ').trim();
      const chip = document.createElement('div');
      chip.dataset.vivamarkChange = 'removal';
      chip.textContent = text.length > 60 ? text.slice(0, 59) + '…' : text;
      chip.style.cssText =
        `position:absolute;left:${rect.left + scrollX}px;top:${rect.top + scrollY - 20}px;max-width:320px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;` +
        'padding:1px 6px;border-radius:6px;font:var(--mk-font);line-height:18px;font-weight:400;color:var(--mk-removal-fg);background:var(--mk-removal-bg);' +
        'border:var(--mk-removal-border);text-decoration:line-through;';
      l.appendChild(chip);
    }
  }

  let marks: Mark[] = [];
  /** Off when the reviewer hides the note marks: the notes stay, only their drawing goes. */
  let showMarks = true;
  let hoverEl: Element | null = null;
  let picking = false;

  function draw(): void {
    const l = layer();
    l.replaceChildren();
    drawChanges(l);
    for (const m of showMarks ? marks : []) {
      if (!m.anchor) continue;
      const line = m.agent ? 'var(--mk-target-line-agent)' : m.queued ? 'var(--mk-target-line-queued)' : 'var(--mk-target-line)';
      if (m.kind === 'element') {
        const found = resolveElement(m.anchor);
        if (!found) continue;
        // A radio or checkbox is drawn around its label, so the mark does not cover the text.
        const el = found instanceof HTMLInputElement && (found.type === 'radio' || found.type === 'checkbox') ? (found.labels?.[0] ?? found) : found;
        const r = el.getBoundingClientRect();
        l.appendChild(
          box(
            r,
            `outline:${line};outline-offset:var(--mk-target-offset);border-radius:var(--mk-target-radius);box-shadow:var(--mk-target-shadow);` +
              `background:${m.agent ? 'var(--mk-target-bg-agent)' : 'var(--mk-target-bg)'};`,
          ),
        );
        l.appendChild(badge(m, r.right + 8, r.top + r.height / 2 - 11));
      } else if (m.kind === 'text') {
        const range = resolveText(m.anchor);
        if (!range) continue;
        const rects = [...range.getClientRects()];
        for (const r of rects) l.appendChild(box(r, `background:${m.agent ? 'var(--mk-text-bg-agent)' : 'var(--mk-text-bg)'};box-shadow:var(--mk-text-line);border-radius:3px;`));
        const last = rects[rects.length - 1];
        if (last) l.appendChild(badge(m, last.right + 6, last.top + last.height / 2 - 11));
      }
    }
    if (picking && hoverEl) {
      l.appendChild(box(hoverEl.getBoundingClientRect(), 'outline:var(--mk-hover-line);outline-offset:2px;border-radius:var(--mk-target-radius);background:var(--mk-hover-bg);'));
    }
    if (canvas) postGeometry();
  }

  // ---- canvas (Pinboard) ----------------------------------------------------------
  //
  // In Pinboard the review page shows this page whole, as a sheet on a
  // zoomable table, with the notes pinned beside it. It then needs to know
  // how tall the page is and where each noted place is, in page pixels; this
  // reports them, along with the place the note being written points at
  // (`probe`). Positions only: no text of the page leaves it this way.

  type Box = { x: number; y: number; w: number; h: number };
  let canvas = false;
  let probe: { kind?: unknown; anchor?: Anchor } | null = null;
  let lastGeometry = '';

  function placeOf(kind: unknown, anchor: Anchor | null | undefined): Box | null {
    if (!anchor) return null;
    let r: DOMRect | undefined;
    if (kind === 'element') {
      const found = resolveElement(anchor);
      const el = found instanceof HTMLInputElement && (found.type === 'radio' || found.type === 'checkbox') ? (found.labels?.[0] ?? found) : found;
      r = el?.getBoundingClientRect();
    } else if (kind === 'text') {
      r = resolveText(anchor)?.getBoundingClientRect();
    }
    if (!r || (!r.width && !r.height)) return null;
    const round = (n: number) => Math.round(n);
    return { x: round(r.left + scrollX), y: round(r.top + scrollY), w: round(r.width), h: round(r.height) };
  }

  function postGeometry(): void {
    const root = document.documentElement;
    const height = Math.max(root.scrollHeight, document.body?.scrollHeight ?? 0);
    const width = Math.max(root.scrollWidth, document.body?.scrollWidth ?? 0);
    const places = marks.flatMap((m) => {
      const b = placeOf(m.kind, m.anchor);
      return b ? [{ n: String(m.n), ...b }] : [];
    });
    const msg = { type: 'geometry', width, height, marks: places, probe: probe ? placeOf(probe.kind, probe.anchor) : null };
    const json = JSON.stringify(msg);
    if (json === lastGeometry) return;
    lastGeometry = json;
    post(msg);
  }

  // The wheel pans and zooms the table, not this page, which is shown whole.
  window.addEventListener(
    'wheel',
    (e) => {
      if (!canvas) return;
      e.preventDefault();
      post({ type: 'wheel', dx: e.deltaX, dy: e.deltaY, mode: e.deltaMode, zoom: e.ctrlKey || e.metaKey, x: e.clientX, y: e.clientY });
    },
    { passive: false },
  );

  // A double-click on the sheet starts a note on what was clicked.
  window.addEventListener(
    'dblclick',
    (e) => {
      if (!canvas || picking || isField(e.target)) return;
      const el = pickTarget(e.target);
      if (!el) return;
      document.getSelection()?.removeAllRanges();
      post({ type: 'pick', kind: 'element', anchor: elementAnchor(el, { x: e.clientX, y: e.clientY }) });
    },
    true,
  );

  let drawQueued = false;
  function redraw(): void {
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(() => {
      drawQueued = false;
      draw();
    });
  }

  // ---- input ----------------------------------------------------------------------

  const isOurs = (t: EventTarget | null) => t instanceof Element && !!t.closest(`#${LAYER_ID}`);

  function pickTarget(t: EventTarget | null): Element | null {
    let el = t instanceof Element ? t : t instanceof Node ? t.parentElement : null;
    if (!el || isOurs(el) || el === document.documentElement) return null;
    // A decision's own-words field is vivamark's, not the page's: pointing at it points at the decision.
    if (isField(el)) {
      const g = [...groups].find(([, s]) => s.host === el)?.[0];
      return g ? decisionTarget(g) : null;
    }
    return el;
  }

  for (const type of ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick', 'auxclick']) {
    window.addEventListener(
      type,
      (e) => {
        if (!picking) return;
        e.preventDefault();
        e.stopImmediatePropagation();
      },
      true,
    );
  }

  window.addEventListener(
    'click',
    (e) => {
      if (!picking) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const el = pickTarget(e.target);
      if (!el) return;
      picking = false;
      hoverEl = null;
      document.documentElement.style.cursor = '';
      redraw();
      post({ type: 'pick', kind: 'element', anchor: elementAnchor(el, { x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY }) });
    },
    true,
  );

  window.addEventListener(
    'mouseover',
    (e) => {
      if (!picking) return;
      hoverEl = pickTarget(e.target);
      redraw();
    },
    true,
  );

  function reportSelection(): void {
    if (picking) return;
    const sel = document.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    const anchor = textAnchor(sel.getRangeAt(0));
    if (anchor) post({ type: 'pick', kind: 'text', anchor });
  }
  document.addEventListener('mouseup', (e) => {
    // Selecting words in a decision's field is not pointing at the page.
    if (isField(e.target)) return;
    setTimeout(reportSelection, 0);
  });
  document.addEventListener('keyup', (e) => {
    if (e.shiftKey || e.key === 'Shift') reportSelection();
    if (e.key === 'Escape' && picking) {
      picking = false;
      hoverEl = null;
      document.documentElement.style.cursor = '';
      redraw();
      post({ type: 'pick-cancelled' });
    }
  });

  // ---- own words on a decision ------------------------------------------------------
  //
  // Every decision group (a role=radiogroup holding radios marked
  // data-vivamark-suggest) gets a text field after it, so the reviewer can say
  // what no option covers. It lives in a shadow root on a <vivamark-field>
  // element: the page's CSS does not reach it, its text is not part of the
  // page's text (what changed, quotes), and no element of the page changes its
  // place among siblings of its own tag (selectors). Its words join the
  // group's proposed note, with the option picked or without one; like a
  // click, they are only queued.

  type Group = { host: HTMLElement; field: HTMLTextAreaElement; picked: HTMLInputElement | null };
  const groups = new Map<Element, Group>();
  const FIELD_TAG = 'vivamark-field';
  const MAX_WORDS = 4000;
  let fieldsReadOnly = false;

  const isDecisionGroup = (el: Element) => !!el.querySelector('input[type="radio"][data-vivamark-suggest]');
  const groupOf = (el: Element): Element | null => {
    const g = el.closest('[role="radiogroup"]');
    return g && groups.has(g) ? g : null;
  };
  const groupKey = (g: Element) => `group:${cssPath(g)}`;

  /**
   * What a note on the decision as a whole points at: the group, or the
   * nearest element around it with an id that holds no other decision (the
   * .your-input card), so the agent reads the decision from stable_id.
   */
  function decisionTarget(g: Element): Element {
    const others = [...document.querySelectorAll('[role="radiogroup"]')].filter((o) => o !== g && isDecisionGroup(o));
    for (let el: Element | null = g; el && el !== document.body; el = el.parentElement) {
      if (el !== g && others.some((o) => el!.contains(o))) break;
      if (stableId(el)) return el;
    }
    return g;
  }

  /** The decision's name: the group's own label, else the heading of the card around it. */
  function decisionName(g: Element): string {
    const ids = g.getAttribute('aria-labelledby');
    const labelled = ids ? squash(ids.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ')) : '';
    const own = labelled || squash(g.getAttribute('aria-label') ?? '');
    if (own) return clipText(own, 300);
    const card = decisionTarget(g);
    const heading = (card === g ? g.parentElement : card)?.querySelector('h1, h2, h3, h4, h5, h6, legend');
    return clipText(textOf(heading), 300);
  }

  /** The group's proposed note, as it stands: the option picked (if any) and the reviewer's words. */
  function postGroup(g: Element): void {
    const s = groups.get(g);
    if (!s) return;
    const words = s.field.value.trim().slice(0, MAX_WORDS);
    const picked = s.picked?.checked && s.picked.isConnected && g.contains(s.picked) ? s.picked : null;
    const key = groupKey(g);
    if (!picked && !words) {
      post({ type: 'suggest', key, remove: true });
      return;
    }
    const target = picked ?? decisionTarget(g);
    const label = picked ? clipText(accessibleName(picked) || picked.value, 300) : '';
    const decision = { name: decisionName(g), id: stableId(decisionTarget(g)) };
    post({
      type: 'suggest',
      key,
      kind: 'element',
      anchor: elementAnchor(target),
      text: label,
      ...(words ? { words, decision } : {}),
    });
  }

  const FIELD_CSS = `
    :host { display: block; margin: .75em 0 0; }
    label { display: block; margin: 0 0 .3em; font-size: .85em; opacity: .75; }
    textarea { display: block; box-sizing: border-box; width: 100%; min-height: 3.4em; margin: 0; padding: .5em .65em;
      resize: vertical; font: inherit; font-size: .95em; line-height: 1.4; color: inherit; background: transparent;
      border: 1px solid color-mix(in srgb, currentColor 32%, transparent); border-radius: 8px; }
    textarea::placeholder { color: inherit; opacity: .55; }
    textarea:focus { outline: 2px solid color-mix(in srgb, currentColor 45%, transparent); outline-offset: 1px; }
    textarea:disabled { opacity: .55; }
  `;

  let fieldCount = 0;
  function addField(g: Element): void {
    const host = document.createElement(FIELD_TAG);
    host.style.cssText = 'display:block;margin:.75em 0 0;';
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = FIELD_CSS;
    const id = `f${++fieldCount}`;
    const label = document.createElement('label');
    label.htmlFor = id;
    label.textContent = 'Your own words (optional)';
    const field = document.createElement('textarea');
    field.id = id;
    field.rows = 2;
    field.maxLength = MAX_WORDS;
    field.placeholder = 'Anything the options do not cover. Sent with your choice, or on its own.';
    const name = decisionName(g);
    field.setAttribute('aria-label', name ? `Your own words on: ${name}` : 'Your own words on this decision');
    field.disabled = fieldsReadOnly;
    root.append(style, label, field);
    // Typing here is the reviewer's, not the page's: keys do not reach the page's own shortcuts.
    for (const type of ['keydown', 'keyup', 'keypress']) host.addEventListener(type, (e) => e.stopPropagation());
    field.addEventListener('input', (e) => {
      if (e.isTrusted) postGroup(g);
    });
    g.after(host);
    groups.set(g, { host, field, picked: null });
  }

  /** Gives every decision group its field, once; again if the page's own script replaced it. */
  function scanGroups(): void {
    for (const g of [...groups.keys()]) if (!g.isConnected) groups.delete(g);
    for (const g of document.querySelectorAll('[role="radiogroup"]')) {
      if (!isDecisionGroup(g)) continue;
      const s = groups.get(g);
      if (s && s.host.isConnected) continue;
      if (s) groups.delete(g);
      addField(g);
    }
  }

  const isField = (t: EventTarget | null) => t instanceof Element && t.localName === FIELD_TAG;
  /** A field the chrome's queue says has words, or an option, from before this load (a live reload). */
  type FieldState = { key: string; text: string; option: Anchor | null };
  function restoreFields(list: FieldState[], readOnly: boolean): void {
    fieldsReadOnly = readOnly;
    const byKey = new Map(list.map((f) => [f.key, f]));
    for (const [g, s] of groups) {
      s.field.disabled = readOnly;
      const f = byKey.get(groupKey(g));
      // The reviewer is typing here: the queue is catching up, not ahead.
      if (document.hasFocus() && (s.field.getRootNode() as ShadowRoot).activeElement === s.field) continue;
      const text = f?.text ?? '';
      if (s.field.value !== text) s.field.value = text;
      if (f?.option && !s.picked?.checked) {
        // The reviewer's own choice, from before the page reloaded: shown ticked again.
        const radio = resolveElement(f.option);
        if (radio instanceof HTMLInputElement && radio.type === 'radio' && radio.hasAttribute('data-vivamark-suggest') && g.contains(radio)) {
          radio.checked = true;
          s.picked = radio;
        }
      }
    }
  }

  /**
   * The reviewer ticked a radio or checkbox, or chose an option, that the
   * author marked with data-vivamark-suggest (its value is ignored). It becomes a proposed
   * note: one per radio group, checkbox or select (`key`), so a new choice
   * replaces the old one, and unticking a checkbox withdraws it. Only a real
   * change by the reviewer counts: a script's dispatchEvent is not trusted.
   */
  document.addEventListener(
    'change',
    (e) => {
      if (!e.isTrusted) return;
      const t = e.target;
      if (t instanceof HTMLInputElement && (t.type === 'radio' || t.type === 'checkbox')) {
        if (!t.hasAttribute('data-vivamark-suggest')) return;
        const g = t.type === 'radio' ? groupOf(t) : null;
        if (g) {
          // A decision with a field: the choice and the reviewer's words are one note.
          if (t.checked) groups.get(g)!.picked = t;
          postGroup(g);
          return;
        }
        const key = t.type === 'radio' && t.name ? `radio:${t.form ? cssPath(t.form) + ' ' : ''}${t.name}` : `${t.type}:${cssPath(t)}`;
        if (!t.checked) {
          // A radio is unticked only by ticking another one, which sends its own suggestion.
          if (t.type === 'checkbox') post({ type: 'suggest', key, remove: true });
          return;
        }
        const label = accessibleName(t) || t.value;
        post({ type: 'suggest', key, kind: 'element', anchor: elementAnchor(t), text: clipText(label, 300) });
      } else if (t instanceof HTMLSelectElement) {
        const opt = t.selectedOptions[0];
        const marked = opt?.hasAttribute('data-vivamark-suggest') ? opt : t.hasAttribute('data-vivamark-suggest') ? t : null;
        const key = `select:${cssPath(t)}`;
        if (!opt || !marked) {
          // A choice the author did not mark withdraws an earlier suggestion from this select.
          post({ type: 'suggest', key, remove: true });
          return;
        }
        const name = accessibleName(t);
        const choice = squash(opt.label || opt.text || opt.value);
        const anchor = elementAnchor(opt.id || opt.hasAttribute('data-vivamark-id') ? opt : t);
        post({ type: 'suggest', key, kind: 'element', anchor, text: clipText(name ? `${name}: ${choice}` : choice, 300) });
      }
    },
    true,
  );

  let scrollTimer = 0;
  window.addEventListener(
    'scroll',
    () => {
      clearTimeout(scrollTimer);
      scrollTimer = window.setTimeout(() => post({ type: 'scroll', x: scrollX, y: scrollY }), 120);
    },
    { passive: true },
  );
  window.addEventListener('resize', redraw);
  if ('ResizeObserver' in window)
    new ResizeObserver(() => {
      redraw();
      if (canvas) postGeometry();
    }).observe(document.documentElement);
  // A face arriving moves text without always changing the page's size (a body as tall as the
  // frame, say), which the observer above would miss: the marks and Pinboard's cards follow it.
  try {
    document.fonts.addEventListener('loadingdone', () => {
      redraw();
      if (canvas) postGeometry();
    });
  } catch {
    // No font loading API: nothing loads late to follow.
  }

  // ---- messages from the review UI ----------------------------------------------------

  window.addEventListener('message', (e) => {
    if (e.source !== window.parent || e.origin !== parentOrigin) return;
    const d = e.data as { vivamark?: number; type?: string; [k: string]: unknown };
    if (!d || d.vivamark !== 1) return;
    if (d.type === 'theme') {
      setTheme(d);
      setPageTokens(d.page);
      redraw();
      // A page that uses the page tokens may have moved: Pinboard's cards follow it.
      if (canvas) postGeometry();
    } else if (d.type === 'mode') {
      picking = !!d.pick;
      hoverEl = null;
      document.documentElement.style.cursor = picking ? 'crosshair' : '';
      redraw();
    } else if (d.type === 'marks') {
      marks = Array.isArray(d.marks) ? (d.marks as Mark[]) : [];
      showMarks = d.show !== false;
      redraw();
      if (canvas) postGeometry();
    } else if (d.type === 'changes') {
      const list = (v: unknown): Change[] =>
        Array.isArray(v) ? v.filter((c): c is Change => !!c && typeof c.at === 'number' && typeof c.text === 'string') : [];
      changes = { show: !!d.show, inserts: list(d.inserts), removals: list(d.removals) };
      redraw();
    } else if (d.type === 'restore') {
      window.scrollTo(Number(d.x) || 0, Number(d.y) || 0);
    } else if (d.type === 'canvas') {
      canvas = d.on === true;
      probe = d.probe && typeof d.probe === 'object' ? (d.probe as typeof probe) : null;
      lastGeometry = '';
      redraw();
      // Directly as well: a frame scrolled off screen gets no animation frames until it is back.
      if (canvas) postGeometry();
    } else if (d.type === 'fields') {
      const list = Array.isArray(d.fields)
        ? (d.fields as unknown[]).filter((f): f is FieldState => !!f && typeof (f as FieldState).key === 'string' && typeof (f as FieldState).text === 'string')
        : [];
      restoreFields(list, !!d.readOnly);
    }
  });

  const ready = () => {
    scanGroups();
    // A page script that draws its decisions later gets fields for them too.
    let scanQueued = false;
    new MutationObserver(() => {
      if (scanQueued) return;
      scanQueued = true;
      requestAnimationFrame(() => {
        scanQueued = false;
        scanGroups();
      });
    }).observe(document.body ?? document.documentElement, { childList: true, subtree: true });
    post({ type: 'ready' });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
  else ready();
  window.addEventListener('load', redraw);
})();
