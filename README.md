# Colin's College Pathway 🎓

A personal college funding tracker built with React + Vite. Tracks costs, scholarships,
government aid, builds tailored essay prompts, and shows the remaining funding gap (in red —
that's the bad number to eliminate).

> _"The gap is just a variable. Variables can be solved."_

## Features

- **Dashboard** — 5-year funding snapshot with charts (Funding Coverage + Cost by Category).
  The red number is the gap. Make it zero.
- **Costs** — Edit tuition, housing, food, books, transport, and misc. Calculates 5-year totals.
- **Gov Aid** — FAFSA award tracking: Pell, SEOG, loans, work-study, Michigan state grants,
  institutional aid (Go Blue Guarantee, UM-Flint Transfer).
- **Scholarships** — Pipeline tracker (Found → Applied → Won/Rejected), priority tiers, AI tips,
  pre-seeded with 18 real scholarships matched to Colin's profile.
- **AI Essays** — Builds a tailored, ready-to-paste essay prompt grounded in your real profile.
  Paste it into a Claude Code session and Claude drafts the essay (see below).
- **Budget** — All funding sources vs. total cost, color-coded.

All data is saved in your browser's localStorage — nothing leaves your computer.

## How essays work (free, on your Max plan)

The app deliberately has **no AI backend** — that keeps it a free static site with no API keys
and nothing private on a server. Instead, the **AI Essays** tab assembles a complete prompt
(your profile + the scholarship + any context). Copy it, paste it into a Claude Code session,
and Claude drafts a 400–500 word essay using your Claude subscription. For a batch, paste
several prompts at once, or just ask Claude to "write essays for every scholarship marked Applied."

Sharpen the output by editing your real details in `src/data/profile.js`.

## Deploy (Render Static Site)

`render.yaml` is included. In Render: **New → Blueprint**, point at this repo, click **Apply**.
Free tier, global CDN, no cold starts, no secrets. Works with a private repo.

## Development

```bash
bun install
bun run dev      # Vite dev server
bun run build    # production build → dist/
bun run preview  # preview the production build
```

## Editing your data

Defaults live in `src/data/`:
- `defaults.js` — costs, aid types, and the 18 seeded scholarships (amounts are **estimates** —
  verify each at its URL).
- `profile.js` — your essay-facts. The more specific, the better the generated essays.

## Stack

React 19 · Vite · Recharts · localStorage · Render Static Site. Essays drafted locally by Claude Code.
