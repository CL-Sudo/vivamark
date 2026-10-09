# Decisions

Each entry records what was decided, when, and why. Change a decision by adding
a new entry that supersedes it, not by editing the old one.

## 2026-10-04: Founding decisions

| Topic | Decision | Why |
|---|---|---|
| Name | **vivamark** ("viva", alive, plus mark) | The tool makes a flat document alive and interactive, not just marked up. Free on npm and GitHub at the time of checking; no command clash. |
| Approach | Build fresh. Borrow specific parts from lavish-axi (MIT) and pointback (Apache-2.0) with attribution. Not a fork. | A small codebase we own, carrying their lessons. Neither has the supervisor surface (status, labels, cursors, events) we need. |
| Owner, licence | Personal GitHub, MIT | |
| Runtime | TypeScript on Node 20+, distributed with npx; Bun-compiled single binaries later | One language for CLI, server and browser code; zero-install for every agent ecosystem. |
| Network | Loopback only, with **no** option to listen elsewhere | A review server can read local files; it must never be reachable from another machine. |
| Telemetry | None, ever | A tool that reads private project pages must not phone home. |
| Publishing | Not in the tool | Removes the most dangerous command entirely. |
| Feedback model | Non-destructive, append-only log with per-reader cursors | Re-running a wait is always safe; a supervisor can read notes without taking them from the agent; an audit trail for free. |
| Whiteboard (Mermaid to Excalidraw) | Later, opt-in | Heaviest dependency; not needed for the first version. |
| Diffs on review pages | Full diffs, with `.env`-like lines scrubbed | |
| Look | "Smooth glass": white, faint sky tint, frosted panels, rounded pill buttons | Clean, white and smooth; see `design-language/05-glass.png`. |

### In the first version

Beyond the core loop (open, annotate elements and text, send, wait, reply, live
reload), the first version includes these features, which lavish-axi lacks
(details in `research/similar-tools.md`, section 3):

- **F1** Approve / request changes / dismiss, returned to the agent as a decision.
- **F2** Automatic "what changed since I last sent" highlighting.
- **F3** Notes re-attach after edits, or show as "target gone".
- **F4** Note intent (change, question, delete, looks good) and severity.
- **F5** Markdown files, with notes tied to line ranges.
- **F6** The agent can ask back on a single note, plus a "whose turn" field.
- **F7** Notes added by the agent or tools, shown to the reviewer, never sent back unless the reviewer acts.
- **F8** Point at a table cell, a control or a chart point by name.

### Still open

- Domains, Homebrew formula name and trademark search for "vivamark".
- The exact CLI surface and feedback schema (draft in `research/design-proposal.md`, section 2.3, where it uses the working name "stet").

## 2026-10-05: Reports are visual by default

| Topic | Decision | Why |
|---|---|---|
| Report pages | `vivamark guide report` teaches a visual report: the full text and tables stay, and inline SVG/HTML visuals go above the sections they summarise, each captioned as the author's summary of a named section. The guide's CSS carries the classes for them. | The reviewer sees the shape first and can still check every claim against the text under it. |
| Visuals | Never a chart library or any external resource. | Keeps the no-outbound-requests promise. |

## 2026-10-05: Version history for a page

Asked: "can we make it so that we can go back to any version of the history
changes for a particular vivamark page?"

