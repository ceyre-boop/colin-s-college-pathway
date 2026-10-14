# Scholarship Scout

Layers 1 + 2 of the automation stack: **discover** scholarships matching Colin's profile,
**score** them with Claude, output a ranked hit list. Layer 3 (form filling) stays with
Claude for Chrome — see `../ScholarshipAutomation.md`. Nothing here submits anything.

## Run

```bash
bun scout/bigfuture-harvest.ts     # refresh the BigFuture (CollegeBoard) curated cache (browser)
bun scout/scout.ts                  # full run: scrape + score + rank
bun scout/scout.ts --no-score      # scrape only (no AI, no key needed; ranks by amount)
bun scout/scout.ts --emit-app      # also regenerate src/data/scoutFound.js for the app
bun scout/scout.ts --from-cache    # rebuild scoutFound.js from the last run's JSON (no scrape/score)
bun scout/scout.ts --rescore-failed # re-score only score_failed entries from cache, re-rank
bun scout/scout.ts --limit 3000    # score the whole harvest (default 120, round-robin per source)
bun scout/scout.ts --top 30        # longer console summary (default 20)
bun scout/select.ts [--dry]        # pick top 20 for essays → scholarship_essays/ metadata + queue
bun scout/topic-bank.ts             # regenerate scholarship_essays/TOPIC_BANK.md from the last run
```

A full-harvest run (`--limit 3000`) scores ~3,000 candidates — batches of 15 through
Inference.ts, expect 30-60+ min and some timed-out batches. Always chase it with
`--rescore-failed --emit-app` to replace the failed batches' default 50% matches
with real scores.

Or just run `/scout` in a Claude Code session — it does the full run, regenerates the
app data, commits, and pushes (Render autodeploys).

## Automated daily run

`scout/daily.ts` is the whole chain in one command, scheduled by launchd at **6:00 AM daily**:

1. `bigfuture-harvest.ts --headless` — refresh the curated cache (needs a profile already
   signed in; failure here is non-fatal and reported as an empty source)
2. `scout.ts --limit 5000 --emit-app` — harvest + score the whole thing (**fatal** if it fails:
   everything downstream would just republish stale data)
3. `scout.ts --rescore-failed --emit-app` — chase timed-out batches, which otherwise sit at a
   fake 50% match and pollute the ranking
4. `topic-bank.ts` — regenerate the essay topic bank
5. `emit-essays.ts` — rebundle essay kits for the dashboard
6. `state/deadlines.ts --days 45` — what's due soon
7. commit + push **only** the four generated files, then speak the result via the PAI notify daemon

Every step's real stderr goes to `~/.claude/memory/scholarship-scout/daily-<date>.log`, and the
run writes `scholarship_essays/LAST_RUN.md` — a table of what ran, what failed, and why. A
lockfile stops two runs from interleaving writes to `~/scholarships_found.json`; a stale lock
from a crashed run is reclaimed, never left to disable every later run.

```bash
bun scout/daily.ts                # the full chain
bun scout/daily.ts --dry          # print the plan, run nothing
bun scout/daily.ts --no-push      # everything but the push
bun scout/daily.ts --limit 1200   # smaller scoring budget

# schedule control
cp scout/launchd/com.colin.scholarship-scout.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.colin.scholarship-scout.plist
launchctl kickstart -k gui/$(id -u)/com.colin.scholarship-scout   # run it now
launchctl bootout   gui/$(id -u)/com.colin.scholarship-scout      # turn it off
```

**What it will never do:** submit an application. Providers require a personal account and
signed attestations, and it is Colin's own rule that he clicks every submit. The automation
ends at a ranked list, a topic bank, and a deadline digest.

## The topic bank

`scout/topic-bank.ts` answers "what essays do I actually owe anyone?" It reads the last run's
`ranked` list, drops every no-essay award (money, not a topic) and everything under 50% match,
runs each remaining listing through `essay-match.ts`, and writes **`scholarship_essays/TOPIC_BANK.md`**:

