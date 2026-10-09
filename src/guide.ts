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
 * review page should make no outbound requests. The base matches
 * src/ui/chrome.css; the visual classes (.viz and the rest) are for pages only.
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
.superseded { border-left: 3px solid var(--muted); padding-left: var(--s3); margin: 0 0 var(--s3); color: var(--muted); }
.superseded::before { content: "Superseded"; display: block; font: 600 12px/20px var(--ui); letter-spacing: .06em; text-transform: uppercase; }
.options { list-style: none; padding: 0; display: grid; gap: var(--s2); }
.option { background: var(--panel); border: 1px solid var(--line); border-radius: var(--r); padding: 12px var(--s3); margin: 0; }
.option.recommended { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.your-input { position: relative; border: 2px solid var(--q); border-radius: var(--r); background: var(--q-soft); padding: var(--s4) 20px var(--s3); margin: var(--s5) 0 var(--s4); box-shadow: var(--shadow); }
.your-input::before { content: "Your input"; position: absolute; top: -12px; left: var(--s3); padding: 2px 10px; border-radius: 999px; background: var(--q); color: var(--bg); font: 600 12px/20px var(--ui); letter-spacing: .06em; text-transform: uppercase; }
.your-input > h3:first-child, .your-input > h2:first-child { margin-top: 0; }
label.option { display: flex; gap: 12px; align-items: flex-start; cursor: pointer; }
label.option input { margin: .35em 0 0; flex: none; accent-color: var(--q); }
label.option:has(input:checked) { border-color: var(--q); box-shadow: 0 0 0 3px var(--q-soft); }
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
p code, li code, p a, li a { overflow-wrap: anywhere; }
.card.ok { border-top: 3px solid var(--ok); }
.card.warn { border-top: 3px solid var(--warn); }
.card.bad { border-top: 3px solid var(--bad); }
.card > h3:first-child { margin-top: 0; }
.pill.nd { background: transparent; color: var(--muted); box-shadow: inset 0 0 0 1px var(--line); }
/* Visuals (vivamark guide report): inline SVG drawn with the tokens, so light and dark both work. */
.viz { overflow-x: auto; }
.viz svg { display: block; width: 100%; min-width: 30rem; max-width: none; height: auto; }
.viz svg text { fill: var(--fg2); font: 12px var(--ui); }
.viz svg text.muted { fill: var(--muted); }
.viz svg text.strong { fill: var(--fg); font-weight: 600; }
.viz svg .box { fill: var(--panel); stroke: var(--muted); stroke-width: 1; }
.viz svg .box.accent { fill: var(--accent-soft); stroke: var(--accent); }
.viz svg .box.q { fill: var(--q-soft); stroke: var(--q); }
.viz svg .edge { fill: none; stroke: var(--muted); stroke-width: 1.5; }
.viz svg .arrow { fill: var(--muted); }
.viz svg .gridline { fill: none; stroke: var(--line); stroke-width: 1; }
.viz svg .refline { fill: none; stroke: var(--fg2); stroke-width: 1; stroke-dasharray: 4 3; }
.viz svg .bar { fill: var(--accent); }
.viz svg .bar.ok { fill: var(--ok); }
.viz svg .bar.warn { fill: var(--warn); }
.viz svg .bar.bad { fill: var(--bad); }
.viz svg .range { fill: var(--accent-soft); stroke: var(--accent); }
.viz svg .dot { fill: var(--accent); stroke: var(--panel); stroke-width: 2; }
.viz svg g[id]:hover .box, .viz svg g[id]:hover .bar { stroke: var(--fg); stroke-width: 2; }
.viz-caption { font-size: 13px; color: var(--muted); margin: var(--s2) 0 0; }
.legend { display: flex; flex-wrap: wrap; gap: var(--s1) var(--s3); font-size: 13px; margin: 0 0 var(--s2); }
.legend span::before { content: ""; display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 6px; vertical-align: -1px; background: var(--c, var(--accent)); }
table.matrix th, table.matrix td { text-align: center; white-space: nowrap; padding: 6px; }
table.matrix th:first-child, table.matrix td:first-child { text-align: left; white-space: normal; min-width: 10rem; }
table.matrix th.vertical { writing-mode: vertical-rl; transform: rotate(180deg); font-size: 12px; }
@media (max-width: 600px) {
  body { font-size: 15px; }
  main { padding: var(--s4) var(--s3); }
  h1 { font-size: 24px; }
}
`;

const WORKFLOW = `workflow: running a review

The loop
  1. Write the page (see: vivamark guide <playbook>, design, ids) and save it.
     Check it with vivamark lint <file>; for a page with figures, read them
     back and look at vivamark render <file> too (see: vivamark guide
     figures).
  2. vivamark open <file>             opens it in the reviewer's browser
  3. vivamark wait <file>             blocks until the reviewer sends or decides
  4. Edit the saved file. The page reloads in place; notes re-attach.
     After a decision, change everything it changes (see: vivamark guide amend).
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
A choice the reviewer clicked on the page (see: vivamark guide decisions)
arrives as an ordinary note with the control's label as its comment.

Images
  The reviewer can attach screenshots and other images to a note. Each note's
  attachments lists them as {id, path, mime, width, height, bytes}; path is a
  local file (PNG, JPEG, GIF or WebP) you can open to look at it. The text form
  says how many images a note has and where they are. Look at them before you
  act on the note: the screenshot is often the point.

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

Versions and restore requests
  vivamark keeps every version of the file it sees (at open, on saves, at
  each Send, at the end, and whenever the review is read), across all
  reviews of that file, forever. The reviewer can look at any of them
  read-only and compare two.
    vivamark versions <file>              the timeline: n, time, cause, size
    vivamark show <file> --version <n>    that version's content, on stdout
  A note starting "Please restore version <n>" is the reviewer asking for
  that version back. It names the hash and a local path to the content. Run
  vivamark show <file> --version <n> > <file> (or merge by hand if they asked
  for part of it), reply on the note, and wait as usual. vivamark never
  writes the file; you do.
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
  .superseded  text a decision replaced, kept for its reasoning, labelled
            "Superseded" (see: vivamark guide amend)
  .your-input  a card that asks the reviewer for something: every decision.
            Unmistakable on purpose, labelled "Your input" (see: decisions)
  .options  a list of .option blocks to choose from; .recommended marks yours.
            label.option holds a radio or checkbox and its text
  .scroll   a box that scrolls sideways (wide tables)
  table.diff with tr.add, tr.del, tr.hunk and td.ln (see: vivamark guide diff)

Classes for visuals (how to use them: vivamark guide report)
  .viz      the box around one inline SVG chart or diagram (usually .viz.card);
            on a narrow screen it scrolls sideways by itself
            In the SVG: text.muted, text.strong; .box (.accent, .q) for a flow
            box, .edge and .arrow for its arrows; .bar (.ok .warn .bad);
            .dot and .range for a dot or range chart; .gridline and
            .refline on <line> only (a bracket or connector is an .edge
            path); <g class="axis"> around tick labels and an axis title.
            Never a hard-coded colour: these follow light and dark
  .viz-caption  the line under a visual: whose summary, of which section,
            and what it leaves out (see: vivamark guide figures)
  .legend   keys for colours: <span style="--c: var(--ok)">passed</span>
  .card.ok .card.warn .card.bad  a card with a coloured top edge
  table.matrix  a capability grid of word pills; th.vertical stands a long
            column header upright
  .pill.nd  a muted outline pill, for "n/d" (not documented or not checked)

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
  - each diagram part: <g id="node-api"> in inline SVG, one per box or series;
    each arrow a group naming its ends:
    <g id="edge-api-writes-db" data-from="node-api" data-to="node-db">
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
  label or aria-label. A decision's radio or checkbox carries the option's id
  itself (<input id="decision-storage-sqlite">): that id comes back as stable_id. A note on a point of an SVG chart records where in the
  chart it was; give each series (<polyline id="series-errors">) an id.
`;

const DECISIONS = `decisions: ask the reviewer to choose, with real controls

Put every decision in its own .your-input card, so the reviewer sees at once
that this part needs them. Show the options as real radio buttons (checkboxes
when several can be picked, a <select> for a long list), each marked
data-vivamark-suggest:

  <section id="decision-storage" class="your-input">
    <h3>Where should drafts be stored?</h3>
    <div class="options" role="radiogroup" aria-label="Where should drafts be stored?">
      <label class="option recommended">
        <input type="radio" name="decision-storage" id="decision-storage-sqlite"
               data-vivamark-suggest="looks-good">
        <span><strong>SQLite</strong> (recommended): one file, transactions. Cost: a native module.</span>
      </label>
      <label class="option">
        <input type="radio" name="decision-storage" id="decision-storage-json"
               data-vivamark-suggest="looks-good">
        <span><strong>JSON files</strong>: no dependency. Cost: no atomic multi-file writes.</span>
      </label>
    </div>
  </section>

How the reviewer answers
  - They click an option. The review page queues a note for them, marked
    "From the page": intent from the attribute (looks-good here), the option's
    label as the text, its id as stable_id. Another choice in the same group
    replaces it; unticking a checkbox withdraws it.
  - Nothing is sent by the click. The reviewer sees the note, can edit or
    remove it, and sends it with their other notes. Only a real click counts:
    a script on your page cannot answer for them.
  - Wait returns it as an ordinary note: comment "SQLite (recommended): ...",
    intent "looks-good", anchor.stable_id "decision-storage-sqlite",
    anchor.control {role: "radio", name: ...}.
  - Approve with nothing chosen: your recommendation stands. Say so on the
    page ("Approving accepts the recommended options").
  - Once decided, the page shows the decision everywhere it said otherwise
    (see: vivamark guide amend).

The attribute
  data-vivamark-suggest="<intent>" on an <input type="radio">, an
  <input type="checkbox">, or an <option> (or on the <select>, for all its
  options). The intent is change, question, delete or looks-good; looks-good
  means "this one". An option without the attribute withdraws the suggestion.
  Text fields are not supported: free text goes in the reviewer's own note.

Free-form questions: the fallback
  When the answer is not one of a few options ("what should the limit be?"),
  put the question in a .your-input card with an id and no controls. The
  reviewer presses Point, clicks it and writes a note. They can also point at
  any option to say "yes, but ...", with Change or Question.

Rules
  - One question per card, two to four options, each with its cost.
  - Mark at most one option .recommended, and say why in the option itself.
  - Give every control an id built from the decision's id, and a <label>, so
    the answer is readable from stable_id and the text alone.
  - Never pre-select an option: a choice the reviewer did not make is not an
    answer. Make the recommendation visible instead.
  - The controls do nothing on the page itself and need no script of yours.
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
  8. Decisions for the reviewer: each in its own .your-input card, the
     options as radio buttons marked data-vivamark-suggest, an open question
     as a card to point at (see: vivamark guide decisions). Always the last
     section, so the page ends on what you need from the reviewer.

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

const REPORT = `report: what happened, what you found, what it means; drawn as well as written

When: after an investigation, an audit, a migration, a test run, an incident,
a survey of tools, or a long piece of work the reviewer did not watch.

A report is visual by default
  Keep the full text: every finding, table, command and source stays on the
  page. Nothing is summarised away. When a decision changes what the page
  says, change the text too, marked, as vivamark guide amend says. Then add
  visuals where they carry meaning, each just above the section it
  summarises, so the reviewer sees the shape first and the detail under it.
  A visual is your summary of a named section, never a replacement for it,
  and shows what is true now. Where no visual fits, write none. Before you
  draw, read vivamark guide figures: the fidelity checklist, which diagram
  fits which text, and the checks to run before opening.

Sections, in this order
  1. Title, .eyebrow "Report", .lede: the outcome in two sentences. Good or bad
     news first, never last.
  2. At a glance: two cards side by side in a .grid (good and bad, ahead and
     behind, done and not done): .card.ok and .card.bad, each a short list with
     an id per item. Then the status table, if there is one, with .pill words.
  3. Findings: one item per finding, most important first, each with the
     evidence (a command and its output, a file and line, a figure) and how
     sure you are. One id per finding (finding-null-dates).
  4. What changed: files, data, settings you touched, as a table by row.
  5. What was not done or not checked, and why.
  6. Sources and the commands you ran.
  7. Next steps or decisions for the reviewer, last (see: vivamark guide decisions).

Pick each visual by the job its content does
  A process or pipeline   a flow: boxes and arrows in inline SVG, one
                          <g id="flow-build"><title>Build: 1-5 min</title>...</g>
                          per box, so hovering shows the detail. More than four
                          boxes: wrap them into rows, not one long line.
  A number per item       a bar chart: one <g id> per bar with a <title>, the
                          value written at the end of the bar. A status colour
                          always with its word ("6.9 min · failed") and a .legend.
  Durations or sizes      a dot or range chart: a .dot per value, a .range bar
  side by side            from lowest to highest. When values span ten times or
                          more, use a log scale and say so in the caption.
  Who or what can do what a capability grid: table.matrix, a row per
                          capability, a column per tool or option, each cell a
                          word pill: .pill.ok yes, .pill.warn partly, .pill.bad
                          no, .pill.nd n/d. The caption says what "partly" and
                          "n/d" cover.
  Ranked ideas            grouped cards: a .grid of cards per group (by cost,
                          effort or risk), each a numbered list, one id per idea.

A bar, as the pattern for every SVG part
  <figure class="viz card" id="viz-runs">
    <div class="legend"><span style="--c: var(--ok)">passed</span> ...</div>
    <svg viewBox="0 0 640 260" role="img" aria-label="One sentence: what it shows.">
      <g id="viz-run-04"><title>run-04: 6.9 min, failed</title>
        <text x="64" y="40" text-anchor="end">run-04</text>
        <rect class="bar bad" x="72" y="28" width="276" height="16" rx="4"/>
        <text class="muted" x="354" y="40">6.9 min · failed</text></g>
    </svg>
    <figcaption class="viz-caption">Author's summary of <a href="#runs">Runs</a>:
      minutes per run, read from the runs table.</figcaption>
  </figure>

Rules for every visual
  - Say what it is drawn from: the caption starts "Author's summary of" and
    links the section it summarises.
  - A judgement you made to draw it (a grid cell, a colour, a rank) is labelled
    as your reading in the caption, and the table or text it came from stays
    on the page.
  - Add no claim: every number and verdict in a visual is in the text too.
  - Say what it leaves out: when it covers less than its section, the
    caption ends with a coverage line ("Shows 6 of the 9 steps; retries and
    logging are in the text.").
  - Never colour alone: a word beside each colour, a legend for each series.
  - An id on every box, bar, dot and grid row (see: vivamark guide ids);
    role="img" and a one-sentence aria-label on each <svg>.
  - Colours only through the .viz classes and tokens (see: vivamark guide
    design), so it works in light and dark. No fill="#..." in the SVG.
  - Phone width: a viewBox about 640 wide, short labels; the .viz box scrolls
    by itself if it must, the page never sideways.
  - Inline only: no chart library, no script, no external image or font.
  - Before vivamark open: vivamark lint <file>, for a flow, sequence, state
    or architecture figure the read-back, and vivamark render <file> to look
    at what the reviewer will see (see: vivamark guide figures).

What to make pointable
  Every finding, every card item, every table row, every piece of evidence,
  every part of every visual.

Pitfalls
  - Narrating the process in time order. Lead with results.
  - Claims without evidence, or evidence the reviewer cannot check.
  - "All tests pass" without saying which suite and command.
  - Pasting long logs. Quote the lines that matter in <pre>; say where the rest is.
  - A chart for its own sake: two numbers read better in a sentence.
  - Dropping the table once it is drawn: the visual summarises, the table proves.
`;

const FIGURES = `figures: drawing a section without losing its facts

A figure is your summary of one section; the full text stays on the page
under it and carries everything. A faithful figure adds nothing, distorts
nothing, and says what it left out. It need not draw everything.

The checklist
   1. List before you draw. From the section, write down the things it
      names; what each does to another, in the section's own verb; every
      number with its unit; every condition ("if", "only when", "unless");
      every order; every hedge ("about", "may", "not checked"). Check the
      drawing against the list, never the other way round.
   2. Draw only what the list holds. No new box, arrow, number, duration,
      share, step, loop or group. A detail you do not know stays out; an
      item with no stated position sits in its zone and no finer.
   3. Every arrow carries the section's verb ("writes", "retries 3 times").
      A condition sits on the arrow it limits ("only if approved"), not in
      a note beside it.
   4. Numbers exactly as written, with unit and qualifier ("about 20 min",
      "7-59 min"). Never round, convert, total or average unless the text
      does. A number you work out shows its working in the caption
      ("160 = 99 + 60 + 1").
   5. A mark's size is its number: bar length, dot position and funnel
      width are the value times one scale for the whole figure, on one
      axis, bars from zero. A log scale only when the caption says so.
      Write the value beside the mark and in its <title>. Tick labels and
      the axis title go in a <g class="axis">: a scale, not a claim.
   6. Keep the section's names. Shorten, never rename ("Postgres" does not
      become "the database"); a shortened label keeps the full name in its
      <title>.
   7. Keep the distinctions the text makes: done or planned; failed,
      skipped or not reached; measured or estimated; required or optional.
      Each gets its own word or pill, never colour alone.
   8. Keep hedges visible: an "about" or "not checked" in the text shows on
      the mark (~, a dashed outline, .pill.nd) and in the caption.
   9. One drawn part per claim, one connector per relation. No decoration
      that reads as a second path.
  10. Say what you left out. Whenever the figure covers less than its
      section, the caption ends with a coverage line, starting "Shows":
        Shows 6 of the 9 steps; retries and logging are in the text.
      A grouping, rank or colour you chose is named as your reading.
  11. Too much for one picture: an overview plus small multiples. Never
      smaller type or merged boxes.
  12. The aria-label states the section's finding at its own strength:
      "7 of 14 failed", not "most failed".
  13. Read it back before opening (Checks, below): from the figure alone,
      list what it claims. Each claim must be on the list from rule 1, and
      each list item drawn or named in the coverage line.
  14. Pair parts with their source. A part's id echoes its row, finding or
      step (row-canary, viz-canary). An arrow is a group naming its ends:
        <g id="edge-api-writes-db" data-from="node-api" data-to="node-db">
          <path class="edge" d="..."/><text ...>writes</text></g>
  15. Show what is true now. After a decision, change the section and the
      figure together, never just the caption (see: vivamark guide amend).

Pick the diagram by the shape of the text
  Steps in order          a flow, in rows past 4 boxes: the verb on every
                          arrow; box numbers match the text's numbering
  Branching rules         a decision flow: a diamond per condition the text
                          states, each exit labelled in its words; no
                          "else" the text lacks
  Status or lifecycle     a state machine: a box per state the text names,
                          each transition labelled with its trigger,
                          terminal states marked
  Actors exchanging       a sequence: a lane per actor, arrows in the text's
  messages                order, returns dashed, async marked
  Components, and who     architecture: boundaries only where the text
  calls whom              states one (trust, process, machine); show the
                          path the argument hinges on
  Before and after,       two small flows on one scale: only what changes
  option A and B          in the accent colour, the rest identical
  Who can do what         a capability grid (see: vivamark guide report)
  A number per item       bars: value times one scale, from zero, the
                          value at the bar's end, a status colour with its word
  Durations or sizes      a dot or range chart: a dot per value; a log scale
                          only past 10x, and the caption says so
  Counts through stages   a funnel: width as a share of the first stage; a
                          share the text lacks is worked out in the caption
  Part of a whole         one stacked bar: segments add up to the stated
                          total, the sum in the caption
  Dated events            a timeline to scale: marks placed by date, the
                          date words beside them, "~" for approximate dates
  Causes of one effect    a cause-effect chain or a fishbone: only causes the
                          text asserts; suspected causes dashed
  Hierarchy, ownership    a tree or nested boxes: containment only where the
                          text says "part of" or "owns"
  Cases, failure modes    small multiples: the same mini diagram per case,
                          differences in the accent colour
  Two-axis positioning    a 2x2, only when the text gives both axes; an item
                          with no stated position sits in its quadrant only
  Ranked ideas            grouped cards: rank and group as the text gives
                          them; your own ranking named as your reading
  Cycle or feedback       a loop, only when the text says the end feeds the
                          start; name the link
  Definitions, reasoning, no visual: write the sentence
  one or two numbers

Checks, before vivamark open
  vivamark lint <file>  on every page. Exit 0 clean, 1 errors, 2 warnings.
    Errors: an <svg> without role="img" and an aria-label; a caption that
    does not start "Author's summary of" or links no id on the page; a
    duplicate part id; fill="#..." or stroke="#..."; a script; an external
    URL; a number of two or more digits in a figure that is not in the
    linked section's text (or worked out in the caption, rule 4); bars not
    drawn to one scale from the value in their <title>; a shape nothing
    fills, which SVG paints solid black (a warning when the page fills
    through CSS lint cannot fully read). Warnings: label words not in the
    section; no coverage line where the section has more items than the
    figure has parts; an arrow group without data-from and data-to; text
    that likely runs out of its box or the viewBox (an estimate); a term a
    decision supersedes still in the lede, a card or a figure (see:
    vivamark guide amend). Fix every error; fix each warning or know why.
  The read-back (rule 13), for flow, sequence, state and architecture
  figures (vivamark figures marks them "read back: yes"):
    1. vivamark figures <file> prints each figure with its caption and,
       apart, the text of the sections its caption links to.
    2. Give a fresh subagent the figure and caption alone. It lists every
       atomic claim it reads, one per line: who does what to whom, each
       number, condition and order.
    3. Then give it the section text. It marks each claim supported,
       unsupported or overstated, and lists the section's facts that are
       neither drawn nor named in the coverage line.
    4. Fix each unsupported or overstated claim and each unnamed gap; lint
       again. No subagent: list the claims yourself before rereading.
  Look at it rendered: lint and the read-back see the source; render sees
  the drawing and is the judge of paint and size. vivamark render <file>
  (and --dark --width 390) measures it and writes PNGs; look at them.
  vivamark open runs lint too and prints what it finds; it never stops the
  page from opening.
`;

const AMEND = `amend: changing a page after the reviewer decides

A decision changes what the page says. Afterwards the page shows the
decided state wherever a reader looks first, and what it replaced is
marked, not left standing. Nothing is lost: vivamark keeps every version of
the page (vivamark versions <file>), so the page need not keep the old
design on show.

The steps
  1. Find every place that states what the decision replaced: the lede, the
     .meta line, the cards, every figure (labels, <title>s, aria-label,
     caption), tables, body text and the options of other decisions. Search
     the file for the old words and go through every hit.
  2. Record the decision once, dated, near the top, naming what it
     supersedes:
       <section id="decided-storage" data-vivamark-supersedes="JSON files">
         <h2>Decided 2026-10-09: drafts are stored in SQLite</h2>
         <p>What was asked, what was chosen, what it replaces.</p>
       </section>
     data-vivamark-supersedes takes the old terms, separated by ";".
     vivamark lint then warns wherever the lede, a card or a figure still
     says one of them.
  3. Bring the lede, the cards and every figure to the decided state. A
     figure never shows a superseded design as the current one. A caption
     saying the figure is out of date does not fix it: readers take the
     picture first and the caption last, if at all.
  4. Change the text each figure links to, so figure and text agree. Edit
     the passage and say so:
       <p class="callout warn" id="changed-storage">Changed 2026-10-09
         (see <a href="#decided-storage">the decision</a>): ...</p>
     or, where the old reasoning still matters, keep it marked:
       <div class="superseded" id="old-json-storage">...</div>
     A figure's caption may then link the decision as well as the section.
     Never old text unmarked under a new figure, nor a new figure over old
     text: lint's label and number checks pass on either.
  5. Before and after side by side only when the comparison is the point:
     two small figures on one scale, "Before (superseded)" and "Decided",
     the old one never first and never alone.
  6. Lint, read back, run vivamark render <file> and look at the PNGs (see:
     vivamark guide figures, Checks). Then reply on the note that asked.

Pitfalls
  - A new figure for the decision beside the old figure left as it was.
  - A promise that the text is "unchanged" kept after a decision broke it.
  - Fixing the figure and leaving the lede or the cards saying the old thing.
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
     each part a <g id="part-queue"> with a text label, each arrow a <g>
     with data-from and data-to. Draw and check it as vivamark guide figures
     says; it is an architecture or flow figure, so read it back.
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
  { name: 'workflow', summary: 'the open, wait, edit, reply loop; waiting from an agent harness; ended and disconnected; versions and restore', text: WORKFLOW },
  { name: 'design', summary: 'the Smooth glass look: a ready CSS block, light and dark, and layout rules', text: DESIGN },
  { name: 'ids', summary: 'stable ids on everything worth a note, so notes survive edits', text: IDS },
  { name: 'decisions', summary: 'ask for choices in a "Your input" card with real controls; open questions to point at', text: DECISIONS },
  { name: 'amend', summary: 'after a decision: the decided state everywhere, what it replaced marked', text: AMEND },
  { name: 'plan', summary: 'playbook: a plan to approve before building, ending on decisions', text: PLAN },
  { name: 'report', summary: 'playbook: results, findings with evidence, what was not done; visual by default', text: REPORT },
  { name: 'figures', summary: 'drawing a section without losing its facts: the checklist, which diagram, lint and read-back', text: FIGURES },
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
    `comparison, explainer or diff), design and ids; figures before you draw one;\n` +
    `amend after the reviewer decides something the page says.\n` +
    `--json gives the same as data.\n`
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