| Topic | Decision | Why |
|---|---|---|
| What is kept | Every version the server sees: when a review opens, on each save the watcher sees, at each Send, when a review ends, and whenever the review is read (`status`, the review page, `wait`), so a save made with no page open is caught at the next read. A Send is always an entry; any other cause only when the content changed. | Sends alone (the F2 snapshots) miss the agent's intermediate edits, which are what a reviewer wants to go back to. |
| Scope | One timeline per reviewed file, keyed by its real path, across all its reviews. Send snapshots kept before this decision are listed in it. | A reopened file is the same document; its history should not reset with the session. |
| Retention | Nothing is ever deleted. Content is stored once per distinct hash. | History that silently expires cannot be trusted. The cost is one copy of each distinct version, noted in the README. |
| Restore | Both: on an old version the reviewer can queue an ordinary note asking the agent to restore it (sent only with their next Send), and `vivamark show <file> --version N` prints a version for the agent to write back. `vivamark versions` lists the timeline. vivamark itself still never writes the reviewed file. | Keeps "only a deliberate Send reaches the agent" and "vivamark never writes the reviewed file" while making a restore one step for each side. |
| Viewing | Old versions are shown read-only in the review page, through the same one injected script tag. Notes cannot be added or sent on them (the server refuses a Send that names an old version). Two versions can be compared with Show changes. Old versions use the images and styles beside the file as they are now. | Notes belong to the page as it is; an old version is for looking and comparing. Snapshotting assets is a larger change than this needs. |

This supersedes nothing. It extends F2: Send snapshots now live in the file's
version store (`versions/` in the state directory) instead of
`snapshots/<session>/`, which is still read for snapshots made before.

## 2026-10-05: One server per state directory

A server that missed one health check was replaced by a second one on a
random port while the first kept running. The review page stayed on the
first, the CLI moved to the second, and `wait` answered `disconnected` while
the reviewer's sent notes sat unread.

| Topic | Decision | Why |
|---|---|---|
| Starting a server | The CLI starts a new server only when the one in `server.json` is gone: its process has exited, or nothing accepts connections on its port. One that is alive but slow gets up to 10 s more to answer; if it still does not, the command fails (exit 1) naming its pid and port, and starts nothing. | The review pages stay connected to the running server. A second one would answer from a log that never sees their notes. Failing loudly is better than answering wrongly. |
| The server itself | A server claims `server.json` with an atomic create that fails if the file exists. If another server that may still be running holds it, the new one logs why and exits without serving. A file left by a server that is gone is replaced. | Two commands starting at the same moment, or a slow check, cannot leave two servers on one state directory. The CLI was the only other writer of `server.json`; it no longer deletes it. |
| `stop` | On a server that is running but not answering, `stop` says so and names the pid to kill, instead of "not running". | It was running; saying otherwise hides the problem. |
| Port fallback | Unchanged: a busy preferred port still falls back to a random one. | The sandbox case it serves has no other server running. |

This supersedes nothing.

## 2026-10-06: The reviewer's browser follows BROWSER

Asked: "fix vivamark to respect BROWSER". On WSL, `open` started the Windows
default browser while the reviewer uses another.

| Topic | Decision | Why |
|---|---|---|
| Which browser | `open` starts the commands in `BROWSER` in order, then the platform default as before. Entries are separated by `:` (`;` on Windows), keeping a drive letter's colon. An entry without `%s` is one program, spaces and all, given the URL; one with `%s` is split into words (quotes group) with `%s` as the URL. Run without a shell; an entry that fails to start gives way to the next. `--no-browser` still opens nothing. | The common convention of `xdg-open` and Python's `webbrowser`, made safe for WSL's `/mnt/c/Program Files/...` paths without quoting, and with no shell to interpret the URL. |

This supersedes nothing.

## 2026-10-08: Figures that keep the text's facts

Asked: how to draw a section "without losing any of the meanings and facts",
and whether to check it.

