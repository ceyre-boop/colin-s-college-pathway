// Universal application pipeline primitives.
// This is deliberately an orchestration model, not a bot that blindly clicks
// every site. Each channel has different capabilities and human gates.

export type ApplicationChannel =
  | "bigfuture-browser"
  | "direct-browser"
  | "aggregator-browser"
  | "pdf"
  | "email"
  | "mail"
  | "nomination"
  | "portal"
  | "unknown";

export type PipelineState =
  | "discovered"
  | "verified"
  | "eligible"
  | "prioritized"
  | "prepared"
  | "needs-review"
  | "submitted"
  | "confirmed"
  | "won/rejected";

export type ArtifactKind =
  | "source-record"
  | "requirements"
  | "field-ledger"
  | "essay"
  | "resume"
  | "transcript"
  | "recommendation"
  | "pdf-packet"
  | "email-draft"
  | "submission-proof"
  | "award-notice";

export interface ApplicationArtifact {
  id: string;
  kind: ArtifactKind;
  path?: string;
  contentHash?: string;
  verified: boolean;
  createdAt: string;
  notes?: string[];
}

export interface ApplicationTarget {
  scholarshipId: string;
  channel: ApplicationChannel;
  sourceUrl: string;
  applicationUrl?: string;
  loginRequired: boolean;
  automationAllowed: boolean | "unknown";
  hasAttestation: boolean;
  requiresSignature: boolean;
  requiresRecommendation: boolean;
  requiresSensitiveDocument: boolean;
  requiresFee: boolean;
  artifacts: ApplicationArtifact[];
}

export interface RouteDecision {
  channel: ApplicationChannel;
  capabilities: Array<"discover" | "verify" | "extract" | "prepare" | "fill" | "review" | "submit" | "confirm">;
  humanGates: string[];
  reason: string;
}

const BROWSER_CAPABILITIES = ["discover", "verify", "extract", "prepare", "fill", "review", "confirm"] as const;

/** Choose the strongest safe route available; never infer permission to automate. */
export function chooseRoute(t: ApplicationTarget): RouteDecision {
  const humanGates: string[] = [];
  if (t.loginRequired) humanGates.push("user must log in or authorize the portal");
  if (t.automationAllowed !== true) humanGates.push("automation permission is not verified");
  if (t.hasAttestation) humanGates.push("applicant must review attestations");
  if (t.requiresSignature) humanGates.push("applicant must sign");
  if (t.requiresRecommendation) humanGates.push("recommendation workflow requires human coordination");
  if (t.requiresSensitiveDocument) humanGates.push("sensitive document upload requires human review");
  if (t.requiresFee) humanGates.push("application fee is a hard stop");

  if (t.requiresFee) {
    return { channel: t.channel, capabilities: ["discover", "verify", "extract", "review"], humanGates, reason: "Fee detected: prepare no submission." };
  }
  if (t.channel === "pdf") {
    return { channel: t.channel, capabilities: ["discover", "verify", "extract", "prepare", "review"], humanGates, reason: "Prepare a completed PDF packet; human sends it." };
  }
  if (t.channel === "email" || t.channel === "mail" || t.channel === "nomination") {
    return { channel: t.channel, capabilities: ["discover", "verify", "extract", "prepare", "review"], humanGates, reason: "Prepare communications or packet; human sends or coordinates." };
  }
  if (t.automationAllowed === true && !t.loginRequired && !t.hasAttestation && !t.requiresSignature && !t.requiresRecommendation && !t.requiresSensitiveDocument) {
    return { channel: t.channel, capabilities: [...BROWSER_CAPABILITIES, "submit"], humanGates, reason: "Browser form is technically automatable, subject to platform rules and confirmation." };
  }
  return { channel: t.channel, capabilities: [...BROWSER_CAPABILITIES], humanGates, reason: "Browser-assisted preparation; human review and submission required." };
}

