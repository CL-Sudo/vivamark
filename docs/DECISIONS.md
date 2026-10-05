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
