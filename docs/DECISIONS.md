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
