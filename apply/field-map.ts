// Field-mapper — turns a form's detected field name/label into a value from the Applicant
// profile, OR refuses. Pure function, unit-testable, no browser.
//
// Two jobs, in order:
//   1. HARD-BLOCK (safety): SSN / password / payment / bank fields are NEVER filled. Hitting
//      one returns { kind: "block" }, which the fill engine treats as an abort-to-human — the
//      form leaves the auto-submit class entirely. SSN is hand-write-only, period.
//   2. MAP: ordered regex table from a normalized label → an Applicant path + resolved value.
//
// Never asserts first-generation (cross-checks applicant.doNotClaim). gender/ethnicity are
// declined by default. A REQUIRED field we can't map returns { kind: "unmapped" }, which
// forces the form out of auto-submit into fill+review.

import type { Applicant } from "./types";

export type MapResult =
  | { kind: "fill"; path: string; value: string }
  | { kind: "block"; reason: string } // safety abort — never fill, route to human
  | { kind: "decline"; reason: string } // intentionally left blank (optional/decline-to-state)
  | { kind: "unmapped" }; // no rule matched — required ones force fill+review

function norm(label: string): string {
  return label.toLowerCase().replace(/[*_]+/g, " ").replace(/[^a-z0-9 /'-]/g, " ").replace(/\s+/g, " ").trim();
}

// Fields we must NEVER fill — sensitive credentials/financial/identity numbers.
const HARD_BLOCK: [RegExp, string][] = [
  [/\b(ssn|social security|social sec|tax id|tin|itin)\b/, "SSN/tax-id — hand-write only, never typed or stored"],
  [/\b(password|passcode|pin)\b/, "password field — authentication is the user's to do"],
  [/\b(credit card|card number|cvv|cvc|security code|expiration|card holder)\b/, "payment card field"],
  [/\b(routing|account number|bank account|iban|swift)\b/, "bank account field"],
  [/\b(driver'?s? licen|passport|state id number)/, "government-id number — hand-write only"],
];

// Ordered mapping table. First match wins. Each resolves a value from the Applicant.
type Rule = { re: RegExp; path: string; get: (a: Applicant) => string };
const RULES: Rule[] = [
  { re: /\b(first name|given name|first|fname)\b/, path: "identity.legalFirstName", get: (a) => a.identity.legalFirstName },
  { re: /\b(last name|surname|family name|last|lname)\b/, path: "identity.legalLastName", get: (a) => a.identity.legalLastName },
  { re: /\b(middle name|middle initial|mi)\b/, path: "identity.legalFirstName", get: () => "" }, // often optional; leave blank
  { re: /\b(preferred name|nickname|goes by)\b/, path: "identity.preferredName", get: (a) => a.identity.preferredName || a.identity.legalFirstName },
  { re: /\b(full name|your name|name)\b/, path: "identity.fullName", get: (a) => `${a.identity.legalFirstName} ${a.identity.legalLastName}` },
  { re: /\b(e-?mail)\b/, path: "contact.email", get: (a) => a.contact.email },
  { re: /\b(phone|mobile|cell|telephone|contact number)\b/, path: "contact.phone", get: (a) => a.contact.phone },
  { re: /\b(street|address line 1|address 1|home address 1|mailing address|home address|address)\b/, path: "contact.address.street", get: (a) => a.contact.address.street },
  { re: /\b(address line 2|address 2|apt|apartment|suite|unit)\b/, path: "contact.address.street2", get: () => "" },
  { re: /\b(city|town)\b/, path: "contact.address.city", get: (a) => a.contact.address.city },
  { re: /\b(state|province|region)\b/, path: "contact.address.state", get: (a) => a.contact.address.state },
  { re: /\b(zip|postal code|postcode|zip code)\b/, path: "contact.address.zip", get: (a) => a.contact.address.zip },
  { re: /\b(country|nation)\b/, path: "contact.address.country", get: (a) => a.contact.address.country || "United States" },
  { re: /\b(date of birth|birth ?date|dob|birthday)\b/, path: "identity.dateOfBirth", get: (a) => a.identity.dateOfBirth },
  { re: /\b(citizen|citizenship|immigration status)\b/, path: "identity.citizenship", get: (a) => a.identity.citizenship },
  { re: /\b(current gpa|cumulative gpa|gpa|grade point)\b/, path: "academic.gpa", get: (a) => a.academic.gpa },
  { re: /\b(intended major|major|field of study|program of study|area of study)\b/, path: "academic.major", get: (a) => a.academic.major },
  { re: /\b(minor)\b/, path: "academic.minor", get: (a) => a.academic.minor },
  { re: /\b(current school|college|university|institution|school you attend|current institution)\b/, path: "academic.currentSchool", get: (a) => a.academic.currentSchool },
  { re: /\b(high school)\b/, path: "academic.highSchool", get: (a) => a.academic.highSchool },
  { re: /\b(class level|year in school|grade level|academic level|classification|student status|status)\b/, path: "academic.classLevel", get: (a) => a.academic.classLevel },
  { re: /\b(expected graduation|graduation date|anticipated graduation|grad year)\b/, path: "academic.expectedGraduation", get: (a) => a.academic.expectedGraduation },
  { re: /\b(sat)\b/, path: "academic.sat", get: (a) => a.academic.sat },
  { re: /\b(act)\b/, path: "academic.act", get: (a) => a.academic.act },
  { re: /\b(career goal|career objective|future plans|professional goal|what do you plan)\b/, path: "careerGoal", get: (a) => a.careerGoal },
  { re: /\b(intended (career|profession|field)|field of interest)\b/, path: "intendedField", get: (a) => a.intendedField },
];

// Fields we intentionally leave blank (optional / decline-to-state), unless a form forces them.
const DECLINE: [RegExp, string][] = [
  [/\b(gender|sex)\b/, "decline to state (fill by hand if required)"],
  [/\b(ethnicity|race|hispanic|latino)\b/, "decline to state (fill by hand if required)"],
];

// first-generation must never be asserted — Colin's profile marks it unverified.
const FIRST_GEN = /\b(first[- ]generation|first[- ]gen|first in (your|my) family)\b/;

export function mapField(label: string, a: Applicant): MapResult {
  const l = norm(label);
  if (!l) return { kind: "unmapped" };

  for (const [re, reason] of HARD_BLOCK) if (re.test(l)) return { kind: "block", reason };

  // Never claim first-generation: leave any such field blank/false and note it.
  if (FIRST_GEN.test(l)) {
    return a.doNotClaim?.some((x) => /first[- ]?gen/i.test(x)) || !a.doNotClaim
      ? { kind: "decline", reason: "first-generation is unverified — never asserted" }
      : { kind: "decline", reason: "first-generation is unverified — never asserted" };
  }

  for (const [re, reason] of DECLINE) if (re.test(l)) return { kind: "decline", reason };

  for (const r of RULES) {
    if (r.re.test(l)) {
      const value = r.get(a) ?? "";
      if (!value) return { kind: "decline", reason: `no value on file for ${r.path}` };
      return { kind: "fill", path: r.path, value };
    }
  }
  return { kind: "unmapped" };
}
