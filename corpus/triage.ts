#!/usr/bin/env bun
// Authorship triage — the human checkpoint that decides what counts as Colin's writing.
//
// This is the one step in the pipeline that cannot be automated, and the reason is worth stating
// plainly: the surface features that would let a classifier spot LLM text are exactly the features
// a voice-conditioned model reproduces. A document Colin drafted with an LLM's help reads like
// Colin. So the question "did you write this?" has exactly one reliable oracle, and it is Colin.
//
// A voice model trained on LLM output would score well on every metric in this repo while being
// worthless. That failure is invisible from the inside, so it is prevented at the door.
//
//   bun corpus/triage.ts --raise    # open one checkpoint per unverified document
//   bun corpus/triage.ts            # show what is pending
//   bun corpus/triage.ts --apply    # fold resolutions back into drive-manifest.json

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { raise, openCheckpoints } from "../state/queue.js";
import { readAll, append } from "../state/log.ts";
import { harvestDrive, manifest, type ManifestDoc } from "./harvest-drive.ts";

const MANIFEST = join(import.meta.dir, "drive-manifest.json");

/** A short, recognisable slice so Colin can identify the document without opening it. */
export function excerpt(text: string, words = 40): string {
  const w = text.replace(/\s+/g, " ").trim().split(" ");
  return w.slice(0, words).join(" ") + (w.length > words ? " …" : "");
}

export interface Pending {
  doc: ManifestDoc;
  wordCount: number;
  excerpt: string;
  onDisk: boolean;
}

export function pending(): Pending[] {
  const { records } = harvestDrive();
  const byId = new Map(records.map((r) => [r.sourceId, r]));
  return manifest()
    .filter((d) => d.authorship === "unverified")
    .map((d) => {
      const r = byId.get(d.fileId);
      return {
        doc: d,
        wordCount: r?.wordCount ?? 0,
        excerpt: r ? excerpt(r.text) : "",
        onDisk: Boolean(r),
      };
    });
}

export function raiseAll(): { raised: string[]; skipped: string[] } {
  const raised: string[] = [];
  const skipped: string[] = [];
  for (const p of pending()) {
    if (!p.onDisk) {
      skipped.push(p.doc.fileId);
      continue;
    }
    const id = raise({
      type: "CORPUS_AUTHORSHIP_UNVERIFIED",
      context: { discriminator: p.doc.fileId, title: p.doc.title, hint: p.doc.hint },
      evidenceRefs: { sourceId: p.doc.fileId, excerpt: p.excerpt, wordCount: p.wordCount },
      actor: "agent",
    });
    raised.push(id);
  }
  return { raised, skipped };
}

/**
 * Fold resolved checkpoints back into the manifest.
 * Only `colin_wrote_it` promotes a document. `unsure` deliberately stays quarantined — an
 * uncertain yes is a no, because the cost of one contaminated document is every number downstream.
 */
export function applyResolutions(): { updated: ManifestDoc[]; stillOpen: number } {
  const events = readAll();
  const resolutions = new Map<string, string>();
  for (const e of events) {
    if (e.type !== "checkpoint_resolved") continue;
    const ctx = (e.data.context ?? {}) as Record<string, unknown>;
    const fileId = String(ctx.discriminator ?? "");
    if (fileId) resolutions.set(fileId, String(e.data.resolution ?? ""));
  }

  const raw = JSON.parse(readFileSync(MANIFEST, "utf8")) as { docs: ManifestDoc[] } & Record<string, unknown>;
  const updated: ManifestDoc[] = [];
  for (const d of raw.docs) {
    const r = resolutions.get(d.fileId);
    if (!r || d.authorship !== "unverified") continue;
    d.authorship = r as ManifestDoc["authorship"];
    updated.push(d);
    append(r === "colin_wrote_it" ? "corpus_doc_verified" : "corpus_doc_rejected", {
      fileId: d.fileId,
      title: d.title,
      resolution: r,
    }, { actor: "system" });
  }
  if (updated.length) writeFileSync(MANIFEST, JSON.stringify(raw, null, 2) + "\n");

  const stillOpen = Object.values(openCheckpoints()).filter(
    (c) => (c as { type?: string }).type === "CORPUS_AUTHORSHIP_UNVERIFIED",
  ).length;
  return { updated, stillOpen };
}

if (import.meta.main) {
  if (process.argv.includes("--raise")) {
    const { raised, skipped } = raiseAll();
    console.log(`raised ${raised.length} authorship checkpoints`);
    if (skipped.length) {
      console.log(`  ${skipped.length} skipped — not pulled to corpus/data/gdocs/ yet:`);
      for (const s of skipped) console.log(`    ${s}`);
    }
    console.log(`\nResolve them with state/queue.js resolve(), or answer in the dashboard.`);
  } else if (process.argv.includes("--apply")) {
    const { updated, stillOpen } = applyResolutions();
    console.log(`applied ${updated.length} resolutions; ${stillOpen} still open`);
    for (const d of updated) console.log(`  ${d.title.padEnd(45)} ${d.authorship}`);
  } else {
    const p = pending();
    console.log(`${p.length} documents awaiting authorship triage\n`);
    for (const x of p) {
      const status = x.onDisk ? `${x.wordCount} words` : "NOT PULLED";
      console.log(`  ${x.doc.title.padEnd(45)} ${String(status).padStart(12)}  [hint: ${x.doc.hint ?? "—"}]`);
      if (x.excerpt) console.log(`      ${x.excerpt.slice(0, 110)}`);
    }
    console.log(`\n  bun corpus/triage.ts --raise   to queue them for Colin`);
  }
}
