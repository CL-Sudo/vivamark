// `vivamark guide`: what an agent needs to write a page worth reviewing and to
// run the review loop. Plain text the CLI prints, one topic at a time, so an
// agent pays only for the topic it reads. The skill stub (skills/vivamark/
// SKILL.md) is generated from this file too: see skillMarkdown().

/** One line on what vivamark is for. Shared by --help, the guide and the skill stub. */
export const TAGLINE = 'point at what you mean on a page; the agent gets each note tied to that spot.';

export const GUIDE_SCHEMA = 'vivamark.guide/1';

export interface GuideTopic {
  name: string;
  summary: string;
  text: string;
}

/**
 * The "Smooth glass" look for review pages, ready to paste into a <style>
 * element. Self-contained: no fonts, images or scripts are fetched, because a
 * review page should make no outbound requests. Matches src/ui/chrome.css.
 */
export const PAGE_CSS = `/* vivamark "Smooth glass" page style (vivamark guide design). Fetches nothing. */
:root {
  color-scheme: light dark;
  --bg: #f7fbff;
  --bg-tint: linear-gradient(135deg, #f6faff, #ffffff 45%, #f3f8ff);
  --panel: rgba(255, 255, 255, .85);
  --fg: #0b1324;
  --fg2: #33415c;
  --muted: #7083a3;
  --line: rgba(15, 40, 90, .08);
  --accent: #0ea5e9;
  --accent-strong: #0369a1;
  --accent-soft: rgba(14, 165, 233, .08);
  --ok: #047857; --ok-soft: rgba(16, 185, 129, .1);
  --warn: #b45309; --warn-soft: rgba(245, 158, 11, .12);
  --bad: #be123c; --bad-soft: rgba(244, 63, 94, .08);
  --q: #6d28d9; --q-soft: rgba(139, 92, 246, .1);
  --shadow: 0 8px 30px rgba(14, 60, 120, .06);
  --r: 16px; --r-sm: 10px;
  --s1: 4px; --s2: 8px; --s3: 16px; --s4: 24px; --s5: 40px;
  --ui: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --measure: 46rem;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0b1220;
    --bg-tint: linear-gradient(135deg, #0b1220, #0f172a 45%, #0b1626);
    --panel: rgba(30, 41, 59, .7);
    --fg: #e6edf7; --fg2: #c1cce0; --muted: #8a9bb8;
    --line: rgba(148, 180, 230, .14);
    --accent: #38bdf8; --accent-strong: #7dd3fc; --accent-soft: rgba(56, 189, 248, .12);
    --ok: #34d399; --ok-soft: rgba(52, 211, 153, .12);
    --warn: #fbbf24; --warn-soft: rgba(251, 191, 36, .12);
    --bad: #fb7185; --bad-soft: rgba(251, 113, 133, .12);
    --q: #c4b5fd; --q-soft: rgba(167, 139, 250, .14);
    --shadow: 0 8px 30px rgba(0, 0, 0, .3);
  }
}
* { box-sizing: border-box; }
html { background: var(--bg); }
body { margin: 0; min-height: 100vh; background: var(--bg-tint); color: var(--fg2); font: 16px/1.6 var(--ui); -webkit-font-smoothing: antialiased; }
main { max-width: var(--measure); margin: 0 auto; padding: var(--s5) var(--s3); }
h1, h2, h3 { color: var(--fg); line-height: 1.25; }
h1 { font-size: 30px; margin: 0 0 var(--s2); }
h2 { font-size: 20px; margin: var(--s5) 0 var(--s2); }
h3 { font-size: 16px; margin: var(--s4) 0 var(--s2); }
p, ul, ol { margin: 0 0 var(--s3); }
li { margin: var(--s1) 0; }
a { color: var(--accent-strong); }
.eyebrow { font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: var(--accent); margin: 0 0 var(--s1); }
.lede { font-size: 18px; }
.meta { font-size: 13px; color: var(--muted); }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: var(--r); padding: var(--s3) 20px; box-shadow: var(--shadow); margin: 0 0 var(--s3); }
.grid { display: grid; gap: var(--s3); grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); }
.pill { display: inline-block; font-size: 12px; font-weight: 600; padding: 2px 10px; border-radius: 999px; background: var(--accent-soft); color: var(--accent-strong); }
.pill.ok { background: var(--ok-soft); color: var(--ok); }
.pill.warn { background: var(--warn-soft); color: var(--warn); }
.pill.bad { background: var(--bad-soft); color: var(--bad); }
.pill.q { background: var(--q-soft); color: var(--q); }
.callout { border-left: 3px solid var(--accent); background: var(--accent-soft); border-radius: var(--r-sm); padding: var(--s2) var(--s3); margin: 0 0 var(--s3); }
.callout.warn { border-color: var(--warn); background: var(--warn-soft); }
.options { list-style: none; padding: 0; display: grid; gap: var(--s2); }
.option { background: var(--panel); border: 1px solid var(--line); border-radius: var(--r); padding: 12px var(--s3); margin: 0; }
.option.recommended { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.scroll { overflow-x: auto; margin: 0 0 var(--s3); border: 1px solid var(--line); border-radius: var(--r); background: var(--panel); }
table { border-collapse: collapse; width: 100%; font-size: 14px; }
th, td { text-align: left; vertical-align: top; padding: var(--s2) 12px; border-bottom: 1px solid var(--line); }
th { color: var(--fg); font-weight: 600; white-space: nowrap; }
tr:last-child > td { border-bottom: 0; }
code { font: .9em var(--mono); background: var(--accent-soft); border-radius: 6px; padding: 1px 5px; }
pre { overflow-x: auto; background: var(--panel); border: 1px solid var(--line); border-radius: var(--r-sm); padding: 12px var(--s3); font: 13px/1.5 var(--mono); }
pre code { background: none; padding: 0; }
table.diff td { font: 13px/1.5 var(--mono); white-space: pre; padding: 0 12px; border: 0; }
table.diff .ln { color: var(--muted); text-align: right; user-select: none; width: 1%; }
table.diff tr.add td { background: var(--ok-soft); }
table.diff tr.del td { background: var(--bad-soft); }
table.diff tr.hunk td { color: var(--muted); padding-top: var(--s2); }
img, svg { max-width: 100%; height: auto; }
@media (max-width: 600px) {
  body { font-size: 15px; }
  main { padding: var(--s4) var(--s3); }
  h1 { font-size: 24px; }
}
`;

