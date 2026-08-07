// Generate the paste-ready profile block used by the manual Chrome-extension route.
//
// ScholarshipAutomation.md carried a hand-typed copy of the profile — the third identity store in
// this repo. Hand-typed copies drift: that one described TABOOST as an inbox project rather than
// the company, and its numbers aged independently of the real profile. This emits the same block
// from the vault so there is one source and the doc is regenerable.
//
// Contact details, DOB, and anything else marked restricted are deliberately EXCLUDED — the block
// gets pasted into a browser chat, so it carries only what an essay needs to be grounded.
//
// Usage:
//   bun identity/emit-prompt-profile.ts              # print to stdout
//   bun identity/emit-prompt-profile.ts --write      # splice into ScholarshipAutomation.md

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { loadVault, resolveApplicant } from "./vault";

const DOC = join(import.meta.dir, "..", "ScholarshipAutomation.md");
const BEGIN = "<!-- BEGIN GENERATED PROFILE -->";
const END = "<!-- END GENERATED PROFILE -->";

export function promptProfile(): string {
  const vault = loadVault();
  const a = resolveApplicant(vault);
  const pub = (p: string) => vault.fields[p]?.sensitivity === "public";

  const lines: string[] = [];
  lines.push(`- Name: ${a.identity.legalFirstName} ${a.identity.legalLastName}`);
  if (pub("contact.address.state")) lines.push(`- Residency: ${a.contact.address.state}${a.identity.citizenship ? ` · ${a.identity.citizenship}` : ""}`);
  lines.push(`- School: ${a.academic.currentSchool}${a.academic.enrollmentNote ? ` — ${a.academic.enrollmentNote}` : ""}`);
  lines.push(`- Major: ${a.academic.major}${a.academic.minor ? `, with optional ${a.academic.minor} coursework` : ""}`);
  lines.push(`- GPA: ${a.academic.gpa}/${a.academic.gpaScale}${a.academic.gpaContext ? ` (${a.academic.gpaContext})` : ""}${a.academic.priorGpa ? ` · ${a.academic.priorGpa} prior` : ""}${a.academic.sat ? ` · SAT ${a.academic.sat}` : ""}`);
  if (a.academic.expectedGraduation) lines.push(`- Expected graduation: ${a.academic.expectedGraduation}`);
  if (a.honors.length) lines.push(`- Honors: ${a.honors.join("; ")}`);
  if (a.work.length) lines.push(`- Work: ${a.work.map((w) => `${w.title} @ ${w.org}${w.detail ? ` (${w.detail})` : ""}`).join("; ")}`);
  if (a.activities.length) lines.push(`- Activities: ${a.activities.join("; ")}`);
  lines.push(`- Goal: ${a.careerGoal}`);
  // Financial detail is restricted in the vault, so only the headline figure the essays actually
  // use goes in — and only because it is the single most load-bearing fact in a need-based essay.
  if (a.financial.fafsaSAI) lines.push(`- Financial: FAFSA SAI ${a.financial.fafsaSAI}${a.financial.pellEligible ? " (maximum Pell eligibility)" : ""}`);
  if (a.doNotClaim.length) lines.push(`- NEVER claim: ${a.doNotClaim.join("; ")}`);
  lines.push(`- Contact details (email · phone · address · DOB): NOT in this block. Pull from the saved shortcut profile.`);

  return lines.join("\n");
}

if (import.meta.main) {
  const block = promptProfile();
  if (!process.argv.includes("--write")) {
    console.log(block);
  } else {
    const doc = readFileSync(DOC, "utf8");
    if (!doc.includes(BEGIN) || !doc.includes(END)) {
      console.error(`✗ ${DOC} has no ${BEGIN} / ${END} markers — add them around the profile block first.`);
      process.exit(1);
    }
    const next = doc.replace(
      new RegExp(`${BEGIN}[\\s\\S]*?${END}`),
      `${BEGIN}\n${block}\n${END}`,
    );
    writeFileSync(DOC, next, "utf8");
    console.log(`✓ regenerated the profile block in ${DOC}`);
  }
}
