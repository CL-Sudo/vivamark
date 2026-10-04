# Similar tools to Lavish: market and feature survey

Status: research only. Nothing was built, installed globally, starred, forked, commented on or published.
Date: 2026-10-04. Every star count, push date and download figure below was read on **2026-10-04**. Dates are the repo's last push (`pushed_at`), which is the "last activity" here.

Method:
- **GitHub:** about 60 `gh search repos` queries (authenticated, paced under the 30-a-minute search limit). Phrasings included "annotate html agent feedback", "visual feedback coding agent", "element picker claude code", "agent artifact review", "human in the loop review ui agent", "plan review agent browser", "mcp human feedback", "markdown annotate agent", "review html artifact", plus project names. Then `gh api repos/<owner>/<name>` on every candidate to confirm it exists and to read stars, push date and licence, and `gh api repos/<r>/readme` to read the README.
- **npm:** `npm search` across 10 phrasings, `npm view`, and the npm downloads API (last 30 days).
- **PyPI:** the JSON API for one package found through web search.
- **Web:** about 12 WebSearch queries (Hacker News "Show HN", blogs, docs sites), plus WebFetch or `curl` on product and docs pages.

Every repo in the tables was confirmed through the GitHub API, unless the row says otherwise. Section 1.6 lists what I saw only in search results and could not confirm.

Read first, so this report does not repeat them: Lavish `README.md` and `VISION.md` (clone at `scratchpad/lavish-axi`, v0.1.81), and `state/reviews/own-review-tool-design.md` (called "the design" below).

---

## 1. Landscape

**62 projects besides Lavish are listed** across five kinds, plus 7 prior-art references. All but two were confirmed through the GitHub API. The two exceptions are the npm package `markloop`, whose repo now returns 404, and the hosted markloop.io, which has no public repo. "Channel" means how the human's feedback reaches the agent.

### 1.1 Direct competitors: a human reviews agent-written HTML or Markdown in a browser, and the feedback returns to the agent

