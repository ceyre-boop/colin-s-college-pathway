#!/usr/bin/env bun
// Backwards-generate a seed from a finished piece: (seed -> piece) pairs.
//
// The transform this project cares about is "a few sentences -> a full piece", and evaluating it
// needs examples of exactly that transform. Those do not exist naturally: Colin has finished pieces,
// not the skeletons they grew from. So the skeletons are reconstructed by stripping each piece back
// to its argument.
//
// THE WHOLE DIFFICULTY IS LEAKAGE. A seed that carries the piece's own phrasing turns the eval into
// a copying test the model cannot fail, and the failure is invisible — the output looks great. The
// model generating the skeleton will leak if left to its own judgment, so the leak checks run in
// CODE and the model gets exactly one retry with the violated constraint named.
//
// The subtlest leak is the concrete anchor. "Water freezing in a refrigerator" is the analogy that
// carries a whole paragraph of the euthanasia essay; a skeleton naming it hands over the essay's
// best idea. So the schema asks for the LABEL of the anchor ("an everyday physical analogy"), never
// the anchor, and a check rejects any rare noun that sneaks in.

import { infer } from "../voice/infer.ts";
import { raise } from "../state/queue.js";
import { PATHS, readJsonl, writeJsonl, type CorpusRecord, type Register } from "./schema.ts";

export interface SeedSkeleton {
  register: Register;
  targetWords: number;
  /** As a teacher would set it. <=35 words. */
  assignmentPrompt: string;
  /** <=25 words, and none of the piece's phrasing. */
  thesisAbstract: string;
  /** <=6 rhetorical moves, <=10 words each. */
  moves: string[];
  /** The LABEL of the concrete anchor, never the anchor itself. */
  concreteAnchorLabel: string;
  sourcesReferenced: string[];
}

export interface Pair {
  seed: SeedSkeleton;
  target: string;
  sourceId: string;
  register: Register;
  split: CorpusRecord["split"];
}

const SYSTEM = `You reduce a finished piece of writing to the brief it could have been written from.
You are building an evaluation set, so the brief must NOT let anyone reconstruct the original's
wording. Return ONLY a JSON object, no prose, no code fence.`;

function userPrompt(text: string, register: Register, targetWords: number): string {
  return `Reduce the piece below to its brief.

Return exactly this JSON shape:
{
  "assignmentPrompt": "<=35 words, phrased as a teacher setting the task",
  "thesisAbstract": "<=25 words stating the position, in YOUR words not the author's",
  "moves": ["<=6 items, <=10 words each, e.g. 'concede the opposing view, then dismantle it'"],
  "concreteAnchorLabel": "a GENERIC label for the piece's central concrete image, e.g. 'an everyday physical analogy' or 'a workplace anecdote'. NEVER name the actual image, object, or subject.",
  "sourcesReferenced": ["author names or works cited, if any"]
}

Hard rules:
- Reuse NO distinctive phrase from the piece. Not four words in a row.
- Do not name the piece's concrete image, metaphor, or analogy. Label its TYPE only.
- Describe the shape of the argument, never its sentences.

Register: ${register}. Target length: ${targetWords} words.

---PIECE---
${text}
---END PIECE---`;
}

// ---- leak checks (code, not judgment) --------------------------------------

function norm(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9']+/g) || []);
}

function ngramSet(tokens: string[], n: number): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + n <= tokens.length; i++) out.add(tokens.slice(i, i + n).join(" "));
  return out;
}

export const LEAK_NGRAM = 4;
export const MAX_SEED_FRACTION = 0.12;
export const MAX_SENTENCE_OVERLAP = 0.4;

export function seedText(s: SeedSkeleton): string {
  return [s.assignmentPrompt, s.thesisAbstract, ...s.moves, s.concreteAnchorLabel].join(" ");
}

export interface LeakCheck {
  ok: boolean;
  violation?: string;
}

/**
 * @param rareNouns Words appearing fewer than 3 times across the corpus. A rare noun in the anchor
 *   label is the analogy leaking — generic labels use common words by construction.
 */
