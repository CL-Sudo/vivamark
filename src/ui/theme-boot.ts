// Runs in the review page's <head>, before its stylesheet paints anything:
// applies the theme this browser chose, else the one the server was
// configured with (data-default-theme, set when the page is served), else
// Gumdrop. The review page's own script takes over from here.

import { DEFAULT_THEME, THEME_KEY, themeById } from './themes.js';

(() => {
  const root = document.documentElement;
  let chosen: string | null = null;
  try {
    chosen = localStorage.getItem(THEME_KEY);
  } catch {
    // Storage blocked: the configured default applies.
  }
  const theme = themeById(chosen) ?? themeById(root.dataset.defaultTheme) ?? themeById(DEFAULT_THEME)!;
  root.dataset.theme = theme.id;
  root.dataset.layout = theme.layout;
})();
