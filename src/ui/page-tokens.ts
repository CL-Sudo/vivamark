// The page tokens: the active theme's colours and fonts, offered to the
// agent's page as CSS custom properties so a page that uses them follows the
// reviewer's theme. Opt-in: a page that never reads them looks exactly as it
// did. The page script (sdk.ts) applies the theme's set before the page first
// paints, from the theme named in the frame's URL, and the review page sends
// the set again, with the mark tokens, on every switch. Shared so both sides
// agree on the names and the values.
//
// Every colour is opaque, so contrast can be checked from the values alone:
// each foreground at 4.5:1 or better on the background and the surface, text
// and muted text on every tint, and each status on its own tint (themes.test).

export const PAGE_TOKENS = [
  /** `light` or `dark`: for the page's color-scheme, so native controls match. */
  '--vivamark-scheme',
  /** The page's background. */
  '--vivamark-bg',
  /** Cards, panels, table boxes: what sits on the background. */
  '--vivamark-surface',
  /** Body text and headings. */
  '--vivamark-text',
  /** Small print, captions, line numbers. */
  '--vivamark-muted',
  /** Rules, card and table borders. Decoration: no contrast promise. */
  '--vivamark-border',
  /** Links, the eyebrow, the recommended option, a bar in a chart. Reads as text. */
  '--vivamark-accent',
  /** A tint of the accent: callouts, code, a plain badge. */
  '--vivamark-accent-bg',
  /** Done, passed. Each status: a colour that reads as text, and a tint to put it on. */
  '--vivamark-ok',
  '--vivamark-ok-bg',
  /** At risk. */
  '--vivamark-warn',
  '--vivamark-warn-bg',
  /** Blocked, failed. */
  '--vivamark-bad',
  '--vivamark-bad-bg',
  /** Open, asks the reviewer: "Your input". */
  '--vivamark-ask',
  '--vivamark-ask-bg',
  /** A font-family list for body text, and one for headings. */
  '--vivamark-font-body',
  '--vivamark-font-heading',
  /** Corner radius of a card. */
  '--vivamark-radius',
  /** A card's shadow, or `none`. */
  '--vivamark-shadow',
] as const;

export type PageToken = (typeof PAGE_TOKENS)[number];

/** The tokens that are colours, all opaque `#rrggbb`. */
export const PAGE_COLOURS = PAGE_TOKENS.filter((t) => t !== '--vivamark-scheme' && !t.startsWith('--vivamark-font') && t !== '--vivamark-radius' && t !== '--vivamark-shadow');

/**
 * The bundled faces as the page sees them. Each family is named "vivamark …"
 * so a page that asks for a font of the same name, installed or its own,
 * still gets that one. A face loads only when a page uses it, and only from
 * the daemon (/_vivamark/fonts/).
 */
export interface PageFace {
  family: string;
  file: string;
  weight: string;
}

export const PAGE_FACES: readonly PageFace[] = [
  { family: 'vivamark Archivo', file: 'archivo.woff2', weight: '100 900' },
  { family: 'vivamark Archivo Black', file: 'archivo-black.woff2', weight: '400' },
  { family: 'vivamark Space Mono', file: 'space-mono-400.woff2', weight: '400' },
  { family: 'vivamark Space Mono', file: 'space-mono-700.woff2', weight: '700' },
  { family: 'vivamark Figtree', file: 'figtree.woff2', weight: '300 900' },
  { family: 'vivamark Atkinson Hyperlegible', file: 'atkinson-hyperlegible-400.woff2', weight: '400' },
  { family: 'vivamark Atkinson Hyperlegible', file: 'atkinson-hyperlegible-700.woff2', weight: '700' },
  { family: 'vivamark Bricolage Grotesque', file: 'bricolage-grotesque.woff2', weight: '200 800' },
  { family: 'vivamark Space Grotesk', file: 'space-grotesk.woff2', weight: '300 700' },
  { family: 'vivamark Jost', file: 'jost.woff2', weight: '100 900' },
  { family: 'vivamark Lexend', file: 'lexend.woff2', weight: '100 900' },
];

