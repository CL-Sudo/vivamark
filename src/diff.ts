// A text diff for "what changed since I last sent" (F2): Myers' O(ND)
// algorithm over lines, then over words, spaces and punctuation inside the
// lines that changed, reported as inserted and removed text at offsets of
// the new text. No dependency: the diff runs
// on the page's text, never on markup, so a small one is enough.

export interface TextChanges {
  /** Text in the new version that was not in the old, at offsets of the new text. */
  inserts: { at: number; text: string }[];
  /** Text of the old version that is gone, at the offset of the new text where it was. */
  removals: { at: number; text: string }[];
  /** True when the edit was too large to diff in detail and is reported coarsely. */
  coarse: boolean;
}

type Op = '=' | '-' | '+';

/** Above this many edits, the middle of the text is reported as one replacement. */
const MAX_EDITS = 2000;
const MAX_HUNKS = 400;

export function tokenize(s: string): string[] {
  return s.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) ?? [];
}

/**
 * The shortest edit script from `a` to `b`, or null when it needs more than
 * `limit` edits. Trace rows keep only the diagonals each round can reach.
 */
export function editScript(a: string[], b: string[], limit = MAX_EDITS): Op[] | null {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  if (max === 0) return [];
  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let end = -1;
  outer: for (let d = 0; d <= max; d++) {
    if (d > limit) return null;
    trace.push(v.slice(off - d - 1, off + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[off + k] = x;
      if (x >= n && y >= m) {
        end = d;
        break outer;
      }
    }
  }
  const ops: Op[] = [];
  let x = n;
  let y = m;
  for (let d = end; d >= 0; d--) {
    const row = trace[d];
    const at = (k: number) => row[k + d + 1];
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = d === 0 ? 0 : at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push('=');
      x--;
      y--;
    }
    if (d > 0) {
      ops.push(x === prevX ? '+' : '-');
      x = prevX;
      y = prevY;
    }
  }
  return ops.reverse();
}

/** Lines of the text, each with its line break; joined, they give the text back. */
function lines(s: string): string[] {
  return s.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

const lineKey = (l: string) => l.replace(/\s+/g, ' ').trim();

/**
 * The changes from `before` to `after`, ignoring changes to whitespace
 * alone. Lines are matched first, so an edit in one place is never paired
 * with a stray full stop in another; changed lines are then diffed by word.
 */
export function diffText(before: string, after: string): TextChanges {
  const a = lines(before);
  const b = lines(after);
  const changes: TextChanges = { inserts: [], removals: [], coarse: false };
  let ops = editScript(a.map(lineKey), b.map(lineKey));
  if (!ops) {
    changes.coarse = true;
    ops = [...a.map((): Op => '-'), ...b.map((): Op => '+')];
  }
  let ai = 0;
  let bi = 0;
  let bPos = 0;
  let removed = '';
  let inserted = '';
  let hunkAt = 0;
  const flush = () => {
    if (removed || inserted) wordChanges(removed, inserted, hunkAt, changes);
    removed = '';
    inserted = '';
  };
  for (const op of ops) {
    if (op === '=') {
      flush();
      bPos += b[bi++].length;
      ai++;
      hunkAt = bPos;
    } else if (op === '-') {
      removed += a[ai++];
    } else {
      inserted += b[bi];
      bPos += b[bi++].length;
    }
  }
  flush();
  return changes;
}

/** Word-level changes from `before` to `after`, at offset `at` of the new text, added to `changes`. */
function wordChanges(before: string, after: string, at: number, changes: TextChanges): void {
  const a = tokenize(before);
  const b = tokenize(after);
  // The common head and tail cost nothing to skip and keep the diff small.
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const am = a.slice(head, a.length - tail);
  const bm = b.slice(head, b.length - tail);
  let ops = editScript(am, bm);
  if (!ops) {
    changes.coarse = true;
    ops = [...am.map((): Op => '-'), ...bm.map((): Op => '+')];
  }

  let bPos = at + b.slice(0, head).join('').length;
  let ai = 0;
  let bi = 0;
  let removed = '';
  let inserted = '';
  let hunkAt = bPos;
  const flush = () => {
    if (changes.inserts.length + changes.removals.length < MAX_HUNKS) {
      // Reported without the whitespace at either end, which has nothing to show.
      if (removed.trim()) changes.removals.push({ at: hunkAt, text: removed.trim() });
      const lead = inserted.length - inserted.trimStart().length;
      if (inserted.trim()) changes.inserts.push({ at: hunkAt + lead, text: inserted.trim() });
    }
    removed = '';
    inserted = '';
  };
  // Changes separated only by kept whitespace read as one change ("save handler", not "save" and "handler").
  let keptSpace = '';
  for (const op of ops) {
    if (op === '=') {
      const token = bm[bi];
      const open = removed || inserted;
      if (open && !token.trim()) keptSpace += token;
      else if (open) {
        flush();
        keptSpace = '';
      }
      bPos += token.length;
      ai++;
      bi++;
      if (!removed && !inserted) hunkAt = bPos;
      continue;
    }
    if (keptSpace) {
      removed += keptSpace;
      inserted += keptSpace;
      keptSpace = '';
    }
    if (op === '-') {
      removed += am[ai++];
    } else {
      inserted += bm[bi];
      bPos += bm[bi++].length;
    }
  }
  flush();
}
