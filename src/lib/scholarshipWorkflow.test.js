import { describe, expect, test } from "bun:test";
import { advance, expectedBenefit, normalizeScholarship, isTouched } from "./scholarshipWorkflow";

describe("scholarship workflow", () => {
  test("does not allow unverified eligibility to advance", () => {
    const s = normalizeScholarship({ id: "x", amount: 1000, status: "research", evidenceStatus: "plausible" });
    expect(advance({ ...s, workflowState: "verified" }, "eligible").error).toContain("Verify eligibility");
  });

  test("requires review before submission", () => {
    const s = normalizeScholarship({ id: "x", amount: 1000, status: "apply", evidenceStatus: "verified" });
    expect(advance({ ...s, workflowState: "prepared" }, "submitted").error).toContain("needs-review");
  });

  test("calculates the golden-ratio score", () => {
    expect(expectedBenefit({ amount: 1000, realisticWinRate: 0.1, eligibilityConfidence: 0.9, effortHours: 1 })).toBe(70);
  });
});


describe("isTouched — what survives a scout re-merge", () => {
  const imported = { id: "sc_scout_x", status: "apply", notes: "Scout find (match 55%, effort low)." };

  test("a freshly imported scout find is untouched", () => {
    expect(isTouched(imported)).toBe(false);
  });

  test("a status he moved is work", () => {
    expect(isTouched({ ...imported, status: "applied" })).toBe(true);
    expect(isTouched({ ...imported, status: "won" })).toBe(true);
  });

  test("a workflow state past 'discovered' is work", () => {
    expect(isTouched({ ...imported, workflowState: "prepared" })).toBe(true);
    expect(isTouched({ ...imported, workflowState: "discovered" })).toBe(false);
  });

  test("a normalized scout find — the shape the merge actually sees — is untouched", () => {
    // normalizeScholarship fills workflowState and canonicalState on every record, so isTouched
    // has to read the real vocabulary ("discovered"/"DISCOVERED"), not an invented one.
    expect(isTouched(normalizeScholarship({ id: "sc_scout_x", status: "apply", match: 55, notes: "Scout find (match 55%, effort low)." }))).toBe(false);
  });

  test("his own notes are work; the scout's generated note is not", () => {
    expect(isTouched({ ...imported, notes: "emailed the foundation, they replied" })).toBe(true);
    expect(isTouched({ ...imported, notes: "Scout find (match 80%, effort high)." })).toBe(false);
  });

  test("a draft, a submission or an award is work", () => {
    expect(isTouched({ ...imported, essayDraft: "..." })).toBe(true);
    expect(isTouched({ ...imported, submittedAt: "2026-10-01" })).toBe(true);
    expect(isTouched({ ...imported, awardedAmount: 1000 })).toBe(true);
  });

  test("nothing at all is not touched", () => {
    expect(isTouched(null)).toBe(false);
    expect(isTouched({})).toBe(false);
  });
});
