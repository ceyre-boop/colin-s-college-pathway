# Scholarship Agent — Phase 1: "The Brain"

## Context

The dashboard is live at `https://colin-college-pathway.onrender.com` (Render static site, 18
seeded scholarships, localStorage). Colin now wants an agent that finds, drafts, and ultimately
applies to scholarships on his behalf, and is willing to pay (minimal) API tokens because the
ROI is potentially thousands in scholarship money. He's already on Claude Max (covers Claude for
Chrome) and pays for some API usage for his quant system.

**Decisions (this session):** fill/submit → *fully autonomous* (end-goal); discovery → *hybrid,
curated now*; trigger → *dashboard button*; first build → *the brain first*.

**Reconciliation & honest guardrails.** "The brain first" and "autonomous submit" are different
layers. Phase 1 (this plan) builds **the brain only** — it drafts a daily batch you approve; it
does **not** submit anything. Autonomous submission is deferred to Phase 2 and will stay
*bounded*: essay-based apps keep your review (platform ToS and Anthropic's own guidance both push
that way; a bad auto-filled field goes out under your name), with auto-submit reserved for
low-stakes no-essay entries you explicitly whitelist. We will not build a mass-auto-submitter
that risks account bans or disqualification.

**Division of labor (keeps tokens near zero):** the API backend does only the cheap text work
(draft essays). The clicking/typing stays with **Claude for Chrome** (free, your logins) — paying
API tokens to drive a headless browser is both pricier and more bot-detectable.

**Outcome:** a "Generate today's batch" button in the live dashboard that drafts tailored essays
for your tracked scholarships (Haiku, ~$0.50 per 100 essays), and an Apply Queue where you
approve/edit/reject each — then hand approved ones to Claude for Chrome to fill.

## Token-minimization (Colin's hard requirement)

- **Haiku by default** (`claude-haiku-4-5`); escalate to `claude-sonnet-4-6` only for Tier-3 /
  high-value scholarships (amount ≥ $7,500, e.g. Goldwater, JKC, Coolidge).
- **Concise prompts.** Matching over the curated 18 is deterministic (already tiered) — no LLM
  call for matching in Phase 1. LLM is used *only* to draft essay text.
- **No prompt caching** — profile+prompt (~1k tokens) is below Haiku's 4,096-token cache minimum,
  so it would silently not cache. Don't add it; it buys nothing here.
- Show an **estimated cost** per batch in the UI (tokens × price). Doc a **hard spend cap** in the
  Anthropic console as the real backstop.

## Architecture

Convert the Render **static site → Bun web service** (re-introduces a small `server.ts`, which we
had removed) so a dashboard button can call a backend that holds the API key.

- `server.ts` (`Bun.serve`) serves `dist/` **and** exposes:
  - `POST /api/draft` — one essay. Body `{ scholarship, profile, context, model? }` → `{ essay }`.
  - `POST /api/batch` — many essays. Body `{ scholarships[], profile }` → `[{ id, essay, words, model, costUsd }]`.
  - Both: direct `fetch` to `https://api.anthropic.com/v1/messages`, `x-api-key` from
    `ANTHROPIC_API_KEY` (Render secret), `anthropic-version: 2023-06-01`. Model chosen per
    scholarship value. Returns token usage so the UI can show cost.
- Client sends the user's **live** scholarships (from localStorage) + profile, so it drafts for the
  actual tracked list — server stays stateless.

## Files

```
server.ts                      # NEW (re-added): static serve + /api/draft + /api/batch
render.yaml                    # MODIFY: static → web service (Docker w/ oven/bun, as before)
Dockerfile                     # NEW (re-added): oven/bun build + serve
.env.example                   # NEW (re-added): ANTHROPIC_API_KEY
src/lib/essayCost.js           # NEW: token→USD estimate + model-pick helper (Tier3/amount gate)
src/pages/ApplyQueue.jsx       # NEW: "Generate today's batch" + Approve/Edit/Reject/Copy cards
src/pages/Essays.jsx           # MODIFY: keep prompt-builder; add real "Generate" via /api/draft
src/App.jsx                    # MODIFY: add "🚀 Apply Queue" tab
src/data/profile.js            # reuse (already real); server imports the same string
src/data/defaults.js           # reuse (DEFAULT_SCHOLARSHIPS, tiers/amounts drive model pick)
src/index.css                  # MODIFY: queue card + approve/reject styles
```

## Behavior — Apply Queue

1. "Generate today's batch" → `POST /api/batch` with scholarships filtered to status `found`/`applied`.
2. Render one card per result: scholarship, draft essay, word count, est. cost.
3. Per card: **Approve** (bumps status, marks "ready to fill"), **Edit** (inline), **Reject**,
   **Copy** (essay + a structured profile field-map block ready to paste into Claude for Chrome).
4. Approved items persist in localStorage (extend `useLocalStorage('ccp_scholarships', …)` with a
   `draftEssay` / `approved` field; reuse the existing `updateStatus` pattern in
   `src/pages/Scholarships.jsx`).

## Verification (end-to-end)

1. `bun run build` → zero errors; `ANTHROPIC_API_KEY=… PORT=3000 bun run server.ts`.
2. Headless Chrome render (the approach used this session) — Apply Queue tab renders; "Generate
   batch" returns drafts; cost shows; Approve/Reject persist across refresh.
3. `POST /api/batch` with 2 scholarships returns 2 essays as JSON 200; confirm Haiku used for
   Tier-1/2 and Sonnet only for Tier-3 (check returned `model`).
4. Commit, push, re-apply Render blueprint (now a web service), set `ANTHROPIC_API_KEY` secret,
   then `curl` the live `/` and a live `/api/draft` smoke test.

## Roadmap (Phase 2 — not now)

- **Discovery:** add scholarships via Claude for Chrome (interactive) or a vetted aggregator feed;
  LLM-score fit (Haiku) before drafting. Scraping only if it proves worth the fragility/ToS risk.
- **Fill integration:** approved batch → Claude for Chrome shortcut (see `ScholarshipAutomation.md`)
  fills your real forms; you review.
- **Bounded autonomous submit:** opt-in per *category*. Auto-submit only no-essay/low-stakes
  entries you whitelist; essay apps always retain your review. Each platform's ToS checked first.

## Out of scope

Headless-browser submission, mass scraping, fully unattended essay-app submission, multi-user.
