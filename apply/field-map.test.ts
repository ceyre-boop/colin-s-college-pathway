// bun test apply/field-map.test.ts
//
// Fixture is SYNTHETIC on purpose. These tests exercise the label→path mapping, not the profile
// data, so real PII (DOB, phone, street address) has no business here — it was previously
// hardcoded in this file, which is git-tracked and therefore defeated the applicant.local.json
// gitignore entirely. Assert on `path` (the mapping decision) and only on values that are
// obviously fake sentinels.
import { expect, test, describe } from "bun:test";
import { mapField } from "./field-map";
import type { Applicant } from "./types";

const A: Applicant = {
  identity: { legalFirstName: "Testy", legalLastName: "McFixture", preferredName: "Testy", dateOfBirth: "1999-01-02", gender: "", ethnicity: "", citizenship: "US citizen" },
  contact: { email: "you@example.com", phone: "+1 (555) 555-5555", address: { street: "123 Main St", city: "Springfield", state: "ST", zip: "00000", country: "United States" } },
  academic: { currentSchool: "Example Community College", enrollmentNote: "", major: "Example Major", minor: "Example Minor", classLevel: "Sophomore", gpa: "3.50", gpaScale: "4.0", gpaContext: "", priorGpa: "", sat: "1200", act: "", expectedGraduation: "Spring 2028", highSchool: "Example High School" },
  financial: { fafsaSAI: "0", pellEligible: true, financialNeed: "high", residency: "ST" },
  honors: [], activities: [], work: [], intendedField: "example field", careerGoal: "One sentence.",
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

describe("maps common fields to the right profile path", () => {
  const cases: [string, string][] = [
    ["First Name", "identity.legalFirstName"],
    ["Last Name", "identity.legalLastName"],
    ["Email Address", "contact.email"],
    ["Phone Number", "contact.phone"],
    ["Home Address 1", "contact.address.street"],
    ["City", "contact.address.city"],
    ["State", "contact.address.state"],
    ["Zip Code", "contact.address.zip"],
    ["Date of Birth", "identity.dateOfBirth"],
    ["Current GPA", "academic.gpa"],
    ["Intended Major", "academic.major"],
    ["High School", "academic.highSchool"],
    ["Citizenship", "identity.citizenship"],
  ];
  for (const [label, path] of cases) {
    test(`"${label}" → ${path}`, () => {
      const r = mapField(label, A);
      expect(r.kind).toBe("fill");
      if (r.kind === "fill") expect(r.path).toBe(path);
    });
  }
});

describe("resolves the value off the profile it was given", () => {
  // One spot-check that the getter actually reads the profile rather than a constant.
  test("First Name resolves from identity.legalFirstName", () => {
    const r = mapField("First Name", A);
    if (r.kind === "fill") expect(r.value).toBe("Testy");
  });
  test("empty value on file → decline, never a blank fill", () => {
    const blank = { ...A, academic: { ...A.academic, act: "" } };
    expect(mapField("ACT Score", blank).kind).toBe("decline");
  });
});

describe("unmapped", () => {
  test("gibberish → unmapped", () => expect(mapField("Sprocket alignment code", A).kind).toBe("unmapped"));
  test("empty → unmapped", () => expect(mapField("", A).kind).toBe("unmapped"));
});
