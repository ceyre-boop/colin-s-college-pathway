// BigFuture (CollegeBoard) harvester — Layer 1 source for the scout, browser half.
//
// WHY THIS IS SEPARATE FROM scout.ts:
//   BigFuture's scholarship search (bigfuture.collegeboard.org/scholarship-search) is a
//   login-walled, client-side React app. There is no server-rendered HTML to fetch and no
//   openly-replayable JSON API — the results are loaded once into browser memory (via an
//   AWS-Lambda call that needs SigV4 auth) and then filtered/paginated entirely client-side
//   behind a "Show More Scholarships" button. So it can't use scout.ts's plain fetch()+regex
//   path. This script drives a REAL logged-in browser, applies profile-relevant keyword
//   filters, exhausts the "Show More" pager, and scrapes the rendered cards.
//
// OUTPUT: ~/.claude/memory/bigfuture_raw.json — an array of BigFutureRaw records. scout.ts's
//   harvestBigFuture() reads that file (no network) and maps it into scored Candidates.
//   The file is local + gitignored; if absent, scout.ts just skips the source honestly.
//
// AUTH: reads CB_USERNAME / CB_PASSWORD from .env (Bun auto-loads .env). Login is bot-
//   protected, so we use a PERSISTENT browser profile (USER_DATA_DIR): you log in once in
//   the opened window, the session cookie persists, and every later run reuses it headlessly.
//
// RUN:
//   bunx playwright install chromium   # one time — downloads the browser
//   bun scout/bigfuture-harvest.ts               # headed first run: log in if prompted
//   bun scout/bigfuture-harvest.ts --headless    # once logged in, unattended re-runs
//   bun scout/bigfuture-harvest.ts --keywords "biology,computer science,first generation"
//
// Then feed it into the pipeline:
//   bun scout/scout.ts --emit-app --limit 400    # scores + ranks + regenerates the app data

import { homedir } from "os";
import { join } from "path";

const HOME = homedir();
const OUT_PATH = join(HOME, ".claude", "memory", "bigfuture_raw.json");
const USER_DATA_DIR = join(HOME, ".claude", "memory", "bigfuture-userdata");
const SEARCH_URL = "https://bigfuture.collegeboard.org/scholarship-search";

const args = process.argv.slice(2);
const HEADLESS = args.includes("--headless");
const kwIdx = args.indexOf("--keywords");
// Default keyword set derived from Colin's profile (major, minor, circumstance).
// Each keyword is one client-side filtered pass; results merge by slug across passes.
const KEYWORDS =
  kwIdx >= 0 && args[kwIdx + 1]
    ? args[kwIdx + 1].split(",").map((s) => s.trim()).filter(Boolean)
    : ["biology", "computer science", "biomedical", "first generation", "community college"];

export interface BigFutureRaw {
  name: string;
  slug: string;
  url: string;
  amount: number | null;
  amountVaries: boolean;
  opens: string | null;
  closes: string | null;
  merit: boolean;
  need: boolean;
  essay: boolean;
  status: string;
}

// Runs IN THE PAGE. Reads every rendered scholarship card into a structured record.
// Kept as a standalone function so it can be page.evaluate()'d verbatim — this is the
// exact extractor verified against the live DOM (card = div[class*="StyledCardContainer"],
// name = h3.title, flags parsed from the card's text).
function pageExtractor(): Record<string, unknown>[] {
  const cards = document.querySelectorAll('div[class*="StyledCardContainer"]');
  const seen = new Set<string>();
  const out: Record<string, unknown>[] = [];
  cards.forEach((el) => {
    const a = el.querySelector('a[href*="/scholarships/"]') as HTMLAnchorElement | null;
    if (!a) return;
    const url = a.href.split("?")[0];
    const slug = url.split("/scholarships/")[1];
    if (!slug || seen.has(slug)) return;
    seen.add(slug);
    const h = el.querySelector("h3.title, h3, [class*='title']");
    const name = h ? (h.textContent || "").trim() : slug;
    const t = (el.textContent || "").replace(/\s+/g, " ").trim();
    const amtM = t.match(/Win up to\s*\$([\d,]+)/i);
    const opensM = t.match(/Opens:\s*([A-Za-z0-9 /,]+?)(?:Closes:|Merit|Need|Essay|$)/i);
    const closesM = t.match(/Closes:\s*([A-Za-z0-9 /,]+?)(?:Merit|Need|Essay|Opens:|$)/i);
    out.push({
      name,
      slug,
      url,
      amount: amtM ? parseInt(amtM[1].replace(/,/g, ""), 10) : null,
      amountVaries: /Award Amount Varies/i.test(t),
      opens: opensM ? opensM[1].trim() : null,
      closes: closesM ? closesM[1].trim() : null,
      merit: /Merit-Based\s*Yes/i.test(t),
      need: /Need-Based\s*Yes/i.test(t),
      essay: /Essay Required\s*Yes/i.test(t),
      status: /Deadline Soon/i.test(t)
        ? "deadline-soon"
        : /Not Open Yet/i.test(t)
          ? "not-open"
          : /Accepting Applications/i.test(t)
            ? "accepting"
            : "",
    });
  });
  return out;
}

