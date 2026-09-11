#!/usr/bin/env bun
// Build the empirical error table: what Colin actually mistypes, and what he types instead.
//
// This exists so the orthography layer never invents errors. Synthetic corruption — swap two random
// characters — produces mistakes no human makes, and a rater spots them immediately. What is wanted
// is the real substitution: "euthanasia" -> "euthinasia", "totally" -> "totaly".
//
// A misspelling is identified the same way eval/stylometry.ts identifies one: out of dictionary,
// not a proper noun, not short enough for the near-miss rule to be meaningless, and within one edit
// of a real word. The correction is that nearest real word.
//
//   bun corpus/error-table.ts   # -> corpus/data/error-table.json

import {
  systemDictionary, colinLexicon, corpusVocabulary, tokens,
  morphVariants, properNouns, edits1, MIN_MISSPELLING_LEN,
} from "../eval/stylometry.ts";
import { PATHS, readJsonl, type CorpusRecord } from "./schema.ts";

export interface ErrorEntry {
  correct: string;
  colin: string;
  count: number;
  /** Registers it was observed in. */
  registers: string[];
}

/**
 * The nearest dictionary word within one edit, ranked by how often Colin actually uses it.
 *
 * Length-then-alphabetical ranking produced nonsense: "mockup" was corrected to "cockup",
 * "databases" to "catabases", "prove" to "groove" — all real dictionary words, all absurd as
 * intentions. Corpus frequency settles it, because the word he meant is overwhelmingly the word he
 * uses. Dropped-letter slips break remaining ties, since those dominate his error profile.
 */
export function correctionFor(word: string, dict: Set<string>, freq?: Map<string, number>): string | null {
  const cands = [...edits1(word)].filter((e) => e.length >= 3 && dict.has(e));
  if (!cands.length) return null;
  const f = (w: string) => freq?.get(w) ?? 0;
  cands.sort((a, b) => f(b) - f(a) || b.length - a.length || a.localeCompare(b));
  return cands[0];
}

/** How often each token appears across the corpus — the evidence for what a word was meant to be. */
export function wordFrequencies(records: CorpusRecord[]): Map<string, number> {
  const f = new Map<string, number>();
  for (const r of records) {
    for (const t of tokens(r.text)) f.set(t, (f.get(t) ?? 0) + 1);
  }
  return f;
}

export function buildErrorTable(records: CorpusRecord[]): ErrorEntry[] {
  const dict = systemDictionary();
  if (!dict) return [];
  const allow = colinLexicon();
  const vocab = corpusVocabulary();
  const freq = wordFrequencies(records);
  const found = new Map<string, ErrorEntry>();

  for (const r of records) {
    const proper = properNouns(r.text);
    for (const raw of tokens(r.text)) {
      if (proper.has(raw)) continue;
      const w = raw.includes("'") ? raw.split("'")[0] : raw;
      if (w.length < MIN_MISSPELLING_LEN) continue;
      if (allow.has(w) || vocab.has(w)) continue;
      if (morphVariants(w).some((v) => dict.has(v))) continue;

      const correct = correctionFor(w, dict, freq);
      if (!correct || correct === w) continue;
      // If he uses the "misspelling" more than the proposed correction, it is his vocabulary and
      // the correction is the accident. "mockup" is not a failed attempt at "cockup".
      if ((freq.get(w) ?? 0) > (freq.get(correct) ?? 0)) continue;

      const key = `${correct}|${w}`;
      const e = found.get(key) ?? { correct, colin: w, count: 0, registers: [] };
      e.count++;
      if (!e.registers.includes(r.register)) e.registers.push(r.register);
      found.set(key, e);
    }
  }

  return [...found.values()].sort((a, b) => b.count - a.count);
}

if (import.meta.main) {
  const rows = await readJsonl<CorpusRecord>(PATHS.verified);
  const gdocs = await readJsonl<CorpusRecord>(PATHS.clean);
  // Include the verified corpus plus any Google Docs already on disk, since the academic register
  // is where the interesting errors live.
  const all = [...rows, ...gdocs.filter((r) => r.source === "gdoc")];

  if (!all.length) {
    console.error(`No corpus. Run: bun corpus/harvest-claude.ts && bun corpus/build.ts && bun corpus/split.ts --freeze`);
    process.exit(1);
  }

  const entries = buildErrorTable(all);
  await Bun.write(
    PATHS.errorTable,
    JSON.stringify(
      {
        _note: "What Colin actually mistypes, and what he types instead. Used by voice/orthography.ts so the noise layer never invents errors a human would not make. Regenerate: bun corpus/error-table.ts",
        generatedAt: new Date().toISOString(),
        documents: all.length,
        entries,
      },
      null,
      2,
    ),
  );

  console.log(`error table: ${entries.length} distinct substitutions from ${all.length} documents`);
  console.log(`  top 20:`);
  for (const e of entries.slice(0, 20)) {
    console.log(`    ${e.correct.padEnd(18)} -> ${e.colin.padEnd(18)} ${String(e.count).padStart(4)}x  [${e.registers.join(",")}]`);
  }
  console.log(`  -> ${PATHS.errorTable}`);
}
