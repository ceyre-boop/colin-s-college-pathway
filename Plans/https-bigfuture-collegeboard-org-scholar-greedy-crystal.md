# Plan: Autonomous scholarship apply system (screen → fill → gate → queue)

## Context

**What prompted this:** A manual apply session proved the point Colin made — *he doesn't want me clicking through applications one by one; he wants the system doing it at scale, mostly off CollegeBoard/BigFuture, for pennies.* The manual run surfaced the three real obstacles any system must solve: (1) BigFuture's login-walled, client-side pages with an unstable session; (2) ~80–90% of "biology" listings are ineligible for this specific student (locked to a state, institution, subfield, or identity he doesn't have); (3) every application submits in Colin's name, so auto-submit needs hard guardrails.

**What's already done (foundation, shipped this session):** BigFuture is wired into the scout pipeline — `scout/bigfuture-harvest.ts` (Playwright, persistent login) scrapes cards → `~/.claude/memory/bigfuture_raw.json`; `scout/scout.ts` `harvestBigFuture()` reads it, scores, emits `src/data/scoutFound.js`; the app renders a green BIGFUTURE badge. `.env` holds CB creds (gitignored). 344 records harvested.

**Decisions (Colin):** Hybrid gate (auto-submit ONLY the safe class; fill+queue the rest) · TypeScript/Bun (complete the existing pipeline, no Python) · $10/mo hard cap but **target actual spend of cents** · **Reuse essays aggressively; never auto-generate — anything needing a new essay is queued/deferred for Colin to maybe write later** · Never claim first-generation · Never type/store SSN.

**Honest scope — what "thousands" means:** *Thousands screened for free* → hundreds adjudicated by Haiku → tens form-probed → **a handful auto-submitted** (only no-login/no-fee/no-essay forms on a trusted-platform allowlist). BigFuture has no bulk-submit API; it links out to thousands of bespoke sponsor forms, most login-walled or essay-required. Those correctly land in human-review / needs-essay buckets. The system industrializes discover→screen→fill→gate, not a magic submit button.

---

## STATUS + REMAINING PLAN (updated — 2 build sessions left)

### Done & verified (the "brain")
- `scout/eligibility.ts` (+ 20 passing tests) — free DQ filter.
- `apply/field-map.ts` (+ 28 passing tests) — SSN/password/payment hard-blocks, first-gen never asserted, common-field mapping.
- `scout/essay-match.ts` — free essay-reuse matcher (smoke-verified against the 20-essay library).
- Playwright + Chromium installed (v1.61.1).

### Spend guard — "impossible to overspend" (code-level, since the console cap is Colin's own account action)
The ONLY paid operation is Claude eligibility adjudication. Make overspend structurally impossible, three layers:
1. **Off by default.** The orchestrator runs in FREE mode unless `--adjudicate` is passed. Free mode applies to the rules-filter "pass" set only → **$0.00**.
2. **Hard per-run call cap.** `--adjudicate` accepts `--max-adjudicate N` (default 300). The batch is `.slice(0, N)` before any call — mathematically ≤ ~$0.15/run regardless of catalog size. Dropped overflow is logged, never silently ignored.
3. **Live cost accumulator + abort.** Reuse `costUsd()` (`src/lib/essayCost.js`); a `--budget-usd X` (default 0.50) trips an abort the moment projected/actual spend crosses it. Prints the tally at the end.
- Colin's action (I can't do it — his account): console.anthropic.com → Settings → Limits → set a **$2/mo** hard cap as the outer seatbelt.

