# Colin-AI — the personal voice model

A system that reconstructs Colin's written voice well enough that blind raters and stylometric
tests cannot reliably separate its output from his hand-written baseline, on prompts it has never
seen — and, critically, a harness that can prove it did **not**.

Plan: `Plans/colin-ai-personal-voice-model-virtual-sutherland.md`.
Bands and falsification rules: `eval/preregistration.md` (hash-committed; `eval/run.ts` refuses to
run if it changes).

---

## The claim, stated so it can fail

> Delta(model output ↔ Colin baseline) falls inside the within-Colin split-half 95% band for the
> same register, and blind-panel accuracy has a 95% CI containing 0.50.

A raw Delta means nothing alone. What makes this falsifiable is the **band**: how far Colin sits
from *himself* when his own baseline is split in half. Land outside it and the claim is false for
that register, and gets reported as false.

---

## Running it

```bash
# Phase 0 — corpus
bun corpus/harvest-claude.ts        # Colin-typed turns from ~2,600 transcripts
bun corpus/build.ts --verbose       # strip pasted code/output, dedupe, tag register
bun corpus/vocabulary.ts            # his habitual out-of-dictionary words
bun corpus/stats.ts --json          # per-register measurements -> register contracts
bun corpus/split.ts --freeze        # freeze splits (incremental, hash-chained)
bun corpus/error-table.ts           # what he actually mistypes

# Google Docs (academic register) — needs the Drive connector
#   ask Claude: "pull the docs in corpus/drive-manifest.json to corpus/data/gdocs/"
bun corpus/harvest-drive.ts
bun corpus/triage.ts --raise        # one authorship checkpoint per document
bun corpus/triage.ts --apply        # after Colin answers

# Phase 1 — the conditioned prompt (already wired into the server)
VOICE_PROMPT=v2 bun run server.ts   # v1 keeps the original prompt as the control

# Phase 3 — evaluation
bun corpus/skeleton.ts --split=holdout --register=narrative --limit=20
bun eval/prereg.ts --write && bun eval/prereg.ts --commit
bun eval/run.ts --arms=v1,v2 --registers=narrative --n=20
bun eval/panel-human.ts --run=<runId> --arm=v2     # the primary endpoint; run once, late

# Phase 5 — register control
bun eval/bleed.ts --registers=narrative,raw --n=6
```

---

## The parts that exist to stop us fooling ourselves

**Contamination is refused structurally, not by convention.** The 20 essays in
`scholarship_essays/` are LLM output conditioned on `voice_profile.md` — two `"by": "draft"`
revisions each, zero `"by": "colin"`. Any text sharing an 8-gram with them is refused wherever it
enters, because contamination arrives sideways: via an Obsidian copy, a pasted draft in a chat log,
a quoted paragraph. The guard caught 4 real cases on its first run. `corpus/quarantine.test.ts`
fails the suite on violation.

**Authorship is a blocking human checkpoint.** No classifier can tell whether Colin pasted his own
text or an LLM's — the features that would give it away are exactly what a voice-conditioned model
reproduces. Only he knows. `CORPUS_AUTHORSHIP_UNVERIFIED` gates every Google Doc, and `unsure` stays
quarantined: an uncertain yes is a no.

**The preregistration refuses.** `eval/run.ts` will not start if `eval/preregistration.md` or the
frozen function-word list has changed since its hash was chained into `state/events.jsonl`.
Verified by tampering — appending one comment line produces `REFUSING TO RUN`.

**The split is frozen and incremental.** By document, never by passage. New documents are placed
without disturbing existing assignments, so the academic register can join later without a reshuffle
moving a held-out record into the exemplar pool after results exist.

**The flywheel cannot leak the test set.** Edits to output from held-out prompts go to a separate
file nothing trains on.

---

## Findings so far

**The academic register carries ~7× the misspelling rate of the chat registers.**

| register | misspellings /1k | documents |
|---|---|---|
| directive | 1.05 | 243 |
| raw | 0.87 | 1,927 |
| narrative | 0.78 | 126 |
| **academic** | **6.60** | **1** |

This inverts the original assumption that natural spellings live in raw writing and vanish from
polished work. A submitted philosophy paper misspells its own subject in the title
("Euthinasia"), alongside "totaly", "diffrently" and "moral bounty" for "boundary" twice.
**n=1 until the Drive connector is reconnected.** It is a hypothesis, not a result.

**Within-Colin bands** (the yardstick everything is measured against):

| register | documents | band |
|---|---|---|
| raw | 258 | [0.087, 0.118] |
| narrative | 37 | [0.226, 0.335] |
| directive / academic / persuasive | <6 | no band — cannot falsify anything |

**The register validator already discriminates.** The euthanasia essay checked against the
*narrative* contract fails on exactly the two markers that mark academic register: misspelling rate
(z=2.85) and doubled periods (z=34.3).

---

## First results — four runs, narrative register

Reports in `eval/reports/`. n=4–6 held-out prompts per run; k=5 (preregistered) on the first, k=3
on the rest.

### The panel is pure noise at this n — do not quote it

