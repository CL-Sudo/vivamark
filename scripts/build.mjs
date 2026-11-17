// Builds dist/: the CLI and daemon as Node ESM, cli.js and the chunks it loads on demand (runtime dependencies
// stay external and are installed by npm), and the browser code as two
// self-contained scripts next to the review UI's HTML and CSS.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const define = { __VIVAMARK_VERSION__: JSON.stringify(pkg.version) };

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(path.join(dist, 'ui'), { recursive: true });

// Split, so the code cli.ts imports only when needed (the daemon, the linter,
// and the HTML parser, Markdown renderer and WebSocket server they bring in)
// sits in chunks beside cli.js and a command like `wait` starts without
// loading them. Chunks stay in dist/ itself: code that finds cli.js or ui/
// from import.meta.url works from any of them.
await build({
  entryPoints: { cli: path.join(root, 'src/cli.ts') },
  outdir: dist,
  splitting: true,
  chunkNames: 'cli-[name]-[hash]',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  packages: 'external',
  banner: { js: '#!/usr/bin/env node' },
  define,
  logLevel: 'warning',
});
fs.chmodSync(path.join(dist, 'cli.js'), 0o755);

// Pure helpers for the unit tests.
await build({
  entryPoints: [path.join(root, 'src/internal.ts')],
  outfile: path.join(dist, 'internal.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  packages: 'external',
  define,
  logLevel: 'warning',
});

for (const [name, entry] of [
  ['sdk', 'sdk'],
  ['chrome', 'chrome'],
  ['theme', 'theme-boot'],
]) {
  await build({
    entryPoints: [path.join(root, `src/ui/${entry}.ts`)],
    outfile: path.join(dist, 'ui', `${name}.js`),
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'es2020',
    define,
    logLevel: 'warning',
  });
}
fs.copyFileSync(path.join(root, 'src/ui/chrome.html'), path.join(dist, 'ui/chrome.html'));
// One stylesheet: the bundled fonts, the base layout, then each theme, so a
// switch needs no request. Each theme's rules are scoped to its data-theme.
const themesDir = path.join(root, 'src/ui/themes');
const css = [
  path.join(root, 'src/ui/fonts.css'),
  path.join(root, 'src/ui/chrome.css'),
  ...fs.readdirSync(themesDir).filter((f) => f.endsWith('.css')).sort().map((f) => path.join(themesDir, f)),
].map((f) => fs.readFileSync(f, 'utf8'));
fs.writeFileSync(path.join(dist, 'ui/chrome.css'), css.join('\n'));
// The fonts and their licences ship in the package and are served by the daemon only.
fs.cpSync(path.join(root, 'src/ui/fonts'), path.join(dist, 'ui/fonts'), { recursive: true });
