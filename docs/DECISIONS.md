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

## 2026-10-08: Notes carry any file, not only images

Asked: "Allow vivamark to upload files." A reviewer was asked for an exported
MT4 "Detailed Report" (an `.htm` file) and could only describe its path,
because notes took nothing but PNG, JPEG, GIF and WebP images.

| Topic | Decision | Why |
|---|---|---|
| What can be attached | Any file, through the same ways as images: the **Attach** button (was **Image**), a drop on the note being written or a queued note, or a paste. Same upload, same token and Origin rules, same delivery: only on a note the reviewer sends. | The reviewer is often asked for a file (an export, a log); describing its path is a workaround. One path for everything keeps one set of rules. |
| Images | Unchanged. A file is an image only when its bytes are a real PNG, JPEG, GIF or WebP; it then keeps its thumbnail and `{mime, width, height}`. Anything else, whatever its name says, is a plain file: `mime` `application/octet-stream`, no width or height. An SVG or HTML file is a plain file. | The content check still decides what is rendered as an image; a name or a declared type never does. |
| Treating the contents | vivamark never opens, parses, previews or renders a plain file. The review page shows a chip with its name and size and never fetches it. The server never hands it back to the browser, even to a request with the session token; the agent reads it from its `path`. | A file the reviewer drops can be anything, including a page with scripts. Showing it inline would run it with the review page's authority. |
| Storage | As images: `attachments/<session>/` in the state directory, named by the sha256 of the bytes, never beside the reviewed file. Plain files end in `.bin`. The name the file had is kept beside it (`<sha256>.json`) after cleaning (last path part, no control or direction-override characters, at most 200 characters), as metadata in `wait` only; it never becomes a path. Identical bytes are stored once and carry the name they were last attached under. | Nothing the reviewer chose decides where a file lands or what opens it. The agent still learns what the file was called. |
| Delivery | `wait --json` lists `{id, path, mime, bytes, name}` for a plain file, local paths only, never inlined. The text form lists every attachment with its path. The event log still only counts attachments. | The agent opens what it needs; output and the log stay small and free of content. |
| Limits | The existing per-file (10 MB) and per-note (25 MB) limits and their overrides (`VIVAMARK_MAX_IMAGE_BYTES`, `VIVAMARK_MAX_NOTE_IMAGE_BYTES`, `max_image_bytes`, `max_note_image_bytes`) cover every attachment, images and files together. Over a limit, or empty, is refused, never cut short. The names stay as they are. | One budget per note is simpler to reason about, and renaming would break existing settings. A cut-short file would mislead the agent. |

This supersedes nothing. It extends the images on notes that the founding
feedback schema left room for (`note.attachments`).

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
| Lint | Three new rules. `unfilled-shape` (error): a path, polyline, polygon, rect, circle or ellipse that nothing fills, outside defs, markers, masks and the like. Fill is inherited, so on the shape or any element around it (the `<svg>` and beyond): no fill attribute or style, none of `.edge .arrow .box .bar .range .dot`, and no rule of the page's own CSS that sets fill and matches it (type, class, id and attribute selectors, descendants; a `:hover`-like state does not count). `text-overflow` (warning): a `<text>` or `<tspan>` line whose estimated width (characters × font size × 0.55, × 1.07 for `.strong`) runs past the viewBox, or out of the `rect.box` beside it in its group at its height; text under a transform is skipped. `superseded-term` (warning): a term listed in `data-vivamark-supersedes` on the decision ("old term; another") still in the lede, a card, or a figure's text, `<title>`s or aria-label, outside the decision and outside `.superseded`. | Measured against Chromium on 332 labels from 29 real pages, 0.55 caught every real overflow, with 4 near misses warned (within 12 px). The width is an estimate, so it is a warning and says "about". Captions are not searched for superseded terms: a caption may say what changed. |

This supersedes nothing. It qualifies "Reports are visual by default"
(2026-10-05) and extends "Figures that keep the text's facts" (2026-10-08).

## 2026-10-09: vivamark render, with a browser already on the machine

Asked (after the three checks above): "yes, build vivamark render after the
three checks". Lint estimates; only a real drawing shows a black shape or a
cut-off label for certain, and the author had not looked before opening.

