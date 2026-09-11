#!/usr/bin/env bun
// Register bleed — the research edge.
//
// The claim is that register is a clean DIAL, not a blend. The test is a crossed design: request
// register R while supplying exemplars from register E, for every (R, E) pair, and ask what the
// output actually measures as.
//
//   Diagonal cells (R = E) are the easy case and prove little.
//   OFF-DIAGONAL cells are the experiment. If requested-academic with raw exemplars comes out
//   reading as raw, the exemplars are driving the register and the "dial" is a label on a blend.
//
// Three things are measured, and the third is the one that would be missed by a casual version:
//
//   BLEED RATE — P(classified as E | requested R, exemplars E), for R != E.
//   REGISTER SEPARATION — how far apart the model's own registers sit, against how far apart
//     Colin's actually are. A model whose registers are CLOSER together than his has a blend, even
//     if every cell classifies correctly.
//   PER-MARKER LEAK — which specific feature leaked, and by how much. "Requested academic leaks
//     lowercase sentence starts at 3x baseline" is actionable; "register control is imperfect"
//     is not.
//
//   bun eval/bleed.ts --registers=narrative,raw --n=6

import { mkdirSync } from "fs";
import { join } from "path";
import { assertPreregistered } from "./prereg.ts";
import { features } from "./stylometry.ts";
import { reference, delta, meanVector, aggregate, withinColinBand } from "./delta.ts";
import { generateOne } from "./generate.ts";
import { contracts, contractFor, TOLERANCE_SD } from "../voice/registers.ts";
import { scalars, CONTRACT_FEATURES } from "../corpus/stats.ts";
import { PATHS, readJsonl, type CorpusRecord, type Register } from "../corpus/schema.ts";
import type { Pair as SeedPair } from "../corpus/skeleton.ts";

const REPORTS = join(import.meta.dir, "reports");

export interface Cell {
  requested: Register;
  exemplar: Register;
  n: number;
  /** How often the output classified as the EXEMPLAR register instead of the requested one. */
  bleedRate: number;
  /** How often it classified as requested. */
  holdRate: number;
  /** Markers more than 1.5 sd from the requested register's baseline. */
  markerLeaks: { feature: string; observed: number; baseline: number; sd: number; z: number }[];
}

/** Classify by nearest register contract. Trained on Colin's baseline only, never on model output. */
export function classify(text: string): Register | null {
  const f = features(text);
  const s = scalars(f);
  let best: Register | null = null;
  let bestScore = Infinity;

  for (const c of contracts()) {
    let sum = 0;
    let used = 0;
    for (const b of c.bands) {
      const o = s[b.feature];
      if (o === null || o === undefined || !b.sd) continue;
      sum += Math.abs((o - b.mean) / b.sd);
      used++;
    }
    if (!used) continue;
    const score = sum / used;
    if (score < bestScore) { bestScore = score; best = c.register; }
  }
  return best;
}

/** Per-marker distance from the requested register's measured baseline. */
export function markerLeaks(text: string, requested: Register, threshold = 1.5): Cell["markerLeaks"] {
  const c = contractFor(requested);
  if (!c) return [];
  const s = scalars(features(text));
  const out: Cell["markerLeaks"] = [];
  for (const f of CONTRACT_FEATURES) {
    const b = c.bands.find((x) => x.feature === f);
    const o = s[f];
    if (!b || !b.sd || o === null || o === undefined) continue;
    const z = (o - b.mean) / b.sd;
    if (Math.abs(z) > threshold) {
      out.push({ feature: f, observed: o, baseline: b.mean, sd: b.sd, z: Number(z.toFixed(2)) });
    }
  }
  return out;
}

