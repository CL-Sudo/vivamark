# Design proposal: an open-source "point at the page" review tool

Status: proposal only. Nothing has been built, installed or published.
Date: 2026-10-04.

Sources read:
- the lavish-axi clone at `scratchpad/lavish-axi` (v0.1.81, commit 7369205, a shallow clone): README, VISION, AGENTS, `docs/invariants.md`, `src/cli.js`, `src/server.js`, `src/artifact-sdk.js`, `src/playbooks.js`, `src/design-reference.js`, `src/skill.js`, `plugin.json`, `package.json`, `THIRD-PARTY-NOTICES.md`;
- Orchestrator's README, AGENTS.md, CLAUDE.md, `skills/orchestrator/SKILL.md`, `.claude/settings.json`, `hooks/`, `bin/orc` (`cmd_lavish`) and `local.env.example`.

The working name `stet` is used throughout sections 2 and 3 only so the examples are concrete. Section 1 covers the actual choice.

---

## 1. Name

### What the name has to carry

A person points at something an agent wrote, and the agent knows exactly what "this" means. The proofreading world already has words for marking up a proof and sending it back. The name also has to work as a CLI command that agents type hundreds of times. Short, lowercase, no collision.

### Availability checks

Every result below comes from a command that was actually run on 2026-10-04:

- **npm:** `npm view <name> name version time.modified`. An E404 means the unscoped name is free.
- **GitHub:** `gh search repos <name> --limit 3 --sort stars`, authenticated as `ching-lung`. Where the fuzzy search returned near-misses, I also ran `--match name`.
- **Command collision:** `command -v <name>` on this machine (WSL2, Ubuntu noble) and `apt-cache policy <name>`. Homebrew and other distros were **not** checked.

| # | Name | Meaning | npm (unscoped) | Notable GitHub use (top hit) | Command collision |
|---|---|---|---|---|---|
| 1 | **stet** | Latin "let it stand". The proofreader's mark that keeps text as written. It is the classic symbol of the author-proofreader margin dialogue. | **Free.** E404 | No repo named `stet` in the top results. The search returns substring matches: facebook/stetho 12,649★, Netflix-Skunkworks/stethoscope 2,005★. `--match name` gives the same. | None. `command -v`: none. apt: none. |
| 2 | galley | A galley proof: the first typeset pages, sent out to be marked up. | Taken. 1.2.6, modified 2022-06-18 | google-fabric/galley 149★ ("Orchestrator for local Docker containers"). It ships a `galley` CLI. | None locally, but google-fabric's `galley` binary exists |
| 3 | redline | To mark changes on a document, as in legal redlining. | Taken. 1.0.1 | robb/Redline 726★; evolsb/claude-legal-skill 459★; redline-smalltalk 320★ | None |
| 4 | marginalia | Notes written in the margins. | Taken. 1.0.0 | MarginaliaSearch 2,165★; basecamp/marginalia 1,769★; minad/marginalia 988★ | None |
| 5 | pinpoint | To locate precisely. | Taken. 1.1.0 | pinpoint-apm/pinpoint 13,868★ | **Yes.** Ubuntu ships `pinpoint`, a presentation program (`apt-cache policy pinpoint` gives candidate 1:0.1.8-6build2) |
| 6 | proofmark | A proofreader's correction mark. | Taken. 0.1.1, 2026-02-21, described as "Quality gate for AI responses", so it sits in an adjacent AI space | Harshal-Bsys27/ProofMark… 8★ (small) | None |
| 7 | gloss | A marginal or interlinear explanatory note. | Taken. 2.8.23 | bfortuner/ml-glossary 3,130★ (substring); haidalinda/Gloss 1,605★ | None |
| 8 | caret | The proofreader's insertion mark (^). | Taken. 0.1.0 | topepo/caret 1,669★ (R package); thomaswilburn/Caret 1,798★ (an editor) | None. `apt-cache policy caret` shows Candidate: (none) |
| 9 | **deixis** | Linguistics: words such as "this", "here" and "that one" whose meaning depends on pointing. This is exactly the problem the tool solves. | **Free.** E404 | inspiros/typst-deixis 14★; jolars/deixis 2★ (small) | None |
| 10 | inkback | Ink marks sent back to the author. | **Free.** E404 | Joseph-Matteo-Scorsone/InkBack 23★ (Rust backtesting) | None |
| 11 | pinnote | A note pinned to a spot. | **Free.** E404 | Hitarry/PinNote 13★; BigTows/PinNote 11★ (JetBrains notes plugin) | None |
| 12 | **bluepencil** | The editor's blue pencil, used to mark copy. | **Free.** E404 | shift-labs-ai/bluepencil 2★ ("prose quality gate for technical documentation"), a mild same-space overlap | None |
| 13 | **galleyproof** | The marked-up galley that goes back to the compositor. | **Free.** E404 | **No results**, including with `--match name` | None |
| 14 | redlined | Already marked up. | **Free.** E404 | tmoody1973/redlined 2★ (`--match name`). The fuzzy search hits the `redline` repos above. | None |
| 15 | inkpoint | Pointing with ink. | **Free.** E404 | yokki-vans/InkPointX 103★ (e-ink firmware) | None |