| Topic | Decision | Why |
|---|---|---|
| What it does | `vivamark render <page.html> [--out dir] [--dark] [--width N] [--json]` draws the saved page headless and writes PNGs: the page (the top 16384 px of a longer one) and each figure, a figure that scrolls sideways on a narrow page drawn whole. It measures in each SVG's own units: a shape drawn black that nothing fills and text outside the viewBox are errors; text out of the `rect.box` beside it and a page that scrolls sideways are warnings. Exit 0, 1, 2 as lint. | The author looks at what the reviewer will see; the measurements are exact where lint's are estimates. |
| Which browser | One already installed: `VIVAMARK_CHROME` (a path, or a name on PATH), else `google-chrome`, `google-chrome-stable`, `chromium`, `chromium-browser` on PATH (and the usual app paths on macOS). None: a clear error, exit 1. Never a download. | A tool that fetches a browser makes outbound requests and grows by hundreds of megabytes. |
| How it drives it | The DevTools protocol over `--remote-debugging-pipe` on the child's own file descriptors, in a throwaway profile removed afterwards, with page script switched off. No debugging port, no new dependency. | A pipe cannot be reached by anything else on the machine; playwright stays a test-only dependency. |
| The network | Off twice. Launch flags: every host name fails to resolve (`--host-resolver-rules=MAP * ~NOTFOUND`), everything else goes to a proxy that is not there, loopback included, and the browser's own background traffic (updates, sync, metrics, safe browsing) is disabled. In the page, the DevTools Fetch domain refuses every request that is not for a local file, and each refused URL is reported as an error. One name, `vivamark-resolver-check.localhost`, skips the proxy so that the resolver rule alone stops it; a `.localhost` name can only ever mean this machine, so even without the rule it reaches nothing beyond it. A test proves a page with external and loopback images, stylesheets and frames reaches nothing: with the refusal, every request fails as refused; without it, the browser reports each one stopped at the dead proxy (`ERR_PROXY_CONNECTION_FAILED`, loopback included) and the resolver check stopped by the rule (`ERR_NAME_NOT_RESOLVED`), so each flag is shown to hold without the browser ever running unguarded. `--json` lists every failed request with its network error. | Non-negotiable 2: vivamark makes no outbound requests, including through a browser it starts. |
| WSL | A browser installed inside WSL. A Windows `chrome.exe` is refused with a message saying so. | The pipe's file descriptors do not cross from WSL to a Windows process, and a debugging port would be reachable by other programs. |
| Where it runs | Only when asked. `open` never runs it and never waits for it; the guide (`figures` Checks, `amend`, `report`, `workflow`) tells the author to run it and look at the PNGs before opening. | A browser start takes seconds and needs a browser; nothing may stand between the reviewer and the page. |
| Where the PNGs go | `--out`, else a folder per page under the system temp directory. Never beside the page, never the page itself. | Non-negotiable 4. |

This supersedes nothing.

## 2026-10-09: Lint is sure or it warns; render is the judge of paint

Four independent checks kept finding CSS forms (`:is(a, b)`, `:not(.x, .y)`,
`:root …`, `:first-child`) for which `unfilled-shape` called a shape black
that a real render drew filled. Asked to choose, the Boss said: "Narrow,
then land".

| Topic | Decision | Why |
|---|---|---|
| `unfilled-shape` | An error only when lint is sure: every page CSS rule that sets `fill`, `fill-opacity` or `all` has a selector lint reads fully (types, `*`, ids, classes and `[attribute]` presence, joined by combinators). When any such rule has a selector it cannot fully read (a pseudo-class, `:root`, `:is(...)`, an attribute value), an unfilled shape is a warning that names the selectors and says to check the page with `vivamark render`. Lint still reads those selectors loosely, so a shape they plainly fill is not reported at all. | A selector engine in lint would never be finished, and a false error tells the author to fix what is not broken. Render draws the page in a browser, so it is sure. |
| Paint and size | `vivamark render` is authoritative for paint (black shapes) and size (clipped and overflowing text); lint estimates and says so. The guide's figures Checks say it. | |

