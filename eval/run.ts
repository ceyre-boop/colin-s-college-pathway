#!/usr/bin/env bun
// The eval run. Refuses to start unless the preregistration is intact.
//
//   bun eval/run.ts --arms v1,v2 --registers narrative --n 20
//   bun eval/run.ts --arms v2 --registers narrative --n 20 --orthography
//
// Every number it prints is reported against a band or a CI that was fixed before any output
// existed. A register that fails is a finding and is printed as one.

import { mkdirSync } from "fs";
import { join } from "path";
import { append } from "../state/log.ts";
import { assertPreregistered } from "./prereg.ts";
import { features } from "./stylometry.ts";
import { reference, delta, withinColinBand, judge, generalImposters, aggregate, meanVector } from "./delta.ts";
import { buildPairs, judgeLlm, accuracy, type Judgement, type Passage } from "./panel.ts";
import { generateAll, type Arm, type Generation } from "./generate.ts";
import { PATHS, readJsonl, type CorpusRecord, type Register } from "../corpus/schema.ts";
import type { Pair as SeedPair } from "../corpus/skeleton.ts";

const REPORTS = join(import.meta.dir, "reports");
const DATA = join(import.meta.dir, "data");

function arg(name: string, fallback: string): string {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1]
    ?? (process.argv[process.argv.indexOf(`--${name}`) + 1]?.startsWith("--") ? fallback : process.argv[process.argv.indexOf(`--${name}`) + 1])
    ?? fallback;
}

/** Generated essays are the impostor set: an LLM already conditioned on voice_profile.md. */
async function impostorSet(): Promise<string[]> {
  const { readdirSync, existsSync, readFileSync } = await import("fs");
  const dir = join(import.meta.dir, "..", "scholarship_essays");
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const p = join(dir, d.name, "essay.md");
    if (existsSync(p)) out.push(readFileSync(p, "utf8"));
  }
  return out;
}

