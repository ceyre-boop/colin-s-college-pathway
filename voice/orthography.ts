// Orthographic noise — reproducing Colin's spelling behaviour, deliberately separable.
//
// WHY THIS IS A SEPARATE, FLAG-GATED STAGE. The measured finding is that Colin's academic register
// carries roughly seven times the misspelling rate of his chat registers: a submitted philosophy
// paper misspells its own subject in the title. Reproducing that is required for the research claim
// — strip it and the output stops being his.
//
// But deliberately injecting misspellings into scholarship applications that a committee will read
// has a real cost that the research goal does not justify. So:
//
//   ON  in eval   — the claim is tested against what he actually writes.
//   OFF in /api/draft — the application goes out clean.
//
// The toggle is also a free ablation: how much of the panel's discrimination rate is carried by
// spelling alone? If the answer is "most of it", then the voice model is a spellchecker in reverse
// and we should say so.
//
// Errors are sampled from an EMPIRICAL table of what Colin actually mistypes, never from synthetic
// corruption. Random character swaps produce errors no human makes, which a rater spots instantly.

import { readFileSync } from "fs";
import { join } from "path";
import { mulberry32 } from "../eval/delta.ts";
import type { Register } from "../corpus/schema.ts";

const TABLE_PATH = join(import.meta.dir, "..", "corpus", "data", "error-table.json");
const STATS_PATH = join(import.meta.dir, "..", "corpus", "data", "stats.json");

export interface ErrorTable {
  /** correct spelling -> the way Colin writes it, with how often it was observed. */
  entries: { correct: string; colin: string; count: number }[];
}

let tableCache: ErrorTable | null = null;

export function errorTable(path = TABLE_PATH): ErrorTable {
  if (tableCache) return tableCache;
  try {
    tableCache = JSON.parse(readFileSync(path, "utf8")) as ErrorTable;
  } catch {
    tableCache = { entries: [] };
  }
  return tableCache;
}

/** Measured misspellings per 1,000 words for a register, or null if unmeasured. */
export function targetRate(register: Register, path = STATS_PATH): number | null {
  try {
    const stats = JSON.parse(readFileSync(path, "utf8")) as {
      byRegister: { register: Register; featureStats: Record<string, { mean: number; n: number }> }[];
    };
    const r = stats.byRegister.find((x) => x.register === register);
    const s = r?.featureStats?.misspellingRate;
    return s && Number.isFinite(s.mean) ? s.mean : null;
  } catch {
    return null;
  }
}

export function orthographyEnabled(): boolean {
  return (process.env.VOICE_ORTHOGRAPHY ?? "off").toLowerCase() === "on";
}

/**
 * Apply the register's measured error rate using observed substitutions.
 *
 * Returns the text unchanged when there is no empirical table or no measured rate — an invented
 * rate applied with invented errors would be worse than none, because it would look like evidence.
 */
export function applyOrthography(
  text: string,
  register: Register,
  opts: { rate?: number; seed?: number; table?: ErrorTable } = {},
): string {
  const table = opts.table ?? errorTable();
  const rate = opts.rate ?? targetRate(register);
  if (!table.entries.length || rate === null || rate <= 0) return text;

  const words = (text.match(/\S+/g) || []).length;
  const budget = Math.round((rate / 1000) * words);
  if (budget < 1) return text;

  const rand = mulberry32(opts.seed ?? 13);
  // Weight by observed frequency: the words he actually gets wrong most often, most often.
  const pool = table.entries.flatMap((e) => Array(Math.max(1, e.count)).fill(e) as typeof table.entries);

  let out = text;
  let applied = 0;
  const used = new Set<string>();

  for (let attempt = 0; attempt < budget * 12 && applied < budget; attempt++) {
    const e = pool[Math.floor(rand() * pool.length)];
    if (used.has(e.correct)) continue;
    const re = new RegExp(`\\b${e.correct.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (!re.test(out)) continue;
    out = out.replace(re, (m) => (m[0] === m[0].toUpperCase() ? e.colin[0].toUpperCase() + e.colin.slice(1) : e.colin));
    used.add(e.correct);
    applied++;
  }
  return out;
}

/** How much of a discrimination result the orthography layer could be carrying. */
export function orthographyDelta(withNoise: number, withoutNoise: number): {
  share: number;
  statement: string;
} {
  const total = Math.abs(withNoise - 0.5) + Math.abs(withoutNoise - 0.5);
  const share = total === 0 ? 0 : Math.abs(withoutNoise - withNoise) / total;
  return {
    share,
    statement:
      `Orthography accounts for ${(share * 100).toFixed(0)}% of the movement in discrimination rate ` +
      `(${withoutNoise.toFixed(3)} without, ${withNoise.toFixed(3)} with).` +
      (share > 0.5 ? ` Over half — the rest of the system is doing less than the spelling layer.` : ""),
  };
}
