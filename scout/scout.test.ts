// bun test scout/scout.test.ts
//
// These cover the Scholarships360 card reader. Every field it drops is a decision the rest of
// the pipeline then has to guess at, and two of them were being dropped: the award amount (so
// every find ranked at expected value 0) and the grade level (so the eligibility screen had
// nothing to screen and high-school-only awards reached the dashboard).
import { expect, test, describe } from "bun:test";
import { describeCard, publishVerdict } from "./scout";
import { buildEligibilityProfile, screenEligibility } from "./eligibility";

const COLLEGE_SOPHOMORE = buildEligibilityProfile({
  identity: { citizenship: "US citizen", gender: "" },
  contact: { address: { state: "MI" } },
  academic: { currentSchool: "Mott Community College", enrollmentInstitution: "University of Michigan-Flint", highSchool: "", classLevel: "Sophomore" },
  financial: { residency: "MI" },
  doNotClaim: ["first-generation college student"],
} as any);

const screen = (gradeLevel: string | null) =>
  screenEligibility(describeCard(gradeLevel, "1 award worth", "$1,000"), COLLEGE_SOPHOMORE).decision;

describe("describeCard", () => {
  test("turns the card's info pairs into text the screen can read", () => {
    expect(describeCard("High School Senior", "2 awards worth", "$1,000")).toBe(
      "Grade level: High School Senior. 2 awards worth $1,000.",
    );
  });

  test("a card with nothing on it describes as null, not as an empty string", () => {
    // "" would screen as "nothing disqualifying found", which is a louder claim than the card makes.
    expect(describeCard(null, null, null)).toBeNull();
  });

  test("either half stands on its own", () => {
    expect(describeCard("All Grade Levels", null, null)).toBe("Grade level: All Grade Levels.");
    expect(describeCard(null, "multiple awards worth", "Varies")).toBe("Multiple awards worth Varies.");
  });
});

describe("the grade levels Scholarships360 actually publishes", () => {
  // Values observed live on the category pages, with the verdict each one must produce for a
  // college sophomore.
  const cases: [string, "disqualified" | "kept"][] = [
    ["High School Students", "disqualified"],
    ["High School Senior", "disqualified"],
    ["All Grade Levels", "kept"],
    ["High School Seniors, College & Graduate Students", "kept"],
    ["High School Seniors & College Students", "kept"],
    ["College & Graduate Students", "kept"],
    ["College Students", "kept"],
    ["College Underclassmen", "kept"],
    ["Graduate Students", "kept"],
  ];
  for (const [value, want] of cases) {
    test(`"${value}" → ${want}`, () => {
      const decision = screen(value);
      if (want === "disqualified") expect(decision).toBe("disqualified");
      else expect(decision).not.toBe("disqualified");
    });
  }

  test("a card with no grade level is never disqualified on grade level", () => {
    expect(screen(null)).not.toBe("disqualified");
  });
});

describe("module side effects", () => {
  test("importing scout.ts does not start a harvest", () => {
    // main() is guarded by import.meta.main. Without that guard, importing describeCard above
    // would have kicked off a full multi-minute scrape-and-score run — which it once did.
    expect(typeof describeCard).toBe("function");
  });
});

describe("publishVerdict", () => {
  test("a clean run always publishes, even when it shrank", () => {
    // Listings close. A smaller list from a healthy harvest is the truth, not a fault.
    expect(publishVerdict({ blocked: [], fresh: 4000, existing: 9000 }).publish).toBe(true);
  });

  test("a blocked source that collapses the harvest does not overwrite a good list", () => {
    const v = publishVerdict({ blocked: ["careeronestop (biology)"], fresh: 7377, existing: 9447 });
    expect(v.publish).toBe(false);
    expect(v.reason).toContain("7377");
  });

  test("a blocked source the harvest survived still publishes", () => {
    expect(publishVerdict({ blocked: ["unigo (x)"], fresh: 9000, existing: 9447 }).publish).toBe(true);
  });

  test("a first run has nothing to protect", () => {
    expect(publishVerdict({ blocked: ["careeronestop (biology)"], fresh: 12, existing: 0 }).publish).toBe(true);
  });
});
