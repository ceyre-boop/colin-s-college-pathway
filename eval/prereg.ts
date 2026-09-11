#!/usr/bin/env bun
// Pre-registration, enforced.
//
// A band chosen after seeing the result is not a band, and a preregistration nobody checks is
// decoration. So this does three things:
//
//   1. Generates eval/preregistration.md from the CURRENT baseline only — bands computed before any
//      model output exists.
//   2. Commits its sha256 into state/events.jsonl, where the existing hash chain makes a later edit
//      detectable by state/verify.
//   3. Gives eval/run.ts a hard gate: assertPreregistered() throws unless the file on disk still
//      hashes to what was committed. THIS is the preregistration. Without the refusal, the document
//      is a wish.
//
//   bun eval/prereg.ts --write    # draft the document from baseline
//   bun eval/prereg.ts --commit   # hash it into the event log (raises the sign-off checkpoint)
//   bun eval/prereg.ts --check    # verify the file still matches what was committed

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { append, readAll } from "../state/log.ts";
import { raise } from "../state/queue.js";
import { functionWordsHash, functionWords } from "./stylometry.ts";
import { withinColinBand, MIN_DOCS_FOR_BAND, aggregate } from "./delta.ts";
import { PATHS, readJsonl, REGISTERS, type CorpusRecord, type Register } from "../corpus/schema.ts";

export const PREREG_PATH = join(import.meta.dir, "preregistration.md");

export function sha256File(path: string): string {
  const h = new Bun.CryptoHasher("sha256");
  h.update(readFileSync(path));
  return h.digest("hex");
}

export interface CommittedPrereg {
  sha256: string;
  at: string;
  functionWordsHash: string;
}

/** What was committed to the log, if anything. */
export function committed(): CommittedPrereg | null {
  const ev = readAll().filter((e) => e.type === "eval_preregistered");
  if (!ev.length) return null;
  const last = ev[ev.length - 1];
  return {
    sha256: String(last.data.sha256),
    at: last.at,
    functionWordsHash: String(last.data.functionWordsHash ?? ""),
  };
}

/**
 * The gate. eval/run.ts calls this before doing anything.
 * Throws — never warns — because a warning would be ignored exactly when it matters.
 */
export function assertPreregistered(): CommittedPrereg {
  const c = committed();
  if (!c) {
    throw new Error(
      `No preregistration committed. Run: bun eval/prereg.ts --write && bun eval/prereg.ts --commit\n` +
        `Bands must be fixed before any result exists, or they are not bands.`,
    );
  }
  if (!existsSync(PREREG_PATH)) {
    throw new Error(`${PREREG_PATH} is missing but a preregistration was committed at ${c.at}.`);
  }
  const now = sha256File(PREREG_PATH);
  if (now !== c.sha256) {
    throw new Error(
      `REFUSING TO RUN: eval/preregistration.md has changed since it was committed.\n` +
        `  committed ${c.at}: ${c.sha256}\n` +
        `  on disk now:       ${now}\n\n` +
        `The bands were altered after being fixed. Either restore the committed version, or start a\n` +
        `new preregistered run deliberately and record why the previous one was abandoned.`,
    );
  }
  const fw = functionWordsHash();
  if (c.functionWordsHash && fw !== c.functionWordsHash) {
    throw new Error(
      `REFUSING TO RUN: eval/function-words.json changed since preregistration.\n` +
        `  committed: ${c.functionWordsHash}\n  now:       ${fw}\n\n` +
        `Choosing the feature list after seeing results is p-hacking, whether or not it was intended.`,
    );
  }
  return c;
}

/** Baseline documents per register, from the verified corpus, excluding held-out material. */
export async function baselineByRegister(): Promise<Record<string, string[]>> {
  const rows = await readJsonl<CorpusRecord>(PATHS.verified);
  const out: Record<string, string[]> = {};
  for (const reg of REGISTERS) {
    out[reg] = rows.filter((r) => r.register === reg && r.split !== "holdout").map((r) => r.text);
  }
  return out;
}