/** Smooth glass has no bundled face: like the review page, Inter when installed, else the system's. */
const SYSTEM = 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/** Each theme's page tokens, by theme id. */
export const PAGE_THEMES: Readonly<Record<string, Readonly<Record<PageToken, string>>>> = {
  // Cream, black outlines, hard shadows, candy tints; lemon asks you.
  gumdrop: {
    '--vivamark-scheme': 'light',
    '--vivamark-bg': '#fff6e9',
    '--vivamark-surface': '#ffffff',
    '--vivamark-text': '#141414',
    '--vivamark-muted': '#4a4a4a',
    '--vivamark-border': '#141414',
    '--vivamark-accent': '#5b3fc4',
    '--vivamark-accent-bg': '#efe9ff',
    '--vivamark-ok': '#0f6640',
    '--vivamark-ok-bg': '#c9f5df',
    '--vivamark-warn': '#7f4300',
    '--vivamark-warn-bg': '#ffe2bd',
    '--vivamark-bad': '#9b1c3a',
    '--vivamark-bad-bg': '#ffe3ef',
    '--vivamark-ask': '#141414',
    '--vivamark-ask-bg': '#ffe27a',
    '--vivamark-font-body': '"vivamark Lexend", "Trebuchet MS", system-ui, sans-serif',
    '--vivamark-font-heading': '"vivamark Lexend", "Trebuchet MS", system-ui, sans-serif',
    '--vivamark-radius': '14px',
    '--vivamark-shadow': '4px 4px 0 #141414',
  },
  // A Swiss grid: white, black, one red; square corners, no shadow.
  raster: {
    '--vivamark-scheme': 'light',
    '--vivamark-bg': '#ffffff',
    '--vivamark-surface': '#ffffff',
    '--vivamark-text': '#111111',
    '--vivamark-muted': '#595959',
    '--vivamark-border': '#d9d9d9',
    '--vivamark-accent': '#b8201a',
    '--vivamark-accent-bg': '#fbeceb',
    '--vivamark-ok': '#111111',
    '--vivamark-ok-bg': '#eeeeee',
    '--vivamark-warn': '#111111',
    '--vivamark-warn-bg': '#ffffff',
    '--vivamark-bad': '#b8201a',
    '--vivamark-bad-bg': '#fbeceb',
    '--vivamark-ask': '#b8201a',
    '--vivamark-ask-bg': '#ffffff',
    '--vivamark-font-body': '"vivamark Archivo", "Helvetica Neue", Arial, sans-serif',
    '--vivamark-font-heading': '"vivamark Archivo", "Helvetica Neue", Arial, sans-serif',
    '--vivamark-radius': '0px',
    '--vivamark-shadow': 'none',
  },
  // Brutalist: black on white, thick lines, a yellow highlight, mono type.
  raw: {
    '--vivamark-scheme': 'light',
    '--vivamark-bg': '#ffffff',
    '--vivamark-surface': '#ffffff',
    '--vivamark-text': '#000000',
    '--vivamark-muted': '#3d3d3d',
    '--vivamark-border': '#000000',
    '--vivamark-accent': '#000000',
    '--vivamark-accent-bg': '#ffe14d',
    '--vivamark-ok': '#000000',
    '--vivamark-ok-bg': '#e8e8e8',
    '--vivamark-warn': '#000000',
    '--vivamark-warn-bg': '#ffe14d',
    '--vivamark-bad': '#b3261e',
    '--vivamark-bad-bg': '#fff0ee',
    '--vivamark-ask': '#2a3fc4',
    '--vivamark-ask-bg': '#e3e7ff',
    '--vivamark-font-body': '"vivamark Space Mono", ui-monospace, monospace',
    '--vivamark-font-heading': '"vivamark Archivo Black", "Arial Black", sans-serif',
    '--vivamark-radius': '0px',
    '--vivamark-shadow': '4px 4px 0 #000000',
  },
  // A grey table, white sheets, one violet.
  pinboard: {
    '--vivamark-scheme': 'light',
    '--vivamark-bg': '#eceff3',
    '--vivamark-surface': '#ffffff',
    '--vivamark-text': '#1b2230',
    '--vivamark-muted': '#4d5566',
    '--vivamark-border': '#d5dae2',
    '--vivamark-accent': '#5a3fd6',
    '--vivamark-accent-bg': '#f0ecff',
    '--vivamark-ok': '#146b46',
    '--vivamark-ok-bg': '#ddf3e8',
    '--vivamark-warn': '#7a4a00',
    '--vivamark-warn-bg': '#fff1d6',
    '--vivamark-bad': '#b42343',
    '--vivamark-bad-bg': '#fff1f3',
    '--vivamark-ask': '#5a3fd6',
    '--vivamark-ask-bg': '#f0ecff',
    '--vivamark-font-body': '"vivamark Figtree", system-ui, sans-serif',
    '--vivamark-font-heading': '"vivamark Figtree", system-ui, sans-serif',
    '--vivamark-radius': '10px',
    '--vivamark-shadow': '0 6px 18px rgba(27, 34, 48, .1)',
  },
  // Big, plain and legible: black on white, strong colours.
  signal: {
    '--vivamark-scheme': 'light',
    '--vivamark-bg': '#ffffff',
    '--vivamark-surface': '#ffffff',
    '--vivamark-text': '#000000',
    '--vivamark-muted': '#333333',
    '--vivamark-border': '#000000',
    '--vivamark-accent': '#1747a6',
    '--vivamark-accent-bg': '#e8eefb',
    '--vivamark-ok': '#0b6b2e',
    '--vivamark-ok-bg': '#e3f3e8',
    '--vivamark-warn': '#6b3a00',
    '--vivamark-warn-bg': '#fff0d6',
    '--vivamark-bad': '#9b0d0d',
    '--vivamark-bad-bg': '#fdeaea',
    '--vivamark-ask': '#5a1a96',
    '--vivamark-ask-bg': '#f1e8fa',
    '--vivamark-font-body': '"vivamark Atkinson Hyperlegible", Verdana, system-ui, sans-serif',
    '--vivamark-font-heading': '"vivamark Atkinson Hyperlegible", Verdana, system-ui, sans-serif',
    '--vivamark-radius': '6px',
    '--vivamark-shadow': 'none',
  },
  // Soft lavender, round bubbles, warm orange for what asks you.
  sticker: {
    '--vivamark-scheme': 'light',
    '--vivamark-bg': '#f4f1ff',
    '--vivamark-surface': '#ffffff',
    '--vivamark-text': '#2b2340',
    '--vivamark-muted': '#574f6e',
    '--vivamark-border': '#d9d0fb',
    '--vivamark-accent': '#5a3fd6',
    '--vivamark-accent-bg': '#efeaff',
    '--vivamark-ok': '#17634f',
    '--vivamark-ok-bg': '#d4f7ec',
    '--vivamark-warn': '#7a5200',
    '--vivamark-warn-bg': '#fff4cc',
    '--vivamark-bad': '#a3124f',
    '--vivamark-bad-bg': '#fff0f5',
    '--vivamark-ask': '#9a430a',
    '--vivamark-ask-bg': '#fff0e4',
    '--vivamark-font-body': '"vivamark Bricolage Grotesque", "Trebuchet MS", system-ui, sans-serif',
    '--vivamark-font-heading': '"vivamark Bricolage Grotesque", "Trebuchet MS", system-ui, sans-serif',
    '--vivamark-radius': '16px',
    '--vivamark-shadow': 'none',
  },
  // Two inks on warm paper: blue for the page, pink for you, purple once addressed.
  riso: {
    '--vivamark-scheme': 'light',
    '--vivamark-bg': '#f6f1e7',
    '--vivamark-surface': '#ffffff',
    '--vivamark-text': '#1b1f5e',
    '--vivamark-muted': '#3d4a7a',
    '--vivamark-border': '#0078bf',
    '--vivamark-accent': '#00609a',
    '--vivamark-accent-bg': '#dcecf7',
    '--vivamark-ok': '#5b2f90',
    '--vivamark-ok-bg': '#efe6f8',
    '--vivamark-warn': '#1b1f5e',
    '--vivamark-warn-bg': '#ffe7c2',
    '--vivamark-bad': '#a3124f',
    '--vivamark-bad-bg': '#fff0f7',
    '--vivamark-ask': '#a8106a',
    '--vivamark-ask-bg': '#ffd1ea',
    '--vivamark-font-body': '"vivamark Space Grotesk", "Helvetica Neue", Arial, sans-serif',
    '--vivamark-font-heading': '"vivamark Space Grotesk", "Helvetica Neue", Arial, sans-serif',
    '--vivamark-radius': '0px',
    '--vivamark-shadow': '4px 4px 0 #ffb3d9',
  },
  // Primary colours on parchment: blue addressed, red asks you, yellow at risk.
  bauhaus: {
    '--vivamark-scheme': 'light',
    '--vivamark-bg': '#f3ede1',
    '--vivamark-surface': '#ffffff',
    '--vivamark-text': '#121212',
    '--vivamark-muted': '#4d4a45',
    '--vivamark-border': '#121212',
    '--vivamark-accent': '#1d4f9a',
    '--vivamark-accent-bg': '#dfe7f3',
    '--vivamark-ok': '#1d4f9a',
    '--vivamark-ok-bg': '#dfe7f3',
    '--vivamark-warn': '#121212',
    '--vivamark-warn-bg': '#fbe7a8',
    '--vivamark-bad': '#a81e1b',
    '--vivamark-bad-bg': '#f8dedd',
    '--vivamark-ask': '#a81e1b',
    '--vivamark-ask-bg': '#f8dedd',
    '--vivamark-font-body': '"vivamark Jost", Futura, "Century Gothic", system-ui, sans-serif',
    '--vivamark-font-heading': '"vivamark Jost", Futura, "Century Gothic", system-ui, sans-serif',
    '--vivamark-radius': '0px',
    '--vivamark-shadow': 'none',
  },
  // The design CSS's own look, its greys and colours darkened to the floor as in the review page.
  'smooth-glass': {
    '--vivamark-scheme': 'light',
    '--vivamark-bg': '#f7fbff',
    '--vivamark-surface': '#ffffff',
    '--vivamark-text': '#0b1324',
    '--vivamark-muted': '#56657f',
    '--vivamark-border': '#e1e7f0',
    '--vivamark-accent': '#0369a1',
    '--vivamark-accent-bg': '#e8f5fc',
    '--vivamark-ok': '#047857',
    '--vivamark-ok-bg': '#e6f7f0',
    '--vivamark-warn': '#9a4508',
    '--vivamark-warn-bg': '#fdf2e1',
    '--vivamark-bad': '#be123c',
    '--vivamark-bad-bg': '#fdedf0',
    '--vivamark-ask': '#6d28d9',
    '--vivamark-ask-bg': '#f3edfe',
    '--vivamark-font-body': SYSTEM,
    '--vivamark-font-heading': SYSTEM,
    '--vivamark-radius': '16px',
    '--vivamark-shadow': '0 8px 30px rgba(14, 60, 120, .06)',
  },
};

