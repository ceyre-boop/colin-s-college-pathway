// Append-only, hash-chained event log — the source of truth for application state.
//
// WHY NOT SQLITE: every existing reader in this repo is Bun.file().json(); the dashboard is a
// static Vite build that physically cannot open bun:sqlite; the working set is ~30 applications.
// A database would mean rewriting every reader and forcing a server round-trip for a UI that
// needs none, in exchange for concurrency guarantees a single-user tool never uses.
//
// WHY NOT GIT FOR IMMUTABILITY: this log records values typed into forms — it is PII, so it is
// gitignored. Tamper-evidence therefore has to come from the log itself: each event carries
// prevHash = sha256 of the previous line. Rewriting history means recomputing every hash after
// the edit, which `verify()` detects.
//
// The projection (state/projection.json) is derived and disposable — delete it and rebuild.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { createHash } from "crypto";
import { dirname, join } from "path";

export const STATE_DIR = join(import.meta.dir);

// Overridable so tests (and any dry-run tooling) never append to the real audit log. An audit log
// that contains fixture data is not an audit log.
const DEFAULT_EVENTS_PATH = join(STATE_DIR, "events.jsonl");
let eventsPath = process.env.CCP_EVENTS_PATH || DEFAULT_EVENTS_PATH;

/** Redirect the log. Returns a restore function. */
export function setEventsPath(p: string): () => void {
  const prev = eventsPath;
  eventsPath = p;
  return () => { eventsPath = prev; };
}

/** Where events are currently being written. */
export function currentEventsPath(): string {
  return eventsPath;
}

export type EventType =
  // lifecycle
  | "discovered"
  | "eligibility_screened"
  | "state_changed"
  // execution
  | "form_mapped"
  | "field_filled"
  | "field_skipped"
  | "form_filled"
  | "submitted"
  | "submission_unconfirmed"
  // identity access
  | "field_read"
  | "capability_denied"
  // human loop
  | "checkpoint_raised"
  | "checkpoint_resolved"
  | "attestation_recorded"
  | "recommendation_requested"
  // idempotency
  | "operation_started"
  | "operation_completed"
  // artifacts
  | "artifact_added"
  // voice corpus (Colin-AI)
  | "corpus_doc_verified"
  | "corpus_doc_rejected"
  | "corpus_split_frozen"
  | "eval_preregistered"
  | "eval_run_completed"
  | "voice_edit_recorded";

export interface LogEvent {
  /** Monotonic per-file sequence, starting at 1. */
  seq: number;
  at: string;
  type: EventType;
  /** Canonical scholarship id from src/lib/ids.js. Absent for system-level events. */
  applicationId?: string;
  actor: "agent" | "human" | "system";
  data: Record<string, unknown>;
  /** sha256 of the previous event's canonical JSON; null for the first event. */
  prevHash: string | null;
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** Hash over everything except the hash field itself, with stable key order. */
function canonical(e: Omit<LogEvent, "prevHash"> & { prevHash: string | null }): string {
  return JSON.stringify({
    seq: e.seq,
    at: e.at,
    type: e.type,
    applicationId: e.applicationId ?? null,
    actor: e.actor,
    data: e.data,
    prevHash: e.prevHash,
  });
}

export function readAll(): LogEvent[] {
  if (!existsSync(eventsPath)) return [];
  return readFileSync(eventsPath, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as LogEvent);
}

/** Tail state without parsing the whole file into objects twice. */
function lastEvent(): LogEvent | null {
  const all = readAll();
  return all.length ? all[all.length - 1] : null;
}

/**
 * Append one event. Returns the written event (with seq and prevHash filled in).
 * Synchronous and single-process by design — see the note about the advisory lock in rebuild.ts.
 */
export function append(
  type: EventType,
  data: Record<string, unknown>,
  opts: { applicationId?: string; actor?: LogEvent["actor"]; at?: string } = {},
): LogEvent {
  mkdirSync(dirname(eventsPath), { recursive: true });
  const prev = lastEvent();
  const event: LogEvent = {
    seq: (prev?.seq ?? 0) + 1,
    at: opts.at ?? new Date().toISOString(),
    type,
    applicationId: opts.applicationId,
    actor: opts.actor ?? "agent",
    data,
    prevHash: prev ? sha256(canonical(prev)) : null,
  };
  appendFileSync(eventsPath, JSON.stringify(event) + "\n", "utf8");
  return event;
}

/** Walk the chain. Returns the first break, or null when the log is intact. */
export function verify(): { ok: true } | { ok: false; brokenAtSeq: number; reason: string } {
  const all = readAll();
  for (let i = 0; i < all.length; i++) {
    const e = all[i];
    if (e.seq !== i + 1) return { ok: false, brokenAtSeq: e.seq, reason: `expected seq ${i + 1}, found ${e.seq}` };
    const expected = i === 0 ? null : sha256(canonical(all[i - 1]));
    if (e.prevHash !== expected) return { ok: false, brokenAtSeq: e.seq, reason: "prevHash does not match the preceding event" };
  }
  return { ok: true };
}
