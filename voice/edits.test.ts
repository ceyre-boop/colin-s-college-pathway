import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { recordRevision } from "./edits.ts";
import { applyOrthography, orthographyDelta, type ErrorTable } from "./orthography.ts";

describe("recordRevision", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "ccp-edits-"));
    const dir = join(root, "scholarship_essays", "test-scholarship");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "metadata.json"), JSON.stringify({
      name: "Test",
      revisions: [{ date: "2026-06-12", by: "draft", note: "Initial AI draft." }],
    }, null, 2));
    writeFileSync(join(dir, "essay.md"), "the original draft text\n");
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test("appends a revision marked by colin — the flag that was 0/20", () => {
    expect(recordRevision("test-scholarship", "the edited text", root)).toBe(true);
    const meta = JSON.parse(readFileSync(join(root, "scholarship_essays", "test-scholarship", "metadata.json"), "utf8"));
    expect(meta.revisions).toHaveLength(2);
    expect(meta.revisions[1].by).toBe("colin");
  });

  test("writes the edited text back to the essay", () => {
    recordRevision("test-scholarship", "the edited text", root);
    expect(readFileSync(join(root, "scholarship_essays", "test-scholarship", "essay.md"), "utf8").trim()).toBe("the edited text");
  });

  test("preserves the existing draft revisions rather than replacing them", () => {
    recordRevision("test-scholarship", "x", root);
    const meta = JSON.parse(readFileSync(join(root, "scholarship_essays", "test-scholarship", "metadata.json"), "utf8"));
    expect(meta.revisions[0].by).toBe("draft");
  });

  test("returns false for an unknown essay rather than creating one", () => {
    expect(recordRevision("does-not-exist", "x", root)).toBe(false);
    expect(existsSync(join(root, "scholarship_essays", "does-not-exist"))).toBe(false);
  });
});

describe("applyOrthography", () => {
  const table: ErrorTable = {
    entries: [
      { correct: "applied", colin: "aplied", count: 4 },
      { correct: "recently", colin: "reccently", count: 3 },
      { correct: "success", colin: "succes", count: 3 },
    ],
  };

  const text = ("The method was applied recently and the success was clear. " .repeat(20)).trim();

  test("introduces observed substitutions, never invented ones", () => {
    const out = applyOrthography(text, "narrative", { rate: 10, table, seed: 1 });
    const introduced = ["aplied", "reccently", "succes"].filter((w) => out.includes(w));
    expect(introduced.length).toBeGreaterThan(0);
  });

  test("does nothing without an empirical table — an invented rate would look like evidence", () => {
    expect(applyOrthography(text, "narrative", { rate: 10, table: { entries: [] } })).toBe(text);
  });

  test("does nothing when the rate is unmeasured or zero", () => {
    expect(applyOrthography(text, "narrative", { rate: 0, table })).toBe(text);
  });

  test("respects the budget implied by the rate", () => {
    const words = (text.match(/\S+/g) || []).length;
    const out = applyOrthography(text, "narrative", { rate: 5, table, seed: 2 });
    const budget = Math.round((5 / 1000) * words);
    const changed = ["aplied", "reccently", "succes"].filter((w) => out.includes(w)).length;
    expect(changed).toBeLessThanOrEqual(Math.max(1, budget));
  });

  test("is deterministic for a seed", () => {
    const a = applyOrthography(text, "narrative", { rate: 10, table, seed: 5 });
    const b = applyOrthography(text, "narrative", { rate: 10, table, seed: 5 });
    expect(a).toBe(b);
  });

  test("leaves text unchanged when the budget rounds to zero", () => {
    expect(applyOrthography("five words only right here", "narrative", { rate: 1, table })).toBe("five words only right here");
  });
});

describe("orthographyDelta", () => {
  test("reports the share of movement the spelling layer carries", () => {
    const d = orthographyDelta(0.55, 0.75);
    expect(d.share).toBeGreaterThan(0);
    expect(d.statement).toMatch(/Orthography accounts for/);
  });

  test("calls out when spelling is doing over half the work", () => {
    // Without noise the rater is at chance; with noise they are still at chance. All movement is
    // elsewhere — but when the reverse holds, the ablation must say so loudly.
    const d = orthographyDelta(0.52, 0.95);
    expect(d.statement).toMatch(/Over half/);
  });

  test("is safe when nothing moved", () => {
    expect(orthographyDelta(0.5, 0.5).share).toBe(0);
  });
});
