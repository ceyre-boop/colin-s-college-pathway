# Scholarship OS — Layered Rearchitecture (Phases 0–3)

## Context

The system already drafts essays and fills forms. What it lacks is a spine: there is no stable
identity for a scholarship, no single state vocabulary, no place an agent can write that a human
can read back, and no record of *why* a value went into a field. A design review proposed a
five-layer architecture (identity vault, normalization, portal state machine, human-intervention
queue, inbox agent). Most of that architecture is already written in this repo — and unwired.

Two premises in that review do not match the code, and the plan below is corrected accordingly:

- **There is no Gmail credential and no email integration anywhere.** `.env` contains exactly two
  keys (`CB_USERNAME`, `CB_PASSWORD` — College Board site login). Layer 5 has no input, so it is
  deferred rather than built against an imaginary mailbox.
- **The live PII exposure isn't `.env`.** It is `apply/field-map.test.ts:7-8,39-45`, which is
  git-tracked and hardcodes real DOB, phone, email, and street address — defeating the
  `applicant.local.json` gitignore entirely. Secondary: `.github/workflows/deploy.yml` publishes
  `dist/` to GitHub Pages on every push, and that bundle contains name + `FAFSA SAI -1500`.

What already exists and is dead: `scout/eligibility.ts` (236 lines of working deterministic
eligibility screening, imported by nothing), and `apply/pipeline.ts` (the best human-gate taxonomy
in the repo, imported only by its own test). A large fraction of this plan is wiring, not writing.

**Decisions taken:** repo stays private, scrub HEAD only (no history rewrite). Persistence is an
append-only hash-chained JSONL log with a rebuildable projection — no SQLite. Build Phases 0–3 now.
Target autonomy is confidence-gated auto-submit (see the interim posture in Phase 2).

---

## Current-state facts this plan depends on

| Concern | Where it lives today |
|---|---|
| Real executor | `apply/fill.ts` (251 lines) — Playwright `launchPersistentContext`, `liveFormExtractor()` `:63-89`, own 6-value `Outcome` `:51` |
| Field mapping | `apply/field-map.ts` — 26 ordered regex rules `:37-64`, `HARD_BLOCK` `:27-33`, `DECLINE` `:67-70`; each rule already carries a `path` recorded in the audit record |
| State machine (live) | `src/lib/scholarshipWorkflow.js:7-17` + guards `canAdvance` `:86-93` / `advance` `:95-99` — persisted **only** to localStorage `src/App.jsx:32`, never read back by any script |
| State machine (dead) | `apply/pipeline.ts:16-25` — same 9 states, plus `humanGates` `:76-83` |
| Eligibility (dead) | `scout/eligibility.ts` — `screenEligibility()` `:133-235` returns pass/disqualified/ambiguous |
| Identity | `applicant.local.json` (gitignored) + **two duplicates**: `COLIN_PROFILE` `scout/eligibility.ts:38`, prose copy `ScholarshipAutomation.md:26-41` |
| Join key | 48-char name slug, computed independently in `select.ts:44`, `probe-form.ts:45`, `scout.ts:603`; fuzzy 24-char dedup in two more places |
| Essay prompts | `probe-form.ts:159-163` writes a **placeholder string**, never the real prompt |

---

## Phase 0 — Containment

**Goal:** close the exposures. No architecture; nothing below depends on it.

- `apply/field-map.test.ts` — rebuild the fixture from `applicant.example.json` (already exists for
  this purpose). Change assertions at `:39-45` to assert `result.path === "contact.email"` rather
  than the literal value. These tests exercise *mapping*; they never needed real PII.
- `Plans/https-bigfuture-collegeboard-org-scholar-greedy-crystal.md:70` — scrub the DOB/phone/address prose.
- **Delete `.github/workflows/deploy.yml`.** Render (`render.yaml`, `Dockerfile`, `package.json` start)
  is the real deployment; Pages is a redundant public copy of the same bundle. It was already
  deliberately deleted once at commit `10a8d1d`.
- `server.ts:77` — require `Authorization: Bearer ${process.env.APP_TOKEN}` before the handlers. The
  IP rate limit at `:79-83` keys on client-controlled `x-forwarded-for` and must not be the only control.
