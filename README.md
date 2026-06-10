# Colin's College Pathway 🎓

A personal college funding tracker built with React + Vite. Tracks costs, scholarships,
government aid, generates tailored application essays with Claude, and shows the remaining
funding gap (in red — that's the bad number to eliminate).

> _"The gap is just a variable. Variables can be solved."_

## Features

- **Dashboard** — 5-year funding snapshot with charts (Funding Coverage + Cost by Category).
  The red number is the gap. Make it zero.
- **Costs** — Edit tuition, housing, food, books, transport, and misc. Calculates 5-year totals.
- **Gov Aid** — FAFSA award tracking: Pell, SEOG, subsidized/unsubsidized loans, work-study,
  Michigan state grants, institutional aid (Go Blue Guarantee, UM-Flint Transfer).
- **Scholarships** — Pipeline tracker (Found → Applied → Won/Rejected), priority tiers, AI tips,
  pre-seeded with 18 real scholarships matched to Colin's profile.
- **AI Essays** — Pick a tracked scholarship (or type any name), and Claude drafts a 400–500 word
  essay grounded in your real profile. _Requires the backend (Render) — see below._
- **Budget** — All funding sources vs. total cost, color-coded.

All tracker data is saved in your browser's localStorage — nothing leaves your computer.

## Two-stage deployment

**Stage 1 — GitHub Pages (live now, static).** Dashboard, Costs, Gov Aid, Scholarships, and
Budget all work fully. The AI Essays tab shows a "backend required" notice on Pages, because a
static host can't hold the Claude API key safely.

**Stage 2 — Render (for AI Essays + future Python bulk-apply).** A small Bun server (`server.ts`)
serves the build _and_ proxies `/api/essay` to Claude with the API key kept server-side.

### Deploy to Render

1. Push to GitHub (already wired).
2. In Render: **New → Blueprint**, point at this repo (`render.yaml` is included).
3. Set `ANTHROPIC_API_KEY` as a secret in the Render dashboard.
4. Render runs `bun install && bun run build`, then `bun run server.ts`.

## Development

```bash
bun install
bun run dev        # Vite dev server (UI only)
bun run start      # Bun server: serves build + /api/essay  (needs ANTHROPIC_API_KEY for essays)
bun run build      # production build → dist/
```

For the AI Essays tab locally: run `bun run build` then
`ANTHROPIC_API_KEY=sk-ant-... bun run start` and open http://localhost:3000.

## Editing your data

Defaults live in `src/data/`:
- `defaults.js` — costs, aid types, and the 18 seeded scholarships (amounts are **estimates** —
  verify each at its URL).
- `profile.js` — your essay-facts. The more specific, the better the generated essays.

## Stack

React 19 · Vite · Recharts · Bun (server + tooling) · Claude API · GitHub Pages + Render.
