// Runs inside the reviewed page, in a sandboxed frame with an opaque origin.
// It has no token and no API access. It reports what the reviewer points at
// to the review UI through postMessage, and draws the note marks it is told
// to draw. It never changes the saved file and never talks to the network.

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
  /** A note to draw. `agent` marks a note from the agent or a tool (F7), drawn in its own colour. */
  type Mark = { n: number | string; kind: 'element' | 'text' | 'page'; anchor: Anchor | null; queued: boolean; agent?: boolean };

  const post = (msg: Record<string, unknown>) => window.parent.postMessage({ vivamark: 1, load, ...msg }, parentOrigin);

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

  function layer(): HTMLElement {
    let el = document.getElementById(LAYER_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = LAYER_ID;
      el.setAttribute('aria-hidden', 'true');
      el.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;z-index:2147483647;';
      document.documentElement.appendChild(el);
    }
    return el;
  }

  function box(rect: DOMRect, css: string): HTMLElement {
    const d = document.createElement('div');
    d.style.cssText = `position:absolute;left:${rect.left + scrollX}px;top:${rect.top + scrollY}px;width:${rect.width}px;height:${rect.height}px;${css}`;
    return d;
  }

  function badge(n: number | string, x: number, y: number, queued: boolean, agent = false): HTMLElement {
    const b = document.createElement('div');
    b.textContent = String(n);
    b.style.cssText =
      `position:absolute;left:${x + scrollX}px;top:${y + scrollY}px;min-width:22px;height:22px;padding:0 6px;box-sizing:border-box;` +
      `border-radius:999px;font:600 12px/22px Inter,ui-sans-serif,system-ui,sans-serif;text-align:center;` +
      (agent
        ? 'background:#f5f3ff;color:#6d28d9;border:1.5px solid #8b5cf6;line-height:19px;'
        : queued
          ? 'background:#fff;color:#0369a1;border:1.5px solid #0ea5e9;line-height:19px;'
          : 'background:#0ea5e9;color:#fff;') +
      'box-shadow:0 2px 8px rgba(14,60,120,.18);';
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
        const d = box(rect, 'background:rgba(16,185,129,.2);border-bottom:2px solid rgba(16,185,129,.7);border-radius:2px;');
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
        'padding:1px 6px;border-radius:6px;font:12px/18px Inter,ui-sans-serif,system-ui,sans-serif;color:#be123c;background:rgba(255,241,242,.95);' +
        'border:1px solid rgba(244,63,94,.35);text-decoration:line-through;box-shadow:0 2px 6px rgba(14,60,120,.1);';
      l.appendChild(chip);
    }
  }

  let marks: Mark[] = [];
  let hoverEl: Element | null = null;
  let picking = false;

  function draw(): void {
    const l = layer();
    l.replaceChildren();
    drawChanges(l);
    for (const m of marks) {
      if (!m.anchor) continue;
      const accent = m.agent ? 'rgba(139,92,246,.7)' : m.queued ? 'rgba(14,165,233,.55)' : '#0ea5e9';
      const line = m.agent ? 'dotted' : m.queued ? 'dashed' : 'solid';
      if (m.kind === 'element') {
        const el = resolveElement(m.anchor);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        l.appendChild(box(r, `outline:2px ${line} ${accent};outline-offset:2px;border-radius:8px;background:${m.agent ? 'rgba(139,92,246,.05)' : 'rgba(14,165,233,.06)'};`));
        l.appendChild(badge(m.n, r.right + 8, r.top + r.height / 2 - 11, m.queued, m.agent));
      } else if (m.kind === 'text') {
        const range = resolveText(m.anchor);
        if (!range) continue;
        const rects = [...range.getClientRects()];
        for (const r of rects) l.appendChild(box(r, m.agent ? 'background:rgba(139,92,246,.16);border-radius:3px;' : 'background:rgba(250,204,21,.35);border-radius:3px;'));
        const last = rects[rects.length - 1];
        if (last) l.appendChild(badge(m.n, last.right + 6, last.top + last.height / 2 - 11, m.queued, m.agent));
      }
    }
    if (picking && hoverEl) {
      l.appendChild(box(hoverEl.getBoundingClientRect(), 'outline:2px solid #0ea5e9;outline-offset:2px;border-radius:8px;background:rgba(14,165,233,.08);'));
    }
  }

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
    if (el === document.body) return el;
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
  document.addEventListener('mouseup', () => setTimeout(reportSelection, 0));
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
  if ('ResizeObserver' in window) new ResizeObserver(redraw).observe(document.documentElement);

  // ---- messages from the review UI ----------------------------------------------------

  window.addEventListener('message', (e) => {
    if (e.source !== window.parent || e.origin !== parentOrigin) return;
    const d = e.data as { vivamark?: number; type?: string; [k: string]: unknown };
    if (!d || d.vivamark !== 1) return;
    if (d.type === 'mode') {
      picking = !!d.pick;
      hoverEl = null;
      document.documentElement.style.cursor = picking ? 'crosshair' : '';
      redraw();
    } else if (d.type === 'marks') {
      marks = Array.isArray(d.marks) ? (d.marks as Mark[]) : [];
      redraw();
    } else if (d.type === 'changes') {
      const list = (v: unknown): Change[] =>
        Array.isArray(v) ? v.filter((c): c is Change => !!c && typeof c.at === 'number' && typeof c.text === 'string') : [];
      changes = { show: !!d.show, inserts: list(d.inserts), removals: list(d.removals) };
      redraw();
    } else if (d.type === 'restore') {
      window.scrollTo(Number(d.x) || 0, Number(d.y) || 0);
    }
  });

  const ready = () => post({ type: 'ready' });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
  else ready();
  window.addEventListener('load', redraw);
})();
