# Plan: FAFSA-confirmed scholarship updates + autobiography foundation file

## Context

Colin filed his FAFSA on 2026-07-07 with a confirmed SAI of -1500 (maximum Pell eligibility), locking in a $7,395/yr Pell Grant. This closes out the highest-priority open task in the household's Academics tracking (`NEXT.md`) and needs to ripple through the college-pathway dashboard (status/date on the two now-applied-for aid sources, a visual "locked" signal on the dashboard) so the app reflects reality. Separately, this is the kickoff for a new long-running project: a chronological autobiography for Colin built around a single thesis — "I say what I mean and I mean what I say" — and today's FAFSA filing is itself the tenth confirmed entry in that timeline, so both tasks share the same moment and are being done together.

Two things changed the shape of the original ask during exploration:
- There is no `scholarships.js` — the scholarship list lives in `src/data/defaults.js` as `DEFAULT_SCHOLARSHIPS`.
- There is no `src/data/notifications.js` at all yet — it's a brand-new file, not an edit.

## Task A — `colin-s-college-pathway` repo

**1. `src/data/defaults.js`** — two one-line field edits, no schema changes elsewhere:
- Line 44 (`sc_pell`): `status: 'apply'` → `status: 'applied'`, and add `appliedDate: '2026-07-07'` (a net-new field, only on this entry — no other scholarship has a date field beyond the free-text `deadline` string, and nothing renders `appliedDate` in the UI, so this is inert data, same as adding it to a spreadsheet).
- Line 47 (`sc_mi_competitive`): `status: 'apply'` → `status: 'applied'`.
- `'applied'` is already a valid value in `STATUS_OPTIONS` (line 18), so no enum changes needed.

**2. Dashboard "Pell locked" signal — `src/App.jsx`.** The actual gap math needs no change: `semesterFinancials()` (`src/data/semesters.js`) already hardcodes the full Pell amount into `SEMESTERS_COST` regardless of any scholarship's status — it never assumed Pell was *unconfirmed*, so there's nothing to numerically "unlock." What's missing is a visual cue that it's now confirmed. Add a cosmetic-only `pellLocked` flag and badge, reusing the codebase's existing emoji-suffix-label idiom (`STATUS_OPTIONS`, `REQ_MARK`):
- After line 60 (`const wonAmt = ...`), add:
  ```js
  const pellSch = scholarships.find((s) => s.id === "sc_pell");
  const pellLocked = !!pellSch && !["apply", "research"].includes(pellSch.status);
  ```