### BUILD SESSION 1 — "The applying machine" (the payoff piece; $0 to run)
Goal: watch the *system* fill and submit a real form end-to-end, safely. No scale yet — prove the engine on a handful of known-good targets.
- **`applicant.local.json`** — populate once from Colin's Obsidian identity node (DOB, phone, 4295 Van Vleet Rd, US citizen); gitignored, never committed. Shape = `Applicant` in `apply/types.ts`.
- **`apply/fill.ts`** — Playwright engine using `launchPersistentContext(apply/.userdata/)`: open applyUrl → re-classify the LIVE form → map fields via `mapField()` → fill → attach reused essay if any → apply the gate (`computeAutoSubmitEligible`). Safety enforced in code: **`--dry` default-ON** (fills + screenshots, submits nothing), `--submit` required for real, `--max-submit N` (default 3), dedupe via `apply/results/submitted.json`, hard-abort on any `mapField` "block" (SSN/fee/login), artifacts to gitignored `apply/results/`.
- **`apply/field-map.ts`** platform adapters — Formidable (`item_meta[id]` by label) and Google Forms (`entry.id` by aria-label).
- **Seed target list** — a few hand-picked eligible open forms (starting with the verified Shape Plus Formidable form) so the engine is provable without the full crawl.
- **Verify:** dry-run against Shape Plus → filled screenshot in `apply/results/`, zero submits. Then one real `--submit --max-submit 1` on that single form to prove submission. Idempotency test (2nd run submits nothing). All `mapField`-blocked fields route to human.

### BUILD SESSION 2 — "Scale + funnel + dashboard" (this is where the ~$0.50/mo lives)
Goal: feed the engine thousands of screened targets, cheaply, with the whole funnel visible in the app.
- **`scout/bigfuture-harvest.ts` enrichment** — authenticated, paced, resumable detail crawl adding `requirements` + `externalApplyUrl` + `sponsor` per card (feeds eligibility + fill).
- **`scout/adjudicate.ts`** — Haiku **Batch API** on rules-filter "ambiguous" only, wrapped in the spend guard above.
- **`scout/emit-queue.ts` → `src/data/applyQueue.js`** + 3-bucket APPLY QUEUE UI in `src/App.jsx` (~L539): auto-submitted log · filled-&-ready (one-click review) · needs-new-essay (deferred).
- **`scout/apply-all.ts`** orchestrator + `/apply` command chaining harvest→eligibility→(adjudicate)→probe→essay-match→fill→emit, printing the cost tally.
- **Verify:** full run prints a cents tally (or $0.00 in free mode), queue renders three buckets in the app, `--max-adjudicate`/`--budget-usd` caps proven to abort.

---

## Approach (7 phases, cost lever first) — original detail, retained for reference

**Phase 1 — FREE deterministic eligibility pre-filter (`scout/eligibility.ts`, new).** Pure TS, zero network, zero Claude — the core cost lever. `screenEligibility(candidate, requirementsText, profile) → {decision: "pass"|"disqualified"|"ambiguous", reasons[]}`. Colin's constants derived from `~/.claude/memory/scholarship_profile.json`: MI resident; Mott CC / UM-Flint; biology/CS/STEM/health; undergrad/transfer; US citizen; **NOT first-generation**. Ordered rules against Requirements text, cheapest first: wrong-state DQ, wrong-institution DQ, wrong-field DQ, wrong-grade-level DQ, citizenship DQ, **demographic-identity DQ** (first-gen/women-only/veteran/tribe/etc. — highest-value cut), deadline-closed→defer. **Bias to `ambiguous`, never over-DQ** (false negatives discard real money) — only DQ on an explicit *scoped* requirement. Ship `scout/eligibility.test.ts` with fixture strings (no key needed). Cuts ~36k → the 10–20% survivors before any paid call.

**Phase 2 — Claude adjudication on ambiguous survivors ONLY (`scout/adjudicate.ts`, new).** `pass`/`disqualified` never reach Claude. Reuse `scout.ts`'s `scoringPrompt`/`extractJsonArray`/`costUsd` (`src/lib/essayCost.js`) verbatim; single narrow question: "is the student ELIGIBLE (not: will they win)?". **Use the Message Batches API** (`/v1/messages/batches`, 50% off Haiku) — not latency-sensitive. Truncate requirements to ~400 chars. Writes `eligibility:{decision,reason,adjudicatedBy}` into each `metadata.json`.

