// Pinboard's canvas: the agent's page as a sheet on a table, shown whole,
// with every note pinned beside its spot and a thread drawn to what it means.
// Scroll pans, Ctrl or ⌘ with the wheel (or a pinch) zooms, dragging the
// table pans, dragging a card by its head moves it aside, and a double-click
// on the sheet starts a note. A note whose card is off screen shows as a
// pill that takes you to it; the minimap shows where the notes are on a long
// page, and Fit snaps back to reading width.
//
// Presentation only: the cards are the same note cards the panel shows, so
// every button on them works as it does there. The sheet keeps its place in
// the document (moving an iframe would reload the page); it and the layer of
// cards get the same transform.

type Box = { x: number; y: number; w: number; h: number };
type Geometry = { width: number; height: number; marks: (Box & { n: string })[]; probe: Box | null };

export interface CanvasHost {
  stage: HTMLElement;
  sheet: HTMLElement;
  frame: HTMLIFrameElement;
  thread: HTMLElement;
  composer: HTMLElement;
  ended: HTMLElement;
  toFrame(msg: Record<string, unknown>): void;
  /** What the note being written points at, for the frame to place. */
  probe(): { kind: string; anchor: unknown } | null;
  marksShown(): boolean;
  /** Where the page was scrolled in the panel, to start the table there. */
  scrollY(): number;
}

export interface Canvas {
  layout(): void;
  /** A message from the frame; true when the canvas took it. */
  onMessage(d: Record<string, unknown>): boolean;
  /** The frame loaded again: tell it the canvas is on. */
  frameReady(): void;
  stop(): void;
}

const SHEET_W = 880;
const CARD_W = 300;
const GAP = 64;
const MAX_H = 40_000;
const SVG = 'http://www.w3.org/2000/svg';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(cls: string, text: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', cls, text);
  b.type = 'button';
  b.title = label;
  b.setAttribute('aria-label', label);
  b.addEventListener('click', onClick);
  return b;
}

