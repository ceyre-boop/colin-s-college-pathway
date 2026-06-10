# Scholarship Scout

Layers 1 + 2 of the automation stack: **discover** scholarships matching Colin's profile,
**score** them with Claude, output a ranked hit list. Layer 3 (form filling) stays with
Claude for Chrome — see `../ScholarshipAutomation.md`. Nothing here submits anything.

## Run

```bash
bun scout/scout.ts                  # full run: scrape + score + rank
bun scout/scout.ts --no-score      # scrape only (no AI, no key needed; ranks by amount)
bun scout/scout.ts --emit-app      # also regenerate src/data/scoutFound.js for the app
bun scout/scout.ts --from-cache    # rebuild scoutFound.js from the last run's JSON (no scrape/score)
bun scout/scout.ts --limit 200     # score more candidates (default 120, round-robin per source)
bun scout/scout.ts --top 30        # longer console summary (default 20)
```

Or just run `/scout` in a Claude Code session — it does the full run, regenerates the
app data, commits, and pushes (Render autodeploys).

## Scoring backend (pick one, automatic)

1. `ANTHROPIC_API_KEY` set (in env or `.env`) → Anthropic API directly, Haiku,
   roughly $0.01–0.05 per full run. Same key as `server.ts` (see `../.env.example`).
2. No key → falls back to `~/.claude/PAI/TOOLS/Inference.ts` (Claude CLI, billed to
   the Max subscription — free, slower).

Each scholarship gets: `match` (0–100, *do I actually qualify* — not win odds),
`effort` (low/med/high), `flags` (scam signals). `expected_value = amount × match`.

## Outputs

- **`~/scholarships_found.json`** — everything:
  - `ranked` — sorted by expected value. The real product.
  - `low_match` — match < 20% (doesn't qualify: grad-only, faculty awards, wrong field). Kept for audit.
  - `removed_scams` — hard flags only (`application_fee`, `paid_service`). Soft flags
    (`suspicious`, `missing_org`) stay ranked with a ⚠ — the scorer over-flags on data gaps.
  - `needs_browser` — sites a plain HTTP fetch can't harvest (login walls / client-side apps):
    Bold.org, Fastweb, Scholarships.com, Niche, Appily. Work these with Claude for Chrome.
  - `sources` — per-source fetch status. `blocked`/`error`/`empty` is reported, never hidden.
- **Console** — top N by EV split into APPLY NOW vs FUTURE (deadline ≤150 days, or
  rolling/varies/unknown, counts as now; past-dated listings are assumed annual → future).

## Sources (HTTP-scrapeable today)

- **CareerOneStop** (US Dept of Labor database) — 7 keyword queries derived from the profile
  (biology, computer science, AI, cancer, eagle scout, wrestling, transfer student),
  100 results each, deduped, filtered to Associate/Bachelor level.
- **Scholarships360** — STEM / no-essay / easy / Michigan listing pages.

Amounts and deadlines are **the listing's claims — verify at the URL before writing essays.**
Entries with "Varies" amounts rank with a conservative $1,500 stand-in (marked `amountEstimated`).

## Profile

Read from `~/.claude/memory/scholarship_profile.json`. Update it there (GPA, achievements,
categories) and re-run. The `"first generation college student (verify)"` category is
explicitly excluded from matching until verified.

## App integration

`--emit-app` (and `--from-cache`) write `src/data/scoutFound.js`: the top 30 finds with
match > 40%, deduped against the dashboard's seeded list, with **stable slug ids** so the
app's localStorage merge never duplicates on re-runs. `src/App.jsx` merges them in on load;
scout cards get a `SCOUT {match}%` badge and the tab shows the last-run timestamp.
Commit the regenerated file and push — Render autodeploys.

## Cadence

Re-run weekly (new awards appear constantly; Niche/Bold re-open monthly). Manual for now:
`/scout` in Claude Code or `bun scout/scout.ts --emit-app`. Wiring a scheduled routine is
a deliberate follow-up, not done yet.
