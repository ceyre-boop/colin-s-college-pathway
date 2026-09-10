#!/usr/bin/env bun
// Freeze the train / exemplar / holdout split.
//
// Two rules, both of which exist because the obvious shortcut destroys the experiment:
//
//   SPLIT BY DOCUMENT, NEVER BY PASSAGE. Two passages from the same essay share its topic, its
//   argument, and its author's mood that afternoon. Put one in train and one in holdout and the
//   holdout is no longer held out — the model has already seen its neighbour.
//
//   FREEZE ONCE, HASHED INTO THE LOG. The split is written to disk and its sha256 appended to
//   state/events.jsonl as `corpus_split_frozen`. Re-splitting after seeing a result is the
//   cheapest possible way to manufacture a good number, so it is made detectable rather than
//   forbidden by convention.
//
//   bun corpus/split.ts            # dry run: show what the split would be
//   bun corpus/split.ts --freeze   # write splits.json and chain it into the event log

import { existsSync, readFileSync } from "fs";
import { append, readAll } from "../state/log.ts";
import { PATHS, readJsonl, writeJsonl, type CorpusRecord, type Register } from "./schema.ts";

/** Fixed seed: the split must be reproducible from the corpus alone. */
export const SEED = 20260910;

export interface SplitRatios {
  holdout: number;
  exemplar: number;
}

/**
 * Academic documents are scarce, so a larger share is held out — the held-out academic set is the
 * only thing that can falsify the academic-register claim, and an underpowered one falsifies
 * nothing. Raw is abundant, so it gives up less.
 */
export const RATIOS: Record<Register, SplitRatios> = {
  academic: { holdout: 0.25, exemplar: 0.25 },
  persuasive: { holdout: 0.25, exemplar: 0.25 },
  narrative: { holdout: 0.2, exemplar: 0.25 },
  raw: { holdout: 0.15, exemplar: 0.25 },
  directive: { holdout: 0.15, exemplar: 0.25 },
};

/** Deterministic PRNG (mulberry32) — Math.random would make the split unreproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled<T>(xs: T[], rand: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export interface SplitAssignment {
  /** documentKey -> split. For gdocs the key is the fileId; for transcripts, the record id. */
  assignments: Record<string, "train" | "exemplar" | "holdout">;
  counts: Record<string, Record<string, number>>;
  seed: number;
}

/**
 * A "document" is the unit that must not be split across sets. A Google Doc is one document; a
 * transcript message is its own document (they are independent turns, often months apart).
 */
export function documentKey(r: CorpusRecord): string {
  return r.source === "gdoc" ? r.sourceId : r.id;
}

/** Assignments already frozen on disk, which must never change. */
export function existingAssignments(path = PATHS.splits): SplitAssignment["assignments"] {
  if (!existsSync(path)) return {};
  try {
    return (JSON.parse(readFileSync(path, "utf8")) as SplitAssignment).assignments ?? {};
  } catch {
    return {};
  }
}

/**
 * Assign documents to splits, INCREMENTALLY.
 *
 * Existing assignments are carried through untouched and only new documents are placed. This
 * matters because the academic register is blocked on a human triage step: without incrementality,
 * adding those documents later would reshuffle everything, and a record that had been held out
 * could silently land in the exemplar pool — un-holding the held-out set after results existed.
 *
 * Ratios are applied to the NEW documents of each register, so a register that arrives later still
 * gets a proper holdout share of its own.
 */
export function assign(records: CorpusRecord[], seed = SEED, prior = existingAssignments()): SplitAssignment {
  const rand = rng(seed);
  const assignments: SplitAssignment["assignments"] = { ...prior };
  const counts: SplitAssignment["counts"] = {};

  const byRegister = new Map<Register, string[]>();
  for (const r of records) {
    const k = documentKey(r);
    if (!byRegister.has(r.register)) byRegister.set(r.register, []);
    const list = byRegister.get(r.register)!;
    if (!list.includes(k)) list.push(k);
  }

  for (const [register, keys] of byRegister) {
    const ratios = RATIOS[register];
    counts[register] = { train: 0, exemplar: 0, holdout: 0 };

    const fresh = keys.filter((k) => !(k in assignments));
    // Sort before shuffling so the input order of the corpus file cannot change the split.
    const order = shuffled([...fresh].sort(), rand);
    const nHold = Math.max(order.length >= 4 ? 1 : 0, Math.round(order.length * ratios.holdout));
    const nEx = Math.max(order.length >= 4 ? 1 : 0, Math.round(order.length * ratios.exemplar));

    order.forEach((k, i) => {
      assignments[k] = i < nHold ? "holdout" : i < nHold + nEx ? "exemplar" : "train";
    });
    for (const k of keys) counts[register][assignments[k]]++;
  }

  return { assignments, counts, seed };
}

