// Scores, remembered between runs.
//
// Scoring is the expensive half of the scout: every candidate goes through an LLM call, and
// before this file existed every daily run re-scored all ~4,000 of them from scratch — hours of
// inference to re-derive the same numbers for the same listings. The harvest grows by a handful
// of entries a day; the scores for everything else do not change.
//
// So a score is kept, keyed by the listing's normalized name (the same identity the scout's
// cross-source dedupe uses), and the daily run only pays for what it has never seen.
//
// Two things deliberately invalidate a cached score:
//   - A changed profile. `match` is "does COLIN qualify", so it is meaningless against a
//     different profile. The whole cache is dropped when the profile hash moves.
//   - Age. Listings are edited and awards are retired, so an entry older than MAX_AGE_DAYS is
//     treated as absent and re-scored.
//
// A failed score is never cached — `score_failed` entries carry a placeholder 50% match that
// must not be allowed to harden into a remembered answer.

import { createHash } from "crypto";

export const MAX_AGE_DAYS = 90;

export interface CachedScore {
  match: number;
  effort: "low" | "med" | "high";
  flags: string[];
  at: string; // ISO timestamp of when this score was taken
}

export interface ScoreCacheFile {
  profileHash: string;
  scores: Record<string, CachedScore>;
}

/** The listing's identity: the same normalization the cross-source dedupe keys on. */
export function cacheKey(name: string): string {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** A short, stable fingerprint of the profile the scores were taken against. */
export function profileHash(compactProfile: string): string {
  return createHash("sha256").update(compactProfile).digest("hex").slice(0, 16);
}

/** A cached score is usable only while it is fresh; after that the listing gets another look. */
export function isFresh(entry: CachedScore, now: Date = new Date(), maxAgeDays = MAX_AGE_DAYS): boolean {
  const at = Date.parse(entry.at);
  if (Number.isNaN(at)) return false;
  return (now.getTime() - at) / 86_400_000 < maxAgeDays;
}

/** Never remember a placeholder — only a real answer from the scorer. */
export function isCacheable(c: { match?: number; effort?: string; flags?: string[] }): boolean {
  if (typeof c.match !== "number" || !Number.isFinite(c.match)) return false;
  if (!["low", "med", "high"].includes(String(c.effort))) return false;
  return !(c.flags ?? []).includes("score_failed");
}

/**
 * The usable scores from a cache file, as a map. A file written against a different profile
 * returns empty — not stale answers for the wrong student.
 */
export function usableScores(
  file: ScoreCacheFile | null,
  hash: string,
  now: Date = new Date(),
  maxAgeDays = MAX_AGE_DAYS,
): Map<string, CachedScore> {
  const out = new Map<string, CachedScore>();
  if (!file || file.profileHash !== hash || !file.scores) return out;
  for (const [k, v] of Object.entries(file.scores)) {
    if (v && isFresh(v, now, maxAgeDays)) out.set(k, v);
  }
  return out;
}

/**
 * The cache file to write after a run: this run's scores, plus the entries that were already
 * there and are still fresh. Nothing is forgotten just because a source stopped listing it.
 */
export function mergedCache(
  previous: ScoreCacheFile | null,
  hash: string,
  scored: Array<{ name: string; match?: number; effort?: string; flags?: string[] }>,
  now: Date = new Date(),
  maxAgeDays = MAX_AGE_DAYS,
): ScoreCacheFile {
  const scores: Record<string, CachedScore> = {};
  for (const [k, v] of usableScores(previous, hash, now, maxAgeDays)) scores[k] = v;
  for (const c of scored) {
    if (!isCacheable(c)) continue;
    const key = cacheKey(c.name);
    if (!key) continue;
    scores[key] = {
      match: c.match as number,
      effort: c.effort as CachedScore["effort"],
      flags: c.flags ?? [],
      at: now.toISOString(),
    };
  }
  return { profileHash: hash, scores };
}
