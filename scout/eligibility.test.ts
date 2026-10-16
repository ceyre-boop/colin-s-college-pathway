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
  test("a county list carries the state scope", () => {
    // The McConnell Foundation Scholarship. No residency verb sits next to "California", so the
    // scope has to be read from "counties in California" or the award looks open.
    const t = "Reside or attend high school or community college in Modoc, Shasta, Siskiyou, Tehama, or Trinity counties in California. Demonstrate financial need.";
    expect(dq(t)).toBe("disqualified");
    expect(rule(t)).toBe("wrong-state");
  });
  test("a Michigan county list is still in scope", () => {
    expect(dq("Resident of Genesee or Oakland counties in Michigan pursuing a degree in biology.")).toBe("pass");
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

// Regression: the NSHSS Foundation STEM Scholarship reached the dashboard as an actionable lead.
// Its own page reads "High school students of all grade levels with a minimum GPA of 3.0" — no
// "only", no "must be" — so the old grade-level rule never fired and the listing screened "pass".
// A college sophomore cannot win any of these, so every one is a wasted application.
describe("high-school scope (no 'only')", () => {
  const hsOnly = [
    ["the provider's own eligibility line", "High school students of all grade levels with a minimum GPA of 3.0"],
    ["the aggregator's listing", "Grade level: High School Students. Academic interest: Computer Science, Engineering. Minimum GPA 3.5. Open to college-bound high school students who have a demonstrated desire to major in STEM."],
    ["open to, without 'only'", "This scholarship is open to graduating high school seniors."],
    ["a high schooler's college PLANS are not a grade level", "Open to high school juniors planning to attend an accredited college."],
  ] as const;
  for (const [label, text] of hsOnly) {
    test(`${label} → disqualified`, () => {
      expect(dq(text)).toBe("disqualified");
      expect(rule(text)).toBe("wrong-grade-level");
    });
  }

  // The doctrine is bias-to-ambiguous: a false DQ silently throws away real money, so each of
  // these must survive the rule.
  const mustNotDq = [
    ["high school AND college in scope", "Open to high school seniors and current undergraduate college students."],
    ["college only", "Open to undergraduate students enrolled at an accredited college."],
    ["an essay prompt that mentions high school", "Open to all undergraduate students. Essay: describe a challenge you faced in high school."],
    ["'High School' inside the provider's name", "Offered by the National Society of High School Scholars. Open to undergraduates majoring in biology."],
    ["community college transfer", "For community college students transferring to a four-year university."],
  ] as const;
  for (const [label, text] of mustNotDq) {
    test(`${label} → not disqualified`, () => {
      expect(dq(text)).not.toBe("disqualified");
    });
  }
});

describe("wrong-institution must not fire on a category of school", () => {
  test("'attend high school or community college in <counties>' is not a named institution", () => {
    // Real text from The McConnell Foundation Scholarship. It IS disqualifying — on California —
    // but reading "high school or community college" as an institution attached a false reason to
    // a true verdict, and would misfire on text describing where the student actually studies.
    const t = "Reside or attend high school or community college in Modoc, Shasta, Siskiyou, Tehama, or Trinity counties in California.";
    expect(rule(t)).not.toBe("wrong-institution");
  });
  test("a genuinely named school still disqualifies", () => {
    const t = "Resident of the U.S. Planning to attend Presbyterian College. Seeking a bachelor's degree.";
    expect(dq(t)).toBe("disqualified");
    expect(rule(t)).toBe("wrong-institution");
  });
  test("the student's own community college is never a foreign scope", () => {
    expect(dq("Transfer student from a community college seeking a bachelor's degree in biology.")).not.toBe("disqualified");
  });
});

describe("citizenship must not fire on inclusive text", () => {
  // All four strings are real, from BigFuture requirement lists.
  test("'Undocumented students are encouraged to apply' is an invitation, not a bar", () => {
    expect(dq("Reside in Shasta County, California. Undocumented students are encouraged to apply.")).not.toBe("disqualified");
  });
  test("a list that includes U.S. citizens does not exclude one", () => {
    expect(dq("U.S. citizen, current DACA status, FAFSA-eligible non-citizen, permanent resident, or U.S. national. Demonstrate financial need.")).not.toBe("disqualified");
  });
  test("'first-generation college students, undocumented students, as well as students who have DACA status'", () => {
    const t = "First-generation college students, undocumented students, as well as students who have DACA status and are planning to pursue a bachelor's degree.";
    expect(rule(t)).not.toBe("citizenship");
  });
  test("a genuine requirement still disqualifies", () => {
    const t = "Open to undocumented students only, pursuing a degree in biology.";
    expect(dq(t)).toBe("disqualified");
    expect(rule(t)).toBe("citizenship");
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
