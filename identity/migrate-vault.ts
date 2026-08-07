// One-time migration: applicant.local.json → identity/vault.json
//
// Treated as an INPUT MIGRATION, not an in-place mutation:
//   1. the source file is never written to — it stays exactly as it is
//   2. a timestamped backup is taken before anything else happens
//   3. the vault is built in memory, then round-tripped back through resolveApplicant()
//   4. EVERY leaf is compared against the original; a single mismatch aborts and writes nothing
// Only after equivalence passes does the vault file appear on disk. Readers switch over
// separately, so the migration and the cutover are independently reversible.
//
// Usage:
//   bun identity/migrate-vault.ts            # migrate (refuses to clobber an existing vault)
//   bun identity/migrate-vault.ts --force    # re-migrate from applicant.local.json
//   bun identity/migrate-vault.ts --check    # validate an existing vault, write nothing

import { copyFileSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import type { Applicant } from "../apply/types";
import { VAULT_PATH, resolveApplicant, type FieldSource, type Sensitivity, type Vault, type VaultField } from "./vault";

const ROOT = join(import.meta.dir, "..");
const SOURCE = join(ROOT, "applicant.local.json");
const BACKUP_DIR = join(import.meta.dir, "backups");

const args = process.argv.slice(2);
const FORCE = args.includes("--force");
const CHECK_ONLY = args.includes("--check");

/**
 * Per-path policy. This table is the actual product of this migration — it is the knowledge that
 * did not exist anywhere before, and it has to be authored, not inferred.
 *
 * `source`/`lastVerified` default conservatively (self-asserted, unverified) so nothing starts out
 * claiming more confidence than it earned. Colin upgrades entries as he verifies them against
 * documents; identity/vault.json is gitignored so that is a purely local edit.
 *
 * `allowedForAutofill: false` means "never type this into a form automatically" — distinct from
 * field-map's HARD_BLOCK, which is about categories that must never be stored at all.
 */
const POLICY: Record<string, { source: FieldSource; sensitivity: Sensitivity; autofill: boolean; note?: string }> = {
  "identity.legalFirstName": { source: "self", sensitivity: "public", autofill: true },
  "identity.legalLastName": { source: "self", sensitivity: "public", autofill: true },
  "identity.preferredName": { source: "self", sensitivity: "public", autofill: true },
  "identity.dateOfBirth": { source: "document", sensitivity: "restricted", autofill: true, note: "verify against a government ID and set lastVerified" },
  "identity.gender": { source: "self", sensitivity: "restricted", autofill: false, note: "decline-to-state by default" },
  "identity.ethnicity": { source: "self", sensitivity: "restricted", autofill: false, note: "decline-to-state by default" },
  "identity.citizenship": { source: "self", sensitivity: "internal", autofill: true },

  "contact.email": { source: "self", sensitivity: "restricted", autofill: true },
  "contact.phone": { source: "self", sensitivity: "restricted", autofill: true },
  "contact.address.street": { source: "self", sensitivity: "restricted", autofill: true },
  "contact.address.city": { source: "self", sensitivity: "internal", autofill: true },
  "contact.address.state": { source: "self", sensitivity: "public", autofill: true },
  "contact.address.zip": { source: "self", sensitivity: "internal", autofill: true },
  "contact.address.country": { source: "derived", sensitivity: "public", autofill: true },

  "academic.currentSchool": { source: "official", sensitivity: "public", autofill: true },
  "academic.enrollmentNote": { source: "self", sensitivity: "public", autofill: false },
  "academic.major": { source: "official", sensitivity: "public", autofill: true },
  "academic.minor": { source: "official", sensitivity: "public", autofill: true },
  "academic.classLevel": { source: "official", sensitivity: "public", autofill: true },
  "academic.gpa": { source: "document", sensitivity: "public", autofill: true, note: "verify against the transcript and set lastVerified" },
  "academic.gpaScale": { source: "document", sensitivity: "public", autofill: true },
  "academic.gpaContext": { source: "self", sensitivity: "public", autofill: false },
  "academic.priorGpa": { source: "document", sensitivity: "public", autofill: true },
  "academic.sat": { source: "document", sensitivity: "public", autofill: true },
  "academic.act": { source: "document", sensitivity: "public", autofill: true },
  "academic.expectedGraduation": { source: "official", sensitivity: "public", autofill: true },
  "academic.highSchool": { source: "official", sensitivity: "internal", autofill: true },

  "financial.fafsaSAI": { source: "document", sensitivity: "restricted", autofill: false, note: "from the FAFSA SAR; never auto-typed — financial questions are a human checkpoint" },
  "financial.pellEligible": { source: "document", sensitivity: "restricted", autofill: false },
  "financial.financialNeed": { source: "derived", sensitivity: "restricted", autofill: false },
  "financial.residency": { source: "official", sensitivity: "internal", autofill: true },

  honors: { source: "self", sensitivity: "public", autofill: false, note: "list field — needs a composer, not a raw paste" },
  activities: { source: "self", sensitivity: "public", autofill: false, note: "list field — needs a composer" },
  work: { source: "self", sensitivity: "public", autofill: false, note: "list field — needs a composer" },
  intendedField: { source: "self", sensitivity: "public", autofill: true },
  careerGoal: { source: "self", sensitivity: "public", autofill: true },
  "documents.resumePdf": { source: "self", sensitivity: "internal", autofill: false, note: "file upload is a human checkpoint" },
  "documents.transcriptPdf": { source: "self", sensitivity: "restricted", autofill: false, note: "file upload is a human checkpoint" },
  doNotClaim: { source: "self", sensitivity: "internal", autofill: false, note: "negative assertions — never filled, only enforced" },
};

/** Flatten the applicant object to dotted paths. Arrays are leaves, not branches. */
function flatten(obj: any, prefix = ""): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith("_")) continue; // drop _comment / _README
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) Object.assign(out, flatten(v, path));
    else out[path] = v;
  }
  return out;
}

