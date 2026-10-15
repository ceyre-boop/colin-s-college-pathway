// The automation is only trustworthy if the chain is complete and the schedule is real.
// These check both without running a 2-hour scoring pass.
import { expect, test, describe, afterEach } from "bun:test";
import { spawnSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, rmSync, appendFileSync, statSync } from "fs";
import { join } from "path";
import { homedir, tmpdir } from "os";

const ROOT = join(import.meta.dir, "..");
const PLIST = join(ROOT, "scout", "launchd", "com.colin.scholarship-scout.plist");

// Importing daily.ts must not run the chain — the entrypoint is guarded by import.meta.main.
const { appendedSince } = await import("./daily");

// Spawning a second bun runtime costs ~3s on its own; bun test's 5s default made these two
// tests fail purely because the rest of the suite was running alongside them.
const SPAWN_TIMEOUT = 30_000;
const LOCK = join(homedir(), ".claude", "memory", "scholarship-scout", "daily.lock");

describe("reading a step's output back out of the log", () => {
  // The log is full of multi-byte characters (→ ✓ —) and the offset is a byte count from
  // statSync, so decoding first and slicing by that offset overshoots — which is how every
  // short step in the 02:16 run reported "(no output)" while having printed a summary line.
  const tmp = join(tmpdir(), `daily-log-test-${process.pid}.log`);

  afterEach(() => rmSync(tmp, { force: true }));

  test("multi-byte characters before the offset do not eat the output", () => {
    const header = "[02:16:19] → bigfuture harvest ✓ — done\n";
    writeFileSync(tmp, header);
    const at = statSync(tmp).size;
    expect(at).toBeGreaterThan(header.length); // the whole point: bytes ≠ characters
    appendFileSync(tmp, "Rebuilt 11 applications\n");
    expect(appendedSince(tmp, at)).toBe("Rebuilt 11 applications");
  });

  test("a step that printed nothing reads back as empty", () => {
    writeFileSync(tmp, "→ ✓\n");
    expect(appendedSince(tmp, statSync(tmp).size)).toBe("");
  });

  test("multi-byte output is decoded whole, not cut mid-character", () => {
    writeFileSync(tmp, "→ ✓\n");
    const at = statSync(tmp).size;
    appendFileSync(tmp, "  ✓ 150 scholarships — 103 need new essays\n");
    expect(appendedSince(tmp, at)).toBe("✓ 150 scholarships — 103 need new essays");
  });

  test("a log that vanished is no output rather than a crash", () => {
    expect(appendedSince(join(tmpdir(), "definitely-not-here.log"), 0)).toBe("");
  });
});

describe("daily automation", () => {
  test("the dry run names every step in the chain", () => {
    const r = spawnSync("bun", ["scout/daily.ts", "--dry"], { cwd: ROOT, encoding: "utf8" });
    expect(r.status).toBe(0);
    for (const s of ["bigfuture harvest", "scout + score", "rescore failed",
                     "regenerate topic bank", "emit essay kits",
                     // the digest reads a gitignored projection, so the replay has to precede it
                     "rebuild state projection", "deadline digest"]) {
      expect(r.stdout).toContain(s);
    }
  }, SPAWN_TIMEOUT);

  test("a dry run never commits, pushes or writes a lock", () => {
    const r = spawnSync("bun", ["scout/daily.ts", "--dry"], { cwd: ROOT, encoding: "utf8" });
    expect(r.stdout).not.toContain("git push");
    expect(existsSync(LOCK)).toBe(false);
  }, SPAWN_TIMEOUT);

  test("a dry run does not release a real run's lock", () => {
    // It used to: this suite spawns dry runs, and running it while the 6am job was mid-harvest
    // deleted that job's lock, which is the one thing stopping two runs interleaving their
    // writes to the ranked list.
    const owner = String(process.pid);
    const existing = existsSync(LOCK) ? readFileSync(LOCK, "utf8") : null;
    try {
      writeFileSync(LOCK, owner);
      spawnSync("bun", ["scout/daily.ts", "--dry"], { cwd: ROOT, encoding: "utf8" });
      expect(existsSync(LOCK)).toBe(true);
      expect(readFileSync(LOCK, "utf8")).toBe(owner);
    } finally {
      if (existing === null) rmSync(LOCK, { force: true });
      else writeFileSync(LOCK, existing);
    }
  }, SPAWN_TIMEOUT);

  test("the launchd plist is well-formed and scheduled daily", () => {
    expect(existsSync(PLIST)).toBe(true);
    expect(spawnSync("plutil", ["-lint", PLIST], { encoding: "utf8" }).status).toBe(0);
    const xml = readFileSync(PLIST, "utf8");
    expect(xml).toContain("StartCalendarInterval");
    expect(xml).toContain("com.colin.scholarship-scout");
    // bun must be reachable from launchd's bare PATH, or every scheduled run dies instantly.
    expect(xml).toMatch(/<key>PATH<\/key>\s*<string>[^<]*\.bun\/bin/);
    // ...and so must `claude`: scoring shells out to it via PAI's Inference.ts, and its absence
    // failed every batch of the first real scheduled run while the chain still reported success.
    const path = xml.match(/<key>PATH<\/key>\s*<string>([^<]*)<\/string>/)?.[1] ?? "";
    expect(path.split(":")).toContain(`${homedir()}/.local/bin`);
  });

  test("the chain commits only generated files — never `git add -A`", () => {
    const src = readFileSync(join(ROOT, "scout", "daily.ts"), "utf8");
    expect(src).not.toContain('"add", "-A"');
    expect(src).toContain('"add", "--"');
  });

  test("the run report is written before it is staged", () => {
    // `git add` fails outright on a pathspec that matches nothing, staging NOTHING. LAST_RUN.md
    // is in TRACKED, so writing it after the add made the first real scheduled run report
    // "nothing changed — no commit" while sitting on a full set of regenerated files.
    const src = readFileSync(join(ROOT, "scout", "daily.ts"), "utf8");
    expect(src.indexOf("writeReport(true); // before staging")).toBeGreaterThan(0);
    expect(src.indexOf("writeReport(true); // before staging")).toBeLessThan(src.indexOf('"add", "--"'));
  });

  test("a failed `git add` is reported, not read as \"nothing to commit\"", () => {
    const src = readFileSync(join(ROOT, "scout", "daily.ts"), "utf8");
    expect(src).toContain("add.status !== 0");
    expect(src).toContain("git add failed");
  });
});