This supersedes the `unfilled-shape` row of "After a decision, the page
shows the decided state" (2026-10-09) where it says the rule is an error
in every case.

## 2026-11-13: Every decision has a field for the reviewer's own words

Asked: "I want to have a text field for every input so that I can convey the
message that is not listed as options". A decision card offered only its
options; anything else meant pointing at the card and writing a separate
note, or editing the queued one.

| Topic | Decision | Why |
|---|---|---|
| Which decisions | Every `role="radiogroup"` holding at least one radio marked `data-vivamark-suggest` gets one field, right after the group, on every page. The author adds nothing. A checkbox or a `<select>` gets none. | The guide already asks for that markup, so every existing page gets the field on reload. A checkbox or select has no "group" to answer in words; pointing still works there. |
| Where it lives | The injected script adds it at run time, in an open shadow root on a `<vivamark-field>` element. The served file still gains exactly one script tag and the saved file is never written. | The page's CSS cannot restyle it; its text is not part of the page's text, so "what changed" offsets and quotes are unchanged; a tag of its own moves no page element's `nth-of-type`, so selectors and source lines are unchanged. It inherits the card's font and colour, so it fits light and dark pages. |
| What it sends | The words join the group's queued "From the page" note: with the option picked, the comment is the label, a line break, then the words, and the anchor stays on the radio; with no option, the comment is the words and the anchor is the decision's card (the nearest element around the group with an id that holds no other decision, else the group). The note gains `choice` `{group, group_id, option, option_id, text}`, right after `comment`. A note without words has no `choice` and is unchanged. | `text` lets an agent tell the words from the label; keeping the label first in `comment` keeps every current reader right, including one that strips a known label off the front. |
| Sending | Typing only queues, like a click. Only a trusted `input` event counts; keys typed in the field do not reach the page's own key handlers. Nothing reaches the agent before Send. | Non-negotiable 3. |
| Field and queue | The queue is the record. The review page tells the frame what each group's queued note holds, so a field empties once its note is sent or removed and, after a reload, gets back its words and the option the reviewer picked (ticked again). An earlier version, or an ended review, shows the fields disabled. | Without that, a reload would show an empty field over a queued note with words, and the next keystroke would replace them. |
| Tests' browser | The browser tests and the screenshot script launch the Chrome named by `VIVAMARK_CHROME` when it is set, and open the review by `localhost` then. | A wrapper there may allow only that name to resolve. |

This supersedes the line of `vivamark guide decisions` that said text fields
are not supported.

## 2026-11-13: Note intent and severity, and page version history, removed

Asked by the Boss: remove two features they no longer want.

| Topic | Decision | Why |
|---|---|---|
| Intent and severity (F4) | Gone. The composer has no Change, Question, Delete, Looks good or Blocking, Important, Nit chips, and a queued note no C Q D G or B I N keys (Delete still removes it). A note no longer has `intent`, `severity` or `motivation` (the W3C name derived from the intent) in the log, `wait --json`, the text form or the review page. A review page loaded earlier that still sends them is accepted and the fields are dropped. Notes logged before keep them on disk, untouched; vivamark reads those notes without them. | The Boss no longer wants them. A note is its words and what it points at. |
| `data-vivamark-suggest` | Stays, and needs no value: its presence marks a control. A value (pages written before say `"looks-good"`) is ignored. | The value was an intent. The attribute itself is how a page offers click-to-answer and the field for the reviewer's own words. |
| Version history | Gone: no snapshot of every version, no `versions/` timeline, no `vivamark versions` or `vivamark show --version`, no Versions picker, read-only earlier versions, Compare with or restore note, no `version.saved` event. | The Boss no longer wants it. |
| What F2 keeps | Only what it had before version history: the file as it was at each Send, once per distinct content, in `snapshots/<session>/`. "What changed" counts from the latest one; each note's `target_changed` compares with the one taken when it was sent. | F2 stays. Its per-note `target_changed` needs the Send each note was sent with, not only the latest. |
| Existing data | Read around, never deleted: the `versions/` folder in the state directory and `version.saved` lines in `events.jsonl` stay as they are and nothing reads `versions/` any more. A review whose last Send was taken while version history existed shows no changes until its next Send. | vivamark does not delete the user's data. Whoever wants the space back deletes `versions/` by hand. |

