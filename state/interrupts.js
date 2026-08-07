// Typed human-intervention taxonomy.
//
// The first seven entries are promoted verbatim from apply/pipeline.ts's humanGates (that file is
// otherwise deleted — its route logic is superseded by the state machine, but this list was the
// best-considered thing in the repo and it earns its keep). The rest close the gaps that the
// live executor actually hits.
//
// DOCTRINE: an interrupt is a stop, not a puzzle. Nothing in this system attempts to defeat a
// CAPTCHA, an anti-bot check, an access control, an MFA prompt, or a fee wall. Those raise and
// halt. Working around them makes the system fragile and gets accounts banned, and the human
// resolving it costs ninety seconds.

/** @typedef {keyof typeof INTERRUPTS} InterruptType */

export const INTERRUPTS = {
  // — promoted from apply/pipeline.ts:77-83 —
  ACCOUNT_NEEDED: {
    label: "Log in or create an account",
    blurb: "The portal requires an account before the form is reachable.",
    resolvable: true,
  },
  AUTOMATION_UNVERIFIED: {
    label: "Automation permission unverified",
    blurb: "This portal's terms have not been checked for automated submission.",
    resolvable: true,
  },
  ATTESTATION: {
    label: "Attestation to review",
    blurb: "The form asks you to affirm something. Only you can affirm it.",
    resolvable: true,
  },
  SIGNATURE: {
    label: "Signature required",
    blurb: "A signature is legally yours to give.",
    resolvable: true,
  },
  RECOMMENDATION: {
    label: "Recommendation to request",
    blurb: "A recommender must be contacted and coordinated with.",
    resolvable: true,
  },
  SENSITIVE_DOCUMENT: {
    label: "Sensitive document upload",
    blurb: "A transcript, tax form, or ID upload needs your eyes before it leaves the machine.",
    resolvable: true,
  },
  FEE: {
    label: "Application fee",
    blurb: "A fee is a hard stop. Nothing is paid automatically.",
    resolvable: true,
  },

  // — added: what the live executor actually encounters —
  CAPTCHA: {
    label: "CAPTCHA / bot challenge",
    blurb: "Solve it in the open browser window. Never worked around.",
    resolvable: true,
  },
  MFA: {
    label: "Two-factor code needed",
    blurb: "A code was sent to your device.",
    resolvable: true,
  },
  UNKNOWN_ELIGIBILITY: {
    label: "Eligibility unclear",
    blurb: "The rules screen returned ambiguous — a human read of the official rules decides it.",
    resolvable: true,
  },
  UNUSUAL_FINANCIAL: {
    label: "Unusual financial question",
    blurb: "A financial field outside the normal set. Confirm before anything is entered.",
    resolvable: true,
  },
  HARD_BLOCK: {
    label: "Blocked field encountered",
    blurb: "An SSN, password, payment, or government-ID field. Never auto-filled, ever.",
    resolvable: true,
  },
  LOW_CONFIDENCE_FIELD: {
    label: "Field mapping uncertain",
    blurb: "The mapper is not confident enough to fill this without you looking.",
    resolvable: true,
  },
  SUBMIT_APPROVAL: {
    label: "Approve submission",
    blurb: "The form is filled and verified. Submission is yours to authorize.",
    resolvable: true,
  },
  PORTAL_MALFUNCTION: {
    label: "Portal malfunction",
    blurb: "The page errored, timed out, or changed shape mid-run.",
    resolvable: true,
  },
  SCORING_FAILED: {
    label: "Scoring failed",
    blurb: "The match score could not be computed. Previously this fabricated a 50 — now it stops.",
    resolvable: true,
  },
};

export const INTERRUPT_TYPES = Object.keys(INTERRUPTS);

export function isInterruptType(t) {
  return Object.prototype.hasOwnProperty.call(INTERRUPTS, t);
}

/** Interrupts that must never be auto-resolved by any code path, only by a person. */
export const HUMAN_ONLY = new Set([
  "ATTESTATION",
  "SIGNATURE",
  "FEE",
  "CAPTCHA",
  "MFA",
  "SENSITIVE_DOCUMENT",
  "SUBMIT_APPROVAL",
  "HARD_BLOCK",
]);
