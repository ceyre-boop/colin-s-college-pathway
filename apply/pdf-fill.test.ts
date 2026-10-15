// bun test apply/pdf-fill.test.ts
//
// Fixture PDF is built in-test with pdf-lib rather than checked in as a binary — same synthetic-
// data doctrine as field-map.test.ts, and it means the round-trip (build → fill → read back) is
// verified end-to-end instead of trusting a static fixture file.
import { expect, test, describe } from "bun:test";
import { PDFDocument } from "pdf-lib";
import { fillPdf, pdfHasFillableFields } from "./pdf-fill";
import type { Applicant } from "./types";

const A: Applicant = {
  identity: { legalFirstName: "Testy", legalLastName: "McFixture", preferredName: "Testy", dateOfBirth: "1999-01-02", gender: "", ethnicity: "", citizenship: "US citizen" },
  contact: { email: "you@example.com", phone: "+1 (555) 555-5555", address: { street: "123 Main St", city: "Springfield", state: "ST", zip: "00000", country: "United States" } },
  academic: { currentSchool: "Example Community College", enrollmentNote: "", major: "Example Major", minor: "Example Minor", classLevel: "Sophomore", gpa: "3.50", gpaScale: "4.0", gpaContext: "", priorGpa: "", sat: "1200", act: "", expectedGraduation: "Spring 2028", highSchool: "Example High School" },
  financial: { fafsaSAI: "0", pellEligible: true, financialNeed: "high", residency: "ST" },
  honors: [], activities: [], work: [], intendedField: "example field", careerGoal: "One sentence.",
  documents: { resumePdf: "", transcriptPdf: "" }, doNotClaim: ["first-generation college student"],
};

async function buildFixturePdf(fieldNames: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  const form = doc.getForm();
  fieldNames.forEach((name, i) => {
    const tf = form.createTextField(name);
    tf.addToPage(page, { x: 20, y: 380 - i * 20, width: 200, height: 15 });
  });
  return doc.save();
}

describe("fillPdf", () => {
  test("fills mappable fields, declines/unmaps the rest, never touches blocked fields", async () => {
    const bytes = await buildFixturePdf(["First Name", "Last Name", "Email Address", "Social Security Number", "Favorite Color"]);
    const outPath = "/tmp/pdf-fill-test-output.pdf";
    const result = await fillPdf(bytes, A, outPath);

    expect(result.filled.map((f) => f.field).sort()).toEqual(["Email Address", "First Name", "Last Name"]);
    expect(result.blocked.map((f) => f.field)).toEqual(["Social Security Number"]);
    expect(result.unmapped).toEqual(["Favorite Color"]);

    // Read the draft back and confirm the values actually landed in the PDF, not just the ledger.
    const written = await Bun.file(outPath).arrayBuffer();
    const reloaded = await PDFDocument.load(written);
    const reForm = reloaded.getForm();
    expect(reForm.getTextField("First Name").getText()).toBe("Testy");
    expect(reForm.getTextField("Last Name").getText()).toBe("McFixture");
    expect(reForm.getTextField("Email Address").getText()).toBe("you@example.com");
    expect(reForm.getTextField("Social Security Number").getText() ?? "").toBe("");

    await Bun.file(outPath).delete();
  });

  test("declines first-generation and never asserts it, same as the web-form path", async () => {
    const bytes = await buildFixturePdf(["Are you a first-generation college student?"]);
    const result = await fillPdf(bytes, A, "/tmp/pdf-fill-test-firstgen.pdf");
    expect(result.declined.length).toBe(1);
    expect(result.filled.length).toBe(0);
    await Bun.file("/tmp/pdf-fill-test-firstgen.pdf").delete();
  });
});

describe("pdfHasFillableFields", () => {
  test("true for an AcroForm PDF", async () => {
    const bytes = await buildFixturePdf(["First Name"]);
    expect(await pdfHasFillableFields(bytes)).toBe(true);
  });

  test("false for a plain (formless) PDF", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([400, 400]);
    const bytes = await doc.save();
    expect(await pdfHasFillableFields(bytes)).toBe(false);
  });

  test("false for garbage bytes rather than throwing", async () => {
    expect(await pdfHasFillableFields(new Uint8Array([1, 2, 3]))).toBe(false);
  });
});