export function startCanvas(host: CanvasHost): Canvas {
  const { stage, sheet, frame, thread, composer, ended } = host;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  // The panel's last three parts, put back there when the canvas stops.
  const side = thread.parentElement!;

  let s = 1;
  let tx = 24;
  let ty = 16;
  let docH = Math.max(600, stage.clientHeight);
  let geo: Geometry = { width: SHEET_W, height: docH, marks: [], probe: null };
  /** Cards the reviewer dragged aside, by note, in table coordinates. */
  const moved = new Map<string, { x: number; y: number }>();
  /** Where each card was last placed, for pills, the minimap and panning to it. */
  let placed: { key: string; card: HTMLElement; box: Box; target: Box | null; label: string }[] = [];

  stage.classList.add('pb-canvas');
  const world = el('div', 'pb-world');
  const wires = document.createElementNS(SVG, 'svg');
  wires.classList.add('pb-wires');
  wires.setAttribute('aria-hidden', 'true');
  const overlay = document.createElementNS(SVG, 'svg');
  overlay.classList.add('pb-overlay');
  overlay.setAttribute('aria-hidden', 'true');
  world.append(wires, thread);

  const zoomText = el('span', 'pb-zoom', '100%');
  zoomText.setAttribute('aria-live', 'polite');
  const toolbar = el('div', 'pb-toolbar');
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', 'Table');
  toolbar.append(
    button('pb-tool', '−', 'Zoom out', () => zoomAt(1 / 1.25)),
    zoomText,
    button('pb-tool', '+', 'Zoom in', () => zoomAt(1.25)),
    button('pb-tool pb-fit', 'Fit', 'Fit the page and its notes to the window, at reading width', () => fit(true)),
  );
  const pills = el('div', 'pb-pills');
  pills.setAttribute('aria-label', 'Notes off screen');
  const mini = el('div', 'pb-mini');
  mini.setAttribute('role', 'img');
  mini.setAttribute('aria-label', 'Map of the page and its notes; click to go there');
  const dock = el('div', 'pb-dock');
  dock.append(mini, ended, composer);
  stage.append(world, overlay, toolbar, pills, dock);

  function apply(animate = false): void {
    const t = `translate(${tx}px, ${ty}px) scale(${s})`;
    const anim = animate && !reduced.matches;
    for (const n of [world, sheet]) {
      n.classList.toggle('pb-anim', anim);
      n.style.transform = t;
    }
    zoomText.textContent = `${Math.round(s * 100)}%`;
    if (anim) setTimeout(() => decorate(), 260);
    decorate();
  }

  /** The visible part of the table, in table coordinates. */
  function view(): Box {
    return { x: -tx / s, y: -ty / s, w: stage.clientWidth / s, h: stage.clientHeight / s };
  }

  function zoomAt(f: number, px = stage.clientWidth / 2, py = stage.clientHeight / 2, animate = true): void {
    const next = Math.min(2, Math.max(0.2, s * f));
    tx = px - ((px - tx) * next) / s;
    ty = py - ((py - ty) * next) / s;
    s = next;
    apply(animate);
  }

  /** The table's width at reading size: the sheet and the column of cards (and the left column when it is used). */
  function span(): { left: number; right: number } {
    const left = placed.some((p) => p.box.x < 0) ? -(CARD_W + GAP) : 0;
    return { left, right: SHEET_W + GAP + CARD_W };
  }

  /** Fit snaps back to reading width, keeping the part of the page in view. */
  function fit(animate: boolean): void {
    const { left, right } = span();
    const top = -ty / s;
    // The dock keeps the right-hand corner: fit into the room beside it.
    const room = Math.max(320, stage.clientWidth - dock.offsetWidth - 36);
    s = Math.min(1, Math.max(0.2, (room - 24) / (right - left)));
    tx = 12 + (room - (right - left) * s) / 2 - left * s;
    ty = Math.min(16, -top * s);
    apply(animate);
  }

  function panTo(b: Box): void {
    const v = view();
    if (b.x < v.x || b.x + b.w > v.x + v.w) tx = stage.clientWidth / 2 - (b.x + b.w / 2) * s;
    ty = stage.clientHeight / 3 - b.y * s;
    apply(true);
  }

  function wheel(dx: number, dy: number, mode: number, zoom: boolean, px: number, py: number): void {
    const k = mode === 1 ? 16 : mode === 2 ? stage.clientHeight : 1;
    if (zoom) zoomAt(Math.exp((-dy * k) / 400), px, py, false);
    else {
      tx -= dx * k;
      ty -= dy * k;
      apply();
    }
  }

  // ---- placing the cards ----------------------------------------------------------

  /** Which note a card in the thread is, as the frame numbers its marks. */
  function keyOf(card: HTMLElement): string | null {
    if (card.dataset.agentId) return `A${Number(card.dataset.agentId.slice(2))}`;
    if (card.classList.contains('note') && card.dataset.n) return card.dataset.n;
    return null;
  }

  function layout(): void {
    sheet.style.width = `${SHEET_W}px`;
    sheet.style.height = `${docH}px`;
    const byN = new Map(geo.marks.map((m) => [m.n, m]));
    const cards = [...thread.children] as HTMLElement[];
    for (const c of cards) c.style.width = `${CARD_W}px`;
    const targeted: { key: string; card: HTMLElement; target: Box }[] = [];
    const loose: { key: string; card: HTMLElement }[] = [];
    cards.forEach((card, i) => {
      const key = keyOf(card) ?? `x${i}`;
      const target = byN.get(key);
      if (target) targeted.push({ key, card, target });
      else loose.push({ key, card });
    });
    targeted.sort((a, b) => a.target.y - b.target.y || a.target.x - b.target.x);
    placed = [];
    let bottom = -Infinity;
    for (const { key, card, target } of targeted) {
      const h = card.offsetHeight;
      const own = moved.get(key);
      const x = own?.x ?? SHEET_W + GAP;
      const y = own?.y ?? Math.max(target.y + target.h / 2 - 22, bottom + 14);
      if (!own) bottom = y + h;
      card.style.left = `${x}px`;
      card.style.top = `${y}px`;
      placed.push({ key, card, box: { x, y, w: CARD_W, h }, target, label: labelOf(card) });
    }
    // Notes on the whole page, replies to it, decisions and notes whose target is gone: a column left of the sheet.
    let y = 0;
    for (const { key, card } of loose) {
      const h = card.offsetHeight;
      const own = moved.get(key);
      const x = own?.x ?? -(CARD_W + GAP);
      const top = own?.y ?? y;
      if (!own) y += h + 14;
      card.style.left = `${x}px`;
      card.style.top = `${top}px`;
      placed.push({ key, card, box: { x, y: top, w: CARD_W, h }, target: null, label: labelOf(card) });
    }
    decorate();
  }

  function labelOf(card: HTMLElement): string {
    const num = card.querySelector('.num')?.textContent ?? '';
    const state = card.querySelector('.note-head .state')?.textContent ?? '';
    return [num, state].filter(Boolean).join(' · ');
  }

  /** Threads, the off-screen pills, the minimap and the composer's thread: everything that depends on the view. */
  function decorate(): void {
    const show = host.marksShown();
    wires.replaceChildren();
    for (const p of show ? placed : []) {
      if (!p.target) continue;
      const x1 = p.target.x + p.target.w;
      const y1 = p.target.y + Math.min(p.target.h / 2, 20);
      const toLeft = p.box.x > x1;
      const x2 = toLeft ? p.box.x : p.box.x + p.box.w;
      const y2 = p.box.y + 20;
      const mid = (x1 + x2) / 2;
      const path = document.createElementNS(SVG, 'path');
      path.setAttribute('d', `M${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`);
      path.setAttribute('vector-effect', 'non-scaling-stroke');
      wires.append(path);
    }
    // Pills for cards out of view.
    const v = view();
    const off = placed.filter((p) => p.target && (p.box.y + p.box.h < v.y || p.box.y > v.y + v.h || p.box.x > v.x + v.w || p.box.x + p.box.w < v.x));
    pills.replaceChildren(
      ...off.map((p) => {
        const dir = p.box.y + p.box.h < v.y ? 'above' : p.box.y > v.y + v.h ? 'further down' : 'beside';
        return button('pb-pill', `${p.label} · ${dir}`, `Go to note ${p.label}, ${dir}`, () => panTo(p.box));
      }),
    );
    pills.hidden = !off.length;
    drawMini(v);
    // The note being written: a thread from its target to the composer.
    overlay.replaceChildren();
    const probe = geo.probe;
    if (probe && show) {
      const sr = stage.getBoundingClientRect();
      const cr = composer.getBoundingClientRect();
      const x1 = tx + (probe.x + probe.w) * s;
      const y1 = ty + (probe.y + Math.min(probe.h / 2, 20)) * s;
      const x2 = cr.left - sr.left;
      const y2 = cr.top - sr.top + 20;
      if (x1 < x2 && y1 > -40 && y1 < stage.clientHeight + 40) {
        const mid = (x1 + x2) / 2;
        const path = document.createElementNS(SVG, 'path');
        path.setAttribute('d', `M${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`);
        overlay.append(path);
      }
    }
  }

  function drawMini(v: Box): void {
    const left = Math.min(0, ...placed.map((p) => p.box.x));
    const right = Math.max(SHEET_W, ...placed.map((p) => p.box.x + p.box.w));
    const bottom = Math.max(docH, ...placed.map((p) => p.box.y + p.box.h));
    const W = 120;
    const H = 84;
    const k = Math.min(W / (right - left), H / bottom);
    const r = (b: Box, cls: string) => {
      const d = el('i', cls);
      d.style.cssText = `left:${(b.x - left) * k}px;top:${b.y * k}px;width:${Math.max(2, b.w * k)}px;height:${Math.max(2, b.h * k)}px`;
      return d;
    };
    mini.replaceChildren(
      r({ x: 0, y: 0, w: SHEET_W, h: docH }, 'pb-mini-sheet'),
      ...placed.map((p) => r(p.box, 'pb-mini-card')),
      r({ x: Math.max(left, v.x), y: Math.max(0, v.y), w: v.w, h: v.h }, 'pb-mini-view'),
    );
    mini.dataset.k = String(k);
    mini.dataset.left = String(left);
  }

  // ---- input ----------------------------------------------------------------------------

  const onMini = (e: MouseEvent) => {
    const k = Number(mini.dataset.k) || 1;
    const r = mini.getBoundingClientRect();
    const wx = (e.clientX - r.left) / k + Number(mini.dataset.left || 0);
    const wy = (e.clientY - r.top) / k;
    tx = stage.clientWidth / 2 - wx * s;
    ty = stage.clientHeight / 2 - wy * s;
    apply(true);
  };
  mini.addEventListener('click', onMini);

  const onWheel = (e: WheelEvent) => {
    if ((e.target as Element).closest('.pb-dock, .pb-toolbar')) return;
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    wheel(e.deltaX, e.deltaY, e.deltaMode, e.ctrlKey || e.metaKey, e.clientX - r.left, e.clientY - r.top);
  };
  stage.addEventListener('wheel', onWheel, { passive: false });

  // Drag the table to pan; drag a card by its head to move it aside.
  let drag: { kind: 'pan' | 'card'; x: number; y: number; tx: number; ty: number; key?: string; box?: Box } | null = null;
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const t = e.target as Element;
    const head = t.closest('.pb-world .note-head');
    if (head && !t.closest('button, a, input, textarea, select')) {
      const card = head.closest('.pb-world > .thread > *') as HTMLElement | null;
      const p = placed.find((x) => x.card === card);
      if (!p) return;
      drag = { kind: 'card', x: e.clientX, y: e.clientY, tx, ty, key: p.key, box: { ...p.box } };
    } else if (t === stage || t === world || t === wires) {
      drag = { kind: 'pan', x: e.clientX, y: e.clientY, tx, ty };
    } else return;
    stage.setPointerCapture(e.pointerId);
    stage.classList.add('pb-dragging');
    e.preventDefault();
  };
  const onMove = (e: PointerEvent) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (drag.kind === 'pan') {
      tx = drag.tx + dx;
      ty = drag.ty + dy;
      apply();
    } else if (drag.key && drag.box) {
      moved.set(drag.key, { x: drag.box.x + dx / s, y: drag.box.y + dy / s });
      layout();
    }
  };
  const onUp = (e: PointerEvent) => {
    if (!drag) return;
    drag = null;
    stage.classList.remove('pb-dragging');
    if (stage.hasPointerCapture(e.pointerId)) stage.releasePointerCapture(e.pointerId);
  };
  stage.addEventListener('pointerdown', onDown);
  stage.addEventListener('pointermove', onMove);
  stage.addEventListener('pointerup', onUp);
  stage.addEventListener('pointercancel', onUp);

  // A keyboard user tabbing to a card off screen is taken to it.
  const onFocus = (e: FocusEvent) => {
    const card = (e.target as Element).closest('.pb-world > .thread > *') as HTMLElement | null;
    const p = placed.find((x) => x.card === card);
    if (!p) return;
    const v = view();
    if (p.box.y < v.y || p.box.y + Math.min(p.box.h, v.h) > v.y + v.h || p.box.x < v.x || p.box.x + p.box.w > v.x + v.w) panTo(p.box);
  };
  world.addEventListener('focusin', onFocus);

  const resize = new ResizeObserver(() => decorate());
  resize.observe(stage);

  let lastProbe = '';
  function tellFrame(force = false): void {
    const probe = host.probe();
    const json = JSON.stringify(probe);
    if (!force && json === lastProbe) return;
    lastProbe = json;
    host.toFrame({ type: 'canvas', on: true, probe });
  }

  // Start where the reader was in the panel.
  docH = Math.max(docH, stage.clientHeight);
  layout();
  s = 1;
  fit(false);
  ty = Math.min(16, -host.scrollY() * s + 16);
  apply();
  tellFrame(true);

  return {
    layout() {
      tellFrame();
      layout();
    },
    frameReady() {
      tellFrame(true);
    },
    onMessage(d) {
      if (d.type === 'geometry') {
        const g = d as unknown as Geometry;
        if (!Array.isArray(g.marks) || typeof g.height !== 'number') return true;
        geo = {
          width: Number(g.width) || SHEET_W,
          height: g.height,
          marks: g.marks.filter((m) => m && typeof m.n === 'string' && [m.x, m.y, m.w, m.h].every((v) => typeof v === 'number')),
          probe: g.probe && typeof g.probe.x === 'number' ? g.probe : null,
        };
        const h = Math.min(MAX_H, Math.max(stage.clientHeight, Math.ceil(g.height)));
        if (Math.abs(h - docH) > 1) docH = h;
        layout();
        // Never leave the sheet wholly out of view: the frame draws nothing while it is.
        const v = view();
        if (v.y > docH - 80 || v.y + v.h < 0) {
          ty = Math.min(16, -(docH - v.h * 0.8) * s);
          apply();
        }
        return true;
      }
      if (d.type === 'wheel') {
        // The frame's coordinates are page pixels: the sheet sits at the table's origin.
        wheel(Number(d.dx) || 0, Number(d.dy) || 0, Number(d.mode) || 0, d.zoom === true, tx + (Number(d.x) || 0) * s, ty + (Number(d.y) || 0) * s);
        return true;
      }
      return false;
    },
    stop() {
      resize.disconnect();
      stage.removeEventListener('wheel', onWheel);
      stage.removeEventListener('pointerdown', onDown);
      stage.removeEventListener('pointermove', onMove);
      stage.removeEventListener('pointerup', onUp);
      stage.removeEventListener('pointercancel', onUp);
      const top = Math.max(0, -ty / s);
      side.append(thread, ended, composer);
      for (const c of [...thread.children] as HTMLElement[]) {
        c.style.left = '';
        c.style.top = '';
        c.style.width = '';
      }
      world.remove();
      overlay.remove();
      toolbar.remove();
      pills.remove();
      dock.remove();
      sheet.style.cssText = '';
      stage.classList.remove('pb-canvas', 'pb-dragging');
      host.toFrame({ type: 'canvas', on: false });
      // The panel's page scrolls again: to where the table was looking.
      host.toFrame({ type: 'restore', x: 0, y: top });
      void frame;
    },
  };
}
