// bun test scout/bigfuture-detail.test.ts
import { expect, test, describe } from "bun:test";
import { parseDetail, detailText, slugOf } from "./bigfuture-detail";
import { buildEligibilityProfile, screenEligibility } from "./eligibility";

// The shape BigFuture actually serves, reduced to the parts the parser reads: React SSR splits
// "$" from the digits with a comment node, and each requirement is an <li> with an indexed
// data-testid. Taken from the live 2+2 Transfer Scholarship page.
const PAGE = `
<section><div data-testid="eligibility-criteria-title">Requirements</div>
<div id="eligibility-criteria">
<li data-testid="eligibility-criteria-description-0-list-item-id">Resident of Maryland</li>
<li data-testid="eligibility-criteria-description-1-list-item-id">Community college student</li>
<li data-testid="eligibility-criteria-description-2-list-item-id">Seeking a bachelor&#x27;s degree fulltime</li>
<li data-testid="eligibility-criteria-description-3-list-item-id">Planning to transfer to a 4year institution in Maryland from a 2-year college in Maryland</li>
</div></section>`;

const ABOUT = `<p>The 2+2 Transfer Scholarship is available to Maryland residents who are planning to transfer to a 4-year institution within the state.</p>
<span>Win up to</span><div>$<!-- -->2,000</div>` + PAGE;

describe("parseDetail", () => {
  test("reads the requirements list", () => {
    expect(parseDetail(PAGE).requirements).toEqual([
      "Resident of Maryland",
      "Community college student",
      "Seeking a bachelor's degree fulltime",
      "Planning to transfer to a 4year institution in Maryland from a 2-year college in Maryland",
    ]);
  });

  test("reads the amount through the SSR comment node", () => {
    // The card list recorded $20,002 for this $2,000 award by reading around that comment.
    expect(parseDetail(ABOUT).amountText).toBe("$2,000");
  });

  test("reads the description", () => {
    expect(parseDetail(ABOUT).about).toContain("Maryland residents");
  });

  test("an unrecognisable page yields nothing rather than a wrong answer", () => {
    const empty = parseDetail("<html><body>maintenance</body></html>");
    expect(empty.requirements).toEqual([]);
    expect(empty.about).toBeNull();
    expect(empty.amountText).toBeNull();
  });
});

describe("slugOf", () => {
  test("pulls the slug from a BigFuture url", () => {
    expect(slugOf("https://bigfuture.collegeboard.org/scholarships/22-transfer-scholarship")).toBe("22-transfer-scholarship");
  });
  test("returns null for any other source", () => {
    expect(slugOf("https://scholarships360.org/scholarships/search/foo/")).toBeNull();
  });
});

describe("what the detail text buys", () => {
  test("the Maryland award a Michigan student was shown at 80% is now disqualified for free", () => {
    const profile = buildEligibilityProfile({
      identity: { citizenship: "US citizen", gender: "" },
      contact: { address: { state: "MI" } },
      academic: { currentSchool: "Mott Community College", enrollmentInstitution: "University of Michigan-Flint", highSchool: "", classLevel: "Sophomore" },
      financial: { residency: "MI" },
      doNotClaim: ["first-generation college student"],
    } as any);
    const v = screenEligibility(detailText(parseDetail(ABOUT)), profile);
    expect(v.decision).toBe("disqualified");
    expect(v.hardDqRule).toBe("wrong-state");
  });
});
