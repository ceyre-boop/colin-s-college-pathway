// The test that underwrites every other result in this project.
//
// If it fails, no eval number below it means anything: a corpus containing generated-essay text
// makes the system look like it reproduces Colin when it reproduces an LLM imitating Colin.

import { test, expect, describe } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { checkContamination, ngrams, contaminatedNgrams, assertNotContaminated } from "./quarantine.ts";
import { PATHS, readJsonl, type CorpusRecord } from "./schema.ts";

const REPO = join(import.meta.dir, "..");

describe("ngram guard", () => {
  test("detects an exact 8-gram lifted from a generated essay", () => {
    const bad = contaminatedNgrams();
    if (bad.size === 0) return; // no essays on disk in this checkout
    const sample = [...bad][0];
    const hit = checkContamination("claude-jsonl/foo.jsonl#1", `padding words here ${sample} and more padding`);
    expect(hit.contaminated).toBe(true);
  });

  test("passes clean prose", () => {
    const hit = checkContamination(
      "claude-jsonl/foo.jsonl#1",
      "the refrigerator makes ice the same way the winter air does which is the entire point",
    );
    expect(hit.contaminated).toBe(false);
  });

  test("rejects by source path regardless of text", () => {
    const hit = checkContamination("scholarship_essays/foo/essay.md", "totally unrelated words");
    expect(hit.contaminated).toBe(true);
  });

  test("ngrams are order-sensitive shingles, not a bag of words", () => {
    const g = ngrams("one two three four five six seven eight nine", 8);
    expect(g.has("one two three four five six seven eight")).toBe(true);
    expect(g.has("nine eight seven six five four three two")).toBe(false);
  });

  test("assertNotContaminated throws with the offending ngram named", () => {
    const bad = contaminatedNgrams();
    if (bad.size === 0) return;
    const sample = [...bad][0];
    expect(() => assertNotContaminated({ sourceId: "x#1", text: sample })).toThrow(/8-gram/);
  });
});

describe("corpus integrity", () => {
  test("no verified record is contaminated", async () => {
    const rows = await readJsonl<CorpusRecord>(PATHS.verified);
    const offenders = rows
      .map((r) => ({ r, hit: checkContamination(r.sourceId, r.text) }))
      .filter((x) => x.hit.contaminated)
      .map((x) => `${x.r.sourceId}: ${x.hit.reason}`);
    expect(offenders).toEqual([]);
  });

  test("every verified record is human-verified and unquarantined", async () => {
    const rows = await readJsonl<CorpusRecord>(PATHS.verified);
    const bad = rows.filter((r) => r.verifiedBy === null || r.quarantine !== null);
    expect(bad.map((r) => r.sourceId)).toEqual([]);
  });

  test("every gdoc-sourced verified record was verified by Colin, not a heuristic", async () => {
    const rows = await readJsonl<CorpusRecord>(PATHS.verified);
    const bad = rows.filter((r) => r.source === "gdoc" && r.verifiedBy !== "colin");
    expect(bad.map((r) => r.sourceId)).toEqual([]);
  });
});

describe("quarantine file is never read downstream", () => {
  // A grep-based structural assertion. Cheaper and more durable than trusting review: if someone
  // later points the training exporter at quarantine.jsonl, this fails rather than silently
  // poisoning a fine-tune.
  const DIRS = ["voice", "eval", "finetune"];

  function walk(dir: string, out: string[] = []): string[] {
    if (!existsSync(dir)) return out;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p, out);
      else if (/\.(ts|js|tsx|jsx)$/.test(e.name)) out.push(p);
    }
    return out;
  }

  test("nothing under voice/, eval/, or finetune/ references quarantine.jsonl", () => {
    const offenders: string[] = [];
    for (const d of DIRS) {
      for (const f of walk(join(REPO, d))) {
        const src = readFileSync(f, "utf8");
        if (src.includes("quarantine.jsonl") || /PATHS\s*\.\s*quarantine/.test(src)) {
          offenders.push(f.replace(REPO + "/", ""));
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test("corpus data directory is gitignored", () => {
    const gi = readFileSync(join(REPO, ".gitignore"), "utf8");
    expect(gi).toMatch(/corpus\/data/);
  });
});
