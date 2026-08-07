// The file scout/eligibility.ts was written to feed, and which never existed — which is why 236
// lines of working deterministic screening sat dead in this repo.
//
// It does exactly one thing: run the rules screen and route the verdict.
//   pass         → eligibility_screened, application advances
//   disqualified → eligibility_screened, terminal, never applied to
//   ambiguous    → ELIGIBILITY_AMBIGUOUS checkpoint. A human reads the official rules.
//
// No LLM. The plan was always to send ambiguous cases to a cheap model, and that remains possible,
// but a model is a worse first answer than a person for the specific question "am I allowed to
// claim this", where being confidently wrong is an integrity problem rather than a cost problem.
//
// Usage:
//   bun scout/adjudicate.ts                       # screen every application in the projection
//   bun scout/adjudicate.ts --slug <slug>
//   bun scout/adjudicate.ts --dry                 # print verdicts, write nothing

import { append as logEvent, readAll } from "../state/log";
import { fold } from "../state/rebuild";
import { raise } from "../state/queue";
import { buildEligibilityProfile, screenEligibility, type EligibilityProfile } from "./eligibility";
import { loadVault, resolveApplicant } from "../identity/vault";

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const ONLY = (() => { const i = args.indexOf("--slug"); return i >= 0 ? args[i + 1] : null; })();

export interface AdjudicationSummary {
  passed: number;
  disqualified: number;
  ambiguous: number;
  skipped: number;
}

/** Text the screen reads. Requirements are not a field we scrape yet, so fall back to what we have. */
function requirementsTextOf(app: any): string {
  return [app.name, app.org, app.eligibility?.requirementsText, app.description]
    .filter(Boolean)
    .join(". ");
}

export function adjudicateAll(profile: EligibilityProfile, opts: { dry?: boolean; only?: string | null } = {}): AdjudicationSummary {
  const projection = fold(readAll());
  const summary: AdjudicationSummary = { passed: 0, disqualified: 0, ambiguous: 0, skipped: 0 };

  for (const app of Object.values<any>(projection.applications)) {
    if (opts.only && app.slug !== opts.only) continue;
    // Already screened by rules or by a human — never re-open a settled question.
    if (app.eligibility?.decision && app.eligibility.decision !== "unscreened") { summary.skipped++; continue; }

    const verdict = screenEligibility(requirementsTextOf(app), profile);

    if (opts.dry) {
      console.log(`  ${verdict.decision.padEnd(12)} ${app.slug ?? app.id} — ${verdict.reasons[0] ?? ""}`);
      summary[verdict.decision === "pass" ? "passed" : verdict.decision === "disqualified" ? "disqualified" : "ambiguous"]++;
      continue;
    }

    if (verdict.decision === "ambiguous") {
      // Unknown beats guessed: this becomes a question, not a default.
      raise({
        type: "ELIGIBILITY_AMBIGUOUS",
        applicationId: app.id,
        context: { name: app.name, reasons: verdict.reasons },
        evidenceRefs: { rules_url: app.url || app.applyUrl || "(no url on record)" },
      });
      summary.ambiguous++;
      continue;
    }

    logEvent(
      "eligibility_screened",
      { decision: verdict.decision, reasons: verdict.reasons, hardDqRule: verdict.hardDqRule ?? null, screenedBy: "rules" },
      { applicationId: app.id },
    );
    if (verdict.decision === "disqualified") {
      logEvent("state_changed", { to: "DISQUALIFIED", by: "rules" }, { applicationId: app.id });
      summary.disqualified++;
    } else {
      logEvent("state_changed", { to: "ELIGIBILITY_CHECKED", by: "rules" }, { applicationId: app.id });
      summary.passed++;
    }
  }

  return summary;
}

if (import.meta.main) {
  const profile = buildEligibilityProfile(resolveApplicant(loadVault()) as any);
  const s = adjudicateAll(profile, { dry: DRY, only: ONLY });
  console.log(
    `\n${DRY ? "(dry) " : ""}pass ${s.passed} · disqualified ${s.disqualified} · ambiguous ${s.ambiguous} (→ checkpoints) · already screened ${s.skipped}`,
  );
  if (!DRY) console.log("Run `bun state/rebuild.ts` to refresh the projection and queue.");
}
