// bun test scout/eligibility.test.ts
import { expect, test, describe } from "bun:test";
import { screenEligibility } from "./eligibility";

const dq = (t: string) => screenEligibility(t).decision;
const rule = (t: string) => screenEligibility(t).hardDqRule;

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
    const v = screenEligibility("Must be a first-generation college student studying biology.");
    expect(v.decision).toBe("disqualified");
    expect(v.hardDqRule).toBe("demographic-identity");
  });
  test("women-only → disqualified", () => {
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
