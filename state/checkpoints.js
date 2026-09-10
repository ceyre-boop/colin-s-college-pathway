// The checkpoint type registry — the queue's schema, and the only place a checkpoint type exists.
//
// Replaces state/interrupts.js. The change is not cosmetic: a checkpoint is no longer a label with
// a blurb, it is a CONTRACT. Every type declares what evidence it needs, who is allowed to resolve
// it, which resolutions are legal, and what event that resolution emits. Nothing may raise a
// free-form "needs help" — an unregistered type is a hard error, because a queue that accepts
// arbitrary strings is a queue nobody can reason about or test.
//
// INVARIANTS THIS FILE EXISTS TO ENFORCE
//   • Unknown beats guessed. Ambiguity routes here rather than resolving from weak evidence.
//   • Policy outranks confidence. Sensitive fields stop here no matter how certain the mapper is.
//   • "Decline to state" is a value, not missing data — see ELIGIBILITY_AMBIGUOUS.
//   • Irreversible actions are attributable: resolverRoles is never ["agent"] for anything that
//     signs, pays, submits, or accepts.
//
// The queue itself is a PROJECTION of checkpoint_raised / checkpoint_resolved events. Nothing
// mutates a checkpoint object; resolution is an event, and the object is rebuilt from the log.

/**
 * @typedef {"agent"|"human"} Role
 * @typedef {object} CheckpointSpec
 * @property {string} question        what the human is actually being asked
 * @property {boolean} blocking       does the application stop here
 * @property {string[]} requiredEvidence  evidence refs that must be attached before resolving
 * @property {string[]} allowedResolutions  the only legal resolution values
 * @property {Role[]} resolverRoles   who may resolve it
 * @property {string|null} emitsOnResolve  extra event emitted on a successful resolution
 * @property {string} rationale       why this is a checkpoint and not automation
 */