const WORKFLOW = `workflow: running a review

The loop
  1. Write the page (see: vivamark guide <playbook>, design, ids) and save it.
  2. vivamark open <file>             opens it in the reviewer's browser
  3. vivamark wait <file>             blocks until the reviewer sends or decides
  4. Edit the saved file. The page reloads in place; notes re-attach.
  5. Say what became of each note:
       vivamark reply <file> --note n_0001 --status addressed -m "Split step 2."
       vivamark reply <file> --note n_0002 --status declined -m "Out of scope: why."
       vivamark reply <file> --note n_0003 --status question -m "Which owner?"
     Only the reviewer resolves a note. Their answer to a question comes back
     as a new note with "answers": "n_0003".
  6. vivamark wait <file> --after <seq> -m "<what you changed>"
     <seq> is the last seq the previous wait printed (seq 4-7: use 7). Without
     --after, wait returns the same notes again; nothing is ever consumed.
  7. When the work is done: vivamark end <file> -m "Merged. Thanks."

What wait returns (exit code, then what to do)
  0  notes, request changes   address each note, reply, wait --after <seq>
  6  approved                 carry on; with notes, treat them as guidance
  7  dismissed                stop; the reviewer closed the round with nothing
  3  ended                    stop waiting. The review is over; do not reopen
                              it unless the person asks. Notes sent before the
                              end were delivered first.
  4  disconnected             the page was open and has been closed for ~10 s.
                              Nothing was consumed. Tell the person, run
                              vivamark open <file> to bring the page back, then
                              wait again with the same --after.
  5  timeout (--timeout)      nothing yet; wait again with the same --after
  1  error                    read stderr
Use --json to read the notes as data: each has id, comment, intent, severity,
anchor (stable_id, selector, quote, lines) and state (anchored, moved, orphaned).

Waiting inside an agent harness
  wait can block for minutes or hours: the reviewer is a person.
  - Best: run it in the foreground. If your tool calls time out, use
    --timeout (say 9m, under the limit) and run it again on exit 5.
  - In the background only through a facility that is sure to wake this same
    agent when the command exits (a harness background task that notifies you
    on completion). Then stop and let it wake you.
  - Never nohup, never a trailing &, never a detached shell: the result goes
    nowhere and nobody wakes you. The reviewer's notes then sit unanswered.
  - Do not poll with status in a loop; wait is the poll, and it is free.

Pointing things out yourself
  vivamark note add <file> --target '#risk-rollback' --text "I guessed this number."
  The reviewer sees it labelled as yours. It reaches wait only if the reviewer
  endorses it or replies to it. Use it for guesses and things you are unsure of.
`;

