import { test, expect, describe } from "bun:test";
import { normalizePassage, buildPairs, accuracy, byRegister, MIN_PASSAGE_WORDS, type Judgement, type Passage } from "./panel.ts";

function words(n: number, w = "word"): string {
  return Array.from({ length: n }, (_, i) => (i % 12 === 11 ? `${w}.` : w)).join(" ");
}

function passage(id: string, n = 300): Passage {
  return { text: words(n), documentId: id, register: "narrative" };
}

describe("normalizePassage", () => {
  test("strips headings, bullets and bold — formatting tells, not voice tells", () => {
    const out = normalizePassage("## Title\n- a point\n**bold here** and text", 100);
    expect(out).not.toMatch(/^##/m);
    expect(out).not.toMatch(/\*\*/);
    expect(out).not.toMatch(/^- /m);
  });

  test("trims to a sentence boundary rather than mid-clause", () => {
    const t = "One sentence here. Two sentence here. Three sentence here. Four sentence here.";
    const out = normalizePassage(t, 8);
    expect(out.endsWith(".")).toBe(true);
  });

  test("leaves a short passage alone", () => {
    expect(normalizePassage("short text", 100)).toBe("short text");
  });
});

describe("buildPairs", () => {
  const colin = [passage("c1"), passage("c2"), passage("c3")];
  const model = [passage("m1"), passage("m2")];

  test("pairs only within the same register", () => {
    const mixed: Passage[] = [{ text: words(300), documentId: "m3", register: "raw" }];
    expect(buildPairs({ colin, model: mixed })).toHaveLength(0);
  });

  test("randomises which side is Colin's", () => {
    const many = Array.from({ length: 40 }, (_, i) => passage(`m${i}`));
    const pairs = buildPairs({ colin, model: many, seed: 5 });
    const aCount = pairs.filter((p) => p.colinSide === "A").length;
    expect(aCount).toBeGreaterThan(5);
    expect(aCount).toBeLessThan(pairs.length - 5);
  });

  test("the stated Colin side actually holds Colin's text", () => {
    const pairs = buildPairs({ colin: [passage("c1", 300)], model: [passage("m1", 300)], seed: 2 });
    for (const p of pairs) {
      const colinText = p.colinSide === "A" ? p.a : p.b;
      expect(colinText.length).toBeGreaterThan(0);
      expect(p.colinDocumentId).toBe("c1");
    }
  });

  test("drops pairs where either side is too short to judge", () => {
    const tiny = [{ text: "only a few words", documentId: "m9", register: "narrative" as const }];
    expect(buildPairs({ colin, model: tiny })).toHaveLength(0);
    expect(MIN_PASSAGE_WORDS).toBeGreaterThan(50);
  });

  test("is deterministic for a seed", () => {
    const a = buildPairs({ colin, model, seed: 9 });
    const b = buildPairs({ colin, model, seed: 9 });
    expect(a.map((p) => p.colinSide)).toEqual(b.map((p) => p.colinSide));
  });
});

describe("accuracy", () => {
  function judgements(correct: number, total: number, docs = 1): Judgement[] {
    return Array.from({ length: total }, (_, i) => ({
      pairId: `p${i}`,
      register: "narrative" as const,
      guess: "A" as const,
      correct: i < correct,
      colinDocumentId: `doc${i % docs}`,
    }));
  }

  test("chance performance is reported as indistinguishable — the success condition", () => {
    const a = accuracy(judgements(20, 40, 20));
    expect(a.accuracy).toBeCloseTo(0.5, 5);
    expect(a.indistinguishable).toBe(true);
  });

  test("perfect discrimination is not indistinguishable", () => {
    const a = accuracy(judgements(40, 40, 20));
    expect(a.accuracy).toBe(1);
    expect(a.indistinguishable).toBe(false);
  });

  test("the cluster bootstrap resamples documents, so few clusters widen the interval", () => {
    // Clusters must differ from each other, which is the situation the cluster bootstrap exists
    // for: one document that is easy to spot and one that is not. Identical clusters carry no
    // between-cluster variance and would produce a zero-width interval by construction.
    const heterogeneous = (docs: number): Judgement[] =>
      Array.from({ length: 40 }, (_, i) => {
        const doc = i % docs;
        return {
          pairId: `p${i}`,
          register: "narrative" as const,
          guess: "A" as const,
          // even-numbered documents are always spotted, odd-numbered never are
          correct: doc % 2 === 0,
          colinDocumentId: `doc${doc}`,
        };
      });

    const many = accuracy(heterogeneous(20));
    const few = accuracy(heterogeneous(2));
    expect(many.accuracy).toBeCloseTo(few.accuracy, 5);
    expect(few.ciHigh - few.ciLow).toBeGreaterThan(many.ciHigh - many.ciLow);
  });

  test("counts clusters, not just judgements", () => {
    const a = accuracy(judgements(10, 20, 4));
    expect(a.n).toBe(20);
    expect(a.clusters).toBe(4);
  });

  test("is safe on an empty panel", () => {
    const a = accuracy([]);
    expect(a.n).toBe(0);
    expect(a.indistinguishable).toBe(false);
  });

  test("byRegister splits the report", () => {
    const js: Judgement[] = [
      { pairId: "1", register: "narrative", guess: "A", correct: true, colinDocumentId: "d1" },
      { pairId: "2", register: "raw", guess: "A", correct: false, colinDocumentId: "d2" },
    ];
    const r = byRegister(js);
    expect(Object.keys(r).sort()).toEqual(["narrative", "raw"]);
  });
});