| Topic | Decision | Why |
|---|---|---|
| What fidelity means | A figure adds nothing, distorts nothing, and says what it left out. The full text under it carries everything; the figure need not draw all of it. | Drawing every fact would take many figures per section and defeat the at-a-glance purpose. The page already keeps the full text. |
| The coverage line | Whenever a figure covers less than its section, its caption ends with a line saying what it shows and what is left to the text ("Shows 6 of the 9 steps; retries and logging are in the text."). | What a figure leaves out is then stated, not silently lost. |
| The guide | `vivamark guide figures`: a 14-rule checklist (list the section's facts first, draw only from the list, read it back) and a map from the shape of the text to a diagram and its drawing rule. `report` points to it. Arrows are `<g>` groups with `data-from` and `data-to`; tick labels sit in `<g class="axis">`. | Gathered from published diagram and chart-faithfulness work: list, draw from the list, check back. Machine-readable relations let a check rebuild the graph without vision. |
| Checking | `vivamark lint`: deterministic, offline, never writes the page. Errors for markup and provenance breaks, numbers not in the linked text, bars not on one scale; warnings for label words, a missing coverage line, arrows without ends. Exit 0, 1 errors, 2 warnings only. `vivamark open` runs it and prints what it finds, and opens the page anyway. | Cheap and catches most invented numbers and markup breaks, but not wrong or missing relations. A warning must not stand between the reviewer and the page. |
| The read-back | For flow, sequence, state and architecture figures, the authoring agent has a fresh reader list the claims of the figure alone, then compares them with the section. `vivamark figures` prints each figure and, apart, the text it summarises. vivamark itself calls no model. | Relations are the main failure and need reading, not counting. Keeping the model call with the agent keeps vivamark free of outbound requests. |
| Which rules govern | vivamark pages follow vivamark's own guide (inline SVG, tokens, offline, no script), not the conventions of other diagram tools or skills. | Tools that produce image files or need a server cannot give inline, pointable, offline figures. |

This supersedes nothing. It extends "Reports are visual by default".

## 2026-10-09: After a decision, the page shows the decided state

A report page recorded a decision in a new dated section and its own small
figure, but left the main figure drawing the design the decision replaced,
with only a caption note. The reviewer read the main figure as the current
design. The same figure had a bracket drawn as a `.gridline` path, which
the page CSS left unfilled, so it rendered as a solid black bar, and two
labels ran out of their box and the viewBox. Lint passed the page clean.

| Topic | Decision | Why |
|---|---|---|
| Amending a page | After a decision, the page shows the decided state wherever a reader looks first: the lede, the cards and every figure. The text a figure links to changes with it, each change marked (a dated "Changed" callout, or the old passage kept in a `.superseded` block). A figure never shows a superseded design as the current one; a caption note is not a fix. Old and new side by side only when the comparison is the point. `vivamark guide amend` has the steps; `workflow`, `decisions`, `report` and `figures` (rule 15) point to it. | "The full text stays" and "a figure adds no claim its section lacks" together kept the old figure, because the old section text could not change. Version history keeps every version of the page, so the page itself need not keep a superseded design on show. |
| The 2026-10-05 "full text stays" rule | Qualified: the full text stays, but a decision may change it, marked. | The record of what the page said before lives in `vivamark versions`. |
| Lines in figures | `.gridline` and `.refline` get `fill: none` and are for `<line>` only; a bracket or connector is an `.edge` path. | A path with no fill is painted black. |
| Lint | Three new rules. `unfilled-shape` (error): a path, polyline, polygon, rect, circle or ellipse that nothing fills (no fill attribute or style on it or a group, no `.edge .arrow .box .bar .range .dot`, no class the page's own CSS fills), outside defs, markers, masks and the like. `text-overflow` (warning): a `<text>` or `<tspan>` line whose estimated width (characters × font size × 0.55, × 1.07 for `.strong`) runs past the viewBox, or out of the `rect.box` beside it in its group at its height; text under a transform is skipped. `superseded-term` (warning): a term listed in `data-vivamark-supersedes` on the decision ("old term; another") still in the lede, a card, or a figure's text, `<title>`s or aria-label, outside the decision and outside `.superseded`. | Measured against Chromium on 332 labels from 29 real pages, 0.55 caught every real overflow, with 4 near misses warned (within 12 px). The width is an estimate, so it is a warning and says "about". Captions are not searched for superseded terms: a caption may say what changed. |

This supersedes nothing. It qualifies "Reports are visual by default"
(2026-10-05) and extends "Figures that keep the text's facts" (2026-10-08).
