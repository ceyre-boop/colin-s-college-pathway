# Colin-AI — preregistration

Written before any model output exists. Its sha256 is committed to `state/events.jsonl`
as an `eval_preregistered` event; `eval/run.ts` refuses to run if this file changes.

- Drafted: 2026-09-10T18:51:20.939Z
- Function-word list sha256: `a13d406a6e88c4eee2b21180597d6c8a5f4f9b8a2aacd7e869671058621ac6fb` (150 words, frozen)

## Primary endpoint

Human blind-panel accuracy at telling Colin's writing from the system's, per register.
Random is 0.50. **Success = the cluster-bootstrap 95% CI contains 0.50.** Passages are
300-500 words; the bootstrap resamples SOURCE DOCUMENTS, not passages, because passages
from one document are not independent.

## Secondary endpoints, in order

1. Burrows's Delta against the within-Colin split-half band (below).
2. General Imposters score, using the 20 LLM-generated essays in `scholarship_essays/`
   as the impostor set — this directly tests whether output is distinguishable from an
   LLM conditioned on `voice_profile.md`.
3. LLM-judge panel accuracy. Reported separately from the human panel and never averaged
   with it; the judge prompt must not contain `voice_profile.md`, or it detects the
   fingerprint it was handed.
4. Register bleed rate (Phase 5), per off-diagonal cell.

## Within-Colin bands (computed from baseline only)

| register | documents | band low | median | band high | usable |
|---|---|---|---|---|---|
| directive | 4 | — | — | — | no — needs ≥6 |
| raw | 258 | 0.087 | 0.100 | 0.118 | yes |
| narrative | 37 | 0.226 | 0.269 | 0.335 | yes |
| academic | 0 | — | — | — | no — needs ≥6 |
| persuasive | 0 | — | — | — | no — needs ≥6 |

A register marked "no" cannot falsify anything. Claims about it are unavailable, and
saying so is the honest result rather than a gap to be filled in later.

## Falsification rules

**The voice claim, per register.** Delta(system output ↔ Colin baseline) falls inside the
within-Colin 95% band above. If the point estimate exceeds the band's upper bound, the
claim is FALSE for that register and will be reported as false.

**The conditioning claim.** Arm v2 (voice-conditioned) beats arm v1 (the original
six-line prompt) on the primary endpoint — panel accuracy closer to 0.50 — with
non-overlapping cluster-bootstrap CIs. Overlapping CIs mean the conditioning did not
demonstrably help, whatever the point estimates look like.

**The fine-tune, if it is ever built.** Demoted to non-default unless ALL THREE hold:
(a) it beats arm v2 on the primary endpoint with non-overlapping CIs; (b) it passes the
memorization check — max 8-gram overlap with training data under 15 consecutive tokens;
(c) its Delta lies inside the within-Colin band on a held-out register. Failing any one,
the retrieval arm stays default and the adapter is archived, not deleted.
Additionally: if the orthographic-noise layer alone accounts for more than 50% of the
fine-tune's improvement, the fine-tune contributed nothing and is demoted regardless.

**Register control (Phase 5).** Success requires all of: bleed rate ≤10% in every
off-diagonal cell; model between-register Delta inside the 95% CI of Colin's own
between-register Delta; no single marker more than 1.5 sd from that register's measured
baseline; and all of the above holding when the exemplar register is deliberately
mismatched, which is the actual hard case.

## Stopping rule

n is fixed in advance per run and stated on the command line. No peeking, no adding
passages after seeing the rate, no dropping a register because its number came out badly.
A register that fails is a finding and gets reported as one.

## Known limitations, recorded now rather than discovered later

- The academic register rests on very few documents. Whatever it reports, it reports weakly.
- The misspelling-rate finding (academic ≈ 6.6/1k vs ≈ 0.9/1k in chat registers) currently
  rests on ONE document. It is a hypothesis here, not a result.
- Delta is computed on ≥1,000-word aggregates. At 400-word essay length it is noisy, which
  is why General Imposters is reported alongside it.
- The corpus is dominated by chat-register text. Conclusions about raw register are much
  better supported than conclusions about anything Colin writes deliberately.