async function main() {
  // THE GATE. Nothing runs until the preregistration on disk matches what was committed.
  const prereg = assertPreregistered();
  console.log(`preregistration verified (${prereg.at})\n`);

  const arms = arg("arms", "v1,v2").split(",").filter(Boolean) as Arm[];
  const registers = arg("registers", "narrative").split(",").filter(Boolean) as Register[];
  const n = Number(arg("n", "20"));
  const orthography = process.argv.includes("--orthography");
  // Judge samples per pair. k=5 is the preregistered default; lower it only for a smoke run, and
  // say so in the report, because fewer samples means a noisier majority vote.
  const k = Number(arg("k", "5"));
  const runId = `run_${new Date().toISOString().replace(/[:.]/g, "-")}`;

  const allPairs = await readJsonl<SeedPair>(PATHS.pairs);
  const corpus = await readJsonl<CorpusRecord>(PATHS.verified);
  if (!allPairs.length) {
    console.error(`No (seed -> piece) pairs at ${PATHS.pairs}. Run: bun corpus/skeleton.ts`);
    process.exit(1);
  }

  // Held-out documents only. Exemplars and training material must never be evaluated on.
  const holdout = allPairs.filter((p) => p.split === "holdout" && registers.includes(p.register)).slice(0, n);
  if (!holdout.length) {
    console.error(`No held-out pairs for register(s) ${registers.join(",")}.`);
    process.exit(1);
  }
  const exemplarIds = new Set(corpus.filter((r) => r.split === "exemplar").map((r) => r.sourceId));
  const leaked = holdout.filter((p) => exemplarIds.has(p.sourceId));
  if (leaked.length) {
    console.error(`REFUSING: ${leaked.length} held-out prompt(s) also sit in the exemplar pool.`);
    process.exit(1);
  }

  console.log(`${runId}`);
  console.log(`  arms: ${arms.join(", ")} | registers: ${registers.join(", ")} | n=${holdout.length} | orthography: ${orthography ? "ON" : "off"}\n`);

  mkdirSync(REPORTS, { recursive: true });
  mkdirSync(DATA, { recursive: true });

  const lines: string[] = [`# Eval ${runId}`, ``, `- Preregistration: \`${prereg.sha256}\` committed ${prereg.at}`, `- Arms: ${arms.join(", ")}`, `- n: ${holdout.length} held-out prompts`, `- Orthography layer: ${orthography ? "ON" : "off"}`, `- LLM judge samples per pair: k=${k}${k < 5 ? " (below the preregistered k=5 — noisier majority vote)" : ""}`, ``];

  const impostors = await impostorSet();
  const results: Record<string, { generations: Generation[]; judgements: Judgement[] }> = {};

  for (const armName of arms) {
    console.log(`generating arm ${armName}…`);
    const gens = await generateAll(holdout, { arm: armName, orthography });
    await Bun.write(join(DATA, `${runId}-${armName}-generations.jsonl`), gens.map((g) => JSON.stringify(g)).join("\n") + "\n");

    // The panel: model output against Colin's held-out passages of the same register.
    const colinPassages: Passage[] = holdout.map((p) => ({ text: p.target, documentId: p.sourceId, register: p.register }));
    const modelPassages: Passage[] = gens.map((g) => ({ text: g.text, documentId: g.sourceId, register: g.register }));
    const pairs = buildPairs({ colin: colinPassages, model: modelPassages, seed: 11 });

    console.log(`  judging ${pairs.length} pairs (LLM, k=${k})…`);
    const judgements: Judgement[] = [];
    for (const [i, p] of pairs.entries()) {
      judgements.push(await judgeLlm(p, k));
      if ((i + 1) % 5 === 0) console.log(`    ${i + 1}/${pairs.length}`);
    }
    await Bun.write(join(DATA, `${runId}-${armName}-panel.jsonl`), judgements.map((j) => JSON.stringify(j)).join("\n") + "\n");
    results[armName] = { generations: gens, judgements };
  }

  // ---- report ----
  lines.push(`## Primary endpoint — LLM blind panel`, ``);
  lines.push(`Success is a CI that CONTAINS 0.50. The human panel is the headline endpoint and is run`);
  lines.push(`separately (\`bun eval/panel-human.ts\`); the LLM judge is reliably harsher and the two are`);
  lines.push(`never averaged.`, ``);
  lines.push(`| arm | register | n | clusters | accuracy | 95% CI | indistinguishable |`);
  lines.push(`|---|---|---|---|---|---|---|`);

  for (const armName of arms) {
    for (const reg of registers) {
      const js = results[armName].judgements.filter((j) => j.register === reg);
      if (!js.length) continue;
      const a = accuracy(js);
      lines.push(`| ${armName} | ${reg} | ${a.n} | ${a.clusters} | ${a.accuracy.toFixed(3)} | [${a.ciLow.toFixed(3)}, ${a.ciHigh.toFixed(3)}] | ${a.indistinguishable ? "**yes**" : "no"} |`);
    }
  }

  lines.push(``, `## Stylometric distance`, ``);
  for (const reg of registers) {
    const colinDocs = aggregate(corpus.filter((r) => r.register === reg && r.split !== "holdout").map((r) => r.text));
    const band = withinColinBand(colinDocs, { iterations: 500 });
    const ref = reference(colinDocs.map((d) => features(d)));
    const colinMean = meanVector(colinDocs.map((d) => features(d)));

    lines.push(`### ${reg}`, ``);
    for (const armName of arms) {
      const gens = results[armName].generations.filter((g) => g.register === reg);
      if (!gens.length) continue;
      const modelChunks = aggregate(gens.map((g) => g.text));
      const modelMean = meanVector(modelChunks.map((c) => features(c)));
      const v = judge(delta(modelMean, colinMean, ref), band, `arm ${armName}`);
      lines.push(`- ${v.statement}`);

      if (impostors.length && colinDocs.length) {
        const gi = generalImposters(modelChunks.join("\n\n"), colinDocs, [impostors], { trials: 150 });
        lines.push(`  - General Imposters: ${Number.isFinite(gi.score) ? gi.score.toFixed(3) : "—"} over ${gi.trials} trials (1.0 = always nearer Colin than the LLM impostor set).`);
      }
    }
    lines.push(``);
  }

  lines.push(`## Register contract compliance`, ``);
  lines.push(`| arm | passed contract | retried | mean fit (lower is better) |`);
  lines.push(`|---|---|---|---|`);
  for (const armName of arms) {
    const gens = results[armName].generations.filter((g) => g.validation);
    if (!gens.length) { lines.push(`| ${armName} | — (no contract in this arm) | — | — |`); continue; }
    const ok = gens.filter((g) => g.validation!.ok).length;
    const fits = gens.map((g) => g.validation!.registerFit).filter(Number.isFinite);
    const mean = fits.length ? fits.reduce((a, b) => a + b, 0) / fits.length : Number.NaN;
    lines.push(`| ${armName} | ${ok}/${gens.length} | ${gens.filter((g) => g.retried).length} | ${Number.isFinite(mean) ? mean.toFixed(3) : "—"} |`);
  }

  lines.push(``, `## What would falsify this`, ``);
  lines.push(`See \`eval/preregistration.md\`, committed before this run. In short: a voice claim fails`);
  lines.push(`for a register when Delta sits above that register's within-Colin band, and the`);
  lines.push(`conditioning claim fails when v2's panel CI overlaps v1's.`);

  const reportPath = join(REPORTS, `${runId}.md`);
  await Bun.write(reportPath, lines.join("\n") + "\n");
  append("eval_run_completed", { runId, arms, registers, n: holdout.length, orthography, prereg: prereg.sha256 }, { actor: "system" });

  console.log(`\n${lines.filter((l) => l.startsWith("|") || l.startsWith("- Delta")).join("\n")}`);
  console.log(`\nreport -> ${reportPath}`);
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
