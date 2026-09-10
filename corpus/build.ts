#!/usr/bin/env bun
// The corpus pipeline: harvest.jsonl -> clean -> dedup -> register -> clean.jsonl (+ quarantine).
//
// Everything that judges a record happens here, in one pass, so the reasons a record was dropped
// are reported together rather than discovered one stage at a time.
//
//   bun corpus/build.ts            # rebuild clean.jsonl from harvest.jsonl
//   bun corpus/build.ts --verbose  # also print rejection reasons by category

import { clean, dedupeNear } from "./clean.ts";
import { tag } from "./register.ts";
import { checkContamination } from "./quarantine.ts";
import { PATHS, readJsonl, writeJsonl, words, type CorpusRecord } from "./schema.ts";

export interface BuildReport {
  input: number;
  kept: number;
  rejected: Record<string, number>;
  quarantined: number;
  dedupedAway: number;
  byRegister: Record<string, { count: number; words: number }>;
  totalWords: number;
}

export function build(rows: CorpusRecord[]): { clean: CorpusRecord[]; quarantine: CorpusRecord[]; report: BuildReport } {
  const rejected: Record<string, number> = {};
  const kept: CorpusRecord[] = [];
  const quarantined: CorpusRecord[] = [];

  for (const r of rows) {
    // Google Docs arrive already-clean; the transcript stripper would eat their formatting.
    const res = r.source === "gdoc"
      ? { text: r.text, rejected: null as null, wordCount: words(r.text) }
      : clean(r.text);

    if (res.rejected) {
      rejected[res.rejected] = (rejected[res.rejected] ?? 0) + 1;
      continue;
    }

    const hit = checkContamination(r.sourceId, res.text);
    if (hit.contaminated) {
      quarantined.push({
        ...r,
        text: res.text,
        wordCount: res.wordCount,
        quarantine: { reason: "llm-generated", note: hit.reason },
      });
      continue;
    }

    kept.push(tag({ ...r, text: res.text, wordCount: res.wordCount }));
  }

  const beforeDedup = kept.length;
  const deduped = dedupeNear(kept);

  const byRegister: BuildReport["byRegister"] = {};
  let totalWords = 0;
  for (const r of deduped) {
    byRegister[r.register] ??= { count: 0, words: 0 };
    byRegister[r.register].count++;
    byRegister[r.register].words += r.wordCount;
    totalWords += r.wordCount;
  }

  return {
    clean: deduped,
    quarantine: quarantined,
    report: {
      input: rows.length,
      kept: deduped.length,
      rejected,
      quarantined: quarantined.length,
      dedupedAway: beforeDedup - deduped.length,
      byRegister,
      totalWords,
    },
  };
}

if (import.meta.main) {
  const verbose = process.argv.includes("--verbose");
  const rows = await readJsonl<CorpusRecord>(PATHS.harvest);
  if (rows.length === 0) {
    console.error(`No harvest at ${PATHS.harvest}. Run: bun corpus/harvest-claude.ts`);
    process.exit(1);
  }

  const { clean: cleaned, quarantine, report } = build(rows);
  await writeJsonl(PATHS.clean, cleaned);
  await writeJsonl(PATHS.quarantine, quarantine);

  console.log(`corpus/build: ${report.input.toLocaleString()} in -> ${report.kept.toLocaleString()} kept`);
  console.log(`  ${report.totalWords.toLocaleString()} words, ${report.quarantined} quarantined, ${report.dedupedAway.toLocaleString()} near-duplicates dropped`);
  if (verbose) {
    console.log("  rejected:", report.rejected);
  }
  console.log("  by register:");
  for (const [reg, v] of Object.entries(report.byRegister).sort((a, b) => b[1].words - a[1].words)) {
    console.log(`    ${reg.padEnd(11)} ${String(v.count).padStart(6)} records  ${v.words.toLocaleString().padStart(9)} words`);
  }
  console.log(`  -> ${PATHS.clean}`);
}
