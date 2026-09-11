# Colin-AI — Personal Voice Model

## Context

**Goal.** A system that reconstructs Colin's written voice — content, structure, phrasing — well enough that blind raters and stylometric tests can't reliably separate its output from his hand-written baseline, on prompts it has never seen.

**Why now.** The repo already generates scholarship essays, but the generation path is a 6-line prompt (`server.ts:26-41`) with one word of voice guidance ("wry"). Meanwhile `scholarship_essays/voice_profile.md` holds ~3,900 words of carefully-derived voice doctrine that **no code path reads**. The gap between what's documented and what's wired up is the immediate opportunity; the falsifiable voice-reconstruction test is the research goal that makes it rigorous rather than vibes.

**Four findings from exploration that change the original brief:**

1. **The 20 essays in `scholarship_essays/` are contamination, not baseline.** Every one has exactly two `"by": "draft"` revisions and zero `"by": "colin"`. They are LLM output conditioned on `voice_profile.md`. They must never enter the corpus, exemplar bank, or baseline. They *are* the perfect impostor set for author-verification testing.

2. **The real baseline is in Google Drive, and it's small.** ~72 owned Google Docs, mostly AI/trading/code pastes. The genuinely hand-written school-year docs (Sept 2025 – May 2026) number roughly 6–15: "Voluntary Euthinasia", "A Unified Species Concept", "Essay 3", "Midterm Reflection", "Star", plus ~10 school-year Untitled docs. Estimated 8–15K words after Colin's authorship triage. There is no reliable automatic classifier for whether Colin pasted his own text or an LLM's — **only he knows**, so triage is a blocking human checkpoint.

3. **The dyslexia premise is falsified.** The brief assumed natural spellings live in the raw register and are absent from polished work. "Voluntary Euthinasia" is a *submitted philosophy paper* whose title misspells the subject, and which contains "totaly", "diffrently", "as of they are" for "as if they are", "recognise"/"agonising", "moral bounty" for "boundary" (twice), doubled periods, en-dash-as-hyphen, and truncated clauses. Spelling must be a **measured per-register error rate**, not an a priori correct-in-academic toggle. *Caveat: this is currently n=1. Phase 0 must measure the rate across ≥5 verified academic docs before Phase 1 encodes it.*

4. **The corpus is lopsided.** Raw register is abundant; academic register is scarce.

| Register | Source | Volume | Status |
|---|---|---|---|
| directive / raw | `~/.claude/projects/**/*.jsonl` (2,604 files, 440MB) | 51,788 typed msgs / 778K words; **2,555 msgs ≥50w = 244K words** of usable prose | verified Colin, timestamped |
| academic / persuasive | Google Drive | ~6–15 docs, est. 8–15K words | **requires human triage** |
| — | `Obsidian/Trading/` (341K w), `Claude-Chats/` (790K w) | — | excluded: AI artifacts / mixed authorship |
| — | `scholarship_essays/` (8.5K w) | — | **quarantined: LLM output** |

**Intended outcome.** The most likely honest result is: *"a well-conditioned frontier model with measured register contracts sits inside Colin's within-author variance for narrative register, and outside it for academic register, because only ten academic documents exist."* That is a real, falsifiable finding. The Phase 3 harness is what makes it one. Build for that outcome, not for the fine-tune.

**Hardware correction.** M4 Pro, 24GB unified memory, macOS arm64, **no CUDA**. The brief's "QLoRA on a single consumer 24GB card" does not apply — bitsandbytes/PEFT needs CUDA. Local path is **MLX-LM LoRA** on a 4-bit 7–8B base; alternative is ~$1–3 of rented L4/A100 time.

---

## Phase 0 — Corpus

New directory `corpus/`. All data under `corpus/data/` — **add to `.gitignore`, it is PII-dense.**

### Record schema — `corpus/schema.ts`

```ts
export interface CorpusRecord {
  id: string;              // sha256(source|sourceId|offset).slice(0,16) — dedup key
  text: string;            // Colin's prose ONLY, post-clean
  register: Register;      // "directive"|"raw"|"narrative"|"academic"|"persuasive"
  registerConfidence: number;
  source: "claude-jsonl" | "gdoc" | "obsidian" | "manual";
  sourceId: string;        // transcriptPath#lineNo, or gdoc fileId
  timestamp: string | null;
  wordCount: number;
  verifiedBy: "heuristic" | "colin" | null;   // null = unusable downstream
  verifiedAt: string | null;
  split: "train" | "exemplar" | "holdout" | null;
  quarantine: null | { reason: "llm-generated" | "mixed-authorship" | "code-paste" | "unverified-academic" };
}
```

