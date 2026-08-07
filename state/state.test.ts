// bun test state/state.test.ts
import { expect, test, describe } from "bun:test";
import { scholarshipId, normalizeName, sameScholarship, slugOf } from "../src/lib/ids.js";
import { canAdvance, advance, toCanonical, TERMINAL } from "../src/lib/machine.js";
import { parseDeadline, toApplication } from "./schema.js";
import { fold } from "./rebuild";
import { isCheckpointType } from "./checkpoints.js";

describe("stable identity", () => {
  test("a renamed listing keeps its id (trailing year stripped)", () => {
    const a = scholarshipId("Bailey Family Foundation Scholarship", "https://baileyfamilyfoundation.org/apply");
    const b = scholarshipId("Bailey Family Foundation Scholarship 2026", "https://www.baileyfamilyfoundation.org/apply");
    expect(a).toBe(b);
  });

  test("cosmetic punctuation changes do not mint a new id", () => {
    const a = scholarshipId("U.S. Bank Student Scholarship", "https://usbank.com/x");
    const b = scholarshipId("US Bank Student Scholarship", "https://usbank.com/x");
    expect(a).toBe(b);
  });

  test("same name, different sponsor → different ids", () => {
    const a = scholarshipId("Founders Scholarship", "https://blackrock.com/a");
    const b = scholarshipId("Founders Scholarship", "https://someoneelse.org/a");
    expect(a).not.toBe(b);
  });

  test("two awards sharing a 48-char prefix stay distinct (old slug collapsed them)", () => {
    const long1 = "National Institute of Health Undergraduate Scholarship Program Track A";
    const long2 = "National Institute of Health Undergraduate Scholarship Program Track B";
    expect(slugOf(long1)).toBe(slugOf(long2)); // the old bug, preserved for the pretty slug
    expect(scholarshipId(long1, "https://nih.gov")).not.toBe(scholarshipId(long2, "https://nih.gov"));
  });

  test("normalizeName drops stopwords and boilerplate", () => {
    expect(normalizeName("The Foo Memorial Scholarship Fund")).toBe("foo");
  });

  test("sameScholarship compares identity, not prefixes", () => {
    expect(sameScholarship({ name: "Foo Award", url: "https://x.org" }, { name: "The Foo Award 2027", url: "https://x.org" })).toBe(true);
  });

  test("ids are deterministic across calls", () => {
    expect(scholarshipId("Foo", "https://x.org")).toBe(scholarshipId("Foo", "https://x.org"));
  });
});

describe("state machine guards", () => {
  const base = { workflowState: "DISCOVERED", evidenceStatus: "verified", artifacts: [] };

  test("eligibility requires verified evidence", () => {
    const r = canAdvance({ ...base, evidenceStatus: "plausible" }, "ELIGIBILITY_CHECKED");
    expect(r.ok).toBe(false);
  });

  test("submission requires passing through review", () => {
    expect(canAdvance({ ...base, workflowState: "FORM_MAPPED" }, "SUBMITTED").ok).toBe(false);
    expect(canAdvance({ ...base, workflowState: "REVIEW_REQUIRED" }, "SUBMITTED").ok).toBe(true);
  });

  test("disqualified cannot be submitted", () => {
    expect(canAdvance({ ...base, workflowState: "REVIEW_REQUIRED", evidenceStatus: "disqualified" }, "SUBMITTED").ok).toBe(false);
  });

  test("WON requires a verified award-notice artifact — the scam gate", () => {
    const awaiting = { ...base, workflowState: "AWAITING_RESULT" };
    expect(canAdvance(awaiting, "WON").ok).toBe(false);
    expect(canAdvance({ ...awaiting, artifacts: [{ kind: "award-notice", verified: false }] }, "WON").ok).toBe(false);
    expect(canAdvance({ ...awaiting, artifacts: [{ kind: "award-notice", verified: true }] }, "WON").ok).toBe(true);
  });

  test("LOST is deliberately ungated", () => {
    expect(canAdvance({ ...base, workflowState: "AWAITING_RESULT" }, "LOST").ok).toBe(true);
  });

  test("terminal states do not advance", () => {
    for (const t of TERMINAL) expect(canAdvance({ ...base, workflowState: t }, "SUBMITTED").ok).toBe(false);
  });

  test("advance returns the record unchanged on a blocked transition", () => {
    const s = { ...base, workflowState: "FORM_MAPPED" };
    const { record, error } = advance(s, "SUBMITTED");
    expect(error).toBeTruthy();
    expect(record.workflowState).toBe("FORM_MAPPED");
  });

  test("legacy vocabulary coerces onto canonical", () => {
    expect(toCanonical("needs-review")).toBe("REVIEW_REQUIRED");
    expect(toCanonical("prioritized")).toBe("ELIGIBILITY_CHECKED");
    expect(toCanonical("won/rejected")).toBe("AWAITING_RESULT"); // never auto-resolves to WON
    expect(toCanonical("nonsense")).toBe("DISCOVERED");
  });
});

