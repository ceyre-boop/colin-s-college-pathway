// Produce model output on held-out prompts, under a named arm.
//
// The held-out prompts are the seeds of held-out DOCUMENTS: the model answers the same brief Colin
// answered, so the panel compares like with like. Nothing from the holdout split may appear as an
// exemplar, and eval/run.ts asserts that before generating.

import { infer } from "../voice/infer.ts";
import { buildVoicePrompt, buildLegacyPrompt } from "../voice/build-prompt.ts";
import { contractFor, validate, retryGuidance, type Validation } from "../voice/registers.ts";
import { applyOrthography, orthographyEnabled } from "../voice/orthography.ts";
import type { Pair as SeedPair } from "../corpus/skeleton.ts";
import type { Register } from "../corpus/schema.ts";

export type Arm = "v1" | "v2";

export interface Generation {
  sourceId: string;
  register: Register;
  arm: Arm;
  text: string;
  words: number;
  /** Register verdict, or null for arm v1 which has no contract. */
  validation: Validation | null;
  /** Whether a contract violation triggered the single retry. */
  retried: boolean;
  orthographyApplied: boolean;
}

export interface GenerateOpts {
  arm: Arm;
  /** Apply the measured orthographic noise. ON in eval, OFF in the shipped draft path. */
  orthography?: boolean;
  /** Override the exemplar register, for the Phase 5 bleed experiment. */
  exemplarRegister?: Register;
  temperature?: number;
}

function renderSeed(p: SeedPair): string {
  const s = p.seed;
  return [
    s.assignmentPrompt,
    s.thesisAbstract ? `Position to argue: ${s.thesisAbstract}` : "",
    s.moves.length ? `Moves to make, in order:\n${s.moves.map((m) => `  - ${m}`).join("\n")}` : "",
    s.concreteAnchorLabel ? `Anchor it in ${s.concreteAnchorLabel} of your own choosing.` : "",
    s.sourcesReferenced.length ? `Engage with: ${s.sourcesReferenced.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function generateOne(pair: SeedPair, opts: GenerateOpts): Promise<Generation> {
  const register = pair.register;
  const seed = renderSeed(pair);
  const targetWords = pair.seed.targetWords;
  const scholarship = { name: pair.seed.assignmentPrompt.slice(0, 80), notes: "" };

  let text: string;
  let validation: Validation | null = null;
  let retried = false;

  if (opts.arm === "v1") {
    const user = buildLegacyPrompt(scholarship, "(no profile — control arm)", seed);
    const res = await infer({ user, maxTokens: 2000, level: "standard", temperature: opts.temperature ?? 1 });
    text = res.text;
  } else {
    const { selectExemplars } = await import("../voice/exemplars.ts");
    const exemplars = await selectExemplars({
      // The bleed experiment deliberately mismatches these — that is the hard case.
      register: opts.exemplarRegister ?? register,
      seed,
      n: 3,
    });
    const built = await buildVoicePrompt({
      scholarship, seed, register, targetWords, contract: contractFor(register), exemplars,
    });
    const res = await infer({ system: built.system, user: built.user, maxTokens: 2000, level: "standard", temperature: opts.temperature ?? 1 });
    text = res.text;

    // One retry, naming the violated features. A second failure is reported, never hidden: the
    // failures are the Phase 5 finding.
    validation = validate(text, register);
    if (!validation.ok && contractFor(register)) {
      retried = true;
      const retry = await infer({
        system: built.system,
        user: `${built.user}\n\n# Previous attempt missed its register contract\n${retryGuidance(validation)}`,
        maxTokens: 2000, level: "standard", temperature: opts.temperature ?? 1,
      });
      if (retry.text.trim()) {
        text = retry.text;
        validation = validate(text, register);
      }
    }
  }

  const useOrth = opts.orthography ?? orthographyEnabled();
  if (useOrth) text = applyOrthography(text, register);

  return {
    sourceId: pair.sourceId,
    register,
    arm: opts.arm,
    text: text.trim(),
    words: (text.match(/\S+/g) || []).length,
    validation,
    retried,
    orthographyApplied: useOrth,
  };
}

export async function generateAll(pairs: SeedPair[], opts: GenerateOpts): Promise<Generation[]> {
  const out: Generation[] = [];
  for (const [i, p] of pairs.entries()) {
    try {
      out.push(await generateOne(p, opts));
    } catch (e) {
      console.error(`  generation failed for ${p.sourceId}: ${e instanceof Error ? e.message : e}`);
    }
    if ((i + 1) % 5 === 0) console.log(`  generated ${i + 1}/${pairs.length} (${opts.arm})`);
  }
  return out;
}
