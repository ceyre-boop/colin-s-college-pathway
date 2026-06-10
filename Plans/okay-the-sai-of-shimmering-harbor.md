# v2 Merge — Real Content + Pathway/Timeline into the Live App

## Context

The live app (`colin-college-pathway-qwf7.onrender.com`, Bun web service, secure `/api/draft` +
`/api/batch`, `ANTHROPIC_API_KEY` wired, Apply Queue, localStorage) currently runs on **generic
estimated data**. Colin built a much richer redesign — `~/Downloads/CollegePathway_v2.jsx` — with
his **real** content: per-semester financials, a course-by-course degree plan, a 24-event life
timeline with per-event "scholarship essay" notes, targeted real scholarships (with contact
emails), and a fuller profile. v2's essay generator calls Claude **client-side** (leaks the key,
old model) — we do **not** port that; the live secure backend already solves it.

**Decisions:** hybrid design (current card base + v2's color/energy accents) · keep all existing
tabs AND add **Pathway** + **Timeline** · build everything in one pass · timeline feeds essays.

**Outcome:** the live app gains real semester costs, a Pathway planner, a Timeline (essay fuel),
the real scholarship list, and a richer profile — all on the existing secure backend + persistence.

## Port from v2 (source: `~/Downloads/CollegePathway_v2.jsx`)

- `SEMESTERS_COST` (8 real semesters: Mott F26 → UM-Flint W29; credits/cost/pell/other) + the
  in-state↔out toggle (ratio `22600/12280`).
- `PATHWAY_DATA` (per-semester course list w/ code, name, credits, requirement note, status).
- `INIT_TIMELINE` (24 events; `cat`, `icon`, `desc`, `essay` note; CAT_META colors).
- `INIT_SCHOLARSHIPS` (18 real, with `org`, `deadline`, `status`, `priority`, contact-rich `notes`).
- Real profile block + the "Profile Used in Every Essay" facts.

## Files

```
src/data/semesters.js      NEW — SEMESTERS_COST + residency ratio
src/data/timeline.js       NEW — 24 events + CAT_META
src/data/pathway.js        NEW — course plan + COURSE_STATUS
src/data/defaults.js       MODIFY — replace DEFAULT_SCHOLARSHIPS with v2's real list (+ `org`);
                                   extend STATUS_OPTIONS (apply/research/applied/pending/won/
                                   rejected/future) + PRIORITY_OPTIONS (critical/high/medium);
                                   keep DEFAULT_COSTS / AID_TYPES (tabs stay)
src/data/profile.js        MODIFY — richer real PROFILE + PROFILE_FIELDS; add storyBank(timeline)
                                   that compiles timeline essay-notes into a compact story bank
src/pages/Pathway.jsx      NEW — degree progress (have 50 / completed / remaining / 120) +
                                   per-semester courses with status toggles (localStorage ccp_pathway)
src/pages/Timeline.jsx     NEW — vertical timeline, category filters, add-event, essay-note
                                   callouts (localStorage ccp_timeline)
src/pages/Dashboard.jsx    MODIFY — add real per-semester Funded/Gap stacked chart + residency
                                   toggle (reuse Recharts already imported); keep existing cards
src/pages/Scholarships.jsx MODIFY — show `org`; support new status/priority enums + colors
src/pages/ApplyQueue.jsx   MODIFY — isPursuing() for new statuses (apply/research/applied);
                                   prepend storyBank() to the profile sent to /api/batch
src/pages/Essays.jsx       MODIFY — prompt builder includes story bank
src/lib/essayCost.js       MODIFY — pickModel: Sonnet when priority==='critical' || amount>=7500
src/App.jsx                MODIFY — add 🧬 Pathway + 🗓️ Timeline tabs; pass timeline to Essays/Queue
src/index.css              MODIFY — hybrid accents (v2 palette energy + Impact/mono display
                                   touches on metrics/headers) + pathway/timeline styles
server.ts                  no change needed (profile carries the story bank from the client)
```

## Key reconciliation details

- **localStorage migration:** the scholarship list changes substantially, so bump the key
  `ccp_scholarships` → `ccp_scholarships_v2` in `useLocalStorage` (App.jsx) so the real list seeds
  instead of returning Colin's stale generic list. Costs/Aid keys unchanged.
- **Status/priority enums** are defined once in `defaults.js` (STATUS_OPTIONS / PRIORITY_OPTIONS)
  and consumed by Scholarships.jsx, Dashboard pipeline counts, and ApplyQueue — update all three to
  the new values. `pickModel` gate moves from `priority==='long'` to `priority==='critical'`.
- **Timeline → essays:** `storyBank(timeline)` returns the bulleted essay-notes from events that
  have one; the client appends it to `PROFILE` before calling `/api/draft` and `/api/batch`, so
  drafts pull from his real story without any backend change.
- **Design (hybrid):** keep the card/`.page` structure and readability; add v2's accent palette and
  Impact/monospace flourishes to metric tiles, section labels, and the new Pathway/Timeline views.
  Not a full reskin.

## Verification (end-to-end)

1. `bun run build` → zero errors.
2. `ANTHROPIC_API_KEY=… bun run start`, headless-render (the approach used this session):
   - Dashboard: real per-semester Funded/Gap chart; residency toggle changes it.
   - Pathway: course plan renders; credit totals (have 50 + completed / 120) compute; status
     toggles persist across refresh.
   - Timeline: 24 events render in order; category filters work; add-event persists.
   - Scholarships: real list with org + new status filters; Apply Queue drafts (story bank in prompt).
3. Commit + push → Render auto-deploys the web service. Probe live `/api/batch` (JSON), load the
   live URL, confirm Pathway/Timeline tabs and real data. Optional: one live Haiku draft (~$0.005)
   to confirm the story-bank-enriched essay, with Colin's go-ahead.

## Out of scope

v2's client-side essay call (insecure — backend stays the engine), full terminal reskin, and any
autonomous form submission (still Phase-2, bounded).