This reverses F4 of the founding decisions (2026-10-04) and the five
decisions of "Version history for a page" (2026-10-05): what is kept,
scope, retention, restore and viewing. Send snapshots move back from
`versions/` to `snapshots/<session>/`. In "After a decision, the page shows
the decided state" (2026-10-09), the reasons that point to version history
and `vivamark versions` no longer hold; the rule itself stands, and an old
passage worth keeping goes in a `.superseded` block as before. In "Every
decision has a field for the reviewer's own words" (2026-11-13), the fields
are now disabled only on an ended review, as there are no earlier versions
to show.

## 2026-11-14: A daemon stops on time

Test runs left daemons running after their state directories were deleted,
and those daemons no longer stopped on SIGTERM. Each was waiting for one last
connection to close, one the loopback relay had dropped, so it never closed.

| Topic | Decision | Why |
|---|---|---|
| Stopping | A daemon that stops (`vivamark stop`, SIGTERM, SIGINT, idle) still closes its pages and answers its waiting commands, then exits within 2 s, even if a connection is still open. A second signal while it stops changes nothing. | It waited for every connection to close. One page that stopped answering, or one stalled loopback connection, kept it running for good, and every later signal waited behind the first. |
| State directory gone | Every 2 s the daemon checks that its state directory is still there and is the same directory. If it was removed or replaced, the daemon stops. | Its `server.json` went with the directory, so no command can find it, stop it or read its log. |
| Unchanged | The idle timeout, the port, `server.json`, the CLI and the wire format. | |

This extends "One server per state directory" (2026-10-05).

## 2026-11-14: Themes for the review page, Gumdrop by default

Asked: "can you build the following themes so that I can switch whenever I
feel like in vivamark? raster, raw, pinboard, signal, sticker, riso, bauhaus,
gumdrop." Answers to the follow-up questions: full themes now, each with its
own layout and interaction as designed; bundle the fonts; Gumdrop is the
default. The looks come from the design study's second round.

| Topic | Decision | Why |
|---|---|---|
| Which themes | Nine: Gumdrop, Raster, Raw, Pinboard, Signal, Sticker, Riso, Bauhaus, and Smooth glass, the one look until now, kept as a choice. Three change the layout as well as the look: Raster lays the notes out as a numbered index on a 7/5 grid, Sticker as a chat thread with a face for the agent, and Pinboard shows the page whole as a sheet on a zoomable table with the notes pinned beside it (narrower than 861 px, it stacks). | The Boss wants to switch as they like; each theme is what its mock and notes showed, not only its colours. |
| Switching | A Theme picker in the bar. The theme applies at once, with no reload: the draft, the queue, the page and its scroll position stay. The browser remembers the choice (`localStorage`). | A look is a viewing preference, like Show marks. |
| The default | Gumdrop. `VIVAMARK_THEME`, or `"theme"` in the config file, sets another, read when the server starts; an unknown name is reported and ignored. A choice made in a browser wins over it. No new CLI flag. | The same place as every other setting of the server; the CLI contract is unchanged. |
| Presentation only | No theme changes the notes, the log, `wait` or any JSON an agent reads, or what reaches the agent. Every theme has every control. | Themes are how the review looks, not what it does. |
| The floor | Every theme keeps Signal's rules: a visible focus ring, text at 4.5:1 or better (3:1 for large text), every state in words or a shape as well as colour, real labels on buttons, no motion with `prefers-reduced-motion`. A browser test checks each theme at desktop and phone width. Smooth glass's grey, purple and send blue are darkened to pass. | Recommended by both rounds of the study; a look must not cost a reader the page. |
| Marks in the page | The marks the page script draws (targets, pins, highlights, change marks, the outline while pointing) take every colour and shape from the theme's `--mk-*` tokens, sent to the page with each switch. The page script has no colours of its own beyond plain ink before the first. Bauhaus's pins take the note's state as a shape; Signal's say "Note 3". | The marks were hard-coded sky blue and yellow; a theme that left them so would not be whole. |
| Fonts | Each theme's typeface ships in the package as a Latin WOFF2 file (SIL Open Font Licence 1.1, licence beside it, listed in THIRD-PARTY-NOTICES.md) and is served by the daemon from `/_vivamark/fonts/`. About 300 KB in all; a face loads only when its theme is used. | "Bundle the fonts", and non-negotiable 2: the review page fetches nothing from anywhere else, which a test checks. |
| Pinboard and the page | While Pinboard's canvas is on, the page script reports the page's height and where each noted place is, in page pixels, and passes the wheel to the table. Positions only. The sheet keeps its place in the document (moving the frame would reload the page). | The canvas cannot read the page, which runs in a sandboxed frame of its own origin. |