export function applySplit(records: CorpusRecord[], a: SplitAssignment): CorpusRecord[] {
  return records.map((r) => ({ ...r, split: a.assignments[documentKey(r)] ?? null }));
}

export function splitsHash(a: SplitAssignment): string {
  const h = new Bun.CryptoHasher("sha256");
  h.update(JSON.stringify(a.assignments, Object.keys(a.assignments).sort()));
  return h.digest("hex");
}

/** Has a split already been frozen into the event log? */
export function frozenSplit(): { hash: string; at: string } | null {
  const ev = readAll().filter((e) => e.type === "corpus_split_frozen");
  if (!ev.length) return null;
  const last = ev[ev.length - 1];
  return { hash: String(last.data.hash), at: last.at };
}

if (import.meta.main) {
  const freeze = process.argv.includes("--freeze");
  const records = await readJsonl<CorpusRecord>(PATHS.clean);
  if (!records.length) {
    console.error(`No clean corpus at ${PATHS.clean}. Run: bun corpus/build.ts`);
    process.exit(1);
  }

  const a = assign(records);
  const hash = splitsHash(a);
  const prior = frozenSplit();

  console.log(`split (seed ${a.seed}) — by document, never by passage\n`);
  const regs = Object.keys(a.counts);
  console.log("register".padEnd(12) + "train".padStart(9) + "exemplar".padStart(10) + "holdout".padStart(9));
  for (const r of regs) {
    const c = a.counts[r];
    console.log(r.padEnd(12) + String(c.train).padStart(9) + String(c.exemplar).padStart(10) + String(c.holdout).padStart(9));
  }
  console.log(`\nhash: ${hash}`);

  // The hash necessarily changes when documents are ADDED — that is expected and fine. What must
  // never happen is an existing document changing sides, so that is what is checked.
  const previous = existingAssignments();
  const moved = Object.entries(previous).filter(([k, v]) => a.assignments[k] !== v);
  if (moved.length) {
    console.error(`\nREFUSING: ${moved.length} document(s) would change split.`);
    for (const [k, v] of moved.slice(0, 10)) console.error(`  ${k}: ${v} -> ${a.assignments[k] ?? "dropped"}`);
    console.error(`\nA held-out document moving into the exemplar pool un-holds the held-out set`);
    console.error(`after results already exist. Fix the input rather than the split.`);
    process.exit(1);
  }
  const added = Object.keys(a.assignments).length - Object.keys(previous).length;
  if (prior) {
    console.log(`previously frozen at ${prior.at}; ${added} new document(s) since.`);
  }

  if (freeze) {
    const split = applySplit(records, a);
    await writeJsonl(PATHS.clean, split);
    await Bun.write(PATHS.splits, JSON.stringify(a, null, 2));

    // Promote to verified.jsonl — the only file any generation, eval or training path reads.
    // Transcript records carry verifiedBy "heuristic" because their authorship is not in question:
    // Colin typed them into his own terminal. Google Docs carry null until he says he wrote them.
    const verified = split.filter((r) => r.verifiedBy !== null && r.quarantine === null);
    await writeJsonl(PATHS.verified, verified);

    if (!prior || added > 0) {
      append(
        "corpus_split_frozen",
        { hash, seed: a.seed, counts: a.counts, records: records.length, added, incremental: Boolean(prior) },
        { actor: "system" },
      );
      console.log(`\nfrozen and chained into the event log`);
    }
    console.log(`  ${PATHS.splits}`);
    console.log(`  ${PATHS.verified} — ${verified.length.toLocaleString()} verified records`);
  } else {
    console.log(`\n(dry run — pass --freeze to write and chain it)`);
  }
}
