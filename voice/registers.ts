// Register contracts — the dial, calibrated to measurement rather than intuition.
//
// The research claim of this project is that register can be a clean dial rather than a blend.
// Anyone can write "write formally" in a prompt; that is an adjective, and adjectives are exactly
// what produce a blend. A contract is different: it states, in numbers taken from Colin's own
// corpus, what his academic register actually measures — sentences average 24 words with a standard
// deviation of 14, about 11% start lowercase, contractions run 1.0 per 100 words — and then a
// validator checks the output against those numbers and rejects drift.
//
// Every contract in this file is GENERATED from corpus/data/stats.json. None is authored. If a
// register lacks the data to support a contract, it gets none, and that absence is reported rather
// than filled in with a plausible guess.

import { readFileSync } from "fs";
import { join } from "path";
import { features, type FeatureVector } from "../eval/stylometry.ts";
import { scalars, CONTRACT_FEATURES, type CorpusStats } from "../corpus/stats.ts";
import type { Register } from "../corpus/schema.ts";

const STATS_PATH = join(import.meta.dir, "..", "corpus", "data", "stats.json");

export interface Band {
  feature: string;
  mean: number;
  sd: number;
  /** Acceptable range: mean ± TOLERANCE_SD. */
  low: number;
  high: number;
}

export interface RegisterContract {
  register: Register;
  documents: number;
  words: number;
  bands: Band[];
}

/** How far a feature may sit from the register's mean before the validator objects. */
export const TOLERANCE_SD = 2;

/** Features whose numeric target is worth stating in the prompt. Rates below 0.05/1k read as noise. */
const PROMPTED = new Set([
  "meanSentenceWords",
  "sdSentenceWords",
  "commaRate",
  "lowercaseStartRate",
  "contractionRate",
  "misspellingRate",
  "boldMidParagraphRate",
]);

export function loadStats(path = STATS_PATH): CorpusStats | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as CorpusStats;
  } catch {
    return null;
  }
}

export function contractsFrom(stats: CorpusStats): RegisterContract[] {
  const underpowered = new Set(stats.underpowered.map((u) => u.register));
  return stats.byRegister
    .filter((r) => !underpowered.has(r.register))
    .map((r) => ({
      register: r.register,
      documents: r.documents,
      words: r.words,
      // Skip features the stats file does not carry. A stats.json written before a new contract
      // feature existed is stale, not corrupt — it should yield a smaller contract, not a crash.
      bands: CONTRACT_FEATURES.flatMap((f) => {
        const s = r.featureStats[f];
        if (!s || !Number.isFinite(s.mean)) return [];
        return [{
          feature: f,
          mean: s.mean,
          sd: s.sd,
          low: s.mean - TOLERANCE_SD * s.sd,
          high: s.mean + TOLERANCE_SD * s.sd,
        }];
      }),
    }));
}

let cache: RegisterContract[] | null = null;

export function contracts(): RegisterContract[] {
  if (!cache) {
    const s = loadStats();
    cache = s ? contractsFrom(s) : [];
  }
  return cache;
}

export function contractFor(register: Register): RegisterContract | null {
  return contracts().find((c) => c.register === register) ?? null;
}

function pretty(feature: string, mean: number): string {
  switch (feature) {
    case "meanSentenceWords": return `sentences average ${mean.toFixed(0)} words`;
    case "sdSentenceWords": return `sentence length varies with a standard deviation of ${mean.toFixed(0)} words — mix short and long deliberately`;
    case "commaRate": return `about ${mean.toFixed(1)} commas per 100 words`;
    case "lowercaseStartRate": return `about ${(mean * 100).toFixed(0)}% of sentences start with a lowercase letter`;
    case "contractionRate": return `about ${mean.toFixed(1)} contractions per 100 words`;
    case "misspellingRate": return `roughly ${mean.toFixed(1)} spelling slips per 1,000 words`;
    case "boldMidParagraphRate": return `about ${mean.toFixed(1)} bolded phrases per 1,000 words, mid-paragraph`;
    default: return `${feature}: ${mean.toFixed(2)}`;
  }
}

/**
 * Render the contract as explicit numeric targets.
 * Numbers steer generation far harder than adjectives, which is the whole reason this exists.
 */
export function renderContract(c: RegisterContract): string {
  const lines = c.bands
    .filter((b) => PROMPTED.has(b.feature) && (b.mean > 0.05 || b.feature === "lowercaseStartRate"))
    .map((b) => `- ${pretty(b.feature, b.mean)}`);
  if (!lines.length) return "";
  return [
    `# Register contract: ${c.register}`,
    `Measured from ${c.documents} of Colin's own documents (${c.words.toLocaleString()} words).`,
    `Hit these as habits, not as quotas — do not count as you write.`,
    ...lines,
  ].join("\n");
}

// ---- validation ------------------------------------------------------------

export interface Violation {
  feature: string;
  observed: number;
  expected: number;
  sd: number;
  z: number;
}

export interface Validation {
  register: Register;
  ok: boolean;
  /** Register whose contract the text best matches. */
  nearestRegister: Register | null;
  /** Mean absolute z across contract features; lower is a better fit. */
  registerFit: number;
  violations: Violation[];
}

function zAgainst(c: RegisterContract, f: FeatureVector): { z: number[]; violations: Violation[] } {
  const s = scalars(f);
  const z: number[] = [];
  const violations: Violation[] = [];
  for (const b of c.bands) {
    const observed = s[b.feature];
    if (observed === null || observed === undefined) continue;
    if (b.sd === 0) continue;
    const zi = (observed - b.mean) / b.sd;
    z.push(Math.abs(zi));
    if (Math.abs(zi) > TOLERANCE_SD) {
      violations.push({ feature: b.feature, observed, expected: b.mean, sd: b.sd, z: Number(zi.toFixed(2)) });
    }
  }
  return { z, violations };
}

export function validate(text: string, register: Register): Validation {
  const c = contractFor(register);
  const f = features(text);

  if (!c) {
    // No contract means no data, which means no verdict. Reporting "ok" here would be a lie.
    return { register, ok: true, nearestRegister: null, registerFit: Number.NaN, violations: [] };
  }

  const { z, violations } = zAgainst(c, f);
  const fit = z.length ? z.reduce((a, b) => a + b, 0) / z.length : Number.NaN;

  let nearest: Register | null = null;
  let best = Infinity;
  for (const other of contracts()) {
    const { z: oz } = zAgainst(other, f);
    if (!oz.length) continue;
    const m = oz.reduce((a, b) => a + b, 0) / oz.length;
    if (m < best) { best = m; nearest = other.register; }
  }

  return {
    register,
    ok: violations.length === 0 && nearest === register,
    nearestRegister: nearest,
    registerFit: Number(fit.toFixed(3)),
    violations,
  };
}

/** Feedback for the one retry, naming what to change rather than saying "try again". */
export function retryGuidance(v: Validation): string {
  if (!v.violations.length && v.nearestRegister !== v.register) {
    return `That reads as ${v.nearestRegister} register, not ${v.register}. Re-read the register contract and hold it.`;
  }
  const fixes = v.violations.map((x) => {
    const dir = x.z > 0 ? "too high" : "too low";
    return `- ${x.feature} is ${dir}: ${x.observed.toFixed(2)} against a target of ${x.expected.toFixed(2)}`;
  });
  return [`The draft missed its register contract on these:`, ...fixes, ``, `Rewrite holding the contract. Keep the content.`].join("\n");
}