function buildVault(applicant: Applicant): { vault: Vault; unpoliced: string[] } {
  const flat = flatten(applicant);
  const fields: Record<string, VaultField<any>> = {};
  const unpoliced: string[] = [];

  for (const [path, value] of Object.entries(flat)) {
    const p = POLICY[path];
    if (!p) {
      unpoliced.push(path);
      // Unknown path: store it, but assume the least privilege available.
      fields[path] = { value, source: "unverified", lastVerified: null, sensitivity: "restricted", allowedForAutofill: false, note: "no policy entry — add one in identity/migrate-vault.ts" };
      continue;
    }
    fields[path] = {
      value,
      source: p.source,
      lastVerified: null, // nothing is verified until Colin says so — see the README note below
      sensitivity: p.sensitivity,
      allowedForAutofill: p.autofill,
      ...(p.note ? { note: p.note } : {}),
    };
  }

  return {
    vault: {
      _meta: {
        version: 1,
        migratedAt: new Date().toISOString(),
        note: "Generated from applicant.local.json. lastVerified is null everywhere on purpose: verification is a human act. Set it to today's ISO date as you check each field against its source document — until then the freshness factor discounts the field's autofill confidence.",
      },
      fields,
    },
    unpoliced,
  };
}

/** Deep equality over JSON-able values. */
function eq(a: any, b: any): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Compare every leaf of the original against the vault's resolved view. */
function validate(original: Applicant, vault: Vault): { ok: boolean; mismatches: string[]; compared: number } {
  const resolved = resolveApplicant(vault);
  const before = flatten(original);
  const after = flatten(resolved);
  const mismatches: string[] = [];

  for (const path of Object.keys(before)) {
    if (!eq(before[path], after[path])) mismatches.push(`${path}: source has ${JSON.stringify(before[path])}, vault resolves ${JSON.stringify(after[path])}`);
  }
  // Also catch anything the resolver invents that the source never had.
  for (const path of Object.keys(after)) {
    if (!(path in before) && after[path] !== "" && !eq(after[path], [])) mismatches.push(`${path}: appears only in the resolved view (${JSON.stringify(after[path])})`);
  }

  return { ok: mismatches.length === 0, mismatches, compared: Object.keys(before).length };
}

function main() {
  if (!existsSync(SOURCE)) {
    console.error(`✗ ${SOURCE} not found — nothing to migrate.`);
    process.exit(1);
  }
  const original = JSON.parse(readFileSync(SOURCE, "utf8")) as Applicant;

  if (CHECK_ONLY) {
    if (!existsSync(VAULT_PATH)) { console.error("✗ no vault to check."); process.exit(1); }
    const vault = JSON.parse(readFileSync(VAULT_PATH, "utf8")) as Vault;
    const v = validate(original, vault);
    console.log(v.ok ? `✓ vault matches applicant.local.json on all ${v.compared} fields` : `✗ ${v.mismatches.length} mismatch(es):\n  ${v.mismatches.join("\n  ")}`);
    process.exit(v.ok ? 0 : 1);
  }

  if (existsSync(VAULT_PATH) && !FORCE) {
    console.error(`✗ ${VAULT_PATH} already exists. Re-run with --force to rebuild it from applicant.local.json.`);
    process.exit(1);
  }

  // Backup FIRST, before anything is built or written.
  mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = join(BACKUP_DIR, `applicant.local.${stamp}.json`);
  copyFileSync(SOURCE, backup);
  console.log(`• backed up source → ${backup}`);

  const { vault, unpoliced } = buildVault(original);
  const result = validate(original, vault);

  if (!result.ok) {
    console.error(`✗ equivalence check FAILED — writing nothing. ${result.mismatches.length} mismatch(es):`);
    for (const m of result.mismatches) console.error(`    ${m}`);
    process.exit(1);
  }

  writeFileSync(VAULT_PATH, JSON.stringify(vault, null, 2) + "\n", "utf8");

  const autofillable = Object.values(vault.fields).filter((f) => f.allowedForAutofill).length;
  console.log(`✓ equivalence verified across all ${result.compared} fields`);
  console.log(`✓ wrote ${VAULT_PATH} — ${Object.keys(vault.fields).length} fields, ${autofillable} autofill-eligible`);
  console.log(`  applicant.local.json was NOT modified; readers switch over separately.`);
  if (unpoliced.length) {
    console.log(`\n⚠ ${unpoliced.length} path(s) had no policy entry and defaulted to restricted/no-autofill:`);
    for (const p of unpoliced) console.log(`    ${p}`);
  }
  console.log(`\nNext: set lastVerified on fields you have checked against a document.`);
}

if (import.meta.main) main();