| Project | Stars | Last push | Licence | What it is | Channel | Notable |
|---|---|---|---|---|---|---|
| [kunchenguid/lavish-axi](https://github.com/kunchenguid/lavish-axi) (baseline) | 3,959 | 2026-10-03 | MIT | Local HTML-artifact review loop | CLI long poll | 53.5k npm downloads a month. Whiteboard, layout inbox, share to ht-ml.app. Opt-out telemetry. |
| [Abhijeet34/pointback](https://github.com/Abhijeet34/pointback) | 0 | 2026-10-03 | Apache-2.0 | "Point at anything on a rendered HTML page and the agent that made it gets your note" | CLI long poll, JSON | Created 2026-09-03; 70 commits; one maintainer; v0.1.4; 171 npm downloads a month. **The closest match to the design.** See section 5. |
| [backnotprop/plannotator](https://github.com/backnotprop/plannotator) | 9,124 | 2026-10-03 | Apache-2.0 | Annotate plans, Markdown, HTML, diffs and PRs | Harness hooks (Claude Code `ExitPlanMode` PermissionRequest, Codex Stop hook), plugins, stdout | Market leader. Supports 9 agents. Approve or deny gate, plan diff, question blocks, external-annotation API. Hosted Workspaces upsell. |
| [tomasz-tomczyk/crit](https://github.com/tomasz-tomczyk/crit) | 1,168 | 2026-10-03 | MIT | "Point at the line. Tell the agent." Markdown, HTML, git diff, and a live app through a proxy | Background CLI blocks until **Finish**; review file in `~/.crit/reviews`; `crit comment --reply-to` | Go single binary. Round-to-round diff, threads, GitHub PR sync, finish hooks, optional share to crit.md. |
| [arDaraz/artifact-review](https://github.com/arDaraz/artifact-review) | 1 | 2026-09-28 | MIT | "A local-first visual review loop for agent-authored HTML artifacts" | Agent Skill with a local server (transport not checked) | Lavish-like feature set: direct text edits, form choices, Mermaid whiteboard, per-draft delivery states. |
| [fernandomenuk/canvas-flow](https://github.com/fernandomenuk/canvas-flow) | 25 | 2026-07-08 | NOASSERTION | "Point at it. Don't screenshot it." HTML-artifact review | CLI long poll | Plainly Lavish-shaped (`poll`, `share` to ht-ml.app, layout gate). Adds visual **version checkpoints and side-by-side compare**. |
| [frederikschjoedt/artifact-annotator](https://github.com/frederikschjoedt/artifact-annotator) | 0 | 2026-09-17 | MIT | Annotate Markdown or HTML and return one bundle | CLI blocks; prints Markdown and a JSON path | Tags notes as change, question or note. Markdown source line ranges. Records the SVG group and coordinates on a click. |
| [u-ichi/reviewable-html-workbench](https://github.com/u-ichi/reviewable-html-workbench) | 298 | 2026-09-10 | MIT | Claude Code and Codex plugin for reviewable HTML documents | Agent reads thread JSON | Thread status `needs_agent_review` / `needs_user_reply` / `resolved` ("whose turn"). Resolution-gated edits. |
| [lbug/web-artefacts](https://github.com/lbug/web-artefacts) | 0 | 2026-09-30 | MIT | Local artifact gallery; publish over MCP and comment | MCP: `wait_for_comments`, `resolve_comments` | Versions and diff, browser-error reporting, BM25 search, a 5-second quiet window before returning. |
| [Ch00k/claude-review](https://github.com/Ch00k/claude-review) | 31 | 2025-11-20 | Unlicense | Inline Markdown comments for Claude Code | Agent reads threads | Threads; the agent replies and resolves. |
| [shyamalaravind/plan-review](https://github.com/shyamalaravind/plan-review) | 0 | 2026-10-03 | none | Plan review as an Agent Skill | Blocking C++ server prints to stdout | Approve or Request changes; "end without feedback". No network at all. |
| [forlack/mdreview](https://github.com/forlack/mdreview) | 0 | 2026-09-30 | MIT | Local Markdown review browser | Clipboard, plus `mdreview comments --format json` | `.md-review/review.json` lives in the repo; optional `AGENTS.md` block. |
| [konradmichalik/annotaitr](https://github.com/konradmichalik/annotaitr) (was md-annotator) | 6 | 2026-10-01 | MIT | Annotate images, captured pages, video, GIFs and Markdown | Plugin returns structured feedback | Drawing tools, voice notes (whisper.cpp), video timeline. |
| [GodHelpThisCoder/markdown-annotator](https://github.com/GodHelpThisCoder/markdown-annotator) | 0 | 2026-10-02 | MIT | Single-file Markdown annotator | Clipboard | Keyboard-driven. |
| [bharadwaj-pendyala/sidenote](https://github.com/bharadwaj-pendyala/sidenote) | 3 | 2026-07-06 | MIT | Google-Docs-style comments on a rendered Markdown site | The tool runs claude or codex, which returns a git diff | "Ask" (answer only) versus "Resolve" (edit), then Accept or Reject the diff inline. |
| [baskb/feedback-studio](https://github.com/baskb/feedback-studio) | 2 | 2026-09-30 | MIT | Overlay for a local site or a Markdown file | `.feedback/comments.json`, MCP and a Claude Code plugin | Voice "talk me through it", "walk me through the changes" narrated tour, `verify` command. |
| [plannotator/plannotator-tui](https://github.com/plannotator/plannotator-tui) | 153 | 2026-09-25 | MIT | Terminal Markdown annotator | Sends to the agent | Select, comment, looks-good, delete. |
| [plannotator/herdr-annotate](https://github.com/plannotator/herdr-annotate) | 613 | 2026-09-29 | MIT | Plannotator-style review inside Herdr | Herdr pane message | Relevant because Orchestrator uses herdr. |
| [titanwings/dsh-plannotator](https://github.com/titanwings/dsh-plannotator) | 12 | 2026-08-25 | MIT | Plan annotation for the DeepSeek harness | Harness plugin | Shows Plannotator's pattern spreading to other harnesses. |
| [pardeike/MarkReview](https://github.com/pardeike/MarkReview) | 0 | 2026-08-23 | none | macOS native Markdown review app | Structured annotations | Native app, not a browser. |
| [hulu204/creating-html-artifacts-skill](https://github.com/hulu204/creating-html-artifacts-skill) | 0 | 2026-05-20 | none | Skill pairing Markdown source with reviewable HTML | Skill | Guidance only. |
| `markloop` on npm (repo [parkgogogo/web-reviewer](https://github.com/parkgogogo/web-reviewer)) | n/a | npm 2026-05-12 | n/a | "Local CLI and browser UI for iterative Markdown review" | n/a | **The GitHub repo now returns 404.** The npm package (v0.1.0, 13 downloads a month) remains. It is unrelated to the hosted markloop.io (see 1.5). |

### 1.2 Adjacent: element pickers and visual feedback on live apps

| Project | Stars | Last push | Licence | What it is | Channel | Notable |
|---|---|---|---|---|---|---|
| [benjitaylor/agentation](https://github.com/benjitaylor/agentation) | 4,846 | 2026-09-22 | NOASSERTION | React toolbar: click elements and copy structured notes | Clipboard, or MCP (`agentation-mcp`, 452k npm downloads a month) | MCP has `watch_annotations` (blocking, batch window), acknowledge, resolve, dismiss and reply. **Intent** (fix, change, question, approve) and **severity** (blocking, important, suggestion). Area select, multi-select, animation pause. |
| [aidenybai/react-grab](https://github.com/aidenybai/react-grab) | 7,645 | 2026-08-22 | MIT | Hover and press ⌘C to copy an element plus its **component stack with `file:line:col`** | Clipboard | Source-location mapping through React internals. |
| [callstackincubator/react-native-grab](https://github.com/callstackincubator/react-native-grab) | 228 | 2026-08-31 | MIT | react-grab for React Native | Clipboard | |
| [breschio/drawbridge](https://github.com/breschio/drawbridge) | 969 | 2026-06-07 | NOASSERTION | Chrome extension, "Figma comments for the browser" | Files: `.moat/moat-tasks.md` and `.json`, plus screenshots | A task file in the repo works as the queue. |
| [RaphaelRegnier/vibe-annotations](https://github.com/RaphaelRegnier/vibe-annotations) | 175 | 2026-10-03 | PolyForm Shield | Extension plus local server for localhost apps | MCP or clipboard | Multi-page; design tweaks. Source-available, not OSI open source. |
| [tw1nk/pointback](https://github.com/tw1nk/pointback) | 0 | 2026-09-26 | none | Vite plugin: element, region or whole-page comments with a screenshot | Pi push, or MCP polling (`@pointback/*` on npm) | Name clash with Abhijeet34/pointback. SQLite store. Queue then "Send queued". |
| [flucas96/ui-review](https://github.com/flucas96/ui-review) | 2 | 2026-09-23 | MIT | Proxy review layer for any local app, built for VS Code Remote SSH | MCP and skills | States `open`/`in_progress`/`review`/`resolved`; **append-only `events.jsonl`**; **atomic claims for parallel agents**; missing-target detection and re-anchoring. |
| [viv/review-loop](https://github.com/viv/review-loop) | 1 | 2026-09-27 | MIT | Astro, Vite and Express dev overlay | MCP plus a JSON file | The agent marks notes "addressed" and the reviewer confirms. |
| [gowtham012/pinpoint](https://github.com/gowtham012/pinpoint) | 1 | 2026-10-02 | MIT | Extension and bridge: selector, computed styles, component chain, source hint, cropped screenshot | MCP, plus optional Claude Code hooks that inject pending notes into the next message | Also covers the iOS Simulator (accessibility tree). |
| [maferland/pinpoint](https://github.com/maferland/pinpoint) | 3 | 2026-07-27 | MIT | Annotate screenshots with regions | Structured feedback | |
| [coleschaffer/Visualizer](https://github.com/coleschaffer/Visualizer) | 8 | 2026-01-12 | none | Click an element; Claude Code edits, commits and pushes | Extension drives the agent | Example of auto-commit, which this survey treats as an anti-pattern. |
| [Jekins/claude-browser-inspector](https://github.com/Jekins/claude-browser-inspector) | 2 | 2026-02-26 | MIT | Chrome element-to-context extension | Context copy | |
| [itk-dev/mcp-claude-code-browser-feedback](https://github.com/itk-dev/mcp-claude-code-browser-feedback) | 1 | 2026-07-09 | none | Browser dialog feedback into Claude Code | MCP | |
| [SikandarJODD/sv-agentation](https://github.com/SikandarJODD/sv-agentation) | 122 | 2026-08-13 | MIT | Svelte port of Agentation | Clipboard or MCP | |
| [mares29/agentation](https://github.com/mares29/agentation) | 0 | 2026-03-31 | none | Svelte 5 Agentation | Clipboard | |
| [stagewise-io/stagewise](https://github.com/stagewise-io/stagewise) | 6,825 | 2026-09-30 | AGPL-3.0 | Was a browser toolbar; now a full "agentic IDE" | Built in | Shows how far an element-picker can drift in scope. |
| [onlook-dev/onlook](https://github.com/onlook-dev/onlook) | 26,854 | 2026-08-25 | Apache-2.0 | Visual editor for React with AI | Built in | Direct manipulation writes the code itself. |
| [ericclemmons/click-to-component](https://github.com/ericclemmons/click-to-component) | 2,351 | 2025-09-23 | MIT | Option+click opens the source in an editor | Editor URL | Pre-agent ancestor of source mapping. |
| [infi-pc/locatorjs](https://github.com/infi-pc/locatorjs) | 1,824 | 2026-09-22 | none | Click a component to open its source | Editor URL | |
| [zthxxx/react-dev-inspector](https://github.com/zthxxx/react-dev-inspector) | 1,320 | 2026-04-20 | MIT | Same idea for React | Editor URL | |
| [AgentDeskAI/browser-tools-mcp](https://github.com/AgentDeskAI/browser-tools-mcp) | 7,328 | 2026-08-12 | MIT | Browser logs, screenshots and element data to MCP IDEs | MCP | Agent-pull, not human-push. |
| [hangwin/mcp-chrome](https://github.com/hangwin/mcp-chrome) | 12,462 | 2026-01-06 | MIT | Chrome extension MCP server; has a "visual editor" doc | MCP | |

### 1.3 Adjacent: diff and code review tools that hand comments back to agents

| Project | Stars | Last push | Licence | Channel | Notable |
|---|---|---|---|---|---|
| [yoshiko-pg/difit](https://github.com/yoshiko-pg/difit) | 3,224 | 2026-08-28 | MIT | Copy comments as a prompt; `--comment` JSON input | GitHub-style local diff viewer. **Programmatic threads and replies**; imports unresolved PR threads. 24k npm downloads a month. |
| [umputun/revdiff](https://github.com/umputun/revdiff) | 913 | 2026-10-02 | MIT | TUI; annotations go to stdout on quit | Also reviews Markdown plans (`--only plan.md`). |
| [in-the-loop-labs/pair-review](https://github.com/in-the-loop-labs/pair-review) | 62 | 2026-10-03 | Apache-2.0 | Copy, plus MCP | AI suggestions that the human adopts, edits or discards. |
| [persiyanov/herdr-reviewr](https://github.com/persiyanov/herdr-reviewr) | 825 | 2026-10-03 | MIT | Herdr pane, sent to the agent | **Last-turn diff** scope. |
| [jhochenbaum/herdr-hunk-diff](https://github.com/jhochenbaum/herdr-hunk-diff) | 136 | 2026-09-30 | MIT | Herdr, sent to the responsible agent | Routes comments to the agent that owns the worktree. |
| [dheerajjha/reviewer](https://github.com/dheerajjha/reviewer) | 2 | 2026-09-30 | MIT | stdout on Submit; `export --format json\|prompt` | Line anchors survive later edits by the agent. |
| [Waraq-Labs/review-for-agent](https://github.com/Waraq-Labs/review-for-agent) | 10 | 2026-02-17 | MIT | Markdown file plus a clipboard pointer | File-level and global comments. |

### 1.4 Adjacent: human-in-the-loop MCP servers and agent UIs

| Project | Stars | Last push | Licence | Channel | Notable |
|---|---|---|---|---|---|
| [noopstudios/interactive-feedback-mcp](https://github.com/noopstudios/interactive-feedback-mcp) | 1,709 | 2025-05-26 | MIT | MCP tool blocks on a desktop popup | Originator of the pattern; many forks found. |
| [Minidoracat/mcp-feedback-enhanced](https://github.com/Minidoracat/mcp-feedback-enhanced) | 3,762 | 2026-10-01 | NOASSERTION | MCP with a web UI or desktop app | **Removed command execution after an unauthenticated-WebSocket RCE (issue #219).** Its README now points users at native MCP **Elicitation** and **MCP Apps**. |
| [sanshao85/mcp-feedback-collector](https://github.com/sanshao85/mcp-feedback-collector) | 234 | 2025-06-02 | MIT | MCP | Earlier UI reference. |
| [GongRzhe/Human-In-the-Loop-MCP-Server](https://github.com/GongRzhe/Human-In-the-Loop-MCP-Server) | 163 | 2025-06-18 | MIT (archived) | MCP GUI dialogs | Archived. |
| [geehexx/hitl-mcp-cli](https://github.com/geehexx/hitl-mcp-cli) | 5 | 2026-05-20 | Apache-2.0 | MCP in a terminal | |
| [DercasDrol/human-in-the-loop-mcp](https://github.com/DercasDrol/human-in-the-loop-mcp) | 4 | 2026-03-14 | MIT | VS Code extension acting as an MCP server | |
| [techtoboggan/openwebgoggles](https://github.com/techtoboggan/openwebgoggles) (PyPI `openwebgoggles` 0.17.20) | 1 | 2026-05-28 | Apache-2.0 | Agent opens JSON-schema panels (approvals, forms, wizards) | Generalises "page asks a question" into a schema. |
| [humanlayer/humanlayer](https://github.com/humanlayer/humanlayer) | 11,644 | 2026-06-19 | NOASSERTION | Agent workflow product | Approval-centric; broader than review. |

### 1.5 Hosted or self-hosted "publish an artifact and collect comments"

| Project | Stars | Last push | Licence | Channel | Notable |
|---|---|---|---|---|---|
| [iBala/open-artifact](https://github.com/iBala/open-artifact) | 7 | 2026-08-31 | NOASSERTION | Agent reads comments back | Self-hosted, with a hosted free tier. Comments carry **the HTML element's own source and line numbers** and say when their target is gone. |
| [andidev30/the-artifact](https://github.com/andidev30/the-artifact) | 0 | 2026-09-30 | AGPL-3.0 | MCP (OAuth 2.1) | `inspect_artifact` returns screenshot, console errors, broken links and accessibility problems; version diff; webhooks. |
| [iofold/artifact-use](https://github.com/iofold/artifact-use) | 4 | 2026-09-30 | MIT | MCP or CLI; long-poll `?wait=` and webhooks (PR #33) | Immutable versions, rollback, threads and resolve. Runs on Cloudflare. |
| markloop.io (commercial, no public repo) | n/a | site live | proprietary | MCP, or `comments.md`/`.json` files | $19 a month. Reviewers need no sign-up. Comments carry target, quote, intent and version. |

### 1.6 Seen in search results only, not confirmed

These are excluded from the count. TagLoop (tagloop.dev): "point, click, comment or talk; selectors, screenshots and task states over MCP"; the site was not fetchable. Critic ("Show HN: Critic – Review code with the agent that wrote it"; agents annotate their own key blocks). IPE (an `ExitPlanMode` plan editor described in a dev.to post). Pinpoint's MCP Registry listing. Cursor's and Claude-in-Chrome's built-in element pickers (closed source).

### 1.7 Prior art worth learning from

| Reference | What to borrow |
|---|---|
| [W3C Web Annotation Data Model](https://www.w3.org/TR/annotation-model/) | `TextQuoteSelector` (exact, prefix, suffix) and `TextPositionSelector`, combined through `refinedBy`; `motivation` values (`commenting`, `editing`, `questioning`, `assessing`, `replying`); target and body separated. The design already uses the quote shape; **`motivation` is the standard name for "intent"**. |
| [hypothesis/h](https://github.com/hypothesis/h) (3,187★, BSD-2) and [hypothesis/client](https://github.com/hypothesis/client) (734★) | Fuzzy re-anchoring when a document changes, plus an **"orphaned" state** for annotations whose target is gone. |
| [apache/incubator-annotator](https://github.com/apache/incubator-annotator) (241★, archived 2024) | Reusable selector-matching code (text quote to DOM range). |
| [Marker.io](https://marker.io/) and [BugHerd](https://bugherd.com/) | Each pin auto-captures environment metadata (URL, viewport, browser, console log); a kanban of pins by status. |
| [Figma comments](https://help.figma.com/hc/en-us/articles/360039825314-Guide-to-comments-in-Figma) | Pins anchored to a frame; threads; resolve and **show resolved**; filter by unread. |
| [GitHub PR review](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/commenting-on-a-pull-request) | "Start a review" (pending batch), then one submit with **Approve / Request changes / Comment**; [suggested changes](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/incorporating-feedback-in-your-pull-request) applied as a batch; **"Outdated"** marking when the anchored line changes; resolve conversation. |
| [MCP Elicitation](https://modelcontextprotocol.io/specification/2025-06-18/client/elicitation) | A native, harness-rendered way for a server to ask the user a structured question. Makes the "feedback popup MCP" category partly obsolete. |

---

## 2. Feature matrix

Lavish against the 8 most relevant projects. ✓ = documented in the README or docs. ◐ = partial. ✗ = not offered. ? = not determined from what I read.

| Feature | Lavish | pointback | Plannotator | Crit | artifact-review | web-artefacts | Agentation (+MCP) | reviewable-html-wb | ui-review |
|---|---|---|---|---|---|---|---|---|---|
| HTML artifact | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | live app | ✓ (generated) | ✓ and live app |
| Markdown | ✗ (by design) | ✓ with source lines | ✓ with source lines | ✓ line-based | ✗ | ✗ | ✗ | ✗ | ✗ |
| Code diff and PRs | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Element pick | ✓ | ✓ | ✓ (pinpoint) | ✓ | ✓ | ✓ | ✓ | images | ✓ |
| Text range | ✓ | ✓ (offsets plus before/after) | ✓ | ✓ | ✓ | ? | ✓ | ✓ | ✗ |
| Area, region or multi-select | ✗ | ✗ | ✗ | ? | ✗ | ✗ | ✓ | ✗ | ✓ area |
| Table cell, control name, chart point | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ◐ (a11y context) |
| Page-level or global comment | ✓ (chat) | ✗ | ✓ | ✓ | ✓ (chat) | ✓ | ✗ | ✗ | ✗ |
| Form or question answers | ✓ `data-lavish-question` | ◐ (the agent asks with `--question`) | ✓ `:::question` blocks | ✗ | ✓ | ✓ postMessage chips | ✗ | ✗ | ✗ |
| Note types or intent | ✗ | ✗ | ✓ delete, comment, label, looks-good | ✗ | ✗ | ✗ | ✓ intent and severity | ✗ | ✗ |
| Direct edit returned as a diff | ✗ | ✗ | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ |
| Image attachments | ✓ | ✗ | ✓ with drawing | ? | ? | ✗ | ✗ | ✗ | ✓ |
| Mermaid whiteboard | ✓ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ◐ (stores source) | ✗ |
| Per-note agent reply or status | ✗ (chat replies) | ✓ done, declined, question | ✗ | ✓ threads | ✓ delivery states | ✓ resolve with note | ✓ ack, resolve, dismiss, reply | ✓ whose-turn status | ✓ 4 states |
| Approve or request-changes gate | ✗ | ✗ | ✓ | ✓ | ◐ (README says "until I approve") | ✗ | ◐ (intent "approve") | ◐ resolution-gated | ✓ approve |
| Diff between revisions | ◐ (author-declared legend) | ✗ | ✓ automatic | ✓ automatic | ? | ✓ | ✗ | ✗ | ✗ |
| Re-anchor or "target gone" | ? | ◐ (anchor designed to survive; text check) | ◐ (diff marker) | ✓ `drifted` | ? | ✗ | ✗ | ? | ✓ |
| Live reload, keeping your place | ✓ | ✓ | ✓ (versions) | ✓ | ✓ | ✓ | n/a | ✓ | via HMR |
| Delivery | CLI long poll, destructive | CLI poll, **at-least-once**, uid idempotent | Hook or stdout | Background CLI until Finish | Skill | MCP wait | MCP watch or clipboard | File | MCP plus events.jsonl |
| Agent or tool can add notes | ✗ | ✗ | ✓ HTTP API | ✓ `crit comment` | ✗ | ✗ | ✗ | ✓ agent replies | ✗ |
| Keyboard-first annotation | ◐ (composer only) | ✓ Tab stops, H, Shift+arrows | ✓ vim | ✓ vim | ? | ? | ✗ | ? | ✓ quick mode |
| Phone layout | ✓ | ✓ (390 px tested) | ✓ (remote docs) | ? | ? | ? | ✗ | ? | ✓ responsive |
| Layout or runtime error checks | ✓ layout | ✗ | ✗ | ✗ | ? | ✓ JS errors, CSP | ✗ | ✗ | ✗ |
| Export (inline assets) | ✓ | ✗ | ✓ (via share) | ✗ | ✓ archive | ✗ | ✗ | ✓ | ✗ |
| Publish or share | ht-ml.app, public by default | never | encrypted short link (deprecated) | crit.md, can be disabled | ✗ | ✗ | ✗ | ✗ | ✗ |
| Telemetry | **opt-out** | none; egress test | none (update check) | none (update check) | ? | ✗ | ? | ? | ? |
| API authentication | Host and Origin only | token plus challenge proof | unauthenticated loopback | unauthenticated loopback | ? | Host and Origin only | ? | ? | ? |
| Licence | MIT | Apache-2.0 | Apache-2.0 | MIT | MIT | MIT | NOASSERTION | MIT | MIT |

---

## 3. New features to include, ranked

All of these are features **Lavish does not have**. Features the design already covers are noted briefly and not argued again. Effort: S ≈ under a week, M ≈ 1–3 weeks, L ≈ more.

### 3.1 Approve / request changes / dismiss decision with exit codes: **MVP, S**

- **What:** Send, plus a decision. **Approve** (no further revision), **Approve with notes** (go ahead, but here is guidance), **Request changes** (the default send) and **Dismiss** (close with nothing). The agent's `wait` returns the decision as a field and a distinct exit code.
- **Who does it:** Plannotator ([decisions table](https://docs.plannotator.ai/open-source/workflows/annotations-and-feedback.md), `--gate --json --require-approval`). Crit (`approved: true/false` on stderr, `cleanup_on_approve`). plan-review ("Approve / Request changes / End review without feedback"). GitHub PR reviews.
- **Why:** The agent's hardest question after a round is "am I done?". Lavish only has "ended", which mixes "approved" with "walked away". For a supervisor such as Orchestrator, "approved" is the signal to move a task forward. A plan gate (`ExitPlanMode`) needs exactly this.
- **Design coverage:** not covered. The design's exit codes are feedback, ended, disconnected and timeout. Add `approved` and `dismissed`.

### 3.2 Automatic revision diff ("what changed since I last sent"): **MVP, M**

- **What:** The daemon keeps a snapshot of the file at each Send. After the agent rewrites the file, a **Show changes** toggle highlights inserted and removed text in the rendered page, and the note list marks notes whose target changed.
- **Who does it:** Plannotator ([version history and plan diff](https://docs.plannotator.ai/open-source/workflows/version-history.md); "Show changes" for HTML). Crit (round-to-round split or unified diff). canvas-flow (checkpoints, side by side). web-artefacts and the-artifact (version diff). GitHub's "changes since your last review".
- **Why:** Lavish's own README admits that "a one-sentence edit is invisible on a long artifact". Its fix, the revisions legend, depends on the agent declaring its edits honestly, and the agent is the party under review. A server-side text diff is free of that trust problem and costs the agent no tokens.
- **Design coverage:** not covered. The design's non-destructive log gives notes a seq, but not artifact versions. Keep Lavish's legend as optional author narration on top of the diff.

### 3.3 Re-anchoring with an explicit "outdated / target gone" state: **MVP, M**

- **What:** When the file changes, re-resolve each open note's anchor: stable id, then quote with prefix and suffix, then selector. Mark it `anchored`, `moved` or `orphaned`. Show orphaned notes in a separate group instead of pinning them somewhere wrong. Tell the agent in `wait` output.
- **Who does it:** Hypothesis (orphans). Crit (`drifted: true`, with skill guidance for the agent). open-artifact (comments "say so plainly when what they pointed at is gone"). ui-review ("missing-target detection and re-anchoring"). GitHub's "Outdated". pointback partly: its `text` field plus guidance to "check it still matches".
- **Why:** Per-note resolve, which the design already has, only works if a note still points at the right thing after the agent edits the page. Without this, the second round is where a review tool quietly lies.
- **Design coverage:** partly. The design has `stable_id`, the TextQuoteSelector and `source_line`, which are the anchors. It does not have the re-resolution step or the state.

### 3.4 Note intent or motivation, plus severity: **MVP, S**

- **What:** Each note carries an optional `intent`: `change`, `question`, `delete`, `looks-good`, or `approve` for a passage. It can also carry an optional `severity`: `blocking`, `important` or `nit`. One keystroke picks it in the card. User-configured quick labels ("add a test", "out of scope") are a later option.
- **Who does it:** Agentation ([intent and severity in its MCP schema](https://www.agentation.com/mcp)). Plannotator (Delete, Comment, Quick label, Looks good). artifact-annotator (change, question or note). The W3C `motivation` vocabulary.
- **Why:** "Is this a question or an instruction?" is the most common reason an agent rewrites something the reviewer only asked about. sidenote builds its whole UX on the Ask-versus-Resolve split. "Looks good" marks give the agent a positive signal about what to keep. Severity lets the agent order its work and lets "approve with notes" carry only nits.
- **Design coverage:** not covered. The payload has `kind` (element, text or answer), which records the target type, not the intent. Use the W3C `motivation` names so the schema stays standard.

### 3.5 Markdown as a first-class input, with source line ranges: **MVP or early, M**

- **What:** `open plan.md` renders it with a standard renderer, and every note carries `lines: [first, last]` from the parser's source map.
- **Who does it:** pointback (markdown-it, block line ranges). Plannotator. Crit. artifact-annotator. mdreview. revdiff. claude-review.
- **Why:** Most agent plans are Markdown, and so are Orchestrator's worker reports and `state/reviews/*.md`. Lavish refuses Markdown on principle: "no page without a saved file behind it". A `.md` file **is** a saved file, so the principle does not actually exclude it, and every serious competitor supports it. Line ranges are also more reliable than `source_line` mapping for HTML, because Markdown blocks map 1:1 to lines.
- **Design coverage:** not covered. The design's scope is HTML only.

### 3.6 Per-note agent status of done / declined / question, and "whose turn": **MVP, S**

- **What:** Extend the design's per-note resolve (`addressed` or `wontfix`) with **`question`**: the agent asks back on that note, and the reviewer's answer is a new note linked with `answers: <id>`. Add a derived **turn** field, either `agent` or `reviewer`, so both sides see what is waiting on whom.
- **Who does it:** pointback (`reply <uid> --done|--declined|--question`, answers carry `answers`). reviewable-html-workbench (`needs_agent_review` / `needs_user_reply` / `resolved`). Agentation (ack, resolve, dismiss, reply). ui-review (`in_progress`, `review`).
- **Why:** Lavish forces clarifications into a global chat, detached from the target.
- **Design coverage:** mostly covered (per-note resolve). The new parts are the `question` status and the turn field. Keep "resolved" the **reviewer's** call, as Crit's skill does ("resolving is the reviewer's call"). The agent marks a note *addressed*; the human closes it.

### 3.7 Programmatic notes from the agent or tools: **MVP, S**

- **What:** `stet note add <file> --target <selector|quote|line> --text … --source <tool>` adds a note to a live review, visibly labelled as coming from that source. Uses include an agent flagging its own uncertainties ("I guessed this number"), a linter, or Orchestrator inserting a reminder.
- **Who does it:** Plannotator ([external annotations HTTP API](https://docs.plannotator.ai/open-source/reference/external-annotations.md)). Crit (`crit comment file:42 '…'`, JSON on stdin). difit (`--comment` threads and replies). Critic (agents annotate key blocks, per the HN post).
- **Why:** It directs the reviewer's attention to the risky parts, which is the scarce resource. It must never become feedback to the agent unless the human acts on it, which fits Lavish's "only a deliberate human action becomes feedback" rule. The design's human-only-send rule already covers this: agent notes are display-only until the human replies or endorses them.
- **Design coverage:** not covered. It is close to the design's `source: page-control` label, so the plumbing exists.

### 3.8 Richer targets: table cells by header, controls by accessible name, chart points: **MVP, S**

- **What:**
  - A cell is named `{row: <first-cell text>, column: <header text>}`, and the name is omitted when there is a rowspan or colspan.
  - A control is named by its accessible name (aria-label, label, text, alt).
  - A click on `img`, `svg` or `canvas` records `x`, `y`, `width` and `height`, so the point scales to the viewBox.
- **Who does it:** pointback ("What a note points at" section of its [README](https://github.com/Abhijeet34/pointback#what-a-note-points-at)). artifact-annotator (nearest named SVG group and coordinates).
- **Why:** Plans and reports are full of tables and charts. "Row *Shadow traffic*, column *Owner*" is an anchor an agent can grep in its own source. `td:nth-child(3)` is not.
- **Design coverage:** not covered beyond `stable_id`, `selector` and `quote`.

### 3.9 Keyboard-first annotation: **MVP-lite, M**

- **What:** In annotate mode, every block gets a Tab stop. Enter opens the note card. Shift+arrow grows a word selection. H and Shift+H jump between headings. Ctrl+Enter adds and sends.
- **Who does it:** pointback ("By keyboard" section, tested end to end with no mouse). Crit and Plannotator (vim keys).
- **Why:** Speed for heavy reviewers, and accessibility. Lavish's shortcuts cover only the composer.
- **Design coverage:** not covered.

### 3.10 Passive runtime-error capture: **later, S**

- **What:** The SDK reports JS errors, failed asset loads and CSP blocks in the chrome. It never wakes the agent. They are included in the next human Send as metadata.
- **Who does it:** web-artefacts (errors reported, and a waiting agent returns early, which this report advises against). the-artifact (`inspect_artifact`). Marker.io (console capture per pin). pointback (`refused_assets` on open).
- **Why:** A blank chart caused by a missing CDN script looks like a design flaw to the reviewer. Cheap to add and in keeping with Lavish's "passive detection" philosophy.
- **Design coverage:** not covered. The design defers layout checks; this is smaller and more useful.

### 3.11 A proven no-egress guarantee and a threat model: **MVP, S**

- **What:** A test that runs the whole loop and fails on any outbound connection. Also a `docs/THREAT-MODEL.md`, and the capability token presented only to a daemon that first proves it holds that token (a challenge-response).
- **Who does it:** pointback (`test/egress.test.js`; `tokenProof` in `src/http-guard.js`; [THREAT-MODEL](https://github.com/Abhijeet34/pointback/blob/main/docs/THREAT-MODEL.md)).
- **Why:** The design promises "no outbound requests". A test makes that a guarantee. The token proof closes a gap the design's token alone leaves open: another process squatting the port after a restart receives the token.
- **Design coverage:** the promises are covered. The test, the threat model and the token proof are new.

### 3.12 Feedback archive and "compound" export: **later, S**

- **What:** `stet history [--since]` exports past notes and decisions as JSONL or Markdown, so an agent can mine repeated preferences into a skill or CLAUDE.md rules.
- **Who does it:** Plannotator ([compound value](https://docs.plannotator.ai/open-source/start/compound-value.md), `plannotator archive`). Crit (`crit stats`, `resume`).
- **Why:** The same correction made in ten reviews is a missing rule. The non-destructive log already keeps the data, so this is a reader.
- **Design coverage:** the data is covered by the log; the export command is new.

### 3.13 Finish hooks and customisable agent-facing prompts: **later, S**

- **What:** `on_approve` and `on_feedback` user commands, which receive JSON on stdin, plus a template for the `next` string the agent receives.
- **Who does it:** Crit (command hooks with `CRIT_*` env vars, a `prompts` map). Plannotator ([custom feedback](https://docs.plannotator.ai/open-source/reference/custom-feedback.md)).
- **Design coverage:** largely covered by the design's `notify` hook and `STET_GUIDE_EXTRA`. The new part is having separate hooks per decision.

### 3.14 Direct text edit returned as a suggestion diff: **later, M**

- **What:** The reviewer retypes a passage in place. The tool sends a `suggestion` note with the old and new text, like GitHub's suggested change. It **never** writes the file itself.
- **Who does it:** Plannotator (Markdown editor gives a unified diff in the feedback). artifact-review ("Direct text edits"). Feedback Studio (retype a headline). GitHub suggestions.
- **Why:** "Change X to Y" is the commonest note, and typing Y in place is faster and less ambiguous. Keep it a proposal so the artifact stays the author's (Lavish's first principle).
- **Design coverage:** not covered.

### 3.15 Region and multi-element selection, with optional screenshot crop: **later, M**

- **Who does it:** Agentation (area, multi-select). ui-review (area). tw1nk/pointback (region and page, with a screenshot). Drawbridge and Pinpoint (cropped screenshots).
- **Why:** Useful for "this whole group is misaligned" and for empty-space notes. Less important for documents than for live apps.

### 3.16 Atomic per-note claims for parallel agents: **later, S**

- **What:** An agent claims notes (`in_progress`) so that two consumers do not both act on the same one.
- **Who does it:** ui-review ("atomic annotation claims ... for parallel Claude Code or Codex windows").
- **Why:** This matters to Orchestrator (Commander plus worker), but only if feedback is ever routed to several agents.
- **Design coverage:** partly covered by `--owner` cursors. Cursors stop consumers stealing each other's reads; they do not decide who does the work.

### Already covered by the design (no further action needed)

- non-destructive log with cursors, and at-least-once delivery (pointback proves the value: uid-idempotent redelivery);
- session token on loopback;
- `--json` output with a versioned schema;
- stable ids and source lines;
- event log and notify hook;
- no telemetry or publishing;
- an optional MCP adapter later. Agentation's `watch_annotations` and web-artefacts' `wait_for_comments` are the reference tool shapes. MCP Elicitation and MCP Apps may make a custom popup unnecessary.

### Top 8 summary

| Rank | Feature | Priority | Effort | In the design? |
|---|---|---|---|---|
| 1 | Approve / request changes / dismiss decision | MVP | S | No |
| 2 | Automatic revision diff | MVP | M | No |
| 3 | Re-anchoring with an outdated/orphaned state | MVP | M | Partly |
| 4 | Note intent and severity | MVP | S | No |
| 5 | Markdown input with line ranges | MVP or early | M | No |
| 6 | Per-note `question` status and whose-turn field | MVP | S | Mostly |
| 7 | Programmatic notes from the agent or tools | MVP | S | No |
| 8 | Table-cell, control and chart-point targets | MVP | S | No |

Next in line: keyboard-first annotation, the no-egress test with a threat model, and passive error capture.

---

## 4. What to leave out

| Common feature | Seen in | Leave out because |
|---|---|---|
| Hosted sharing or "workspaces" | Lavish (ht-ml.app), Crit (crit.md), Plannotator (deprecating link sharing for a hosted Workspaces product), open-artifact, the-artifact, markloop.io | The design already excludes this. Plannotator moving from link sharing to a paid hosted product shows where this road leads. |
| The tool launching or driving the agent ("Send to agent", "Resolve into a diff", auto-commit) | Crit's experimental "send to agent" spawns an agent process; sidenote runs claude or codex; Visualizer commits and pushes | It owns the agent's lifecycle and permissions, which belongs to the harness (and to orc). Lavish's VISION says the same: "does not launch, drive, or supervise the agent". |
| Built-in LLM features ("Ask AI", AI reviews, story mode) | Plannotator, Crit, pair-review | These spend tokens and send content to a provider from inside a review tool. The agent at the other end of the loop already *is* the AI. |
| Running commands from the browser | mcp-feedback-enhanced (removed after an RCE, issue #219) | An unauthenticated local socket that runs shell commands is the canonical failure. |
| Startup update check | Crit, Plannotator (GitHub release checks) | Contradicts "the core makes no outbound requests". Let package managers handle updates. |
| Automatic bind to Tailscale or LAN | Lavish; reviewable-html-workbench prefers Tailscale | The design already makes this explicit with `--listen`. |
| Waking the agent on detections, or a quiet-window auto-send | web-artefacts returns early on browser errors and auto-batches after a 5 s pause | Only a deliberate Send should reach the agent (Lavish's best principle, which the design keeps). An explicit Send with a pending batch is the GitHub "Start a review" model. |
| Voice input, narrated tours, text-to-speech | Feedback Studio, annotaitr | Fun, but a large surface with platform dependencies (whisper.cpp). Revisit only if users ask. |
| Browser extensions or framework plugins for live apps | Agentation, react-grab, Drawbridge, Vibe Annotations, review-loop, tw1nk/pointback | A different product (live apps, component source maps). It is crowded, and Agentation and react-grab dominate on adoption. Stay on saved files. |
| Excalidraw whiteboard in the MVP | Lavish, artifact-review | The design already defers this. Few competitors have it, and it is the heaviest dependency. |
| Source-available licences | Vibe Annotations (PolyForm Shield), Agentation and Drawbridge (NOASSERTION) | Use MIT or Apache-2.0. Do not copy code from these. |

### Where competitors do better than Lavish

- **Delivery semantics:** pointback's at-least-once delivery with uid idempotency is simpler and safer than Lavish's take-and-restore batch.
- **Markdown:** every major competitor supports it; Lavish refuses on a principle that does not actually exclude it.
- **Revision visibility:** Plannotator and Crit diff automatically; Lavish asks the agent to self-report.
- **Per-note closure:** pointback, Agentation, ui-review and Crit tie replies to notes; Lavish has only a global chat.
- **Decision gate:** Plannotator and Crit separate approve from end.
- **Security posture:** pointback (token plus proof, egress test, threat model) and Crit/Plannotator (no telemetry) beat Lavish's opt-out telemetry and path-hash sessions.
- **Agent reach:** Plannotator's hooks cover 9 harnesses, including plan-mode interception; Lavish has session hooks for 4.

---

## 5. Does any existing project make building unnecessary?

**Short answer: nothing matches the design exactly. pointback comes close enough that building from scratch would mostly duplicate it.** Three readings of "build or join" are possible, and they lead to different answers.

### pointback (Abhijeet34): the closest match

**Matches the design's philosophy almost line by line:**
- "one person, one agent, one local file";
- never sends the page anywhere, and has a test proving it;
- a capability token in the URL fragment, plus a challenge proof;
- a loopback-only daemon that exits when idle;
- an iframe sandbox with an opaque origin and a separate loopback hostname;
- WebSocket events, adopted for the same reason Lavish switched (the browser's 6-connection limit);
- at-least-once delivery with uid idempotency;
- per-note done, declined or question replies;
- Markdown with line ranges;
- anchors that survive re-rendering;
- keyboard-first use;
- a page outline in the first batch, capped at 2,000 characters;
- two runtime dependencies (parse5 and markdown-it), the same parser the design picked;
- Linux, macOS and Windows CI, with weekly WebKit and Firefox smoke tests.

**Missing relative to the design:**
- a non-blocking `status` command;
- labels and per-owner cursors;
- the metadata-only event log and `notify` hook;
- a versioned schema name;
- page-level or general comments;
- capture of form-control answers;
- image attachments;
- export;
- a plugin manifest and generated skill stub (its skill is a hand-copied file);
- an approve/dismiss decision;
- a revision diff;
- a light theme (it is pinned to dark on purpose).

It also needs Node 24 or newer, and it vendors a personal design system ("halderworks").

**Risks:**
- 0 stars and 171 npm downloads a month;
- one maintainer and 32 days old;
- an unknown roadmap and an unknown appetite for outside pull requests.

The bus-factor risk is real. Apache-2.0 limits it, because a fork stays possible as long as LICENSE and NOTICE are kept.

**Assessment:** pointback has already built roughly 60–70% of the design's MVP, and its README reads as if written from the same lessons (Lavish's invariants). What it lacks is mostly the **supervisor-facing surface** (status, labels, cursors, events, notify), which Orchestrator needs most, plus items 3.1–3.4 above. That makes it a strong base to contribute to or fork. It is not something to install as-is for Orchestrator today.

### Plannotator: the established alternative

- **Strengths:** mature (9.1k stars, many releases, 9 harnesses), Apache-2.0, no telemetry. It already does the top three new features: approve gate, plan diff and question blocks.
- **Weaknesses:**
  - It is a broad product (diffs, PRs, Ask AI, a hosted upsell), and its HTML support is secondary to Markdown plans.
  - It makes an update check on every surface load.
  - Its local API is unauthenticated.
  - It integrates through harness hooks, not through a pollable CLI with cursors.
- **Assessment:** if what you need is **plan review at `ExitPlanMode`**, Plannotator makes building unnecessary today; set `PLANNOTATOR_SHARE=disabled` and accept the update check. It is a poor fit as the embeddable, supervisor-observable review primitive the design describes.

### Crit

- **Strengths:** a Go single binary, MIT, active (1.2k stars, 94 forks). It covers Markdown, HTML, diffs and live apps, with threads, round diffs, drift detection and approve. Sharing can be switched off (`share_targets: []`) and the update check disabled (`CRIT_NO_UPDATE_CHECK=1`).
- **Weaknesses:** its loop is "block until Finish", with no streaming per-note cursor, and its HTML element targeting is less detailed than pointback's.
- **Assessment:** a reasonable thing to adopt now for diff and plan review. It is not the HTML-first, cursor-based primitive.

### Recommendation (for you to decide)

1. **Join or fork pointback.** Open an issue describing the supervisor surface (status, labels, cursors, event log) and the approve decision, and see whether the maintainer is receptive. If yes, contribute. If not, fork under Apache-2.0 with attribution. This is the cheapest route to the design, and it inherits a strong security base.
2. **Adopt Crit or Plannotator for now, and build later only if gaps hurt.** This fits if the near-term need is plan and diff review, not HTML artifacts.
3. **Build fresh as the design proposes.** This is justified only if you want full control of the contract and roadmap (for example, publishing under JurisTech). Even then, read pointback's README, THREAT-MODEL and anchoring code first; its licence allows borrowing with attribution, as the design already plans for Lavish.

My lean is option 1, and 3.1–3.8 of this report are the list to bring to that conversation. The decision depends on two things this survey cannot answer: whether pointback's maintainer accepts outside direction, and whether you want the tool under your own name.

---

## 6. Sources

Every GitHub link in section 1 was checked through `gh api repos/<owner>/<name>` on 2026-10-04, and its README was read through `gh api repos/<r>/readme` (raw). The main evidence pages for features:

- Lavish: `scratchpad/lavish-axi/README.md` ("How It Works", "CLI Reference"), `VISION.md`.
- pointback: [README](https://github.com/Abhijeet34/pointback#readme) ("What comes back", "Answering each note", "What a note points at", "By keyboard", "How it holds together"), [THREAT-MODEL](https://github.com/Abhijeet34/pointback/blob/main/docs/THREAT-MODEL.md), `npm view pointback`, and `gh api` for commits, contributors and releases.
- Plannotator: [README](https://github.com/backnotprop/plannotator#readme), [annotations and feedback](https://docs.plannotator.ai/open-source/workflows/annotations-and-feedback.md), [HTML](https://docs.plannotator.ai/open-source/workflows/html.md), [version history](https://docs.plannotator.ai/open-source/workflows/version-history.md), [questions](https://docs.plannotator.ai/open-source/workflows/questions.md), [external annotations](https://docs.plannotator.ai/open-source/reference/external-annotations.md), [compound](https://docs.plannotator.ai/open-source/start/compound-value.md), [docs index](https://docs.plannotator.ai/llms.txt).
- Crit: [README](https://github.com/tomasz-tomczyk/crit#readme) ("Features", "Command hooks", "Share"), [Claude Code skill](https://github.com/tomasz-tomczyk/crit/blob/main/integrations/claude-code/skills/crit/SKILL.md), [Show HN](https://news.ycombinator.com/item?id=47322273), [crit.md](https://crit.md/).
- Agentation: [README](https://github.com/benjitaylor/agentation#readme), [MCP docs](https://www.agentation.com/mcp).
- web-artefacts [README](https://github.com/lbug/web-artefacts#readme) ("Tools", "Security"); ui-review [README](https://github.com/flucas96/ui-review#readme) ("What works"); reviewable-html-workbench [README](https://github.com/u-ichi/reviewable-html-workbench#readme) ("Features"); artifact-review [README](https://github.com/arDaraz/artifact-review#readme); canvas-flow [README](https://github.com/fernandomenuk/canvas-flow#readme); artifact-annotator [README](https://github.com/frederikschjoedt/artifact-annotator#readme); open-artifact [README](https://github.com/iBala/open-artifact#readme); the-artifact [README](https://github.com/andidev30/the-artifact#readme); artifact-use [PR #33](https://github.com/iofold/artifact-use/pull/33); tw1nk/pointback [README](https://github.com/tw1nk/pointback#readme); Feedback Studio [README](https://github.com/baskb/feedback-studio#readme); mcp-feedback-enhanced [README](https://github.com/Minidoracat/mcp-feedback-enhanced#readme) (RCE note, [issue #219](https://github.com/Minidoracat/mcp-feedback-enhanced/issues/219)).
- Web discovery: Hacker News [Show HN: Plannotator](https://news.ycombinator.com/item?id=48495970), [Show HN: Critic](https://news.ycombinator.com/item?id=49834098), [Show HN: ProofShot](https://news.ycombinator.com/item?id=47499672); [huonw blog on inline plan feedback](https://huonw.github.io/blog/2026/02/ai-plan/); [dev.to local PR review for Claude plans](https://dev.to/eduardmaghakyan/building-a-local-pr-review-interface-for-claude-code-plans-57o2); [markloop.io](https://markloop.io/); [PyPI openwebgoggles](https://pypi.org/project/openwebgoggles/).
- Prior art: [W3C Web Annotation Data Model](https://www.w3.org/TR/annotation-model/), [Hypothesis](https://web.hypothes.is/), [Marker.io](https://marker.io/), [BugHerd](https://bugherd.com/), [Figma comments guide](https://help.figma.com/hc/en-us/articles/360039825314-Guide-to-comments-in-Figma), GitHub docs on [commenting on a PR](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/commenting-on-a-pull-request) and [incorporating feedback](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/incorporating-feedback-in-your-pull-request), [MCP Elicitation](https://modelcontextprotocol.io/specification/2025-06-18/client/elicitation).
- npm downloads (last 30 days, `api.npmjs.org`, read 2026-10-04): lavish-axi 53,547; pointback 171; agentation 6.19M; agentation-mcp 452k; react-grab 5.15M; difit 24,406; web-artefacts 521; review-loop 24; canvas-flow 19; markloop 13. The very large Agentation and react-grab figures probably include CI installs.

Caveats:
- Star counts and dates move daily.
- "?" cells in the matrix were not determined from what I read; they are not confirmed absences.
- I did not run any of these tools. Every feature claim comes from the project's own README or docs.