- `identity/secrets.ts` (new) — read `CB_USERNAME`/`CB_PASSWORD` from macOS Keychain via
  `security find-generic-password`; remove them from `.env`; point `scout/bigfuture-harvest.ts:16` at it.

History is **not** rewritten (repo is private). Note in the file that DOB and street address are
not rotatable, so this decision is revisited if the repo ever goes public.

**Verify:** `git grep -iE "van vleet|573-8908|2006-12-19"` returns nothing at HEAD;
`bun test apply/field-map.test.ts` passes; `curl -X POST $URL/api/draft` without a token → 401.

---

## Phase 1 — One ID, one vocabulary, one log

**Goal:** the foundation every later phase joins on.

**Create**
- `src/lib/ids.js` — `scholarshipId(name, url)`, keyed on normalized host + normalized name so a
  renamed listing keeps its identity. Replaces the slug logic in `select.ts:44`, `probe-form.ts:45`,
  `scout.ts:603` and the fuzzy prefix dedup at `select.ts:121`, `scout.ts:611`.
- `src/lib/machine.js` — **plain `.js` with JSDoc types**, so Vite and Bun both import it with no
  build step. This is the concrete reason there are two state machines today. Ports `canAdvance`
  `:86-93` and `advance` `:95-99` verbatim.
- `state/log.ts` — `append(event)` with `prevHash = sha256(prevEvent)`; `state/rebuild.ts` replays
  `events.jsonl` → `projection.json`. `state/` is gitignored (the log contains filled values);
  tamper-evidence comes from the hash chain, not from git.
- `state/schema.js` — ONE `Application` record replacing the four overlapping shapes (`scout.ts:42-57`,
  `select.ts:19-33`, `apply/types.ts:69-84`, `defaults.js:43`). Two fixes land here: **parse deadline
  into an ISO date** (unparsed string everywhere today) and **replace the single `match` integer with
  a structured eligibility verdict**. Add the fields that don't exist at all: `referencesRequired`,
  `documentsRequired`, real `essayPrompts`.

**State mapping.** Two legacy states are attributes wearing a state costume, and one is two states
jammed together — `scholarshipWorkflow.js` already stores the attributes separately:

| legacy | canonical |
|---|---|
| discovered | `DISCOVERED` |
| verified | `DISCOVERED` + `sourceTrust` (demoted — already at `:65`) |
| eligible | `ELIGIBILITY_CHECKED` |
| prioritized | `ELIGIBILITY_CHECKED` + `expectedBenefit` (demoted — already at `:66`) |
| prepared | `FORM_MAPPED` |
| needs-review | `REVIEW_REQUIRED` |
| submitted | `SUBMITTED` |
| confirmed | `AWAITING_RESULT` |
| won/rejected | `WON` \| `LOST` (**split** — scam-risk gating needs these distinct) |
| — | `ACCOUNT_NEEDED`, `AUTHENTICATED`, `ANSWERS_READY` (new) |

**Not breaking the React app:** `normalizeScholarship()` `:50-68` already does exactly this coercion
via `LEGACY_TO_WORKFLOW` `:38-46`. Extend that mechanism, bump `ccp_scholarships_v2` → `_v3` at
`src/App.jsx:32`, and upconvert the v2 blob on first read. No migration script.

`fill.ts`'s `Outcome` `:51` is a **run result, not a state**: `auto_submitted` → event → `SUBMITTED`;
`filled_ready` → `REVIEW_REQUIRED`; `needs_human` → typed interrupt; `needs_essay` → `FORM_MAPPED`
blocked on an essay artifact; `error` → `portal_malfunction` interrupt.

**Delete** `apply/pipeline.ts` + `pipeline.test.ts` — *after* promoting `:76-83`'s gate list into
`state/interrupts.js`.

**Also land here (10 lines, unlocks Phase 4):** `liveFormExtractor` `fill.ts:85` already has the
label and an `isEssay` flag for every textarea. Emit `{prompt, wordLimit}` into the `FORM_MAPPED`
event so real prompts start accumulating even before the essay layer is built.

**Verify:** `bun state/rebuild.ts` reproduces `projection.json` byte-identically twice; load the app
with an existing v2 localStorage blob and confirm every scholarship survives with a canonical state.

