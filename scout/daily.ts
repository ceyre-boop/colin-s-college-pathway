// The daily run — one command that takes the pipeline from "nothing new" to "new topics
// in the bank, new finds on the dashboard, pushed."
//
// This is the automation Colin asked for. What it does NOT do, by his own rule and because
// providers require a personal account plus signed attestations: submit anything. The chain
// ends at a ranked list, a topic bank, and a deadline digest. He clicks every submit.
//
// Every step reports honestly. A failing step is logged with its real stderr and the chain
// continues where that's safe (a failed deadline digest shouldn't lose a good scout run);
// a failed scout aborts, because everything downstream would just re-publish stale data.
//
// Usage:
//   bun scout/daily.ts                 # full chain, commit + push
//   bun scout/daily.ts --no-push       # everything but the push
//   bun scout/daily.ts --limit 1200    # smaller scoring budget (default 5000 = whole harvest)
//   bun scout/daily.ts --dry           # print the plan, run nothing

import { spawnSync } from "child_process";
import { appendFileSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const ROOT = join(import.meta.dir, "..");
const LOG_DIR = join(homedir(), ".claude", "memory", "scholarship-scout");
const REPORT = join(ROOT, "scholarship_essays", "LAST_RUN.md");

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);
const val = (f: string, d: string) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

const DRY = has("--dry");
const PUSH = !has("--no-push");
const LIMIT = val("--limit", "5000");

const stamp = new Date().toISOString();
const day = stamp.slice(0, 10);
const logPath = join(LOG_DIR, `daily-${day}.log`);

function log(line: string) {
  const l = `[${new Date().toISOString().slice(11, 19)}] ${line}`;
  console.log(l);
  if (!DRY) {
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(logPath, l + "\n");
  }
}

interface StepResult { name: string; ok: boolean; detail: string; skipped?: boolean }
const results: StepResult[] = [];

// Run a step. `fatal` means the rest of the chain is meaningless without it.
function step(name: string, cmd: string, args: string[], opts: { fatal?: boolean; timeoutMin?: number } = {}): boolean {
  log(`→ ${name}: ${cmd} ${args.join(" ")}`);
  if (DRY) { results.push({ name, ok: true, detail: "dry run", skipped: true }); return true; }

  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: (opts.timeoutMin ?? 120) * 60_000,
    maxBuffer: 64 * 1024 * 1024,
  });

  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
  if (out) appendFileSync(logPath, out + "\n");

  const ok = r.status === 0;
  // The last non-empty line is the summary these scripts print; that's what belongs in the report.
  const lastLine = out.split("\n").filter((l) => l.trim()).pop() ?? "(no output)";
  const detail = ok ? lastLine : (r.error ? String(r.error.message) : lastLine).slice(0, 400);

  results.push({ name, ok, detail });
  log(ok ? `  ✓ ${detail}` : `  ✗ FAILED — ${detail}`);

  if (!ok && opts.fatal) {
    log(`ABORTING: "${name}" is fatal — everything downstream would publish stale data.`);
    finish(false);
    releaseLock();
    process.exit(1);
  }
  return ok;
}

// Pull the headline numbers out of the run's JSON so the report says something real.
function foundSummary(): string {
  const p = join(homedir(), "scholarships_found.json");
  if (!existsSync(p)) return "no scholarships_found.json";
  try {
    const d = JSON.parse(readFileSync(p, "utf8"));
    const bad = (d.sources ?? [])
      .filter((s: any) => s.status && s.status !== "ok")
      .map((s: any) => `${s.name ?? s.site}:${s.status}`);
    return [
      `${(d.ranked ?? []).length} ranked`,
      `${(d.low_match ?? []).length} low-match`,
      `${(d.removed_scams ?? []).length} scam-flagged`,
      bad.length ? `sources not ok → ${bad.join(", ")}` : "all sources ok",
    ].join(" · ");
  } catch (e) {
    return `unreadable: ${String(e)}`;
  }
}

// The report has to be on disk BEFORE the commit, or `git add` is handed a path that does not
// exist yet — which on the first scheduled run made the whole `git add` fail (a pathspec that
// matches nothing fails the command and stages nothing), and the chain then reported the
// perfectly honest-looking "nothing changed — no commit" while sitting on a full set of
// regenerated files. The commit/push rows land in the log and the spoken result instead.
function writeReport(complete: boolean) {
  const L: string[] = [];
  L.push("# Last automated run");
  L.push("");
  L.push(`> ${stamp} · \`bun scout/daily.ts\` · ${complete ? "completed" : "**ABORTED**"}`);
  L.push(`> Log: \`${logPath.replace(homedir(), "~")}\``);
  L.push("");
  L.push(`**Harvest:** ${foundSummary()}`);
  L.push("");
  L.push("| Step | Result | Detail |");
  L.push("|------|--------|--------|");
  for (const r of results) {
    const mark = r.skipped ? "skipped" : r.ok ? "ok" : "**FAILED**";
    L.push(`| ${r.name} | ${mark} | ${r.detail.replace(/\|/g, "\\|").slice(0, 200)} |`);
  }
  L.push("");
  L.push("Nothing here submits an application. The chain ends at a ranked list, a topic bank,");
  L.push("and a deadline digest — every submit is Colin's own click.");
  L.push("");
  L.push("_This file is written before the run commits, so it is part of that commit; whether the");
  L.push("commit and push succeeded is in the log above and in `git log`._");
  L.push("");
  if (!DRY) writeFileSync(REPORT, L.join("\n"));
}

