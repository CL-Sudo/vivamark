# vivamark

**Make an agent's page alive.** vivamark opens a plan, report or diff that an AI
coding agent wrote, as HTML or Markdown, in your browser. You point at what you
mean: a paragraph, a table cell, a line of a diff. You say what you want, and
the agent receives each note tied to exactly that spot. It edits the file, the
page updates in place, and the conversation carries on until you approve.

> **Status: design stage.** Nothing is built yet. See
> [`docs/DECISIONS.md`](docs/DECISIONS.md) for what has been decided and
> [`docs/research/`](docs/research/) for how we got there.

## What it will be

- **A CLI any agent can drive**: `vivamark open`, `wait`, `reply`, `status`.
  Works with Claude Code, Codex, Copilot CLI, Cursor, or a plain shell; no
  orchestrator required.
- **Local only.** The review server listens on this machine and nowhere else.
  No telemetry, ever. Nothing is published to third-party hosts.
- **Your file stays yours.** Serving a page adds one script tag; the saved file
  opens the same without vivamark.
- **Only you can send.** Scripts on the agent's page can suggest notes; only a
  deliberate click from you reaches the agent.

## Prior art

vivamark learns from [lavish-axi](https://github.com/kunchenguid/lavish-axi)
(MIT) and [pointback](https://github.com/Abhijeet34/pointback) (Apache-2.0).
Any code taken from either keeps its notice; see
[`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).

## Licence

[MIT](LICENSE).
