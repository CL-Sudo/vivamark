declare const __VIVAMARK_VERSION__: string | undefined;

/** Replaced at build time from package.json. */
export const VERSION: string = typeof __VIVAMARK_VERSION__ === 'string' ? __VIVAMARK_VERSION__ : '0.0.0-dev';
