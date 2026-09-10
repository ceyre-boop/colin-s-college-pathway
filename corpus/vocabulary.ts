#!/usr/bin/env bun
// Build Colin's habitual vocabulary — the out-of-dictionary words he uses on purpose.
//
// This is the discriminator that makes misspelling detection honest. A token absent from the
// dictionary is either an error or his vocabulary, and the two look identical in isolation. What
// separates them is recurrence: "euthinasia" appears 6 times inside one document, while "taboost"
// appears 208 times across hundreds of documents. Nobody misspells a word the same way 208 times.
//
// So: a token appearing in at least MIN_DOCS distinct documents is vocabulary, never an error.
// Document count rather than raw frequency, because one essay repeating its own typo should not
// earn that typo a place in the lexicon.
//
//   bun corpus/vocabulary.ts   # -> corpus/data/vocabulary.json

import { systemDictionary, colinLexicon, tokens, morphVariants, properNouns } from "../eval/stylometry.ts";
import { PATHS, readJsonl, type CorpusRecord } from "./schema.ts";

/** Appear in this many distinct documents to count as habitual vocabulary. */
export const MIN_DOCS = 3;

export function buildVocabulary(records: CorpusRecord[], minDocs = MIN_DOCS): string[] {
  const dict = systemDictionary();
  if (!dict) return [];
  const allow = colinLexicon();
  const docCount = new Map<string, number>();

  for (const r of records) {
    const proper = properNouns(r.text);
    const seen = new Set<string>();
    for (const raw of tokens(r.text)) {
      if (proper.has(raw)) continue;
      const w = raw.includes("'") ? raw.split("'")[0] : raw;
      if (w.length < 3 || allow.has(w)) continue;
      if (morphVariants(w).some((v) => dict.has(v))) continue;
      seen.add(w);
    }
    for (const w of seen) docCount.set(w, (docCount.get(w) ?? 0) + 1);
  }

  return [...docCount.entries()]
    .filter(([, n]) => n >= minDocs)
    .sort((a, b) => b[1] - a[1])
    .map(([w]) => w);
}

if (import.meta.main) {
  const rows = await readJsonl<CorpusRecord>(PATHS.clean);
  if (!rows.length) {
    console.error(`No clean corpus at ${PATHS.clean}. Run: bun corpus/harvest-claude.ts && bun corpus/build.ts`);
    process.exit(1);
  }
  const words = buildVocabulary(rows);
  await Bun.write(
    `${PATHS.gdocs}/../vocabulary.json`,
    JSON.stringify(
      {
        _note: `Out-of-dictionary tokens appearing in >=${MIN_DOCS} distinct documents. Treated as Colin's vocabulary, never as misspellings. Regenerate with: bun corpus/vocabulary.ts`,
        generatedAt: new Date().toISOString(),
        minDocs: MIN_DOCS,
        count: words.length,
        words,
      },
      null,
      2,
    ),
  );
  console.log(`vocabulary: ${words.length} habitual out-of-dictionary words`);
  console.log(`  top 25: ${words.slice(0, 25).join(" ")}`);
  console.log(`  -> corpus/data/vocabulary.json`);
}
