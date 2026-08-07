// bun test scout/eligibility.test.ts
import { expect, test, describe } from "bun:test";
import { buildEligibilityProfile, screenEligibility } from "./eligibility";

// The screening profile is now derived from the applicant record rather than a hardcoded constant,
// so the fixture below stands in for what the vault resolves. Values match the real profile's
// SHAPE (Michigan resident, Mott → UM-Flint, US citizen, declines to state gender, cannot claim
// first-gen) without hardcoding anything sensitive.
const FIXTURE = buildEligibilityProfile({
  identity: { citizenship: "US citizen", gender: "" },
  contact: { address: { state: "MI" } },
  academic: { currentSchool: "Mott Community College", enrollmentInstitution: "University of Michigan-Flint", highSchool: "", classLevel: "Sophomore" },
  financial: { residency: "MI" },
  doNotClaim: ["first-generation college student"],
} as any);

const dq = (t: string) => screenEligibility(t, FIXTURE).decision;
const rule = (t: string) => screenEligibility(t, FIXTURE).hardDqRule;

describe("wrong-state", () => {
  test("Florida residency scope → disqualified", () => {
    const t = "Resident of Florida. Attend the University of North Florida. Undergraduate seeking a bachelor's degree studying chemistry, biology, or physics.";
    expect(dq(t)).toBe("disqualified");
    // wrong-institution may fire first; either wrong-state or wrong-institution is acceptable
    expect(["wrong-state", "wrong-institution"]).toContain(rule(t));
  });
  test("Northeast Ohio residency → disqualified", () => {
    expect(dq("Must be a resident of Ohio and attend a college in Ohio.")).toBe("disqualified");
  });
  test("national (U.S. resident) + biology → not state-DQ'd", () => {
    const t = "Resident of the U.S. Undergraduate studying a health-related field including biology.";
    expect(dq(t)).toBe("pass");
  });
  test("Michigan residency → pass", () => {
    expect(dq("Must be a resident of Michigan pursuing a degree in biology.")).toBe("pass");
  });
  test("preference (not requirement) for a state → not disqualified", () => {
    const t = "Resident of the U.S. Studying biology. Preference is given to students enrolled in academic institutions in South Carolina and the Southeastern United States.";
    expect(dq(t)).not.toBe("disqualified");
  });
});

describe("wrong-institution", () => {
  test("scoped to a named non-home university → disqualified", () => {
    expect(dq("Students of Clemson University pursuing a science degree.")).toBe("disqualified");
    expect(rule("Must attend the University of North Florida.")).toBe("wrong-institution");
  });
  test("student's own school (UM-Flint) in scope → pass", () => {
    expect(dq("Must attend the University of Michigan-Flint as an undergraduate in biology.")).toBe("pass");
  });
  test("generic 'an accredited college' → not institution-DQ'd", () => {
    expect(dq("Must attend an accredited four-year college in the United States studying biology.")).toBe("pass");
  });
});

describe("demographic identity", () => {
  test("first-generation required → disqualified (never claimed)", () => {
    const v = screenEligibility("Must be a first-generation college student studying biology.", FIXTURE);
    expect(v.decision).toBe("disqualified");
    expect(v.hardDqRule).toBe("demographic-identity");
  });
  // BEHAVIOUR CHANGE: this used to disqualify, because the eligibility profile hardcoded
  // gender "male" while the actual applicant profile declines to state. With gender derived from
  // the profile, an unknown gender can no longer be answered on the student's behalf in either
  // direction — a gender-restricted award becomes a human question instead of a silent DQ.
  test("women-only, gender declined → ambiguous (never answered on the student's behalf)", () => {
    expect(dq("Open to female students pursuing STEM degrees.")).toBe("ambiguous");
  });
  test("women-only, male profile → disqualified", () => {
    const male = buildEligibilityProfile({
      identity: { citizenship: "US citizen", gender: "male" },
      contact: { address: { state: "MI" } },
      academic: { currentSchool: "Mott Community College", enrollmentInstitution: "", highSchool: "", classLevel: "Sophomore" },
      financial: { residency: "MI" },
      doNotClaim: ["first-generation college student"],
    } as any);
    expect(screenEligibility("Open to female students pursuing STEM degrees.", male).decision).toBe("disqualified");
  });
  test("women-only, female profile → not disqualified on gender", () => {
    const female = buildEligibilityProfile({
      identity: { citizenship: "US citizen", gender: "female" },
      contact: { address: { state: "MI" } },
      academic: { currentSchool: "Mott Community College", enrollmentInstitution: "", highSchool: "", classLevel: "Sophomore" },
      financial: { residency: "MI" },
      doNotClaim: [],
    } as any);
    expect(screenEligibility("Open to female students pursuing STEM degrees.", female).hardDqRule).not.toBe("demographic-identity");
  });
  test.skip("legacy: women-only unconditional DQ", () => {
    expect(dq("Open to female students pursuing STEM degrees.")).toBe("disqualified");
  });
  test("tribal enrollment required → disqualified", () => {
    expect(dq("Applicant must be an enrolled member of a federally recognized tribe.")).toBe("disqualified");
  });
  test("veteran required → disqualified", () => {
    expect(dq("Must be a veteran or active-duty military member.")).toBe("disqualified");
  });
});

describe("grade level", () => {
  test("graduate-only → disqualified", () => {
    expect(dq("Graduate students only. Must be a doctoral candidate in the life sciences.")).toBe("disqualified");
  });
  test("high-school-only → disqualified", () => {
    expect(dq("Must be a current high school senior planning to study biology.")).toBe("disqualified");
  });
  test("teacher/faculty required → disqualified", () => {
    expect(dq("Open to faculty applicants and educators in science.")).toBe("disqualified");
  });
});

describe("field of study", () => {
  test("nursing required → disqualified", () => {
    expect(dq("Must be majoring in nursing at an accredited school.")).toBe("disqualified");
  });
  test("biology required → pass", () => {
    expect(dq("Open to U.S. students majoring in biology or a related life science.")).toBe("pass");
  });
  test("computer science required → pass", () => {
    expect(dq("For undergraduates studying computer science or software engineering.")).toBe("pass");
  });
});

describe("bias to ambiguous", () => {
  test("empty/short text → ambiguous", () => {
    expect(dq("")).toBe("ambiguous");
    expect(dq("Apply now.")).toBe("ambiguous");
  });
  test("open text with no affirmative match → ambiguous", () => {
    expect(dq("Applicants must demonstrate leadership and community involvement.")).toBe("ambiguous");
  });
});
