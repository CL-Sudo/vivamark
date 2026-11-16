// The reviewer's themes: how the review page around the agent's page looks
// and, for three of them, how it is laid out. Shared by the review page, the
// boot script that applies the theme before the first paint, and the daemon,
// which checks a configured default against this list. Presentation only:
// no theme changes what a note is or what reaches the agent.

/**
 * How a theme lays the review out. `panel` is the notes panel beside the
 * page; `index` the same panel as a numbered index (Raster); `chat` a chat
 * thread with the agent (Sticker); `canvas` the page as a sheet on a
 * zoomable table, notes pinned beside it (Pinboard).
 */
export type Layout = 'panel' | 'index' | 'chat' | 'canvas';

export interface Theme {
  id: string;
  name: string;
  layout: Layout;
  /** Drawn before a pin's number in the page, so a pin says what it is ("Note 3"). */
  pinPrefix?: string;
  /** Pins in the page take the note's state as a shape: circle, triangle, square. */
  pinShapes?: boolean;
  /** Buttons say everything they do: "Send 2 notes", not "Send 2". */
  fullLabels?: boolean;
}

/** In the order the switcher lists them. */
export const THEMES: readonly Theme[] = [
  { id: 'gumdrop', name: 'Gumdrop', layout: 'panel' },
  { id: 'raster', name: 'Raster', layout: 'index' },
  { id: 'raw', name: 'Raw', layout: 'panel' },
  { id: 'pinboard', name: 'Pinboard', layout: 'canvas' },
  { id: 'signal', name: 'Signal', layout: 'panel', pinPrefix: 'Note ', fullLabels: true },
  { id: 'sticker', name: 'Sticker', layout: 'chat' },
  { id: 'riso', name: 'Riso', layout: 'index' },
  { id: 'bauhaus', name: 'Bauhaus', layout: 'panel', pinShapes: true },
  { id: 'smooth-glass', name: 'Smooth glass', layout: 'panel' },
];

/** With nothing chosen in the browser and nothing configured. */
export const DEFAULT_THEME = 'gumdrop';

/** Where the review page remembers the reviewer's choice, per browser. */
export const THEME_KEY = 'vivamark:theme';

/**
 * Where the review page remembers whether the notes panel is folded away,
 * per browser, as it remembers the theme. `collapsed` or `expanded`; the
 * default is expanded. Only the panel layout folds.
 */
export const PANEL_KEY = 'vivamark:panel';

export function themeById(id: unknown): Theme | undefined {
  return typeof id === 'string' ? THEMES.find((t) => t.id === id) : undefined;
}
