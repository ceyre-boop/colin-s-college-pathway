import { describe, expect, test } from "bun:test";
import { advance, expectedBenefit, normalizeScholarship } from "./scholarshipWorkflow";

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

