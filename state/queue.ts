// Raising and resolving checkpoints.
//
// This module writes EVENTS. It does not hold state, and nothing here mutates a checkpoint object
// — the queue is a projection (see rebuild.ts). That is why `resolve` takes a checkpointId rather
// than an object: there is no object to hand it.
//
// Every guard in this file exists because the alternative is a queue that silently accepts
// nonsense: an unregistered type, a resolution the type never allowed, an agent resolving
// something only a person may resolve, or a resolution with no evidence and no name attached.

import { createHash } from "crypto";
import { append as logEvent } from "./log";
import { spec, isCheckpointType } from "./checkpoints.js";
import { fold } from "./rebuild";
import { readAll } from "./log";

export interface RaiseOpts {
  type: string;
  applicationId?: string;
  /** Free-form context for the human. Must not contain credentials — references only. */
  context?: Record<string, unknown>;
  /** Evidence references (paths, URLs, digests) satisfying the type's requiredEvidence. */
  evidenceRefs?: Record<string, string>;
  actor?: "agent" | "human" | "system";
}

export interface ResolveOpts {
  checkpointId: string;
  resolution: string;
  /** WHO resolved it. Required — irreversible actions must be attributable. */
  resolvedBy: string;
  role?: "agent" | "human";
  note?: string;
  /** Extra evidence gathered at resolution time. */
  evidenceRefs?: Record<string, string>;
}

/** Keys that must never appear in an event payload, at any depth. */
const SECRET_KEYS = /^(password|passwd|pass|pin|token|api[_-]?key|secret|authorization|cookie|session|ssn|card|cvv|routing|account[_-]?number)$/i;

/**
 * Strip anything that looks like a credential before it reaches the log. Events and projections
 * carry references, never secrets — a log you cannot safely read is a log nobody reads.
 */
export function scrubSecrets<T>(value: T, path: string[] = []): T {
  if (Array.isArray(value)) return value.map((v, i) => scrubSecrets(v, [...path, String(i)])) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEYS.test(k) ? "[redacted]" : scrubSecrets(v, [...path, k]);
    }
    return out as unknown as T;
  }
  return value;
}

/**
 * Deterministic checkpoint id. Same application + type + discriminator ⇒ same id, so a crashed run
 * that re-raises the same checkpoint updates one queue entry instead of piling up duplicates.
 */
export function checkpointId(type: string, applicationId: string | undefined, discriminator = ""): string {
  const h = createHash("sha256").update(`${type}|${applicationId ?? ""}|${discriminator}`).digest("hex").slice(0, 12);
  return `cp_${h}`;
}

/** Currently-open checkpoints, folded from the log. */
export function openCheckpoints() {
  return fold(readAll()).checkpoints;
}

/**
 * Raise a checkpoint. Idempotent: re-raising an already-open checkpoint is a no-op that returns
 * the existing id, so a retried run does not spam the queue.
 */
export function raise(opts: RaiseOpts): string {
  if (!isCheckpointType(opts.type)) {
    throw new Error(`Refusing to raise unregistered checkpoint type "${opts.type}". Free-form checkpoints are not allowed — add it to state/checkpoints.js.`);
  }
  const s = spec(opts.type);
  const discriminator = String(opts.context?.fieldLabel ?? opts.context?.discriminator ?? "");
  const id = checkpointId(opts.type, opts.applicationId, discriminator);

  if (openCheckpoints()[id]) return id; // already open — do not duplicate

  const evidenceRefs = scrubSecrets(opts.evidenceRefs ?? {});
  const missing = s.requiredEvidence.filter((k) => !(k in evidenceRefs));

  logEvent(
    "checkpoint_raised",
    {
      id,
      type: opts.type,
      question: s.question,
      blocking: s.blocking,
      allowedResolutions: s.allowedResolutions,
      resolverRoles: s.resolverRoles,
      context: scrubSecrets(opts.context ?? {}),
      evidenceRefs,
      // Recorded rather than thrown: a checkpoint that cannot be raised because evidence is
      // missing would silently drop the very uncertainty it exists to surface.
      missingEvidence: missing,
    },
    { applicationId: opts.applicationId, actor: opts.actor ?? "agent" },
  );
  return id;
}