// Clicks "Show More Scholarships" until it's gone (all client-side pages revealed).
async function loadAllPages(page: any): Promise<number> {
  for (let i = 0; i < 400; i++) {
    const btn = page.getByRole("button", { name: /Show More Scholarships/i });
    if ((await btn.count()) === 0) break;
    await btn.first().scrollIntoViewIfNeeded();
    await btn.first().click();
    await page.waitForTimeout(500);
  }
  return page.locator('div[class*="StyledCardContainer"] a[href*="/scholarships/"]').count();
}

async function main() {
  let chromium: any;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    console.error(
      "Playwright isn't installed. This harvester needs a real browser to reach the\n" +
        "login-walled BigFuture app. Install it once, then re-run:\n\n" +
        "  bun add -d playwright && bunx playwright install chromium\n",
    );
    process.exit(1);
  }

  const ctx = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: HEADLESS,
    viewport: { width: 1440, height: 900 },
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());

  await page.goto(SEARCH_URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);

  // Login check: the header greets "Hi, <name>" when authenticated.
  const loggedIn = await page.locator("text=/Hi,\\s*\\w/").count();
  if (!loggedIn) {
    if (HEADLESS) {
      console.error(
        "Not logged in and running headless. Run once WITHOUT --headless, sign in with your\n" +
          "College Board account (CB_USERNAME / CB_PASSWORD from .env) in the opened window,\n" +
          "then re-run. The persistent profile keeps the session for headless runs after that.",
      );
      await ctx.close();
      process.exit(1);
    }
    console.log(
      `\nPlease sign in to College Board in the opened window` +
        (process.env.CB_USERNAME ? ` (${process.env.CB_USERNAME})` : "") +
        `.\nWaiting up to 3 minutes for the "Hi, <name>" header…`,
    );
    await page.waitForSelector("text=/Hi,\\s*\\w/", { timeout: 180_000 });
    console.log("Signed in — continuing.");
  }

  const bySlug = new Map<string, BigFutureRaw>();
  for (const kw of KEYWORDS) {
    // Drive the keyword filter through the URL — BigFuture reads ?keyword= on load and
    // filters the in-memory set client-side (verified). Fresh nav resets the pager.
    const u = `${SEARCH_URL}?sort=award-amount-high-to-low&keyword=${encodeURIComponent(kw)}`;
    await page.goto(u, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    await loadAllPages(page);
    const recs = (await page.evaluate(pageExtractor)) as BigFutureRaw[];
    for (const r of recs) if (r.slug && !bySlug.has(r.slug)) bySlug.set(r.slug, r);
    console.log(`  "${kw}": ${recs.length} cards (running total ${bySlug.size})`);
  }

  await ctx.close();

  const all = [...bySlug.values()];
  await Bun.write(OUT_PATH, JSON.stringify(all, null, 1));
  console.log(`\nWrote ${all.length} BigFuture scholarships → ${OUT_PATH}`);
  console.log(`Next: bun scout/scout.ts --emit-app --limit 400`);
}

main().catch((err) => {
  console.error(`bigfuture-harvest failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
