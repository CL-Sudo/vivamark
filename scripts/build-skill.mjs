// Writes skills/vivamark/SKILL.md from the CLI's own text (src/guide.ts), so
// the stub can never say something the CLI does not. Run after npm run build:
//   node scripts/build-skill.mjs            write the stub
//   node scripts/build-skill.mjs --check    exit 1 if the committed stub drifted
// A path after the flags checks or writes that file instead.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { skillMarkdown } = await import(pathToFileURL(path.join(root, 'dist', 'internal.js')).href);

const args = process.argv.slice(2);
const check = args.includes('--check');
const file = args.find((a) => !a.startsWith('--')) ?? path.join(root, 'skills', 'vivamark', 'SKILL.md');
const want = skillMarkdown();

if (check) {
  let have = null;
  try {
    have = fs.readFileSync(file, 'utf8');
  } catch {
    // Missing counts as drift.
  }
  if (have !== want) {
    process.stderr.write(`${path.relative(root, file)} is out of date; regenerate it with: npm run build && node scripts/build-skill.mjs\n`);
    process.exit(1);
  }
} else {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, want);
  process.stdout.write(`Wrote ${path.relative(root, file)}\n`);
}
