// `vivamark lint` and `vivamark figures`: checks that a page's figures say no
// more than the text they summarise (vivamark guide figures). Deterministic,
// offline and read-only: the page is parsed with parse5 and never written.

import { parse } from 'parse5';
import type { DefaultTreeAdapterMap } from 'parse5';

type Node = DefaultTreeAdapterMap['node'];
type Element = DefaultTreeAdapterMap['element'];
type Document = DefaultTreeAdapterMap['document'];
type TextNode = DefaultTreeAdapterMap['textNode'];

export const LINT_SCHEMA = 'vivamark.lint/1';
export const FIGURES_SCHEMA = 'vivamark.figures/1';

export type Severity = 'error' | 'warning';

export interface Problem {
  severity: Severity;
  rule: string;
  /** The id of the .viz figure it concerns, or null for the page. */
  figure: string | null;
  /** The id of the element it concerns, when it has one. */
  element: string | null;
  /** 1-based line in the saved file. */
  line: number | null;
  message: string;
}

export interface LintResult {
  schema: string;
  figures: number;
  errors: number;
  warnings: number;
  problems: Problem[];
}

export interface LinkedSection {
  id: string;
  /** False when no element on the page has this id. */
  found: boolean;
  heading: string;
  text: string;
}

export interface FigureView {
  id: string;
  index: number;
  line: number | null;
  /** relations (arrows), bars, dots, grid (a table) or other. */
  kind: 'relations' | 'bars' | 'dots' | 'grid' | 'other';
  /** Flow, sequence, state and architecture figures: the ones to read back. */
  read_back: boolean;
  /** The figure's own source, as saved: SVG, legend and caption. */
  html: string;
  caption: string;
  links: string[];
  sections: LinkedSection[];
}

// ---- the tree -------------------------------------------------------------------

function isElement(n: Node): n is Element {
  return 'tagName' in n;
}

function kids(n: Node): Node[] {
  return 'childNodes' in n ? (n.childNodes as Node[]) : [];
}

function childElements(n: Node): Element[] {
  return kids(n).filter(isElement);
}

function attr(el: Element, name: string): string | undefined {
  return el.attrs.find((a) => a.name === name)?.value;
}

function classes(el: Element): string[] {
  return (attr(el, 'class') ?? '').split(/\s+/).filter(Boolean);
}

function hasClass(el: Element, c: string): boolean {
  return classes(el).includes(c);
}

function parentOf(el: Element): Element | null {
  const p = el.parentNode as Node | null;
  return p && isElement(p) ? p : null;
}

/** Every element under `root`, in document order, template contents included. */
function all(root: Node, pred: (el: Element) => boolean = () => true): Element[] {
  const out: Element[] = [];
  const walk = (n: Node) => {
    if (isElement(n) && pred(n)) out.push(n);
    for (const c of kids(n)) walk(c);
    if (isElement(n) && n.tagName === 'template') walk((n as unknown as { content: Node }).content);
  };
  walk(root);
  return out;
}

