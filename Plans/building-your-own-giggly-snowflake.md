# Scholarship Pipeline — Gap-Close vs. Award Scholar Report + ApplicationPipeline.md Queue

## Context

A research report on "Award Scholar" (an AI scholarship app) was reviewed against this repo's
existing pipeline. The comparison shows this pipeline already implements most of what the report
recommends, often more rigorously:

| Report recommendation | Status here |
|---|---|
| Profile-as-single-source-of-truth | ✅ `identity/vault.ts` — `VaultField` per fact with source, `lastVerified`, sensitivity, autofill gate |
| Eligibility-accurate matching | ✅ `scout/eligibility.ts` — deterministic pass/disqualified/ambiguous, biased to never over-DQ |
| Expected-value ranking | ✅ `scout/scout.ts` — `expectedValue = amount × match%`, sorted, `--top`/`--limit` |
| Scam/credibility filtering | ✅ `scout/scout.ts` — hard flags (`application_fee`, `paid_service`) removed, soft flags kept visible |
| Essay theme library, reused not regenerated | ✅ `scout/essay-match.ts` — 5 angles, `reuse`/`reuse_with_edit`/`needs_new_essay`, zero-spend |
| Human-in-the-loop at submit | ✅ `apply/fill.ts` + `state/checkpoints.js` `SUBMIT_APPROVAL` — screenshot + explicit approval, never auto-submits |
| Outcome verification (anti-scam) | ✅ `AWARD_NOTICE_REVIEW` checkpoint — WON only after a verified artifact, "finalist" ≠ win |
| "Application queue" / resumable state | ✅ event-sourced log (`state/log.ts`) + projections (`state/rebuild.ts`) + checkpoints |
| Profile evidence ledger | ✅ already is `identity/vault.ts`, same shape the report describes independently |
| BigFuture adapter | ✅ `scout/bigfuture-harvest.ts` |

Five things the report calls out (or `ApplicationPipeline.md`'s own "what to build next" section
already queues) are genuinely **not built yet**. This plan closes those, ordered by ROI ÷ effort —
matching the report's own framing ("deadline tracking is the highest-ROI, lowest-risk automation").

## Out of scope