**Phase 3 — Enrich the harvest (`scout/bigfuture-harvest.ts`, modify).** Card-level pre-screen first (essay flag/amount/deadline), then a **paced authenticated detail crawl of survivors only** capturing `requirements`, `externalApplyUrl`, `sponsor`, `enrichedAt` (mirror the existing `pageExtractor`). Reuse `launchPersistentContext(USER_DATA_DIR)` (the session-stability fix), 1.5–2.5s pacing, `--max-detail N`, re-assert "Hi, Colin" login before each batch, and **resume by skipping already-`enrichedAt` slugs** so a dropped session continues instead of restarting.

**Phase 4 — Essay-REUSE matcher (`scout/essay-match.ts`, new — generates NOTHING).** Library = existing `scholarship_essays/{slug}/essay.md` + 5 angles (`stem_mri`, `achievement_blackbelt`, `leadership_lunchbunch`, `need_mott`, `service_worship`) with keyword signatures from `voice_profile.md`. Heuristic TF/theme scoring + word-limit fit → buckets: `reuse` (point at existing essay), `reuse_with_edit` (good angle, wrong length → one-click human trim), `needs_new_essay` (**tag & defer, generate nothing**). The `server.ts /api/batch` generator stays manual-only.

**Phase 5 — The apply engine (`apply/fill.ts` + `apply/field-map.ts`, new).** The missing piece everything references. Reuses `apply/types.ts` (`Applicant`, `FormMeta`, `computeAutoSubmitEligible`, `routeFor`, `TOS_FORBIDS_AUTOMATION`).
- **Field-mapper** — normalize `detectedFields` (from `probe-form.ts`) → ordered regex table → `Applicant` paths (name/email/phone/address/dob/gpa/major/school/citizenship; essay field → matched essay if any). **HARD-BLOCK list (never fill, force `chrome`/queue): `ssn|social security|tax id`, `password`, `credit card|cvv|payment`, `routing|bank account`, fee/login fields.** gender/ethnicity blank (decline) unless required + present in `applicant.local.json`. **Never assert first-generation.** Unmapped required fields → force out of auto-submit into fill+review.
- **Engine** — Playwright `launchPersistentContext(apply/.userdata/)`; navigate `applyUrl`; **re-classify the live form** (static probe misses JS-rendered forms; abort to queue if login/fee/SSN surfaces); fill mapped values; screenshot to `apply/results/<slug>/filled.png`; then the gate: **safe class** (eligible + web form + no login/fee/essay + no unmapped-required + no hard-blocked field + on trusted-platform allowlist) → submit + confirmation shot → `submitted.json`; **else** → fill+review bucket; **login/account-creation** → queue "needs human."
- **Auto-submit safety (enforced, non-negotiable):** idempotent dedupe via `apply/results/submitted.json` (never submit a slug twice); **`--dry` default-ON**, real submit needs `--submit`; **`--max-submit N` (default 5)**; **trusted-platform allowlist** (start: Google Forms + verified Formidable `direct` only); hard aborts on SSN/fee/login; auto-submit restricted to no-essay/no-attestation forms only. All artifacts → gitignored `apply/results/`.
- **Platform adapters:** Google Forms (`entry.<id>` by aria-label), Formidable (`item_meta[<id>]` by adjacent label, multi-step loop), AwardSpring/Foundant → always queue.

**Phase 6 — Feed the APPLY QUEUE tab.** New emitter `scout/emit-queue.ts` → `src/data/applyQueue.js` (scoutFound.js pattern, **no PII** — slugs/URLs/status/reasons/screenshot paths only) with buckets `autoSubmitted`, `filledReady`, `needsNewEssay`. Modify `src/App.jsx` `tab === "queue"` (~line 539): keep the existing essay-drafting section, add three sub-sections above — auto-submitted receipts (green), filled-&-ready with one-click "REVIEW & SUBMIT" opening `applyUrl` + filled screenshot + `unmappedFields` to finish (yellow), needs-new-essay deferred with a manual "DRAFT" button (the only generation trigger). Reuse `chipStyle`, `S.card`, `S.btn`, `T`.