describe("deadline parsing", () => {
  test("parses the formats actually present in targets.json", () => {
    expect(parseDeadline("2026-06-30")).toBe("2026-06-30");
    expect(parseDeadline("Jun 30, 2026")).toBe("2026-06-30");
    expect(parseDeadline("June 30 2026")).toBe("2026-06-30");
    expect(parseDeadline("3/15/2026")).toBe("2026-03-15");
  });

  test("a bare month resolves to month-end only with a reference year", () => {
    expect(parseDeadline("October")).toBeNull();
    expect(parseDeadline("October", 2026)).toBe("2026-10-31");
    expect(parseDeadline("February", 2028)).toBe("2028-02-29"); // leap year
  });

  test("unparseable stays null rather than being guessed", () => {
    expect(parseDeadline("verify at URL")).toBeNull();
    expect(parseDeadline("")).toBeNull();
  });
});

describe("normalized application", () => {
  test("placeholder essay prompts are stripped, real ones kept", () => {
    const app = toApplication({
      name: "Foo", url: "https://x.org",
      formMeta: { essayPrompts: [{ prompt: "(detected essay field — verify the real prompt on the page)", wordLimit: null }, { prompt: "Why this major?", wordLimit: 500 }] },
    });
    expect(app.requirements.essayPrompts).toHaveLength(1);
    expect(app.requirements.essayPrompts[0].prompt).toBe("Why this major?");
  });

  test("legacy `match` integer becomes eligibility.fit, not a permission", () => {
    const app = toApplication({ name: "Foo", url: "https://x.org", match: 85 });
    expect(app.eligibility.fit).toBeCloseTo(0.85);
    expect(app.eligibility.decision).toBe("unscreened");
  });

  test("unknown keys are dropped rather than spread through", () => {
    const app = toApplication({ name: "Foo", url: "https://x.org", junk: "nope" });
    expect(app.junk).toBeUndefined();
  });
});

describe("projection fold", () => {
  const ev = (seq, type, data, applicationId) => ({ seq, at: `2026-08-07T00:00:0${seq}Z`, type, applicationId, actor: "agent", data, prevHash: null });

  test("folds discovery + state change + checkpoint lifecycle", () => {
    const id = scholarshipId("Foo", "https://x.org");
    const p = fold([
      ev(1, "discovered", { name: "Foo", url: "https://x.org" }, id),
      ev(2, "state_changed", { to: "REVIEW_REQUIRED" }, id),
      ev(3, "checkpoint_raised", { id: "i1", type: "CAPTCHA_REQUIRED", blocking: true, context: {} }, id),
      ev(4, "checkpoint_resolved", { id: "i1", type: "CAPTCHA_REQUIRED", resolution: "solved", resolvedBy: "colin" }, id),
      ev(5, "checkpoint_raised", { id: "i2", type: "APPLICATION_FEE", blocking: true, context: {} }, id),
    ]);
    expect(p.applications[id].workflowState).toBe("REVIEW_REQUIRED");
    expect(Object.keys(p.checkpoints)).toEqual(["i2"]);
    // Resolved checkpoints leave the open queue but are never discarded.
    expect(p.resolved).toHaveLength(1);
    expect(p.resolved[0].resolvedBy).toBe("colin");
    expect(p.lastSeq).toBe(5);
  });

  test("fold is pure — same events twice, identical projection", () => {
    const id = scholarshipId("Bar", "https://y.org");
    const events = [ev(1, "discovered", { name: "Bar", url: "https://y.org" }, id), ev(2, "state_changed", { to: "FORM_MAPPED" }, id)];
    expect(JSON.stringify(fold(events))).toBe(JSON.stringify(fold(events)));
  });

  test("form_mapped carries real essay prompts into requirements", () => {
    const id = scholarshipId("Baz", "https://z.org");
    const p = fold([
      ev(1, "discovered", { name: "Baz", url: "https://z.org" }, id),
      ev(2, "form_mapped", { essayPrompts: [{ prompt: "Describe a challenge.", wordLimit: 300 }] }, id),
    ]);
    expect(p.applications[id].requirements.essayPrompts[0].wordLimit).toBe(300);
  });
});

describe("checkpoint taxonomy", () => {
  // The seven human gates promoted out of the deleted apply/pipeline.ts must still exist, under
  // the reason-code naming the queue standardised on. Full contract coverage lives in
  // state/adversarial.test.ts.
  test("the seven gates promoted from apply/pipeline.ts survive the rename", () => {
    for (const t of [
      "ACCOUNT_REQUIRED",        // was: login
      "LEGAL_ATTESTATION_REQUIRED", // was: attestation
      "SIGNATURE_REQUIRED",      // was: signature
      "RECOMMENDATION_REQUIRED", // was: recommendation
      "DOCUMENT_UPLOAD_REQUIRED",// was: sensitive document
      "APPLICATION_FEE",         // was: fee
      "PORTAL_MALFUNCTION",
    ]) {
      expect(isCheckpointType(t), t).toBe(true);
    }
  });
});
