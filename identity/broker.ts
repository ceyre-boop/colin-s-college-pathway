// Capability broker over the identity vault.
//
// HONEST SCOPE — read this before assuming it is a security boundary. In a single-process Bun app,
// any module can call readFileSync("identity/vault.json") and skip this file entirely. As a
// sandbox, this is theater. Nothing here defends against malicious code running in-process.
//
// What it IS, and why it's worth the eighty lines: the three failure modes that are actually
// plausible for a local scholarship agent are (1) prompt injection from a scraped portal page
// convincing something to over-share, (2) a mapping bug replicated silently across thirty
// applications, and (3) a future semantic mapper helpfully stuffing the whole profile into a field
// labelled "Additional notes". Against all three, the useful property is not secrecy — it's that
// every identity read is scoped, purposeful, and recorded, so "the agent asked for the FAFSA SAI
// on a form that never mentioned money" becomes a loud event rather than silence.
//
// The grant is computed from the form's detected fields BEFORE the profile is loaded, so the
// filler never holds paths the form did not ask for.

import { append as logEvent } from "../state/log";
import { freshness, loadVault, resolveApplicant, type Vault, type VaultField } from "./vault";
import type { Applicant } from "../apply/types";

export class CapabilityDenied extends Error {
  constructor(public path: string, public purpose: string) {
    super(`Identity path "${path}" is outside the current grant (purpose: ${purpose}).`);
    this.name = "CapabilityDenied";
  }
}

export interface Grant {
  /** Dotted vault paths this holder may read. */
  paths: Set<string>;
  /** Why the grant exists — recorded on every read. */
  purpose: string;
  applicationId?: string;
}

export interface BrokerHandle {
  /** Read one field. Throws CapabilityDenied for anything outside the grant. */
  read(path: string): VaultField | undefined;
  /** Value only, or undefined. */
  value(path: string): any;
  /** Freshness multiplier for the confidence calculation. 0.8 when unknown. */
  freshnessOf(path: string): number;
  /** Whether policy permits auto-filling this path at all. */
  autofillAllowed(path: string): boolean;
  /**
   * The flat Applicant shape, with every path outside the grant blanked. Exists so field-map.ts
   * keeps its current signature: it receives an Applicant, not a broker, and simply cannot see
   * ungranted values because they resolve to "".
   */
  restrictedApplicant(): Applicant;
  /** Paths actually read through this handle, for the run summary. */
  readPaths(): string[];
  denied(): { path: string; at: string }[];
}

/** Blank every leaf not in `allow`, preserving the object shape. */
function redact(obj: any, allow: Set<string>, prefix = ""): any {
  if (Array.isArray(obj)) return obj;
  if (obj && typeof obj === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(obj)) {
      const path = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === "object" && !Array.isArray(v)) out[k] = redact(v, allow, path);
      else if (allow.has(path)) out[k] = v;
      else out[k] = typeof v === "boolean" ? false : Array.isArray(v) ? [] : "";
    }
    return out;
  }
  return obj;
}

/**
 * Open a scoped handle over the vault.
 *
 * `doNotClaim` is always granted regardless of the requested paths — it is a list of things that
 * must NEVER be asserted, and withholding it could only ever cause a false claim.
 */
export function open(grant: Grant, vault: Vault = loadVault()): BrokerHandle {
  const allow = new Set(grant.paths);
  allow.add("doNotClaim");

  const reads: string[] = [];
  const denials: { path: string; at: string }[] = [];

  const check = (path: string) => {
    if (allow.has(path)) return;
    const at = new Date().toISOString();
    denials.push({ path, at });
    logEvent("capability_denied", { path, purpose: grant.purpose, grantSize: allow.size }, { applicationId: grant.applicationId });
    throw new CapabilityDenied(path, grant.purpose);
  };

  return {
    read(path) {
      check(path);
      const f = vault.fields[path];
      reads.push(path);
      logEvent("field_read", { path, purpose: grant.purpose, source: f?.source ?? null }, { applicationId: grant.applicationId });
      return f;
    },
    value(path) {
      return this.read(path)?.value;
    },
    freshnessOf(path) {
      const f = vault.fields[path];
      return f ? freshness(f) : 0.8;
    },
    autofillAllowed(path) {
      return Boolean(vault.fields[path]?.allowedForAutofill);
    },
    restrictedApplicant() {
      const full = resolveApplicant(vault);
      // One aggregate event rather than one per leaf — the grant already says what was reachable.
      logEvent("field_read", { path: "*restricted-applicant*", purpose: grant.purpose, granted: [...allow].sort() }, { applicationId: grant.applicationId });
      const r = redact(full, allow) as Applicant;
      r.doNotClaim = full.doNotClaim;
      return r;
    },
    readPaths: () => [...new Set(reads)],
    denied: () => denials,
  };
}

/**
 * Build the minimum grant that a set of form labels could possibly need.
 *
 * Called BEFORE the vault is opened: map each label through the field mapper to learn which paths
 * this specific form asks for, and grant exactly those. A form with six fields gets six paths, not
 * the whole profile — so a hidden seventh field cannot be answered even if something tried.
 */
export function grantForLabels(
  labels: string[],
  mapPath: (label: string) => string | null,
  purpose: string,
  applicationId?: string,
): Grant {
  const paths = new Set<string>();
  for (const l of labels) {
    const p = mapPath(l);
    if (p) paths.add(p);
  }
  return { paths, purpose, applicationId };
}
