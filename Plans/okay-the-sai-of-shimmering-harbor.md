# Integrate the Definitive Academic Plan into the App

## Context

Colin pulled the **real** UM-Flint 2026-2027 CMB catalog + his actual transcript + the Mott
transfer guide into `~/Downloads/Colin_Definitive_Academic_Plan_1.md`. The live app currently
runs on estimates that are now wrong in three material ways:
- **GPA shows 3.7 (Mott)** — it should be **3.92, University of Michigan-Flint, Dean's List**
  (the number that matters on every scholarship app).
- **Credits estimated at ~50** — really **~67 entering Winter 2027** (AP 32 + UM-Flint Fall '25 15
  + Mott effective 9 + Mott Fall '26 planned 11), with a **33-upper-division** requirement (has 3).
- **Course plan is approximate** — the real schedule corrects Mott Fall '26 (CHEM 160/161 +
  **ENGL 102** + **Fine Arts**, not ENGL 101 + generic humanities) and runs through graduation.

Plus there are concrete **gen-ed gaps** the app should surface (Fine Arts = 0, COMP/ENG 112,
+3 Humanities) and full **major + CS-minor requirements**.

**Decisions:** graduation target shown as **Spring 2030 (conservative)** · requirements live in a
**new Requirements tab**. Source of truth = the definitive plan doc (Colin verified it against the
live catalog; we encode it, not re-derive it).

**Outcome:** the app reflects Colin's real academic standing — accurate credits, GPA, schedule,
and a requirements checklist that flags exactly what's left — and every generated essay states
"3.92 GPA, University of Michigan-Flint, Dean's List."

## Files

```
src/data/profile.js       MODIFY — GPA → "3.92, UM-Flint, Dean's List" in PROFILE + PROFILE_FIELDS;
                                   add CAREER (computational oncology: tumor segmentation, treatment-
                                   response prediction, drug modeling — Tempus/PathAI/Recursion);
                                   fullProfile() appends CAREER so essays articulate the path precisely
src/data/pathway.js       MODIFY — VERIFIED_CREDITS {ap:32, umflint:15, mott:9, mottF26:11, total:67,
                                   required:120, remaining:53}; ALREADY_HAVE → 56 (real in-hand today);
                                   add UPPER_DIVISION_NEEDED:33 / have:3; replace PATHWAY_DATA with the
                                   definitive schedule: a COMPLETED block (AP transfer + Fall '25
                                   UM-Flint w/ real grades, status 'completed'/'waived') + corrected
                                   Mott Fall '26 + UM-Flint W27→graduation (Part 5), grad label 2030
src/data/semesters.js     MODIFY — align term labels/credits to the real schedule through 2030;
                                   derive per-term cost from credit load × in-state rate (editable est.);
                                   keep residency ratio + semesterFinancials()
src/data/timeline.js      MODIFY — Fall '25 Dean's List / 3.92 detail; Goldwater app → Jan 2029;
                                   graduation → 2030; PhD event → UM Ann Arbor Bioinformatics (funded);
                                   add 3.92 into relevant essay-notes
src/data/requirements.js  NEW    — major (Bio 44 / Chem 24-26 / Math 4 / Physics 8), gen-ed (7 cats
                                   incl. Fine Arts/COMP/Humanities gaps), CS minor (Part 8); each
                                   { category, required, have, status, items[] }; plus ACTION_ITEMS[]
                                   (this-week list from Part 9) and KEY_CONTACTS
src/data/defaults.js      MODIFY — scholarship notes: replace "3.7" references with "3.92" (e.g.
                                   UM-Flint Transfer note)
src/App.jsx               MODIFY — add 📋 REQUIREMENTS tab: credit summary (56→67/120 + upper-division
                                   3/33), requirements checklist with ✅/❌ and red gap flags, action
                                   items, contacts; update Pathway degree-progress to the VERIFIED model
                                   and render the new schedule; grad target label = "Spring 2030"
```

## Key details

- **Credit model:** `haveCredits = ALREADY_HAVE (56) + completed-from-pathway`. Mott Fall '26
  (11 cr, planned) and all UM-Flint terms become 'completed' as Colin toggles them — bar climbs
  56 → 67 → 120. Upper-division tracker shown separately (33 needed, 3 now).
- **localStorage migration:** pathway and timeline shapes/dates change → bump `ccp_pathway` →
  `ccp_pathway_v2` and `ccp_timeline` → `ccp_timeline_v2` so the corrected data seeds. **Keep**
  `ccp_scholarships_v2` (note text is cosmetic; don't wipe any status edits Colin made).
- **Requirements tab** reads `requirements.js` deterministically (no LLM). Gaps (Fine Arts, COMP,
  Humanities, MTH 118, Physics, remaining Bio/Chem, CS minor) render red; satisfied render green.
- **Essays:** `fullProfile()` now carries GPA 3.92 + the career description + the timeline story
  bank, so drafts lead with the right credentials and the precise career framing.
- **Honesty note (carried, not encoded as fact):** the doc's per-semester cumulative credit counts
  overshoot 120 (~162 by W29); the app encodes the verified 67 + 53 = 120 math and the 2030
  conservative label, not the inflated cumulative totals.

## Verification (end-to-end)

1. `bun run build` → zero errors.
2. `bun run start`, headless-render:
   - Requirements tab: credit summary 56/120 + upper-division 3/33; Fine Arts / COMP / Humanities
     flagged red; Bio/Chem/Physics/Math and CS-minor rows correct; action items + contacts present.
   - Pathway: COMPLETED block shows Fall '25 grades (A+, A-, A); Mott Fall '26 = CHEM 160/161 +
     ENGL 102 + Fine Arts; schedule runs to 2030; progress bar uses verified credits.
   - Dashboard financials span the real schedule.
   - Essays/Queue: a draft's profile includes "3.92 ... Dean's List" + computational-oncology framing.
3. Commit + push → Render auto-deploys; probe live `/`, confirm Requirements tab + 3.92 in bundle.

## Out of scope

Re-verifying catalog requirements (Colin already did, against the live catalog), autonomous
submission (Phase-2, bounded), and the deeper grad-school/industry content beyond a timeline event.
