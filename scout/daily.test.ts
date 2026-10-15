// The automation is only trustworthy if the chain is complete and the schedule is real.
// These check both without running a 2-hour scoring pass.
import { expect, test, describe } from "bun:test";
import { spawnSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const ROOT = join(import.meta.dir, "..");
const PLIST = join(ROOT, "scout", "launchd", "com.colin.scholarship-scout.plist");

// Spawning a second bun runtime costs ~3s on its own; bun test's 5s default made these two
// tests fail purely because the rest of the suite was running alongside them.
const SPAWN_TIMEOUT = 30_000;

describe("daily automation", () => {
  test("the dry run names every step in the chain", () => {
    const r = spawnSync("bun", ["scout/daily.ts", "--dry"], { cwd: ROOT, encoding: "utf8" });
    expect(r.status).toBe(0);
    for (const s of ["bigfuture harvest", "scout + score", "rescore failed",
                     "regenerate topic bank", "emit essay kits", "deadline digest"]) {
      expect(r.stdout).toContain(s);
    }
  }, SPAWN_TIMEOUT);

  test("a dry run never commits, pushes or writes a lock", () => {
    const r = spawnSync("bun", ["scout/daily.ts", "--dry"], { cwd: ROOT, encoding: "utf8" });
    expect(r.stdout).not.toContain("git push");
    expect(existsSync(join(homedir(), ".claude", "memory", "scholarship-scout", "daily.lock"))).toBe(false);
  }, SPAWN_TIMEOUT);

  test("the launchd plist is well-formed and scheduled daily", () => {
    expect(existsSync(PLIST)).toBe(true);
    expect(spawnSync("plutil", ["-lint", PLIST], { encoding: "utf8" }).status).toBe(0);
    const xml = readFileSync(PLIST, "utf8");
    expect(xml).toContain("StartCalendarInterval");
    expect(xml).toContain("com.colin.scholarship-scout");
    // bun must be reachable from launchd's bare PATH, or every scheduled run dies instantly.
    expect(xml).toMatch(/<key>PATH<\/key>\s*<string>[^<]*\.bun\/bin/);
  });

  test("the chain commits only generated files — never `git add -A`", () => {
    const src = readFileSync(join(ROOT, "scout", "daily.ts"), "utf8");
    expect(src).not.toContain('"add", "-A"');
    expect(src).toContain('"add", "--"');
  });
});
