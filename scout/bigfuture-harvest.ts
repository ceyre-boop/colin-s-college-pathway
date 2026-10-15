// BigFuture (CollegeBoard) harvester — Layer 1 source for the scout, browser half.
//
// WHY THIS IS SEPARATE FROM scout.ts:
//   BigFuture's scholarship search (bigfuture.collegeboard.org/scholarship-search) is a
//   client-side React app. There is no server-rendered HTML to fetch and no
//   openly-replayable JSON API — the results are loaded once into browser memory (via an
//   AWS-Lambda call that needs SigV4 auth) and then filtered/paginated entirely client-side
//   behind a "Show More Scholarships" button. So it can't use scout.ts's plain fetch()+regex
//   path. This script drives a REAL browser, applies profile-relevant keyword
//   filters, exhausts the "Show More" pager, and scrapes the rendered cards.
//
// OUTPUT: ~/.claude/memory/bigfuture_raw.json — an array of BigFutureRaw records. scout.ts's
//   harvestBigFuture() reads that file (no network) and maps it into scored Candidates.
//   The file is local + gitignored; if absent, scout.ts just skips the source honestly.
//
// AUTH: NOT REQUIRED. Measured 2026-10-14: the scholarship search renders its cards for an
//   anonymous visitor (43,513 results, "Show More" pager and all) — signing in only enables
//   the "Saved Scholarships List". And the session does NOT survive a browser restart: after
//   a successful hand sign-in, the persistent profile kept only consent, Adobe-analytics and
//   Akamai bot cookies; no College Board auth cookie was written to disk, so every later
//   headless run came back "not logged in". That combination used to abort the unattended
//   6am run every morning, which is the whole point of the job.
//
//   So a sign-in is now opportunistic: if the profile happens to still be authenticated the
//   run uses it, and otherwise it harvests anonymously and says so. A headed run still offers
//   the sign-in window (worth doing for the saved list), but no longer blocks on it.
//
//   Credentials, when a headed run wants to prompt, come from the macOS Keychain via
//   identity/secrets.ts (services ccp_cb_username / ccp_cb_password; falls back to the old
//   .env vars with a warning). Only the username is ever displayed, as a sign-in hint.
//
// RUN:
//   bunx playwright install chromium   # one time — downloads the browser
//   bun scout/bigfuture-harvest.ts               # headed: offers a sign-in window, 60s
//   bun scout/bigfuture-harvest.ts --headless    # unattended; harvests signed in or not
//   bun scout/bigfuture-harvest.ts --keywords "biology,computer science,first generation"
//
// Then feed it into the pipeline:
//   bun scout/scout.ts --emit-app --limit 400    # scores + ranks + regenerates the app data

import { homedir } from "os";
import { join } from "path";
import { collegeBoardCredentials } from "../identity/secrets";

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

/**
 * May this pass replace the cache outright, or is it a fragment to be merged into it?
 *
 * `reason` is null when the pass is a trustworthy full snapshot — only then do retired
 * listings actually leave the cache. Anything else is treated as partial, because the two
 * ways this has gone wrong both reported success: a run killed by the chain's timeout wrote
 * its 1,811 cards over 6,852, and a run whose pager gave up after one page wrote 2,231 over
 * 6,919.
 */
export function cacheVerdict(
  r: { interrupted: boolean; shortfall: boolean; existing: number; fresh: number },
): { reason: string | null } {
  if (r.interrupted) return { reason: "interrupted" };
  if (r.shortfall) return { reason: "a keyword came back short" };
  // Below two thirds of what is already known is a pass that stopped early, not a catalogue
  // that shrank overnight. The floor keeps a first run (nothing cached) from tripping it.
  if (r.existing > 100 && r.fresh < r.existing * 0.7) return { reason: "far smaller than the cache" };
  return { reason: null };
}