/** @type {Record<string, CheckpointSpec>} */
export const CHECKPOINTS = {
  CAPTCHA_REQUIRED: {
    question: "Solve the bot challenge in the open browser window, then confirm.",
    blocking: true,
    requiredEvidence: [],
    allowedResolutions: ["solved", "abandoned"],
    resolverRoles: ["human"],
    emitsOnResolve: null,
    rationale: "Never worked around. Defeating a bot challenge is fragile and gets accounts banned; ninety seconds of a human's time is cheaper.",
  },

  MFA_REQUIRED: {
    question: "Enter the two-factor code from your device in the open window, then confirm.",
    blocking: true,
    requiredEvidence: [],
    allowedResolutions: ["completed", "abandoned"],
    resolverRoles: ["human"],
    emitsOnResolve: null,
    rationale: "The second factor is on the user's device by design. Automating it would defeat its purpose.",
  },

  ACCOUNT_REQUIRED: {
    question: "This portal needs an account before the form is reachable. Sign in or register, then confirm.",
    blocking: true,
    requiredEvidence: [],
    allowedResolutions: ["authenticated", "skipped"],
    resolverRoles: ["human"],
    emitsOnResolve: "state_changed",
    rationale: "Credentials belong to the user. The agent inherits an authenticated session; it never creates one.",
  },

  ELIGIBILITY_AMBIGUOUS: {
    question: "The rules screen could not decide. Read the official rules: are you eligible?",
    blocking: true,
    requiredEvidence: ["rules_url"],
    allowedResolutions: ["eligible", "not_eligible", "decline_to_state"],
    resolverRoles: ["human"],
    emitsOnResolve: "eligibility_screened",
    rationale:
      "Unknown beats guessed. 'decline_to_state' is a first-class outcome, not missing data — it records that a demographic question was deliberately left unanswered, so no later logic invents an answer.",
  },

  FINANCIAL_FIELD_REVIEW: {
    question: "A financial field needs your eyes before anything is entered. What should it say?",
    blocking: true,
    requiredEvidence: ["field_label"],
    allowedResolutions: ["value_provided", "leave_blank", "abandoned"],
    resolverRoles: ["human"],
    emitsOnResolve: null,
    rationale: "Policy outranks confidence. Financial answers are never auto-typed regardless of how well-verified the underlying value is.",
  },

  LEGAL_ATTESTATION_REQUIRED: {
    question: "This form asks you to affirm something. Read it and decide.",
    blocking: true,
    requiredEvidence: ["attestation_text"],
    allowedResolutions: ["affirmed", "declined"],
    resolverRoles: ["human"],
    emitsOnResolve: "attestation_recorded",
    rationale: "An affirmation is a statement by a person. Nothing may affirm on the applicant's behalf.",
  },

  SIGNATURE_REQUIRED: {
    question: "A signature is required. Sign in the open window, then confirm.",
    blocking: true,
    requiredEvidence: [],
    allowedResolutions: ["signed", "declined"],
    resolverRoles: ["human"],
    emitsOnResolve: "attestation_recorded",
    rationale: "Same as attestation: legally the applicant's act, not the agent's.",
  },

  RECOMMENDATION_REQUIRED: {
    question: "This application needs a recommender. Who, and have they been asked?",
    blocking: true,
    requiredEvidence: ["recommender_name"],
    allowedResolutions: ["requested", "received", "abandoned"],
    resolverRoles: ["human"],
    emitsOnResolve: "recommendation_requested",
    rationale: "Contacting a third party on the applicant's behalf is irreversible and social. Always a human decision.",
  },

  DOCUMENT_UPLOAD_REQUIRED: {
    question: "A document upload is required. Attach it in the open window, then confirm.",
    blocking: true,
    requiredEvidence: ["document_kind"],
    allowedResolutions: ["uploaded", "skipped"],
    resolverRoles: ["human"],
    emitsOnResolve: "artifact_added",
    rationale: "Transcripts and IDs leave the machine permanently. The human sees exactly what goes.",
  },

  APPLICATION_FEE: {
    question: "This application charges a fee. Pay it yourself if you want to proceed.",
    blocking: true,
    requiredEvidence: ["fee_evidence"],
    allowedResolutions: ["paid", "abandoned"],
    resolverRoles: ["human"],
    emitsOnResolve: null,
    rationale: "Nothing in this system spends money. A fee is a hard stop.",
  },

  FIELD_MAPPING_UNCERTAIN: {
    question: "The mapper is not confident about this field. What should it say?",
    blocking: false,
    requiredEvidence: ["field_label", "confidence"],
    allowedResolutions: ["value_provided", "leave_blank", "mapping_confirmed"],
    resolverRoles: ["human"],
    emitsOnResolve: null,
    rationale: "Non-blocking: the rest of the form still fills. But the field is left empty rather than guessed.",
  },

  BLOCKED_FIELD_PRESENT: {
    question: "This form asks for something that is never auto-filled (SSN, password, payment, government ID). Handle it by hand.",
    blocking: true,
    requiredEvidence: ["field_label"],
    allowedResolutions: ["handled", "abandoned"],
    resolverRoles: ["human"],
    emitsOnResolve: null,
    rationale: "These categories are never stored and never typed. Their presence removes the form from every automated class.",
  },

  SUBMIT_APPROVAL: {
    question: "The form is filled and screenshotted. Approve submission?",
    blocking: true,
    requiredEvidence: ["filled_screenshot", "rendered_digest"],
    allowedResolutions: ["approved", "rejected"],
    resolverRoles: ["human"],
    emitsOnResolve: null,
    rationale: "Submission is irreversible and goes out in a real person's name. Attribution is recorded on resolution.",
  },

  AWARD_NOTICE_REVIEW: {
    question: "Something claims this application won. Verify it against the official source before believing it.",
    blocking: true,
    requiredEvidence: ["notice_source", "notice_ref"],
    allowedResolutions: ["verified_win", "not_a_win", "scam_suspected"],
    resolverRoles: ["human"],
    emitsOnResolve: "artifact_added",
    rationale:
      "Scholarship scams overwhelmingly arrive as unsolicited 'you won' mail. WON is gated on a verified artifact at the machine layer; this is the only path that can produce one. 'Finalist' is not a win.",
  },

  PDF_DRAFT_REVIEW: {
    question: "A draft PDF was filled from your profile. Review every field, then sign/attach and submit by hand.",
    blocking: true,
    requiredEvidence: ["draft_pdf_path"],
    allowedResolutions: ["reviewed", "abandoned"],
    resolverRoles: ["human"],
    emitsOnResolve: null,
    rationale:
      "A PDF adapter fills what mapField() maps and nothing else — same hard-block/decline rules as the " +
      "web-form path. Signature, attachments, and the actual mail/email/portal submission stay a human " +
      "step, same as SUBMIT_APPROVAL.",
  },

  PORTAL_MALFUNCTION: {
    question: "The portal errored, timed out, or changed shape mid-run. Look at it?",
    blocking: true,
    requiredEvidence: ["error_detail"],
    allowedResolutions: ["retry", "abandoned"],
    resolverRoles: ["human"],
    emitsOnResolve: null,
    rationale: "A page that stopped behaving is not a page to keep clicking. The agent observes and stops.",
  },

  SCORING_FAILED: {
    question: "The match score could not be computed for these listings. Score by hand or skip?",
    blocking: false,
    requiredEvidence: ["batch_size"],
    allowedResolutions: ["scored_manually", "skipped"],
    resolverRoles: ["human"],
    emitsOnResolve: null,
    rationale: "This previously fabricated a match of 50, which then had to be laundered out downstream. A missing score is now missing, not invented.",
  },

  SUSPECTED_PROMPT_INJECTION: {
    question: "A scraped listing contains text that reads like instructions to an agent. Review it.",
    blocking: false,
    requiredEvidence: ["listing_url", "patterns"],
    allowedResolutions: ["benign", "malicious", "skipped"],
    resolverRoles: ["human"],
    emitsOnResolve: null,
    rationale: "The page is an untrusted interface, never authoritative. Content that tries to instruct the agent is a signal about the listing, not a command.",
  },

  // ---- voice corpus (Colin-AI) ----------------------------------------------

  CORPUS_AUTHORSHIP_UNVERIFIED: {
    question: "Did you personally write this document, with no LLM drafting or rewriting?",
    blocking: true,
    requiredEvidence: ["sourceId", "excerpt", "wordCount"],
    allowedResolutions: ["colin_wrote_it", "llm_assisted", "not_mine", "unsure"],
    resolverRoles: ["human"],
    emitsOnResolve: "corpus_doc_verified",
    rationale: "No classifier can tell whether Colin pasted his own text or an LLM's — the surface features that would give it away are exactly what a voice-conditioned model reproduces. Only he knows. A voice model trained on LLM output is a voice model of the LLM, and it would score well while being worthless.",
  },

  EVAL_PREREGISTRATION_REVIEW: {
    question: "These are the success bands and falsification rules. Sign them before any result exists?",
    blocking: true,
    requiredEvidence: ["prereg_sha256", "bands", "primary_endpoint"],
    allowedResolutions: ["signed", "revised", "abandoned"],
    resolverRoles: ["human"],
    emitsOnResolve: "eval_preregistered",
    rationale: "A band chosen after seeing the result is not a band. Signing happens once, before the first run, and the hash is chained into the log so a later edit is detectable rather than silent.",
  },

  VOICE_REGISTER_DRIFT: {
    question: "Generated text does not match the requested register after one retry. Ship, regenerate, or drop?",
    blocking: false,
    requiredEvidence: ["requested_register", "nearest_register", "violated_features"],
    allowedResolutions: ["ship_anyway", "regenerate", "dropped"],
    resolverRoles: ["human"],
    emitsOnResolve: null,
    rationale: "Register control is the research claim. Silently shipping text that failed its own contract would make the claim unfalsifiable — the failures are the finding.",
  },

  CORPUS_SKELETON_LEAK: {
    question: "A generated seed still leaks phrasing from its source piece after one retry. Review it.",
    blocking: false,
    requiredEvidence: ["sourceId", "violation", "skeleton"],
    allowedResolutions: ["accepted", "rewritten", "dropped"],
    resolverRoles: ["human"],
    emitsOnResolve: null,
    rationale: "A seed carrying the target's own phrasing turns the eval into a copying test the model cannot fail. Leak checks run in code; this is where the ones code cannot settle go.",
  },
};

export const CHECKPOINT_TYPES = Object.keys(CHECKPOINTS);

export function isCheckpointType(t) {
  return Object.prototype.hasOwnProperty.call(CHECKPOINTS, t);
}

export function spec(type) {
  const s = CHECKPOINTS[type];
  if (!s) throw new Error(`Unknown checkpoint type "${type}". Add it to state/checkpoints.js — free-form checkpoints are not allowed.`);
  return s;
}

/** Types no agent may ever resolve. Derived, so it cannot drift from the specs. */
export const HUMAN_ONLY = new Set(CHECKPOINT_TYPES.filter((t) => !CHECKPOINTS[t].resolverRoles.includes("agent")));

/** Blocking types halt their application until resolved. */
export const BLOCKING = new Set(CHECKPOINT_TYPES.filter((t) => CHECKPOINTS[t].blocking));
