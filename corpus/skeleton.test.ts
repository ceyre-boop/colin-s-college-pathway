import { test, expect, describe } from "bun:test";
import { assertNoLeak, rareNouns, seedText, LEAK_NGRAM, MAX_SEED_FRACTION, type SeedSkeleton } from "./skeleton.ts";

// Realistic length matters: the leak checks cap the seed at 12% of the piece, so a toy 110-word
// fixture would fail on length before any interesting check ran. Real pieces are 400-1,400 words.
const CORE = `It is like the creation of ice. Whether you leave water in your refrigerator or outside,
the intermolecular change is the same; it does not matter whether it was artificial or natural, the
outcome is exactly the same. Modern medicine already controls the condition of life or death.
Turning off a ventilator is not letting nature take over. It is making a decision about what counts
as too much suffering. The distinction may help people feel better emotionally, but ultimately it is
nothing more than an ethical loophole. We treat passive interaction as morally cleaner even when the
intention and the outcome are exactly the same in both of the cases being compared here.`;

const FILLER = `The categories look organized on paper and in law, and they are taught that way in
every class, but the reasons behind the decisions do not respect the lines that have been drawn
between them. Autonomy means respecting a person's right to decide. Beneficence means acting so that
suffering is reduced rather than extended. Nonmaleficence means avoiding harm, and that includes the
harm of forcing somebody to endure what they cannot bear. Applied consistently, those principles
erase the sharp divide that the vocabulary works so hard to preserve, and what remains is habit.`;

const PIECE = [CORE, FILLER, FILLER, FILLER].join("\n\n");

function seed(p: Partial<SeedSkeleton> = {}): SeedSkeleton {
  return {
    register: "persuasive",
    targetWords: 120,
    assignmentPrompt: "Argue whether two medical practices differ morally or only technically.",
    thesisAbstract: "They differ by convention rather than by ethics.",
    moves: ["state both positions", "concede the stronger objection", "dismantle it"],
    concreteAnchorLabel: "an everyday physical analogy",
    sourcesReferenced: [],
    ...p,
  };
}

describe("assertNoLeak", () => {
  test("accepts a clean skeleton", () => {
    expect(assertNoLeak(seed(), PIECE).ok).toBe(true);
  });

  test(`rejects a reused ${LEAK_NGRAM}-word phrase from the piece`, () => {
    const s = seed({ thesisAbstract: "the outcome is exactly the same regardless" });
    const r = assertNoLeak(s, PIECE);
    expect(r.ok).toBe(false);
    expect(r.violation).toMatch(/reuses a 4-word phrase/);
  });

  test("rejects a skeleton that names the actual analogy", () => {
    // This is the leak that matters most: the anchor carries the piece's best idea.
    const rare = rareNouns([PIECE], 3);
    const s = seed({ concreteAnchorLabel: "water freezing in a refrigerator" });
    const r = assertNoLeak(s, PIECE, rare);
    expect(r.ok).toBe(false);
    expect(r.violation).toMatch(/names the actual image/);
  });

  test("accepts a generic anchor label even with the rare-noun check active", () => {
    const rare = rareNouns([PIECE], 3);
    expect(assertNoLeak(seed(), PIECE, rare).ok).toBe(true);
  });

  test("rejects a skeleton longer than the allowed fraction of the piece", () => {
    const r = assertNoLeak(seed(), "short piece of text here indeed, only a handful of words long");
    expect(r.ok).toBe(false);
    expect(r.violation).toMatch(/Compress it/);
  });

  test("rejects a move that paraphrases a whole sentence of the piece", () => {
    const s = seed({ moves: ["modern medicine already controls condition life death"] });
    expect(assertNoLeak(s, PIECE).ok).toBe(false);
  });

  test("the fraction cap is a real constraint, not a formality", () => {
    expect(MAX_SEED_FRACTION).toBeLessThan(0.25);
  });
});

describe("rareNouns", () => {
  test("flags words appearing rarely and ignores common ones", () => {
    const r = rareNouns([PIECE], 3);
    expect(r.has("refrigerator")).toBe(true);
    expect(r.has("same")).toBe(false);
  });

  test("ignores very short tokens", () => {
    expect(rareNouns(["a bb ccc dddd"], 3).has("bb")).toBe(false);
  });
});

describe("seedText", () => {
  test("includes every field a leak could hide in", () => {
    const t = seedText(seed());
    expect(t).toMatch(/Argue whether/);
    expect(t).toMatch(/everyday physical analogy/);
    expect(t).toMatch(/dismantle it/);
  });
});
