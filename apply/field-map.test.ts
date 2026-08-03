// bun test apply/field-map.test.ts
import { expect, test, describe } from "bun:test";
import { mapField } from "./field-map";
import type { Applicant } from "./types";

const A: Applicant = {
  identity: { legalFirstName: "Colin", legalLastName: "Eyre", preferredName: "Colin", dateOfBirth: "2006-12-19", gender: "", ethnicity: "", citizenship: "US citizen" },
  contact: { email: "colineyre222@gmail.com", phone: "(470) 573-8908", address: { street: "4295 Van Vleet Rd", city: "Swartz Creek", state: "MI", zip: "48473", country: "United States" } },
  academic: { currentSchool: "Mott Community College", enrollmentNote: "", major: "Cellular and Molecular Biology", minor: "Computer Science", classLevel: "Sophomore", gpa: "3.92", gpaScale: "4.0", gpaContext: "", priorGpa: "", sat: "1260", act: "", expectedGraduation: "2028", highSchool: "North Gwinnett High School" },
  financial: { fafsaSAI: "-1500", pellEligible: true, financialNeed: "high", residency: "Michigan" },
  honors: [], activities: [], work: [], intendedField: "computational oncology", careerGoal: "AI drug discovery",
  documents: { resumePdf: "", transcriptPdf: "" }, doNotClaim: ["first-generation college student"],
};

describe("hard-block (safety)", () => {
  for (const label of ["Social Security Number", "SSN", "Tax ID", "Password", "Card Number", "CVV", "Bank Account Number", "Routing Number", "Driver's License Number", "Passport Number"]) {
    test(`blocks "${label}"`, () => {
      expect(mapField(label, A).kind).toBe("block");
    });
  }
});

describe("first-generation never asserted", () => {
  test("declines first-generation checkbox", () => {
    const r = mapField("Are you a first-generation college student?", A);
    expect(r.kind).toBe("decline");
  });
});

describe("decline-to-state defaults", () => {
  test("gender declined", () => expect(mapField("Gender", A).kind).toBe("decline"));
  test("ethnicity/race declined", () => expect(mapField("Race/Ethnicity", A).kind).toBe("decline"));
});

describe("maps common fields", () => {
  const cases: [string, string][] = [
    ["First Name", "Colin"],
    ["Last Name", "Eyre"],
    ["Email Address", "colineyre222@gmail.com"],
    ["Phone Number", "(470) 573-8908"],
    ["Home Address 1", "4295 Van Vleet Rd"],
    ["City", "Swartz Creek"],
    ["State", "MI"],
    ["Zip Code", "48473"],
    ["Date of Birth", "2006-12-19"],
    ["Current GPA", "3.92"],
    ["Intended Major", "Cellular and Molecular Biology"],
    ["High School", "North Gwinnett High School"],
    ["Citizenship", "US citizen"],
  ];
  for (const [label, expected] of cases) {
    test(`"${label}" → "${expected}"`, () => {
      const r = mapField(label, A);
      expect(r.kind).toBe("fill");
      if (r.kind === "fill") expect(r.value).toBe(expected);
    });
  }
});

describe("unmapped", () => {
  test("gibberish → unmapped", () => expect(mapField("Sprocket alignment code", A).kind).toBe("unmapped"));
  test("empty → unmapped", () => expect(mapField("", A).kind).toBe("unmapped"));
});
