// Truth-preserving scholarship workflow and prioritization.
//
// Confidence is evidence quality, not permission to guess. An unverified claim
// must stay in review until Colin confirms it from a source document or the
// official application rules.

export const WORKFLOW_STATES = [
  "discovered",
  "verified",
  "eligible",
  "prioritized",
  "prepared",
  "needs-review",
  "submitted",
  "confirmed",
  "won/rejected",
];

export const WORKFLOW_LABELS = {
  discovered: "Discovered",
  verified: "Verified",
  eligible: "Eligible",
  prioritized: "Prioritized",
  prepared: "Prepared",
  "needs-review": "Needs review",
  submitted: "Submitted",
  confirmed: "Confirmed",
  "won/rejected": "Won / rejected",
};

export const EVIDENCE_STATUS = {
  verified: "Verified from official rules or a document",
  plausible: "Plausible, but not verified",
  unknown: "Unknown",
  disqualified: "Disqualified — do not apply",
};

const LEGACY_TO_WORKFLOW = {
  research: "discovered",
  future: "discovered",
  apply: "discovered",
  applied: "submitted",
  pending: "confirmed",
  won: "won/rejected",
  rejected: "won/rejected",
};

const EFFORT_HOURS = { low: 0.15, med: 0.75, high: 2.5 };

export function normalizeScholarship(s) {
  const workflowState = WORKFLOW_STATES.includes(s.workflowState)
    ? s.workflowState
    : LEGACY_TO_WORKFLOW[s.status] || "discovered";
  const eligibilityConfidence = Math.max(0, Math.min(1, Number(s.eligibilityConfidence ?? (typeof s.match === "number" ? s.match / 100 : 0))));
  const realisticWinRate = Math.max(0, Math.min(1, Number(s.realisticWinRate ?? 0.03)));
  const effortHours = Number(s.effortHours ?? EFFORT_HOURS[s.effort] ?? 1);
  const evidenceStatus = s.evidenceStatus || (typeof s.match === "number" ? "plausible" : "unknown");
  return {
    ...s,
    workflowState,
    eligibilityConfidence,
    realisticWinRate,
    effortHours,
    evidenceStatus,
    sourceTrust: s.sourceTrust || (s.source === "bigfuture" ? "collegeboard" : "unverified"),
    expectedBenefit: expectedBenefit({ ...s, eligibilityConfidence, realisticWinRate, effortHours }),
  };
}

// Golden-ratio score: expected award × realistic win rate × eligibility confidence
// − application effort. Effort is converted into a modest dollar cost so the
// score remains interpretable without pretending time is free.
export function expectedBenefit(s) {
  const award = Math.max(0, Number(s.amount) || 0);
  const winRate = Math.max(0, Math.min(1, Number(s.realisticWinRate ?? 0)));
  const eligibility = Math.max(0, Math.min(1, Number(s.eligibilityConfidence ?? 0)));
  const hours = Math.max(0, Number(s.effortHours ?? EFFORT_HOURS[s.effort] ?? 1));
  const effortCost = hours * 20;
  return Math.round((award * winRate * eligibility - effortCost) * 100) / 100;
}

export function prioritize(s) {
  return { ...s, workflowState: "prioritized", expectedBenefit: expectedBenefit(s) };
}

export function canAdvance(s, next) {
  if (!WORKFLOW_STATES.includes(next)) return { ok: false, reason: "Unknown workflow state." };
  if (next === "eligible" && s.evidenceStatus !== "verified") return { ok: false, reason: "Verify eligibility from the official rules first." };
  if (next === "prepared" && s.workflowState !== "prioritized") return { ok: false, reason: "Prioritize the opportunity before preparing it." };
  if (next === "submitted" && s.workflowState !== "needs-review") return { ok: false, reason: "Every application must reach needs-review before submission." };
  if (next === "submitted" && s.evidenceStatus === "disqualified") return { ok: false, reason: "Disqualified opportunities cannot be submitted." };
  return { ok: true };
}

export function advance(s, next) {
  const check = canAdvance(s, next);
  if (!check.ok) return { scholarship: s, error: check.reason };
  return { scholarship: { ...s, workflowState: next, expectedBenefit: expectedBenefit(s) } };
}