const DESIGN = `design: the Smooth glass look

White, a faint sky tint, frosted panels, rounded pills, one sky-blue accent.
Paste the CSS below into a <style> element in the page's <head>, and wrap the
content in <main>. It defines tokens (colour, type, spacing) for light and
dark, and an explicit page background.

No external URLs. Do not link web fonts, CDN stylesheets, scripts or remote
images: a review page should make no outbound requests, and the reviewer may be
offline. Inline everything; draw charts and diagrams as inline SVG.

Layout rules
  - Readable line length: content in <main>, at most 46rem wide.
  - Works at phone width: no fixed widths; use .grid for side-by-side cards.
  - Wide tables and code scroll in their own box: wrap a table in
    <div class="scroll">; <pre> scrolls by itself. The page never scrolls
    sideways.
  - One idea per section, a heading per section, the conclusion first.
  - Colour carries meaning only with a word beside it (a .pill reading
    "Blocked", not a red dot alone).

Classes
  .eyebrow  small caps line above the title (the page's kind: "Plan", "Report")
  .lede     the one-paragraph summary under the title
  .meta     muted small print (dates, authors, sources)
  .card     a frosted panel; .grid lays cards out in columns that wrap
  .pill     a status chip; .ok .warn .bad .q for done, at risk, blocked, open
  .callout  an aside; .callout.warn for a warning
  .options  a list of .option blocks to choose from; .recommended marks yours
  .scroll   a box that scrolls sideways (wide tables)
  table.diff with tr.add, tr.del, tr.hunk and td.ln (see: vivamark guide diff)

The CSS
<style>
${PAGE_CSS}</style>
`;

const IDS = `ids: make every part worth a note pointable

Put an id (or data-vivamark-id) on every element a reviewer might want to say
something about:
  - each section (<section id="risks">) and each heading worth a note
  - each decision and each of its options (see: vivamark guide decisions)
  - each table row (<tr id="row-canary">); cells are then named by row and
    column automatically, from the row's first cell and the column header
  - each list item that is a step, a finding, a risk or a question
  - each diagram part: <g id="node-api"> in inline SVG, one per box or series
  - each code block or diff hunk, each callout and each card

Why
  A note carries the element's id as stable_id. When you edit the file, notes
  re-attach by id first, so a note on #step-2 stays on step 2 even after you
  insert a step above it. Without an id a note hangs on a position path
  (body > ol > li:nth-of-type(2)) that the next edit can break, and it shows
  as orphaned. The id is also how you find the place in your source: search
  the file for id="step-2".

Naming
  - Meaningful and stable: name what it is, not where it is. risk-partial-rows,
    option-sqlite, step-deploy; not item-3, div7 or a random hash.
  - Lowercase words joined by hyphens, unique in the page.
  - Keep the id when you rewrite the content; it is still the same thing.
    Give new content a new id. Never move an id to something else: a note on
    it would silently follow to the wrong place.
  - Removed something? Remove its id with it; its notes show as target gone.

id or data-vivamark-id
  Use id unless it would clash with something on the page (a script or a link
  target already using that name); then data-vivamark-id. Both work the same.

Controls and charts
  Buttons, inputs and selects are named by their label, so give each a visible
  label or aria-label. A note on a point of an SVG chart records where in the
  chart it was; give each series (<polyline id="series-errors">) an id.
`;

