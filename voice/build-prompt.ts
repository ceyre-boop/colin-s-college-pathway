// Compose the generation prompt.
//
// What this replaces: a six-line user message whose entire voice guidance was "Voice: direct,
// concrete, a little wry", with no system prompt, no exemplars, no retrieval, and no awareness that
// scholarship_essays/voice_profile.md existed.
//
// Composition order is deliberate. Identity and register contract go in the system message, where
// they are least likely to be overridden by anything in the task. Within the user message,
// constraints sit LAST — closest to generation — because the instruction nearest the end of a long
// prompt is the one most reliably obeyed.
//
// The old prompt stays available as arm v1. Both arms must be runnable from one flag or Phase 3 has
// no control to compare against, and a conditioning result with no control is not a result.

import { voiceSpecBlock } from "./spec.ts";
import { retrieve, renderExperiences } from "./experiences.ts";
import { selectExemplars, renderExemplars, suspiciousExemplars, type Exemplar } from "./exemplars.ts";
import type { Register } from "../corpus/schema.ts";
import type { RegisterContract } from "./registers.ts";
import { renderContract } from "./registers.ts";

export interface Scholarship {
  id?: string;
  name: string;
  amount?: number | string;
  priority?: string;
  notes?: string;
}

export interface BuildInput {
  scholarship: Scholarship;
  /** The prompt / assignment / seed the piece answers. */
  seed: string;
  register: Register;
  targetWords?: number;
  /** Extra context supplied for this specific essay. */
  context?: string;
  /** Measured register contract. Omitted when the register is underpowered. */
  contract?: RegisterContract | null;
  /** Injectable for tests. */
  exemplars?: Exemplar[];
  usage?: Map<string, number>;
}

export interface BuiltPrompt {
  system: string;
  user: string;
  /** Everything that went in, so a run can be reproduced and audited. */
  provenance: {
    register: Register;
    exemplarIds: string[];
    experienceIds: string[];
    hasContract: boolean;
    suspicious: { id: string; reasons: string[] }[];
    targetWords: number;
  };
}

export const DEFAULT_TARGET_WORDS = 450;

export async function buildVoicePrompt(input: BuildInput): Promise<BuiltPrompt> {
  const targetWords = input.targetWords ?? DEFAULT_TARGET_WORDS;
  const { scholarship: s, seed, register } = input;

  const promptText = [s.name, s.notes, seed, input.context].filter(Boolean).join(" ");
  const retrieved = retrieve({ prompt: promptText, n: 4, usage: input.usage });
  const exemplars = input.exemplars ?? (await selectExemplars({ register, seed: promptText, n: 3 }));

  const system = [
    "You are writing as Colin Eyre — not about him, as him. Everything below describes how he",
    "actually writes; reproduce it rather than improving on it.",
    "",
    input.contract ? renderContract(input.contract) : "",
    "",
    voiceSpecBlock(register),
  ]
    .filter((x) => x !== "")
    .join("\n");

  const amount = s.amount ? ` ($${Number(s.amount).toLocaleString()})` : "";
  const exemplarBlock = renderExemplars(exemplars);

  const user = [
    renderExperiences(retrieved),
    "",
    exemplarBlock,
    exemplarBlock ? "" : null,
    `# The task`,
    `Write a scholarship application essay for "${s.name}"${amount}.`,
    s.notes ? `What it rewards: ${s.notes}` : null,
    seed ? `Prompt: ${seed}` : null,
    input.context ? `Extra context for this essay:\n${input.context}` : null,
    "",
    // Constraints last: nearest the generation point is where they hold.
    `# Constraints`,
    `- Target length: ${targetWords} words. Do not pad to reach it.`,
    `- Register: ${register}. Hold it; do not drift toward another one.`,
    `- Ground every factual claim in the facts above. Invent nothing — no mentors, quotes, or hardships.`,
    `- Return only the essay text. No preamble, no title, no commentary.`,
  ]
    .filter((x) => x !== null)
    .join("\n");

  return {
    system,
    user,
    provenance: {
      register,
      exemplarIds: exemplars.map((e) => e.id),
      experienceIds: retrieved.experiences.map((e) => e.id),
      hasContract: Boolean(input.contract),
      suspicious: suspiciousExemplars(exemplars),
      targetWords,
    },
  };
}

// ---- arm v1 ----------------------------------------------------------------

// Re-exported, never redefined. The legacy prompt has exactly one definition, in
// src/lib/legacyPrompt.js, because both the Bun server and the browser bundle need it and two
// copies of a control arm drift apart without anyone noticing.
export { buildLegacyPrompt } from "../src/lib/legacyPrompt.js";
