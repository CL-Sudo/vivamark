#!/usr/bin/env python3
"""Render 10 design-language mockups of the review screen to PNG.

Each style is one set of tokens plus a little extra CSS over the same markup,
so the screenshots differ only in design language, not in content.
"""
import os
import pathlib
import shutil
import subprocess

OUT = pathlib.Path(__file__).resolve().parent

MARKUP = """
<div class="app">
  <header class="bar">
    <div class="brand"><span class="logo"></span>vivamark</div>
    <div class="file">plan.md <span class="chip">round 2</span></div>
    <div class="presence"><span class="dot"></span>Agent listening</div>
  </header>
  <div class="body">
    <article class="doc">
      <div class="eyebrow">Implementation plan</div>
      <h1>Request Certificate screen</h1>
      <p>A Setup screen where a Director or Attestor enrols their own certificate. Nothing is written to the database.</p>
      <h2>Phases</h2>
      <ol>
        <li>Enrolment class and unit tests, autoload refresh.</li>
        <li class="picked">Applet scaffold, save handler and container page.<span class="pin">1</span></li>
        <li><span class="hl">Deploy and rollback SQL</span>, browser verification.<span class="pin">2</span></li>
      </ol>
      <div class="changed">+ Added: rollback lines for the matrix rows</div>
    </article>
    <aside class="side">
      <div class="side-title">Notes <span class="count">2</span></div>
      <div class="note">
        <div class="note-head"><span class="num">1</span><span class="intent change">Change</span><span class="sev">blocking</span></div>
        <p>Split the save handler from the scaffold; they are separate risks.</p>
      </div>
      <div class="note">
        <div class="note-head"><span class="num">2</span><span class="intent question">Question</span></div>
        <p>Does this cover the KBAPPMATRIX rows too?</p>
        <div class="reply">Agent: yes, added in round 2.</div>
      </div>
      <div class="composer">Add a note…</div>
      <div class="actions">
        <button class="btn ghost">Request changes</button>
        <button class="btn primary">Approve</button>
      </div>
    </aside>
  </div>
</div>
"""

