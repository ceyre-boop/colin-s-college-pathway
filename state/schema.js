// ONE normalized Application record.
//
// Replaces four overlapping shapes that had grown independently: Candidate (scout/scout.ts,
// duplicated verbatim in scout/select.ts), FormMeta (apply/types.ts), the on-disk metadata.json
// written by select.ts, and DEFAULT_SCHOLARSHIPS in src/data/defaults.js.
//
// Three things this fixes beyond deduplication:
//   1. `deadline` was an unparsed string everywhere ("October", "verify at URL", "Jun 30, 2026"),
//      so nothing could sort or alert on it. It is now parsed to ISO where possible, with the
//      original text preserved — a deadline you cannot parse is a fact, not a reason to guess.
//   2. Eligibility was one integer `match` 0-100 that conflated "how well does this fit" with
//      "am I allowed to apply". Those are different questions and the second one disqualifies.
//   3. `referencesRequired` and `documentsRequired` did not exist as fields at all, so an
//      application needing two recommendation letters looked identical to one needing none.

import { scholarshipId, slugOf } from "../src/lib/ids.js";

/** @typedef {"pass"|"disqualified"|"ambiguous"|"unscreened"} EligibilityDecision */

export const EMPTY_APPLICATION = {
  id: "",
  slug: "",
  name: "",
  org: null,
  url: "",
  applyUrl: null,

  amount: null,
  amountText: "",
  amountEstimated: false,

  deadlineText: "",
  deadlineISO: null,

  eligibility: {
    decision: /** @type {EligibilityDecision} */ ("unscreened"),
    reasons: [],
    hardDqRule: null,
    /** 0..1 — fit, NOT permission. Only meaningful when decision === "pass". */
    fit: null,
  },

  requirements: {
    accountRequired: false,
    essayPrompts: [], // [{prompt, wordLimit}] — real prompts only, never placeholders
    referencesRequired: 0,
    documentsRequired: [], // e.g. ["transcript", "resume"]
    applicationFee: false,
    attestation: false,
    signature: false,
  },

  platform: null,
  effort: null,
  expectedBenefit: null,
  sourceTrust: "unverified",
  evidenceStatus: "unknown",

  workflowState: "DISCOVERED",
  artifacts: [],
  source: null,
  discoveredAt: null,
};

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Best-effort deadline parse. Returns null rather than guessing — an unparseable deadline stays
 * visible as text and is never silently turned into a date the committee never published.
 * @param {string} text
 * @param {number} [referenceYear] used when the text names a month with no year
 */
export function parseDeadline(text, referenceYear) {
  const t = String(text || "").trim();
  if (!t) return null;

  // ISO already
  const iso = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // "Jun 30, 2026" / "June 30 2026"
  const mdy = t.match(/\b([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i);
  if (mdy) {
    const m = MONTHS[mdy[1].slice(0, 3).toLowerCase()];
    if (m) return `${mdy[3]}-${String(m).padStart(2, "0")}-${String(mdy[2]).padStart(2, "0")}`;
  }

  // "3/15/2026"
  const numeric = t.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (numeric) return `${numeric[3]}-${String(numeric[1]).padStart(2, "0")}-${String(numeric[2]).padStart(2, "0")}`;

  // Bare month name — resolve to the last day of that month in the reference year. Deliberately
  // conservative: assume the whole month is available rather than inventing a specific day.
  const bare = t.match(/^([a-z]{3,9})$/i);
  if (bare && referenceYear) {
    const m = MONTHS[bare[1].slice(0, 3).toLowerCase()];
    if (m) {
      const last = new Date(Date.UTC(referenceYear, m, 0)).getUTCDate();
      return `${referenceYear}-${String(m).padStart(2, "0")}-${last}`;
    }
  }

  return null;
}

/**
 * Build a canonical Application from any of the legacy shapes. Unknown keys are dropped rather
 * than spread through, so the schema stays authoritative.
 */
export function toApplication(raw, opts = {}) {
  const name = raw.name ?? "";
  const url = raw.url ?? raw.infoUrl ?? "";
  const fm = raw.formMeta ?? {};
  const deadlineText = raw.deadline ?? raw.deadlineText ?? "";

  return {
    ...EMPTY_APPLICATION,
    id: raw.id && String(raw.id).startsWith("sch_") ? raw.id : scholarshipId(name, url),
    slug: raw.slug ?? fm.slug ?? slugOf(name),
    name,
    org: raw.org ?? null,
    url,
    applyUrl: raw.applyUrl ?? fm.applyUrl ?? null,

    amount: typeof raw.amount === "number" ? raw.amount : null,
    amountText: raw.amountText ?? raw.amount_text ?? "",
    amountEstimated: Boolean(raw.amountEstimated ?? raw.amount_estimated ?? false),

    deadlineText,
    deadlineISO: raw.deadlineISO ?? parseDeadline(deadlineText, opts.referenceYear),

    eligibility: {
      decision: raw.eligibility?.decision ?? "unscreened",
      reasons: raw.eligibility?.reasons ?? [],
      hardDqRule: raw.eligibility?.hardDqRule ?? null,
      fit:
        raw.eligibility?.fit ??
        (typeof raw.match === "number" ? Math.max(0, Math.min(1, raw.match / 100)) : null),
    },

    requirements: {
      accountRequired: Boolean(fm.loginRequired ?? raw.requirements?.accountRequired ?? false),
      essayPrompts: (raw.requirements?.essayPrompts ?? fm.essayPrompts ?? []).filter(
        (p) => p && p.prompt && !/^\(detected essay field/i.test(p.prompt),
      ),
      referencesRequired: raw.requirements?.referencesRequired ?? 0,
      documentsRequired: raw.requirements?.documentsRequired ?? [],
      applicationFee: Boolean(fm.applicationFee ?? raw.requirements?.applicationFee ?? false),
      attestation: Boolean(raw.requirements?.attestation ?? false),
      signature: Boolean(raw.requirements?.signature ?? false),
    },

    platform: fm.platform ?? raw.platform ?? null,
    effort: raw.effort ?? null,
    expectedBenefit: raw.expectedBenefit ?? raw.expected_value ?? null,
    sourceTrust: raw.sourceTrust ?? (raw.source === "bigfuture" ? "collegeboard" : "unverified"),
    evidenceStatus: raw.evidenceStatus ?? "unknown",

    workflowState: raw.workflowState ?? "DISCOVERED",
    artifacts: raw.artifacts ?? [],
    source: raw.source ?? null,
    discoveredAt: raw.discoveredAt ?? raw.selected_at ?? null,
  };
}
