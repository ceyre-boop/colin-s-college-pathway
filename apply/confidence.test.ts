// bun test apply/confidence.test.ts
//
// Golden file for the confidence calculation. The point of these numbers is that they are
// ARGUABLE — if a threshold or a specificity value changes, this file should be the thing that
// forces the conversation, not a form that quietly filled the wrong box.
import { expect, test, describe } from "bun:test";
import { mapField, pathForLabel } from "./field-map";
import type { Applicant } from "./types";

const A: Applicant = {
  identity: { legalFirstName: "Testy", legalLastName: "McFixture", preferredName: "Testy", dateOfBirth: "1999-01-02", gender: "", ethnicity: "", citizenship: "US citizen" },
  contact: { email: "you@example.com", phone: "+1 (555) 555-5555", address: { street: "123 Main St", city: "Springfield", state: "ST", zip: "00000", country: "United States" } },
  academic: { currentSchool: "Example CC", enrollmentNote: "", major: "Example Major", minor: "Example Minor", classLevel: "Sophomore", gpa: "3.50", gpaScale: "4.0", gpaContext: "", priorGpa: "", sat: "1200", act: "", expectedGraduation: "Spring 2028", highSchool: "Example High" },
  financial: { fafsaSAI: "0", pellEligible: true, financialNeed: "high", residency: "ST" },
  honors: [], activities: [], work: [], intendedField: "example field", careerGoal: "One sentence.",
  documents: { resumePdf: "", transcriptPdf: "" }, doNotClaim: ["first-generation college student"],
};

const AUTOFILL = 0.98;
const ASK = 0.8;

/** score with a perfect label and fully-verified data — the ceiling for a given rule */
const ceiling = (label: string) => {
  const r = mapField(label, A, { labelTier: 1.0, freshness: 1.0 });
  return r.kind === "fill" ? r.confidence.score : -1;
};

describe("what clears the autofill bar on a perfect label", () => {
  for (const label of ["Email Address", "Zip Code", "Date of Birth", "Current GPA"]) {
    test(`"${label}" clears ${AUTOFILL}`, () => expect(ceiling(label)).toBeGreaterThanOrEqual(AUTOFILL));
  }
});

describe("known-ambiguous labels drop out of autofill", () => {
  test('"Marital Status" no longer silently fills the class level', () => {
    // The bare /status/ alternative in the class-level rule matches this. It used to fill
    // "Sophomore" into a marital status box with no signal at all.
    const r = mapField("Marital Status", A, { labelTier: 1.0, freshness: 1.0 });
    expect(r.kind).toBe("fill"); // the rule still matches — we did not delete it
    if (r.kind === "fill") {
      expect(r.path).toBe("academic.classLevel");
      expect(r.confidence.score).toBeLessThan(AUTOFILL);
      expect(r.confidence.score).toBeLessThan(ASK); // below the ask bar → not typed at all
    }
  });

  test('"Name of your high school" is contested and penalised', () => {
    const r = mapField("Name of your high school", A, { labelTier: 1.0, freshness: 1.0 });
    expect(r.kind).toBe("fill");
    if (r.kind === "fill") {
      // Both the full-name rule and the high-school rule match; order picks a winner, but the
      // collision is now recorded rather than resolved in silence.
      expect(r.confidence.competingRules.length).toBeGreaterThan(0);
      expect(r.confidence.factors.collision).toBe(0.85);
      expect(r.confidence.score).toBeLessThan(AUTOFILL);
    }
  });

  test('"State of incorporation" does not confidently fill the home state', () => {
    expect(ceiling("State of incorporation")).toBeLessThan(AUTOFILL);
  });
});

describe("label quality changes the answer", () => {
  test("a real <label> beats a bare name attribute for the same rule", () => {
    const good = mapField("Email Address", A, { labelTier: 1.0, freshness: 1.0 });
    const poor = mapField("Email Address", A, { labelTier: 0.5, freshness: 1.0 });
    if (good.kind === "fill" && poor.kind === "fill") {
      expect(good.confidence.score).toBeGreaterThan(poor.confidence.score);
      expect(poor.confidence.score).toBeLessThan(ASK); // field_2-grade label → ask the human
    }
  });

  test("stale/unverified data pulls a perfect label under the bar", () => {
    const fresh = mapField("Date of Birth", A, { labelTier: 1.0, freshness: 1.0 });
    const stale = mapField("Date of Birth", A, { labelTier: 1.0, freshness: 0.8 });
    if (fresh.kind === "fill" && stale.kind === "fill") {
      expect(fresh.confidence.score).toBeGreaterThanOrEqual(AUTOFILL);
      expect(stale.confidence.score).toBeLessThan(AUTOFILL);
    }
  });
});

describe("policy is not probability", () => {
  test("hard blocks carry no confidence and are never scored", () => {
    const r = mapField("Social Security Number", A);
    expect(r.kind).toBe("block");
    expect((r as any).confidence).toBeUndefined();
  });

  test("declines carry no confidence", () => {
    expect((mapField("Gender", A) as any).confidence).toBeUndefined();
    expect((mapField("Are you a first-generation student?", A) as any).confidence).toBeUndefined();
  });
});

describe("pathForLabel mirrors mapField's routing", () => {
  test("returns the same path the mapper would use", () => {
    for (const label of ["Email Address", "Current GPA", "Zip Code", "High School"]) {
      const m = mapField(label, A);
      expect(pathForLabel(label)).toBe(m.kind === "fill" ? m.path : null);
    }
  });

  test("returns null for blocked, declined, and unmapped labels — so they never enter a grant", () => {
    expect(pathForLabel("Social Security Number")).toBeNull();
    expect(pathForLabel("Gender")).toBeNull();
    expect(pathForLabel("Sprocket alignment code")).toBeNull();
  });
});

describe("factor arithmetic is transparent", () => {
  test("score is exactly the product of its four factors", () => {
    const r = mapField("City", A, { labelTier: 0.9, freshness: 0.92 });
    if (r.kind === "fill") {
      const f = r.confidence.factors;
      expect(r.confidence.score).toBeCloseTo(f.specificity * f.collision * f.labelTier * f.freshness, 3);
    }
  });
});