const DECISIONS = `decisions: let the reviewer choose

A page that needs the reviewer to decide something shows each decision as a
question with its options laid out as blocks to point at:

  <section id="decision-storage">
    <h3>Where should drafts be stored?</h3>
    <ul class="options">
      <li class="option recommended" id="decision-storage-sqlite">
        <strong>SQLite</strong> (recommended): one file, transactions. Cost: a native module.</li>
      <li class="option" id="decision-storage-json">
        <strong>JSON files</strong>: no dependency. Cost: no atomic multi-file writes.</li>
    </ul>
  </section>

How the reviewer answers (tell them in one line on the page if it helps)
  - Press Point, click the option, choose the intent Looks good, type a word
    ("This one") and add the note: that option is chosen. Wait returns it with
    intent "looks-good" and stable_id "decision-storage-sqlite".
  - Change or Question on an option: "yes, but ..." or "what about ...".
  - A note on the decision's section rather than an option: none of these.
  - Approve with no note on a decision: your recommendation stands. Say so on
    the page ("Approving accepts the recommended options").

Rules
  - One question per decision, two to four options, each with its cost.
  - Mark at most one option .recommended, and say why in the option itself.
  - Give every option an id built from the decision's id, so the answer is
    readable from stable_id alone.
  - Do not use radio buttons or checkboxes as the way to answer. Clicking a
    control on the page sends nothing to you; only a note the reviewer sends
    does. A form on the page is at best a visual.
`;

const PLAN = `plan: a plan for the reviewer to approve before you build

When: before work that is costly to redo, touches shared things, or where the
person must choose between approaches. Not for a one-line change.

Sections, in this order
  1. Title, .eyebrow "Plan", .lede: what will exist when this is done, in two
     sentences. What it does not do, if that is a likely misreading.
  2. Context (short): the problem and the facts it rests on, with sources.
  3. Approach: the shape of the solution, a small diagram if it helps.
  4. Steps: an ordered list, one id per step (step-schema, step-api), each
     a deliverable you could check off, with what is touched.
  5. Testing: how you will know each step works.
  6. Risks: each with likelihood, impact and what you will do about it, one id
     per risk (risk-partial-rows).
  7. Open questions: what you do not know yet, one id each (q-owner).
  8. Decisions for the reviewer: each as a question with options to point at
     (see: vivamark guide decisions). Always the last section, so the page
     ends on what you need from the reviewer.

What to make pointable
  Every step, risk, open question, decision and option; tables by row.

Pitfalls
  - Steps that are activities ("investigate X") rather than results.
  - Burying a choice the reviewer must make inside a step's prose.
  - A plan that hides its unknowns: name them in open questions.
  - Restating the whole codebase as context. Link to files; quote only what
    the reviewer needs.
  - Renumbering ids when you insert a step: keep ids, change only the order.
`;

const REPORT = `report: what happened, what you found, what it means

When: after an investigation, an audit, a migration, a test run, an incident,
or a long piece of work the reviewer did not watch.

Sections, in this order
  1. Title, .eyebrow "Report", .lede: the outcome in two sentences. Good or bad
     news first, never last.
  2. Status at a glance: a row of .card or a short table with .pill statuses
     (done, partial, failed), one id each.
  3. Findings: one item per finding, most important first, each with the
     evidence (a command and its output, a file and line, a figure) and how
     sure you are. One id per finding (finding-null-dates).
  4. What changed: files, data, settings you touched, as a table by row.
  5. What was not done or not checked, and why.
  6. Next steps or decisions for the reviewer (see: vivamark guide decisions).

What to make pointable
  Every finding, every status card, every table row, every piece of evidence.

Pitfalls
  - Narrating the process in time order. Lead with results.
  - Claims without evidence, or evidence the reviewer cannot check.
  - "All tests pass" without saying which suite and command.
  - Pasting long logs. Quote the lines that matter in <pre>; say where the rest is.
`;

