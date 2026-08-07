// The canonical application state machine — ONE implementation, imported by both the Vite
// dashboard and Bun scripts.
//
// Plain .js with JSDoc types on purpose: a .ts file would need a build step before Bun scripts
// and the browser bundle could share it, and that friction is precisely why this repo grew two
// parallel state machines (apply/pipeline.ts, now deleted, and src/lib/scholarshipWorkflow.js).
//
// Two design notes on the state list itself:
//   1. `verified` and `prioritized` were never states — they are attributes. Source trust and
//      expected benefit are already stored as fields on the record, so they were demoted; a
//      record can be trustworthy AND unprioritized without needing a state for each combination.
//   2. `won/rejected` was one state holding two outcomes. Splitting it is a safety requirement:
//      reaching WON must be gated on real evidence (scholarship scams routinely send "you won"
//      mail), while LOST needs no gate at all. One state cannot carry two different guards.

/** @typedef {"DISCOVERED"|"ELIGIBILITY_CHECKED"|"ACCOUNT_NEEDED"|"AUTHENTICATED"|"FORM_MAPPED"|"ANSWERS_READY"|"REVIEW_REQUIRED"|"SUBMITTED"|"AWAITING_RESULT"|"WON"|"LOST"|"DISQUALIFIED"} AppState */

/** @type {AppState[]} */
export const STATES = [
  "DISCOVERED",
  "ELIGIBILITY_CHECKED",
  "ACCOUNT_NEEDED",
  "AUTHENTICATED",
  "FORM_MAPPED",
  "ANSWERS_READY",
  "REVIEW_REQUIRED",
  "SUBMITTED",
  "AWAITING_RESULT",
  "WON",
  "LOST",
  "DISQUALIFIED",
];

export const STATE_LABELS = {
  DISCOVERED: "Discovered",
  ELIGIBILITY_CHECKED: "Eligibility checked",
  ACCOUNT_NEEDED: "Account needed",
  AUTHENTICATED: "Authenticated",
  FORM_MAPPED: "Form mapped",
  ANSWERS_READY: "Answers ready",
  REVIEW_REQUIRED: "Needs review",
  SUBMITTED: "Submitted",
  AWAITING_RESULT: "Awaiting result",
  WON: "Won",
  LOST: "Lost",
  DISQUALIFIED: "Disqualified",
};

/** Terminal states — nothing advances out of these. */
export const TERMINAL = new Set(["WON", "LOST", "DISQUALIFIED"]);

/**
 * Legacy 9-state vocabulary → canonical. `verified` and `prioritized` collapse onto the state
 * they were decorating; the attribute they carried already lives in a field.
 * @type {Record<string, AppState>}
 */
export const LEGACY_TO_CANONICAL = {
  discovered: "DISCOVERED",
  verified: "DISCOVERED",
  eligible: "ELIGIBILITY_CHECKED",
  prioritized: "ELIGIBILITY_CHECKED",
  prepared: "FORM_MAPPED",
  "needs-review": "REVIEW_REQUIRED",
  submitted: "SUBMITTED",
  confirmed: "AWAITING_RESULT",
  "won/rejected": "AWAITING_RESULT", // ambiguous by construction — never auto-resolve to WON
};

/** Canonical → legacy, for any UI still rendering the old labels. */
export const CANONICAL_TO_LEGACY = {
  DISCOVERED: "discovered",
  ELIGIBILITY_CHECKED: "eligible",
  ACCOUNT_NEEDED: "eligible",
  AUTHENTICATED: "eligible",
  FORM_MAPPED: "prepared",
  ANSWERS_READY: "prepared",
  REVIEW_REQUIRED: "needs-review",
  SUBMITTED: "submitted",
  AWAITING_RESULT: "confirmed",
  WON: "won/rejected",
  LOST: "won/rejected",
  DISQUALIFIED: "won/rejected",
};

/**
 * Guards. Ported from src/lib/scholarshipWorkflow.js canAdvance() — these were the only working
 * transition guards in the repo — plus the two new ones the split enables.
 * @param {{workflowState?: string, evidenceStatus?: string, artifacts?: Array<{kind: string, verified: boolean}>}} s
 * @param {AppState} next
 * @returns {{ok: boolean, reason?: string}}
 */
export function canAdvance(s, next) {
  if (!STATES.includes(next)) return { ok: false, reason: "Unknown workflow state." };

  const current = STATES.includes(s.workflowState) ? s.workflowState : "DISCOVERED";
  if (TERMINAL.has(current)) return { ok: false, reason: `${STATE_LABELS[current]} is terminal.` };

  // Evidence gate — unchanged in spirit from the original: confidence is evidence quality, not
  // permission to guess.
  if (next === "ELIGIBILITY_CHECKED" && s.evidenceStatus !== "verified") {
    return { ok: false, reason: "Verify eligibility from the official rules first." };
  }
  if (next === "SUBMITTED" && current !== "REVIEW_REQUIRED") {
    return { ok: false, reason: "Every application must reach review before submission." };
  }
  if (next === "SUBMITTED" && s.evidenceStatus === "disqualified") {
    return { ok: false, reason: "Disqualified opportunities cannot be submitted." };
  }

  // The scam gate. An unsolicited "congratulations" email is the single most common scholarship
  // fraud vector, so WON requires a verified award-notice artifact on the record. LOST is
  // deliberately ungated — nothing bad happens from believing you lost.
  if (next === "WON") {
    const proof = (s.artifacts || []).some((a) => a.kind === "award-notice" && a.verified);
    if (!proof) return { ok: false, reason: "WON requires a verified award-notice artifact." };
  }

  return { ok: true };
}

/**
 * @param {object} s
 * @param {AppState} next
 * @returns {{record: object, error?: string}}
 */
export function advance(s, next) {
  const check = canAdvance(s, next);
  if (!check.ok) return { record: s, error: check.reason };
  return { record: { ...s, workflowState: next } };
}

/** Coerce any legacy or unknown state string onto the canonical vocabulary. */
export function toCanonical(state) {
  if (STATES.includes(state)) return state;
  return LEGACY_TO_CANONICAL[state] || "DISCOVERED";
}
