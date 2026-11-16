// Runs in the review page's <head>, before its stylesheet paints anything:
// applies the theme this browser chose, else the one the server was
// configured with (data-default-theme, set when the page is served), else
// Gumdrop. It folds the notes panel away too, if this browser left it so,
// so the page does not first paint with the panel open. The review page's
// own script takes over from here.

import { DEFAULT_THEME, PANEL_KEY, THEME_KEY, themeById } from './themes.js';

(() => {
  const root = document.documentElement;
  let chosen: string | null = null;
  let panel: string | null = null;
  try {
    chosen = localStorage.getItem(THEME_KEY);
    panel = localStorage.getItem(PANEL_KEY);
  } catch {
    // Storage blocked: the configured default applies.
  }
  const theme = themeById(chosen) ?? themeById(root.dataset.defaultTheme) ?? themeById(DEFAULT_THEME)!;
  root.dataset.theme = theme.id;
  root.dataset.layout = theme.layout;
  root.dataset.panel = panel === 'collapsed' ? 'collapsed' : 'expanded';
})();
