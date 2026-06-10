# Scholarship Scout — Layer 1 (SCOUT) + Layer 2 (FILTER)

## Context

The college-pathway app already covers Layer 3: the dashboard tracks the pipeline, `server.ts` drafts essays, and `ScholarshipAutomation.md` is the Claude-in-Chrome form-filling playbook. What's missing is the discovery engine: a script that finds new scholarships matching Colin's profile, scores them for eligibility/effort/legitimacy, and outputs a ranked list ready to feed the Chrome workflow.

This plan implements the pasted architecture with two deliberate deviations:

1. **TypeScript + Bun, not Python.** Global PAI rule: "TypeScript always. Never Python." Same architecture, same outputs — just the stack this machine standardizes on (and matches the existing repo, which is all Bun/TS).
2. **Honest scraping tiers.** Fastweb, Scholarships.com, and Niche require login and run bot detection — a plain HTTP script will get empty pages, not scholarships. The scout uses sources that actually work unauthenticated (Bold.org, CareerOneStop, Scholarships360/Appily listing pages), and emits a "needs browser session" worklist for the login-walled sites so they're handled by Claude for Chrome per the existing playbook instead of silently failing.

## Files to create

### 1. `~/.claude/memory/scholarship_profile.json`
The exact profile JSON from the request, verbatim (personal, academic, financial, achievements, categories, essay_angles, contacts). One correction made against the repo's source of truth (`src/data/profile.js`): keep both GPAs labeled as given (`gpa_umflint: 3.92`, `gpa_mott: 3.70`). The `"first generation college student (verify)"` category stays flagged — the scout will not claim it on anything until verified.

### 2. `scout/scout.ts` (in this repo, git-tracked — not loose in `~`)
Single-file Bun CLI, ~300 lines, zero new dependencies:

- **Load** profile from `~/.claude/memory/scholarship_profile.json`.
- **Fetch** sources via modular adapters (each returns `{name, org, amount, deadline, url, description, source}`):
  - `bold.org/scholarships` — public listing pages, filter to STEM/need-based/athlete/Eagle Scout categories.
  - `careeronestop.org` scholarship finder — public, server-rendered, paginated; filter Michigan + STEM.
  - `scholarships360.org` / `appily.com` no-essay lists — public listing pages.
  - Fetches use Chrome-like headers; any source returning a block page is reported as `blocked`, not silently empty.
  - `fastweb.com`, `scholarships.com`, `niche.com` — login-walled: emit as `needs_browser` entries with direct URLs for the Claude-in-Chrome pass.
- **Score** each candidate with the Claude API (Haiku, batched ~15 per call) using the same raw-`fetch` pattern as `server.ts` (no SDK import). Returns per scholarship: `eligibility_match` (0–100 against profile), `effort` (low/med/high), `legit_flags` (application fees, paid-service redirects, missing org info). Reuse cost accounting from `src/lib/essayCost.js`.
- **Rank & filter**: `expected_value = amount × match/100`; drop anything with scam flags (listed in a `removed_scams` section of the output for transparency, never silently).
- **Output**:
  - `~/scholarships_found.json` — ranked full list with direct application URLs.
  - Console summary: top 20 by EV, split **apply now** vs **future** by deadline, plus the `needs_browser` worklist.
  - `--emit-app` flag: prints top finds in the `DEFAULT_SCHOLARSHIPS` shape from `src/data/defaults.js` (id/name/org/amount/deadline/status/priority/url/notes) for pasting into the dashboard, deduped against the 18 already seeded.

### 3. `scout/README.md`
One page: how to run (`bun scout/scout.ts`), required env (`ANTHROPIC_API_KEY` — already in `.env.example`), what each output means, and how the weekly cadence works (re-run manually or wire a `/schedule` routine later — left as follow-up, not built now).

## Not changing
- `server.ts`, the React app, `defaults.js` seed data — untouched. The scout is additive.
- No auto-submission anywhere; the scout ends at a ranked list. Forms remain human-reviewed per the playbook.

## Verification
1. `bun scout/scout.ts` with `ANTHROPIC_API_KEY` set — confirm it completes, prints per-source fetch counts (including any `blocked` honestly reported), and writes `~/scholarships_found.json`.
2. Inspect the JSON: every entry has a working application URL (spot-check 3 by fetching them), no scam-flagged entries in the ranked list, EV sort order correct.
3. Run `--emit-app` and confirm output entries match the `defaults.js` shape and don't duplicate the 18 seeded IDs/URLs.
4. Report actual results — if a source yields nothing, say so with the reason, not a padded list.