- Line 202, metrics tile: `["PELL+INST", ...]` → `` [`PELL+INST${pellLocked ? " 🔒" : ""}`, ...] ``
- Line 234, Funding Stack row: `["Pell Grant", ...]` → `` [`Pell Grant${pellLocked ? " 🔒" : ""}`, ...] `` (only the first tuple's label changes; the rest of that array literal is untouched)

Verification note: scholarships state persists via `useLocalStorage("ccp_scholarships_v2", DEFAULT_SCHOLARSHIPS)`. If a browser already has that key populated from an earlier session, editing `defaults.js` alone won't retroactively update it — that's existing, unrelated behavior (the same is true for any `defaults.js` edit), not something this change needs to fix. When verifying in-browser, either clear that localStorage key or toggle the status directly in the Scholarships tab.

**3. `src/data/notifications.js` (new file)** — data-only, matching the literal scope of the request (nothing in `App.jsx` currently imports or renders notifications, so no UI wiring is added):
```js
export const DEFAULT_NOTIFICATIONS = [
  {
    id: 'fafsa-complete',
    date: '2026-07-07',
    type: 'milestone',
    title: 'FAFSA Complete — SAI -1500',
    body: 'Pell Grant $7,395/yr confirmed. Add UM Flint readmission next.',
    status: 'unread',
  },
];
```
Naming follows sibling convention (`DEFAULT_SCHOLARSHIPS` in `defaults.js`, `INIT_TIMELINE` in `timeline.js`).

**4. Mark the FAFSA task done in the vault** — run:
```
bun ~/Obsidian/Obsidian/00-BRAIN/update-brain.ts done "FAFSA"
```
This matches the existing open task on `NEXT.md` line 484 (`- [ ] **Redo/file FAFSA now** — unlocks Pell ($7,395/yr)...`) case-insensitively and flips it to `- [x]` in place — confirmed by reading `update-brain.ts` directly.

## Task B — `/Users/taboost/Obsidian/Obsidian/Autobiography/Colin-Eyre-Timeline.md` (new file, new folder)

Ten chronological entries, each in the fixed format the user specified:
```
## [Year/Age] — [Event Title]
*[1-2 sentence scene-setting]*
[The story in Colin's voice — specific, sensory, grounded in a real moment]
*[The throughline sentence — how this connects to the North Star]*
```

Frontmatter (this vault has a documented frontmatter contract; this file is a curated reference note, not a `NEXT.md`-style action layer):
```yaml
---
date: 2026-07-07
title: "Colin Eyre — Autobiography Timeline"
type: reference
aliases: ["Autobiography", "Colin Eyre Timeline", "North Star Timeline"]
layer: 2
source: "user-provided facts (entries 1-3) + Claude-Chats/2026-05/2026-05-22-claude.md corroboration (entries 4-9) + FAFSA filing 2026-07-07 (entry 10)"
---
```
Opens with a short framing block stating the North Star once (so per-entry throughlines can stay one sentence), then the ten entries in order: chess grandmaster (age 5-6) → Cub Scouts lollipop test (age ~8) → student council/STUCO pivot (grade 5) → Black Belt (age 11) → Eagle Scout (age 13) → uncle's radiation-oncology MRI room (age 16, the anchor origin story) → state wrestling 4th place (junior year) → Lunch Bunch (senior year) → UM Flint Fall '25 3.92 GPA → FAFSA filed 2026-07-07.

Entries 4-9 get enriched with verbatim/near-verbatim material already found in `Claude-Chats/2026-05/2026-05-22-claude.md` (e.g., Colin's own words describing the MRI room — lightly copy-edited for typos only, keeping his actual phrasing since this is autobiography, not a polished essay). Entries 1-3 (chess grandmaster, Cub Scouts, STUCO) exist only in the compressed form the user gave directly — the fuller versions live in an unsynced conversation at `claude.ai/chat/75a40e03`. Rather than blocking on that content or diluting the prose with an inline disclaimer, each of those three entries gets an invisible-in-reading-view HTML comment after its throughline line:
```markdown
<!-- first-pass draft — enrich once claude.ai/chat/75a40e03 is synced into the vault -->
```

**After creating the file, queue the follow-up** (this is the mechanism for eventually pulling in the fuller claude.ai conversation once it's synced):
```
bun ~/Obsidian/Obsidian/00-BRAIN/update-brain.ts next "Add more autobiography entries to Autobiography/Colin-Eyre-Timeline.md" --project Academics
```
Confirmed this appends to the bottom of the existing `## 🟡 Academics` checkbox list in `NEXT.md`.

## Verification

- Run the app (`bun run dev` or whatever the existing dev script is) and confirm: Scholarships tab shows Pell Grant and Michigan Competitive Scholarship as "📬 Applied"; Dashboard tab's "PELL+INST" metric tile and "Pell Grant" Funding Stack row both show the 🔒 suffix. If status doesn't visually update, clear the `ccp_scholarships_v2` localStorage key per the note above.
- Read back the edited section of `NEXT.md` to confirm the FAFSA line is now `- [x]` and the new "Add more autobiography entries..." task appears at the bottom of the Academics section.
- Open `Autobiography/Colin-Eyre-Timeline.md` and confirm all ten entries are present in the fixed 4-line format, in chronological order, with the three first-pass entries carrying their HTML-comment flag.