// ---- pages with the design CSS's own names -------------------------------------------

/**
 * The design CSS (PAGE_CSS in src/guide.ts) reads each page token into a name
 * of its own: --bg, --panel, --fg2 and the rest. Pages written before the
 * page tokens existed declare those same names with fixed values (light, and
 * dark under prefers-color-scheme), so on their own they would never follow
 * the theme. For a page that declares them, the page script sets each name to
 * the token PAGE_CSS gives it, ahead of the page's own rules: the page then
 * follows like one written with today's CSS. A test holds this map to PAGE_CSS.
 */
export const GUIDE_NAMES: Readonly<Record<string, string>> = {
  '--bg': 'var(--vivamark-bg)',
  '--bg-tint': 'var(--vivamark-bg)',
  '--panel': 'var(--vivamark-surface)',
  '--fg': 'var(--vivamark-text)',
  '--fg2': 'var(--vivamark-text)',
  '--muted': 'var(--vivamark-muted)',
  '--line': 'var(--vivamark-border)',
  '--accent': 'var(--vivamark-accent)',
  '--accent-strong': 'var(--vivamark-accent)',
  '--accent-soft': 'var(--vivamark-accent-bg)',
  '--ok': 'var(--vivamark-ok)',
  '--ok-soft': 'var(--vivamark-ok-bg)',
  '--warn': 'var(--vivamark-warn)',
  '--warn-soft': 'var(--vivamark-warn-bg)',
  '--bad': 'var(--vivamark-bad)',
  '--bad-soft': 'var(--vivamark-bad-bg)',
  '--q': 'var(--vivamark-ask)',
  '--q-soft': 'var(--vivamark-ask-bg)',
  '--shadow': 'var(--vivamark-shadow)',
  '--r': 'var(--vivamark-radius)',
  '--r-sm': 'calc(var(--vivamark-radius) * .625)',
  '--ui': 'var(--vivamark-font-body)',
  '--display': 'var(--vivamark-font-heading)',
};