function announce(complete: boolean) {
  const failed = results.filter((r) => !r.ok).map((r) => r.name);
  log(failed.length ? `done with failures: ${failed.join(", ")}` : "done, all steps ok");

  // Speak the result if the PAI notify daemon is up; silence if it isn't (never fatal).
  const msg = complete
    ? (failed.length
        ? `Scholarship run finished with ${failed.length} failed step${failed.length === 1 ? "" : "s"}.`
        : `Scholarship run done. ${foundSummary().split(" · ")[0]}.`)
    : "Scholarship run aborted — the scout failed.";
  spawnSync("curl", ["-s", "-m", "5", "-X", "POST", "http://localhost:31337/notify",
    "-H", "Content-Type: application/json",
    "-d", JSON.stringify({ message: msg, voice_enabled: false })], { encoding: "utf8" });
}

function finish(complete: boolean) {
  writeReport(complete);
  announce(complete);
}

// Two runs at once would interleave writes to ~/scholarships_found.json and leave a
// half-merged ranking behind. A stale lock (process gone) is reclaimed rather than
// blocking forever — a crashed 3am run must not silently disable every later one.
const LOCK = join(LOG_DIR, "daily.lock");

function acquireLock(): boolean {
  mkdirSync(LOG_DIR, { recursive: true });
  if (existsSync(LOCK)) {
    const pid = Number(readFileSync(LOCK, "utf8").trim());
    const alive = Number.isFinite(pid) && (() => { try { process.kill(pid, 0); return true; } catch { return false; } })();
    if (alive) { log(`another daily run (pid ${pid}) is active — exiting without touching anything`); return false; }
    log(`reclaiming stale lock from dead pid ${pid}`);
  }
  writeFileSync(LOCK, String(process.pid));
  return true;
}

function releaseLock() {
  // A dry run never took the lock, so it must never give one back: `bun test` spawns two dry
  // runs, and while a real scheduled run was in flight they deleted its lock out from under it,
  // leaving the next run free to start concurrently and interleave writes to the ranked list.
  if (DRY) return;
  try { if (existsSync(LOCK)) rmSync(LOCK); } catch { /* nothing useful to do */ }
}

function main() {
  log(`daily run start — limit ${LIMIT}, push ${PUSH ? "on" : "off"}${DRY ? ", DRY" : ""}`);
  if (!DRY && !acquireLock()) process.exit(0);

  // 1. BigFuture needs a logged-in real browser. Headless works only once a profile exists,
  //    so an unattended run attempts it and accepts failure — scout.ts reads the cache it
  //    leaves behind and honestly reports the source as empty if there isn't one.
  step("bigfuture harvest", "bun", ["scout/bigfuture-harvest.ts", "--headless"], { timeoutMin: 30 });

  // 2. The scout itself. Fatal: without a fresh ranked list the rest is stale republishing.
  step("scout + score + emit app data", "bun",
    ["scout/scout.ts", "--limit", LIMIT, "--emit-app"], { fatal: true, timeoutMin: 180 });

  // 3. Timed-out scoring batches default to a 50% match, which pollutes the ranking. Chase them.
  step("rescore failed batches", "bun",
    ["scout/scout.ts", "--rescore-failed", "--emit-app"], { timeoutMin: 60 });

  // 4. The topic bank — what Colin actually asked for: every essay he owes, in one file.
  step("regenerate topic bank", "bun", ["scout/topic-bank.ts"], { timeoutMin: 5 });

  // 5. Bundle essays + form triage for the dashboard.
  step("emit essay kits", "bun", ["scout/emit-essays.ts"], { timeoutMin: 5 });

  // 6. The deadline digest reads state/projection.json, which is a fold over the event log and
  //    is gitignored — so on any machine that has not replayed the log it simply does not exist,
  //    and the digest printed "run `bun state/rebuild.ts` first" every morning. Replay it here.
  step("rebuild state projection", "bun", ["state/rebuild.ts"], { timeoutMin: 5 });
  step("deadline digest", "bun", ["state/deadlines.ts", "--days", "45"], { timeoutMin: 5 });

  // 7. Commit only the files this chain regenerates — never `git add -A`, which would sweep
  //    up whatever half-finished work is sitting in the tree.
  const TRACKED = [
    "src/data/scoutFound.js",
    "src/data/essays.js",
    "scholarship_essays/TOPIC_BANK.md",
    "scholarship_essays/LAST_RUN.md",
  ];
  if (!DRY) {
    writeReport(true); // before staging — TRACKED includes this file
    const add = spawnSync("git", ["add", "--", ...TRACKED], { cwd: ROOT, encoding: "utf8" });
    if (add.status !== 0) {
      // Never let a failed `git add` masquerade as "nothing to commit".
      const why = `${add.stderr ?? ""}${add.error ? ` ${add.error.message}` : ""}`.trim() || `exit ${add.status}`;
      log(`  ✗ git add failed — ${why}`);
      results.push({ name: "commit", ok: false, detail: `git add failed: ${why}`.slice(0, 400) });
    }
    const dirty = spawnSync("git", ["diff", "--cached", "--name-only"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
    if (!dirty) {
      log("nothing changed — no commit");
      results.push({ name: "commit", ok: true, detail: "no changes to commit", skipped: true });
    } else {
      const ok = step("commit", "git", ["commit", "-m",
        `scout: automated run ${day}\n\n${foundSummary()}\n\nGenerated by scout/daily.ts. Nothing submitted.`]);
      if (ok && PUSH) step("push", "git", ["push", "origin", "HEAD"], { timeoutMin: 5 });
      else if (ok) results.push({ name: "push", ok: true, detail: "--no-push", skipped: true });
    }
  }

  if (DRY) writeReport(true);
  announce(true);
  releaseLock();
}

main();