Other names I checked on npm with the same command, not shortlisted:

- **Free:** `stet-cli`, `deixis-cli`, `thisbit`, `pinback`, `quillmark`.
- **Taken:** `emend`, `dele`, `markback`, `marginal`, `glossa`, `redpen`, `pinmark`, `proofpin`, `nib`, `folio`, `marginnote`, `markpoint`, `galley-cli`, `proofloop`.

**Prior art the checks turned up. Read these before building.**

- **`pointback` on npm.** Published 2026-10-02, Apache-2.0, from github.com/Abhijeet34/pointback. Its description: *"Point at a rendered HTML page; the pointing comes back to your agent as an instruction."* That is the same category as this tool, and it appeared two days ago.
- **`markloop` on npm.** From github.com/parkgogogo/web-reviewer: *"a local CLI and browser UI for iterative Markdown review."*
- **tw1nk/pointback on GitHub** (0★): *"Review your live UI and send element-specific feedback… directly to coding [agents]"*.

This category is filling up quickly. It is worth deciding whether you want your own tool or want to contribute to one of these.

### Top 3

1. **`stet`.** Four letters, free on npm, no command collision, and no notable exact-name repo. It is the most recognisable proofreading mark there is, and it reads well in commands: `stet open plan.html`, `stet wait plan.html`. There are two downsides. Its literal meaning, "leave it as is", is the opposite of a change request, although proofreaders read it as "the margin conversation". And the name is hard to search for, because GitHub returns `stetho`. Even so, it is the best mix of short, on-theme and free.
2. **`galleyproof`.** The only candidate with zero GitHub results and a free npm name, and the meaning fits exactly: the proof you mark up and send back. Its weakness is length (11 characters), but agents do most of the typing. Ship the command as `galleyproof` only. Do not add a short alias such as `gp`, which collides with PARI/GP, or `galley`, which collides with google-fabric's CLI.
3. **`deixis`.** The most precise idea, because the tool exists to resolve "this" and "here". It is free on npm, the existing repos are tiny, and there is no collision. Its weakness is that people don't know the word and aren't sure how to say it ("DIKE-sis"). It is a good choice if the tool is aimed at engineers who like a clever name. `bluepencil` is the runner-up if you prefer an obvious, friendly name.

Not yet checked, and needed before you commit: domains, Homebrew formula names, crates.io and Go module paths, and trademark searches.

---

## 2. Architecture

### 2.1 What to keep from Lavish, what to do differently

Lavish is a serious piece of work: about 25,000 lines in `src/` alone, plus a 247-line `docs/invariants.md` full of hard-won edge cases. The best thing to take from it is its **contract and its lessons**, not its code volume.

**Keep (proven, and correct by design):**

| Lavish idea | Why keep it |
|---|---|
| The saved HTML file is the source of truth. Serving it adds exactly one `<script>` tag (`injectLavishSdk`). | Artifacts stay portable and render the same without the tool. |
| The artifact runs in a sandboxed iframe **without** `allow-same-origin` (`server.js:130`). The chrome page is a separate top-level document with `X-Frame-Options: DENY` / `frame-ancestors 'none'`. | The agent-written page is untrusted. It cannot reach the API or click Send for the user. |
| Nothing reaches the agent except through a deliberate human Send in the chrome. Detections such as layout checks are passive and never wake the agent. | This is the core trust property. Page scripts can propose notes but cannot send them. |
| A Host-header allowlist (DNS-rebinding defence) plus an Origin/Referer guard on mutating routes. Assets are confined by realpath, so symlink escapes are refused. | These are cheap, standard and easy to forget. |
| The agent waits with a long poll. stdout is reserved for the final result, heartbeats go to stderr, and the wait banner is printed once. | Works in every harness that can run a shell command, and costs no tokens while waiting. |
| The user's words come first in the payload, before any large DOM snapshot (`createPollOutput` key order). | Survives an agent truncating the output. |
| Live reload restores scroll position, the open annotation draft and form answers. Restoration replays no `input` or `change` events. | Rewriting the file must not lose what the reviewer was typing. |
| "The instructions are the product." The skill is a generated stub that points at `--help` and `guide`. One owner per contract. | Prevents version drift between the skill and the CLI (see 2.4). |

**Do differently:**

