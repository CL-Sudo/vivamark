// Pure helpers re-exported for the unit tests (built to dist/internal.js).
export { injectScript, sourceLine } from './html.js';
export { sniffImage } from './image.js';
export { attachmentName, parseDraft, FEEDBACK_SCHEMA, LIMITS } from './schema.js';
export { loopbackAuthority, hostAllowed, originAllowed, tokenProof, tokensEqual, wsToken, bearer } from './guard.js';
export { renderReply } from './daemon.js';
export { Daemon, imageLimits, themeConfig } from './daemon.js';
export { DEFAULT_TEXT_SIZE, DEFAULT_THEME, FOLDING_LAYOUTS, PANEL_KEY, TEXT_SIZES, TEXT_SIZE_KEY, THEMES, THEME_KEY, layoutFolds } from './ui/themes.js';
export { MARK_TOKENS } from './ui/mark-tokens.js';
export { Store } from './store.js';
export { cssEscape, cssPath, loadDoc, renderMarkdownPage, locate, namedTarget, resolveSelector } from './doc.js';
export { diffText, editScript, tokenize } from './diff.js';
export { GUIDE_SCHEMA, PAGE_CSS, TOPICS, guideIndex, skillMarkdown } from './guide.js';
export { browserCommands, browserEntry, defaultBrowser, openBrowser, splitBrowserList } from './browser.js';
export { lintPage, lintExitCode, pageFigures, renderLint, renderFigures, LINT_SCHEMA, FIGURES_SCHEMA } from './lint.js';
export { chromeArgs, findChrome, isWsl, renderPage, renderExitCode, defaultOutDir, CHROME_NAMES, RENDER_SCHEMA, RESOLVER_CHECK_HOST, RenderError } from './render.js';
export { GUIDE_NAMES, GUIDE_SIGNATURE, PAGE_TOKENS, PAGE_COLOURS, PAGE_FACES, PAGE_THEMES, contrast, guideNamesRule, pageContrastFailures } from './ui/page-tokens.js';
export { parseWithLocations } from './parse.js';
