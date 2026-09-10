// The stylometric battery — pure feature extraction, no I/O, no model.
//
// This is the measuring instrument for the whole project, so every choice here is defensive:
//
//   • FUNCTION WORDS, not content words. Colin writing about euthanasia and Colin writing about
//     tumour segmentation must land near each other, or the metric measures topic, not voice.
//     The list is frozen on disk and hashed into the preregistration.
//
//   • MTLD, not raw type-token ratio. Raw TTR falls as texts get longer, so comparing a 400-word
//     essay against a 1,200-word one would report a style difference that is purely a length
//     artefact. MTLD is length-invariant by construction.
//
//   • COLIN MARKERS measured, never assumed. The misspelling rate, the en-dash-as-hyphen habit,
//     the doubled period — these came from reading one essay, which is n=1. They are measured per
//     register and reported; nothing downstream may hard-code a rate.

import { readFileSync } from "fs";
import { join } from "path";

const FW_PATH = join(import.meta.dir, "function-words.json");

let fwCache: string[] | null = null;

/** The frozen function-word list, in its committed order. */
export function functionWords(): string[] {
  if (!fwCache) fwCache = (JSON.parse(readFileSync(FW_PATH, "utf8")) as { words: string[] }).words;
  return fwCache;
}

/** sha256 of the frozen list file — committed into the preregistration. */
export function functionWordsHash(): string {
  const h = new Bun.CryptoHasher("sha256");
  h.update(readFileSync(FW_PATH));
  return h.digest("hex");
}

export function tokens(text: string): string[] {
  return text.toLowerCase().match(/[a-z']+/g) || [];
}

export function sentences(text: string): string[] {
  return text
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?])["')\]]?\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// ---- MTLD ------------------------------------------------------------------
// Measure of Textual Lexical Diversity. Walk the text accumulating types; every time the running
// TTR drops below the factor (0.72 is the standard), close a "factor" and restart. MTLD is the
// mean number of words per factor, averaged forward and backward.

export const MTLD_FACTOR = 0.72;

function mtldPass(t: string[]): number {
  let factors = 0;
  let types = new Set<string>();
  let count = 0;
  for (const w of t) {
    count++;
    types.add(w);
    const ttr = types.size / count;
    if (ttr <= MTLD_FACTOR) {
      factors++;
      types = new Set();
      count = 0;
    }
  }
  // partial trailing factor, weighted by how far it got toward the threshold
  if (count > 0) {
    const ttr = types.size / count;
    factors += (1 - ttr) / (1 - MTLD_FACTOR);
  }
  return factors > 0 ? t.length / factors : t.length;
}

export function mtld(text: string): number {
  const t = tokens(text);
  if (t.length < 10) return 0;
  return (mtldPass(t) + mtldPass([...t].reverse())) / 2;
}

// ---- Colin markers ---------------------------------------------------------

/** Words Colin spells his own way that are NOT errors — British variants, coinages. */
let lexiconCache: Set<string> | null = null;
export function colinLexicon(): Set<string> {
  if (lexiconCache) return lexiconCache;
  const p = join(import.meta.dir, "..", "corpus", "colin-lexicon.json");
  try {
    const j = JSON.parse(readFileSync(p, "utf8")) as { allowed: string[] };
    lexiconCache = new Set(j.allowed.map((w) => w.toLowerCase()));
  } catch {
    lexiconCache = new Set();
  }
  return lexiconCache;
}

let dictCache: Set<string> | null = null;
/** The system dictionary. Absent on some machines — misspelling rate then reports as null. */
export function systemDictionary(): Set<string> | null {
  if (dictCache) return dictCache;
  for (const p of ["/usr/share/dict/words", "/usr/dict/words"]) {
    try {
      const raw = readFileSync(p, "utf8");
      dictCache = new Set(raw.split("\n").map((w) => w.trim().toLowerCase()).filter(Boolean));
      return dictCache;
    } catch {
      /* try the next path */
    }
  }
  return null;
}

// ---- misspelling detection -------------------------------------------------
// A first attempt simply counted tokens absent from /usr/share/dict/words. It reported ~90 per
// 1,000 words in EVERY register, which is nonsense: the flags were "taboost", "repo", "api",
// "github", "don't", "reacting", "committed". It was measuring vocabulary, not spelling.
//
// The working definition: A MISSPELLING IS A NEAR-MISS OF A REAL WORD. "totaly" is one edit from
// "totally"; "diffrently" one from "differently"; "Euthinasia" one from "euthanasia". Jargon and
// proper nouns are near nothing, so they fall out for free rather than needing an ever-growing
// allowlist. Anything not in the dictionary and not within one edit is out-of-vocabulary, which is
// reported separately and never counted as an error.

const ALPHABET = "abcdefghijklmnopqrstuvwxyz";

/** Every string one edit away — deletions, transpositions, substitutions, insertions. */
export function edits1(word: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < word.length; i++) {
    out.add(word.slice(0, i) + word.slice(i + 1)); // deletion
    if (i < word.length - 1) {
      out.add(word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2)); // transposition
    }
    for (const c of ALPHABET) {
      out.add(word.slice(0, i) + c + word.slice(i + 1)); // substitution
      out.add(word.slice(0, i) + c + word.slice(i)); // insertion
    }
  }
  for (const c of ALPHABET) out.add(word + c);
  return out;
}

