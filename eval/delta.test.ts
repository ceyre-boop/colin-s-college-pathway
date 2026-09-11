import { test, expect, describe } from "bun:test";
import {
  reference, delta, withinColinBand, judge, generalImposters,
  aggregate, meanVector, percentile, mulberry32, MIN_DOCS_FOR_BAND,
} from "./delta.ts";
import { features } from "./stylometry.ts";

/** Deterministic pseudo-prose so tests do not depend on the corpus being present. */
function proseA(n: number): string[] {
  const s = [
    "The argument is that the distinction between the two cases does not hold when you look at it closely.",
    "I think the real difference is not moral at all but a matter of habit and of what we are used to.",
    "When the outcome is the same and the intention is the same, the form of the action cannot carry the weight.",
    "It helps to lay out the definitions first, because the categories are doing less work than they appear to.",
  ];
  return Array.from({ length: n }, (_, i) => s[i % s.length] + ` This is document ${i} of the set.`);
}

function proseB(n: number): string[] {
  const s = [
    "ok so basically the thing here is that it never works like you'd expect and that's fine",
    "yeah just push it and we'll see what breaks, no point overthinking this one right now",
    "idk it might be the config but honestly i'd just rerun it first before digging in",
    "that's done. next thing is the queue, which i think is mostly fine already",
  ];
  return Array.from({ length: n }, (_, i) => s[i % s.length] + ` run ${i}.`);
}

describe("delta", () => {
  test("REGRESSION: a two-sample reference makes every Delta exactly sqrt(2)", () => {
    // The original bug. With n=2 the sd of each feature is |a-b|/sqrt(2), so |z_a - z_b| collapses
    // to sqrt(2) for every feature and every comparison — the band came out as [1.414, 1.414].
    const a = features(proseA(4).join(" "));
    const b = features(proseB(4).join(" "));
    const twoSample = delta(a, b, reference([a, b]));
    expect(twoSample).toBeCloseTo(Math.SQRT2, 5);

    // Built against a real corpus, Delta actually varies.
    const corpus = [...proseA(8), ...proseB(8)].map((t) => features(t));
    const real = delta(a, b, reference(corpus));
    expect(Math.abs(real - Math.SQRT2)).toBeGreaterThan(0.01);
  });

  test("a text is nearer itself than a different register", () => {
    const corpus = [...proseA(8), ...proseB(8)].map((t) => features(t));
    const ref = reference(corpus);
    const a1 = features(proseA(6).join(" "));
    const a2 = features(proseA(6).reverse().join(" "));
    const b = features(proseB(6).join(" "));
    expect(delta(a1, a2, ref)).toBeLessThan(delta(a1, b, ref));
  });

  test("zero-variance features are skipped rather than producing Infinity", () => {
    const a = features(proseA(4).join(" "));
    const d = delta(a, a, { means: new Array(150).fill(0), sds: new Array(150).fill(0) });
    expect(Number.isNaN(d)).toBe(true); // nothing usable, reported as such
  });
});

describe("withinColinBand", () => {
  test("produces a non-degenerate band from enough documents", () => {
    const b = withinColinBand(proseA(20), { iterations: 200 });
    expect(b.underpowered).toBe(false);
    expect(b.low).toBeLessThan(b.high);
    expect(Math.abs(b.median - Math.SQRT2)).toBeGreaterThan(0.01);
  });

  test("refuses to estimate a band below the document floor", () => {
    const b = withinColinBand(proseA(MIN_DOCS_FOR_BAND - 1), { iterations: 50 });
    expect(b.underpowered).toBe(true);
    expect(Number.isNaN(b.median)).toBe(true);
  });

  test("is deterministic for a given seed", () => {
    const a = withinColinBand(proseA(12), { iterations: 100, seed: 42 });
    const b = withinColinBand(proseA(12), { iterations: 100, seed: 42 });
    expect(a.median).toBe(b.median);
  });
});

describe("judge", () => {
  const band = { median: 0.2, low: 0.15, high: 0.3, iterations: 100, documents: 20, underpowered: false };

  test("calls a value inside the band inside", () => {
    const v = judge(0.25, band);
    expect(v.inside).toBe(true);
    expect(v.statement).toMatch(/INSIDE/);
  });

  test("calls a value above the band outside, and says the claim is false", () => {
    const v = judge(0.9, band);
    expect(v.inside).toBe(false);
    expect(v.statement).toMatch(/OUTSIDE/);
    expect(v.statement).toMatch(/claim is false/);
  });

  test("gives no verdict when the band is underpowered, rather than a misleading pass", () => {
    const weak = { ...band, underpowered: true, documents: 2, high: Number.NaN };
    const v = judge(0.25, weak);
    expect(v.inside).toBeNull();
    expect(v.statement).toMatch(/No verdict/);
  });

  test("always reports the band alongside the observed value", () => {
    expect(judge(0.25, band).statement).toMatch(/within-Colin band/);
  });
});

describe("generalImposters", () => {
  test("scores a candidate written like Colin above one written like the impostors", () => {
    const colin = proseA(6);
    const impostors = [proseB(6)];
    const likeColin = generalImposters(proseA(3).join(" "), colin, impostors, { trials: 100 });
    const likeImpostor = generalImposters(proseB(3).join(" "), colin, impostors, { trials: 100 });
    expect(likeColin.score).toBeGreaterThan(likeImpostor.score);
  });

  test("reports how many trials actually ran", () => {
    const r = generalImposters(proseA(2).join(" "), proseA(4), [proseB(4)], { trials: 50 });
    expect(r.trials).toBeGreaterThan(0);
    expect(r.impostors).toBe(1);
  });
});

describe("aggregate", () => {
  test("chunks up to the minimum word count", () => {
    const docs = Array.from({ length: 30 }, () => "word ".repeat(100).trim());
    const out = aggregate(docs, 1000);
    expect(out.length).toBeLessThanOrEqual(3);
    for (const c of out) expect((c.match(/\S+/g) || []).length).toBeGreaterThanOrEqual(1000);
  });

  test("folds a short remainder into the last chunk rather than emitting an undersized one", () => {
    const docs = [..."x".repeat(1).split(""), "word ".repeat(1100).trim(), "short tail here"];
    const out = aggregate(docs, 1000);
    expect(out[out.length - 1]).toMatch(/short tail here/);
  });

  test("never returns nothing when given something", () => {
    expect(aggregate(["a few words only"], 1000).length).toBe(1);
  });
});

describe("helpers", () => {
  test("meanVector averages function-word profiles", () => {
    const fs = [features(proseA(3).join(" ")), features(proseB(3).join(" "))];
    const m = meanVector(fs);
    expect(m.functionWordFreqs[0]).toBeCloseTo((fs[0].functionWordFreqs[0] + fs[1].functionWordFreqs[0]) / 2, 10);
  });

  test("percentile interpolates and is safe when empty", () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBeCloseTo(2.5, 5);
    expect(Number.isNaN(percentile([], 0.5))).toBe(true);
  });

  test("mulberry32 is deterministic", () => {
    expect(mulberry32(5)()).toBe(mulberry32(5)());
  });
});
