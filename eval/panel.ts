// The blind discrimination panel.
//
// The primary endpoint of the whole project: shown one passage Colin wrote and one the system
// wrote, can a rater tell which is which? Random is 0.50; success is a confidence interval that
// CONTAINS 0.50, not one that beats it.
//
// THREE THINGS THAT WOULD QUIETLY INVALIDATE THIS, and what is done about each:
//
//   Length and formatting tells. A 430-word polished block against a 90-word fragment is separable
//   without reading a word. Passages are trimmed to a comparable band and stripped of headings.
//
//   Non-independent passages. Several passages from one document share its topic and its author's
//   afternoon. Accuracy is therefore reported with a CLUSTER bootstrap that resamples source
//   documents, never passages — treating passages as independent would shrink the CI and
//   manufacture significance.
//
//   A judge that was handed the answer. The LLM judge must never see voice_profile.md, or it
//   detects the fingerprint it was told to look for. Human and LLM rates are reported separately
//   and never averaged; they measure different things and the LLM judge is reliably harsher.

import { infer } from "../voice/infer.ts";
import { mulberry32, percentile } from "./delta.ts";
import type { Register } from "../corpus/schema.ts";

export interface Passage {
  text: string;
  /** The document this came from — the cluster unit for the bootstrap. */
  documentId: string;
  register: Register;
}

export interface Pair {
  id: string;
  register: Register;
  /** Which side Colin's passage is on. Hidden from the rater. */
  colinSide: "A" | "B";
  a: string;
  b: string;
  colinDocumentId: string;
  modelDocumentId: string;
}

export interface Judgement {
  pairId: string;
  register: Register;
  /** Which side the rater picked as Colin's. */
  guess: "A" | "B";
  correct: boolean;
  confidence?: number;
  /** Free text: what gave it away. The highest-value field in the harness. */
  tell?: string;
  colinDocumentId: string;
}

