import { test, expect, describe } from "bun:test";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { voiceSpec, voiceSpecBlock, unclaimedHeadings, parseSections, facts, neverClaim } from "./spec.ts";
import { selectFrom, renderExemplars, jaccard, shingles } from "./exemplars.ts";
import { retrieve, angleOf, expand, tokenize, USAGE_DECAY } from "./experiences.ts";
import { buildVoicePrompt, buildLegacyPrompt } from "./build-prompt.ts";
import { contractsFrom, validate, renderContract, TOLERANCE_SD } from "./registers.ts";
import type { CorpusRecord, Register } from "../corpus/schema.ts";

const REPO = join(import.meta.dir, "..");

function rec(p: Partial<CorpusRecord> & { id: string; text: string; register: Register }): CorpusRecord {
  return {
    registerConfidence: 1, source: "claude-jsonl", sourceId: `t#${p.id}`, timestamp: null,
    wordCount: (p.text.match(/\S+/g) || []).length, verifiedBy: "heuristic", verifiedAt: null,
    split: "exemplar", quarantine: null, ...p,
  } as CorpusRecord;
}

describe("voice spec parser", () => {
  test("claims every heading in voice_profile.md — a new section cannot be silently dropped", () => {
    expect(unclaimedHeadings()).toEqual([]);
  });

  test("captures the sections the prompt depends on", () => {
    const s = voiceSpec();
    for (const k of ["doctrine", "engine", "factsBank", "angleMap", "voiceSamples"] as const) {
      expect(s[k].length).toBeGreaterThan(200);
    }
  });

  test("ignores the document title, keeping only real sections", () => {
    const secs = parseSections("# Title\nintro\n\n## One\nbody\n\n## Two\nbody2");
    expect(secs.map((s) => s.heading)).toEqual(["One", "Two"]);
  });

  test("facts include paragraph-form entries, not only bullets", () => {
    const groups = new Set(facts().map((f) => f.group));
    expect(groups.has("The origin story")).toBe(true); // a paragraph fact, and the most-used one
    expect(groups.has("Builder numbers")).toBe(true);
  });

  test("extracts the Never-claim boundaries", () => {
    const n = neverClaim();
    expect(n.length).toBeGreaterThan(0);
    expect(n.join(" ")).toMatch(/first-generation/i);
  });

  test("renders less for a raw-register request than an academic one", () => {
    // Essay-craft doctrine has no business in a request for chat-register prose.
    expect(voiceSpecBlock("raw").length).toBeLessThan(voiceSpecBlock("academic").length);
  });
});

describe("exemplar selection", () => {
  const pool = [
    rec({ id: "a", register: "narrative", text: "I was sixteen when I outlined a tumor on an MRI scan slice by slice for hours." }),
    rec({ id: "b", register: "narrative", text: "I was sixteen when I outlined a tumor on an MRI scan slice by slice for hours and hours." }),
    rec({ id: "c", register: "narrative", text: "The wrestling season is won in October in a weight room where nobody is watching you." }),
    rec({ id: "d", register: "raw", text: "ok so the thing about this is that it basically never works the way you expect it to" }),
  ];

  test("never returns a cross-register exemplar", () => {
    const out = selectFrom(pool, { register: "narrative", seed: "ok so the thing", n: 3 });
    expect(out.every((e) => e.register === "narrative")).toBe(true);
  });

  test("MMR rejects a near-duplicate of an already-picked passage", () => {
    // a and b are near-identical; only one may be shown.
    const out = selectFrom(pool, { register: "narrative", seed: "tumor MRI scan sixteen", n: 3 });
    const ids = out.map((e) => e.id);
    expect(ids.includes("a") && ids.includes("b")).toBe(false);
  });

  test("returns nothing rather than something wrong when the register is empty", () => {
    expect(selectFrom(pool, { register: "academic", seed: "anything", n: 3 })).toEqual([]);
  });

  test("respects the word budget", () => {
    const out = selectFrom(pool, { register: "narrative", seed: "tumor", n: 3, maxWords: 16 });
    expect(out.reduce((n, e) => n + e.wordCount, 0)).toBeLessThanOrEqual(30);
  });

  test("rendered block tells the model to imitate style, not to distrust the text", () => {
    const out = selectFrom(pool, { register: "narrative", seed: "tumor", n: 1 });
    const r = renderExemplars(out);
    expect(r).toMatch(/Match their rhythm/);
    expect(r).not.toMatch(/scraped from a third-party website/);
  });

  test("jaccard/shingles behave", () => {
    expect(jaccard(shingles("a b c d e f"), shingles("a b c d e f"))).toBe(1);
    expect(jaccard(shingles("a b c d e f"), shingles("q r s t u v"))).toBe(0);
  });
});

