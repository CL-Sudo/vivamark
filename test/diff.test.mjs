// The word diff behind "Show changes" (F2): minimal, and reported as
// inserted and removed text at offsets of the new text.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diffText, editScript, tokenize } from '../dist/internal.js';

function lcs(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  return dp[0][0];
}

/** A small deterministic random generator, so a failure can be replayed. */
function rng(seed) {
  let x = seed;
  return () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
}

test('editScript is a shortest edit script that turns a into b', () => {
  const rand = rng(42);
  const alphabet = ['a', 'b', 'c', ' ', '.'];
  for (let round = 0; round < 300; round++) {
    const a = Array.from({ length: Math.floor(rand() * 12) }, () => alphabet[Math.floor(rand() * alphabet.length)]);
    const b = Array.from({ length: Math.floor(rand() * 12) }, () => alphabet[Math.floor(rand() * alphabet.length)]);
    const ops = editScript(a, b);
    const out = [];
    let i = 0;
    let j = 0;
    for (const op of ops) {
      if (op === '=') {
        assert.equal(a[i], b[j]);
        out.push(a[i++]);
        j++;
      } else if (op === '-') i++;
      else out.push(b[j++]);
    }
    assert.deepEqual(out, b, `${a.join('')} -> ${b.join('')}`);
    assert.equal(i, a.length);
    assert.equal(ops.filter((o) => o === '=').length, lcs(a, b), 'minimal: keeps a longest common subsequence');
  }
  assert.equal(editScript(['x'], ['y'], 0), null, 'gives up past the limit');
});

test('diffText reports inserted and removed words at offsets of the new text', () => {
  const before = 'Applet scaffold, save handler and container page.';
  const after = 'Applet scaffold and the container page.';
  const d = diffText(before, after);
  assert.equal(d.coarse, false);
  assert.deepEqual(d.removals, [{ at: 'Applet scaffold'.length, text: ', save handler' }], 'one removal, not three');
  assert.equal(d.inserts.length, 1);
  assert.equal(d.inserts[0].text.trim(), 'the', 'which side keeps the space is a tie');
  for (const ins of d.inserts) assert.equal(after.slice(ins.at, ins.at + ins.text.length), ins.text);

  assert.deepEqual(diffText('same text', 'same text'), { inserts: [], removals: [], coarse: false });
  const ws = diffText('a  b\n c', 'a b c');
  assert.deepEqual([ws.inserts, ws.removals], [[], []], 'whitespace alone is not a change');
  assert.deepEqual(tokenize('Hi, wörld 42!'), ['Hi', ',', ' ', 'wörld', ' ', '42', '!']);
});

test('a very large edit is reported coarsely instead of slowly', () => {
  const before = Array.from({ length: 3000 }, (_, i) => `w${i}`).join(' ');
  const after = Array.from({ length: 3000 }, (_, i) => `v${i}`).join(' ');
  const t = Date.now();
  const d = diffText(before, after);
  assert.ok(Date.now() - t < 5000);
  assert.equal(d.coarse, true);
  assert.equal(d.inserts.length, 1);
  assert.equal(d.removals.length, 1);
});