/**
 * Resolve a checkpoint. Emits checkpoint_resolved plus whatever the type declares in
 * emitsOnResolve. Throws rather than resolving on any contract violation.
 */
export function resolve(opts: ResolveOpts): void {
  const open = openCheckpoints();
  const cp = open[opts.checkpointId];
  if (!cp) throw new Error(`No open checkpoint "${opts.checkpointId}".`);

  const s = spec(cp.type);
  const role = opts.role ?? "human";

  if (!s.allowedResolutions.includes(opts.resolution)) {
    throw new Error(`"${opts.resolution}" is not an allowed resolution for ${cp.type}. Allowed: ${s.allowedResolutions.join(", ")}.`);
  }
  if (!s.resolverRoles.includes(role)) {
    throw new Error(`Role "${role}" may not resolve ${cp.type}. Allowed: ${s.resolverRoles.join(", ")}.`);
  }
  if (!opts.resolvedBy || !opts.resolvedBy.trim()) {
    throw new Error("resolvedBy is required — every resolution must be attributable.");
  }

  const evidenceRefs = scrubSecrets({ ...(cp.evidenceRefs ?? {}), ...(opts.evidenceRefs ?? {}) });
  const stillMissing = s.requiredEvidence.filter((k) => !(k in evidenceRefs));
  if (stillMissing.length) {
    throw new Error(`${cp.type} requires evidence before resolution: ${stillMissing.join(", ")}.`);
  }

  logEvent(
    "checkpoint_resolved",
    {
      id: opts.checkpointId,
      type: cp.type,
      resolution: opts.resolution,
      resolvedBy: opts.resolvedBy,
      role,
      note: opts.note ?? null,
      evidenceRefs,
    },
    { applicationId: cp.applicationId ?? undefined, actor: role },
  );

  if (s.emitsOnResolve) {
    logEvent(
      s.emitsOnResolve,
      followUpPayload(cp.type, opts.resolution, evidenceRefs, opts.resolvedBy),
      { applicationId: cp.applicationId ?? undefined, actor: role },
    );
  }
}

/** What the declared follow-up event carries, per checkpoint type. */
function followUpPayload(type: string, resolution: string, evidenceRefs: Record<string, string>, resolvedBy: string): Record<string, unknown> {
  switch (type) {
    case "ELIGIBILITY_AMBIGUOUS":
      return {
        // decline_to_state is preserved as a value. It is NOT collapsed to "not eligible" — the
        // distinction is the whole point of offering it.
        decision: resolution === "eligible" ? "pass" : resolution === "not_eligible" ? "disqualified" : "declined_to_state",
        reasons: [`resolved by ${resolvedBy} at a human checkpoint`],
        evidenceRefs,
      };
    case "ACCOUNT_REQUIRED":
      return { to: resolution === "authenticated" ? "AUTHENTICATED" : "DISCOVERED", by: resolvedBy };
    case "AWARD_NOTICE_REVIEW":
      return {
        kind: "award-notice",
        // Only an explicit verified_win produces a verified artifact, which is the only thing that
        // can open the WON transition in the state machine.
        verified: resolution === "verified_win",
        suspectedScam: resolution === "scam_suspected",
        createdAt: new Date().toISOString(),
        evidenceRefs,
        verifiedBy: resolvedBy,
      };
    case "LEGAL_ATTESTATION_REQUIRED":
    case "SIGNATURE_REQUIRED":
      return { affirmed: resolution === "affirmed" || resolution === "signed", by: resolvedBy, evidenceRefs };
    case "RECOMMENDATION_REQUIRED":
      return { status: resolution, by: resolvedBy, evidenceRefs };
    case "DOCUMENT_UPLOAD_REQUIRED":
      return { kind: evidenceRefs.document_kind ?? "document", verified: false, createdAt: new Date().toISOString(), by: resolvedBy };
    default:
      return { resolution, by: resolvedBy, evidenceRefs };
  }
}
