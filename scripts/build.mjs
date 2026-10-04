// Builds dist/: the CLI and daemon as one Node ESM file (runtime dependencies
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

await build({
  entryPoints: [path.join(root, 'src/cli.ts')],
  outfile: path.join(dist, 'cli.js'),
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

for (const name of ['sdk', 'chrome']) {
  await build({
    entryPoints: [path.join(root, `src/ui/${name}.ts`)],
    outfile: path.join(dist, 'ui', `${name}.js`),
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'es2020',
    define,
    logLevel: 'warning',
  });
}
for (const name of ['chrome.html', 'chrome.css']) {
  fs.copyFileSync(path.join(root, 'src/ui', name), path.join(dist, 'ui', name));
}
