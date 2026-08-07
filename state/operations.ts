// Idempotency for irreversible actions.
//
// THE FAILURE THIS PREVENTS: a browser crash, a killed process, or a rerun after a timeout, causing
// a second submission, a second recommendation request, or a second account. The existing
// protection was a slug keyed ledger (apply/results/submitted.json) that only covered submission
// and only at whole-application granularity — it could not tell "submitted" from "clicked submit,
// then the page died before we saw a confirmation".
//
// The model: every irreversible action gets a stable operationId derived from its salient inputs.
// Starting it logs operation_started; finishing logs operation_completed. A run that finds an
// operation already started but not completed does NOT retry blindly — it raises a checkpoint,
// because "we may or may not have already submitted" is exactly the uncertainty a human should
// resolve rather than a machine guess.

import { createHash } from "crypto";
import { append as logEvent, readAll } from "./log";

export type OperationKind =
  | "submit_application"
  | "create_account"
  | "request_recommendation"
  | "upload_document"
  | "accept_award";

export interface OperationState {
  id: string;
  kind: OperationKind;
  applicationId?: string;
  status: "started" | "completed" | "failed";
  startedAt: string;
  completedAt?: string;
  result?: unknown;
}

/**
 * Stable id for an action. `salient` must contain everything that makes this action distinct and
 * nothing that varies between retries — no timestamps, no random ids, or idempotency is defeated.
 */
export function operationId(kind: OperationKind, applicationId: string, salient: Record<string, unknown> = {}): string {
  const canonical = JSON.stringify(Object.keys(salient).sort().map((k) => [k, salient[k]]));
  const h = createHash("sha256").update(`${kind}|${applicationId}|${canonical}`).digest("hex").slice(0, 16);
  return `op_${h}`;
}

/** Fold the log into current operation states. */
export function operationStates(): Record<string, OperationState> {
  const out: Record<string, OperationState> = {};
  for (const e of readAll()) {
    const d = e.data as any;
    if (e.type === "operation_started") {
      out[d.id] = { id: d.id, kind: d.kind, applicationId: e.applicationId, status: "started", startedAt: e.at };
    } else if (e.type === "operation_completed" && out[d.id]) {
      out[d.id] = { ...out[d.id], status: d.ok === false ? "failed" : "completed", completedAt: e.at, result: d.result };
    }
  }
  return out;
}

export type Disposition =
  | { proceed: true; id: string }
  | { proceed: false; id: string; reason: "already_completed" | "in_doubt"; state: OperationState };

/**
 * Decide whether an action may run.
 *
 *   never seen      → proceed
 *   completed       → skip; it already happened
 *   started, no end → DO NOT retry. The outcome is genuinely unknown, and the safe move for an
 *                     irreversible action under uncertainty is to ask, not to try again.
 */
export function begin(kind: OperationKind, applicationId: string, salient: Record<string, unknown> = {}): Disposition {
  const id = operationId(kind, applicationId, salient);
  const existing = operationStates()[id];

  if (!existing) {
    logEvent("operation_started", { id, kind }, { applicationId });
    return { proceed: true, id };
  }
  if (existing.status === "completed") return { proceed: false, id, reason: "already_completed", state: existing };
  if (existing.status === "failed") {
    logEvent("operation_started", { id, kind, retryOf: id }, { applicationId });
    return { proceed: true, id };
  }
  return { proceed: false, id, reason: "in_doubt", state: existing };
}

export function complete(id: string, applicationId: string, result: unknown = null): void {
  logEvent("operation_completed", { id, ok: true, result }, { applicationId });
}

export function fail(id: string, applicationId: string, error: string): void {
  logEvent("operation_completed", { id, ok: false, result: { error } }, { applicationId });
}