/** Regular morphology the dictionary does not list: plurals, tenses, comparatives, adverbs. */
export function morphVariants(w: string): string[] {
  const v = [w];
  const push = (s: string) => { if (s.length >= 2) v.push(s); };
  for (const suf of ["s", "es", "ed", "ing", "er", "est", "ly", "ment", "ness", "d", "n"]) {
    if (!w.endsWith(suf) || w.length <= suf.length + 1) continue;
    const stem = w.slice(0, -suf.length);
    push(stem);
    push(stem + "e"); // financing -> finance, verified -> verifie -> verify
    if (/(.)\1$/.test(stem)) push(stem.slice(0, -1)); // committed -> commit
    if (stem.endsWith("i")) push(stem.slice(0, -1) + "y"); // verified -> verify
  }
  return v;
}

export interface SpellVerdict {
  /** Not in the dictionary, but within one edit of a real word — a genuine error. */
  misspellings: string[];
  /** Not in the dictionary and near nothing — jargon, proper nouns, handles. Not errors. */
  outOfVocabulary: string[];
}

/**
 * Tokens that are ALWAYS capitalised in the source: proper nouns and acronyms.
 * Without this, "Steinbock" scores as a misspelling of "steinbok" (an antelope, genuinely in the
 * dictionary) and "VAE" as a misspelling of "van". Names are not spelling errors.
 */