Append-only JSONL, one file per stage: `harvest.jsonl` (everything, nothing judged) → `clean.jsonl` (prose-extracted, deduped) → `verified.jsonl` (**the only file downstream code may read**) + `quarantine.jsonl` (never read by anything).

### `corpus/harvest-claude.ts`

Reimplement the extraction in Bun (streaming, no `jq` dependency, testable). Glob `~/.claude/projects/**/*.jsonl`; keep lines where `type==="user" && !isSidechain && !toolUseResult && typeof message.content === "string"`; drop content starting with `<`, `/`, `!`, or `[Request interrupted`. Emit with `sourceId = ${relPath}#${lineNo}`.

### `corpus/clean.ts` — the part that actually matters

Colin's typed messages are laced with pasted code, tracebacks, and tool output. Each step is a named exported pure function with its own test:

1. `stripFencedCode` — ``` and `~~~` blocks
2. `stripIndentedBlocks` — ≥4-space runs of ≥3 lines
3. `stripPastedOutput` — lines matching `^\s*(at |Error:|Traceback|npm ERR|\+\+\+|---|\d+ \| )`, plus long runs of lines lacking sentence-final punctuation
4. `stripUrlsAndPaths` — replace with `[url]`/`[path]` rather than delete, preserving rhythm
5. `stripFileRefs` — `@path`, `src/foo.ts:33`
6. `collapseWhitespace`

Then **reject** if post-strip words < 8, `strippedRatio > 0.5`, or `alphaRatio < 0.7` (mostly symbols → was a paste). Dedup on exact `id` plus 5-gram Jaccard ≥0.9 within a source — Colin retypes the same directive constantly.

### `corpus/register.ts`

Deterministic heuristic tagger, no model. `directive` (<20w, imperative-initial); `raw` (20–200w, ≥60% lowercase sentence starts, contractions); `narrative` (first-person past-tense density, no argument connectives); `academic` (gdoc source, citations, paragraphs >80w, ≥90% sentence-start capitalization); `persuasive` (academic features + `however`/`therefore`/`but this`/`the problem with`). `registerConfidence` = top-2 margin; anything <0.2 goes to human triage. **Every gdoc-sourced record requires `verifiedBy: "colin"` regardless of confidence.**

### `corpus/harvest-drive.ts` — manifest-driven, not MCP-coupled

The Drive connector is a Claude-session tool, not a library. Keep the deterministic pipeline free of it: `corpus/drive-manifest.json` holds the triaged list (ids already known); a Claude session drops each doc to `corpus/data/gdocs/<fileId>.md` via `mcp__claude_ai_Google_Drive__read_file_content`; the script reads the manifest and the dropped files. Replayable, testable.

```json
{ "fileId": "1gqAlh...", "title": "Voluntary Euthinasia", "claimedRegister": "persuasive",
  "authorship": "unverified", "modifiedTime": "...", "notes": "" }