/**
 * A fragment of a harvest folded into what is already cached: every known listing is kept, and
 * this run's record wins for anything it did reach. Exported for the test — the rule it encodes
 * is that an interrupted run must never shrink the cache.
 */
export function mergeHarvest(existing: BigFutureRaw[], fresh: BigFutureRaw[]): BigFutureRaw[] {
  const merged = new Map<string, BigFutureRaw>();
  for (const r of existing ?? []) if (r?.slug) merged.set(r.slug, r);
  for (const r of fresh ?? []) if (r?.slug) merged.set(r.slug, r);
  return [...merged.values()];
}

const CARD_SELECTOR = 'div[class*="StyledCardContainer"] a[href*="/scholarships/"]';

/**
 * Clicks "Show More Scholarships" until it is genuinely gone.
 *
 * A flat 500ms wait after each click was a bet on the page keeping up: when it did not, the
 * next pass found no button yet, called the pager exhausted and returned the first page. That
 * is how a "successful" run brought back 450 cards for a keyword that has 4,634, and then
 * overwrote the cache with them. So: wait for the card count to actually grow, and when the
 * button disappears give the app a second chance to render it before believing the end.
 */
async function loadAllPages(page: any): Promise<number> {
  const cards = () => page.locator(CARD_SELECTOR).count();
  let seen = await cards();

  for (let i = 0; i < 400; i++) {
    const btn = page.getByRole("button", { name: /Show More Scholarships/i });
    if ((await btn.count()) === 0) {
      await page.waitForTimeout(2000); // the app may simply not have re-rendered it yet
      if ((await btn.count()) === 0) break;
    }
    await btn.first().scrollIntoViewIfNeeded();
    await btn.first().click();

    // Wait for the click to land rather than for a fixed interval.
    const grewBy = await (async () => {
      for (let waited = 0; waited < 10_000; waited += 250) {
        await page.waitForTimeout(250);
        const now = await cards();
        if (now > seen) { const d = now - seen; seen = now; return d; }
      }
      return 0;
    })();
    if (!grewBy) break; // a click that adds nothing twice over is the real end of the list
  }
  return seen;
}

/** What the page itself claims it has ("43,513 Results"), so a short harvest is visible. */
async function statedResultCount(page: any): Promise<number | null> {
  try {
    const txt = await page.locator("text=/[\\d,]+\\s+Results/i").first().textContent({ timeout: 5_000 });
    const m = String(txt ?? "").match(/([\d,]+)\s+Results/i);
    return m ? Number(m[1].replace(/,/g, "")) : null;
  } catch {
    return null;
  }
}