export function assertNoLeak(seed: SeedSkeleton, piece: string, rareNouns?: Set<string>): LeakCheck {
  const sTokens = norm(seedText(seed));
  const pTokens = norm(piece);

  if (sTokens.length > pTokens.length * MAX_SEED_FRACTION) {
    return { ok: false, violation: `seed is ${sTokens.length} words against a ${pTokens.length}-word piece — over ${Math.round(MAX_SEED_FRACTION * 100)}%. Compress it.` };
  }

  const pieceNgrams = ngramSet(pTokens, LEAK_NGRAM);
  for (const g of ngramSet(sTokens, LEAK_NGRAM)) {
    if (pieceNgrams.has(g)) {
      return { ok: false, violation: `the seed reuses a ${LEAK_NGRAM}-word phrase from the piece: "${g}". Rephrase entirely in your own words.` };
    }
  }

  if (rareNouns) {
    for (const w of norm(seed.concreteAnchorLabel)) {
      if (rareNouns.has(w)) {
        return { ok: false, violation: `concreteAnchorLabel names the actual image ("${w}"). Give the TYPE of image only, never the image.` };
      }
    }
  }

  const pieceSentences = piece.split(/(?<=[.!?])\s+/).map((x) => new Set(norm(x)));
  for (const sent of [seed.assignmentPrompt, seed.thesisAbstract, ...seed.moves]) {
    const a = new Set(norm(sent));
    if (a.size < 4) continue;
    for (const b of pieceSentences) {
      if (b.size < 4) continue;
      let inter = 0;
      for (const x of a) if (b.has(x)) inter++;
      if (inter / a.size > MAX_SENTENCE_OVERLAP) {
        return { ok: false, violation: `"${sent}" overlaps a sentence of the piece too closely. Describe the move, not the sentence.` };
      }
    }
  }

  return { ok: true };
}

/** Words appearing fewer than `minCount` times across the corpus — candidates for a leaked anchor. */
export function rareNouns(corpus: string[], minCount = 3): Set<string> {
  const counts = new Map<string, number>();
  for (const t of corpus) for (const w of norm(t)) counts.set(w, (counts.get(w) ?? 0) + 1);
  const out = new Set<string>();
  for (const [w, n] of counts) if (n < minCount && w.length > 3) out.add(w);
  return out;
}

function extractJson(s: string): SeedSkeleton | null {
  const m = /\{[\s\S]*\}/.exec(s);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as SeedSkeleton;
  } catch {
    return null;
  }
}

export async function skeletonFor(
  record: CorpusRecord,
  rare?: Set<string>,
): Promise<{ seed: SeedSkeleton | null; violation?: string }> {
  const targetWords = record.wordCount;

  for (let attempt = 0; attempt < 2; attempt++) {
    const extra = attempt === 0 ? "" : `\n\nYour previous attempt was rejected: ${lastViolation}\nFix exactly that.`;
    const res = await infer({
      system: SYSTEM,
      user: userPrompt(record.text, record.register, targetWords) + extra,
      maxTokens: 900,
      level: "standard",
      temperature: 0.3,
    });
    const parsed = extractJson(res.text);
    if (!parsed) { lastViolation = "output was not valid JSON"; continue; }

    const seed: SeedSkeleton = {
      register: record.register,
      targetWords,
      assignmentPrompt: String(parsed.assignmentPrompt ?? "").trim(),
      thesisAbstract: String(parsed.thesisAbstract ?? "").trim(),
      moves: Array.isArray(parsed.moves) ? parsed.moves.map(String).slice(0, 6) : [],
      concreteAnchorLabel: String(parsed.concreteAnchorLabel ?? "").trim(),
      sourcesReferenced: Array.isArray(parsed.sourcesReferenced) ? parsed.sourcesReferenced.map(String) : [],
    };

    const check = assertNoLeak(seed, record.text, rare);
    if (check.ok) return { seed };
    lastViolation = check.violation!;
  }

  return { seed: null, violation: lastViolation };
}

let lastViolation = "";

if (import.meta.main) {
  const only = process.argv.find((a) => a.startsWith("--register="))?.split("=")[1] as Register | undefined;
  const limit = Number(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? 0);

  const rows = (await readJsonl<CorpusRecord>(PATHS.verified))
    .filter((r) => (only ? r.register === only : ["narrative", "academic", "persuasive"].includes(r.register)))
    .filter((r) => r.wordCount >= 150);

  const targets = limit ? rows.slice(0, limit) : rows;
  if (!targets.length) {
    console.error("No eligible records. Seeds are built from pieces of >=150 words in a written register.");
    process.exit(1);
  }

  const rare = rareNouns(rows.map((r) => r.text));
  const pairs: Pair[] = [];
  let failed = 0;

  console.log(`building ${targets.length} seeds (leak checks in code, one retry each)…`);
  for (const [i, r] of targets.entries()) {
    const { seed, violation } = await skeletonFor(r, rare);
    if (!seed) {
      failed++;
      raise({
        type: "CORPUS_SKELETON_LEAK",
        context: { discriminator: r.id },
        evidenceRefs: { sourceId: r.sourceId, violation: violation ?? "unknown", skeleton: "(rejected twice)" },
        actor: "agent",
      });
      continue;
    }
    pairs.push({ seed, target: r.text, sourceId: r.sourceId, register: r.register, split: r.split });
    if ((i + 1) % 10 === 0) console.log(`  ${i + 1}/${targets.length}`);
  }

  await writeJsonl(PATHS.pairs, pairs);
  console.log(`\n${pairs.length} pairs -> ${PATHS.pairs}`);
  if (failed) console.log(`${failed} rejected after one retry; raised CORPUS_SKELETON_LEAK for each.`);
}
