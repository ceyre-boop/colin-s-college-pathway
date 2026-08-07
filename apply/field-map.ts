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

/**
 * Confidence factors. A regex has no probability, so we do not invent one — we compose four
 * things that are each separately knowable and separately auditable:
 *
 *   specificity — hand-authored per rule. The honest factor: it encodes how ambiguous the author
 *                 knows the pattern to be, which no computation can recover. /date of birth/ is
 *                 unambiguous; a bare /status/ is not.
 *   collision   — how many rules matched this label. Two or more means the table is contested
 *                 here, which is exactly where first-match-wins used to guess silently.
 *   labelTier   — how the label was obtained (real <label> vs. the input's name attribute).
 *                 Supplied by the caller; see liveFormExtractor in fill.ts.
 *   freshness   — how well-verified the underlying value is. Supplied by the vault.
 *
 * Thresholds live in fill.ts, not here: this module reports, the executor decides.
 */
export interface Confidence {
  score: number;
  factors: { specificity: number; collision: number; labelTier: number; freshness: number };
  competingRules: string[];
}

export type MapResult =
  | { kind: "fill"; path: string; value: string; confidence: Confidence }
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

// Ordered mapping table. Each resolves a value from the Applicant.
//
// `specificity` is authored, not measured. Calibration used: 0.99 = the phrase means one thing in
// every form anyone has ever written; 0.90 = reliable but has a known collision; 0.75 = a real
// English word that appears in unrelated questions; 0.55 = known to misfire and kept only because
// it is right more often than not. Under a 0.98 autofill bar, anything below 0.99 needs a perfect
// label and fresh verified data to fill unattended — which is the intent.
type Rule = { re: RegExp; path: string; specificity: number; get: (a: Applicant) => string };
const RULES: Rule[] = [
  { re: /\b(first name|given name|first|fname)\b/, path: "identity.legalFirstName", specificity: 0.97, get: (a) => a.identity.legalFirstName }, // bare "first" also matches "first choice"
  { re: /\b(last name|surname|family name|last|lname)\b/, path: "identity.legalLastName", specificity: 0.97, get: (a) => a.identity.legalLastName },
  { re: /\b(middle name|middle initial|mi)\b/, path: "identity.legalFirstName", specificity: 0.9, get: () => "" }, // often optional; leave blank
  { re: /\b(preferred name|nickname|goes by)\b/, path: "identity.preferredName", specificity: 0.95, get: (a) => a.identity.preferredName || a.identity.legalFirstName },
  // "name" alone matches "Name of your school", "Parent name", "Reference name", "Name of award".
  { re: /\b(full name|your name|name)\b/, path: "identity.fullName", specificity: 0.7, get: (a) => `${a.identity.legalFirstName} ${a.identity.legalLastName}` },
  { re: /\b(e-?mail)\b/, path: "contact.email", specificity: 0.99, get: (a) => a.contact.email },
  { re: /\b(phone|mobile|cell|telephone|contact number)\b/, path: "contact.phone", specificity: 0.97, get: (a) => a.contact.phone },
  // Bare "address" must not match "email address" / "e-mail address" — that collision made a
  // perfectly unambiguous email field look contested. Lookbehind excludes the mail case only.
  { re: /\b(street|address line 1|address 1|home address 1|mailing address|home address|(?<!e-?mail )address)\b/, path: "contact.address.street", specificity: 0.85, get: (a) => a.contact.address.street },
  { re: /\b(address line 2|address 2|apt|apartment|suite|unit)\b/, path: "contact.address.street2", specificity: 0.9, get: () => "" },
  { re: /\b(city|town)\b/, path: "contact.address.city", specificity: 0.93, get: (a) => a.contact.address.city }, // "city of birth", "city of your school"
  { re: /\b(state|province|region)\b/, path: "contact.address.state", specificity: 0.75, get: (a) => a.contact.address.state }, // "state of incorporation", "please state…"
  { re: /\b(zip|postal code|postcode|zip code)\b/, path: "contact.address.zip", specificity: 0.99, get: (a) => a.contact.address.zip },
  { re: /\b(country|nation)\b/, path: "contact.address.country", specificity: 0.9, get: (a) => a.contact.address.country || "United States" },
  { re: /\b(date of birth|birth ?date|dob|birthday)\b/, path: "identity.dateOfBirth", specificity: 0.99, get: (a) => a.identity.dateOfBirth },
  { re: /\b(citizen|citizenship|immigration status)\b/, path: "identity.citizenship", specificity: 0.95, get: (a) => a.identity.citizenship },
  { re: /\b(current gpa|cumulative gpa|gpa|grade point)\b/, path: "academic.gpa", specificity: 0.98, get: (a) => a.academic.gpa }, // "high school GPA" vs "college GPA" is a real collision
  { re: /\b(intended major|major|field of study|program of study|area of study)\b/, path: "academic.major", specificity: 0.92, get: (a) => a.academic.major },
  { re: /\b(minor)\b/, path: "academic.minor", specificity: 0.8, get: (a) => a.academic.minor }, // "are you a minor?" is a different question entirely
  { re: /\b(current school|college|university|institution|school you attend|current institution)\b/, path: "academic.currentSchool", specificity: 0.85, get: (a) => a.academic.currentSchool },
  { re: /\b(high school)\b/, path: "academic.highSchool", specificity: 0.97, get: (a) => a.academic.highSchool },
  // Bare "status" matches "Marital status", "Employment status", "Veteran status", "Enrollment
  // status". The worst rule in this table; kept because the other alternatives do fire correctly.
  { re: /\b(class level|year in school|grade level|academic level|classification|student status|status)\b/, path: "academic.classLevel", specificity: 0.55, get: (a) => a.academic.classLevel },
  { re: /\b(expected graduation|graduation date|anticipated graduation|grad year)\b/, path: "academic.expectedGraduation", specificity: 0.97, get: (a) => a.academic.expectedGraduation },
  { re: /\b(sat)\b/, path: "academic.sat", specificity: 0.9, get: (a) => a.academic.sat },
  { re: /\b(act)\b/, path: "academic.act", specificity: 0.85, get: (a) => a.academic.act }, // "act" is a common English word
  { re: /\b(career goal|career objective|future plans|professional goal|what do you plan)\b/, path: "careerGoal", specificity: 0.9, get: (a) => a.careerGoal },
  { re: /\b(intended (career|profession|field)|field of interest)\b/, path: "intendedField", specificity: 0.93, get: (a) => a.intendedField },
];