async function main() {
  const prereg = assertPreregistered();
  const registers = (process.argv.find((a) => a.startsWith("--registers="))?.split("=")[1] ?? "narrative,raw")
    .split(",") as Register[];
  const n = Number(process.argv.find((a) => a.startsWith("--n="))?.split("=")[1] ?? 4);

  const available = new Set(contracts().map((c) => c.register));
  const usable = registers.filter((r) => available.has(r));
  if (usable.length < 2) {
    console.error(`Bleed needs at least two registers with measured contracts. Have: ${[...available].join(", ") || "none"}.`);
    console.error(`The academic register is blocked on the Drive connector and authorship triage.`);
    process.exit(1);
  }

  const pairs = (await readJsonl<SeedPair>(PATHS.pairs)).filter((p) => p.split === "holdout");
  if (!pairs.length) {
    console.error(`No held-out pairs. Run: bun corpus/skeleton.ts --split=holdout`);
    process.exit(1);
  }

  const runId = `bleed_${new Date().toISOString().replace(/[:.]/g, "-")}`;
  console.log(`${runId}: ${usable.length}x${usable.length} crossed design, n=${n} per cell\n`);

  const cells: Cell[] = [];
  const outputsByRegister = new Map<Register, string[]>();

  for (const requested of usable) {
    for (const exemplar of usable) {
      const seeds = pairs.slice(0, n);
      let bled = 0;
      let held = 0;
      const leaks: Cell["markerLeaks"] = [];

      for (const p of seeds) {
        const g = await generateOne({ ...p, register: requested }, { arm: "v2", exemplarRegister: exemplar, orthography: false });
        const cls = classify(g.text);
        if (cls === requested) held++;
        else if (cls === exemplar) bled++;
        leaks.push(...markerLeaks(g.text, requested));
        if (requested === exemplar) {
          if (!outputsByRegister.has(requested)) outputsByRegister.set(requested, []);
          outputsByRegister.get(requested)!.push(g.text);
        }
      }

      // Collapse leaks to the worst instance per feature — a list of the same feature ten times
      // says nothing more than the worst one does.
      const worst = new Map<string, Cell["markerLeaks"][number]>();
      for (const l of leaks) {
        const cur = worst.get(l.feature);
        if (!cur || Math.abs(l.z) > Math.abs(cur.z)) worst.set(l.feature, l);
      }

      const cell: Cell = {
        requested, exemplar, n: seeds.length,
        bleedRate: seeds.length ? bled / seeds.length : Number.NaN,
        holdRate: seeds.length ? held / seeds.length : Number.NaN,
        markerLeaks: [...worst.values()].sort((a, b) => Math.abs(b.z) - Math.abs(a.z)),
      };
      cells.push(cell);
      console.log(`  requested=${requested.padEnd(10)} exemplars=${exemplar.padEnd(10)} hold=${(cell.holdRate * 100).toFixed(0)}% bleed=${(cell.bleedRate * 100).toFixed(0)}%`);
    }
  }

  // Register separation: the model's own registers against Colin's own.
  const corpus = await readJsonl<CorpusRecord>(PATHS.verified);
  const lines: string[] = [`# Register bleed — ${runId}`, ``, `- Preregistration: \`${prereg.sha256}\``, `- Registers: ${usable.join(", ")} | n=${n} per cell`, ``];

  lines.push(`## Crossed design`, ``, `Off-diagonal cells are the experiment. Success is bleed ≤10% in every one.`, ``);
  lines.push(`| requested | exemplars | n | holds requested | bleeds to exemplar |`);
  lines.push(`|---|---|---|---|---|`);
  for (const c of cells) {
    const mark = c.requested !== c.exemplar && c.bleedRate > 0.1 ? " **FAIL**" : "";
    lines.push(`| ${c.requested} | ${c.exemplar} | ${c.n} | ${(c.holdRate * 100).toFixed(0)}% | ${(c.bleedRate * 100).toFixed(0)}%${mark} |`);
  }

  lines.push(``, `## Register separation`, ``);
  if (usable.length >= 2) {
    const [r1, r2] = usable;
    const colin1 = aggregate(corpus.filter((r) => r.register === r1 && r.split !== "holdout").map((r) => r.text));
    const colin2 = aggregate(corpus.filter((r) => r.register === r2 && r.split !== "holdout").map((r) => r.text));
    const ref = reference([...colin1, ...colin2].map((t) => features(t)));
    const colinSep = delta(meanVector(colin1.map((t) => features(t))), meanVector(colin2.map((t) => features(t))), ref);

    const m1 = outputsByRegister.get(r1) ?? [];
    const m2 = outputsByRegister.get(r2) ?? [];
    if (m1.length && m2.length) {
      const modelSep = delta(meanVector(m1.map((t) => features(t))), meanVector(m2.map((t) => features(t))), ref);
      lines.push(`- Colin's own ${r1} ↔ ${r2} separation: **${colinSep.toFixed(3)}**`);
      lines.push(`- The model's ${r1} ↔ ${r2} separation: **${modelSep.toFixed(3)}**`);
      lines.push(``);
      lines.push(
        modelSep < colinSep * 0.75
          ? `The model's registers sit CLOSER together than Colin's do. That is a blend wearing a dial's label: every cell could classify correctly and the registers would still be insufficiently distinct.`
          : `The model's registers are at least as far apart as Colin's, which is the necessary condition for a dial rather than a blend.`,
      );
    } else {
      lines.push(`- Not enough diagonal-cell output to measure separation.`);
    }
  }

  lines.push(``, `## Per-marker leaks`, ``, `Reported per feature, because "register control is imperfect" is not actionable.`, ``);
  for (const c of cells) {
    if (!c.markerLeaks.length) continue;
    lines.push(`**requested ${c.requested}, exemplars ${c.exemplar}** (worst instance per marker, >1.5 sd):`);
    for (const l of c.markerLeaks.slice(0, 6)) {
      lines.push(`- \`${l.feature}\`: ${l.observed.toFixed(2)} against a ${c.requested} baseline of ${l.baseline.toFixed(2)} (z=${l.z})`);
    }
    lines.push(``);
  }

  lines.push(`## Verdict`, ``);
  const offDiagonal = cells.filter((c) => c.requested !== c.exemplar);
  const worstBleed = offDiagonal.length ? Math.max(...offDiagonal.map((c) => c.bleedRate)) : 0;
  lines.push(`- Worst off-diagonal bleed: **${(worstBleed * 100).toFixed(0)}%** (target ≤10%). ${worstBleed <= 0.1 ? "PASSES." : "FAILS."}`);
  lines.push(`- Tolerance used for contract violations: ${TOLERANCE_SD} sd; marker-leak threshold 1.5 sd.`);

  mkdirSync(REPORTS, { recursive: true });
  const p = join(REPORTS, `${runId}.md`);
  await Bun.write(p, lines.join("\n") + "\n");
  console.log(`\nreport -> ${p}`);
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
