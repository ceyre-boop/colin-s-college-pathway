#!/usr/bin/env bun
// Measure the corpus, per register.
//
// This is the file that turns opinions about Colin's voice into numbers other code must obey:
//   • Phase 5 register contracts are derived from these means and standard deviations.
//   • Phase 3 preregistered bands are computed from these distributions.
//   • The misspelling-rate question — does his academic register really keep the errors, or was
//     that one rushed submission? — is answered here or not at all.
//
// Nothing may hard-code a marker rate. If a rate is not in this output, the claim that depends on
// it is not yet supported.
//
//   bun corpus/stats.ts            # human-readable table
//   bun corpus/stats.ts --json     # write corpus/data/stats.json

import { features, functionWords, type FeatureVector } from "../eval/stylometry.ts";
import { PATHS, REGISTERS, readJsonl, type CorpusRecord, type Register } from "./schema.ts";

export interface Stat {
  n: number;
  mean: number;
  sd: number;
  min: number;
  max: number;
}

export interface RegisterStats {
  register: Register;
  documents: number;
  words: number;
  /** Per-feature distribution across the records of this register. */
  featureStats: Record<string, Stat>;
  /** Mean relative frequency of each frozen function word — the register's Delta centroid. */
  functionWordMeans: number[];
  /** How many records had a dictionary available to check spelling against. */
  spellCheckedRecords: number;
}

export interface CorpusStats {
  generatedAt: string;
  totalRecords: number;
  totalWords: number;
  byRegister: RegisterStats[];
  /** Registers with too little data to support a contract or a band. */
  underpowered: { register: Register; documents: number; words: number; reason: string }[];
}

/** Below this, a register's mean/sd is not worth quoting and no contract may be built from it. */
export const MIN_DOCS_FOR_CONTRACT = 5;
export const MIN_WORDS_FOR_CONTRACT = 3000;

function stat(xs: number[]): Stat {
  const clean = xs.filter((x) => Number.isFinite(x));
  const n = clean.length;
  if (!n) return { n: 0, mean: 0, sd: 0, min: 0, max: 0 };
  const mean = clean.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(clean.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
  return { n, mean, sd, min: Math.min(...clean), max: Math.max(...clean) };
}

/** The scalar features a register contract is built from. */
export const CONTRACT_FEATURES = [
  "meanSentenceWords",
  "sdSentenceWords",
  "commaRate",
  "semicolonRate",
  "emDashRate",
  "commasPerSentence",
  "mtld",
  "lowercaseStartRate",
  "contractionRate",
  "misspellingRate",
  "enDashAsHyphenRate",
  "doubledPeriodRate",
  "boldMidParagraphRate",
] as const;

export function scalars(f: FeatureVector): Record<string, number | null> {
  return {
    meanSentenceWords: f.meanSentenceWords,
    sdSentenceWords: f.sdSentenceWords,
    commaRate: f.commaRate,
    semicolonRate: f.semicolonRate,
    emDashRate: f.emDashRate,
    commasPerSentence: f.commasPerSentence,
    mtld: f.mtld,
    lowercaseStartRate: f.markers.lowercaseStartRate,
    contractionRate: f.markers.contractionRate,
    misspellingRate: f.markers.misspellingRate,
    enDashAsHyphenRate: f.markers.enDashAsHyphenRate,
    doubledPeriodRate: f.markers.doubledPeriodRate,
    boldMidParagraphRate: f.markers.boldMidParagraphRate,
  };
}

export function computeStats(records: CorpusRecord[]): CorpusStats {
  const byRegister: RegisterStats[] = [];
  const underpowered: CorpusStats["underpowered"] = [];

  for (const register of REGISTERS) {
    const rows = records.filter((r) => r.register === register);
    if (!rows.length) {
      underpowered.push({ register, documents: 0, words: 0, reason: "no records" });
      continue;
    }

    const fvs = rows.map((r) => features(r.text));
    const scalarRows = fvs.map(scalars);
    const featureStats: Record<string, Stat> = {};
    for (const k of CONTRACT_FEATURES) {
      featureStats[k] = stat(scalarRows.map((s) => s[k]).filter((x): x is number => x !== null));
    }

    const fwCount = functionWords().length;
    const functionWordMeans = Array.from({ length: fwCount }, (_, i) =>
      fvs.reduce((a, f) => a + f.functionWordFreqs[i], 0) / fvs.length,
    );

    const words = rows.reduce((n, r) => n + r.wordCount, 0);
    byRegister.push({
      register,
      documents: rows.length,
      words,
      featureStats,
      functionWordMeans,
      spellCheckedRecords: scalarRows.filter((s) => s.misspellingRate !== null).length,
    });

    if (rows.length < MIN_DOCS_FOR_CONTRACT || words < MIN_WORDS_FOR_CONTRACT) {
      underpowered.push({
        register,
        documents: rows.length,
        words,
        reason: `needs >=${MIN_DOCS_FOR_CONTRACT} documents and >=${MIN_WORDS_FOR_CONTRACT.toLocaleString()} words`,
      });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    totalRecords: records.length,
    totalWords: records.reduce((n, r) => n + r.wordCount, 0),
    byRegister,
    underpowered,
  };
}

function fmt(s: Stat, digits = 2): string {
  if (!s.n) return "—";
  return `${s.mean.toFixed(digits)} ±${s.sd.toFixed(digits)}`;
}

if (import.meta.main) {
  const rows = await readJsonl<CorpusRecord>(PATHS.clean);
  if (!rows.length) {
    console.error(`No clean corpus at ${PATHS.clean}. Run: bun corpus/harvest-claude.ts && bun corpus/build.ts`);
    process.exit(1);
  }
  const s = computeStats(rows);

  console.log(`corpus: ${s.totalRecords.toLocaleString()} records / ${s.totalWords.toLocaleString()} words\n`);

  const cols = s.byRegister;
  const label = (k: string) => k.padEnd(22);
  const head = "feature".padEnd(22) + cols.map((c) => c.register.padStart(16)).join("");
  console.log(head);
  console.log("-".repeat(head.length));
  console.log(label("documents") + cols.map((c) => String(c.documents).padStart(16)).join(""));
  console.log(label("words") + cols.map((c) => c.words.toLocaleString().padStart(16)).join(""));
  for (const k of CONTRACT_FEATURES) {
    console.log(label(k) + cols.map((c) => fmt(c.featureStats[k]).padStart(16)).join(""));
  }

  if (s.underpowered.length) {
    console.log(`\nUNDERPOWERED — no contract or band may be built from these:`);
    for (const u of s.underpowered) {
      console.log(`  ${u.register.padEnd(11)} ${u.documents} docs / ${u.words.toLocaleString()} words — ${u.reason}`);
    }
  }

  const noSpell = cols.filter((c) => c.spellCheckedRecords === 0);
  if (noSpell.length === cols.length) {
    console.log(`\nNOTE: no system dictionary found — misspelling rate is unmeasured, not zero.`);
  }

  if (process.argv.includes("--json")) {
    await Bun.write(PATHS.stats, JSON.stringify(s, null, 2));
    console.log(`\n-> ${PATHS.stats}`);
  }
}
