// Guards the two rules that make the bank trustworthy: a no-essay award is never a topic,
// and a listing whose blurb reveals no prompt is never silently filed under an archetype.
import { expect, test, describe } from "bun:test";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { matchEssay, loadEssayLibrary } from "./essay-match";

const BANK = join(import.meta.dir, "..", "scholarship_essays", "TOPIC_BANK.md");

describe("topic bank", () => {
  test("generated bank exists and names every archetype", () => {
    expect(existsSync(BANK)).toBe(true);
    const md = readFileSync(BANK, "utf8");
    for (const t of ["Personal statement", "Why you deserve", "Career and academic goals",
                     "Adversity", "Leadership", "Community service", "Entrepreneurship"]) {
      expect(md).toContain(t);
    }
  });

  test("hand-added topics marker is present so regeneration can preserve them", () => {
    expect(readFileSync(BANK, "utf8")).toContain("COLIN'S OWN TOPICS");
  });

  test("a blurb with no prompt signal yields no angle — it must land in unsorted, not an archetype", () => {
    const m = matchEssay("Barrat Scholarship — BigFuture curated (CollegeBoard).", null, loadEssayLibrary());
    expect(m.bucket).toBe("needs_new_essay");
    expect(m.angle).toBeNull();
  });

  test("an adversity prompt still routes to the drafted adversity essay", () => {
    const m = matchEssay(
      "Describe an obstacle you had to overcome and the perseverance it required.",
      500, loadEssayLibrary(),
    );
    expect(m.angle).toBe("achievement_blackbelt");
    expect(m.bucket).not.toBe("needs_new_essay");
  });
});
