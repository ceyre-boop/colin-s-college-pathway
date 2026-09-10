import { test, expect, describe } from "bun:test";
import {
  features, mtld, markers, sentences, tokens, percentile,
  spellCheck, edits1, morphVariants, properNouns,
  systemDictionary, colinLexicon, corpusVocabulary, functionWords, functionWordsHash,
} from "./stylometry.ts";

describe("frozen function-word list", () => {
  test("has the committed length and no duplicates", () => {
    const fw = functionWords();
    expect(fw.length).toBe(150);
    expect(new Set(fw).size).toBe(fw.length);
  });

  test("hash is stable across calls — it is what the preregistration commits", () => {
    expect(functionWordsHash()).toBe(functionWordsHash());
    expect(functionWordsHash()).toMatch(/^[0-9a-f]{64}$/);
  });

  test("contains no content words — the metric must track style, not topic", () => {
    const fw = new Set(functionWords());
    for (const w of ["tumour", "tumor", "market", "essay", "cancer", "trading", "scholarship"]) {
      expect(fw.has(w)).toBe(false);
    }
  });
});

describe("sentence splitting", () => {
  test("splits on terminal punctuation and keeps content", () => {
    expect(sentences("One. Two! Three? Four")).toHaveLength(4);
  });
  test("treats newlines as whitespace, not breaks", () => {
    expect(sentences("A sentence\nthat wraps. Another.")).toHaveLength(2);
  });
});

describe("mtld", () => {
  test("is roughly length-invariant, unlike raw TTR", () => {
    // Raw TTR would fall sharply as this repeats; MTLD should not.
    const unit = "the quick brown fox jumps over a lazy dog while birds sing loudly nearby today ";
    const short = mtld(unit.repeat(4));
    const long = mtld(unit.repeat(16));
    expect(Math.abs(short - long) / short).toBeLessThan(0.35);
  });

  test("returns 0 for text too short to measure", () => {
    expect(mtld("too short")).toBe(0);
  });

  test("low-diversity text scores below high-diversity text", () => {
    const dull = "the the the and and and of of of the and of ".repeat(10);
    const rich = "cathedral orbit fennel gravity mattress plumage vinegar lantern thistle harbour ".repeat(10);
    expect(mtld(rich)).toBeGreaterThan(mtld(dull));
  });
});

describe("spellCheck", () => {
  const dict = systemDictionary();
  const allow = colinLexicon();

  test("a dictionary is available on this machine", () => {
    expect(dict).not.toBeNull();
  });

  test("catches a real near-miss misspelling", () => {
    if (!dict) return;
    const v = spellCheck("that was totaly the point", dict, allow);
    expect(v.misspellings).toContain("totaly");
  });

  test("does NOT flag habitual jargon — recurrence across documents means vocabulary, not error", () => {
    if (!dict) return;
    // This is the real code path: markers() always passes the corpus vocabulary.
    const v = spellCheck("the taboost repo needs a json config", dict, allow, corpusVocabulary());
    expect(v.misspellings).toEqual([]);
    expect(v.outOfVocabulary).toContain("taboost");
  });

  test("short out-of-dictionary tokens are never errors — combinatorics, not spelling", () => {
    if (!dict) return;
    // "repo" reaches "rep" and "json" reaches "son" in one edit purely because they are short.
    const v = spellCheck("the repo and the json", dict, allow);
    expect(v.misspellings).toEqual([]);
  });

  test("does NOT flag proper nouns even when one edit from a real word", () => {
    if (!dict) return;
    // "Steinbock" is one edit from "steinbok", an antelope that is genuinely in the dictionary.
    const v = spellCheck("Steinbock disagrees completely. Steinbock worries about doctors.", dict, allow);
    expect(v.misspellings).not.toContain("steinbock");
  });

  test("does NOT flag contractions or regular morphology", () => {
    if (!dict) return;
    const v = spellCheck("i don't think reacting and committing were verified or financing it", dict, allow);
    for (const w of ["don", "reacting", "committing", "verified", "financing"]) {
      expect(v.misspellings).not.toContain(w);
    }
  });

  test("respects the Colin lexicon — British variants are not errors", () => {
    if (!dict) return;
    const v = spellCheck("we should recognise the agonising delay", dict, allow);
    expect(v.misspellings).not.toContain("recognise");
    expect(v.misspellings).not.toContain("agonising");
  });
});

describe("edits1 / morphVariants", () => {
  test("edits1 reaches the intended correction in one step", () => {
    expect(edits1("totaly").has("totally")).toBe(true);
    expect(edits1("diffrently").has("differently")).toBe(true);
    expect(edits1("euthinasia").has("euthanasia")).toBe(true);
  });

  test("morphVariants recovers the stem across common suffixes", () => {
    expect(morphVariants("committed")).toContain("commit");
    expect(morphVariants("financing")).toContain("finance");
    expect(morphVariants("verified")).toContain("verify");
  });

  test("properNouns keeps only always-capitalised tokens", () => {
    const p = properNouns("Rachels argues. The rachels lowercase form appears. Steinbock only capitalised.");
    expect(p.has("steinbock")).toBe(true);
    expect(p.has("rachels")).toBe(false); // appears lowercase once
  });
});

describe("markers", () => {
  test("counts the doubled-period tic", () => {
    expect(markers("one thing here. . and another thing there").doubledPeriodRate).toBeGreaterThan(0);
  });

  test("counts en-dash used as a hyphen or em-dash", () => {
    expect(markers("the word –killing– brings fear and discomfort here").enDashAsHyphenRate).toBeGreaterThan(0);
  });

  test("counts bold appearing mid-paragraph", () => {
    expect(markers("we know that **intention matters more** than the act itself").boldMidParagraphRate).toBeGreaterThan(0);
  });

  test("lowercaseStartRate separates a lowercase register from a capitalised one", () => {
    const lower = markers("ok so this is the thing. and then this. also that.").lowercaseStartRate;
    const upper = markers("This is the thing. And then this. Also that.").lowercaseStartRate;
    expect(lower).toBeGreaterThan(0.8);
    expect(upper).toBe(0);
  });
});

describe("features", () => {
  const f = features("A short one. A somewhat longer sentence here, with a comma. And a third!");

  test("produces one frequency per frozen function word", () => {
    expect(f.functionWordFreqs).toHaveLength(functionWords().length);
  });

  test("frequencies are relative, so they sum to at most 1", () => {
    expect(f.functionWordFreqs.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(1);
  });

  test("counts sentences and words", () => {
    expect(f.sentenceCount).toBe(3);
    expect(f.wordCount).toBeGreaterThan(10);
  });
});

describe("percentile", () => {
  test("interpolates between ranks", () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBeCloseTo(2.5, 5);
    expect(percentile([1, 2, 3, 4], 0)).toBe(1);
    expect(percentile([1, 2, 3, 4], 1)).toBe(4);
  });
  test("is safe on an empty sample", () => {
    expect(percentile([], 0.5)).toBe(0);
  });
});

describe("tokens", () => {
  test("keeps apostrophes so contractions survive as one token", () => {
    expect(tokens("don't stop")).toEqual(["don't", "stop"]);
  });
});