This supersedes the "Look" row of the founding decisions (2026-10-04):
Smooth glass is no longer the only look of the review page, and no longer
the default. The guide's `design` topic, the look for pages agents write,
is unchanged.

## 2026-11-14: A page can follow the reviewer's theme (page tokens)

The Boss opened `examples/plan.html` and saw its content, light and generic,
not matching the review page's theme. Asked how content should follow the
theme, they chose: "Opt-in tokens (Recommended): vivamark sends the active
theme's colours and fonts to the page as CSS variables on every switch, as
it already does for its marks. The example pages and vivamark guide use
them, so pages written that way follow the theme and switch live. Pages
with their own design are left alone." They rejected forcing the theme onto
every page, and fixing only the examples.

| Topic | Decision | Why |
|---|---|---|
| The tokens | Twenty custom properties named `--vivamark-*`, the same set in all nine themes: `bg`, `surface`, `text`, `muted`, `border`, `accent` and `accent-bg`, `ok`, `warn`, `bad` and `ask` each with a `-bg` tint, `font-body`, `font-heading`, `radius`, `shadow` and `scheme`. The values are in `src/ui/page-tokens.ts`. | Enough for a page in the design CSS to look like the theme (colours, type, a card's corners and shadow) and for a table badge; small enough to learn from one table. A prefix of our own, so a page's own names never clash. |
| Opt-in | A page opts in by reading a token, with its own value after the comma (`var(--vivamark-bg, #fff)`), which shows when it is opened anywhere else. A page that reads none renders exactly as without vivamark, which a test checks element by element. | "Pages with their own design are left alone." The saved file stays the source of truth and opens the same without vivamark. |
| How they reach the page | By the marks' route: the review page sends them with the mark tokens in its `theme` message on every switch. For the first paint, the frame's URL names the theme (`vmtheme`); the daemon checks it against the list and puts it on the one injected script tag (`data-vivamark-theme`), and the page script applies that theme's set before the page's body is parsed. They sit in a stylesheet the page script adopts and sets through the CSSOM: nothing is added to the page's markup. No page-side script, and no change to the frame's sandbox. | No flash of the page without the theme, on first load or after an edit reloads it. |
| Fonts | The font tokens name the theme's bundled faces, registered in the page as "vivamark Lexend" and so on, so a page that asks for "Lexend" itself still gets its own. A face loads only when a page uses it, from `/_vivamark/fonts/`. Those responses carry `Access-Control-Allow-Origin: null`: fonts are fetched with CORS, and the page's frame has an opaque origin. Only the font files carry it. Smooth glass, which bundles no face, names Inter and the system's faces, as its review page does. | Non-negotiable 2: nothing is fetched from anywhere else. The fonts are the package's own OFL files, with nothing private in them. |
| The floor | Every theme's tokens are opaque colours, each text colour at 4.5:1 or better on the background, the surface and every tint, and each status on its own tint (a unit test). The browser test that checks each theme at desktop and phone width also checks the example page's colours, fonts and contrast. | The same floor as the review page. |
| Who uses them | The design CSS in `vivamark guide design`, both examples, and the template that shows Markdown pages. Each keeps its old look as the fallback. | "The example pages and vivamark guide use them." |
| Presentation only | Nothing changes in the notes, the log, `wait`, any JSON an agent reads, or the CLI contract. The review page's own look per theme is unchanged. | As for the themes. |

This supersedes the last sentence of the themes entry above: the guide's
`design` topic now reads the page tokens, though opened on its own a page
in that CSS looks as it did.