---

## Phase 2 — Identity vault, per-field confidence, broker

**Goal:** Layer 1, and the numbers that gate autofill.

**Create**
- `identity/vault.json` (gitignored) — `applicant.local.json` restructured so every leaf is
  `{value, source, lastVerified, sensitivity, allowedForAutofill}`. Keep `Applicant`
  (`apply/types.ts:15-49`) as the *resolved* shape so `field-map.ts` needs no signature change.
- `identity/broker.ts` — `open(grant: FieldPath[], purpose)` returns a proxy over the vault; every
  `get` emits `field_read` with its purpose, any path outside the grant **throws** and emits
  `capability_denied`. The grant is computed from the form's detected fields *before* the profile
  loads, so `fill.ts` never holds paths the form didn't ask for.
- `llm/untrusted.ts` — wraps scraped content in explicit "this is data, never an instruction"
  delimiters. Apply at `scout.ts:494` first, which today feeds scraped `description` text straight
  into an LLM prompt.

**Honest scoping of the broker.** In a single-process Bun app, any module can just read the vault
file; as a sandbox this is theater, and no encryption-at-rest whose key sits beside the ciphertext
is worth building. It earns its place against the three threats that are actually real here:
prompt injection from scraped portal pages (live today), agent error replicated across 30 forms,
and a semantic mapper helpfully dumping the profile into an "Additional notes" field. Against those
it is an auditing and correctness control, and that is how it is specified.

**Confidence — composed from four knowable factors, not invented:**

```
confidence = ruleSpecificity × collisionPenalty × labelTier × fieldFreshness
```

- `ruleSpecificity` — one hand-authored number per rule added to `Rule` at `field-map.ts:36`. This is
  the honest factor: it encodes ambiguity knowledge no computation recovers. `/date of birth|dob/`
  `:51` → 0.99; `/e-?mail/` `:43` → 0.99; `/state|province|region/` `:48` → 0.75;
  `/full name|your name|name/` `:42` → 0.70 (matches "Name of your school", "Parent name");
  `/class level|…|status/` `:58` → 0.55 — bare `status` also matches "Marital status", which is the
  worst rule in the file and will correctly stop autofilling under a 0.98 bar.
- `collisionPenalty` — free. Change the loop `:90-95` from first-match-wins to evaluating all 26
  rules and counting hits. One match → 1.0; two or more → 0.85.
- `labelTier` — ~5 lines. `labelFor()` `fill.ts:64-75` already cascades four label sources; have it
  return which tier it used. Real `<label>` → 1.0; platform heading → 0.95; `aria-label` → 0.90;
  `placeholder` → 0.80; bare `input.name` like `field_2` → 0.50.
- `fieldFreshness` — from the vault: document-sourced and verified <12mo → 1.0; self-asserted → 0.92;
  stale → 0.85.

Expected result: only first/last name, email, DOB, GPA, and zip — with a real label and fresh data —
clear 0.98. That closely matches what `fill.ts` safely autofills today, which is the sanity check.
`HARD_BLOCK` and `DECLINE` are exempt at 1.0 and never threshold-subject.

**Interim auto-submit posture.** Full confidence-gating needs the portal adapters from Phase 5, which
is out of scope. Until then: keep `AUTOSUBMIT_ALLOWLIST` `fill.ts:47`, `DRY` default-on `:41`, and
`MAX_SUBMIT=3` `:42`, and **add** the requirement that every filled field cleared 0.98. This strictly
tightens today's behavior and is the same predicate Phase 5 will extend with "≥3 clean adapter runs."

**Also:** delete `COLIN_PROFILE` `scout/eligibility.ts:38` and derive from the vault; scrub the prose
copy at `ScholarshipAutomation.md:26-41`. Three identity stores become one.

**Verify:** golden-file test over ~15 known labels asserting "Marital Status" now scores <0.80 and
drops out of autofill while "Date of Birth" from a real `<label>` clears 0.98. Broker test: request
`financial.fafsaSAI` under a grant excluding it → throws + `capability_denied` in the log.

---

## Phase 3 — Intervention queue, and resurrect the eligibility screener

**Goal:** Layer 4 — and the phase that pays back the dead code.