export async function draft(): Promise<string> {
  const baseline = await baselineByRegister();
  const lines: string[] = [];

  lines.push(`# Colin-AI — preregistration`);
  lines.push(``);
  lines.push(`Written before any model output exists. Its sha256 is committed to \`state/events.jsonl\``);
  lines.push(`as an \`eval_preregistered\` event; \`eval/run.ts\` refuses to run if this file changes.`);
  lines.push(``);
  lines.push(`- Drafted: ${new Date().toISOString()}`);
  lines.push(`- Function-word list sha256: \`${functionWordsHash()}\` (${functionWords().length} words, frozen)`);
  lines.push(``);
  lines.push(`## Primary endpoint`);
  lines.push(``);
  lines.push(`Human blind-panel accuracy at telling Colin's writing from the system's, per register.`);
  lines.push(`Random is 0.50. **Success = the cluster-bootstrap 95% CI contains 0.50.** Passages are`);
  lines.push(`300-500 words; the bootstrap resamples SOURCE DOCUMENTS, not passages, because passages`);
  lines.push(`from one document are not independent.`);
  lines.push(``);
  lines.push(`## Secondary endpoints, in order`);
  lines.push(``);
  lines.push(`1. Burrows's Delta against the within-Colin split-half band (below).`);
  lines.push(`2. General Imposters score, using the 20 LLM-generated essays in \`scholarship_essays/\``);
  lines.push(`   as the impostor set — this directly tests whether output is distinguishable from an`);
  lines.push(`   LLM conditioned on \`voice_profile.md\`.`);
  lines.push(`3. LLM-judge panel accuracy. Reported separately from the human panel and never averaged`);
  lines.push(`   with it; the judge prompt must not contain \`voice_profile.md\`, or it detects the`);
  lines.push(`   fingerprint it was handed.`);
  lines.push(`4. Register bleed rate (Phase 5), per off-diagonal cell.`);
  lines.push(``);
  lines.push(`## Within-Colin bands (computed from baseline only)`);
  lines.push(``);
  lines.push(`| register | documents | band low | median | band high | usable |`);
  lines.push(`|---|---|---|---|---|---|`);

  const bands: Record<string, unknown> = {};
  for (const reg of REGISTERS) {
    const docs = aggregate(baseline[reg] ?? []);
    const b = withinColinBand(docs, { iterations: 500 });
    bands[reg] = b;
    const f = (x: number) => (Number.isFinite(x) ? x.toFixed(3) : "—");
    lines.push(
      `| ${reg} | ${b.documents} | ${f(b.low)} | ${f(b.median)} | ${f(b.high)} | ${b.underpowered ? `no — needs ≥${MIN_DOCS_FOR_BAND}` : "yes"} |`,
    );
  }

  lines.push(``);
  lines.push(`A register marked "no" cannot falsify anything. Claims about it are unavailable, and`);
  lines.push(`saying so is the honest result rather than a gap to be filled in later.`);
  lines.push(``);
  lines.push(`## Falsification rules`);
  lines.push(``);
  lines.push(`**The voice claim, per register.** Delta(system output ↔ Colin baseline) falls inside the`);
  lines.push(`within-Colin 95% band above. If the point estimate exceeds the band's upper bound, the`);
  lines.push(`claim is FALSE for that register and will be reported as false.`);
  lines.push(``);
  lines.push(`**The conditioning claim.** Arm v2 (voice-conditioned) beats arm v1 (the original`);
  lines.push(`six-line prompt) on the primary endpoint — panel accuracy closer to 0.50 — with`);
  lines.push(`non-overlapping cluster-bootstrap CIs. Overlapping CIs mean the conditioning did not`);
  lines.push(`demonstrably help, whatever the point estimates look like.`);
  lines.push(``);
  lines.push(`**The fine-tune, if it is ever built.** Demoted to non-default unless ALL THREE hold:`);
  lines.push(`(a) it beats arm v2 on the primary endpoint with non-overlapping CIs; (b) it passes the`);
  lines.push(`memorization check — max 8-gram overlap with training data under 15 consecutive tokens;`);
  lines.push(`(c) its Delta lies inside the within-Colin band on a held-out register. Failing any one,`);
  lines.push(`the retrieval arm stays default and the adapter is archived, not deleted.`);
  lines.push(`Additionally: if the orthographic-noise layer alone accounts for more than 50% of the`);
  lines.push(`fine-tune's improvement, the fine-tune contributed nothing and is demoted regardless.`);
  lines.push(``);
  lines.push(`**Register control (Phase 5).** Success requires all of: bleed rate ≤10% in every`);
  lines.push(`off-diagonal cell; model between-register Delta inside the 95% CI of Colin's own`);
  lines.push(`between-register Delta; no single marker more than 1.5 sd from that register's measured`);
  lines.push(`baseline; and all of the above holding when the exemplar register is deliberately`);
  lines.push(`mismatched, which is the actual hard case.`);
  lines.push(``);
  lines.push(`## Stopping rule`);
  lines.push(``);
  lines.push(`n is fixed in advance per run and stated on the command line. No peeking, no adding`);
  lines.push(`passages after seeing the rate, no dropping a register because its number came out badly.`);
  lines.push(`A register that fails is a finding and gets reported as one.`);
  lines.push(``);
  lines.push(`## Known limitations, recorded now rather than discovered later`);
  lines.push(``);
  lines.push(`- The academic register rests on very few documents. Whatever it reports, it reports weakly.`);
  lines.push(`- The misspelling-rate finding (academic ≈ 6.6/1k vs ≈ 0.9/1k in chat registers) currently`);
  lines.push(`  rests on ONE document. It is a hypothesis here, not a result.`);
  lines.push(`- Delta is computed on ≥1,000-word aggregates. At 400-word essay length it is noisy, which`);
  lines.push(`  is why General Imposters is reported alongside it.`);
  lines.push(`- The corpus is dominated by chat-register text. Conclusions about raw register are much`);
  lines.push(`  better supported than conclusions about anything Colin writes deliberately.`);
  lines.push(``);

  return lines.join("\n");
}

