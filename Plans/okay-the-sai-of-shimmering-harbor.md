# Fall 2026 Correction — Master List over Definitive Plan

## Context

The Definitive Academic Plan (integrated yesterday) put **CHEM 160/161 + ENGL 102 + a Fine Arts
course** in the Mott Fall 2026 block — built on estimates. Colin's **Mott Master List**, verified
against the live transfer.umflint.edu database, is the correct version: Fall 2026 Mott should be
gen-ed gaps + calculus, **no chemistry**. Science stays at UM-Flint.

Scope is exactly: **three course swaps in Fall 2026 + one note fixed.** Everything else stays.

## Changes

**1. `src/data/pathway.js` — replace the Fall 2026 Mott course list** (remove CHEM 160/161):
```
ENGL 102 English Composition II → ENG 112 · COMP gen ed            (3)
FILM 181 Introduction to Film   → COM 272 · Fine Arts (F) gen ed    (3)
MUS. 187 History of Rock & Roll → MUS 245 · Humanities (H) gen ed   (3)
MATH 164 Applied Calculus I     → MTH 118 · CMB math req (~$1,840 saved) (4)
```
Total 13 cr. Update the semester subtitle to note 13 cr.

**2. `src/data/pathway.js` — Winter 2027 `CIT 100` course note.** Change
`'CMB req — easy A (verify Mott COMI 160 covers it)'` →
`'CMB req — COMI 160 does NOT transfer as CIT 100 (maps to CIS 200/BUS 115); take CIT 100 at UM-Flint'`.

**3. `src/data/requirements.js` — ACTION_ITEMS COMI line.** Change
`'Ask Mott if COMI 160 satisfies CIT 100 — could save 4 credits at UM-Flint'` →
`'CIT 100: COMI 160 does NOT transfer as CIT 100 (maps to CIS 200/BUS 115) — take CIT 100 at UM-Flint'`.

**4. `src/data/requirements.js` — Chemistry CHM 262/263 note** (direct consequence of "science
stays at UM-Flint"). Change note `'get at Mott (CHEM 160/161)'` → `'take at UM-Flint (no longer in
the Mott plan)'` and status `'partial'` → `'gap'`.

## Deliberately NOT changing (respecting "everything else stays")

- The "~67 entering Winter '27" aggregate and `VERIFIED_CREDITS.mott_fall26_planned: 11` — the new
  Fall block sums to 13, a tiny aggregate drift I'll flag, not silently re-derive.
- `semesters.js` Fall '26 financial estimate (cost/credits) — unchanged.
- The UM-Flint schedule — but note: with CHM 262/263 no longer from Mott, it becomes a UM-Flint
  prereq needed *before* CHM 330 Organic (currently Winter 2027). I'll **flag this**, not re-sequence
  it now.

## Verification

1. `bun run build` → zero errors.
2. `bun run start`, headless-render: Pathway Fall 2026 shows the 4 new courses (no chemistry), 13 cr;
   Requirements tab COMI/CHM notes corrected.
3. Commit + push → Render auto-deploys; confirm "FILM 181"/"MATH 164" in the live bundle and CHEM
   160 gone from Fall 2026.
