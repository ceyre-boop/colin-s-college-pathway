// bun test apply/pipeline.test.ts
import { expect, test, describe } from "bun:test";
import { chooseRoute } from "./pipeline";
import type { ApplicationTarget } from "./pipeline";

const base: ApplicationTarget = {
  scholarshipId: "test-scholarship",
  channel: "direct-browser",
  sourceUrl: "https://example.org/scholarship",
  applicationUrl: "https://example.org/scholarship/apply",
  loginRequired: false,
  automationAllowed: true,
  hasAttestation: false,
  requiresSignature: false,
  requiresRecommendation: false,
  requiresSensitiveDocument: false,
  requiresFee: false,
  artifacts: [],
};

describe("fully automatable browser route", () => {
  test("grants submit when no gate applies", () => {
    const r = chooseRoute(base);
    expect(r.capabilities).toContain("submit");
    expect(r.humanGates).toHaveLength(0);
  });
});

describe("login gate blocks submit", () => {
  test("login-required route never gets submit, even if automationAllowed", () => {
    const r = chooseRoute({ ...base, loginRequired: true });
    expect(r.capabilities).not.toContain("submit");
    expect(r.humanGates).toContain("user must log in or authorize the portal");
  });
});

describe("automation-permission gate", () => {
  test("unknown automationAllowed blocks submit", () => {
    const r = chooseRoute({ ...base, automationAllowed: "unknown" });
    expect(r.capabilities).not.toContain("submit");
    expect(r.humanGates).toContain("automation permission is not verified");
  });
  test("automationAllowed=false blocks submit", () => {
    const r = chooseRoute({ ...base, automationAllowed: false });
    expect(r.capabilities).not.toContain("submit");
  });
});

describe("attestation/signature/recommendation/sensitive-document gates", () => {
  test("attestation blocks submit", () => {
    const r = chooseRoute({ ...base, hasAttestation: true });
    expect(r.capabilities).not.toContain("submit");
    expect(r.humanGates).toContain("applicant must review attestations");
  });
  test("signature blocks submit", () => {
    const r = chooseRoute({ ...base, requiresSignature: true });
    expect(r.capabilities).not.toContain("submit");
    expect(r.humanGates).toContain("applicant must sign");
  });
  test("recommendation requirement blocks submit", () => {
    const r = chooseRoute({ ...base, requiresRecommendation: true });
    expect(r.capabilities).not.toContain("submit");
    expect(r.humanGates).toContain("recommendation workflow requires human coordination");
  });
  test("sensitive document requirement blocks submit", () => {
    const r = chooseRoute({ ...base, requiresSensitiveDocument: true });
    expect(r.capabilities).not.toContain("submit");
    expect(r.humanGates).toContain("sensitive document upload requires human review");
  });
});

describe("fee is a hard stop regardless of channel", () => {
  test("fee blocks submit and review-only capabilities", () => {
    const r = chooseRoute({ ...base, requiresFee: true });
    expect(r.capabilities).toEqual(["discover", "verify", "extract", "review"]);
    expect(r.humanGates).toContain("application fee is a hard stop");
  });
  test("fee wins even on an otherwise fully-automatable target", () => {
    const r = chooseRoute({ ...base, requiresFee: true, automationAllowed: true });
    expect(r.capabilities).not.toContain("submit");
    expect(r.capabilities).not.toContain("fill");
  });
});

describe("document/communication channels never submit unattended", () => {
  for (const channel of ["pdf", "email", "mail", "nomination"] as const) {
    test(`${channel} channel prepares but never auto-submits`, () => {
      const r = chooseRoute({ ...base, channel, automationAllowed: true });
      expect(r.capabilities).not.toContain("submit");
      expect(r.capabilities).not.toContain("fill");
      expect(r.capabilities).toContain("prepare");
    });
  }
});

describe("browser-assisted fallback", () => {
  test("portal channel with no gates still requires human review by default reason text", () => {
    const r = chooseRoute({ ...base, channel: "portal", automationAllowed: false });
    expect(r.reason).toMatch(/human review and submission required/);
    expect(r.capabilities).not.toContain("submit");
  });
});
