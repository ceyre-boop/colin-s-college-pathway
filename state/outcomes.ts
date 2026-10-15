// Outcome → win-rate feedback loop — Phase 4 of the gap-close plan.
//
// AWARD_NOTICE_REVIEW (state/checkpoints.js) already gates WON on a verified artifact — that IS
// this repo's outcome-tracking. What's missing is closing the loop: scout.ts's `expectedValue`
// today uses raw Claude `match%` as a stand-in for P(win), which is exactly the naive heuristic
// the eligibility.fit doc-comment already warns against — fit and win probability are different
// questions. This module reads the resolved-checkpoint history back out as a realized win-rate,
// bucketed by (source, effort), for scout.ts to blend in once there's enough signal to trust.
//
// Small-sample honesty: below MIN_SAMPLE resolved outcomes in a bucket, callers get `null` and
// must fall back to their current behavior — a rate computed from 1-2 data points is not a
// signal, it's noise wearing a signal's clothes.

import { readFileSync, existsSync } from "fs";
import { PROJECTION_PATH } from "./rebuild";

export const MIN_SAMPLE = 5;

export interface OutcomeBucket {
  key: string; // `${source}:${effort}`
  source: string;
  effort: string;
  wins: number;
  total: number;
  rate: number; // wins / total
}

interface ResolvedRecord {
  type: string;
  applicationId: string | null;
  resolution: string;
}

interface ProjectionLike {
  applications: Record<string, { source: string | null; effort: string | null }>;
  resolved: ResolvedRecord[];
}

function loadProjection(): ProjectionLike | null {
  if (!existsSync(PROJECTION_PATH)) return null;
  return JSON.parse(readFileSync(PROJECTION_PATH, "utf8"));
}

const bucketKey = (source: string, effort: string) => `${source}:${effort}`;

/** All (source, effort) buckets with at least one resolved AWARD_NOTICE_REVIEW. Includes buckets
 * below MIN_SAMPLE — callers decide whether to trust them via `.total >= MIN_SAMPLE`. */
export function computeOutcomeBuckets(projection: ProjectionLike): OutcomeBucket[] {
  const buckets = new Map<string, OutcomeBucket>();
  for (const r of projection.resolved) {
    if (r.type !== "AWARD_NOTICE_REVIEW") continue;
    if (r.resolution !== "verified_win" && r.resolution !== "not_a_win") continue; // scam_suspected: not an outcome signal
    const app = r.applicationId ? projection.applications[r.applicationId] : null;
    const source = app?.source ?? "unknown";
    const effort = app?.effort ?? "unknown";
    const key = bucketKey(source, effort);
    const b = buckets.get(key) ?? { key, source, effort, wins: 0, total: 0, rate: 0 };
    b.total++;
    if (r.resolution === "verified_win") b.wins++;
    b.rate = b.wins / b.total;
    buckets.set(key, b);
  }
  return [...buckets.values()].sort((a, b) => b.total - a.total);
}

/** Realized win-rate for one (source, effort) bucket, or null below MIN_SAMPLE — the caller's
 * existing match%-based estimate should be used unchanged when this returns null. */
export function realizedWinRate(buckets: OutcomeBucket[], source: string, effort: string): number | null {
  const b = buckets.find((x) => x.key === bucketKey(source, effort));
  if (!b || b.total < MIN_SAMPLE) return null;
  return b.rate;
}

if (import.meta.main) {
  const projection = loadProjection();
  if (!projection) {
    console.log(`No projection at ${PROJECTION_PATH} yet — run \`bun state/rebuild.ts\` first.`);
    process.exit(0);
  }
  const buckets = computeOutcomeBuckets(projection);
  if (!buckets.length) {
    console.log("No resolved AWARD_NOTICE_REVIEW outcomes yet — nothing to report.");
    process.exit(0);
  }
  console.log("source                effort  wins/total  rate   trusted (n≥5)?");
  for (const b of buckets) {
    console.log(
      `${b.source.padEnd(22)}${b.effort.padEnd(8)}${`${b.wins}/${b.total}`.padEnd(12)}${(b.rate * 100).toFixed(0).padStart(3)}%   ${b.total >= MIN_SAMPLE ? "yes" : "no — below MIN_SAMPLE"}`,
    );
  }
}