function lineOf(el: Element): number | null {
  return el.sourceCodeLocation?.startLine ?? null;
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Plain text content, as textContent gives it. */
function rawText(n: Node): string {
  if (n.nodeName === '#text') return (n as TextNode).value;
  return kids(n).map(rawText).join('');
}

const INLINE = new Set(['a', 'abbr', 'b', 'bdi', 'bdo', 'cite', 'code', 'data', 'dfn', 'em', 'i', 'kbd', 'mark', 'q', 's', 'samp', 'small', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'var', 'label', 'del', 'ins']);
const NO_TEXT = new Set(['script', 'style', 'template', 'head', 'noscript']);

/**
 * Readable text: blocks on their own lines, ordered-list items with their
 * numbers (the reader sees them), table rows as cells joined by " | ".
 * `skip` leaves out whole subtrees (the figures themselves).
 */
function readable(nodes: Node[], skip: (el: Element) => boolean): string {
  const text = (n: Node): string => {
    if (n.nodeName === '#text') return (n as TextNode).value;
    if (!isElement(n) || NO_TEXT.has(n.tagName) || skip(n)) return '';
    const tag = n.tagName;
    if (tag === 'br') return '\n';
    if (tag === 'tr') return `\n${childElements(n).filter((c) => c.tagName === 'td' || c.tagName === 'th').map((c) => squash(text(c))).join(' | ')}\n`;
    if (tag === 'ol' || tag === 'ul') {
      let k = tag === 'ol' ? Number(attr(n, 'start') ?? '1') || 1 : 0;
      return kids(n)
        .map((c) => (isElement(c) && c.tagName === 'li' && !skip(c) ? `\n${tag === 'ol' ? `${k++}. ` : '- '}${kids(c).map(text).join('')}\n` : text(c)))
        .join('');
    }
    const inner = kids(n).map(text).join('');
    return INLINE.has(tag) ? inner : `\n${inner}\n`;
  };
  const lines = nodes.map(text).join('').split('\n').map(squash).filter(Boolean);
  // A list item whose content starts with a block: keep its number on the same line.
  const out: string[] = [];
  for (const l of lines) {
    const last = out[out.length - 1];
    if (last !== undefined && /^(?:\d+\.|-)$/.test(last)) out[out.length - 1] = `${last} ${l}`;
    else out.push(l);
  }
  return out.join('\n');
}

// ---- the page -------------------------------------------------------------------

interface Page {
  source: string;
  root: Document;
  ids: Map<string, Element[]>;
  figures: Element[];
}

function load(html: string): Page {
  const root = parse(html, { sourceCodeLocationInfo: true }) as Document;
  const ids = new Map<string, Element[]>();
  for (const el of all(root)) {
    const id = attr(el, 'id');
    if (id) ids.set(id, [...(ids.get(id) ?? []), el]);
  }
  // Outermost .viz boxes only: a .viz inside another is part of it.
  const figures = all(root, (el) => hasClass(el, 'viz')).filter((el) => {
    for (let p = parentOf(el); p; p = parentOf(p)) if (hasClass(p, 'viz')) return false;
    return true;
  });
  return { source: html, root, ids, figures };
}

function sourceOf(page: Page, el: Element): string {
  const loc = el.sourceCodeLocation;
  return loc ? page.source.slice(loc.startOffset, loc.endOffset) : '';
}

const HEADING = /^h([1-6])$/;

function headingLevel(el: Element): number {
  const m = HEADING.exec(el.tagName);
  return m ? Number(m[1]) : 0;
}

function firstHeading(el: Element): Element | null {
  return all(el, (e) => headingLevel(e) > 0)[0] ?? null;
}

const isFigurePart = (el: Element) => hasClass(el, 'viz') || hasClass(el, 'viz-caption');

/**
 * The text a link to `id` stands for. An element's own text; for a heading,
 * the heading and what follows it up to the next heading of the same or a
 * higher level. Figures are left out: they are summaries, not sources.
 */
function linkedSection(page: Page, id: string): LinkedSection {
  const el = page.ids.get(id)?.[0];
  if (!el) return { id, found: false, heading: '', text: '' };
  const level = headingLevel(el);
  const nodes = level ? siblingsAfterHeading(el) : [el];
  const h = level ? el : firstHeading(el);
  return { id, found: true, heading: h ? squash(rawText(h)) : '', text: readable(nodes, isFigurePart) };
}

function captionOf(fig: Element): Element | null {
  return all(fig, (el) => hasClass(el, 'viz-caption'))[0] ?? null;
}

function hrefIds(el: Element): string[] {
  return all(el, (a) => a.tagName === 'a')
    .map((a) => attr(a, 'href') ?? '')
    .filter((h) => h.startsWith('#') && h.length > 1)
    .map((h) => {
      try {
        return decodeURIComponent(h.slice(1));
      } catch {
        return h.slice(1);
      }
    });
}

function figureId(fig: Element, k: number): string {
  return attr(fig, 'id') || `figure-${k + 1}`;
}

/** The nearest <g id> holding `el`, inside `svg`. */
function ownerGroup(el: Element, svg: Element): Element | null {
  for (let p = parentOf(el); p && p !== svg; p = parentOf(p)) if (p.tagName === 'g' && attr(p, 'id')) return p;
  return null;
}

function isEdge(g: Element, svg: Element): boolean {
  if ((attr(g, 'id') ?? '').startsWith('edge-')) return true;
  if (attr(g, 'data-from') !== undefined || attr(g, 'data-to') !== undefined) return true;
  return all(g, (e) => e !== g && hasClass(e, 'edge')).some((e) => ownerGroup(e, svg) === g);
}

function hasAncestor(el: Element, stop: Element, pred: (p: Element) => boolean): boolean {
  for (let p = parentOf(el); p && p !== stop; p = parentOf(p)) if (pred(p)) return true;
  return false;
}

/** The outermost SVGs in a figure. */
function svgsOf(fig: Element): Element[] {
  return all(fig, (el) => el.tagName === 'svg' && !hasAncestor(el, fig, (p) => p.tagName === 'svg'));
}

const SVG_TEXT = ['text', 'title', 'desc'];

/** The elements an SVG says things in: its text, titles and descriptions, outermost only. */
function svgTextElements(svg: Element): Element[] {
  return all(svg, (e) => SVG_TEXT.includes(e.tagName) && !hasAncestor(e, svg, (p) => SVG_TEXT.includes(p.tagName)));
}

function kindOf(fig: Element, svgs: Element[]): FigureView['kind'] {
  const groups = svgs.flatMap((s) => all(s, (g) => g.tagName === 'g' && !!attr(g, 'id')).map((g) => [g, s] as const));
  if (groups.some(([g, s]) => isEdge(g, s)) || svgs.some((s) => all(s, (e) => hasClass(e, 'edge') || e.tagName === 'marker').length > 0)) return 'relations';
  if (svgs.some((s) => all(s, (e) => hasClass(e, 'bar')).length)) return 'bars';
  if (svgs.some((s) => all(s, (e) => hasClass(e, 'dot') || hasClass(e, 'range')).length)) return 'dots';
  if (all(fig, (e) => e.tagName === 'table').length) return 'grid';
  return 'other';
}

// ---- numbers and words ------------------------------------------------------------

// In a figure: a number not glued to a word, an id (run-04) or a version.
const STRICT_NUMBER = /(?<![\p{L}\p{N}_#./-])(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?!\d)/gu;
// In the text: any number not inside a word or hash (816e73d), so "7-59" still yields 59.
const LOOSE_NUMBER = /(?<![\p{L}\p{N}_#])(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?!\d)/gu;

const canonical = (n: string) => String(Number(n.replace(/,/g, '')));
const digits = (n: string) => n.replace(/\D/g, '').length;

function numbersIn(text: string, re: RegExp): string[] {
  return [...text.matchAll(re)].map((m) => m[0]);
}

/** Numbers a caption works out in the open: "(1 + 9 + 1 + 1 = 12)", "160 = 99 + 60 + 1". */
function workedNumbers(caption: string): Set<string> {
  const out = new Set<string>();
  for (const m of caption.matchAll(/\d[\d.,\s+\-−–×x*/÷%()]*=[\d.,\s+\-−–×x*/÷%()]*\d/g)) {
    for (const n of numbersIn(m[0], LOOSE_NUMBER)) out.add(canonical(n));
  }
  return out;
}

const STOP = new Set(
  [
    // Function words.
    'the and for with from into onto that this then than are was were its our your their not but all any each per via has have had will can may',
    'who what when where which how also only just more most less some such them they there these those been being out off too very own same both other else',
    // Words about the drawing, not the content.
    'dashed dotted solid line lines gridline gridlines scale log axis bar bars dot dots box boxes arrow arrows left right top bottom highlighted hover legend',
    // Units, often abbreviated.
    'min mins sec secs hrs kb mb gb tb px pct',
  ]
    .join(' ')
    .split(' '),
);

/** Tick labels and axis titles: a scale, not a claim. */
const inAxis = (el: Element, svg: Element) => hasClass(el, 'axis') || hasAncestor(el, svg, (p) => hasClass(p, 'axis'));

/** A label word is the section's when a form of it is there, or it shortens one ("deps"). */
function sectionWord(word: string, vocab: Set<string>, prefixes: string[]): boolean {
  const forms = wordVariants(word);
  return forms.some((v) => vocab.has(v)) || forms.some((v) => v.length >= 3 && prefixes.some((p) => p.startsWith(v)));
}

function wordVariants(w: string): string[] {
  const v = [w];
  const cut = (suffix: string, add = '') => {
    if (w.length > suffix.length + 2 && w.endsWith(suffix)) v.push(w.slice(0, -suffix.length) + add);
  };
  cut('s');
  cut('es');
  cut('ies', 'y');
  cut('ed');
  cut('d');
  cut('ing');
  cut('ing', 'e');
  cut('ly');
  return v;
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’']s\b/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w));
}

function vocabulary(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of words(text)) for (const v of wordVariants(w)) out.add(v);
  return out;
}

// ---- paint and size -------------------------------------------------------------------

// Closed shapes SVG fills black unless something sets their fill.
const SHAPES = ['path', 'polyline', 'polygon', 'rect', 'circle', 'ellipse'];
// The guide's classes that give a shape its fill (or fill: none).
const FILLED = ['edge', 'arrow', 'box', 'bar', 'range', 'dot'];
// The guide's classes for a <line> only; on a shape, only the page's CSS can fill them.
const LINE_ONLY = ['gridline', 'refline'];
// Drawn only where something refers to them, not as they stand.
const NOT_DRAWN = ['defs', 'marker', 'clipPath', 'clippath', 'mask', 'pattern', 'symbol'];

function setsFill(el: Element): boolean {
  return attr(el, 'fill') !== undefined || /(?:^|;)\s*fill\s*:/i.test(attr(el, 'style') ?? '');
}

/** One compound selector (rect.box, #viz-c, g[id]): what an element must have. */
interface Compound {
  tag: string | null;
  id: string | null;
  classes: string[];
  attrs: string[];
  /** A state the page is not in at rest (:hover, :focus): the rule does not apply as drawn. */
  never: boolean;
}

function compound(raw: string): Compound | null {
  // :not(.x), :is(...) and the like say nothing an element must have here.
  const s = raw.replace(/:[\w-]+\([^)]*\)/g, '');
  const c: Compound = { tag: null, id: null, classes: [], attrs: [], never: false };
  const tag = /^(?:[\w-]+\|)?([\w-]+|\*)/.exec(s);
  if (tag && tag[1] !== '*') c.tag = tag[1].toLowerCase();
  for (const m of s.matchAll(/#([\w-]+)/g)) c.id = m[1];
  for (const m of s.matchAll(/\.([\w-]+)/g)) c.classes.push(m[1]);
  for (const m of s.matchAll(/\[\s*([\w:-]+)/g)) c.attrs.push(m[1].toLowerCase());
  if (/:(?:hover|focus|focus-within|focus-visible|active|target|checked|visited)\b/i.test(s)) c.never = true;
  return c.tag || c.id || c.classes.length || c.attrs.length || s.startsWith('*') ? c : null;
}

function matchesCompound(el: Element, c: Compound): boolean {
  if (c.never) return false;
  if (c.tag && el.tagName.toLowerCase() !== c.tag) return false;
  if (c.id && attr(el, 'id') !== c.id) return false;
  if (c.classes.some((k) => !hasClass(el, k))) return false;
  return c.attrs.every((a) => el.attrs.some((x) => x.name.toLowerCase() === a));
}

/**
 * The selectors of the page's own CSS rules that set fill, each as compounds
 * from outermost to the element. Combinators all count as "inside": a
 * looser match, so a fill the page really sets is never missed.
 */
function cssFillSelectors(root: Node): Compound[][] {
  const out: Compound[][] = [];
  const css = all(root, (el) => el.tagName === 'style').map(rawText).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/(?:^|;)\s*fill\s*:/i.test(m[2])) continue;
    for (const sel of m[1].split(',')) {
      const parts = sel.trim().split(/\s*[>+~]\s*|\s+/).filter(Boolean).map(compound);
      if (parts.length && parts.every((p): p is Compound => p !== null)) out.push(parts);
    }
  }
  return out;
}

/** Does a selector (compounds, outermost first) match el, each earlier compound on some ancestor in order? */
function matchesSelector(el: Element, sel: Compound[]): boolean {
  if (!matchesCompound(el, sel[sel.length - 1])) return false;
  let k = sel.length - 2;
  for (let p = parentOf(el); p && k >= 0; p = parentOf(p)) if (matchesCompound(p, sel[k])) k--;
  return k < 0;
}

/**
 * A shape with nothing setting its fill, so SVG paints it black. Fill is
 * inherited, so a fill attribute, a style, one of the guide's classes or a
 * rule of the page's CSS on the shape or on any element around it (the <svg>
 * and beyond) counts.
 */
function unfilled(el: Element, svg: Element, fillRules: Compound[][]): boolean {
  if (!SHAPES.includes(el.tagName) || hasAncestor(el, svg, (p) => NOT_DRAWN.includes(p.tagName))) return false;
  for (let p: Element | null = el; p; p = parentOf(p)) {
    if (setsFill(p) || classes(p).some((c) => FILLED.includes(c))) return false;
    if (fillRules.some((sel) => matchesSelector(p!, sel))) return false;
  }
  return true;
}

// Average glyph width in em for the page's sans-serif, a little over the median
// measured in Chromium; .strong text (600) runs about 7% wider. An estimate: a
// warning, never an error.
const EM_PER_CHAR = 0.55;
const STRONG = 1.07;
const PAGE_FONT_PX = 12;

function num(v: string | undefined): number | null {
  if (v === undefined || v.trim() === '') return null;
  const n = Number(v.trim().replace(/px$/, ''));
  return Number.isFinite(n) ? n : null;
}

function fontPx(el: Element, svg: Element): number {
  for (let p: Element | null = el; p && p !== svg; p = parentOf(p)) {
    const n = num(attr(p, 'font-size')) ?? num(/(?:^|;)\s*font-size\s*:\s*([\d.]+)px/i.exec(attr(p, 'style') ?? '')?.[1]);
    if (n) return n;
  }
  return PAGE_FONT_PX;
}

interface TextLine {
  el: Element;
  text: string;
  x0: number;
  x1: number;
  y: number;
  width: number;
}

/** Each line a <text> draws (one per <tspan> with its own x), placed by its x and text-anchor. */
function textLines(t: Element, svg: Element): TextLine[] {
  const spans = all(t, (e) => e.tagName === 'tspan' && attr(e, 'x') !== undefined);
  const parts = spans.length ? spans : [t];
  const out: TextLine[] = [];
  for (const el of parts) {
    const text = squash(rawText(el));
    const x = num(attr(el, 'x')) ?? num(attr(t, 'x')) ?? 0;
    const y = num(attr(el, 'y')) ?? num(attr(t, 'y')) ?? 0;
    if (!text) continue;
    const width = [...text].length * fontPx(el, svg) * EM_PER_CHAR * (classes(t).includes('strong') || classes(el).includes('strong') ? STRONG : 1);
    const anchor = attr(el, 'text-anchor') ?? attr(t, 'text-anchor') ?? 'start';
    const x0 = anchor === 'middle' ? x - width / 2 : anchor === 'end' ? x - width : x;
    out.push({ el, text, x0, x1: x0 + width, y, width });
  }
  return out;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The terms a decision supersedes: data-vivamark-supersedes="trust; company layer". */
function supersededTerms(el: Element): { term: string; re: RegExp }[] {
  return (attr(el, 'data-vivamark-supersedes') ?? '')
    .split(';')
    .map((t) => squash(t))
    .filter(Boolean)
    .map((term) => ({ term, re: new RegExp(`(?<![\\p{L}\\p{N}_])${term.split(' ').map(escapeRe).join('\\s+')}(?![\\p{L}\\p{N}_])`, 'iu') }));
}

// ---- lint ---------------------------------------------------------------------------

const EXTERNAL = /^\s*(?:(?:https?|ftp|wss?):)?\/\//i;
const CSS_EXTERNAL = /@import\s+(?:url\(\s*)?["']?\s*((?:(?:https?|ftp):)?\/\/[^"')\s;]+)|url\(\s*["']?\s*((?:(?:https?|ftp):)?\/\/[^"')\s]+)/gi;
const COVERAGE = /\bshows?\b|\bin the text\b|\bnot drawn\b|\bleft out\b/i;
const CAPTION_START = /^author[’']s summary of\b/i;

export function lintPage(html: string): LintResult {
  const page = load(html);
  const problems: Problem[] = [];
  const add = (severity: Severity, rule: string, figure: string | null, el: Element | null, message: string) =>
    problems.push({ severity, rule, figure, element: el ? attr(el, 'id') ?? null : null, line: el ? lineOf(el) : null, message });

  // The page as a whole.
  for (const el of all(page.root)) {
    if (el.tagName === 'script') add('error', 'no-script', null, el, 'a <script> element: review pages carry no script of their own');
    for (const name of ['fill', 'stroke']) {
      const v = attr(el, name);
      if (v && v.trim().startsWith('#')) add('error', 'no-hex-colour', null, el, `${name}="${v}": colour through the .viz classes and tokens instead`);
    }
    const style = attr(el, 'style');
    if (style && /(?:^|;)\s*(?:fill|stroke)\s*:\s*#/i.test(style)) add('error', 'no-hex-colour', null, el, `style="${style}": colour through the .viz classes and tokens instead`);
    const fetched: [string, string | undefined][] = [
      ['src', attr(el, 'src')],
      ['srcset', attr(el, 'srcset')],
      ['poster', attr(el, 'poster')],
    ];
    if (el.tagName === 'link') fetched.push(['href', attr(el, 'href')]);
    if (['image', 'use', 'feImage', 'feimage'].includes(el.tagName)) fetched.push(['href', attr(el, 'href') ?? attr(el, 'xlink:href')]);
    for (const [name, v] of fetched) {
      if (v && (EXTERNAL.test(v) || (name === 'srcset' && v.split(',').some((c) => EXTERNAL.test(c))))) {
        add('error', 'no-external-url', null, el, `<${el.tagName} ${name}="${v}">: an outbound request; inline it instead`);
      }
    }
    const css = el.tagName === 'style' ? rawText(el) : style ?? '';
    for (const m of css.matchAll(CSS_EXTERNAL)) add('error', 'no-external-url', null, el, `${(m[0].split(/[\s(]/)[0] || 'url').trim()} ${m[1] ?? m[2]}: an outbound request; inline it instead`);
  }

  const fillRules = cssFillSelectors(page.root);

  // Captions anywhere on the page.
  const captions = all(page.root, (el) => hasClass(el, 'viz-caption'));
  for (const cap of captions) {
    const fig = page.figures.find((f) => hasAncestor(cap, page.root as unknown as Element, (p) => p === f)) ?? null;
    const fid = fig ? figureId(fig, page.figures.indexOf(fig)) : null;
    if (!CAPTION_START.test(squash(rawText(cap)))) add('error', 'caption-source', fid, cap, `the caption should start "Author's summary of": "${squash(rawText(cap)).slice(0, 60)}"`);
    const links = hrefIds(cap);
    if (!links.length) add('error', 'caption-link', fid, cap, 'the caption links no section (<a href="#section-id">)');
    for (const id of links) if (!page.ids.has(id)) add('error', 'caption-link', fid, cap, `the caption links #${id}, which is not on the page`);
  }

  page.figures.forEach((fig, k) => {
    const fid = figureId(fig, k);
    const cap = captionOf(fig);
    if (!cap) add('error', 'caption-source', fid, fig, 'the figure has no .viz-caption saying whose summary it is, of which section');
    const capText = cap ? squash(rawText(cap)) : '';
    const sections = (cap ? hrefIds(cap) : []).filter((id) => page.ids.has(id)).map((id) => linkedSection(page, id));
    const scope = sections.map((s) => s.text).join('\n');
    const known = new Set([...numbersIn(scope, LOOSE_NUMBER).map(canonical), ...workedNumbers(capText)]);
    const vocab = vocabulary(scope);
    const where = sections.map((s) => `#${s.id}`).join(', ');
    const svgs = svgsOf(fig);
    let parts = 0;

    for (const svg of svgs) {
      if (attr(svg, 'role') !== 'img') add('error', 'svg-role', fid, svg, 'the <svg> needs role="img"');
      const label = (attr(svg, 'aria-label') ?? '').trim();
      if (!label) add('error', 'svg-label', fid, svg, 'the <svg> needs a one-sentence aria-label stating what it shows');

      const groups = all(svg, (g) => g.tagName === 'g' && !!attr(g, 'id'));
      for (const g of groups) {
        const id = attr(g, 'id')!;
        if ((page.ids.get(id)?.length ?? 0) > 1) add('error', 'unique-id', fid, g, `id "${id}" is used ${page.ids.get(id)!.length} times on the page`);
        if (isEdge(g, svg)) {
          for (const end of ['data-from', 'data-to']) {
            const v = (attr(g, end) ?? '').trim();
            if (!v) add('warning', 'edge-ends', fid, g, `the arrow group #${id} has no ${end}: name both ends (data-from="node-a" data-to="node-b")`);
            else if (!page.ids.has(v)) add('warning', 'edge-ends', fid, g, `the arrow group #${id} has ${end}="${v}", which is not on the page`);
          }
        } else parts++;
      }

      for (const e of all(svg, (x) => hasClass(x, 'edge') && !ownerGroup(x, svg))) {
        add('warning', 'edge-ends', fid, e, 'an arrow outside any <g id>: wrap it in <g id="edge-..." data-from="..." data-to="..."> so it names its ends');
      }

      // Paint: a shape nothing fills is drawn solid black.
      for (const s of all(svg, (x) => unfilled(x, svg, fillRules))) {
        const cls = classes(s).join(' ');
        const why = classes(s).some((c) => LINE_ONLY.includes(c))
          ? `.${classes(s).find((c) => LINE_ONLY.includes(c))} is for <line> only`
          : 'nothing sets its fill';
        add('error', 'unfilled-shape', fid, ownerGroup(s, svg) ?? s, `<${s.tagName}${cls ? ` class="${cls}"` : ''}> is painted solid black: ${why}. Draw a line, bracket or connector as an .edge path; give a shape a filled class (.box, .bar) or fill="none"`);
      }

      // Size: text that likely runs past the viewBox or out of its box.
      const vb = (attr(svg, 'viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
      const view = vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 ? { x0: vb[0], x1: vb[0] + vb[2] } : null;
      for (const t of all(svg, (e) => e.tagName === 'text')) {
        if (attr(t, 'textLength') !== undefined || hasAncestor(t, svg, (p) => p.tagName === 'text' || NOT_DRAWN.includes(p.tagName))) continue;
        if ([t, ...all(t)].some((e) => attr(e, 'transform') !== undefined) || hasAncestor(t, svg, (p) => attr(p, 'transform') !== undefined)) continue;
        const parent = parentOf(t);
        const box = parent && parent !== svg ? childElements(parent).find((r) => r.tagName === 'rect' && hasClass(r, 'box')) : undefined;
        const b = box ? { x: num(attr(box, 'x')) ?? 0, y: num(attr(box, 'y')) ?? 0, w: num(attr(box, 'width')), h: num(attr(box, 'height')) } : null;
        for (const l of textLines(t, svg)) {
          const owner = ownerGroup(t, svg) ?? t;
          const about = `"${l.text.slice(0, 60)}" is about ${Math.round(l.width)} wide`;
          if (b && b.w && b.h && l.y >= b.y && l.y <= b.y + b.h && (l.x0 < b.x - 0.5 || l.x1 > b.x + b.w + 0.5)) {
            add('warning', 'text-overflow', fid, owner, `${about}; its box is ${b.w} (x ${b.x}..${b.x + b.w}): shorten it, wrap it into two <text> lines, or widen the box`);
          } else if (view && (l.x0 < view.x0 - 0.5 || l.x1 > view.x1 + 0.5)) {
            const end = l.x1 > view.x1 ? `to about x=${Math.round(l.x1)}` : `from about x=${Math.round(l.x0)}`;
            add('warning', 'text-overflow', fid, owner, `${about} and runs ${end}, past the viewBox (${view.x0}..${view.x1}): shorten it, wrap it into two <text> lines, or move it`);
          }
        }
      }

      // Number provenance: every number of two or more digits the figure shows.
      if (sections.length) {
        const seen = new Set<string>();
        const said: [Element, string, string][] = [
          [svg, label, 'aria-label'],
          ...svgTextElements(svg)
            .filter((e) => !inAxis(e, svg))
            .map((e) => [e, rawText(e), `<${e.tagName}>`] as [Element, string, string]),
        ];
        for (const [el, text, what] of said) {
          for (const n of numbersIn(text, STRICT_NUMBER)) {
            const c = canonical(n);
            if (digits(n) < 2 || known.has(c) || seen.has(c)) continue;
            seen.add(c);
            const owner = el === svg ? svg : el.tagName === 'title' ? parentOf(el) : ownerGroup(el, svg) ?? el;
            add('error', 'number-provenance', fid, owner, `"${n}" (in ${what} "${squash(text).slice(0, 50)}") is not in ${where}${sections.length === 1 && sections[0].heading ? ` (${sections[0].heading})` : ''}`);
          }
        }
      }

      // Proportionality: one scale for every bar in the figure.
      const bars: { g: Element; w: number; h: number; value: number }[] = [];
      for (const g of groups) {
        const title = childElements(g).find((c) => c.tagName === 'title');
        const rects = all(g, (e) => e.tagName === 'rect' && hasClass(e, 'bar') && ownerGroup(e, svg) === g);
        if (!title || rects.length !== 1) continue;
        const t = rawText(title);
        const after = t.includes(':') ? t.slice(t.indexOf(':') + 1) : t;
        const first = numbersIn(after, STRICT_NUMBER)[0];
        const w = Number(attr(rects[0], 'width'));
        const h = Number(attr(rects[0], 'height'));
        if (first === undefined || !Number.isFinite(w) || !Number.isFinite(h)) continue;
        const value = Number(first.replace(/,/g, ''));
        if (value > 0) bars.push({ g, w, h, value });
      }
      if (bars.length >= 2) {
        const sameHeight = bars.every((b) => Math.abs(b.h - bars[0].h) < 0.5);
        const sameWidth = bars.every((b) => Math.abs(b.w - bars[0].w) < 0.5);
        const useHeight = !sameHeight && sameWidth;
        const ratio = (b: (typeof bars)[number]) => (useHeight ? b.h : b.w) / b.value;
        const sorted = bars.map(ratio).sort((a, b) => a - b);
        const mid = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
        for (const b of bars) {
          const r = ratio(b);
          if (Math.abs(r - mid) / mid > 0.02) {
            add('error', 'bar-proportion', fid, b.g, `bar #${attr(b.g, 'id')}: ${useHeight ? 'height' : 'width'} ${useHeight ? b.h : b.w} for ${b.value} is ${r.toFixed(3)} per unit; the figure's bars run at ${mid.toFixed(3)} (more than 2% apart)`);
          }
        }
      }

      // Labels: the words of each part's text should be the section's words.
      if (sections.length) {
        const labelGroups = new Map<Element | null, string[]>();
        const prefixes = [...vocab];
        for (const t of all(svg, (e) => e.tagName === 'text' && !inAxis(e, svg))) {
          const owner = ownerGroup(t, svg);
          const key = owner ?? t;
          labelGroups.set(key, [...(labelGroups.get(key) ?? []), squash(rawText(t))]);
        }
        for (const [owner, texts] of labelGroups) {
          const label = texts.join(' ');
          const missing = [...new Set(words(label))].filter((w) => !sectionWord(w, vocab, prefixes));
          if (missing.length) add('warning', 'label-words', fid, owner, `"${label}": ${missing.map((w) => `"${w}"`).join(', ')} not in ${where}; keep the section's names and verbs`);
        }
      }
    }

    // Coverage: a figure with fewer parts than its section has items says what it left out.
    parts += all(fig, (e) => e.tagName === 'tr' && childElements(e).some((c) => c.tagName === 'td')).length;
    parts += all(fig, (e) => e.tagName === 'li' && !!attr(e, 'id')).length;
    if (sections.length && cap && !COVERAGE.test(capText)) {
      // The largest linked section sets the bar; the others usually lend a detail or two.
      let most = 0;
      let unit = '';
      for (const s of sections) {
        const el = page.ids.get(s.id)![0];
        const scopeEls = headingLevel(el) ? siblingsAfterHeading(el) : [el];
        const inScope = scopeEls.flatMap((n) => all(n)).filter((e) => !insideFigure(e));
        const counts: [number, string][] = [
          [inScope.filter((e) => e.tagName === 'li' && parentOf(e)?.tagName === 'ol').length, 'numbered items'],
          [inScope.filter((e) => e.tagName === 'tr' && childElements(e).some((c) => c.tagName === 'td')).length, 'table rows'],
          [inScope.filter((e) => /^step-/.test(attr(e, 'id') ?? '')).length, 'steps'],
        ];
        for (const [n, what] of counts) if (n > most) [most, unit] = [n, `${what} in #${s.id}`];
      }
      if (most > parts) {
        add('warning', 'coverage-line', fid, cap, `${most} ${unit} and the figure has ${parts} parts, but the caption has no coverage line ("Shows 6 of the 9 steps; ... are in the text.")`);
      }
    }
  });

  // Superseded terms: after a decision, the lede, the cards and the figures show the decided state.
  for (const decision of all(page.root, (el) => attr(el, 'data-vivamark-supersedes') !== undefined)) {
    const terms = supersededTerms(decision);
    const did = attr(decision, 'id');
    const by = did ? `#${did}` : `the decision on line ${lineOf(decision)}`;
    const exempt = (el: Element) => el === decision || hasClass(el, 'superseded') || hasAncestor(el, page.root as unknown as Element, (p) => p === decision || hasClass(p, 'superseded'));
    const says = (fid: string | null, el: Element, where: string, text: string) => {
      for (const { term, re } of terms) {
        if (re.test(text)) add('warning', 'superseded-term', fid, el, `${where} still says "${term}", which ${by} supersedes: bring it to the decided state, or mark the passage .superseded (see: vivamark guide amend)`);
      }
    };
    for (const el of all(page.root, (e) => (hasClass(e, 'lede') || hasClass(e, 'card')) && !hasClass(e, 'viz') && !insideFigure(e))) {
      if (exempt(el) || all(el, (e) => e !== el && hasClass(e, 'card')).length) continue;
      const id = attr(el, 'id');
      says(null, el, `the ${hasClass(el, 'lede') ? 'lede' : 'card'}${id ? ` #${id}` : ''}`, readable([el], (e) => hasClass(e, 'superseded') || isFigurePart(e)));
    }
    page.figures.forEach((fig, k) => {
      if (exempt(fig)) return;
      const fid = figureId(fig, k);
      for (const svg of svgsOf(fig)) {
        says(fid, svg, `#${fid}'s aria-label`, attr(svg, 'aria-label') ?? '');
        for (const e of svgTextElements(svg)) {
          if (exempt(e)) continue;
          const owner = e.tagName === 'title' ? parentOf(e) ?? e : ownerGroup(e, svg) ?? e;
          says(fid, owner, `#${fid}, <${e.tagName}> "${squash(rawText(e)).slice(0, 50)}",`, rawText(e));
        }
      }
    });
  }

  const errors = problems.filter((p) => p.severity === 'error').length;
  return { schema: LINT_SCHEMA, figures: page.figures.length, errors, warnings: problems.length - errors, problems };
}

function siblingsAfterHeading(el: Element): Node[] {
  const level = headingLevel(el);
  const sibs = kids(parentOf(el) ?? (el.parentNode as Node));
  const out: Node[] = [el];
  for (const s of sibs.slice(sibs.indexOf(el) + 1)) {
    if (isElement(s)) {
      const l = headingLevel(s) || headingLevel(firstHeading(s) ?? s);
      if (l && l <= level) break;
    }
    out.push(s);
  }
  return out;
}

function insideFigure(el: Element): boolean {
  for (let p: Element | null = el; p; p = parentOf(p)) if (isFigurePart(p)) return true;
  return false;
}

/** 0 clean, 1 errors, 2 warnings only. */
export function lintExitCode(r: LintResult): number {
  return r.errors ? 1 : r.warnings ? 2 : 0;
}

export function renderLint(r: LintResult, file: string): string {
  const n = (k: number, w: string) => `${k} ${w}${k === 1 ? '' : 's'}`;
  if (!r.problems.length) return `${file}: clean (${n(r.figures, 'figure')} checked)\n`;
  const lines = [`${file}: ${n(r.errors, 'error')}, ${n(r.warnings, 'warning')} (${n(r.figures, 'figure')} checked)`];
  for (const p of r.problems) {
    const at = [p.line ? `line ${p.line}` : '', p.figure ? `#${p.figure}` : ''].filter(Boolean).join(' ');
    lines.push(`  ${p.severity.padEnd(7)} ${p.rule.padEnd(17)} ${at ? `${at}: ` : ''}${p.message}`);
  }
  return lines.join('\n') + '\n';
}

// ---- figures ----------------------------------------------------------------------------

export function pageFigures(html: string): FigureView[] {
  const page = load(html);
  return page.figures.map((fig, k) => {
    const cap = captionOf(fig);
    const links = cap ? [...new Set(hrefIds(cap))] : [];
    const svgs = svgsOf(fig);
    const kind = kindOf(fig, svgs);
    return {
      id: figureId(fig, k),
      index: k + 1,
      line: lineOf(fig),
      kind,
      read_back: kind === 'relations',
      html: sourceOf(page, fig),
      caption: cap ? squash(rawText(cap)) : '',
      links,
      sections: links.map((id) => linkedSection(page, id)),
    };
  });
}

export function renderFigures(figs: FigureView[], file: string): string {
  if (!figs.length) return `${file}: no figures (.viz)\n`;
  const out: string[] = [`${file}: ${figs.length} figure${figs.length === 1 ? '' : 's'}`, ''];
  for (const f of figs) {
    out.push(`=== figure ${f.index} of ${figs.length}: #${f.id}${f.line ? ` (line ${f.line})` : ''}, ${f.kind}; read back: ${f.read_back ? 'yes' : 'no'}`);
    out.push('--- the figure and its caption (give the reader this alone first)');
    out.push(f.html.trim());
    for (const s of f.sections) {
      out.push(`--- section #${s.id}${s.heading ? `: ${s.heading}` : ''} (give the reader this only after it has listed the claims)`);
      out.push(s.found ? s.text : '(not on the page)');
    }
    if (!f.sections.length) out.push('--- no section: the caption links none');
    out.push('');
  }
  return out.join('\n');
}
