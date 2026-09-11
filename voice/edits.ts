// The continuous loop: every edit Colin makes to model output is training signal.
//
// This is the only part of the system that improves without anyone deciding to improve it. When he
// rewrites a sentence, the pair (what the model wrote -> what he actually wanted) is exactly the
// supervision the corpus is short of — and unlike every other document in the corpus, its
// authorship needs no triage. He wrote the edit. That is what an edit is.
//
// It also fixes a measurement problem. The `revisions[].by === "colin"` flag defined in
// voice_profile.md is currently 0 across all 20 essays, which makes it useless as a corpus filter.
// Every edit recorded here makes that flag mean something.
//
// THE GUARD THAT MATTERS: an edit to output generated from a HELD-OUT prompt must never enter
// training. Without that check the test set leaks back in through the flywheel, one correction at
// a time, and nothing downstream would show it.

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { append } from "../state/log.ts";
import { PATHS, readJsonl, recordId, words, type CorpusRecord, type Register } from "../corpus/schema.ts";

export interface EditPair {
  /** What the model produced. */
  before: string;
  /** What Colin actually wanted. */
  after: string;
  register: Register;
  /** The essay or generation this edited, when known. */
  essayId?: string;
  /** The held-out prompt it came from, if any — quarantines the pair from training. */
  sourceId?: string;
  timestamp: string;
  /** True when the source prompt is in the holdout split. */
  heldOut: boolean;
}

export const EDITS_PATH = PATHS.edits;
export const HELDOUT_EDITS_PATH = PATHS.edits.replace(/\.jsonl$/, "-heldout.jsonl");

/** Source ids that must never contribute training signal. */
export async function holdoutSourceIds(): Promise<Set<string>> {
  const rows = await readJsonl<CorpusRecord>(PATHS.verified);
  return new Set(rows.filter((r) => r.split === "holdout").map((r) => r.sourceId));
}

export interface RecordEditInput {
  before: string;
  after: string;
  register: Register;
  essayId?: string;
  sourceId?: string;
}

export async function recordEdit(input: RecordEditInput): Promise<EditPair> {
  if (!input.after?.trim()) throw new Error("after is required — an empty edit is not a correction.");
  if (input.before === input.after) throw new Error("before and after are identical; nothing was edited.");

  const heldOut = input.sourceId ? (await holdoutSourceIds()).has(input.sourceId) : false;
  const pair: EditPair = {
    before: input.before,
    after: input.after,
    register: input.register,
    essayId: input.essayId,
    sourceId: input.sourceId,
    timestamp: new Date().toISOString(),
    heldOut,
  };

  // Held-out edits are kept — they are useful for error analysis — but in a file nothing trains on.
  const path = heldOut ? HELDOUT_EDITS_PATH : EDITS_PATH;
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  writeFileSync(path, existing + JSON.stringify(pair) + "\n");

  append(
    "voice_edit_recorded",
    {
      register: input.register,
      essayId: input.essayId,
      sourceId: input.sourceId,
      heldOut,
      beforeWords: words(input.before),
      afterWords: words(input.after),
    },
    { actor: "human" },
  );

  if (input.essayId) recordRevision(input.essayId, input.after);
  return pair;
}

/**
 * Write the edit into the essay's revisions[] with `by: "colin"`, honouring the convention already
 * defined in voice_profile.md. That flag was 0/20 before this existed.
 */
export function recordRevision(essayId: string, text: string, root = join(import.meta.dir, "..")): boolean {
  const dir = join(root, "scholarship_essays", essayId);
  const metaPath = join(dir, "metadata.json");
  const essayPath = join(dir, "essay.md");
  if (!existsSync(metaPath)) return false;

  const meta = JSON.parse(readFileSync(metaPath, "utf8")) as { revisions?: unknown[] };
  meta.revisions = Array.isArray(meta.revisions) ? meta.revisions : [];
  meta.revisions.push({
    date: new Date().toISOString().slice(0, 10),
    by: "colin",
    note: "Edited by Colin; recorded through the voice edit loop.",
  });
  writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n");
  if (existsSync(essayPath)) writeFileSync(essayPath, text.trim() + "\n");
  return true;
}

/**
 * Fold edits into the corpus as verified records.
 * Only the `after` text becomes a positive example. The `before` is what the model got wrong; it is
 * useful for preference-style evaluation but must never be trained on as if Colin had written it.
 */
export async function ingestEdits(): Promise<CorpusRecord[]> {
  const pairs = await readJsonl<EditPair>(EDITS_PATH);
  return pairs
    .filter((p) => !p.heldOut)
    .map((p) => ({
      id: recordId("manual", `edit:${p.timestamp}`, p.after),
      text: p.after,
      register: p.register,
      registerConfidence: 1,
      source: "manual" as const,
      sourceId: `edit:${p.timestamp}`,
      timestamp: p.timestamp,
      wordCount: words(p.after),
      // An edit is self-verifying authorship: Colin made it. That is the whole point of the loop.
      verifiedBy: "colin" as const,
      verifiedAt: p.timestamp,
      split: "train" as const,
      quarantine: null,
    }));
}
