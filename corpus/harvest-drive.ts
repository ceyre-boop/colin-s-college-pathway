#!/usr/bin/env bun
// Pull the triaged Google Docs into the corpus.
//
// This script deliberately does NOT talk to Google. The Drive connector is a Claude-session tool,
// not a library, so wiring it into the build would make the pipeline unreplayable and untestable —
// and would put an expiring OAuth token on the critical path of a deterministic data build.
//
// Instead: a Claude session drops each doc to corpus/data/gdocs/<fileId>.md, and this reads the
// manifest plus those files. Re-running it offline reproduces the same corpus byte for byte.
//
// To refresh the drop, ask Claude: "pull the docs in corpus/drive-manifest.json to corpus/data/gdocs/".

import { existsSync, readFileSync, mkdirSync } from "fs";
import { join } from "path";
import { PATHS, recordId, words, type CorpusRecord } from "./schema.ts";

export interface ManifestDoc {
  fileId: string;
  title: string;
  claimedRegister: string;
  /** Set ONLY by Colin via the triage checkpoint. */
  authorship: "unverified" | "colin_wrote_it" | "llm_assisted" | "not_mine" | "unsure";
  hint?: string;
  notes?: string;
}

const MANIFEST = join(import.meta.dir, "drive-manifest.json");

export function manifest(): ManifestDoc[] {
  return (JSON.parse(readFileSync(MANIFEST, "utf8")) as { docs: ManifestDoc[] }).docs;
}

/** Strip the Docs export's soft-wrap artefacts without touching spelling or punctuation. */
export function normalizeDoc(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface DriveHarvest {
  records: CorpusRecord[];
  missing: ManifestDoc[];
  unverified: ManifestDoc[];
}

export function harvestDrive(): DriveHarvest {
  mkdirSync(PATHS.gdocs, { recursive: true });
  const records: CorpusRecord[] = [];
  const missing: ManifestDoc[] = [];
  const unverified: ManifestDoc[] = [];

  for (const doc of manifest()) {
    const path = join(PATHS.gdocs, `${doc.fileId}.md`);
    if (!existsSync(path)) {
      missing.push(doc);
      continue;
    }
    const text = normalizeDoc(readFileSync(path, "utf8"));
    const verified = doc.authorship === "colin_wrote_it";
    if (!verified) unverified.push(doc);

    records.push({
      id: recordId("gdoc", doc.fileId, text),
      text,
      register: "academic", // provisional; corpus/register.ts refines with isGdoc scoring
      registerConfidence: 0,
      source: "gdoc",
      sourceId: doc.fileId,
      timestamp: null,
      wordCount: words(text),
      // A document is only usable once Colin says he wrote it. No heuristic may promote one.
      verifiedBy: verified ? "colin" : null,
      verifiedAt: null,
      split: null,
      quarantine: verified ? null : { reason: "unverified-academic", note: `authorship=${doc.authorship}` },
    });
  }

  return { records, missing, unverified };
}

if (import.meta.main) {
  const { records, missing, unverified } = harvestDrive();
  const usable = records.filter((r) => r.verifiedBy === "colin");
  const usableWords = usable.reduce((n, r) => n + r.wordCount, 0);

  console.log(`drive: ${records.length} docs on disk, ${usable.length} verified (${usableWords.toLocaleString()} words)`);
  if (missing.length) {
    console.log(`\n  ${missing.length} not yet pulled — ask Claude to fetch these to ${PATHS.gdocs}:`);
    for (const d of missing) console.log(`    ${d.fileId}  ${d.title}`);
  }
  if (unverified.length) {
    console.log(`\n  ${unverified.length} awaiting authorship triage (bun corpus/triage.ts --raise):`);
    for (const d of unverified) console.log(`    ${d.title}  [${d.authorship}]`);
  }
  if (!usable.length) {
    console.log(`\n  No verified academic documents yet. The academic register cannot be measured,`);
    console.log(`  and every academic-register claim downstream stays unavailable until it can.`);
  }
}