**Phase 7 — One orchestrator (`scout/apply-all.ts`, new; wire to a `/apply` command).** Chains harvest(enriched) → eligibility(free) → adjudicate(Haiku batch, survivors) → probe-form → essay-match(free) → fill `--dry` → emit-queue → emit-app. Each step resumable/idempotent. Flags `--dry`(default)/`--submit`/`--max-submit N`/`--max-detail N`/`--from-cache`. Prints a cost tally; **fail loud if adjudication exceeds ~$0.50.**

## Applicant PII

Read from gitignored `applicant.local.json` (shape = `Applicant` in `apply/types.ts`). At setup I'll populate it once from Colin's Obsidian identity node (`~/Obsidian/.../Colin-Identity-Profile.md`) — DOB 12/19/2006, phone, 4295 Van Vleet Rd Swartz Creek MI 48473, US citizen — but **never commit it** (respecting his Obsidian-only PII rule). SSN never stored.

## Files
- **New:** `scout/eligibility.ts` (+`.test.ts`), `scout/adjudicate.ts`, `scout/essay-match.ts`, `apply/fill.ts`, `apply/field-map.ts` (+`.test.ts`), `scout/emit-queue.ts`, `scout/apply-all.ts`, `src/data/applyQueue.js` (generated), `applicant.local.json` (gitignored)
- **Modify:** `scout/bigfuture-harvest.ts` (detail enrichment), `src/App.jsx` (three-bucket queue ~L539)
- **Reuse:** `apply/types.ts` gate/types, `scout/scout.ts` scoring/`costUsd`, `scout/probe-form.ts`, `src/lib/essayCost.js`, existing `scholarship_essays/` + angles

## Cost model (per full run)
Harvest/enrich $0 · rules filter $0 · **Haiku Batch adjudication of ~200 survivors ≈ $0.08** · essay-match $0 · fill/submit $0 · essay generation **$0 (deferred)** → **~$0.05–0.15 per run.** Monthly re-runs stay in cents; $10 cap is just the ceiling. Set a hard cap in the Anthropic console.

## Verification
1. **Unit (no key):** `eligibility.test.ts` (wrong-state/institution/field/first-gen/citizenship DQ; national/STEM/undergrad pass) + `field-map.test.ts` (SSN/password/fee hard-block; first-gen never asserted; common labels map).
2. **Dry-run `fill.ts`** on 3 known targets (a Google Form, a Formidable `direct`, a login-walled one) → login routes to `chrome`, safe one enters auto-submit class, screenshots land in `apply/results/`.
3. **Idempotency:** run fill twice → second submits nothing. **Cap:** `--max-submit 1` with 2 eligible → only one submits.
4. **UI:** `bun run start` → queue tab renders three buckets from `applyQueue.js`; "REVIEW & SUBMIT" opens the real form.
5. **Cost assertion:** orchestrator prints total; fails if adjudication > $0.50.
6. **Ship the safe class in `--dry` only** until Colin has reviewed 10+ filled screenshots and explicitly enables `--submit`.

## Riskiest parts / honest limits
- Auto-submitting in a real person's name is the highest-blast-radius action — dry-run default, per-run cap, dedupe, allowlist, and SSN/fee/login hard-blocks are mandatory, not optional.
- Rules-filter false negatives silently discard money → bias to `ambiguous`, log every DQ reason, spot-audit the disqualified pile.
- BigFuture session instability + ToS: heavy pacing + resume + small caps; confirm ToS permits the authenticated crawl before scaling.
- Client-side forms defeat the static probe → `fill.ts` re-classifies live and aborts to queue on mismatch.
- Google Forms ToS discourages automation → keep on the auto-submit allowlist only if Colin accepts that, else demote to fill+review.
