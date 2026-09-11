// Burrows's Delta, the within-Colin band, and General Imposters.
//
// THE FALSIFIABLE CLAIM this file exists to test:
//
//   Delta(model output <-> Colin baseline) falls inside the within-Colin split-half 95% band for
//   the same register.
//
// The band is the point. A raw Delta number means nothing on its own — "0.8" is neither good nor
// bad. What makes the claim falsifiable is comparing it against how far Colin sits from HIMSELF
// when his own baseline is split in half. If the model lands outside that band, it is outside his
// natural variance and the claim is false. Band and observed value are always reported together.
//
// TWO METHODS, DELIBERATELY. Delta needs ~1,000+ words per sample to be stable, and it assumes a
// reasonably large reference corpus. At ~10 academic documents that assumption is strained.
// General Imposters was designed for exactly this situation — small candidate sets, verification
// rather than attribution — so it is reported alongside. Delta is the headline because it is what
// was asked for; GI is the one to believe when they disagree.

import { features, functionWords, type FeatureVector } from "./stylometry.ts";

export interface CorpusReference {
  /** Mean relative frequency of each function word across the reference corpus. */
  means: number[];
  /** Standard deviation of each, used to z-score. */
  sds: number[];
}

/** Build the z-scoring reference from a set of samples. */
export function reference(samples: FeatureVector[]): CorpusReference {
  const n = functionWords().length;
  const means = new Array(n).fill(0);
  const sds = new Array(n).fill(0);
  if (!samples.length) return { means, sds };

  for (let i = 0; i < n; i++) {
    const xs = samples.map((s) => s.functionWordFreqs[i]);
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    means[i] = m;
    sds[i] =
      xs.length > 1
        ? Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1))
        : 0;
  }
  return { means, sds };
}

/**
 * Burrows's Delta: mean absolute difference of z-scored function-word frequencies.
 * Words with zero variance in the reference contribute nothing rather than infinity.
 */
export function delta(a: FeatureVector, b: FeatureVector, ref: CorpusReference): number {
  let sum = 0;
  let used = 0;
  for (let i = 0; i < ref.means.length; i++) {
    if (!ref.sds[i]) continue;
    const za = (a.functionWordFreqs[i] - ref.means[i]) / ref.sds[i];
    const zb = (b.functionWordFreqs[i] - ref.means[i]) / ref.sds[i];
    sum += Math.abs(za - zb);
    used++;
  }
  return used ? sum / used : Number.NaN;
}

/**
 * Average several documents' function-word profiles into one sample.
 * Used for split halves so the halves are compared as groups without re-tokenising their
 * concatenation on every one of thousands of bootstrap iterations.
 */
export function meanVector(fs: FeatureVector[]): FeatureVector {
  const n = functionWords().length;
  const freqs = new Array(n).fill(0);
  for (const f of fs) for (let i = 0; i < n; i++) freqs[i] += f.functionWordFreqs[i];
  for (let i = 0; i < n; i++) freqs[i] /= fs.length || 1;
  return { ...fs[0], functionWordFreqs: freqs };
}

/** Delta is unstable below this many words per sample; samples are aggregated up to it. */
export const MIN_DELTA_WORDS = 1000;

/** Aggregate documents into chunks of at least MIN_DELTA_WORDS so Delta is stable. */
export function aggregate(texts: string[], minWords = MIN_DELTA_WORDS): string[] {
  const out: string[] = [];
  let buf: string[] = [];
  let n = 0;
  for (const t of texts) {
    buf.push(t);
    n += (t.match(/\S+/g) || []).length;
    if (n >= minWords) {
      out.push(buf.join("\n\n"));
      buf = [];
      n = 0;
    }
  }
  // A trailing remainder joins the last full chunk rather than forming an undersized one.
  if (buf.length) {
    if (out.length) out[out.length - 1] += "\n\n" + buf.join("\n\n");
    else out.push(buf.join("\n\n"));
  }
  return out;
}

export interface Band {
  /** Median within-Colin split-half Delta. */
  median: number;
  low: number;
  high: number;
  iterations: number;
  /** Documents available. Below ~6 the band is too wide to falsify anything. */
  documents: number;
  underpowered: boolean;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function percentile(xs: number[], p: number): number {
  if (!xs.length) return Number.NaN;
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo);
}

/** Below this many documents, a split-half band cannot be estimated meaningfully. */
export const MIN_DOCS_FOR_BAND = 6;

/**
 * The within-Colin band: repeatedly split his baseline in half AT THE DOCUMENT LEVEL, measure
 * Delta between the halves, and report the 2.5/97.5 percentiles.
 *
 * Document-level splitting is not a detail. Two passages from one essay share its topic and its
 * author's afternoon; splitting by passage would make the halves artificially similar, shrink the
 * band, and manufacture a claim the data does not support.
 */
