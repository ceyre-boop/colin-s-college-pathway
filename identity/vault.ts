// The identity vault — the applicant profile with per-field metadata.
//
// applicant.local.json stored bare values: `"gpa": "3.92"`. That shape cannot answer the two
// questions the filler actually needs to ask before typing something into a stranger's form:
//   • How do we know this is true, and when was it last checked?  (freshness → confidence)
//   • Is this field allowed to be auto-filled at all?              (policy → autofill gate)
//
// So every leaf becomes a VaultField. The resolved view is still the flat `Applicant` shape, so
// apply/field-map.ts needs no signature change — the vault resolves INTO the old type rather than
// replacing it.
//
// NOT ENCRYPTED, deliberately. Encryption whose key sits on the same disk beside the ciphertext,
// readable by the same process, is decoration. The real protections here are: the file is
// gitignored, it never reaches the browser bundle, and access goes through the broker which logs
// every read and refuses paths outside the current grant.

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { Applicant } from "../apply/types";

export const VAULT_PATH = join(import.meta.dir, "vault.json");

/** How a value came to be believed. Drives the freshness factor in confidence scoring. */
export type FieldSource =
  | "document" // read off a transcript, ID, FAFSA SAR, etc.
  | "official" // stated by the institution (portal, registrar)
  | "self" // self-asserted; true, but nothing external confirms it
  | "derived" // computed from other fields
  | "unverified"; // present but unchecked

/** Who may see this. `public` is the only tier allowed into the client bundle. */
export type Sensitivity = "public" | "internal" | "restricted";

export interface VaultField<T = string> {
  value: T;
  source: FieldSource;
  /** ISO date of the last verification, or null when never verified. */
  lastVerified: string | null;
  sensitivity: Sensitivity;
  allowedForAutofill: boolean;
  note?: string;
}

export type Vault = {
  _meta: { version: number; migratedAt: string; note: string };
  fields: Record<string, VaultField<any>>;
};

const MS_PER_DAY = 86_400_000;

/**
 * Freshness multiplier for the confidence calculation.
 *
 * A document-verified value checked this year is as good as it gets. A self-asserted value is
 * still probably right — Colin knows his own major — so the penalty is small. An unverified or
 * stale value is where the discount bites, because that is exactly the case where autofilling
 * something wrong into thirty applications is plausible.
 */
export function freshness(f: Pick<VaultField, "source" | "lastVerified">, now = Date.now()): number {
  const ageDays = f.lastVerified ? (now - Date.parse(f.lastVerified)) / MS_PER_DAY : Infinity;
  const stale = ageDays > 365;

  switch (f.source) {
    case "document":
    case "official":
      return stale ? 0.85 : 1.0;
    case "self":
      return stale ? 0.85 : 0.92;
    case "derived":
      return 0.92;
    default:
      return 0.8;
  }
}

/** Read the raw vault. Throws with an actionable message rather than returning a half-empty object. */
export function loadVault(path = VAULT_PATH): Vault {
  if (!existsSync(path)) {
    throw new Error(`No vault at ${path}. Run: bun identity/migrate-vault.ts`);
  }
  return JSON.parse(readFileSync(path, "utf8")) as Vault;
}

/** Dotted path → VaultField, or undefined. */
export function field(v: Vault, path: string): VaultField | undefined {
  return v.fields[path];
}

/** Every dotted path the vault knows about. */
export function paths(v: Vault): string[] {
  return Object.keys(v.fields);
}

/**
 * Rebuild the flat `Applicant` object from the vault. This is the compatibility seam: everything
 * downstream (field-map.ts, eligibility screening) keeps consuming the shape it always has.
 */
export function resolveApplicant(v: Vault): Applicant {
  const get = (p: string, d: any = "") => (p in v.fields ? v.fields[p].value : d);
  return {
    identity: {
      legalFirstName: get("identity.legalFirstName"),
      legalLastName: get("identity.legalLastName"),
      preferredName: get("identity.preferredName"),
      dateOfBirth: get("identity.dateOfBirth"),
      gender: get("identity.gender"),
      ethnicity: get("identity.ethnicity"),
      citizenship: get("identity.citizenship"),
    },
    contact: {
      email: get("contact.email"),
      phone: get("contact.phone"),
      address: {
        street: get("contact.address.street"),
        city: get("contact.address.city"),
        state: get("contact.address.state"),
        zip: get("contact.address.zip"),
        country: get("contact.address.country"),
      },
    },
    academic: {
      currentSchool: get("academic.currentSchool"),
      enrollmentNote: get("academic.enrollmentNote"),
      major: get("academic.major"),
      minor: get("academic.minor"),
      classLevel: get("academic.classLevel"),
      gpa: get("academic.gpa"),
      gpaScale: get("academic.gpaScale"),
      gpaContext: get("academic.gpaContext"),
      priorGpa: get("academic.priorGpa"),
      sat: get("academic.sat"),
      act: get("academic.act"),
      expectedGraduation: get("academic.expectedGraduation"),
      highSchool: get("academic.highSchool"),
    },
    financial: {
      fafsaSAI: get("financial.fafsaSAI"),
      pellEligible: get("financial.pellEligible", false),
      financialNeed: get("financial.financialNeed"),
      residency: get("financial.residency"),
    },
    honors: get("honors", []),
    activities: get("activities", []),
    work: get("work", []),
    intendedField: get("intendedField"),
    careerGoal: get("careerGoal"),
    documents: {
      resumePdf: get("documents.resumePdf"),
      transcriptPdf: get("documents.transcriptPdf"),
    },
    doNotClaim: get("doNotClaim", []),
  };
}

/** Paths marked public — the only ones a client bundle may carry. */
export function publicPaths(v: Vault): string[] {
  return paths(v).filter((p) => v.fields[p].sensitivity === "public");
}