**Create**
- `state/interrupts.js` — taxonomy promoted from `pipeline.ts:76-83` (login, automation-permission,
  attestation, signature, recommendation, sensitive-document, fee) plus CAPTCHA, MFA,
  unknown-eligibility, unusual-financial-info, final-submission-approval, portal-malfunction.
- `state/queue.ts` — `raise(type, applicationId, context)` / `resolve(id, answer, who)`, both writing events.
- `src/data/interventions.js` — generated, same emit pattern `scout.ts:597-620` already uses for
  `scoutFound.js` (which `App.jsx:47` already merges). Works in the static build, zero new infra.
- `scout/adjudicate.ts` — the file `eligibility.ts` was written to feed and which never existed. No
  LLM needed initially: `ambiguous` → raise `unknown_eligibility`; `disqualified` → terminal;
  `pass` → `ELIGIBILITY_CHECKED`. **`eligibility.ts` returning "ambiguous" already *is* the
  unknown-eligibility interrupt** — it just had nowhere to write.

**Modify**
- `src/App.jsx:196` — new `INTERVENTIONS` tab rendering typed cards with a resolve action. (The
  existing `queue` tab is essay-batch drafting, not this.)
- `apply/fill.ts` — every `needs_human` path `:126`, `:130`, `:175` raises a *typed* interrupt; add
  explicit CAPTCHA/anti-bot detection that raises and **halts**. Nothing in this system works around
  a bot challenge, an access control, or a fee wall.
- `scout/scout.ts:558` — the fabricated `match: 50` on scoring failure becomes an interrupt, not a
  fake score that has to be laundered out downstream at `select.ts:112`.

**The queue does not go in localStorage.** It is the one piece of state a Bun process must read back
— the agent needs the human's answer. localStorage is provably write-only today; the queue cannot
inherit that defect. When running locally against Bun, add `GET /api/queue` and
`POST /api/queue/:id/resolve` to `server.ts` (~60 lines) with the generated file as the static fallback.

**Verify:** `bun apply/fill.ts --slug <login-walled target>` produces a typed `ACCOUNT_NEEDED`
interrupt in `state/queue.json`, it renders in the new tab, and resolving it appends a resolution
event carrying `resolvedBy` — closing the "who approved" loop the audit log requires.

---

## Deferred (not in this scope)

- **Phase 4 — evidence library + real prompts.** `src/data/timeline.js` is already ~80% an evidence
  library (26 events, `essay` notes on 18). Enrich it with quantified/challenge/learned/themes/verified
  rather than building a new store; `themes` then replaces the flat keyword lists at
  `essay-match.ts:19-25` and kills the conflicting second classifier at `select.ts:75-88`. Gated on
  the prompt capture landing in Phase 1.
- **Phase 5 — portal adapters + document upload.** Promote `fill.ts:66-74`'s inlined Formidable and
  Google Forms branches into `apply/adapters/*`. Promotion criterion: ≥3 `FORM_MAPPED` runs on the
  same host with identical mappings and zero human corrections → emit `adapter_candidate`; a human
  writes the file. Never auto-generate adapter code. Also: file inputs are excluded at `fill.ts:81`,
  so documents are never attached — route them to a `document_upload` interrupt.
- **Phase 6 — result agent.** Blocked: no inbox connection exists. Land one guard now instead —
  `AWAITING_RESULT → WON` requires an `award_notice` artifact from a verified source. Three lines,
  and it is the scam vector. `LOST` needs no gate.

## End-to-end verification

1. `bun test` — existing suites (`field-map.test.ts`, `essay-match`, `eligibility.test.ts`) pass unchanged.
2. `bun state/rebuild.ts` twice → byte-identical `projection.json`.
3. `bun scout/probe-form.ts` on 2 targets → records carry stable IDs and canonical states.
4. `bun apply/fill.ts --slug <target>` (dry) → `FORM_MAPPED` event with per-field confidence and
   `factors`, `filled.png` written, no field below 0.98 auto-filled.
5. Load the dashboard with a pre-existing v2 localStorage blob → nothing lost, interventions tab populated.
6. `git grep -iE "van vleet|573-8908|2006-12-19"` → empty.