export function withinColinBand(
  docs: string[],
  opts: { iterations?: number; seed?: number; ref?: CorpusReference } = {},
): Band {
  const iterations = opts.iterations ?? 2000;
  const rand = mulberry32(opts.seed ?? 1);
  const deltas: number[] = [];

  if (docs.length < MIN_DOCS_FOR_BAND) {
    return { median: Number.NaN, low: Number.NaN, high: Number.NaN, iterations: 0, documents: docs.length, underpowered: true };
  }

  // The z-scoring reference is built ONCE from every document, and never from the pair being
  // compared. Deriving it from two samples is degenerate: with n=2 the standard deviation of each
  // feature is exactly |a-b|/sqrt(2), so |z_a - z_b| collapses to sqrt(2) for every feature and
  // every comparison returns 1.414 regardless of the texts. Delta is defined against a corpus.
  const ref = opts.ref ?? reference(docs.map((d) => features(d)));
  const cached = docs.map((d) => features(d));

  for (let it = 0; it < iterations; it++) {
    const idx = docs.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    const mid = Math.floor(idx.length / 2);
    const A = idx.slice(0, mid);
    const B = idx.slice(mid);
    if (!A.length || !B.length) continue;

    const fa = meanVector(A.map((i) => cached[i]));
    const fb = meanVector(B.map((i) => cached[i]));
    const d = delta(fa, fb, ref);
    if (Number.isFinite(d)) deltas.push(d);
  }

  return {
    median: percentile(deltas, 0.5),
    low: percentile(deltas, 0.025),
    high: percentile(deltas, 0.975),
    iterations: deltas.length,
    documents: docs.length,
    underpowered: false,
  };
}

export interface DeltaVerdict {
  observed: number;
  band: Band;
  /** True when the observed Delta sits inside the band — the claim holds. */
  inside: boolean | null;
  statement: string;
}

/** Report the observed Delta against the band, always together. */
export function judge(observed: number, band: Band, label = "model output"): DeltaVerdict {
  if (band.underpowered || !Number.isFinite(band.high)) {
    return {
      observed,
      band,
      inside: null,
      statement:
        `No verdict: the within-Colin band needs at least ${MIN_DOCS_FOR_BAND} documents and has ` +
        `${band.documents}. Delta(${label}) = ${observed.toFixed(3)}, but there is nothing to compare it to.`,
    };
  }
  const inside = observed <= band.high;
  return {
    observed,
    band,
    inside,
    statement:
      `Delta(${label} <-> Colin) = ${observed.toFixed(3)}; within-Colin band ` +
      `[${band.low.toFixed(3)}, ${band.high.toFixed(3)}] (median ${band.median.toFixed(3)}, ` +
      `${band.documents} documents). ${inside ? "INSIDE his natural variance." : "OUTSIDE his natural variance — the claim is false for this register."}`,
  };
}

// ---- General Imposters -----------------------------------------------------

export interface GIResult {
  /** Fraction of trials in which the candidate was nearer Colin than any impostor. In [0,1]. */
  score: number;
  trials: number;
  /** Impostor sets it was tested against. */
  impostors: number;
}

/**
 * General Imposters: repeatedly sample a random subset of the function-word features and ask
 * whether the candidate is nearer Colin than to any impostor author. Designed for small corpora,
 * where Delta's reference-corpus assumptions do not hold.
 *
 * A score near 1 means the candidate is consistently Colin-like. Near 0.5 or below means it is no
 * closer to Colin than to the impostors — for our purposes the ideal is HIGH, since we want the
 * generated text to be indistinguishable from him and distinguishable from the LLM impostor set.
 */
export function generalImposters(
  candidate: string,
  colin: string[],
  impostorSets: string[][],
  opts: { trials?: number; seed?: number; featureFraction?: number } = {},
): GIResult {
  const trials = opts.trials ?? 200;
  const frac = opts.featureFraction ?? 0.5;
  const rand = mulberry32(opts.seed ?? 7);

  const fc = features(candidate);
  const fColin = colin.map((t) => features(t));
  const fImp = impostorSets.map((set) => set.map((t) => features(t)));
  const nFeat = functionWords().length;

  const ref = reference([fc, ...fColin, ...fImp.flat()]);

  const dist = (a: FeatureVector, b: FeatureVector, idx: number[]) => {
    let sum = 0;
    let used = 0;
    for (const i of idx) {
      if (!ref.sds[i]) continue;
      const za = (a.functionWordFreqs[i] - ref.means[i]) / ref.sds[i];
      const zb = (b.functionWordFreqs[i] - ref.means[i]) / ref.sds[i];
      sum += Math.abs(za - zb);
      used++;
    }
    return used ? sum / used : Number.POSITIVE_INFINITY;
  };

  let wins = 0;
  let ran = 0;
  for (let t = 0; t < trials; t++) {
    const idx: number[] = [];
    for (let i = 0; i < nFeat; i++) if (rand() < frac) idx.push(i);
    if (idx.length < 5) continue;

    const dColin = Math.min(...fColin.map((f) => dist(fc, f, idx)));
    const dImp = Math.min(...fImp.map((set) => Math.min(...set.map((f) => dist(fc, f, idx)))));
    if (!Number.isFinite(dColin) || !Number.isFinite(dImp)) continue;
    ran++;
    if (dColin < dImp) wins++;
  }

  return { score: ran ? wins / ran : Number.NaN, trials: ran, impostors: impostorSets.length };
}