const COMPARISON = `comparison: options side by side, so the reviewer can choose

When: the reviewer must pick between two or more libraries, designs, vendors
or approaches, and the trade-offs matter more than any single description.

Sections, in this order
  1. Title, .eyebrow "Comparison", .lede: the question and your recommendation
     in two sentences.
  2. What matters: the criteria, each with why it matters here, in order of
     weight. One id per criterion (crit-latency).
  3. The table: options as columns, criteria as rows, inside <div class="scroll">.
     <tr id="crit-latency"> per row; the first cell names the criterion.
     Each cell gives a fact, not just a score, with a .pill if a verdict helps.
  4. One short .card per option (option-redis): strengths, weaknesses, what it
     would cost to adopt and to leave.
  5. Recommendation and the decision (see: vivamark guide decisions), last.

What to make pointable
  Every row (cells are then named by criterion and option), every option
  card, the recommendation, each option of the decision.

Pitfalls
  - Criteria chosen to favour the answer. Include the one your pick loses on.
  - Scores without facts behind them ("4/5").
  - Comparing options that are not real choices. Two to four, all viable.
  - A wide table that pushes the page sideways: always inside .scroll.
`;

const EXPLAINER = `explainer: how something works, for a reviewer to check understanding

When: you are explaining a system, a flow, a concept or a codebase area, and
the reviewer should confirm you got it right or learn from it.

Sections, in this order
  1. Title, .eyebrow "Explainer", .lede: what it is and why it matters, in two
     sentences.
  2. The picture: one inline SVG diagram of the parts and how they connect,
     each part a <g id="part-queue"> with a text label.
  3. The walk-through: one section per step or part, in the order things
     happen, each with an id and a short code excerpt where it helps.
  4. Edge cases and gotchas: one list item each.
  5. Where to look: files, functions, docs, as a list.
  6. What you are unsure of: so the reviewer knows where to look hardest.

What to make pointable
  Every diagram part, every step, every gotcha, every code excerpt.

Pitfalls
  - Starting with history or background before the reader knows what it is.
  - A diagram without labels, or one drawn as an image file (cannot be pointed
    at part by part; an external image is also a network request).
  - Explaining everything at the same depth. Spend words where it is surprising.
`;

const DIFF = `diff: a code change for line-by-line review

When: you want the reviewer to review a change before you commit or merge it,
and a plain git diff in a terminal is not where they want to read it.

Sections, in this order
  1. Title, .eyebrow "Change", .lede: what the change does and why, in two
     sentences.
  2. Summary: the files touched, as a table (file, lines +/-, what changed),
     one row id per file (file-src-cli).
  3. Things to look at first: the risky parts, each linking to its hunk.
  4. The diff, file by file: an <h3 id="file-src-cli"> per file, then each hunk
     as a table.diff in <div class="scroll">:
       <tr class="hunk" id="hunk-cli-1"><td class="ln"></td><td class="ln"></td><td>@@ -164,7 +164,9 @@ cmdOpen</td></tr>
       <tr class="del" id="cli-l170"><td class="ln">170</td><td class="ln"></td><td>-  const next = ...;</td></tr>
       <tr class="add" id="cli-r170"><td class="ln"></td><td class="ln">170</td><td>+  const next = ...;</td></tr>
       <tr id="cli-r171"><td class="ln">171</td><td class="ln">171</td><td>   unchanged</td></tr>
     Escape <, > and & in code. One row per line, one id per row: a note on a
     line then says exactly which line, old or new, in which file.
  5. Testing: what you ran and what it showed.

What to make pointable
  Every line row, every hunk, every file heading, every summary row.

Pitfalls
  - Secrets: scrub lines that look like .env entries, keys, tokens and
    passwords (show NAME=<scrubbed>). The page may be read by others.
  - Ids from position alone that change with every rebase; base them on the
    file and the new line number, and regenerate the page when the diff changes.
  - Huge generated files (lockfiles, snapshots): summarise, do not render.
  - Losing context: keep a few unchanged lines around each change.
`;

