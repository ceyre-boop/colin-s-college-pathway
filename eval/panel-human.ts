#!/usr/bin/env bun
// The human blind panel — the primary endpoint.
//
// Run late and run once. It is slow, it cannot be repeated on the same rater without the rater
// remembering, and the preregistration fixes n in advance precisely so nobody can keep going until
// the number looks better.
//
// The "what gave it away" field is the most valuable output in the entire harness. Every other
// number tells you whether the system passed; that field tells you what to fix.
//
//   bun eval/panel-human.ts --run=run_2026-... --arm=v2
//   bun eval/panel-human.ts --score=run_2026-...   # score an already-collected panel

import { createInterface } from "readline";
import { join } from "path";
import { assertPreregistered } from "./prereg.ts";
import { buildPairs, accuracy, byRegister, type Judgement, type Passage } from "./panel.ts";
import { PATHS, readJsonl } from "../corpus/schema.ts";
import type { Pair as SeedPair } from "../corpus/skeleton.ts";
import type { Generation } from "./generate.ts";

const DATA = join(import.meta.dir, "data");

function ask(rl: ReturnType<typeof createInterface>, q: string): Promise<string> {
  return new Promise((resolve) => rl.question(q, (a) => resolve(a.trim())));
}

async function score(runId: string, arm: string) {
  const path = join(DATA, `${runId}-${arm}-panel-human.jsonl`);
  const js = await readJsonl<Judgement>(path);
  if (!js.length) {
    console.error(`No human panel at ${path}`);
    process.exit(1);
  }
  const overall = accuracy(js);
  console.log(`\nHuman panel — ${runId} arm ${arm}`);
  console.log(`  n=${overall.n} across ${overall.clusters} source documents`);
  console.log(`  accuracy ${overall.accuracy.toFixed(3)}  95% CI [${overall.ciLow.toFixed(3)}, ${overall.ciHigh.toFixed(3)}]`);
  console.log(`  ${overall.indistinguishable ? "INDISTINGUISHABLE — the CI contains 0.50." : "DISTINGUISHABLE — raters separated them reliably."}`);

  for (const [reg, a] of Object.entries(byRegister(js))) {
    console.log(`    ${reg.padEnd(12)} ${a.accuracy.toFixed(3)} [${a.ciLow.toFixed(3)}, ${a.ciHigh.toFixed(3)}] n=${a.n}`);
  }

  const tells = js.filter((j) => j.tell).map((j) => `  ${j.correct ? "✓" : "✗"} ${j.tell}`);
  if (tells.length) {
    console.log(`\nWhat gave it away (the most useful output here — read all of it):`);
    console.log(tells.join("\n"));
  }
}

async function main() {
  assertPreregistered();

  const runId = process.argv.find((a) => a.startsWith("--run="))?.split("=")[1];
  const scoreOnly = process.argv.find((a) => a.startsWith("--score="))?.split("=")[1];
  const arm = process.argv.find((a) => a.startsWith("--arm="))?.split("=")[1] ?? "v2";

  if (scoreOnly) return score(scoreOnly, arm);
  if (!runId) {
    console.error(`Usage: bun eval/panel-human.ts --run=<runId> [--arm=v2]`);
    console.error(`Run ids are the filenames under eval/data/.`);
    process.exit(1);
  }

  const gens = await readJsonl<Generation>(join(DATA, `${runId}-${arm}-generations.jsonl`));
  const pairsSrc = await readJsonl<SeedPair>(PATHS.pairs);
  if (!gens.length) {
    console.error(`No generations for ${runId} arm ${arm}.`);
    process.exit(1);
  }

  const byId = new Map(pairsSrc.map((p) => [p.sourceId, p]));
  const colin: Passage[] = gens
    .map((g) => byId.get(g.sourceId))
    .filter((p): p is SeedPair => Boolean(p))
    .map((p) => ({ text: p.target, documentId: p.sourceId, register: p.register }));
  const model: Passage[] = gens.map((g) => ({ text: g.text, documentId: g.sourceId, register: g.register }));

  const pairs = buildPairs({ colin, model, seed: 11 });
  console.log(`\nHuman blind panel — ${pairs.length} pairs, arm ${arm}.`);
  console.log(`For each: which passage did Colin write? There is exactly one of each.`);
  console.log(`Answer a or b, then 1-5 for confidence, then what gave it away.\n`);

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const judgements: Judgement[] = [];

  for (const [i, p] of pairs.entries()) {
    console.log(`\n${"=".repeat(78)}\nPair ${i + 1}/${pairs.length}  [${p.register}]\n${"=".repeat(78)}`);
    console.log(`\n--- A ---\n${p.a}\n`);
    console.log(`--- B ---\n${p.b}\n`);

    let guess = "";
    while (guess !== "a" && guess !== "b") guess = (await ask(rl, "Which did Colin write? (a/b) ")).toLowerCase();
    const conf = Number(await ask(rl, "Confidence 1-5: ")) || 3;
    const tell = await ask(rl, "What gave it away? ");

    const g = guess.toUpperCase() as "A" | "B";
    judgements.push({
      pairId: p.id,
      register: p.register,
      guess: g,
      correct: g === p.colinSide,
      confidence: conf,
      tell,
      colinDocumentId: p.colinDocumentId,
    });
    // Deliberately NOT telling the rater whether they were right — feedback would train them
    // across the run and the later pairs would stop being blind.
  }
  rl.close();

  const out = join(DATA, `${runId}-${arm}-panel-human.jsonl`);
  await Bun.write(out, judgements.map((j) => JSON.stringify(j)).join("\n") + "\n");
  console.log(`\nrecorded -> ${out}`);
  await score(runId, arm);
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