// BigFuture is a React app that sometimes self-navigates while `goto` is still in flight, which
// surfaces as net::ERR_ABORTED even though the page goes on to load correctly. Retry, and treat
// "we ended up on the search page with cards rendered" as success regardless of what goto threw.
async function gotoSearch(page: any, url: string, attempts = 3): Promise<void> {
  let lastErr: unknown = null;
  for (let i = 1; i <= attempts; i++) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.waitForTimeout(2000);
      return;
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (!/ERR_ABORTED|Navigation|timeout/i.test(msg)) throw err;
      // Did it actually land despite the abort?
      await page.waitForTimeout(2500);
      if (page.url().includes("scholarship-search")) return;
      console.log(`  nav retry ${i}/${attempts} (${msg.split("\n")[0]})`);
    }
  }
  throw lastErr;
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

  await gotoSearch(page, SEARCH_URL);
  await page.waitForTimeout(2500);

  // Sign-in is opportunistic, never required — see AUTH at the top of this file. The header
  // greets "Hi, <name>" when the profile is still authenticated.
  let loggedIn = (await page.locator("text=/Hi,\\s*\\w/").count()) > 0;
  if (!loggedIn && !HEADLESS) {
    console.log(
      `\nNot signed in. You can sign in to College Board in the opened window` +
        (collegeBoardCredentials().username ? ` (${collegeBoardCredentials().username})` : "") +
        `, or just wait — the search works either way.\nWaiting 60s for a "Hi, <name>" header…`,
    );
    loggedIn = await page
      .waitForSelector("text=/Hi,\\s*\\w/", { timeout: 60_000 })
      .then(() => true)
      .catch(() => false);
  }
  console.log(loggedIn ? "Signed in — continuing." : "Harvesting anonymously (the search is public; only the saved list needs an account).");

  // Everything past the login must run inside try/finally: the persistent profile only flushes
  // its cookies on ctx.close(), so an exception that skipped the close threw away the sign-in
  // the user had just done by hand — which is exactly what happened on the first run.
  const bySlug = new Map<string, BigFutureRaw>();
  let interrupted = false;
  let shortfall = false; // a keyword came back with fewer cards than the page says it has
  try {
  for (const kw of KEYWORDS) {
    // Drive the keyword filter through the URL — BigFuture reads ?keyword= on load and
    // filters the in-memory set client-side (verified). Fresh nav resets the pager.
    const u = `${SEARCH_URL}?sort=award-amount-high-to-low&keyword=${encodeURIComponent(kw)}`;
    await gotoSearch(page, u);
    await loadAllPages(page);
    const recs = (await page.evaluate(pageExtractor)) as BigFutureRaw[];
    for (const r of recs) if (r.slug && !bySlug.has(r.slug)) bySlug.set(r.slug, r);
    const stated = await statedResultCount(page);
    const short = stated != null && recs.length < stated * 0.9 ? ` — the page says ${stated}, SHORT` : "";
    console.log(`  "${kw}": ${recs.length} cards (running total ${bySlug.size})${short}`);
    if (short) shortfall = true;
  }
  } catch (err) {
    // A keyword that blows up should not cost us the keywords that already worked, nor the login.
    interrupted = true;
    console.error(`  harvest interrupted: ${err instanceof Error ? err.message : err}`);
    console.error(`  keeping the ${bySlug.size} cards collected so far.`);
  } finally {
    await ctx.close();
  }

  // A complete pass is an authoritative snapshot and replaces the cache, so retired listings
  // actually leave it. An interrupted pass is a fragment: it gets MERGED into what is already
  // there, because a scholarship does not stop existing just because the run was cut short.
  // (Measured: a run killed by the chain's 30-minute timeout had 1,811 of the 6,852 cards and
  // wrote them straight over the full harvest, while still reporting success.)
  const fresh = [...bySlug.values()];
  if (!fresh.length) {
    console.error("No cards harvested — leaving the existing cache untouched rather than");
    console.error("overwriting a good harvest with an empty one.");
    process.exit(1);
  }

  const existing: BigFutureRaw[] = await Bun.file(OUT_PATH).json().catch(() => []);
  // A pass that came back far smaller than what is already cached is not a catalogue that
  // shrank by two thirds overnight — it is a pass that quietly stopped early. Measured: a run
  // that reported success replaced 6,919 cards with 2,231 because one keyword's pager gave up
  // after the first page.
  const verdict = cacheVerdict({ interrupted, shortfall, existing: existing.length, fresh: fresh.length });

  let all = fresh;
  if (verdict.reason) {
    all = mergeHarvest(existing, fresh);
    console.error(`  ${verdict.reason} — merged instead of replaced: ${existing.length} known + ${fresh.length} fresh = ${all.length}`);
  }

  await Bun.write(OUT_PATH, JSON.stringify(all, null, 1));
  console.log(`\nWrote ${all.length} BigFuture scholarships → ${OUT_PATH}`);
  console.log(`Next: bun scout/scout.ts --emit-app --limit 400`);
  // A harvest that could not be trusted must not report success, or the chain ticks it off.
  if (verdict.reason) process.exit(1);
}

// Only when run as a script: the merge rule above is imported by the test, and importing this
// file must not open a browser.
if (import.meta.main) {
  main().catch((err) => {
    console.error(`bigfuture-harvest failed: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
}
