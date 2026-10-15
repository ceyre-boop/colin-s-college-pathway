// The cache is what makes a daily run affordable, so the rules that keep it honest — a changed
// profile, an aged entry, a failed score — are the ones worth testing.
import { expect, test, describe } from "bun:test";
import { cacheKey, profileHash, isFresh, isCacheable, usableScores, mergedCache, type ScoreCacheFile } from "./score-cache";

const NOW = new Date("2026-10-14T00:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

const HASH = profileHash('{"personal":{"name":"Colin"}}');
const file = (scores: ScoreCacheFile["scores"], hash = HASH): ScoreCacheFile => ({ profileHash: hash, scores });

describe("score cache keys", () => {
  test("the key is the same identity the cross-source dedupe uses", () => {
    expect(cacheKey("Coca-Cola Scholars Program")).toBe(cacheKey("coca cola scholars program"));
    expect(cacheKey("  Hearts for Community Service!  ")).toBe("heartsforcommunityservice");
  });

  test("a different profile fingerprints differently", () => {
    expect(profileHash('{"major":"biology"}')).not.toBe(profileHash('{"major":"nursing"}'));
    expect(profileHash('{"major":"biology"}')).toBe(profileHash('{"major":"biology"}'));
  });
});

describe("what may be remembered", () => {
  test("a real score is cacheable", () => {
    expect(isCacheable({ match: 72, effort: "low", flags: [] })).toBe(true);
  });

  test("a failed score is never cached — the 50% is a placeholder, not an answer", () => {
    expect(isCacheable({ match: 50, effort: "med", flags: ["score_failed"] })).toBe(false);
  });

  test("an unscored or malformed candidate is not cached", () => {
    expect(isCacheable({})).toBe(false);
    expect(isCacheable({ match: 80, effort: "enormous", flags: [] })).toBe(false);
    expect(isCacheable({ match: NaN, effort: "low", flags: [] })).toBe(false);
  });
});

describe("freshness", () => {
  test("a recent score is used; a stale one is re-taken", () => {
    expect(isFresh({ match: 1, effort: "low", flags: [], at: ago(10) }, NOW)).toBe(true);
    expect(isFresh({ match: 1, effort: "low", flags: [], at: ago(120) }, NOW)).toBe(false);
  });

  test("an unparseable timestamp counts as stale, not as fresh", () => {
    expect(isFresh({ match: 1, effort: "low", flags: [], at: "whenever" }, NOW)).toBe(false);
  });
});

describe("loading", () => {
  const scores = {
    fresh: { match: 80, effort: "low" as const, flags: [], at: ago(3) },
    stale: { match: 20, effort: "high" as const, flags: [], at: ago(200) },
  };

  test("only fresh entries come back", () => {
    const m = usableScores(file(scores), HASH, NOW);
    expect([...m.keys()]).toEqual(["fresh"]);
    expect(m.get("fresh")!.match).toBe(80);
  });

  test("a cache taken against another profile is dropped entirely", () => {
    // `match` means "does Colin qualify" — against a different profile it is not a weaker
    // answer, it is the wrong question.
    expect(usableScores(file(scores, "someotherhash"), HASH, NOW).size).toBe(0);
  });

  test("a missing or empty cache is simply no cache", () => {
    expect(usableScores(null, HASH, NOW).size).toBe(0);
    expect(usableScores({ profileHash: HASH, scores: {} }, HASH, NOW).size).toBe(0);
  });
});

describe("merging a run back in", () => {
  test("new scores are added and old fresh ones survive", () => {
    const prev = file({ old: { match: 60, effort: "med", flags: [], at: ago(5) } });
    const next = mergedCache(prev, HASH, [{ name: "New Award", match: 91, effort: "low", flags: [] }], NOW);
    expect(next.scores.old.match).toBe(60);
    expect(next.scores.newaward).toEqual({ match: 91, effort: "low", flags: [], at: NOW.toISOString() });
  });

  test("a re-score overwrites the remembered value", () => {
    const prev = file({ newaward: { match: 10, effort: "high", flags: [], at: ago(5) } });
    const next = mergedCache(prev, HASH, [{ name: "New Award", match: 91, effort: "low", flags: [] }], NOW);
    expect(next.scores.newaward.match).toBe(91);
  });

  test("entries that failed to score are left out so the next run retries them", () => {
    const next = mergedCache(null, HASH, [
      { name: "Good", match: 70, effort: "low", flags: [] },
      { name: "Timed Out", match: 50, effort: "med", flags: ["score_failed"] },
    ], NOW);
    expect(Object.keys(next.scores)).toEqual(["good"]);
  });

  test("stale entries are dropped on write rather than carried forever", () => {
    const prev = file({ ancient: { match: 60, effort: "med", flags: [], at: ago(400) } });
    expect(Object.keys(mergedCache(prev, HASH, [], NOW).scores)).toEqual([]);
  });

  test("the written file records the profile it was scored against", () => {
    expect(mergedCache(null, HASH, [], NOW).profileHash).toBe(HASH);
  });
});