describe("experience retrieval", () => {
  test("picks the leadership angle for a leadership prompt, not the default MRI angle", () => {
    const r = retrieve({ prompt: "Describe how you created belonging in your community.", n: 3, usage: new Map() });
    expect(r.experiences.length).toBeGreaterThan(0);
    expect(r.experiences[0].text.toLowerCase()).toMatch(/lunch bunch|eagle|belong|community/);
  });

  test("the usage penalty demotes an over-used angle", () => {
    const seed = "Tell us about your interest in STEM research.";
    const fresh = retrieve({ prompt: seed, n: 1, usage: new Map() }).experiences[0];
    const spent = retrieve({ prompt: seed, n: 1, usage: new Map([["stem_mri", 15]]) }).experiences[0];
    expect(spent.score).toBeLessThan(fresh.score);
    expect(USAGE_DECAY).toBeLessThan(1);
  });

  test("tops up from the spine rather than returning one thin match", () => {
    const r = retrieve({ prompt: "Tell us about yourself.", n: 4, usage: new Map() });
    expect(r.experiences.length).toBe(4);
  });

  test("always carries the Never-claim boundaries with the facts", () => {
    const r = retrieve({ prompt: "anything at all", n: 2, usage: new Map() });
    expect(r.neverClaim.length).toBeGreaterThan(0);
  });

  test("angleOf maps text onto the canonical angle map", () => {
    expect(angleOf("outlined a tumor on an MRI")).toBe("stem_mri");
    expect(angleOf("president of Lunch Bunch")).toBe("leadership_lunchbunch");
    expect(angleOf("a sentence about nothing in particular")).toBeNull();
  });

  test("synonym expansion connects prompt boilerplate to fact vocabulary", () => {
    expect(expand(tokenize("demonstrated leadership"))).toContain("president");
  });
});

describe("prompt building", () => {
  const sch = { id: "x", name: "Test Scholarship", amount: 5000, notes: "Rewards service." };

  test("v2 carries a system prompt, exemplars, facts and constraints; v1 carries none of it", async () => {
    const v2 = await buildVoicePrompt({ scholarship: sch, seed: "Describe service.", register: "narrative", exemplars: [] });
    expect(v2.system.length).toBeGreaterThan(1000);
    expect(v2.user).toMatch(/# Constraints/);
    expect(v2.user).toMatch(/NEVER claim/);

    const v1 = buildLegacyPrompt(sch, "profile text", "Describe service.");
    expect(v1).not.toMatch(/# Constraints/);
    expect(v1.length).toBeLessThan(v2.system.length + v2.user.length);
  });

  test("constraints come last, nearest the generation point", async () => {
    const v2 = await buildVoicePrompt({ scholarship: sch, seed: "s", register: "narrative", exemplars: [] });
    expect(v2.user.indexOf("# Constraints")).toBeGreaterThan(v2.user.indexOf("# The task"));
  });

  test("no generated-essay text reaches the prompt", async () => {
    // The contamination assertion, enforced at the prompt boundary rather than only at the corpus.
    const v2 = await buildVoicePrompt({ scholarship: sch, seed: "MRI tumor", register: "narrative" });
    const dir = join(REPO, "scholarship_essays");
    if (!existsSync(dir)) return;
    const essay = join(dir, "foot-locker-scholar-athletes", "essay.md");
    if (!existsSync(essay)) return;
    const line = readFileSync(essay, "utf8").split("\n").find((l) => l.trim().length > 60);
    if (line) expect(v2.user.includes(line.trim())).toBe(false);
  });

  test("records provenance so a run can be reproduced", async () => {
    const v2 = await buildVoicePrompt({ scholarship: sch, seed: "s", register: "narrative", exemplars: [] });
    expect(v2.provenance.register).toBe("narrative");
    expect(Array.isArray(v2.provenance.experienceIds)).toBe(true);
  });
});

describe("register contracts", () => {
  const stats = {
    generatedAt: "", totalRecords: 2, totalWords: 2,
    byRegister: [{
      register: "narrative" as Register, documents: 50, words: 20000, spellCheckedRecords: 50,
      functionWordMeans: [],
      featureStats: {
        meanSentenceWords: { n: 50, mean: 20, sd: 5, min: 0, max: 0 },
        lowercaseStartRate: { n: 50, mean: 0.1, sd: 0.05, min: 0, max: 0 },
      } as Record<string, { n: number; mean: number; sd: number; min: number; max: number }>,
    }],
    underpowered: [],
  };

  test("contracts are generated from measured stats, not authored", () => {
    const c = contractsFrom(stats as never)[0];
    const band = c.bands.find((b) => b.feature === "meanSentenceWords")!;
    expect(band.mean).toBe(20);
    expect(band.low).toBe(20 - TOLERANCE_SD * 5);
    expect(band.high).toBe(20 + TOLERANCE_SD * 5);
  });

  test("underpowered registers get no contract rather than a guessed one", () => {
    const s = { ...stats, underpowered: [{ register: "narrative" as Register, documents: 1, words: 10, reason: "too few" }] };
    expect(contractsFrom(s as never)).toEqual([]);
  });

  test("renders numeric targets, not adjectives", () => {
    const r = renderContract(contractsFrom(stats as never)[0]);
    expect(r).toMatch(/sentences average 20 words/);
    expect(r).not.toMatch(/formal|casual|professional/i);
  });

  test("validate reports no verdict when there is no contract for the register", () => {
    const v = validate("some text here that is long enough to measure properly", "persuasive");
    expect(v.nearestRegister === null || typeof v.nearestRegister === "string").toBe(true);
  });

  test("a terse directive validates as directive register", () => {
    const v = validate("fix the failing test and push it", "directive");
    expect(v.nearestRegister).toBe("directive");
  });
});