/** Strip cues that identify a side without anyone reading the prose. */
export function normalizePassage(text: string, targetWords: number): string {
  const stripped = text
    .replace(/^#{1,6}\s+.*$/gm, "")       // headings
    .replace(/^\s*[-*]\s+/gm, "")          // list bullets
    .replace(/\*\*/g, "")                  // bold markers (a formatting tell, not a voice tell)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const words = stripped.match(/\S+/g) || [];
  if (words.length <= targetWords) return stripped;
  // Trim to the last sentence boundary at or before the target, so no side ends mid-clause.
  const cut = words.slice(0, targetWords).join(" ");
  const lastStop = Math.max(cut.lastIndexOf("."), cut.lastIndexOf("!"), cut.lastIndexOf("?"));
  return lastStop > cut.length * 0.5 ? cut.slice(0, lastStop + 1) : cut;
}

export const MIN_PASSAGE_WORDS = 120;
export const TARGET_PASSAGE_WORDS = 400;

export interface BuildPairsOpts {
  colin: Passage[];
  model: Passage[];
  seed?: number;
  targetWords?: number;
}

/** Pair each model passage with a Colin passage of the same register, sides randomised. */
export function buildPairs(opts: BuildPairsOpts): Pair[] {
  const rand = mulberry32(opts.seed ?? 11);
  const target = opts.targetWords ?? TARGET_PASSAGE_WORDS;
  const pairs: Pair[] = [];

  const byRegister = new Map<Register, Passage[]>();
  for (const p of opts.colin) {
    if (!byRegister.has(p.register)) byRegister.set(p.register, []);
    byRegister.get(p.register)!.push(p);
  }

  for (const [i, m] of opts.model.entries()) {
    const pool = byRegister.get(m.register) ?? [];
    if (!pool.length) continue;
    const c = pool[Math.floor(rand() * pool.length)];

    const colinText = normalizePassage(c.text, target);
    const modelText = normalizePassage(m.text, target);
    if ((colinText.match(/\S+/g) || []).length < MIN_PASSAGE_WORDS) continue;
    if ((modelText.match(/\S+/g) || []).length < MIN_PASSAGE_WORDS) continue;

    const colinSide: "A" | "B" = rand() < 0.5 ? "A" : "B";
    pairs.push({
      id: `pair_${i}`,
      register: m.register,
      colinSide,
      a: colinSide === "A" ? colinText : modelText,
      b: colinSide === "A" ? modelText : colinText,
      colinDocumentId: c.documentId,
      modelDocumentId: m.documentId,
    });
  }
  return pairs;
}

// ---- LLM judge -------------------------------------------------------------

const JUDGE_SYSTEM = `You are shown two passages. Exactly one was written by a specific human being;
the other was produced by a language model imitating that person. Decide which is the human's.

You have NOT been told anything about how that person writes, and you must not be told — judge only
from the text. Weigh the things that are hard to fake: inconsistency, uneven sentence rhythm, an
idea that arrives slightly out of order, a small error nobody would insert on purpose.

Answer with JSON only: {"human":"A"|"B","confidence":1-5,"tell":"<12 words on what decided it>"}`;

export async function judgeLlm(pair: Pair, k = 5): Promise<Judgement> {
  const user = `Passage A:\n${pair.a}\n\n---\n\nPassage B:\n${pair.b}\n\nWhich is the human's?`;
  const votes: ("A" | "B")[] = [];
  const tells: string[] = [];
  let confSum = 0;

  for (let i = 0; i < k; i++) {
    try {
      const res = await infer({ system: JUDGE_SYSTEM, user, maxTokens: 200, level: "fast", temperature: 1 });
      const m = /\{[\s\S]*\}/.exec(res.text);
      if (!m) continue;
      const p = JSON.parse(m[0]) as { human?: string; confidence?: number; tell?: string };
      if (p.human === "A" || p.human === "B") {
        votes.push(p.human);
        confSum += Number(p.confidence ?? 3);
        if (p.tell) tells.push(String(p.tell));
      }
    } catch {
      /* a failed sample is a missing vote, not a wrong one */
    }
  }

  const a = votes.filter((v) => v === "A").length;
  const guess: "A" | "B" = a >= votes.length - a ? "A" : "B";
  return {
    pairId: pair.id,
    register: pair.register,
    guess,
    correct: guess === pair.colinSide,
    confidence: votes.length ? confSum / votes.length : undefined,
    tell: tells[0],
    colinDocumentId: pair.colinDocumentId,
  };
}

// ---- scoring ---------------------------------------------------------------

export interface Accuracy {
  n: number;
  accuracy: number;
  /** Cluster-bootstrap 95% CI, resampling source documents. */
  ciLow: number;
  ciHigh: number;
  /** Success: the CI contains 0.50, i.e. raters cannot reliably separate them. */
  indistinguishable: boolean;
  clusters: number;
}

/**
 * Accuracy with a CLUSTER bootstrap over source documents.
 * Resampling individual passages would treat several passages from one essay as independent
 * evidence, shrinking the interval and inventing significance that the data does not contain.
 */
export function accuracy(judgements: Judgement[], opts: { iterations?: number; seed?: number } = {}): Accuracy {
  const n = judgements.length;
  if (!n) return { n: 0, accuracy: Number.NaN, ciLow: Number.NaN, ciHigh: Number.NaN, indistinguishable: false, clusters: 0 };

  const byDoc = new Map<string, Judgement[]>();
  for (const j of judgements) {
    if (!byDoc.has(j.colinDocumentId)) byDoc.set(j.colinDocumentId, []);
    byDoc.get(j.colinDocumentId)!.push(j);
  }
  const clusters = [...byDoc.values()];

  const point = judgements.filter((j) => j.correct).length / n;
  const rand = mulberry32(opts.seed ?? 3);
  const iterations = opts.iterations ?? 2000;
  const samples: number[] = [];

  for (let it = 0; it < iterations; it++) {
    let correct = 0;
    let total = 0;
    for (let c = 0; c < clusters.length; c++) {
      const pick = clusters[Math.floor(rand() * clusters.length)];
      for (const j of pick) {
        total++;
        if (j.correct) correct++;
      }
    }
    if (total) samples.push(correct / total);
  }

  const ciLow = percentile(samples, 0.025);
  const ciHigh = percentile(samples, 0.975);
  return {
    n,
    accuracy: point,
    ciLow,
    ciHigh,
    indistinguishable: ciLow <= 0.5 && ciHigh >= 0.5,
    clusters: clusters.length,
  };
}

export function byRegister(judgements: Judgement[]): Record<string, Accuracy> {
  const out: Record<string, Accuracy> = {};
  const regs = new Set(judgements.map((j) => j.register));
  for (const r of regs) out[r] = accuracy(judgements.filter((j) => j.register === r));
  return out;
}
