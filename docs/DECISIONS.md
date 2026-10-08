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
| Treating the contents | vivamark never opens, parses, previews or renders a plain file. The review page shows a chip with its name and size and never fetches it. The server hands it back, to a request with the session token, only as a sandboxed download (`Content-Disposition: attachment`). | A file the reviewer drops can be anything, including a page with scripts. Showing it inline would run it with the review page's authority. |
| Storage | As images: `attachments/<session>/` in the state directory, named by the sha256 of the bytes, never beside the reviewed file. Plain files end in `.bin`. The name the file had is kept beside it (`<sha256>.json`) after cleaning (last path part, no control or direction-override characters, at most 200 characters), as metadata in `wait` only; it never becomes a path. Identical bytes are stored once and carry the name they were last attached under. | Nothing the reviewer chose decides where a file lands or what opens it. The agent still learns what the file was called. |
| Delivery | `wait --json` lists `{id, path, mime, bytes, name}` for a plain file, local paths only, never inlined. The text form lists every attachment with its path. The event log still only counts attachments. | The agent opens what it needs; output and the log stay small and free of content. |
| Limits | The existing per-file (10 MB) and per-note (25 MB) limits and their overrides (`VIVAMARK_MAX_IMAGE_BYTES`, `VIVAMARK_MAX_NOTE_IMAGE_BYTES`, `max_image_bytes`, `max_note_image_bytes`) cover every attachment, images and files together. Over a limit, or empty, is refused, never cut short. The names stay as they are. | One budget per note is simpler to reason about, and renaming would break existing settings. A cut-short file would mislead the agent. |

This supersedes nothing. It extends the images on notes that the founding
feedback schema left room for (`note.attachments`).