- **The archetypes** — the ~7 prompts that cover most scholarship essays (personal statement,
  why-you-deserve-it, career goals, adversity, leadership, community service, why-business), each
  with a 500-word target and whether a draft exists for it yet. Write the long version once, cut down per application.
- **Per archetype** — the scholarships waiting on that topic, with amount, deadline, word limit, match %.
- **Unsorted** — essay-requiring listings whose blurb doesn't reveal the prompt. These need the URL
  opened; the harvest can't infer a prompt it was never given.
- **Already covered** — finds that an existing essay already answers (send as-is, or trim).

Regeneration is idempotent and preserves everything below the `COLIN'S OWN TOPICS` marker, so
hand-added topics are never clobbered. Run it after every scout run.

Flags: `--found <path>` (default `~/scholarships_found.json`), `--top N` (default 150),
`--min-match N` (default 50).

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

## BigFuture (CollegeBoard) — the curated source

**BigFuture Scholarship Search** (`bigfuture.collegeboard.org/scholarship-search`) is a
single, vetted, profile-matchable directory of ~36,500 scholarships — a much higher-trust
feed than the raw-directory firehose. It's the recommended primary source.

It's a **login-walled, client-side React app**: no server-rendered HTML, and the one JSON
backend is an AWS-Lambda call needing SigV4 auth (not replayable). The results load once into
browser memory, then filter/paginate entirely client-side behind a "Show More Scholarships"
button. So it can't be `fetch()`-scraped like the sources below — its harvest is split out:

- **`scout/bigfuture-harvest.ts`** drives a real logged-in browser (Playwright, persistent
  login profile), applies a set of profile-relevant keyword filters (biology, computer
  science, biomedical, first generation, community college — override with `--keywords`),
  exhausts the "Show More" pager per keyword, scrapes the rendered cards (name, amount,
  opens/closes, merit/need/essay flags, slug URL), and writes **`~/.claude/memory/bigfuture_raw.json`**
  (local, gitignored). One-time setup: `bunx playwright install chromium`. First run is
  headed so you can sign in (uses `CB_USERNAME`/`CB_PASSWORD` from `.env`); the persistent
  profile keeps the session for later `--headless` runs.
- **`scout.ts`'s `harvestBigFuture()`** then just READS that cache (no network), maps each
  record into a scored `Candidate` with `source: "bigfuture"`, and merges it FIRST so its
  curated entry wins any name collision with the raw directories. If the cache is absent the
  source is skipped with an honest `empty` status — the rest of the run is unaffected.

App-side: emitted BigFuture finds keep `source: "bigfuture"` and render a green **BIGFUTURE**
badge in the dashboard (vs the blue SCOUT badge), so curated finds are visually distinct.

## Sources (HTTP-scrapeable today)

- **CareerOneStop** (US Dept of Labor database) — 28 keyword queries derived from the profile
  (field, circumstance, character — biology through athlete), paginated up to 3×100 per
  keyword, deduped, filtered to Associate/Bachelor level. The volume source: ~2,900 of the
  ~3,300 uniques in the 2026-06-12 run.
- **Scholarships360** — 12 listing pages (STEM, no-essay, easy, Michigan, community college,
  biology, CS, healthcare, engineering, leadership, men, Christian). Slugs verified live
  2026-06-11; the old sophomores page 404s and was dropped.
- **Unigo** — 19 category pages (majors, states, types, athletic, religious). Server-rendered
  cards with real dated deadlines. Unigo's WAF blocks burst fetches, so pages are paced 1.5s
  apart; blocked pages report honestly and recover on the next run.

## Probed every run (client-side / login-walled — browser work, not HTTP)

**Petersons** (Vue app over an authenticated JSON:API), **Raise.me** (login-walled
micro-scholarships — college-specific, worth a browser pass before the UM-Flint transfer),
**Appily** (client-side; cappex.com has redirected here since the Cappex rebrand), and
**Sallie** (myscholly.com redirects here — Scholly was sunset into Sallie's search).
Each probe adapter re-fetches per run and reports an honest blocked/empty status; all four
sit on the `needs_browser` worklist with Bold.org, Fastweb, Scholarships.com, and Niche.

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