| Lavish today | Proposal | Why |
|---|---|---|
| Telemetry is **opt-out**. `src/telemetry.js` posts to an Umami host unless `LAVISH_AXI_TELEMETRY=0`. Orchestrator has to force it off. | **No telemetry code in the core.** If it is ever added, it is opt-in through a config key, and the docs list every field it sends. | A tool that reads private project pages should not phone home by default. |
| `share` is in the core and publishes to ht-ml.app, public by default. Orchestrator refuses it in both `cmd_lavish` and the action guard. | **No publishing in the core.** `export` (local inlining) stays. Publishing is a later, separately installed provider plugin that needs an explicit `--to <provider>` and a confirmation. | Removes the most dangerous command, and with it the need for wrappers and guards. |
| With Tailscale running, the server **binds the tailnet address automatically** (README "Network binding"), and the README itself warns that this "exposes an unauthenticated server". | **Loopback only** (127.0.0.1 and ::1). Remote or phone access needs `--listen <addr>` plus a session token, which is on anyway. | Secure default. Observation: `orc lavish` does not set `LAVISH_AXI_HOST` today. Tailscale is not installed on this machine, so there is no exposure now, but setting `LAVISH_AXI_HOST=127.0.0.1` in `cmd_lavish` would pin it. |
| The session key is a hash of the file path. It is "derived, not secret", so authorisation rests on Host and Origin checks alone. | **A random 256-bit capability token** per session in the URL fragment (`#t=`), sent by the chrome as a header. The CLI reads it from a 0600 state file. | Defence in depth. Any local process or web page that guesses the path and port still cannot post notes. |
| Poll delivery is **destructive**: the batch is taken and restored on disconnect, with intricate restore rules (invariants step 7). | **An append-only feedback log with sequence numbers.** `wait --after <seq>` is non-destructive and replayable. The CLI keeps the agent's cursor. | Removes a whole class of take/restore race bugs. Lets an observer such as Orchestrator read without stealing the agent's batch, and gives an audit trail. |
| Output is TOON by default via `axi-sdk-js`. The `update` self-updater comes from the SDK. | Compact text by default, **`--json` on every command**, and a versioned schema. No self-updater. | Machine-readable output is an extension point. Self-mutation fights pinning. |
| Node ≥ 22 only. The orc wrapper has to hunt for it in nvm. | Node ≥ 20 (current LTS floor) for the npm path, plus **standalone binaries** (see 2.5). | Removes the "find a Node 22" step that `_lavish_node_dir` exists for. |
| A large MVP surface: Excalidraw whiteboard (React plus the Excalidraw bundle), layout-warning inbox, revision legend, phone layout, share. | A small MVP (2.8). The whiteboard and layout checks come later. | Lavish's invariants show these features carry most of the edge-case weight. |
| Hard-coded herdr chime (`LAVISH_AXI_HERDR_CHIME`). | A generic `notify` hook command (2.7). | The tool stays unaware of any terminal or orchestrator. |

### 2.2 Components

```
 agent harness ──shell──▶ stet CLI ──HTTP (loopback, token)──▶ stet daemon
                                                         │  ├─ store: $XDG_STATE_HOME/stet/
                                                         │  ├─ watcher (artifact file)
 browser ◀──────── review UI (chrome) ◀── WebSocket ─────┘  └─ events.jsonl
            └─ sandboxed iframe: artifact.html + sdk.js ──postMessage──▶ chrome
```

