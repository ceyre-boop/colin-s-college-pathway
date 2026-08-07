// Truth-preserving scholarship workflow and prioritization.
//
// Confidence is evidence quality, not permission to guess. An unverified claim
// must stay in review until Colin confirms it from a source document or the
// official application rules.
//
// AS OF THE STATE UNIFICATION: the canonical machine lives in ./machine.js and is shared with the
// Bun scripts. This module is now the *dashboard adapter* over it — it keeps the legacy 9-state
// vocabulary that the UI renders and that localStorage holds, and translates in both directions.
// New code should import from machine.js; this file exists so the React app keeps working and so
// an existing localStorage blob upconverts instead of being dropped.

import { toCanonical, CANONICAL_TO_LEGACY } from "./machine.js";

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

/**
 * Canonical state carried alongside the legacy one. Accepts either vocabulary, so a v2
 * localStorage blob (legacy strings) and a v3 record (canonical) both resolve correctly.
 */
export function canonicalStateOf(s) {
  if (s.canonicalState) return toCanonical(s.canonicalState);
  if (s.workflowState) return toCanonical(s.workflowState);
  return toCanonical(LEGACY_TO_WORKFLOW[s.status] || "discovered");
}

export function normalizeScholarship(s) {
  // Accept a canonical state too — records that came back from the projection speak that
  // vocabulary, records from localStorage v2 speak the legacy one.
  const canonicalState = canonicalStateOf(s);
  const workflowState = WORKFLOW_STATES.includes(s.workflowState)
    ? s.workflowState
    : CANONICAL_TO_LEGACY[canonicalState] || LEGACY_TO_WORKFLOW[s.status] || "discovered";
  const eligibilityConfidence = Math.max(0, Math.min(1, Number(s.eligibilityConfidence ?? (typeof s.match === "number" ? s.match / 100 : 0))));
  const realisticWinRate = Math.max(0, Math.min(1, Number(s.realisticWinRate ?? 0.03)));
  const effortHours = Number(s.effortHours ?? EFFORT_HOURS[s.effort] ?? 1);
  const evidenceStatus = s.evidenceStatus || (typeof s.match === "number" ? "plausible" : "unknown");
  return {
    ...s,
    workflowState,
    canonicalState,
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

// NOTE: these guards operate on the LEGACY vocabulary, where "won/rejected" is a single state and
// therefore cannot carry the verified-award-notice gate (blocking it would also block marking a
// rejection). machine.js splits WON/LOST and applies that gate; the dashboard inherits it when the
// interventions work lands and the UI moves onto canonical states.
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
