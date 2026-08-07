// bun test identity/broker.test.ts
import { expect, test, describe } from "bun:test";
import { open, grantForLabels, CapabilityDenied } from "./broker";
import { freshness, resolveApplicant, type Vault } from "./vault";
import { pathForLabel } from "../apply/field-map";

/** A synthetic vault — never touches the real identity/vault.json. */
const vault: Vault = {
  _meta: { version: 1, migratedAt: "2026-01-01T00:00:00Z", note: "test" },
  fields: {
    "identity.legalFirstName": { value: "Testy", source: "self", lastVerified: null, sensitivity: "public", allowedForAutofill: true },
    "identity.legalLastName": { value: "McFixture", source: "self", lastVerified: null, sensitivity: "public", allowedForAutofill: true },
    "identity.dateOfBirth": { value: "1999-01-02", source: "document", lastVerified: "2026-08-01", sensitivity: "restricted", allowedForAutofill: true },
    "contact.email": { value: "you@example.com", source: "self", lastVerified: null, sensitivity: "restricted", allowedForAutofill: true },
    "contact.phone": { value: "+1 (555) 555-5555", source: "self", lastVerified: null, sensitivity: "restricted", allowedForAutofill: true },
    "financial.fafsaSAI": { value: "-1500", source: "document", lastVerified: "2026-07-07", sensitivity: "restricted", allowedForAutofill: false },
    "academic.gpa": { value: "3.50", source: "document", lastVerified: "2020-01-01", sensitivity: "public", allowedForAutofill: true },
    doNotClaim: { value: ["first-generation college student"], source: "self", lastVerified: null, sensitivity: "internal", allowedForAutofill: false },
  },
};

describe("grants are scoped to the form", () => {
  test("a six-field form does not grant the whole profile", () => {
    const grant = grantForLabels(["First Name", "Last Name", "Email Address"], pathForLabel, "test");
    expect(grant.paths.has("identity.legalFirstName")).toBe(true);
    expect(grant.paths.has("contact.email")).toBe(true);
    expect(grant.paths.has("financial.fafsaSAI")).toBe(false);
    expect(grant.paths.has("identity.dateOfBirth")).toBe(false);
  });

  test("blocked and declined labels never enter a grant", () => {
    const grant = grantForLabels(["Social Security Number", "Gender", "Race/Ethnicity"], pathForLabel, "test");
    expect(grant.paths.size).toBe(0);
  });
});

describe("reads outside the grant are refused and recorded", () => {
  test("requesting the FAFSA SAI on a form that never asked throws", () => {
    const b = open({ paths: new Set(["contact.email"]), purpose: "test" }, vault);
    expect(() => b.read("financial.fafsaSAI")).toThrow(CapabilityDenied);
    expect(b.denied().map((d) => d.path)).toEqual(["financial.fafsaSAI"]);
  });

  test("granted reads succeed and are tracked", () => {
    const b = open({ paths: new Set(["contact.email", "identity.legalFirstName"]), purpose: "test" }, vault);
    expect(b.value("contact.email")).toBe("you@example.com");
    expect(b.value("identity.legalFirstName")).toBe("Testy");
    expect(b.readPaths().sort()).toEqual(["contact.email", "identity.legalFirstName"]);
  });

  test("doNotClaim is always granted — withholding it could only cause a false claim", () => {
    const b = open({ paths: new Set([]), purpose: "test" }, vault);
    expect(() => b.read("doNotClaim")).not.toThrow();
  });
});

describe("restrictedApplicant blanks everything outside the grant", () => {
  test("ungranted leaves resolve empty, shape is preserved", () => {
    const b = open({ paths: new Set(["identity.legalFirstName", "contact.email"]), purpose: "test" }, vault);
    const a = b.restrictedApplicant();
    expect(a.identity.legalFirstName).toBe("Testy");
    expect(a.contact.email).toBe("you@example.com");
    // Present in the vault, absent from the grant → blank, not undefined.
    expect(a.identity.dateOfBirth).toBe("");
    expect(a.financial.fafsaSAI).toBe("");
    expect(a.contact.address.street).toBe("");
  });

  test("doNotClaim survives redaction so negative assertions stay enforceable", () => {
    const b = open({ paths: new Set(["identity.legalFirstName"]), purpose: "test" }, vault);
    expect(b.restrictedApplicant().doNotClaim).toContain("first-generation college student");
  });

  test("a mapper handed the restricted profile cannot fill an ungranted field", () => {
    // The exfiltration-by-helpfulness case: a hidden field the form never advertised.
    const grant = grantForLabels(["First Name"], pathForLabel, "test");
    const a = open(grant, vault).restrictedApplicant();
    const r = require("../apply/field-map").mapField("Date of Birth", a);
    // No value on file (it was redacted) → decline, never a blank or wrong fill.
    expect(r.kind).toBe("decline");
  });
});

describe("policy gates are independent of confidence", () => {
  test("fafsaSAI is autofill-blocked even though it is document-verified", () => {
    const b = open({ paths: new Set(["financial.fafsaSAI"]), purpose: "test" }, vault);
    expect(b.autofillAllowed("financial.fafsaSAI")).toBe(false);
    expect(freshness(vault.fields["financial.fafsaSAI"], Date.parse("2026-08-07"))).toBe(1.0);
  });
});

describe("freshness", () => {
  const now = Date.parse("2026-08-07T00:00:00Z");
  test("recent document beats self-asserted beats unverified", () => {
    expect(freshness({ source: "document", lastVerified: "2026-08-01" }, now)).toBe(1.0);
    expect(freshness({ source: "self", lastVerified: "2026-08-01" }, now)).toBe(0.92);
    expect(freshness({ source: "unverified", lastVerified: null }, now)).toBe(0.8);
  });

  test("a document verified years ago is discounted", () => {
    expect(freshness({ source: "document", lastVerified: "2020-01-01" }, now)).toBe(0.85);
  });

  test("never verified is treated as stale", () => {
    expect(freshness({ source: "document", lastVerified: null }, now)).toBe(0.85);
  });
});

describe("vault resolves to the legacy Applicant shape", () => {
  test("resolveApplicant produces the flat object field-map expects", () => {
    const a = resolveApplicant(vault);
    expect(a.identity.legalFirstName).toBe("Testy");
    expect(a.academic.gpa).toBe("3.50");
    expect(Array.isArray(a.doNotClaim)).toBe(true);
    expect(a.contact.address.city).toBe(""); // absent from this vault → empty, not undefined
  });
});
