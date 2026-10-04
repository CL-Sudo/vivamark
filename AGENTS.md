# vivamark: notes for agents working on this repository

vivamark is a local review loop between one person and one AI agent over one
saved HTML or Markdown file. Read `README.md`, then `docs/DECISIONS.md`.
Decisions there are settled; propose a change as a new entry rather than
working against one.

## Non-negotiables

These are product promises. A change that breaks one is a bug, however useful.

1. **Loopback only.** The server binds 127.0.0.1 and ::1. There is no flag,
   environment variable or config key that widens it.
2. **No outbound network requests** from the CLI, server or injected script.
   No telemetry, no update checks, no publishing. A test must prove it.
3. **Only a deliberate human action sends feedback.** Page scripts may queue
   notes; nothing reaches the agent until the reviewer sends.
4. **The saved file is the source of truth.** Serving adds exactly one script
   tag. vivamark never writes to the reviewed file.
5. **vivamark knows nothing about any orchestrator or harness.** Integration
   happens through public surfaces only: `--json`, labels, cursors, the event
   log, the notify hook.

## Borrowed code

Code copied from lavish-axi (MIT) or pointback (Apache-2.0) keeps its licence
header, names the source commit, and gets an entry in
`THIRD-PARTY-NOTICES.md`. Do not copy from projects under source-available
licences (PolyForm and the like).

## Maintaining this file

Keep it to what nearly every session on this repo needs. Point to the file
that owns a detail instead of repeating it.