// Fields we intentionally leave blank (optional / decline-to-state), unless a form forces them.
const DECLINE: [RegExp, string][] = [
  [/\b(gender|sex)\b/, "decline to state (fill by hand if required)"],
  [/\b(ethnicity|race|hispanic|latino)\b/, "decline to state (fill by hand if required)"],
];

// first-generation must never be asserted — Colin's profile marks it unverified.
const FIRST_GEN = /\b(first[- ]generation|first[- ]gen|first in (your|my) family)\b/;

/** Which profile path a label maps to, without resolving a value. Used to size a broker grant. */
export function pathForLabel(label: string): string | null {
  const l = norm(label);
  if (!l) return null;
  for (const [re] of HARD_BLOCK) if (re.test(l)) return null;
  if (FIRST_GEN.test(l)) return null;
  for (const [re] of DECLINE) if (re.test(l)) return null;
  const hits = RULES.filter((r) => r.re.test(l));
  return hits.length ? hits[0].path : null;
}

export interface MapOpts {
  /** How the label was obtained — see liveFormExtractor. Defaults to 1.0 (a real <label>). */
  labelTier?: number;
  /** Verification quality of the underlying value, from the vault. Defaults to 1.0. */
  freshness?: number;
}

export function mapField(label: string, a: Applicant, opts: MapOpts = {}): MapResult {
  const l = norm(label);
  if (!l) return { kind: "unmapped" };

  // Blocks and declines are policy, not probability — they are never confidence-scored.
  for (const [re, reason] of HARD_BLOCK) if (re.test(l)) return { kind: "block", reason };

  // Never claim first-generation: leave any such field blank/false and note it.
  if (FIRST_GEN.test(l)) {
    return { kind: "decline", reason: "first-generation is unverified — never asserted" };
  }

  for (const [re, reason] of DECLINE) if (re.test(l)) return { kind: "decline", reason };

  // Evaluate EVERY rule rather than breaking on the first. The count is the collision signal:
  // first-match-wins used to resolve contested labels silently, which is precisely where the
  // mapper is wrong. Order still decides the winner; now the contest is recorded.
  const hits = RULES.filter((r) => r.re.test(l));
  if (!hits.length) return { kind: "unmapped" };

  const winner = hits[0];
  const value = winner.get(a) ?? "";
  if (!value) return { kind: "decline", reason: `no value on file for ${winner.path}` };

  const factors = {
    specificity: winner.specificity,
    collision: hits.length > 1 ? 0.85 : 1.0,
    labelTier: opts.labelTier ?? 1.0,
    freshness: opts.freshness ?? 1.0,
  };
  const score = factors.specificity * factors.collision * factors.labelTier * factors.freshness;

  return {
    kind: "fill",
    path: winner.path,
    value,
    confidence: {
      score: Math.round(score * 1000) / 1000,
      factors,
      competingRules: hits.slice(1).map((r) => r.path),
    },
  };
}