BASE = """
* { box-sizing: border-box; margin: 0; }
html, body { width: 1200px; height: 750px; background: var(--bg); color: var(--fg); font-family: var(--ui); }
.app { height: 100%; display: flex; flex-direction: column; }
.bar { display: flex; align-items: center; gap: 24px; padding: 14px 24px; background: var(--bar); border-bottom: 1px solid var(--line); font-size: 14px; }
.brand { display: flex; align-items: center; gap: 8px; font-weight: 600; }
.logo { width: 18px; height: 18px; border-radius: var(--r-sm); background: var(--accent); display: inline-block; }
.file { color: var(--muted); display: flex; gap: 8px; align-items: center; }
.chip { font-size: 12px; padding: 2px 8px; border-radius: 999px; background: var(--chip); color: var(--chip-fg); }
.presence { margin-left: auto; color: var(--muted); display: flex; gap: 6px; align-items: center; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ok); display: inline-block; }
.body { flex: 1; display: grid; grid-template-columns: 1fr 360px; min-height: 0; }
.doc { padding: 40px 56px; font-family: var(--docfont); overflow: hidden; background: var(--paper); }
.eyebrow { font-family: var(--ui); font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: var(--accent); margin-bottom: 10px; }
.doc h1 { font-size: 30px; line-height: 1.2; margin-bottom: 12px; font-weight: var(--h-weight); }
.doc h2 { font-size: 19px; margin: 26px 0 10px; font-weight: var(--h-weight); }
.doc p, .doc li { font-size: 16px; line-height: 1.6; color: var(--fg2); max-width: 60ch; }
.doc ol { padding-left: 22px; display: grid; gap: 8px; }
.doc li { position: relative; padding: 4px 8px; border-radius: var(--r-sm); }
.picked { outline: 2px solid var(--accent); outline-offset: 2px; background: var(--accent-soft); }
.hl { background: var(--mark); border-radius: 3px; padding: 0 2px; }
.pin { position: absolute; right: -34px; top: 50%; margin-top: -11px; width: 22px; height: 22px; border-radius: 50%; background: var(--accent); color: var(--on-accent); font: 600 12px/22px var(--ui); text-align: center; }
.changed { margin-top: 22px; font-family: var(--ui); font-size: 13px; color: var(--ok); background: var(--ok-soft); border-radius: var(--r-sm); padding: 8px 12px; display: inline-block; }
.side { border-left: 1px solid var(--line); background: var(--side); padding: 20px; display: flex; flex-direction: column; gap: 12px; font-size: 14px; }
.side-title { font-weight: 600; display: flex; gap: 8px; align-items: center; }
.count { font-size: 12px; background: var(--chip); color: var(--chip-fg); border-radius: 999px; padding: 1px 8px; }
.note { background: var(--card); border: 1px solid var(--card-line); border-radius: var(--r); padding: 12px 14px; box-shadow: var(--shadow); display: grid; gap: 6px; }
.note p { line-height: 1.5; color: var(--fg2); }
.note-head { display: flex; gap: 8px; align-items: center; font-size: 12px; }
.num { width: 20px; height: 20px; border-radius: 50%; background: var(--accent); color: var(--on-accent); text-align: center; line-height: 20px; font-weight: 600; }
.intent { padding: 2px 8px; border-radius: 999px; font-weight: 600; }
.intent.change { background: var(--accent-soft); color: var(--accent-strong); }
.intent.question { background: var(--q-soft); color: var(--q); }
.sev { color: var(--bad); font-weight: 600; }
.reply { font-size: 13px; color: var(--muted); border-left: 2px solid var(--line); padding-left: 8px; }
.composer { margin-top: auto; border: 1px solid var(--line); border-radius: var(--r); padding: 12px; color: var(--muted); background: var(--card); }
.actions { display: flex; gap: 8px; justify-content: flex-end; }
.btn { font: 600 14px var(--ui); padding: 9px 16px; border-radius: var(--r-btn); cursor: pointer; }
.btn.ghost { background: transparent; border: 1px solid var(--line); color: var(--fg); }
.btn.primary { background: var(--accent); border: 1px solid var(--accent); color: var(--on-accent); }
"""

SANS = "'Inter', ui-sans-serif, system-ui, sans-serif"

