// Shared types for the auto-apply pipeline.
//   scout/probe-form.ts  → writes FormMeta (what each application form needs + how to reach it)
//   apply/fill.ts        → reads FormMeta + Applicant + the matched essay, drives Playwright
// Keep this the single source of truth for both halves.

export interface ApplicantAddress {
  street: string;
  city: string;
  state: string;
  zip: string;
  country: string;
}

// Mirrors applicant.local.json (gitignored, server-side only — holds PII).
export interface Applicant {
  identity: {
    legalFirstName: string;
    legalLastName: string;
    preferredName: string;
    dateOfBirth: string; // YYYY-MM-DD
    gender: string; // "" = decline to state
    ethnicity: string; // "" = decline to state
    citizenship: string;
  };
  contact: { email: string; phone: string; address: ApplicantAddress };
  academic: {
    currentSchool: string;
    enrollmentNote: string;
    major: string;
    minor: string;
    classLevel: string;
    gpa: string;
    gpaScale: string;
    gpaContext: string;
    priorGpa: string;
    sat: string;
    act: string;
    expectedGraduation: string;
    highSchool: string;
  };
  financial: { fafsaSAI: string; pellEligible: boolean; financialNeed: string; residency: string };
  honors: string[];
  activities: string[];
  work: { title: string; org: string; detail: string }[];
  intendedField: string;
  careerGoal: string;
  documents: { resumePdf: string; transcriptPdf: string };
  doNotClaim: string[];
}

export type Platform =
  | "direct" // a foundation's own application form
  | "googleform"
  | "bold"
  | "unigo"
  | "fastweb"
  | "raiseme"
  | "petersons"
  | "niche"
  | "scholarships360"
  | "careeronestop-info" // the DOL info page itself (not a form)
  | "unknown";

export interface EssayPrompt {
  prompt: string;
  wordLimit: number | null;
}

export interface FormMeta {
  slug: string;
  infoUrl: string; // the scout's original listing/info URL
  applyUrl: string | null; // resolved real application URL (null if we couldn't find it)
  platform: Platform;
  hasWebForm: boolean; // a fillable <form> (inputs/textarea) was detected at applyUrl
  loginRequired: boolean;
  applicationFee: boolean; // a fee was detected — hard stop, never auto-fill
  essayRequired: boolean;
  essayPrompts: EssayPrompt[];
  detectedFields: string[]; // input names/labels we saw (for the field-mapper)
  autoSubmitEligible: boolean;
  route: "playwright" | "chrome"; // recommended engine for fill.ts
  probedAt: string; // ISO
  notes: string[]; // honest classification notes
}

// Aggregators that prohibit automated submission in their ToS and/or hard-detect bots.
// Forms on these route to the human/Chrome path — never Playwright auto-submit.
export const TOS_FORBIDS_AUTOMATION: Platform[] = ["bold", "fastweb", "raiseme", "niche"];

// The hybrid submit gate (decision: auto-submit only no-essay/sweepstakes; human-gate the rest).
export function computeAutoSubmitEligible(m: Omit<FormMeta, "autoSubmitEligible" | "route">): boolean {
  return (
    m.hasWebForm &&
    !m.essayRequired &&
    !m.applicationFee &&
    !m.loginRequired &&
    !TOS_FORBIDS_AUTOMATION.includes(m.platform)
  );
}

export function routeFor(m: Omit<FormMeta, "route">): "playwright" | "chrome" {
  // Playwright can only safely drive a real web form that isn't login-walled or fee-gated.
  if (m.hasWebForm && !m.loginRequired && !m.applicationFee && m.platform !== "careeronestop-info") {
    return "playwright";
  }
  return "chrome";
}