/**
 * A page counts as written with the design CSS when its own styles declare
 * all of these on :root. Any other page, its own look under other names, is
 * left exactly as it is.
 */
export const GUIDE_SIGNATURE = ['--bg', '--panel', '--fg2', '--accent-soft'] as const;

/** The rule that maps the design CSS's names to the page tokens, important so it wins over the page's own :root, light or dark. */
export function guideNamesRule(): string {
  const decls = Object.entries(GUIDE_NAMES).map(([name, v]) => `${name}:${v} !important;`);
  return `:root{color-scheme:var(--vivamark-scheme) !important;${decls.join('')}}`;
}

// ---- contrast ----------------------------------------------------------------------

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
}

/** WCAG contrast ratio of two opaque `#rrggbb` colours. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The pairs a page may put together, each needing 4.5:1: every foreground on
 * the background and the surface, text and muted text on every tint, and
 * each status (and the accent) on its own tint. Returns those that fall short.
 */
export function pageContrastFailures(t: Readonly<Record<PageToken, string>>): string[] {
  const fgs = ['text', 'muted', 'accent', 'ok', 'warn', 'bad', 'ask'];
  const tints = ['accent', 'ok', 'warn', 'bad', 'ask'];
  const pairs: [string, string][] = [];
  for (const f of fgs) pairs.push([f, 'bg'], [f, 'surface']);
  for (const k of tints) pairs.push(['text', `${k}-bg`], ['muted', `${k}-bg`], [k, `${k}-bg`]);
  const out: string[] = [];
  for (const [f, b] of pairs) {
    const fg = t[`--vivamark-${f}` as PageToken];
    const bg = t[`--vivamark-${b}` as PageToken];
    const r = contrast(fg, bg);
    if (r < 4.5) out.push(`${f} on ${b}: ${r.toFixed(2)}`);
  }
  return out;
}