| run | v1 accuracy | v2 accuracy |
|---|---|---|
| n=6, k=5 | 0.333 | 0.200 |
| n=6, k=3 | 0.500 | 0.500 |
| n=4, k=3 | 1.000 | 0.750 |

**The same arm scores anywhere from 0.333 to 1.000 across runs.** Every CI spans essentially the
whole interval, so the harness dutifully labels each one "indistinguishable" — an interval
containing everything contains 0.50 by default. That label is meaningless here. No conclusion about
the primary endpoint is available until n is large enough to separate signal from sampling noise,
which is exactly why the preregistration fixes n in advance.

A single run of this would have looked like a result. Four make it obvious it is not.

### Delta is stable across runs, and says something reproducible

| arm | Delta across runs | band |
|---|---|---|
| v1 — original 6-line prompt | 0.747, 0.779, 0.920 | [0.226, 0.335] |
| v2 — voice-conditioned | 0.951, 0.969, 0.971 | [0.226, 0.335] |

**Both arms are far outside Colin's own variance, and v2 is consistently WORSE than v1** — three
independent runs, no overlap between the two arms' ranges. The voice conditioning moves output
*further* from his function-word distribution, not closer. Delta is far more stable than the panel
here, so this is the finding worth acting on.

That is not the expected direction, and there are two candidate explanations worth separating before
anything is concluded:

1. The "narrative" baseline is technical chat (see limitations), while both arms produce polished
   prose. Both may be measured against the wrong target, with v2's heavier conditioning pushing it
   further toward essay prose and therefore further from chat.
2. The conditioning genuinely over-steers. The bleed experiment supports this: the model's registers
   come out nearly five times further apart than Colin's own.

### Corroborating signals

- **Register contract compliance is ~20%** (1/5 and 1/4, with a retry on nearly every generation),
  measured independently of the bleed run, which found the same thing from a different direction.
- **General Imposters: v1 1.000, v2 0.927–0.980.** Output is nearer Colin than the 20 LLM-generated
  essays — but Delta says it is still far outside his variance. Both true, and not a contradiction:
  more Colin-like than a polished LLM essay, still not Colin.

## Register control — the first real Phase 5 result

`eval/reports/bleed_2026-09-11T18-42-14-665Z.md`, 2×2 crossed design, n=2 per cell.

| requested | exemplars | holds requested | bleeds to exemplar |
|---|---|---|---|
| narrative | narrative | 0% | 0% |
| narrative | **raw** | 50% | **50% — FAIL** |
| raw | narrative | 100% | 0% |
| raw | raw | 100% | 0% |

**Register control fails in the direction the experiment was built to catch.** Ask for narrative
while supplying raw exemplars and half the output reads as raw: the exemplars are driving the
register, which is what "a blend wearing a dial's label" looks like. The asymmetry is informative —
`raw` holds under mismatch, `narrative` does not. And the diagonal cell is worse than the
off-diagonal: requested-narrative with *matching* exemplars held 0% of the time, so the system
cannot reliably produce narrative register at all. That matches the 1/4 contract pass rate in the
main run, from a completely separate measurement.

**Separation is a caricature, not a blend.** Colin's own narrative↔raw distance is 0.220; the
model's is 1.027 — nearly five times too far apart. The registers are not collapsing together; they
are being over-played. That is the opposite of the failure mode anticipated in the plan, and it
suggests the numeric contracts are being followed too literally.

**Named per-marker leaks**, which is what makes this actionable:

- requested `narrative`: `contractionRate` 2.84–2.96 against a 1.00 baseline (z≈1.9)
- requested `raw`: `commaRate` 9.49 against a 3.65 baseline (z=1.61)

n=2 per cell is small; the direction is clear, the magnitudes are not yet trustworthy.

## Known limitations, recorded rather than discovered later

- **The academic register is blocked.** The Google Drive connector's token expired mid-session; one
  document is on disk, thirteen are not. Every academic claim is unavailable until it is
  reconnected and Colin triages authorship.
- **"Narrative" is not literary narrative.** The tagger assigns it to long first-person-past
  transcript messages, which are mostly technical chat. Conclusions about that register describe
  how Colin writes to a terminal, not how he writes an essay.
- **The corpus is dominated by chat.** Findings about `raw` are far better supported than findings
  about anything he writes deliberately.
- **Delta is computed on ≥1,000-word aggregates** and is noisy at essay length, which is why
  General Imposters is reported beside it.
- **The fine-tune is not built, by design.** Its gate requires ≥12 verified academic documents; at
  the current count LoRA would learn "euthanasia and species concepts", not a voice. See Phase 2 in
  the plan.

---

## Layout

| path | what it holds |
|---|---|
| `corpus/` | harvest, clean, register-tag, split, triage, stats, error table, seed generation |
| `voice/` | spec loader, exemplars, retrieval, prompt builder, register contracts, orthography, edit loop |
| `eval/` | stylometry, Delta + bands + General Imposters, panels, preregistration, run, bleed |
| `corpus/data/` | gitignored — PII-dense |
| `eval/preregistration.md` | the committed bands. Do not edit; the runner checks its hash |