- Rebuilding anything already covered in the table above.
- Full auto-submission — stays explicitly out of scope per existing doctrine (`SUBMIT_APPROVAL`,
  `ApplicationPipeline.md`'s human-gate table). Not revisited here.
- CAPTCHA/bot-detection defeat, encryption of the vault, multi-user support — not asked for, not
  needed for a single-user personal pipeline.

## Phase 1 — Deadline reminders + calendar (new)

**Gap:** zero coverage today. `state/schema.js` already parses `deadlineISO`, but nothing reads
it back out as a digest or reminder. This is the report's #1-cited highest-ROI, lowest-risk
automation, and it's pure plumbing on data that already exists.

**Build:**
- `state/deadlines.ts` — reads the current application projection (`state/rebuild.ts`), filters to
  non-terminal `workflowState`s with a `deadlineISO` in [-1d, +30d] of today, buckets into
  overdue / due-this-week / due-this-month.
- Console digest (`bun state/deadlines.ts`) — same style as `scout.ts`'s summary table: name,
  days remaining, amount, workflowState, essay-bucket (reuse/needs_new_essay) so the digest also
  says which ones are ready to act on.
- `.ics` export (`--ics <path>`) hand-rolled (RFC 5545 is a flat text format — no dependency
  needed) with one `VEVENT` per deadline, importable into any calendar app.
- No push/notification service wiring — out of scope; the digest + `.ics` file is the full
  deliverable for a personal single-user tool.

## Phase 2 — Local/niche discovery source: ProPublica 990 (NTEE B82)

**Gap:** `scout/scout.ts` has adapters for CareerOneStop, Scholarships360, Unigo, BigFuture, plus
honest-blocked probes for the login-walled aggregators — all national/aggregator sources with
large applicant pools. The report's most novel, not-yet-built idea is exactly the opposite
strategy: pull scholarship-*granting* 501(c)(3) foundations from ProPublica's free Nonprofit
Explorer API (NTEE code `B82`), filtered to Michigan + national, to surface small local
foundations that never appear on the big aggregators and have far better real odds.

**Build:**
- `scout/propublica-990.ts` — new adapter following the existing `scrapeXxx(statuses):
  Promise<Candidate[]>` contract used by every other source in `scout.ts`, so it plugs straight
  into the existing `Promise.all([...])` / dedupe / scoring pipeline with no changes to the rest
  of the file besides one new entry in that array.
- Query `projects.propublica.org/nonprofits/api/v2/search.json?q=scholarship&ntee%5Bid%5D=B82&state%5Bid%5D=MI`
  (no key required) plus a second unfiltered-state pass capped by result count, honoring the same
  honesty doctrine as the rest of the file: a 990 record is a *foundation*, not a live scholarship
  listing, so these candidates get an explicit `needsResearch: true` marker and a distinct
  `source: "propublica990"` — they should never be silently treated as pre-verified the way a
  BigFuture curated entry is.
- Cap and dedupe reuses the existing `byName` cross-source dedupe already in `scout.ts` — no new
  dedupe logic needed.

## Phase 3 — `aiPolicy` / `thirdPartyAllowed` per-scholarship flags

**Gap:** the report documents real disqualification risk (Delta College, Chevening, Goldwater,
Common App all explicitly forbid AI-written essays or third-party submission; false-positive
AI-detector rates run 16–61% per the cited Stanford study). Nothing in this repo currently records
a scholarship's AI/third-party policy, so `scout/essay-match.ts` and `apply/fill.ts` can't gate on
it.

**Build:**
- Add two fields to `state/schema.js`'s `EMPTY_APPLICATION.requirements`: `aiPolicy: "allowed" |
  "prohibited" | "unknown"` (default `"unknown"`) and `thirdPartyAllowed: boolean | null` (default
  `null` = unstated). Threads through `toApplication()` the same way `applicationFee` already does.
- Extend the existing scam/flag vocabulary in `scout/scout.ts`'s Claude-scoring prompt (same
  `flags` array that already emits `application_fee`/`paid_service`/`suspicious`) with
  `ai_prohibited` and `third_party_prohibited` — this is additive to the existing scoring call,
  not a new pipeline stage.
- `scout/essay-match.ts`: when `aiPolicy === "prohibited"`, force the bucket to `needs_new_essay`
  regardless of angle score, with `reason` explaining the policy gate — consistent with the
  module's existing "never auto-generate, defer to human" doctrine, just adding a second trigger
  for deferral beyond "no angle match."

## Phase 4 — Outcome → win-rate feedback loop

**Gap:** `AWARD_NOTICE_REVIEW` already gates WON on a verified artifact (this *is* the report's
"outcome tracking" recommendation, already built). What's missing is closing the loop: nothing
reads that history back into `scout.ts`'s `expectedValue` calc, which today uses raw Claude
`match%` as a stand-in for P(win) — exactly the naive heuristic the report warns against, since
match/fit and actual win probability are different questions (a fact this repo's own schema
comment for `eligibility.fit` already states explicitly).

**Build:**
- `state/outcomes.ts` — reads the event log (`state/log.ts`) for resolved `AWARD_NOTICE_REVIEW`
  (`verified_win`/`not_a_win`) and `SUBMIT_APPROVAL` events, aggregates realized win-rate by
  source, effort tier, and essay angle (small-N early on — report until there are enough
  observations, don't fabricate confidence).
- `scout/scout.ts`: once `state/outcomes.ts` has ≥5 resolved outcomes for a given bucket, blend
  the realized win-rate into `expectedValue` alongside `match%` instead of match% alone; below
  that threshold, keep current behavior unchanged (small-sample honesty, matching the repo's
  existing "never fabricate a signal" pattern used everywhere else).

## Phase 5 — PDF/email application adapter (lower priority, largest lift)

**Gap:** `ApplicationPipeline.md`'s own "what to build next" queues this, and `apply/fill.ts`
today only handles Playwright-fillable web forms — anything else (`probe-form.ts` notes:
"JS-rendered / PDF / email apply") falls straight to a `PORTAL_MALFUNCTION`-style `needs_human`
checkpoint. That fallback is safe (nothing is silently dropped) but means every PDF/email target
is 100% manual today.

**Build (scoped down from the full adapter-contract vision in `ApplicationPipeline.md` to what's
tractable as a next increment — PDF only, email/mail packets deferred further):**
- `apply/pdf-fill.ts` — for targets where `probe-form.ts` already detected a PDF application
  packet, use `pdf-lib` (new dependency) to fill AcroForm fields from the same `Applicant` shape
  `apply/fill.ts` already resolves from the vault; write a draft PDF to the target's artifact
  directory. No signature/attachment handling — those stay a human step, same submission gate
  philosophy as `SUBMIT_APPROVAL`.
- Wire into `apply/fill.ts`'s existing `needs_human` branch: if a PDF was detected and filled,
  raise a checkpoint pointing at the draft (new checkpoint type, e.g. `PDF_DRAFT_REVIEW`) instead
  of a bare "no fillable form" note — same blocking/human-resolver pattern already defined in
  `state/checkpoints.js`.

## Verification

- Phase 1: run `bun state/deadlines.ts` against current state; confirm digest ordering (overdue
  first) and that `--ics out.ics` produces a file importable into Calendar.app/Google Calendar.
- Phase 2: run `bun scout/scout.ts --limit 40` and confirm the console source table includes a
  `propublica990` row with a nonzero count, and that ProPublica candidates carry `needsResearch:
  true` in the emitted JSON.
- Phase 3: unit-test-equivalent check — feed `essay-match.ts` a prompt with `aiPolicy:
  "prohibited"` and confirm it returns `needs_new_essay` even when the angle score would otherwise
  hit `reuse`. Add/extend a case in the existing `apply/field-map.test.ts`-style test file if one
  exists for essay-match.
- Phase 4: after ≥5 real resolved outcomes exist in the log, confirm `expectedValue` for that
  bucket changes from the match%-only baseline; below 5, confirm it's unchanged (regression guard
  against premature confidence).
- Phase 5: run `apply/fill.ts` against a known PDF-application target from `apply/targets.json`;
  confirm a draft PDF lands in the artifact directory and a `PDF_DRAFT_REVIEW` checkpoint is
  raised rather than a bare `needs_human` no-op.