```

Known ids to seed the manifest: `1gqAlhyaRUrjeyZMrMIcUfnZ6VL4CNbl-bpWgxsl0WZM` (Voluntary Euthinasia), `155diP_gfrmic3YOjK0PChy0TqpjMfMn032OjQA--tNY` (A Unified Species Concept), `1Ef1d_GfGAZXBmUU9UaOMqTCBMIP4rdXGbSePxyqVAKY` (Essay 3), `1KowDU1GFB0iA3I6i8p_C7NMSfYW79FCC7pywDcpJ0_I` (Midterm Reflection), `1DooxNTdffSRJh3rdTT9h7sVczfH4YB5ororw_KfqPFg` (Star).

### Contamination quarantine — structural, not conventional

`corpus/quarantine.ts` exports `QUARANTINED_PATHS = ["scholarship_essays/**"]` and `assertNotContaminated(record)`.

`corpus/quarantine.test.ts` **fails the suite** if any record in `verified.jsonl` has a `sourceId` matching a quarantined path, **or** has ≥8-gram overlap with any `scholarship_essays/*/essay.md`. That second check is the real guard — it catches contamination arriving by any route, including via Obsidian copies. Same test greps that nothing under `voice/`, `eval/`, or `finetune/` opens `quarantine.jsonl`.

### Human triage — rides the existing `state/` spine

`state/checkpoints.js` `raise()` hard-throws on unregistered types (`state/queue.ts:77`) and `EventType` in `state/log.ts:38` is a closed union — both must be extended. Add event types `corpus_doc_verified`, `corpus_doc_rejected`, `corpus_split_frozen`, and:

```js
CORPUS_AUTHORSHIP_UNVERIFIED: {
  question: "Did you personally write this document, with no LLM drafting or rewriting?",
  blocking: true,
  requiredEvidence: ["sourceId", "excerpt", "wordCount"],
  allowedResolutions: ["colin_wrote_it", "llm_assisted", "not_mine", "unsure"],
  resolverRoles: ["human"],
  emitsOnResolve: "corpus_doc_verified",
  rationale: "No classifier can tell whether Colin pasted his own text or an LLM's. Only he knows. A voice model trained on LLM output is a voice model of the LLM.",
}
```

Only `colin_wrote_it` promotes to `verifiedBy: "colin"`; `unsure` stays quarantined.

```bash
bun corpus/harvest-claude.ts
bun corpus/clean.ts
bun corpus/register.ts
bun corpus/triage.ts --raise      # one checkpoint per unverified gdoc
bun state/emit-queue.ts           # existing renderer
bun corpus/apply-triage.ts        # after Colin resolves
bun corpus/stats.ts
```

### `corpus/stats.ts` — the deliverable that unblocks everything

Per-register word counts, and **measured marker rates**: misspelling rate (dictionary check against a hand-maintained `corpus/colin-lexicon.json` allowlist so "recognise" isn't counted an error), en-dash-as-hyphen /1k, doubled-period /1k, bold-mid-paragraph /1k, sentence-initial-lowercase rate, contraction rate, sentence length mean/sd, function-word vector. **These numbers become the register contracts in Phase 5 and the pre-registered bands in Phase 3.** This is where finding #3 gets confirmed or retracted.

### Splits — frozen before anything reads them

`corpus/split.ts`, seeded RNG, split **by document, never by passage**: holdout ≈25% of academic docs and 15% of raw; exemplar pool ≈25%; train the rest. Write `corpus/data/splits.json` and hash it into the event log as `corpus_split_frozen`. Nothing may re-split later.

### `corpus/skeleton.ts` — (seed → piece) pairs

Backwards-generate a seed from each verified polished piece. Fixed prompt, schema-held output:

```ts
interface SeedSkeleton {
  register: Register; targetWords: number;
  assignmentPrompt: string;    // ≤35 words, as a teacher would write it
  thesisAbstract: string;      // ≤25 words, NO phrasing from the piece
  moves: string[];             // ≤6 items, ≤10 words, e.g. "concede opposing view, then dismantle it"
  concreteAnchorLabel: string; // the LABEL ("everyday physical analogy"), never the analogy itself
  sourcesReferenced: string[];
}
```

**Leakage controls enforced in code (`assertNoLeak`), never trusted to the model:** reject if any 4-gram of the skeleton appears in the piece; if skeleton words > 12% of piece words; if `concreteAnchorLabel` contains a noun appearing <3 times corpus-wide (that's the analogy leaking — e.g. the water-freezing-in-a-fridge image); or if any skeleton sentence has token overlap >0.4 with any piece sentence. One retry with the violated constraint appended, then a human checkpoint. Output `corpus/data/pairs.jsonl`.

---

## Phase 1 — Retrieval + conditioning (the control arm)

New directory `voice/`. **No new runtime dependencies** — Bun stdlib plus what's in the repo.

### `voice/infer.ts`

Single inference entry point, mirroring `scout/scout.ts:544` (`scoreViaInferenceCli`): use raw fetch to `/v1/messages` if `ANTHROPIC_API_KEY` is set, else `Bun.spawn` to `~/.claude/PAI/TOOLS/Inference.ts`. Export `infer({system, user, maxTokens, level})`. Everything in `corpus/`, `voice/`, `eval/` routes through it — one swap point, zero marginal cost by default (there is no API key in `.env` today).

### `voice/spec.ts`

Parse `scholarship_essays/voice_profile.md` by `##` heading into a typed object (`doctrine`, `engine`, `mechanics`, `factsBank`, `angleMap`, `smellTest`, `checklist`). Export `voiceSpec()` and `voiceSpecBlock(register)` — render only the sections relevant to the requested register; dumping all 3,900 words into every prompt dilutes it. Cache by mtime. Test: every heading is claimed by exactly one parser branch, so a future edit can't silently drop a section.

### `voice/exemplars.ts`

Reads `verified.jsonl` where `split === "exemplar"`. `selectExemplars({register, seedTokens, n, maxWords})`:
- **hard filter to `register`** — never cross-register; that is the Phase 5 bleed source
- rank by token overlap with the seed, reusing the tokenizer at `scout/essay-match.ts:39`
- **diversity guard (greedy MMR)**: skip any candidate with 5-gram Jaccard >0.3 against an already-selected exemplar. Without this you get three near-identical passages — which is exactly the failure that produced the `stem_mri` ×15-of-20 angle skew
- return 2–3, ≤900 words total, wrapped with `wrapUntrusted` from `llm/untrusted.ts`

### `voice/experiences.ts`

Retriever over the facts bank + the 26 `essay:` notes in `src/data/timeline.js`. **Token overlap, not embeddings** — the candidate set is ~50 short strings over a small closed vocabulary; embeddings would mean a new dependency (there are none), a round trip, and cache invalidation, to solve a ranking problem `scout/essay-match.ts` already solves. Improve it cheaply instead: IDF-weight the overlap, add a small synonym map, and add a **usage-decay penalty** reading prior `angle_used` from `state/events.jsonl`. That last change alone fixes the stem_mri skew, which no embedding would have fixed. Revisit embeddings only if Phase 3 shows retrieval misses; then precompute 50 vectors to a JSON cache, not a vector DB.

Return 3–4 `Experience { id, text, provenance, neverClaim[] }` — the "Never claim" boundaries must ride *with* the retrieved facts, not sit in a distant prompt region.

### `voice/build-prompt.ts`

```ts
export function buildVoicePrompt(input: {
  scholarship, seed, register, targetWords, context?
}): { system: string; user: string }
```

Order matters — constraints last, closest to generation. **system**: identity + register contract (Phase 5) + `voiceSpecBlock(register)` doctrine/engine + smell test + authenticity checklist. **user**: retrieved experiences (with `Never claim`) → 2–3 `<exemplar register="...">` blocks → seed/assignment → explicit target word count → "return only the prose."

### Wiring, de-dup, and repo fixes (~1 hour, do these first)

- `server.ts` imports `buildVoicePrompt`, selected by `process.env.VOICE_PROMPT ?? "v2"`. `"v1"` keeps the current prompt as **control arm B** — both arms must run from one flag or Phase 3 has nothing to compare.
- **Delete `buildPrompt` from `src/App.jsx:139-155`** (a character-identical duplicate of `server.ts:26`). The client sends `{scholarship, seed, register}`; the server composes. This also stops the 24KB profile blob shipping to the browser (`src/App.jsx:748,771`).
- **Fix `server.ts:44`** — the allowlist `["claude-3-5-haiku-latest","claude-3-7-sonnet-latest"]` is disjoint from `PRICING` in `src/lib/essayCost.js` (`claude-haiku-4-5`/`claude-sonnet-4-6`), so any client override silently falls through to `pickModel()`. Replace with `Object.keys(PRICING)`; add a test asserting every allowlisted model has a `PRICING` entry.
- **Fix the Sharpe conflict.** `src/data/profile.js:19` and `src/data/timeline.js:27` say **1.08**; `voice_profile.md`'s facts bank and all 20 generated essays say **1.25**. Both feed the prompt. This is a checkable number going out in applications. Resolve it, make the facts bank the single source, and have `profile.js` derive from it rather than restate it.
- Add `"test": "bun test"` to `package.json` — currently absent. `bunfig.toml` already preloads `test-setup.ts`, which redirects the event log, so tests that append events are safe.

Tests: spec parser round-trip; exemplar selection never returns cross-register; MMR rejects near-dups; retriever returns the leadership angle for a leadership prompt; **prompt-builder output contains no `scholarship_essays/` text** (contamination assertion at the prompt boundary).

---

## Phase 2 — Fine-tune (optional, gated — expect it to fail the gate)

**Gate, evaluated before writing any of this.** All three must hold: (a) the Phase-1 arm's blind-panel accuracy CI *excludes* 0.5 in the discriminable direction; (b) Delta(model↔Colin) falls outside the within-Colin split-half band; (c) ≥800 usable train pairs across ≥12 verified academic documents. **(c) will almost certainly fail** — after a held-out split there may be 4–10 academic training documents, and LoRA on that learns "euthanasia and species concepts", not "Colin's academic voice". If gated out, spend the time on Phase 5 instead. Do not sequence any other work behind this.

If gated through: `finetune/export-mlx.ts` → `finetune/data/{train,valid,test}.jsonl` in mlx-lm chat format, with register as a literal `<register:academic>` token in the system string (cheap, no tokenizer surgery, and it gives Phase 5 a hard dial to test). Cap `directive` at 15% of examples or it dominates by count and flattens everything toward terseness.

```bash
uv tool install mlx-lm
mlx_lm.lora --model mlx-community/Qwen2.5-7B-Instruct-4bit \
  --train --data finetune/data \
  --batch-size 1 --num-layers 8 --iters 600 \
  --learning-rate 1e-5 --steps-per-eval 50 --val-batches 20 \
  --adapter-path finetune/adapters/v1
```

Rank 8–16, ~8 tuned layers, 2–3 epochs equivalent. **Overfitting guard:** early-stop on validation loss, plus `eval/memorization.ts` — max 8-gram overlap between each generation and the training set; any output reproducing ≥15 consecutive training tokens fails the run. That check matters more than val loss here: with ~10 academic docs, the model's easiest win is regurgitation. Adapters gitignored; `finetune/adapters/MANIFEST.json` (committed) records base model, data hash, hyperparams, iters, val loss.

---

## Phase 3 — Evaluation harness (the real deliverable)

`eval/`. **Statistical power, not corpus size, is the binding constraint.**

### Held-out set
`eval/holdout.ts` reads `corpus/data/splits.json`. Held-out *prompts* are the `SeedSkeleton`s of held-out documents — never in training, never in the exemplar pool. A test cross-checks the splits file against exemplar and train ids.

### `eval/stylometry.ts` — pure `features(text): FeatureVector`
- function-word relative frequencies over a **frozen** top-150 list committed as `eval/function-words.json` (choosing N after seeing results is p-hacking)
- sentence length mean, sd, 10th/90th percentile
- punctuation rhythm: commas/semicolons/em-dashes/periods per 100 words; commas per sentence
- type-token ratio via **MTLD**, not raw TTR — raw TTR is length-dependent and the samples differ in length
- Colin markers: misspelling rate /1k (dictionary + `corpus/colin-lexicon.json`), en-dash-as-hyphen /1k, doubled-period /1k, bold-mid-paragraph /1k, sentence-initial-lowercase rate, contraction rate

### `eval/delta.ts`, `eval/splithalf.ts`, `eval/imposters.ts` — the falsifiable claim
- `burrowsDelta(a, b, corpusStats)` — z-score each function-word frequency against corpus mean/sd, mean absolute difference. **Compute on ≥1,000-word aggregates only**; at 400-word essay length Delta is noisy.
- `withinColinBand()` — repeatedly split Colin's baseline (same register) **at the document level**, Delta between halves, 2,000 bootstrap resamples, report 2.5/97.5 percentiles. This is the band.
- **The claim, stated so it can fail:** *Delta(model output ↔ Colin baseline) falls inside the within-Colin split-half 95% band for the same register.* If the point estimate exceeds the upper bound, the model is outside his natural variance and the claim is false. Always report band and observed value together.
- `eval/imposters.ts` — **General Imposters**, which exists precisely for tiny corpora and is the method I'd actually believe here. Sample random function-word subsets; count how often the candidate is nearer Colin than a set of impostor authors. **Use the quarantined `scholarship_essays/` as an impostor set** — that is their perfect use, and it directly tests "is this distinguishable from an LLM conditioned on voice_profile.md". Delta stays the headline because it was asked for; GI is reported alongside.

### Blind discrimination panel
With n≈8 baseline documents you cannot run a powered panel at document granularity. Chunk to 300–500-word passages (n≈30–50 units) but **cluster-bootstrap by source document**.

- `eval/panel-human.ts` — Bun CLI. Shuffled pairs (one Colin passage, one model passage, same register, length-normalized, headers stripped): "which did Colin write?", confidence 1–5, and free-text "what gave it away". Logs to `eval/data/panel-<runId>.jsonl`. **The free-text field is the highest-value output in the entire harness** — it tells you what to fix next.
- `eval/panel-llm.ts` — same pairs judged via `voice/infer.ts`, k=5 samples, majority vote. **The judge prompt must not include `voice_profile.md`**, or it detects the fingerprint it was handed. Report human and LLM rates separately, never averaged; expect the LLM judge to be harsher.
- Statistic: accuracy with cluster-bootstrap 95% CI (resample *documents*). Success = CI contains 0.5. Report per-register.

### Pre-registration — `eval/prereg.ts` + `eval/preregistration.md`
Written **before any results exist**: the frozen function-word list hash, the within-Colin band computed from baseline only, the primary endpoint (human panel accuracy), ordered secondary endpoints, the falsification rules, and a fixed-n stopping rule (no peeking).

Enforcement, not decoration: add event type `eval_preregistered`; `bun eval/prereg.ts --commit` appends `{file, sha256, bands}` to `state/events.jsonl` via `append()` from `state/log.ts`, so the existing hash chain makes post-hoc edits detectable via `verify()`. **`eval/run.ts` refuses to run unless the current file hash matches the logged one.** Add a blocking human checkpoint `EVAL_PREREGISTRATION_REVIEW` so Colin signs the bands before the first run.

### What falsifies and demotes the fine-tune (committed verbatim in the prereg file)
> The fine-tuned arm is demoted to non-default unless it beats the Phase-1 retrieval arm on the primary endpoint — human panel accuracy closer to 0.5, with non-overlapping cluster-bootstrap CIs — **AND** passes the memorization check (max 8-gram overlap with training data < 15 tokens) **AND** its Delta lies inside the within-Colin band on the held-out register. Failing any one of the three, the retrieval arm stays default and the adapter is archived, not deleted. Additionally: if the orthographic-noise layer alone accounts for >50% of the fine-tune's improvement, the fine-tune contributed nothing and is demoted regardless.

```bash
bun eval/run.ts --arms v1,v2,ft --registers academic,narrative --n 40
# → eval/reports/<runId>.md + an eval_run_completed event
```

---

## Phase 4 — Continuous loop

- Add event type `voice_edit_recorded` to `state/log.ts`.
- Route `POST /api/voice/edit` accepting `{ essayId, before, after, register }`: appends the event and writes `{before, after, diff, register, source:"manual", verifiedBy:"colin", timestamp}` to `corpus/data/edits.jsonl`. **A Colin edit is self-verifying authorship** — that's the whole point of the flywheel.
- Honor the `revisions[]` convention already defined in `voice_profile.md`: write `after` into `scholarship_essays/<slug>/metadata.json` with `"by": "colin"`. That flag is currently 0/20; this makes it non-zero, which simultaneously fixes the contamination signal by making `by === "colin"` a *usable* corpus filter.
- `corpus/ingest-edits.ts` folds edits into `verified.jsonl` on the next rebuild — `after` as a positive example, `before` as an implicit negative (useful for preference-style eval, not for SFT).
- **Guard:** edits to held-out-prompt outputs go to a separate file and never enter training, or you leak the test set. Enforced in `corpus/split.ts`.

---

## Phase 5 — Register control (the research edge)

**Mechanism: a measured register contract plus a rejecting validator.** Not a prompt adjective.

1. **`voice/registers.ts`** derives a `RegisterContract` per register **from `corpus/stats.ts`** — target bands (mean ±1 sd) for sentence length mean/sd, sentence-initial-lowercase rate, contraction rate, comma density, MTLD, misspelling rate, en-dash rate, bold rate, first-person density. This file is **generated, not authored** — the entire idea is that the dial is calibrated to measured Colin, not to anyone's intuition about registers.
2. Contract injected into the system prompt as **explicit numeric targets** ("sentences average 19 words, sd 11; about 8% start lowercase; contractions ~2.1 per 100 words"). Numbers steer models far harder than adjectives.
3. **`voice/validate.ts`** scores output against the contract → per-feature z-scores → `registerFit` and `nearestRegister`. If `nearestRegister !== requested` or any feature is >2 sd out, regenerate once naming the violated features; a second failure raises a `VOICE_REGISTER_DRIFT` checkpoint rather than shipping.
4. **`voice/orthography.ts`** — the spelling layer, kept **separate and flag-gated** (`VOICE_ORTHOGRAPHY=on|off`), parameterized by the measured per-register error rate and sampling from an empirical table of *actually observed* errors (`corpus/data/error-table.json`: {correct → Colin's misspelling, count}), never synthetic corruption. **ON in eval, OFF in the shipped `/api/draft` path** — deliberately injecting misspellings into submitted scholarship essays carries a real-world cost the research goal doesn't justify. The toggle also buys a clean ablation: how much of the discrimination rate does spelling alone carry?

### Bleed experiment — `eval/bleed.ts`
Full 3×3 crossed design over `{academic, narrative, raw}`: requested register R × exemplar register E, ~15 generations per cell. Classify each output with a register classifier trained **on Colin's baseline only** (leave-one-document-out multinomial logistic regression over the 9 contract features, ~50 documents — no new deps).

- **Bleed rate** = P(classified E | requested R, exemplars E) for R≠E. Zero bleed means exemplar register has no effect once the contract is enforced.
- **Register separation** = Delta between the model's own `academic` and `raw` outputs vs. Colin's own between-register Delta. If the model's registers sit closer together than Colin's do, the dial is a blend, not a dial.
- **Per-marker leak**: sentence-initial-lowercase rate in requested-`academic` vs Colin's academic baseline; formal-connective rate in requested-`raw` vs his raw baseline.

**Success criteria:** (a) bleed rate ≤10% in every off-diagonal cell; (b) model between-register Delta within the 95% CI of Colin's own between-register Delta — his registers as far apart in the model as in him, no more and no less; (c) no individual marker >1.5 sd from that register's measured baseline; (d) all of the above holding when the exemplar register is **deliberately mismatched**, which is the actual hard case. Report failures per-marker: *"requested academic leaks lowercase sentence starts at 3× baseline"* is actionable; *"register control is imperfect"* is not.

---

## Dependency order

| # | Work | Verdict |
|---|---|---|
| 1 | Quarantine test (`corpus/quarantine.test.ts`) | **required, cheap, do first** — it underwrites every later result |
| 2 | Repo fixes: App.jsx dup, model allowlist, Sharpe conflict, `test` script | required, ~1 hour |
| 3 | Drive manifest + triage checkpoints | required, **human-latency-bound — start day 1** |
| 4 | `corpus/` harvest → clean → register → splits → stats | required; blocks everything |
| 5 | `voice/` infer, spec, exemplars, experiences, build-prompt | required — highest-value deliverable |
| 6 | `eval/` stylometry, delta, splithalf, imposters, prereg | required — the go/no-go gate |
| 7 | `eval/panel-llm.ts` | required — fast iteration |
| 8 | Phase 5 contracts, validator, bleed | required — **the actual novel work** |
| 9 | `eval/panel-human.ts` | required but slow; run once, late |
| 10 | Phase 4 edit loop | do it — ~80 lines, and it makes `by:"colin"` non-zero |
| 11 | `corpus/skeleton.ts` | **partial** — needed for held-out prompt realism; full pairs dataset only if #12 survives |
| 12 | Phase 2 MLX LoRA | **cut unless the gate passes.** At ~10 academic documents, it won't. |

**Cut aggressively:** no embeddings (justified above), no vector store, **no new runtime dependencies at all**. Python enters exactly once, via `uv tool install mlx-lm`, and only if #12 survives its gate.

---

## Build log — what changed against the plan

Recorded during implementation. Where the plan was wrong, the correction and its evidence are here
rather than quietly applied.

**Corpus sizing in this plan was wrong.** The stated "51,788 typed messages / 778K words, avg 15
words" counted jq output LINES, not messages, so multi-line messages were multiply counted and the
15-word average was meaningless. Actual: **3,130 messages / 618,589 words, avg ~198 words**, and
after cleaning **2,296 records / 433,764 words** (raw 348K, narrative 75K, directive 11K). The
corpus is far richer in substantive prose than the plan assumed.

**Finding #3 is confirmed and sharper, but still n=1.** Measured misspelling rates: directive 1.05,
raw 0.87, narrative 0.78, academic **6.60** per 1,000 words. The academic register carries ~7x the
rate of the chat registers — a stronger inversion of the original brief than stated. It rests on one
document until the Drive connector is reconnected.

**Misspelling detection needed two corrections before it measured anything.** Counting
out-of-dictionary tokens reported ~90/1k in every register while flagging "taboost", "repo",
"don't", "reacting" — it measured vocabulary, not spelling. Working definition now: a misspelling is
a NEAR-MISS of a real word (within one edit), excluding proper nouns, tokens short enough that one
edit reaches something by combinatorics, and words recurring across >=3 documents, since nobody
misspells the same word 208 times.

**Burrows's Delta had a degenerate-reference bug.** Building the z-score reference from the two
samples being compared forces |z_a - z_b| = sqrt(2) for every feature; the first bands came out as
[1.414, 1.414] for every register. Delta is defined against a corpus. Real bands: raw [0.087,
0.118] over 258 documents, narrative [0.226, 0.335] over 37.

**The split is incremental, not one-shot.** The plan's freeze would have reshuffled everything when
the academic documents finally land, potentially moving a held-out record into the exemplar pool
after results existed. Assignments now carry through untouched and the script refuses if any
document would change sides.

**The seed generator's own limits contradicted each other.** A 12% fraction cap against a schema
permitting ~125 words rejected every seed on length before a leak check ran. A seed is "a few
sentences" — an absolute size. Rarity was also computed over the filtered subset, where nearly every
word looks rare, so the anchor check fired on ordinary domain nouns. Yield went 0/8 to 6/14.

**wrapUntrusted() was the wrong primitive for exemplars.** Its wording declares the block "scraped
from a third-party website" and instructs the model to distrust it — actively counterproductive when
the text is Colin's own prose and the task is to imitate it. `defang()` is now exported and used
with imitate-the-style-not-the-content framing.

**The Sharpe conflict resolved to 1.25**, confirmed against `~/quant/NEXT.md:1251` (a 2026-06-07
re-measure from 1.08). `profile.js` and `timeline.js` were stale; the essays were right.

**Blocked, and only Colin can unblock it:** the Google Drive connector's OAuth token expired
mid-session. One academic document is on disk; thirteen are not. Every academic-register and
persuasive-register claim is unavailable until it is reconnected and authorship is triaged.

**Not built, by design:** Phase 2 (MLX LoRA). Its gate requires >=12 verified academic documents and
>=800 training pairs. At one document, LoRA would learn a subject, not a voice.

## Verification

Each phase has a runnable pass/fail signal — no phase is "done" on inspection.

**Phase 0.** `bun test corpus/` green, including the contamination test that fails on ≥8-gram overlap with `scholarship_essays/`. Then `bun corpus/stats.ts` prints per-register word counts and marker rates — **manually confirm the academic misspelling rate across ≥5 verified docs before Phase 1 encodes finding #3.** Confirm `corpus/data/splits.json` is hashed into `state/events.jsonl` and that `bun state/verify.ts` (existing chain check) passes.

**Phase 1.** `bun test voice/` green, including the cross-register and prompt-boundary contamination assertions. Then generate the same essay under both arms and diff them by hand:
```bash
VOICE_PROMPT=v1 bun run server.ts &  # control
curl -H "Authorization: Bearer $APP_TOKEN" -X POST localhost:3000/api/draft -d '{...}'
VOICE_PROMPT=v2 ...                  # conditioned arm
```
The v2 output must visibly carry doctrine features (five-beat arc, credentials withheld to para 4, one load-bearing analogy) that v1 lacks. Confirm `src/App.jsx` no longer contains `buildPrompt` and the browser bundle no longer ships the profile blob.

**Phase 3.** `bun eval/prereg.ts --commit`, then confirm `bun eval/run.ts` **refuses** to run after any edit to `eval/preregistration.md` — that refusal is the pre-registration; test it deliberately by touching the file. Then `bun eval/run.ts --arms v1,v2 --registers academic,narrative --n 40` produces `eval/reports/<runId>.md` carrying, per register: panel accuracy with cluster-bootstrap CI, Delta with the within-Colin band, and the GI score. **The result is honest whichever way it lands** — a v2 arm that fails to reach the band is a finding, not a failure, provided the band was committed first.

**Phase 5.** `bun eval/bleed.ts` produces the 3×3 matrix. Success is the four criteria above, reported per-marker. Expect (d) — deliberately mismatched exemplars — to be where it breaks first.

**Full gate before anything is called finished:** `bun test` green, `bun run lint` clean, `bun state/verify.ts` chain intact.
