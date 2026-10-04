# vivamark

**Make an agent's page alive.** vivamark opens a plan, report or diff that an AI
coding agent wrote, as HTML or Markdown, in your browser. You point at what you
mean: a paragraph, a table cell, a line of a diff. You say what you want, and
the agent receives each note tied to exactly that spot. It edits the file, the
page updates in place, and the conversation carries on until you approve.

> **Status: early.** The core loop works: `open`, `wait` and `reply` on an HTML
> file. The first-version features F1–F8 are not built yet. See
> [`docs/DECISIONS.md`](docs/DECISIONS.md) for what has been decided and
> [`docs/research/`](docs/research/) for how we got there.

## Try it

You need Node 20 or newer. From a clone of this repository:

```sh
npm ci
npm run build
node dist/cli.js open examples/plan.html
```

Your browser opens the review page. If it does not, open the URL that the
command printed. In a second terminal, play the agent:

```sh
node dist/cli.js wait examples/plan.html
```

On the page, select some text, or press **Point** and click an element. Type a
note and press **Add note**, then **Send**. `wait` prints each note with what it
points at (an id or selector, the quoted text, and the line in the file) and
exits. Answer on the page:

```sh
node dist/cli.js reply examples/plan.html -m "Split step 2 as asked."
```

Edit `examples/plan.html` and the page reloads in place. Running `wait` again
returns the same notes; `wait examples/plan.html --after <seq>` waits for newer
ones. `node dist/cli.js --help` lists every option; `node dist/cli.js stop` stops
the background server.

![The review page](docs/screenshots/review-ui.png)

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