const MARKDOWN = `markdown: when a .md file is enough

vivamark opens Markdown too. Each note on a .md file carries lines [first,
last] in the source, so you can find the place without ids. Raw HTML inside
the Markdown is shown as text, not rendered: no ids, no classes, no layout.

A plain .md file is enough when
  - the page is linear prose or a short list: a draft, a short plan, notes;
  - the reviewer will comment on wording, paragraph by paragraph;
  - it already exists as Markdown in the repository and should stay that way.

Write a structured HTML page instead (vivamark guide design, ids) when
  - the reviewer must choose between options (decisions to point at);
  - there are tables to compare, statuses, a diagram or a chart;
  - it is a diff, or longer than a couple of screens;
  - notes must survive heavy edits: ids re-attach better than line numbers.

The .md file can stay the source of truth: generate the HTML page from it for
the review, and carry the agreed changes back.
`;

export const TOPICS: readonly GuideTopic[] = [
  { name: 'workflow', summary: 'the open, wait, edit, reply loop; waiting from an agent harness; ended and disconnected', text: WORKFLOW },
  { name: 'design', summary: 'the Smooth glass look: a ready CSS block, light and dark, and layout rules', text: DESIGN },
  { name: 'ids', summary: 'stable ids on everything worth a note, so notes survive edits', text: IDS },
  { name: 'decisions', summary: 'show choices as options to point at; how the reviewer answers', text: DECISIONS },
  { name: 'plan', summary: 'playbook: a plan to approve before building, ending on decisions', text: PLAN },
  { name: 'report', summary: 'playbook: results, findings with evidence, what was not done', text: REPORT },
  { name: 'comparison', summary: 'playbook: options side by side, criteria as rows', text: COMPARISON },
  { name: 'explainer', summary: 'playbook: how something works, around one labelled diagram', text: EXPLAINER },
  { name: 'diff', summary: 'playbook: a code change, one pointable row per line', text: DIFF },
  { name: 'markdown', summary: 'when a .md file is enough, and when to write an HTML page', text: MARKDOWN },
];

export function findTopic(name: string): GuideTopic | undefined {
  return TOPICS.find((t) => t.name === name);
}

function topicList(indent: string): string {
  const width = Math.max(...TOPICS.map((t) => t.name.length));
  return TOPICS.map((t) => `${indent}${t.name.padEnd(width)}  ${t.summary}`).join('\n');
}

export function guideIndex(): string {
  return (
    `vivamark guide: how to write a page worth reviewing, and how to run the review.\n\n` +
    `Topics (vivamark guide <topic>):\n${topicList('  ')}\n\n` +
    `Start with workflow. Then read the playbook for your page (plan, report,\n` +
    `comparison, explainer or diff), design and ids. --json gives the same as data.\n`
  );
}

/** skills/vivamark/SKILL.md, in the Agent Skills format. It holds no rules: it sends the agent to the guide. */
export function skillMarkdown(): string {
  const topics = TOPICS.map((t) => `- \`${t.name}\`: ${t.summary}`).join('\n');
  return `---
name: vivamark
description: Have a person review a plan, report, comparison, explainer or diff you wrote, in their browser. vivamark - ${TAGLINE} Use it when you want the person's feedback on a document before you act on it, and run \`vivamark guide\` before writing the page.
---

<!-- Generated by scripts/build-skill.mjs from src/guide.ts. Do not edit. -->

# vivamark

vivamark: ${TAGLINE}

You write a page (HTML or Markdown) and open it for review. The person points
at parts of it and writes notes; you receive each note tied to its spot, edit
the file, and answer, until they approve.

This skill holds no instructions of its own. They live in the CLI, so they
always match the installed version. Before writing a page or starting a
review, run:

    vivamark guide

and read the topics you need (\`vivamark guide <topic>\`):

${topics}

\`vivamark --help\` lists every command. If \`vivamark\` is not on your PATH,
ask the person how they run it.
`;
}