export function properNouns(text: string): Set<string> {
  const seen = new Map<string, { total: number; capped: number }>();
  for (const m of text.match(/[A-Za-z][A-Za-z']*/g) || []) {
    const k = m.toLowerCase();
    const e = seen.get(k) ?? { total: 0, capped: 0 };
    e.total++;
    if (/^[A-Z]/.test(m)) e.capped++;
    seen.set(k, e);
  }
  const out = new Set<string>();
  for (const [k, e] of seen) if (e.capped === e.total) out.add(k);
  return out;
}

/**
 * Short tokens are within one edit of *something* by sheer combinatorics — "repo" reaches "rep",
 * "json" reaches "son", "taboost" reaches "taboos". Below this length the near-miss rule carries no
 * information, so a short out-of-dictionary token is treated as vocabulary rather than error.
 */
export const MIN_MISSPELLING_LEN = 6;

/**
 * @param vocabulary Tokens Colin uses habitually, from corpus/data/vocabulary.json. Nobody
 *   misspells the same word 200 times consistently, so a token that recurs across the corpus is his
 *   vocabulary — jargon, a product name, a handle — not an error. This is the honest discriminator:
 *   "euthinasia" appears 6 times in one document, "taboost" 208 times across hundreds.
 */
export function spellCheck(
  text: string,
  dict: Set<string>,
  allow: Set<string>,
  vocabulary: Set<string> = new Set(),
): SpellVerdict {
  const misspellings: string[] = [];
  const outOfVocabulary: string[] = [];
  const proper = properNouns(text);

  for (const raw of tokens(text)) {
    if (proper.has(raw)) continue;
    // Contractions: check the part before the apostrophe ("don't" -> "don" is in the dictionary).
    const w = raw.includes("'") ? raw.split("'")[0] : raw;
    if (w.length < 3) continue;
    if (allow.has(w) || allow.has(raw)) continue;
    if (morphVariants(w).some((v) => dict.has(v))) continue;

    if (vocabulary.has(w) || w.length < MIN_MISSPELLING_LEN) {
      outOfVocabulary.push(w);
      continue;
    }
    const near = [...edits1(w)].some((e) => e.length >= 3 && dict.has(e));
    if (near) misspellings.push(w);
    else outOfVocabulary.push(w);
  }
  return { misspellings, outOfVocabulary };
}

let vocabCache: Set<string> | null = null;
/** Colin's habitual out-of-dictionary vocabulary, built by corpus/vocabulary.ts. */
export function corpusVocabulary(): Set<string> {
  if (vocabCache) return vocabCache;
  const p = join(import.meta.dir, "..", "corpus", "data", "vocabulary.json");
  try {
    const j = JSON.parse(readFileSync(p, "utf8")) as { words: string[] };
    vocabCache = new Set(j.words);
  } catch {
    vocabCache = new Set();
  }
  return vocabCache;
}

export interface Markers {
  /**
   * Genuine misspellings per 1,000 words — out-of-dictionary AND within one edit of a real word.
   * null when no system dictionary is available (unmeasured, which is not the same as zero).
   */
  misspellingRate: number | null;
  /** Jargon, proper nouns, handles per 1,000 words. Reported, never counted as error. */
  outOfVocabRate: number | null;
  /** En-dash used where a hyphen or em-dash belongs, per 1,000 words. */
  enDashAsHyphenRate: number;
  /** ". ." — the doubled-period tic, per 1,000 words. */
  doubledPeriodRate: number;
  /** **bold** appearing mid-paragraph rather than as a heading, per 1,000 words. */
  boldMidParagraphRate: number;
  /** Fraction of sentences beginning with a lowercase letter. */
  lowercaseStartRate: number;
  /** Contractions per 100 words. */
  contractionRate: number;
}

export function markers(text: string): Markers {
  const t = tokens(text);
  const n = t.length || 1;
  const per1k = (c: number) => (c / n) * 1000;
  const sents = sentences(text);
  const alphaStarts = sents.filter((s) => /^[a-zA-Z]/.test(s));

  const dict = systemDictionary();
  let misspellingRate: number | null = null;
  let outOfVocabRate: number | null = null;
  if (dict) {
    const v = spellCheck(text, dict, colinLexicon(), corpusVocabulary());
    misspellingRate = per1k(v.misspellings.length);
    outOfVocabRate = per1k(v.outOfVocabulary.length);
  }

  return {
    misspellingRate,
    outOfVocabRate,
    // an en-dash flanked by word characters, or spaced as an em-dash would be
    enDashAsHyphenRate: per1k((text.match(/\w–\w|\s–\s|–\s/g) || []).length),
    doubledPeriodRate: per1k((text.match(/\.\s+\./g) || []).length),
    boldMidParagraphRate: per1k((text.match(/(?<!^)(?<!\n)\*\*[^*\n]+\*\*/gm) || []).length),
    lowercaseStartRate: alphaStarts.length
      ? alphaStarts.filter((s) => /^[a-z]/.test(s)).length / alphaStarts.length
      : 0,
    contractionRate: (((text.match(/\b\w+'(t|s|re|ve|ll|d|m)\b/gi) || []).length) / n) * 100,
  };
}

// ---- the feature vector ----------------------------------------------------

export interface FeatureVector {
  wordCount: number;
  sentenceCount: number;
  meanSentenceWords: number;
  sdSentenceWords: number;
  p10SentenceWords: number;
  p90SentenceWords: number;
  /** Per 100 words. */
  commaRate: number;
  semicolonRate: number;
  emDashRate: number;
  periodRate: number;
  colonRate: number;
  commasPerSentence: number;
  mtld: number;
  /** Relative frequency of each frozen function word, same order as functionWords(). */
  functionWordFreqs: number[];
  markers: Markers;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function sd(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

export function percentile(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo);
}

export function features(text: string): FeatureVector {
  const t = tokens(text);
  const n = t.length || 1;
  const sents = sentences(text);
  const lens = sents.map((s) => (s.match(/\S+/g) || []).length).filter((x) => x > 0);
  const per100 = (c: number) => (c / n) * 100;

  const counts = new Map<string, number>();
  for (const w of t) counts.set(w, (counts.get(w) ?? 0) + 1);

  return {
    wordCount: t.length,
    sentenceCount: sents.length,
    meanSentenceWords: mean(lens),
    sdSentenceWords: sd(lens),
    p10SentenceWords: percentile(lens, 0.1),
    p90SentenceWords: percentile(lens, 0.9),
    commaRate: per100((text.match(/,/g) || []).length),
    semicolonRate: per100((text.match(/;/g) || []).length),
    emDashRate: per100((text.match(/—/g) || []).length),
    periodRate: per100((text.match(/\./g) || []).length),
    colonRate: per100((text.match(/:/g) || []).length),
    commasPerSentence: sents.length ? (text.match(/,/g) || []).length / sents.length : 0,
    mtld: mtld(text),
    functionWordFreqs: functionWords().map((w) => (counts.get(w) ?? 0) / n),
    markers: markers(text),
  };
}

/** Aggregate several texts as one sample — Delta needs >=1,000 words to be stable. */
export function featuresOfMany(texts: string[]): FeatureVector {
  return features(texts.join("\n\n"));
}