if (import.meta.main) {
  const argv = process.argv;

  if (argv.includes("--write")) {
    const c = committed();
    if (c && existsSync(PREREG_PATH) && sha256File(PREREG_PATH) === c.sha256) {
      console.error(`REFUSING: a preregistration is already committed (${c.at}).`);
      console.error(`Overwriting it would rewrite bands that are already fixed.`);
      process.exit(1);
    }
    await Bun.write(PREREG_PATH, await draft());
    console.log(`wrote ${PREREG_PATH}`);
    console.log(`  sha256 ${sha256File(PREREG_PATH)}`);
    console.log(`\nRead it, then: bun eval/prereg.ts --commit`);
  } else if (argv.includes("--commit")) {
    if (!existsSync(PREREG_PATH)) {
      console.error(`No ${PREREG_PATH}. Run: bun eval/prereg.ts --write`);
      process.exit(1);
    }
    const sha = sha256File(PREREG_PATH);
    const prior = committed();
    if (prior?.sha256 === sha) {
      console.log(`already committed at ${prior.at} — unchanged.`);
      process.exit(0);
    }
    if (prior) {
      console.error(`REFUSING: a different preregistration was committed at ${prior.at}.`);
      console.error(`  committed: ${prior.sha256}\n  now:       ${sha}`);
      process.exit(1);
    }
    append("eval_preregistered", { file: "eval/preregistration.md", sha256: sha, functionWordsHash: functionWordsHash() }, { actor: "system" });
    raise({
      type: "EVAL_PREREGISTRATION_REVIEW",
      context: { discriminator: sha.slice(0, 12) },
      evidenceRefs: { prereg_sha256: sha, bands: "see eval/preregistration.md", primary_endpoint: "human blind-panel accuracy CI contains 0.50" },
      actor: "agent",
    });
    console.log(`committed ${sha} to the event log, and raised EVAL_PREREGISTRATION_REVIEW for sign-off.`);
  } else {
    try {
      const c = assertPreregistered();
      console.log(`preregistration OK — committed ${c.at}, sha256 ${c.sha256}`);
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  }
}