STYLES = [
    ("01-paper", "Paper", "Pure white, hairline rules, one blue accent. Swiss minimal.",
     "Inter:wght@400;600", {
        "bg": "#ffffff", "bar": "#ffffff", "paper": "#ffffff", "side": "#ffffff", "card": "#ffffff",
        "fg": "#111827", "fg2": "#374151", "muted": "#6b7280", "line": "#e5e7eb", "card-line": "#e5e7eb",
        "accent": "#2563eb", "accent-strong": "#1d4ed8", "accent-soft": "#eff6ff", "on-accent": "#fff",
        "chip": "#f3f4f6", "chip-fg": "#374151", "mark": "#fef3c7", "ok": "#059669", "ok-soft": "#ecfdf5",
        "q": "#7c3aed", "q-soft": "#f5f3ff", "bad": "#dc2626", "shadow": "none",
        "r": "6px", "r-sm": "4px", "r-btn": "6px", "ui": SANS, "docfont": SANS, "h-weight": "600"}, ""),
    ("02-soft-cards", "Soft cards", "Off-white canvas, floating white cards with soft shadows, indigo accent. Calm SaaS.",
     "Inter:wght@400;600", {
        "bg": "#f7f8fa", "bar": "#ffffff", "paper": "#f7f8fa", "side": "#f7f8fa", "card": "#ffffff",
        "fg": "#0f172a", "fg2": "#334155", "muted": "#64748b", "line": "#e2e8f0", "card-line": "transparent",
        "accent": "#4f46e5", "accent-strong": "#4338ca", "accent-soft": "#eef2ff", "on-accent": "#fff",
        "chip": "#eef2ff", "chip-fg": "#4338ca", "mark": "#fde68a", "ok": "#16a34a", "ok-soft": "#f0fdf4",
        "q": "#0891b2", "q-soft": "#ecfeff", "bad": "#e11d48", "shadow": "0 4px 16px rgba(15,23,42,.06), 0 1px 2px rgba(15,23,42,.04)",
        "r": "14px", "r-sm": "8px", "r-btn": "10px", "ui": SANS, "docfont": SANS, "h-weight": "600"},
     ".doc { margin: 20px; background: #fff; border-radius: 16px; box-shadow: 0 4px 16px rgba(15,23,42,.06); } .side { border-left: 0; }"),
    ("03-editorial", "Editorial", "White page, serif document type, sans interface, red-pencil accent. Reads like a proof.",
     "Source+Serif+4:wght@400;600&family=Inter:wght@400;600", {
        "bg": "#ffffff", "bar": "#ffffff", "paper": "#ffffff", "side": "#fbfbfa", "card": "#ffffff",
        "fg": "#1c1917", "fg2": "#292524", "muted": "#78716c", "line": "#e7e5e4", "card-line": "#e7e5e4",
        "accent": "#c2410c", "accent-strong": "#9a3412", "accent-soft": "#fff7ed", "on-accent": "#fff",
        "chip": "#f5f5f4", "chip-fg": "#44403c", "mark": "#ffedd5", "ok": "#15803d", "ok-soft": "#f0fdf4",
        "q": "#1d4ed8", "q-soft": "#eff6ff", "bad": "#b91c1c", "shadow": "none",
        "r": "4px", "r-sm": "2px", "r-btn": "4px", "ui": SANS, "docfont": "'Source Serif 4', Georgia, serif", "h-weight": "600"},
     ".doc h1 { font-size: 34px; } .picked { outline-style: dashed; }"),
    ("04-mono", "Monochrome", "Black on white only, monospace labels, square corners. Precise and quiet.",
     "Inter:wght@400;600&family=JetBrains+Mono:wght@400;600", {
        "bg": "#ffffff", "bar": "#ffffff", "paper": "#ffffff", "side": "#ffffff", "card": "#ffffff",
        "fg": "#000000", "fg2": "#222222", "muted": "#777777", "line": "#e0e0e0", "card-line": "#000000",
        "accent": "#000000", "accent-strong": "#000000", "accent-soft": "#f2f2f2", "on-accent": "#fff",
        "chip": "#000000", "chip-fg": "#ffffff", "mark": "#e8e8e8", "ok": "#000000", "ok-soft": "#f2f2f2",
        "q": "#000000", "q-soft": "#f2f2f2", "bad": "#000000", "shadow": "none",
        "r": "0", "r-sm": "0", "r-btn": "0", "ui": "'JetBrains Mono', ui-monospace, monospace", "docfont": SANS, "h-weight": "600"},
     ".sev { text-decoration: underline; } .intent { border: 1px solid #000; }"),
    ("05-glass", "Smooth glass", "White with a faint sky gradient and frosted panels. Soft and airy.",
     "Inter:wght@400;600", {
        "bg": "linear-gradient(135deg,#f8fbff,#ffffff 50%,#f5f9ff)", "bar": "rgba(255,255,255,.7)", "paper": "transparent",
        "side": "rgba(255,255,255,.6)", "card": "rgba(255,255,255,.85)",
        "fg": "#0b1324", "fg2": "#33415c", "muted": "#7083a3", "line": "rgba(15,40,90,.08)", "card-line": "rgba(15,40,90,.06)",
        "accent": "#0ea5e9", "accent-strong": "#0369a1", "accent-soft": "rgba(14,165,233,.08)", "on-accent": "#fff",
        "chip": "rgba(14,165,233,.1)", "chip-fg": "#0369a1", "mark": "rgba(250,204,21,.3)", "ok": "#10b981", "ok-soft": "rgba(16,185,129,.08)",
        "q": "#8b5cf6", "q-soft": "rgba(139,92,246,.1)", "bad": "#f43f5e", "shadow": "0 8px 30px rgba(14,60,120,.06)",
        "r": "16px", "r-sm": "10px", "r-btn": "999px", "ui": SANS, "docfont": SANS, "h-weight": "600"},
     "html, body { background: linear-gradient(135deg,#f6faff,#ffffff 45%,#f3f8ff); } .side { backdrop-filter: blur(12px); }"),
    ("06-document", "Document-first", "Warm white like a notes app, grey text tones, yellow highlights for notes.",
     "Inter:wght@400;600", {
        "bg": "#ffffff", "bar": "#ffffff", "paper": "#ffffff", "side": "#fbfbfa", "card": "#ffffff",
        "fg": "#37352f", "fg2": "#37352f", "muted": "#9b9a97", "line": "#ededec", "card-line": "#ededec",
        "accent": "#37352f", "accent-strong": "#37352f", "accent-soft": "#f7f6f3", "on-accent": "#fff",
        "chip": "#f1f1ef", "chip-fg": "#787774", "mark": "#fbf3db", "ok": "#448361", "ok-soft": "#edf3ec",
        "q": "#337ea9", "q-soft": "#e7f3f8", "bad": "#d44c47", "shadow": "none",
        "r": "6px", "r-sm": "4px", "r-btn": "6px", "ui": SANS, "docfont": SANS, "h-weight": "700"},
     ".picked { outline: 0; background: #fbf3db; } .pin { background: #e9b949; color: #37352f; } .num { background: #e9b949; color: #37352f; }"),
    ("07-dense-pro", "Dense pro tool", "Crisp, compact 13px interface, violet accent, keyboard hints. For heavy reviewers.",
     "Inter:wght@400;500;600", {
        "bg": "#ffffff", "bar": "#fcfcfd", "paper": "#ffffff", "side": "#fcfcfd", "card": "#ffffff",
        "fg": "#1a1b25", "fg2": "#3c3f51", "muted": "#8a8fa3", "line": "#ececf1", "card-line": "#ececf1",
        "accent": "#5e5ce6", "accent-strong": "#4b48c9", "accent-soft": "#f1f0ff", "on-accent": "#fff",
        "chip": "#f1f1f5", "chip-fg": "#5b5f73", "mark": "#fff4c2", "ok": "#2f9e6e", "ok-soft": "#eefaf4",
        "q": "#d9480f", "q-soft": "#fff4ec", "bad": "#e03131", "shadow": "none",
        "r": "6px", "r-sm": "4px", "r-btn": "6px", "ui": SANS, "docfont": SANS, "h-weight": "600"},
     ".bar, .side { font-size: 13px; } .btn { font-size: 13px; padding: 7px 12px; } .btn.primary::after { content: '  ⌘↵'; opacity: .7; font-weight: 500; } .btn.ghost::after { content: '  R'; opacity: .5; } .side { grid-template-columns: 1fr; }"),
    ("08-native", "Native feel", "System font, large radii, segmented controls, generous whitespace. Feels like a desktop app.",
     "", {
        "bg": "#ffffff", "bar": "#f5f5f7", "paper": "#ffffff", "side": "#f5f5f7", "card": "#ffffff",
        "fg": "#1d1d1f", "fg2": "#424245", "muted": "#86868b", "line": "#d2d2d7", "card-line": "transparent",
        "accent": "#0071e3", "accent-strong": "#0066cc", "accent-soft": "#e8f2fd", "on-accent": "#fff",
        "chip": "#e8e8ed", "chip-fg": "#424245", "mark": "#fff3c4", "ok": "#28a745", "ok-soft": "#eaf7ed",
        "q": "#af52de", "q-soft": "#f6ecfb", "bad": "#ff3b30", "shadow": "0 1px 3px rgba(0,0,0,.06)",
        "r": "14px", "r-sm": "8px", "r-btn": "999px",
        "ui": "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        "docfont": "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", "h-weight": "700"},
     ".doc h1 { font-size: 32px; letter-spacing: -.01em; }"),
    ("09-fresh", "Fresh mint", "Bright white with a teal accent and pill buttons. Friendly and light.",
     "Plus+Jakarta+Sans:wght@400;600;700", {
        "bg": "#ffffff", "bar": "#ffffff", "paper": "#ffffff", "side": "#f6fbfa", "card": "#ffffff",
        "fg": "#0f2a2a", "fg2": "#2f4a4a", "muted": "#6b8584", "line": "#e3efed", "card-line": "#e3efed",
        "accent": "#0d9488", "accent-strong": "#0f766e", "accent-soft": "#effaf8", "on-accent": "#fff",
        "chip": "#e6f6f4", "chip-fg": "#0f766e", "mark": "#fef9c3", "ok": "#0d9488", "ok-soft": "#effaf8",
        "q": "#2563eb", "q-soft": "#eff6ff", "bad": "#e11d48", "shadow": "0 2px 8px rgba(13,148,136,.06)",
        "r": "12px", "r-sm": "8px", "r-btn": "999px",
        "ui": "'Plus Jakarta Sans', ui-sans-serif, system-ui, sans-serif",
        "docfont": "'Plus Jakarta Sans', ui-sans-serif, system-ui, sans-serif", "h-weight": "700"}, ""),
    ("10-margin-notes", "Margin notes", "White page with notes as soft pastel cards in the margin. Closest to marking up paper.",
     "Inter:wght@400;600&family=Caveat:wght@600", {
        "bg": "#ffffff", "bar": "#ffffff", "paper": "#ffffff", "side": "#ffffff", "card": "#fffbea",
        "fg": "#1f2328", "fg2": "#3d434b", "muted": "#7a828c", "line": "#eceef1", "card-line": "#f5e9b8",
        "accent": "#e8590c", "accent-strong": "#c2410c", "accent-soft": "#fff4e6", "on-accent": "#fff",
        "chip": "#f3f4f6", "chip-fg": "#4b5563", "mark": "#ffe8cc", "ok": "#2b8a3e", "ok-soft": "#ebfbee",
        "q": "#1c7ed6", "q-soft": "#e7f5ff", "bad": "#c92a2a", "shadow": "0 2px 6px rgba(0,0,0,.05)",
        "r": "4px", "r-sm": "4px", "r-btn": "8px", "ui": SANS, "docfont": SANS, "h-weight": "600"},
     ".note:nth-of-type(3) { background: #eef6ff; border-color: #d0e4fb; } .note { transform: rotate(-.4deg); } .note:nth-of-type(3) { transform: rotate(.5deg); } .side-title { font-family: 'Caveat', cursive; font-size: 22px; }"),
]


def page(fonts, tokens, extra):
    link = f'<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family={fonts}&display=swap">' if fonts else ""
    root = ":root{" + "".join(f"--{k}:{v};" for k, v in tokens.items()) + "}"
    return f"<!doctype html><html><head><meta charset='utf-8'>{link}<style>{root}{BASE}{extra}</style></head><body>{MARKUP}</body></html>"


# Any Chromium build works; set VIVAMARK_CHROME to its binary if none is on PATH.
# (Playwright's chrome-headless-shell is the most reliable under WSL.)
BROWSER = os.environ.get("VIVAMARK_CHROME") or next(
    (b for b in ("chromium", "chromium-browser", "google-chrome") if shutil.which(b)), "chromium")


def main():
    for slug, *_rest in STYLES:
        name, desc, fonts, tokens, extra = _rest
        html = OUT / f"{slug}.html"
        html.write_text(page(fonts, tokens, extra))
        subprocess.run([BROWSER, "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
                        "--window-size=1200,750", "--virtual-time-budget=4000",
                        f"--screenshot={OUT / (slug + '.png')}", html.as_uri()],
                       check=True, capture_output=True)
        print(slug, "ok")


if __name__ == "__main__":
    main()