| Component | Responsibility | Notes |
|---|---|---|
| **CLI** (`stet`) | The agent's only interface. Starts the daemon on demand and prints compact results (`--json` for machines). | Every command is idempotent where possible. Documented exit codes (2.3). |
| **Daemon** | One per user state directory. Binds 127.0.0.1 and ::1 on a default port, falling back to any free port written to `server.json` (pid, port, version, started). Shuts itself down when idle (default 30 min with no browser and no waiter). | A version handshake on `/health`: a CLI that finds an older daemon asks it to `POST /shutdown` and restarts it, as Lavish does. A daemon is never killed by port number alone. |
| **Artifact route** | Serves the file with one injected `<script src="/_stet/sdk.js" data-session=…>`. Sibling assets are realpath-confined to the artifact's directory. | `Content-Security-Policy: sandbox allow-scripts allow-forms allow-popups` on the artifact response too, so opening the artifact URL directly is also sandboxed. |
| **SDK** (in the iframe) | Element picking, text-range selection, anchor computation, capture of `data-stet-question` controls, scroll and draft reporting. Talks only to the parent through `postMessage`. | Has no API access: an opaque origin and no token. The chrome accepts messages only from the current iframe's `contentWindow` with the current load nonce. |
| **Review UI** (chrome) | The top-level page `/s/<id>#t=<token>`: the artifact frame, the note queue, the composer, Send / Send & End, agent replies rendered as **sanitised** Markdown, per-note status (open, addressed, won't-do), and agent presence (waiting, listening, working). | The only thing that can create feedback. Responds `frame-ancestors 'none'`. |
| **Store** | `sessions/<id>.json` (file path, title, labels, status, revision). `feedback/<id>.jsonl` (append-only, `seq` per entry). `replies/<id>.jsonl`. `attachments/<id>/`. Directories 0700, files 0600. Atomic writes by rename. The daemon is the only writer. | The session id is short and random. The canonical file path is a lookup key as well, so agents can keep using paths, which is Lavish's good ergonomics. |
| **Live reload** | Watches the artifact file (and any opted-in sibling globs). A 150 ms debounce, then a `reload` event. The chrome reloads the iframe and restores scroll, draft and answers. | Watch the file, not the directory tree. Lavish found that watching a directory recursively saturated the event loop in large trees. |
| **Event log** | `events.jsonl`: one line per session-opened, feedback, reply, ended or disconnected event, with session id, labels and seq. **It never contains note text.** Readers fetch the text through `stet wait` or `stet show`. | The integration point for orchestrators, editors and notifiers (2.7). |

**Live events transport:** use a WebSocket, through the `ws` package (one small dependency). Lavish moved from SSE to WebSocket because several SSE tabs exhaust the browser's HTTP/1.1 connection pool for one origin. Apply Lavish's lesson as well: an application-level ping, so that a half-open socket after laptop sleep does not keep a "present" reviewer counted forever.

### 2.3 The agent contract

**Commands (MVP):**

| Command | Behaviour |
|---|---|
| `stet open <file.html> [--label k=v]… [--no-browser] [--json]` | Creates or resumes the session and opens the browser. On WSL it uses `wslview` or `explorer.exe`, and otherwise prints the URL. Prints the session id and URL. Refuses to reopen a session the user ended unless `--reopen` is given. |
| `stet wait <file\|id> [--after <seq>] [--timeout <dur>] [--owner <label>] [--reply-file <md>\|-m <text>] [--json]` | Long-polls until there is feedback after the cursor, the session ends, or the browser has been disconnected longer than the grace period. `-m` posts a reply and starts waiting in one atomic step. The cursor is stored per `--owner`, default `agent`. |
| `stet reply <file\|id> -m <text> \| --file <md> [--note <id> --status addressed\|wontfix]` | Posts a reply and exits 0 only when the daemon acknowledges it. It can resolve specific notes, and the UI then shows a tick on each one. |
| `stet status [<file\|id>] [--json]` | **Non-blocking.** Returns the pending count after the cursor, the last seq, presence, and the session status. This is what a supervisor polls. |
| `stet show <file\|id> --seq <n>` | Re-reads one past batch. Possible because the log is non-destructive. |
| `stet end <file\|id>` / `stet list` / `stet stop` | Ends the session as the agent, lists sessions, and stops the daemon. |
| `stet export <file> [--out p]` | Inlines local assets only and makes no network request. |
| `stet guide [topic]` | The single source of agent guidance: workflow, design rules and playbooks, replacing Lavish's `--help`, `design` and `playbook`. |
| `stet doctor` / `stet --version` | Environment check. `--version` takes a fast path with no daemon start (a Lavish lesson: harnesses probe `--version` at startup). |

**Exit codes for `wait`:**

| Code | Meaning |
|---|---|
| 0 | Feedback |
| 3 | Ended |
| 4 | Browser disconnected |
| 5 | Timeout |
| 1 | Error |
| 130 / 143 | Interrupted. Safe to re-run, because nothing was consumed. |

**Feedback payload** (`--json`; the text form is the same content rendered compactly):

```json
{
  "schema": "stet.feedback/1",
  "session": { "id": "s_7hq2", "file": "/abs/plan.html", "status": "open", "labels": { "task": "ml-fix" } },
  "status": "feedback",
  "seq": { "from": 12, "to": 14 },
  "notes": [
    {
      "id": "n_0013",
      "kind": "element",
      "comment": "Split this step: the migration and the backfill are separate risks.",
      "anchor": {
        "stable_id": "step-3",
        "selector": "#plan > li:nth-of-type(3)",
        "tag": "li",
        "text": "Migrate the loan stages table and backfill…",
        "source_line": 42
      },
      "attachments": [],
      "at": "2026-10-04T09:12:03Z"
    },
    {
      "id": "n_0014",
      "kind": "text",
      "comment": "Is this number right?",
      "anchor": { "selector": "#summary p", "quote": "14 GB", "prefix": "came to ", "suffix": ".", "source_line": 17 }
    },
    { "id": "n_0015", "kind": "answer", "question": "approach", "value": "B", "label": "Option B: two workers" }
  ],
  "next": "Edit the file (the page reloads), then: stet wait /abs/plan.html -m \"<what changed>\"",
  "dom_snapshot_path": "/home/u/.local/state/stet/snapshots/s_7hq2-14.html"
}
```

How it improves on Lavish's prompt shape:

- **`stable_id` first.** Use the nearest `id` or `data-stet-id`, and fall back to a CSS path. Guidance tells agents to put ids on meaningful elements; Lavish's diagram playbook already says this.
- **`source_line`.** The daemon parses the file on disk with parse5 source locations and maps a stable id or selector back to a line. This is `null` for content built by scripts. The agent jumps straight to the right line.
- **Text quotes use the W3C Web Annotation `TextQuoteSelector` shape** (`quote`, `prefix`, `suffix`). This anchors more robustly than DOM paths and offsets, and is a known standard.
- **The DOM snapshot is a file path, not inline text.** It costs no tokens unless the agent opens it.
- **Field order is a contract.** `notes` and `next` come before anything large.

**Waiting:**

- **Default: a foreground long poll.** Heartbeat on stderr, result on stdout.
- **Harness guidance** comes from `stet guide wait`, taken from Lavish's `POLL_WAKE_PATH_RULES`, which are good. A background wait is allowed only through a harness feature that is guaranteed to notify the same agent when it finishes, such as Claude Code's background Bash. Never use `nohup` or `&`. On Codex, stay attached.

Alternatives considered:

| Option | Verdict |
|---|---|
| Polling `stet status` in a loop | Fine for supervisors. Wasteful for agents. |
| Agent tails `events.jsonl` | Possible, but it pushes parsing onto the agent. Offered for tools, not for agents. |
| MCP notifications | Not universal across harnesses, and it adds a second contract. Maybe later as an optional adapter. |
| Webhook or command hook | User-configured only (2.7). Good for supervisors and notifications. |

**Replies** are plain or sanitised Markdown (headings, lists, code, links), limited to about 256 KB. Notes can be resolved individually. Replies are stored in the log, so the conversation survives reloads and restarts.

### 2.4 Distribution and version drift

| Channel | How | Drift control |
|---|---|---|
| **npm / npx** | `npx -y stet@1.4.2 open plan.html`. Package `files` = `dist/`, `skills/`, `plugin.json`, LICENSE, NOTICE. | Pin an exact version in wrappers. The skill pins only the major (`stet@1`). The schema carries a version (`stet.feedback/1`). |
| **Single binary** | GitHub Releases for linux-x64/arm64, darwin-x64/arm64 and win-x64, with SHA256SUMS and signed provenance (npm `--provenance`, Sigstore for binaries). | `stet --version` matches the npm version. No self-updater. Package managers and wrappers decide when to upgrade. |
| **Agent Skill stub** | `skills/stet/SKILL.md` is generated by a script, and CI fails when it drifts (Lavish's `build-skill.js --check`). It holds no workflow rules. It says "run `stet guide`" and "use `npx -y stet@1` if `stet` is not on PATH". | Behaviour lives in the CLI, so an installed stub cannot go stale. |
| **Agent Plugin** | `plugin.json` at the package root, as in Lavish. The installed npm package *is* the plugin. | Same package version. |
| **AGENTS.md snippet** | `stet guide agents-md` prints a 5-line block for repos that use AGENTS.md (Codex, Cursor, Copilot). | The block points at `stet guide` as well. |
| **Daemon vs CLI** | `/health` returns `{app, version, schema}`. A mismatched CLI restarts an owned daemon and never touches a foreign one. | Lavish's `isOwnedServer` rule: identify by state directory, never by port alone. |

### 2.5 Runtime and language

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **Node + TypeScript** | The SDK and UI are JS anyway, so there is one language. npx means zero-install for every agent ecosystem. parse5, ws and chokidar are mature. Same stack as Lavish, so borrowed parts drop in. | Needs Node on the machine. Startup is about 60–100 ms. | **Pick this as the source language.** |
| **Bun** (`bun build --compile`) | One standalone binary per platform from the same TypeScript code. Fast startup. | 50–90 MB binaries. Some Node APIs differ (test `fs.watch` and `ws`). | **Use for the release binaries**, built from the Node codebase, with CI testing both. Node SEA is the fallback if Bun has problems. |
| **Go** | Small static binary, assets embedded with `embed.FS`, excellent HTTP server, trivial cross-compiling. | Two languages (Go plus browser JS). No npx path without a wrapper package. Can't reuse Lavish code. | A strong second choice if npm distribution doesn't matter to you. |

Keep runtime dependencies to about 4: `ws`, `parse5`, `chokidar` (or `fs.watch` plus polling fallback) and a Markdown sanitiser. Express is unnecessary, because `node:http` is enough for about 15 routes. Bundle everything with esbuild, so `npx` installs one package.

### 2.6 Security defaults

| Default | Detail |
|---|---|
| Loopback only | Binds 127.0.0.1 and ::1. `--listen <addr>` is required for anything else, and a wildcard (`0.0.0.0`) is refused unless `--i-understand-lan`. A warning names the risk each time. |
| Session token | 256-bit random value per session, held in the URL **fragment** so it never reaches server logs or Referer headers. The chrome sends it as an `Authorization` header and a WebSocket subprotocol. The CLI reads it from the 0600 `sessions/<id>.json`; holding the file means you are authorised. |
| Host allowlist and Origin guard | As in Lavish: blocks DNS rebinding and cross-site POSTs, even with a token. |
| Sandboxed artifact | iframe `sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"` without `allow-same-origin`, plus a CSP `sandbox` header on the artifact response. The SDK has no token. |
| Human-only send | Page scripts and SDK controls can only *queue* notes, and every queued note is labelled `source: page-control` or `source: reviewer`. Only a click on Send in the chrome commits a batch. |
| Rendering of agent text | Replies are sanitised Markdown, never raw HTML in the chrome. |
| Telemetry | Absent from the MVP. If it is ever added: opt-in, `stet telemetry status` shows exactly what is sent, and `DO_NOT_TRACK=1` is respected. |
| Third parties | The core makes no outbound requests at all. `export` inlines only local assets. Publishing is a separate plugin, off by default, behind an explicit command and a confirmation. |
| Files | State directory 0700. Attachments are size-limited and checked by MIME sniffing. Asset serving is realpath-confined. |

### 2.7 Extension points (the tool stays unaware of who uses them)

| Extension point | What it is | Example consumer |
|---|---|---|
| `--json` everywhere plus a versioned schema | A stable machine output. | Scripts and wrappers. |
| `--label k=v` on `open` | Opaque labels stored on the session and echoed in `status`, `list` and events. | Orchestrator tags `task=<id>`. |
| `--owner <label>` cursors | Independent read cursors per consumer on the non-destructive log. | The agent and a supervisor read the same feedback without stealing it. |
| `events.jsonl` + `stet events --follow --json` | A metadata-only event stream. | A watcher hook. |
| `notify` command (user config only: `~/.config/stet/config.json` or `STET_NOTIFY_CMD`) | The daemon runs it with an event JSON on stdin (no note text). Fire-and-forget, with a timeout. | Desktop notification, a terminal chime, Orchestrator's wake. |
| Guide overlays: `STET_GUIDE_EXTRA=<file>` | Appends house rules to `stet guide` output. | "Pages live in X; no credentials". |

### 2.8 Scope

**MVP (v0.x, roughly 3–5k lines of code):**

- Commands: `open`, `wait`, `reply`, `status`, `show`, `end`, `list`, `stop`, `guide`, `doctor`, `--version`, `--json`.
- Annotation: element pick, text-range selection, general chat, and `data-stet-question` answer capture.
- Non-destructive feedback log with cursors; per-note resolve.
- Live reload with scroll, draft and answer restore.
- Loopback, token, sandbox, Host and Origin guards. No telemetry, no publishing.
- npm package, generated skill stub, `plugin.json`.
- Linux, macOS and WSL. `source_line` mapping. The event log and `notify` hook.

**Later:**

- Bun or SEA binaries for each platform, and a Homebrew tap.
- Image attachments.
- `export` with asset inlining.
- Passive layout diagnostics.
- Opt-in Mermaid whiteboard. This is a heavy dependency: Excalidraw plus React.
- An opt-in `<stet-diff>` web component for code diffs that works without the tool.
- Native Windows.
- Phone access through an explicit `--listen` and the token.
- An optional MCP adapter.
- Publishing provider plugins.

### 2.9 Licensing

Lavish is MIT. MIT allows copying, modifying and relicensing in larger works, as long as **the copyright and permission notice are kept** with the copied portions.

| Approach | What it means | Pros | Cons |
|---|---|---|---|
| **Fork** | Start from the lavish-axi repo, rename it, and change the defaults. | Fastest to something working. Inherits years of edge-case fixes. | Inherits 25k lines and its complexity, the axi-sdk and TOON coupling, the share and telemetry code to remove, and a fast-moving upstream (v0.1.81, frequent releases) to keep merging. It would be "Lavish with different defaults". |
| **Clean-room** | Write from a behavioural spec without reading the source. | No attribution needed. | Unnecessary for an MIT source. Clean-room matters for incompatible licences, not for MIT. It is also already impossible in spirit, since the source has been read. |
| **Fresh implementation that borrows parts with attribution** (recommended) | Write a new codebase to this design. Where a Lavish module is the right answer, copy it and keep its notice. Candidates: the selector and text-range anchoring in `artifact-sdk.js`, the Host allowlist logic, `resolveArtifactAsset`, and the restore-without-events pattern. | Small codebase you own, with the lessons included. | Each borrowed file needs a header ("Portions © Kun Chen, MIT, from lavish-axi <commit>") and a `NOTICE` / `THIRD-PARTY-NOTICES.md` entry. Track the commit you copied from. |

Licence for your project: MIT, so as not to surprise anyone, or Apache-2.0 if you want an explicit patent grant. Both can include MIT code. If the tool is published under JurisTech's GitHub organisation rather than your own, check company IP policy first. Treat `docs/invariants.md` as a *reading list of failure modes* to design against, not text to copy.

---

## 3. Ways to embed it into Orchestrator

The constraints come from AGENTS.md:

- rule 4: workers never talk to the Boss;
- "Review pages (Lavish)": pages go in `$ORC_HOME/state/reviews/`, page notes are not grants, and nothing is shared;
- the grant model: `ORC_BOSS_APPROVED` must quote the Boss's chat words.

Two things in the current setup are relevant:

- **The Commander's wait.** In SKILL.md step 3, it waits through a Bash `run_in_background` poll, separate from the `orc-watch.sh` Stop hook that wakes it for workers.
- **Workers using Lavish.** "Workers never use Lavish" is written down but, as far as I can find, not enforced. Grepping for `lavish` finds it only in `bin/orc`, AGENTS.md, SKILL.md, README, the action guard and its test. There is nothing in `templates/` (the worker guard template).

### Option A: Thin wrapper (today's shape, retargeted)

**How it works.** `orc stet <args>` replaces `orc lavish`. It pins `ORC_STET_VERSION`, sets `STET_STATE_DIR=$ORC_HOME/state/stet` to isolate Orchestrator's sessions, and sets `STET_GUIDE_EXTRA` to a house-rules file (pages in `state/reviews`, no credentials, notes are not grants). There is no telemetry flag or `share` refusal to maintain, because the tool has neither.

**What changes.** `cmd_lavish` becomes a shorter `cmd_stet`, and SKILL.md steps are renamed. **Pros:** Trivial, same rules as today. **Cons:** Still `npx` at run time (network on first run, Node lookup), a hand-written page every time, and a background poll the Commander can forget. **Rules:** Only the Commander runs it and handles page notes, as today.

### Option B: Install-managed dependency

**How it works.** `install.sh` vendors the pinned version into `$ORC_HOME/vendor/stet/<version>/`. It uses either:
- `npm install --prefix … stet@x.y.z --ignore-scripts`, with integrity from the lockfile; or
- the release binary checked against `SHA256SUMS`.

`orc stet` runs that copy. `orc doctor` / `orc project check` reports whether it is missing.

**What changes.** `install.sh` gets a step. `cmd_stet` resolves the vendor path instead of `npx`. `ORC_STET_VERSION` moves to `install.sh` and `local.env`.

**Pros:**
- No network at review time.
- With a binary, no Node 22 hunt (removes `_lavish_node_dir`).
- Upgrades become an explicit, reviewable change to Orchestrator.

**Cons:** One more thing for `install.sh` to manage. You also need a decision on binaries versus a Node prefix.

**Rules:** No change. It is purely about supply chain, and it strengthens "everything stays local".

### Option C: `orc review <id>` builds pages from task state

**How it works.** `orc review <id>` renders `$ORC_HOME/state/reviews/<id>.html` from:
- the brief;
- `report.md`;
- `orc status <id>` (status, grants held, grants requested);
- `git diff <base>...<branch>` plus `git status` of the worktree (read-only).

Each diff hunk and report paragraph gets a stable id (`data-stet-id="diff:app/Foo.php:120"`, `report:p7`), so notes come back as file and line. It then runs `orc stet open <page> --label task=<id> --label kind=worker-review` and prints one line for the Commander. `orc review --plan <file>` does the same for an `/ahoy` dispatch plan.

**What changes.**
- A new `cmd_review` plus a small template. Either static HTML with inline CSS and no CDN, or the tool's later `<stet-diff>` component.
- Secret scrubbing of diff lines against `.env`-style patterns.
- SKILL.md "Review pages" step 1 becomes `orc review <id>`.

**Pros:** It covers the most common moments: a long report, and a diff before the commit grant. Pages are consistent and cost no Commander tokens to write. Notes are already tied to file and line, so turning them into `orc send` text is mechanical.

**Cons:**
- Orchestrator now owns an HTML template.
- Large diffs need truncation or folding.
- A diff page carries project code into a browser tab. It is local, but still a new surface for anything sensitive in the diff.

**Rules:**
- The page is built by orc and read by the Commander only.
- Workers are untouched (rule 4).
- The page never offers buttons that perform grants. A "Request commit" control produces a note, which the Commander must confirm in chat.
- The tool sees only opaque labels.

### Option D: Feedback routed to workers (Commander-mediated)

**How it works.** `orc review route <id> [--seq n]` reads a batch with `orc stet show` and **prints a draft** `orc send <id>` message ("app/Foo.php:120: <comment>"; answers become instructions). The Commander sends it, edits it, or asks the Boss. Notes that look like gated actions (commit, land, push, stop, database writes, full phpunit) are flagged and left out of the draft.

**What changes.** A new subcommand. Optionally, an action-guard heuristic: an `ORC_BOSS_APPROVED` quote that matches a stored page note verbatim, and no chat text, is suspicious. The real contract stays "quote the chat".

**Pros:** The Boss's mark on a diff line reaches the worker as a precise fix in one step, with the Commander still deciding. **Cons:** It drifts toward auto-forwarding if drafts are sent unread, and keyword flagging will miss things. **Rules:** Workers hear only from the Commander. Grants are never in the draft. Nothing is sent automatically.

### Option E: Hook-based wake instead of a background poll

**How it works.** `orc-watch.sh` (the asyncRewake Stop hook) gains an attention signature per open review session, `R:<session>:<last_seq>`, computed from `orc stet status --json --owner commander`. A new seq wakes the Commander with "The Boss left 3 notes on <page>". The Commander then runs `orc stet wait <page> --after <cursor>`, which returns immediately. Alternatively, the tool's `notify` hook (`STET_NOTIFY_CMD` set by `orc stet`) touches a file that the watcher already checks.

**What changes.**
- `orc-watch.sh` gets a review-signature function.
- SKILL.md step 3 changes from "start a background poll" to "the watcher will wake you".
- This depends on the tool's **non-destructive cursor** (2.3), which Lavish lacks: Lavish's poll consumes the batch, so a watcher could not peek.

**Pros:**
- One wake path for workers and pages.
- No forgotten background polls.
- Survives the Commander's turns.
- Follows the CLAUDE.md requirement to never promise an update that no running watch will trigger.

**Cons:**
- Depends on the Stop hook running. SKILL.md already has a fallback watch for that.
- Polling latency equals the watcher's interval.

**Rules:** Read-only status checks. The Boss's notes still reach only the Commander.

### Option F: Per-worker pages and a fleet page, relayed by the Commander

**How it works.** Option C pages for every task that needs a decision, plus a generated index page `state/reviews/fleet.html` built from `orc status --json` (finished tasks, pending grant questions, blocked notes). The Boss triages in the browser. The Commander processes notes per page and relays with `orc send`, as in D.

**What changes.** C + D + E, plus the index generator. **Pros:** The richest experience. **Cons:** The most code, several pages open at once, and a risk of moving the Boss's attention out of chat, where grants must happen. **Rules:** As in C to E. The fleet page must state that grants are given in chat.

### Comparison

| Option | Orc changes | Boss experience | Commander tokens | Rule risk |
|---|---|---|---|---|
| A Thin wrapper | Tiny | As today | High (writes pages) | Low |
| B Install-managed | Small (`install.sh`) | As today, faster and offline | High | Lowest |
| C `orc review <id>` | Medium | Consistent pages on every diff or report | Low | Low |
| D Routing drafts | Medium | Notes become fixes faster | Low | Medium (auto-forward drift) |
| E Hook wake | Small–medium | Faster, no missed notes | Low | Low |
| F Fleet pages | Large | Richest | Low | Medium (attention out of chat) |

### Recommendation

Make **Option C (`orc review <id>`) the target**. Build it on **B** for supply chain and **E** for waking. Treat **D** as a later, optional helper. Skip **F** until C has been used in practice.

C targets the exact moments the Boss already reviews: reports and diffs before a commit grant. It turns notes into file-and-line steering with no new authority anywhere. E removes the one fragile piece of today's flow, the hand-started background poll.

**Migration path from today's `orc lavish`:**

| Step | What | Behaviour change |
|---|---|---|
| 0 (now, optional) | In `cmd_lavish`, set `LAVISH_AXI_HOST=127.0.0.1` so Lavish can never auto-bind a tailnet. Add a worker-guard rule (template) refusing `lavish-axi` and `orc lavish` for workers, to enforce "Workers never use Lavish". | None for the Boss. |
| 1 | Build the tool MVP outside Orchestrator. Add `cmd_stet` (Option A) next to `cmd_lavish`. SKILL.md documents both, preferring `orc stet`. | Same flow, new tool. |
| 2 | `install.sh` vendors the pinned stet (Option B). `cmd_stet` stops using npx. | Offline, no Node hunt. |
| 3 | `orc review <id>` and `orc review --plan` (Option C). AGENTS.md "Review pages" names it as the default way to make a page. | Consistent diff and report pages. |
| 4 | `orc-watch.sh` review signatures (Option E). SKILL.md drops the background poll. | Notes wake the Commander like worker events. |
| 5 | Remove `cmd_lavish`, `LAVISH_BIN` and `lavish_share` from the action guard, and `tests/orc-lavish.test.sh`. Rename "Review pages (Lavish)". Keep the guard rule for any future publish provider: `stet publish` is gated like `share` is today. | Lavish gone. |
| 6 (optional) | `orc review route` drafts (Option D). | Faster relay to workers. |

Throughout, the tool knows nothing about Orchestrator. Orchestrator uses only public surfaces: `--label`, `--owner`, `STET_STATE_DIR`, `STET_GUIDE_EXTRA`, `STET_NOTIFY_CMD`, `status --json` and `show`.

---

## Open questions for the user

1. **Build or join?** `pointback` (npm, published 2026-10-02, Apache-2.0) and `markloop` occupy the same space. Do you want to evaluate them first, or are you set on your own tool?
2. **Name:** which of `stet`, `galleyproof` and `deixis` (or `bluepencil`)? Should I also check domains, Homebrew and trademarks before you commit? Do you want an npm scope as a fallback?
3. **Owner and licence:** personal GitHub or the JurisTech organisation? MIT or Apache-2.0? If JurisTech, has company IP policy been checked?
4. **Runtime:** is "Node ≥ 20 via npx, plus Bun-compiled binaries" acceptable, or do you prefer Go and a single binary from day one?
5. **Whiteboard:** do you actually use Lavish's Mermaid/Excalidraw whiteboard? It is the heaviest dependency and could stay out entirely.
6. **Remote review:** will you ever review from a phone or another machine? If not, loopback-only can be absolute, with no `--listen` at all.
7. **Feedback semantics:** do you agree with the non-destructive, cursor-based log instead of Lavish's take-on-delivery? Option E depends on it.
8. **Diff pages:** may `orc review` put full worker diffs (project code) into a local browser page? Should it scrub `.env`-like lines, or skip some paths entirely?
9. **Step 0 now:** do you want the two small hardening changes to today's `orc lavish` (`LAVISH_AXI_HOST=127.0.0.1`, and a worker-guard rule blocking Lavish for workers) made before any of this?
10. **Telemetry:** none ever, or opt-in later for public users of the tool?
