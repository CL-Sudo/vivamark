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
  };
  type Mark = { n: number; kind: 'element' | 'text' | 'page'; anchor: Anchor | null; queued: boolean };

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

  function elementAnchor(el: Element): Anchor {
    const text = squash((el as HTMLElement).innerText ?? el.textContent ?? '');
    return { stable_id: stableId(el), selector: cssPath(el), tag: el.localName, text: text.length > 200 ? text.slice(0, 199) + '…' : text };
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
    const root = resolveElement(a) ?? document.body;
    if (!a.quote) return null;
    const nodes: Text[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
    const full = nodes.map((n) => n.data).join('');
    let at = a.prefix ? full.indexOf(a.prefix + a.quote) : -1;
    at = at >= 0 ? at + (a.prefix ?? '').length : full.indexOf(a.quote);
    if (at < 0) return null;
    const range = document.createRange();
    let pos = 0;
    let startSet = false;
    const end = at + a.quote.length;
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

  function badge(n: number, x: number, y: number, queued: boolean): HTMLElement {
    const b = document.createElement('div');
    b.textContent = String(n);
    b.style.cssText =
      `position:absolute;left:${x + scrollX}px;top:${y + scrollY}px;min-width:22px;height:22px;padding:0 6px;box-sizing:border-box;` +
      `border-radius:999px;font:600 12px/22px Inter,ui-sans-serif,system-ui,sans-serif;text-align:center;` +
      (queued ? 'background:#fff;color:#0369a1;border:1.5px solid #0ea5e9;line-height:19px;' : 'background:#0ea5e9;color:#fff;') +
      'box-shadow:0 2px 8px rgba(14,60,120,.18);';
    return b;
  }

  let marks: Mark[] = [];
  let hoverEl: Element | null = null;
  let picking = false;

  function draw(): void {
    const l = layer();
    l.replaceChildren();
    for (const m of marks) {
      if (!m.anchor) continue;
      const accent = m.queued ? 'rgba(14,165,233,.55)' : '#0ea5e9';
      if (m.kind === 'element') {
        const el = resolveElement(m.anchor);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        l.appendChild(box(r, `outline:2px ${m.queued ? 'dashed' : 'solid'} ${accent};outline-offset:2px;border-radius:8px;background:rgba(14,165,233,.06);`));
        l.appendChild(badge(m.n, r.right + 8, r.top + r.height / 2 - 11, m.queued));
      } else if (m.kind === 'text') {
        const range = resolveText(m.anchor);
        if (!range) continue;
        const rects = [...range.getClientRects()];
        for (const r of rects) l.appendChild(box(r, 'background:rgba(250,204,21,.35);border-radius:3px;'));
        const last = rects[rects.length - 1];
        if (last) l.appendChild(badge(m.n, last.right + 6, last.top + last.height / 2 - 11, m.queued));
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
      post({ type: 'pick', kind: 'element', anchor: elementAnchor(el) });
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
    } else if (d.type === 'restore') {
      window.scrollTo(Number(d.x) || 0, Number(d.y) || 0);
    }
  });

  const ready = () => post({ type: 'ready' });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
  else ready();
  window.addEventListener('load', redraw);
})();
