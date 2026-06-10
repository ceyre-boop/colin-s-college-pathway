# Scout → App Integration + Chrome Shortcut

> Previous plan (build the scout) is done: `scout/scout.ts` works, scoring runs via PAI Inference,
> output at `~/scholarships_found.json`. A full 409-candidate scoring run is finishing in the
> background; its output feeds this plan.

## Context

The scout produces scored JSON; the app shows a static 18-entry list seeded from
`src/data/defaults.js` into localStorage. This plan connects them (brief item 1, "today"),
builds the Claude-for-Chrome apply shortcut (brief item 2), and notes why item 3 (Alta G2 gate)
is not planned here.

**Corrections to the brief** (it was written against an imagined repo):
- The file is `scout/scout.ts`, not `scouts.ts`; the list is `DEFAULT_SCHOLARSHIPS` in
  `src/data/defaults.js` consumed by `src/App.jsx:28` via `useLocalStorage` — there is no
  `CollegePathway.jsx` / `INIT_SCHOLARSHIPS`.
- Claude for Chrome does **not** read local files — no `~/.claude/shortcuts/*.json` exists, and the
  extension cannot call the Claude API with a key or read `scholarship_profile.json` from disk.
  The real mechanism is a paste-once shortcut in the extension UI with the profile embedded in its
  text. The deliverable is that paste-ready block, not a JSON file the extension would never load.
- Slash commands live at `~/.claude/commands/<name>.md` → `/scout` (modern naming, not `/user:scout`).

## Part A — Scout results into the app

### 1. `scout/scout.ts`: emit a data module instead of printing JSON
- Repurpose `--emit-app` to **write `src/data/scoutFound.js`**:
  `SCOUT_GENERATED_AT` (ISO string) + `SCOUT_SCHOLARSHIPS` array in the `defaults.js` shape,
  plus `source: 'scout'`, `match`, `effort`, `expectedValue`.
- Selection: top 30 by `expectedValue` with `match > 40`, deduped against `DEFAULT_SCHOLARSHIPS`
  names (reuse the existing `emitAppEntries` dedupe in `scout/scout.ts`).
- **Stable IDs** — `sc_scout_<slug-of-name>` (current `Date.now()` ids would duplicate on every
  re-run once merged into localStorage).
- Add `--from-cache`: skip scrape+score, build `scoutFound.js` from the existing
  `~/scholarships_found.json`. (Fast path for the slash command and for iterating on the UI.)
- Status mapping: reuse `deadlineBucket()` → `apply` / `future`.

### 2. App merge + badge + timestamp (`src/App.jsx`)
- On mount, merge `SCOUT_SCHOLARSHIPS` into the localStorage-backed list by id:
  `setScholarships(prev => [...prev, ...SCOUT_SCHOLARSHIPS.filter(s => !prev.some(p => p.id === s.id))])`
  — one `useEffect`, user edits (status, amounts) persist, re-runs add only new ids.
- Card (`src/App.jsx:407-427`): for `s.source === 'scout'`, a small `SCOUT {match}%` badge next to
  the org label.
- Scholarships tab header: `SCOUT LAST RUN: {date} · {n} imported` from `SCOUT_GENERATED_AT`
  (omit if no scout data).
- `src/data/scoutFound.js` gets committed with real data (generated from the background run's
  output) so the deployed site shows it; `.gitignore` untouched.

### 3. `/scout` slash command — `~/.claude/commands/scout.md`
Instructs the session to: run `bun scout/scout.ts --emit-app` in this repo (full scrape + score +
emit), report the APPLY NOW summary and any blocked sources, then commit `src/data/scoutFound.js`
and push (Render autodeploys). Mention `--from-cache` for emit-only.

## Part B — Claude for Chrome apply shortcut

Rewrite section 3 of `ScholarshipAutomation.md` (single source of truth — no new file) into a
complete paste-ready shortcut:
1. Read page → extract scholarship name, org, amount, prompts, word limits, required fields.
2. Profile block embedded inline (from `src/data/profile.js` `PROFILE_FIELDS` + facts — name,
   email, phone, school, major, GPA, address from `~/.claude/memory/scholarship_profile.json`).
3. Fill personal fields; pick the best-matching essay angle from the embedded angle list
   (leadership → builder; adversity → constraint; why-your-field → MRI/AI×bio); draft the essay
   to the form's word limit; fill it.
4. HARD STOP before submit: list every filled field for review. Never claims unverified
   categories (first-gen).
Plus a one-paragraph install note (extension side panel → shortcuts → new → paste).

## Out of scope
- **Alta G2 gate (brief item 3)** — explicitly blocked on Colin confirming readiness + which data
  to use, and it lives in `~/quant/`, not this repo. Not planned here; say so in the summary.

## Verification
1. `bun scout/scout.ts --from-cache --emit-app` → `src/data/scoutFound.js` exists, ≤30 entries,
   all `match > 40`, ids stable across two consecutive runs (diff = timestamp only).
2. `bun run build` passes; then **Interceptor** on the local server (`bun run start` after build):
   Scholarships tab shows scout cards with badges + the LAST RUN header; existing seeded cards
   unchanged; no console errors. Status edit on a scout card survives reload (localStorage merge
   correct).
3. Re-run emit → reload → no duplicate cards (stable-id check in the real UI).
4. `/scout` command file exists; dry-read it for correct paths.
5. Commit + push; verify Render deploy with Interceptor on the live URL (per the brief's
   "commit and push when done").
