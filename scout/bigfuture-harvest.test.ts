// The one rule here that can cost real data: an interrupted harvest must never shrink the cache.
// A run killed by the chain's 30-minute timeout wrote its 1,811 partial cards straight over a
// 6,852-scholarship harvest — and reported success while doing it.
import { expect, test, describe } from "bun:test";
import { mergeHarvest, cacheVerdict } from "./bigfuture-harvest";

const rec = (slug: string, amount = 1000) => ({
  name: slug, slug, url: `https://x.test/${slug}`, amount,
  amountVaries: false, opens: null, closes: null, merit: false, need: false, essay: false, status: "",
});

describe("merging a partial harvest", () => {
  test("listings the short run never reached are kept", () => {
    const merged = mergeHarvest([rec("a"), rec("b"), rec("c")], [rec("a")]);
    expect(merged.map((r) => r.slug).sort()).toEqual(["a", "b", "c"]);
  });

  test("this run's record wins for anything it did reach", () => {
    const merged = mergeHarvest([rec("a", 1000)], [rec("a", 5000)]);
    expect(merged).toHaveLength(1);
    expect(merged[0].amount).toBe(5000);
  });

  test("a new find is added", () => {
    expect(mergeHarvest([rec("a")], [rec("b")]).map((r) => r.slug).sort()).toEqual(["a", "b"]);
  });

  test("records without a slug are dropped rather than colliding on undefined", () => {
    const merged = mergeHarvest([{ ...rec("a"), slug: "" }], [rec("b")]);
    expect(merged.map((r) => r.slug)).toEqual(["b"]);
  });

  test("a missing cache is simply no cache", () => {
    expect(mergeHarvest([], [rec("a")]).map((r) => r.slug)).toEqual(["a"]);
  });
});

describe("deciding whether a pass may replace the cache", () => {
  const v = (o: Partial<Parameters<typeof cacheVerdict>[0]>) =>
    cacheVerdict({ interrupted: false, shortfall: false, existing: 6919, fresh: 6919, ...o }).reason;

  test("a full, uninterrupted pass replaces it, so retired listings leave", () => {
    expect(v({})).toBeNull();
    expect(v({ fresh: 7100 })).toBeNull();
    expect(v({ fresh: 6000 })).toBeNull(); // normal churn, well above the floor
  });

  test("an interrupted pass never replaces it", () => {
    expect(v({ interrupted: true })).toBe("interrupted");
  });

  test("a keyword that came back short never replaces it", () => {
    expect(v({ shortfall: true })).toBe("a keyword came back short");
  });

  test("a pass far smaller than the cache is treated as partial", () => {
    // The real one: a pager that gave up after the first page wrote 2,231 over 6,919.
    expect(v({ fresh: 2231 })).toBe("far smaller than the cache");
  });

  test("a first run with nothing cached is not held to the floor", () => {
    expect(cacheVerdict({ interrupted: false, shortfall: false, existing: 0, fresh: 40 }).reason).toBeNull();
  });
});
