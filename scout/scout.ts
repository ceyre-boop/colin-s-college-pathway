// Scholarship Scout — Layer 1 (discover) + Layer 2 (score/filter) of the automation stack.
// Finds scholarships matching the profile at ~/.claude/memory/scholarship_profile.json,
// scores each with Claude (eligibility match, effort, legitimacy), and writes a ranked
// list to ~/scholarships_found.json. Layer 3 (form filling) stays with Claude for Chrome
// per ScholarshipAutomation.md — nothing here submits anything.
//
// Sources are split honestly:
//   - HTTP-scrapeable: CareerOneStop (US DOL database, server-rendered, paginated),
//     Scholarships360 (server-rendered article cards), Unigo (server-rendered WP
//     directory cards). Fetched directly.
//   - Login-walled / client-side apps: Bold.org, Fastweb, Scholarships.com, Niche, Appily
//     (cappex.com redirects here), Petersons (Vue app over an authenticated JSON:API),
//     Raise.me (login-walled micro-scholarships), Sallie (myscholly.com redirects here —
//     Scholly was sunset into Sallie's search). The four probe adapters below re-fetch
//     these every run and report an honest blocked/empty status instead of pretending an
//     HTTP fetch would work; they all stay on the needs_browser worklist.
//
// Usage: bun scout/scout.ts [--no-score] [--emit-app] [--top N] [--limit N]
//                           [--from-cache] [--rescore-failed] [--rescore-all]
//
// Scores are remembered between runs (scout/score-cache.ts), so only candidates the scout has
// never scored before cost anything. --limit therefore caps NEW candidates, not the whole list.
//   --no-score        skip Claude scoring (rank by amount only; no API key needed)
//   --emit-app        also print top finds in the src/data/defaults.js scholarship shape
//   --top N           how many ranked entries in the console summary (default 20)
//   --limit N         cap NEW (never-scored) candidates sent to scoring (default 120)
//   --from-cache      rebuild scoutFound.js from the last run's JSON (no scrape/score)
//   --rescore-failed  re-score only score_failed entries from the cache, re-rank
//   --rescore-all     ignore remembered scores and score every candidate again
//   --backfill-cache  seed the score cache from the last run's JSON, score nothing
//   --enrich N        top-ranked BigFuture candidates to fetch requirements for (default 250)
//   --no-enrich       skip the detail fetch entirely
//   --rescreen        re-run the eligibility screen over the last run's list (no scrape/score)

import { homedir } from "os";
import { join, dirname } from "path";
import { PRICING, costUsd } from "../src/lib/essayCost.js";
import { scanForInjection, wrapUntrusted } from "../llm/untrusted";
import { scrapePropublica990 } from "./propublica-990";
import { readFileSync, existsSync, mkdirSync } from "fs";
import { PROJECTION_PATH } from "../state/rebuild";
import { computeOutcomeBuckets, realizedWinRate, type OutcomeBucket } from "../state/outcomes";
import { cacheKey, profileHash, usableScores, mergedCache, MAX_AGE_DAYS, type ScoreCacheFile } from "./score-cache";
import { buildEligibilityProfile, screenEligibility } from "./eligibility";
import { loadVault, resolveApplicant } from "../identity/vault";
import { readDetailCache, writeDetailCache, fetchDetails, detailText, slugOf } from "./bigfuture-detail";

const HOME = homedir();
const PROFILE_PATH = join(HOME, ".claude", "memory", "scholarship_profile.json");
const OUTPUT_PATH = join(HOME, "scholarships_found.json");
// BigFuture (CollegeBoard) curated harvest, written by scout/bigfuture-harvest.ts
// (logged-in browser capture — client-side app, no HTTP scrape). Local, gitignored,
// optional: if the file is absent this source is simply skipped with an honest status.
const BIGFUTURE_RAW_PATH = join(HOME, ".claude", "memory", "bigfuture_raw.json");
// Scores already taken, so a daily run pays only for listings it has never seen.
// See scout/score-cache.ts for what invalidates an entry.
const SCORE_CACHE_PATH = join(HOME, ".claude", "memory", "scholarship-scout", "scores.json");
const MODEL = "claude-haiku-4-5";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export interface Candidate {
  name: string;
  org: string | null;
  amount: number | null; // null = "Varies" / unknown
  amountText: string | null;
  deadline: string | null;
  url: string;
  description: string | null;
  source: string;
  // true for sources that name a scholarship-granting entity, not a live scholarship listing
  // (e.g. a 990-derived foundation) — never treat these as pre-verified the way a curated
  // source like BigFuture is.
  needsResearch?: boolean;
  // filled by scoring
  match?: number;
  effort?: "low" | "med" | "high";
  flags?: string[];
  expectedValue?: number;
  amountEstimated?: boolean;
  // set by the pre-scoring eligibility screen; the candidate is kept in the output file under
  // `ineligible` rather than deleted, so a wrong rule is auditable instead of invisible.
  ineligibleReason?: string;
}

export interface SourceStatus {
  source: string;
  status: "ok" | "blocked" | "error" | "empty";
  count: number;
  note?: string;
}

const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const opt = (f: string, dflt: number) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : dflt;
};
const TOP_N = opt("--top", 20);
const SCORE_LIMIT = opt("--limit", 120);
// How many top-ranked BigFuture candidates get their requirements fetched per run. Details are
// cached permanently, so this is a backlog rate, not a cap on how many are ever screened.
const ENRICH_LIMIT = opt("--enrich", 250);

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

async function fetchPage(url: string): Promise<{ status: "ok" | "blocked" | "error"; html: string }> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
    });
    const html = await res.text();
    if (!res.ok) return { status: res.status === 403 || res.status === 429 ? "blocked" : "error", html };
    if (/just a moment|cf-challenge|are you a robot|access denied/i.test(html.slice(0, 3000)))
      return { status: "blocked", html };
    return { status: "ok", html };
  } catch (err) {
    return { status: "error", html: String(err) };
  }
}

const stripTags = (s: string) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const parseAmount = (text: string | null): number | null => {
  if (!text) return null;
  const m = text.replace(/,/g, "").match(/\$\s*(\d{2,7})/);
  return m ? Number(m[1]) : null;
};

// ---------------------------------------------------------------------------
// Source adapter: CareerOneStop (US Dept of Labor scholarship database)
// Server-rendered ASP.NET table, pagesize=100 supported. One query per keyword.
// ---------------------------------------------------------------------------

const COS_KEYWORDS = [
  // original profile core
  "biology",
  "computer science",
  "artificial intelligence",
  "cancer",
  "eagle scout",
  "wrestling",
  "transfer student",
  // field-adjacent (computational oncology path)
  "medicine",
  "oncology",
  "health",
  "science",
  "technology",
  "engineering",
  "research",
  "chemistry",
  "mathematics",
  // circumstance
  "michigan",
  "community college",
  "sophomore",
  "undergraduate",
  "low income",
  // character / activities
  "leadership",
  "community service",
  "volunteer",
  "entrepreneurship",
  "business",
  "christian",
  "athlete",
];

const COS_MAX_PAGES = 3; // broad keywords overflow pagesize=100; deeper pages are diminishing returns

async function scrapeCareerOneStop(statuses: SourceStatus[]): Promise<Candidate[]> {
  const byId = new Map<string, Candidate>();
  for (const kw of COS_KEYWORDS) {
    let count = 0;
    let fetchStatus: SourceStatus["status"] = "ok";
    for (let curPage = 1; curPage <= COS_MAX_PAGES; curPage++) {
      const url = `https://www.careeronestop.org/toolkit/training/find-scholarships.aspx?keyword=${encodeURIComponent(kw)}&curPage=${curPage}&pagesize=100`;
      const page = await fetchPage(url);
      if (page.status !== "ok") {
        if (curPage === 1) fetchStatus = page.status; // later-page failures keep what page 1 gave us
        break;
      }
      let rowsThisPage = 0;
      // Each result row: detail link + Organization/Purposes blocks, then LOS/type/amount/deadline cells.
      const rows = page.html.split(/<tr>/).slice(1);
      for (const row of rows) {
        const link = row.match(/<a href="(\/Toolkit\/Training\/find-scholarships-detail\.aspx[^"]*scholarshipId=(\d+))"[^>]*>\s*([^<]+?)\s*<\/a>/i);
        if (!link) continue;
        rowsThisPage++;
        const [, href, id, name] = link;
        const org = row.match(/Organization:\s*<div[^>]*>\s*([^<]+?)\s*</i)?.[1] ?? null;
        const purpose = row.match(/Purposes?:\s*([^<]+?)\s*</i)?.[1] ?? null;
        const levels = stripTags(row.match(/headers="thLOS"[^>]*>([\s\S]*?)<\/td>/i)?.[1] ?? "");
        const amountText = stripTags(row.match(/headers="thAA"[^>]*>([\s\S]*?)<\/td>/i)?.[1] ?? "") || null;
        const deadline = stripTags(row.match(/headers="thD"[^>]*>([\s\S]*?)<\/td>/i)?.[1] ?? "") || null;
        // Colin is an undergrad: keep rows open to Associate/Bachelor's (or unspecified).
        if (levels && !/bachelor|associate/i.test(levels)) continue;
        if (!byId.has(id))
          byId.set(id, {
            name: stripTags(name),
            org,
            amount: parseAmount(amountText),
            amountText,
            deadline,
            // The href echoes the search keyword with raw spaces, which breaks the URL —
            // only scholarshipId matters for the detail page.
            url: `https://www.careeronestop.org/Toolkit/Training/find-scholarships-detail.aspx?scholarshipId=${id}`,
            description: purpose,
            source: "careeronestop",
          });
        count++;
      }
      if (rowsThisPage < 90) break; // a non-full page is the last page for this keyword
    }
    statuses.push({ source: `careeronestop (${kw})`, status: fetchStatus !== "ok" ? fetchStatus : count ? "ok" : "empty", count });
  }
  return [...byId.values()];
}

// ---------------------------------------------------------------------------
// Source adapter: Scholarships360 (server-rendered article pages with cards
// linking to scholarships360.org/scholarships/search/<slug>/)
// ---------------------------------------------------------------------------

// All slugs verified live 2026-06-11 (the old scholarships-for-college-sophomores page now 404s).
const S360_PAGES = [
  "https://scholarships360.org/scholarships/stem-scholarships/",
  "https://scholarships360.org/scholarships/no-essay-scholarships/",
  "https://scholarships360.org/scholarships/easy-scholarships-to-apply-for/",
  "https://scholarships360.org/scholarships/michigan-scholarships/",
  "https://scholarships360.org/scholarships/community-college-scholarships/",
  "https://scholarships360.org/scholarships/biology-scholarships/",
  "https://scholarships360.org/scholarships/computer-science-scholarships/",
  "https://scholarships360.org/scholarships/healthcare-scholarships/",
  "https://scholarships360.org/scholarships/engineering-scholarships/",
  "https://scholarships360.org/scholarships/leadership-scholarships/",
  "https://scholarships360.org/scholarships/scholarships-for-men/",
  "https://scholarships360.org/scholarships/christian-scholarships/",
];

function slugToName(slug: string): string {
  return slug
    .split("-")
    .map((w) => (w.length > 2 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/**
 * The one-line requirements text a Scholarships360 card can support. screenEligibility() needs
 * prose, and "Grade level: High School Senior." is enough for it to disqualify deterministically.
 * Returns null when the card carried nothing — an empty string would read as "screened and clean".
 */
export function describeCard(
  gradeLevel: string | null,
  amountKey: string | null,
  amountText: string | null,
): string | null {
  const parts: string[] = [];
  if (gradeLevel) parts.push(`Grade level: ${gradeLevel}.`);
  if (amountKey && amountText) parts.push(`${amountKey.replace(/\b\w/, (c) => c.toUpperCase())} ${amountText}.`);
  return parts.length ? parts.join(" ") : null;
}

async function scrapeScholarships360(statuses: SourceStatus[]): Promise<Candidate[]> {
  const bySlug = new Map<string, Candidate>();
  for (const pageUrl of S360_PAGES) {
    const page = await fetchPage(pageUrl);
    const label = `scholarships360 (${pageUrl.split("/scholarships/")[1]?.replace(/\/$/, "")})`;
    if (page.status !== "ok") {
      statuses.push({ source: label, status: page.status, count: 0 });
      continue;
    }
    let count = 0;
    // Cards link to detail pages; amount/deadline live in name/value info pairs nearby.
    const re = /href="(https:\/\/scholarships360\.org\/scholarships\/search\/([a-z0-9-]+)\/)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(page.html))) {
      const [, url, slug] = m;
      if (bySlug.has(slug)) continue;
      // Look in a window after the link for "Amount: $X" / "Deadline: ..." info pairs.
      const win = page.html.slice(m.index, m.index + 2500);
      const pairs: Record<string, string> = {};
      const pairRe = /card-info(?:_mob)?-name"[^>]*>([^<]+)<[\s\S]{0,200}?card-info(?:_mob)?-value"[^>]*>([^<]+)</g;
      let p: RegExpExecArray | null;
      while ((p = pairRe.exec(win))) pairs[stripTags(p[1]).toLowerCase()] = stripTags(p[2]);
      // The amount key carries the award count, so it is never literally "amount":
      // "1 award worth", "2 awards worth", "4 awards worth up to", "multiple awards worth".
      // Reading only pairs["amount"] left every Scholarships360 find with a null amount, which
      // zeroes its expected value and buries it in the ranking.
      const amountKey = Object.keys(pairs).find((k) => /awards?\s+worth/.test(k));
      const amountText = amountKey ? pairs[amountKey] : null;
      // "Grade level" is a structured field on ~2/3 of cards ("High School Senior",
      // "High School Seniors & College Students", "All Grade Levels"). It is the single most
      // valuable eligibility fact on the page and used to be discarded, which left the free
      // deterministic screen with no text to screen and sent high-school-only awards all the way
      // through to the dashboard.
      const gradeLevel = pairs["grade level"] ?? null;
      bySlug.set(slug, {
        name: slugToName(slug),
        org: null,
        amount: parseAmount(amountText),
        amountText,
        deadline: pairs["deadline"] ?? pairs["next deadline"] ?? null,
        url,
        description: describeCard(gradeLevel, amountKey ?? null, amountText),
        source: "scholarships360",
      });
      count++;
    }
    statuses.push({ source: label, status: count ? "ok" : "empty", count });
  }
  return [...bySlug.values()];
}

// ---------------------------------------------------------------------------
// Source adapter: Unigo (server-rendered WordPress directory pages — curated
// "top N" cards per category page; rich taxonomy under /scholarships/{slug}).
// Card shape: <a class="scholarship-group-title-link"> then detail/title span
// pairs (Award Amount / Awards / Deadline / Total Amount Awarded).
// ---------------------------------------------------------------------------

// Profile-derived category slugs. 302s (martial-arts, pre-med) are followed by
// fetchPage; a slug that lands somewhere card-less just reports empty.
const UNIGO_PAGES = [
  "merit-based",
  "undergraduate-students",
  "our-scholarships",
  "company-sponsored",
  "religious",
  "grants-for-college",
  "by-major/biology-scholarships",
  "by-major/computer-science-scholarships",
  "by-major/science-scholarships",
  "by-major/chemistry-scholarships",
  "by-major/engineering-scholarships",
  "by-major/pre-med-scholarships",
  "by-state/michigan-scholarships",
  "by-state/georgia-scholarships",
  "by-type/need-based-scholarships",
  "by-type/entrepreneurship-scholarships",
  "by-type/full-ride-scholarships",
  "athletic/wrestling-scholarships",
  "athletic/martial-arts-scholarships",
];

async function scrapeUnigo(statuses: SourceStatus[]): Promise<Candidate[]> {
  const byKey = new Map<string, Candidate>();
  let first = true;
  for (const slug of UNIGO_PAGES) {
    // Unigo's WAF blocks burst fetches (2026-06-12 run: pages 9+ all came back
    // blocked). ~600KB pages, so pace requests instead of hammering.
    if (!first) await new Promise((r) => setTimeout(r, 1500));
    first = false;
    const page = await fetchPage(`https://www.unigo.com/scholarships/${slug}`);
    const label = `unigo (${slug})`;
    if (page.status !== "ok") {
      statuses.push({ source: label, status: page.status, count: 0 });
      continue;
    }
    let count = 0;
    const links = [...page.html.matchAll(/<a href="(https:\/\/www\.unigo\.com\/scholarships\/[^"?]+)[^"]*" class="scholarship-group-title-link">([^<]+)<\/a>/g)];
    for (let i = 0; i < links.length; i++) {
      const [, href, rawName] = links[i];
      // Detail/title pairs live between this card's title link and the next one.
      const winEnd = i + 1 < links.length ? links[i + 1].index : Math.min(page.html.length, links[i].index! + 6000);
      const win = page.html.slice(links[i].index, winEnd);
      const pairs: Record<string, string> = {};
      const pairRe = /scholarship-listing-detail">([^<]*)<\/span>\s*<span class="scholarship-listing-title">([^<]*)</g;
      let p: RegExpExecArray | null;
      while ((p = pairRe.exec(win))) pairs[stripTags(p[2]).toLowerCase()] = stripTags(p[1]);
      // "Total Amount Awarded" is the pool across all winners, not the award —
      // using it inflated one $140K phantom to the top of the EV list. A missing
      // award amount ranks at the conservative "Varies" stand-in instead.
      const amountText = pairs["award amount"] ?? null;
      const key = href.replace(/\/$/, "").split("/").pop()!;
      count++;
      if (byKey.has(key)) continue;
      byKey.set(key, {
        name: stripTags(rawName),
        org: null,
        amount: parseAmount(amountText),
        amountText,
        deadline: pairs["deadline"] ?? null,
        url: href,
        description: null,
        source: "unigo",
      });
    }
    statuses.push({ source: label, status: count ? "ok" : "empty", count });
  }
  return [...byKey.values()];
}

// ---------------------------------------------------------------------------
// Probe adapters: Petersons, Raise.me, Appily (cappex.com), Sallie (myscholly.com).
// All four were probed 2026-06-11 and are client-side apps or login walls — no
// server-rendered directory to harvest. Each probe re-checks every run and
// reports an honest status; if one ever ships parseable cards, flip it to a
// real adapter. They all stay on the NEEDS_BROWSER worklist below.
// ---------------------------------------------------------------------------

async function probeSource(
  statuses: SourceStatus[],
  label: string,
  url: string,
  note: string,
  hasContent: (html: string) => boolean,
): Promise<Candidate[]> {
  const page = await fetchPage(url);
  const status: SourceStatus["status"] = page.status !== "ok" ? page.status : hasContent(page.html) ? "ok" : "empty";
  statuses.push({ source: label, status, count: 0, note: status === "ok" ? `reachable but unparsed — ${note}` : note });
  return [];
}

const scrapePetersons = (s: SourceStatus[]) =>
  probeSource(s, "petersons (probe)", "https://www.petersons.com/scholarship-search.aspx", "client-side Vue app over an authenticated JSON:API — use browser", (h) => h.length > 100_000);

const scrapeRaiseMe = (s: SourceStatus[]) =>
  probeSource(s, "raise.me (probe)", "https://www.raise.me/", "login-walled micro-scholarship app — use browser", (h) => /scholarship-listing|__NEXT_DATA__/.test(h));

const scrapeAppily = (s: SourceStatus[]) =>
  probeSource(s, "appily/cappex (probe)", "https://www.appily.com/scholarships/college-sophomores", "client-side search app (cappex.com redirects here) — use browser", (h) => /scholarship-card|award-amount/i.test(h));

const scrapeScholly = (s: SourceStatus[]) =>
  probeSource(s, "scholly→sallie (probe)", "https://myscholly.com", "Scholly was sunset into Sallie's search (myscholly.com → sallie.com) — login tool, use browser", (h) => /scholarship-directory|award amount/i.test(h));

// ---------------------------------------------------------------------------
// Login-walled / client-side sources → browser worklist (Claude for Chrome
// handles these per ScholarshipAutomation.md; an HTTP scraper gets nothing).
// ---------------------------------------------------------------------------

const NEEDS_BROWSER = [
  { site: "Bold.org", url: "https://bold.org/scholarships/", note: "Open-scholarship list is client-side; filter STEM + need-based + no-essay. High volume of $500-$2,500 awards." },
  { site: "Fastweb", url: "https://www.fastweb.com/", note: "Login required. Profile-matched feed; set profile once, harvest matches." },
  { site: "Scholarships.com", url: "https://www.scholarships.com/", note: "Login required. Directory search after profile setup." },
  { site: "Niche", url: "https://www.niche.com/colleges/scholarships/", note: "Bot-detected. $10K no-essay monthly drawing — re-enter every month." },
  { site: "Appily", url: "https://www.appily.com/scholarships/college-sophomores", note: "Client-side search app (cappex.com redirects here since the Cappex rebrand). Sophomore + transfer filters." },
  { site: "Petersons", url: "https://www.petersons.com/scholarship-search.aspx", note: "Client-side Vue app over an authenticated JSON:API. Search by major + state after free signup." },
  { site: "Raise.me", url: "https://www.raise.me/", note: "Login-walled micro-scholarships, college-specific — check UM-Flint awards before the Winter 2027 transfer." },
  { site: "Sallie (ex-Scholly)", url: "https://www.sallie.com/scholarships/scholly", note: "myscholly.com redirects here — Scholly was sunset into Sallie's free search. Login tool + monthly no-essay sweepstakes." },
];

// ---------------------------------------------------------------------------
// BigFuture (CollegeBoard) — curated, profile-matchable directory of ~36k vetted
// scholarships. It's a login-walled client-side app (no HTTP scrape), so the
// harvest is done separately by scout/bigfuture-harvest.ts, which drives a
// logged-in browser and writes BIGFUTURE_RAW_PATH. Here we just READ that cache
// and map it into Candidates — no network. Absent file → honest "empty" status.
// ---------------------------------------------------------------------------

interface BigFutureRaw {
  name: string;
  slug: string;
  url: string;
  amount: number | null;
  amountVaries?: boolean;
  opens?: string | null;
  closes?: string | null;
  merit?: boolean;
  need?: boolean;
  essay?: boolean;
  status?: string; // "deadline-soon" | "not-open" | "accepting" | ""
}

async function harvestBigFuture(statuses: SourceStatus[]): Promise<Candidate[]> {
  const label = "bigfuture (CollegeBoard)";
  const file = Bun.file(BIGFUTURE_RAW_PATH);
  if (!(await file.exists())) {
    statuses.push({ source: label, status: "empty", count: 0, note: "no harvest cache — run scout/bigfuture-harvest.ts" });
    return [];
  }
  let raw: BigFutureRaw[];
  try {
    raw = await file.json();
  } catch {
    statuses.push({ source: label, status: "error", count: 0, note: `unreadable JSON at ${BIGFUTURE_RAW_PATH}` });
    return [];
  }
  const out: Candidate[] = [];
  for (const r of raw) {
    if (!r?.name || !r?.url) continue;
    const facts = [
      r.need ? "need-based" : null,
      r.merit ? "merit-based" : null,
      r.essay ? "essay required" : "no essay",
      r.opens ? `opens ${r.opens}` : null,
    ].filter(Boolean);
    out.push({
      name: r.name,
      org: null, // card view has no sponsor; the detail page does, not harvested
      amount: r.amountVaries ? null : (r.amount ?? null),
      amountText: r.amountVaries ? "Varies" : r.amount != null ? `$${r.amount.toLocaleString()}` : null,
      deadline: r.closes ?? null, // only "Closes" is a real deadline; "Opens" goes in the notes
      url: r.url,
      description: `BigFuture curated (CollegeBoard). ${facts.join("; ")}.`,
      source: "bigfuture",
    });
  }
  statuses.push({ source: label, status: out.length ? "ok" : "empty", count: out.length });
  return out;
}

// ---------------------------------------------------------------------------
// Scoring (Layer 2): Claude scores eligibility match, effort, legitimacy.
// Primary: Anthropic API via raw fetch (same pattern as server.ts).
// Fallback: PAI Inference.ts CLI (subscription-billed, no API key needed).
// ---------------------------------------------------------------------------

/** The remembered scores, or null when there is no usable file yet. Never throws. */
async function readScoreCache(): Promise<ScoreCacheFile | null> {
  try {
    const f = Bun.file(SCORE_CACHE_PATH);
    if (!(await f.exists())) return null;
    return (await f.json()) as ScoreCacheFile;
  } catch {
    return null; // a corrupt cache costs a re-score, not a failed run
  }
}

async function writeScoreCache(next: ScoreCacheFile): Promise<void> {
  try {
    mkdirSync(dirname(SCORE_CACHE_PATH), { recursive: true });
    await Bun.write(SCORE_CACHE_PATH, JSON.stringify(next));
    console.log(`Remembered ${Object.keys(next.scores).length} scores → ${SCORE_CACHE_PATH}`);
  } catch (err) {
    console.error(`  could not write the score cache (${err instanceof Error ? err.message : err}) — next run re-scores`);
  }
}

function compactProfile(profile: any): string {
  return JSON.stringify({
    personal: profile.personal,
    academic: profile.academic,
    financial: profile.financial,
    achievements: profile.achievements,
    categories: profile.categories,
  });
}

function scoringPrompt(profile: any, batch: Candidate[]): { system: string; user: string } {
  const system = [
    "You score scholarships for one specific student. For each scholarship return:",
    '- "match": 0-100 integer. How likely the student actually QUALIFIES (eligibility, not win odds).',
    "  Hard mismatches (wrong level of study, wrong state residency requirement, profession-specific awards",
    "  the student has no connection to, graduate-only, teacher-only, etc.) score under 20.",
    '- "effort": "low" (no essay / short form), "med" (one essay), "high" (multiple essays, recommendations, portfolios).',
    '- "flags": array of strings, empty if legitimate. Use "application_fee", "paid_service", "missing_org",',
    '  or "suspicious" if the entry smells like lead-gen or a scam. Use "ai_prohibited" if the listing text',
    '  explicitly forbids AI-assisted or AI-written essays, and "third_party_prohibited" if it explicitly',
    "  forbids third-party or automated submission (both are additive info flags, not scam signals — do",
    "  not also flag these as suspicious just because of this).",
    'Note: a category "first generation college student (verify)" is UNVERIFIED — never count it toward a match.',
    'Respond with ONLY a JSON array: [{"i":0,"match":85,"effort":"low","flags":[]},...] — one entry per scholarship, same order.',
  ].join("\n");
  // Listing text is scraped from third-party sites — on several aggregators it is submitted by
  // strangers. It must never be interpolated into a prompt raw. Anything that looks like an
  // injection attempt is dropped from the payload and flagged rather than scored on its own terms.
  const items = batch.map((c, i) => {
    const raw = c.description?.slice(0, 250) ?? null;
    const scan = raw ? scanForInjection(raw) : { suspicious: false, reasons: [] as string[] };
    return {
      i,
      name: c.name,
      org: c.org,
      amount: c.amountText ?? c.amount,
      deadline: c.deadline,
      description: scan.suspicious ? null : raw,
      ...(scan.suspicious ? { descriptionWithheld: scan.reasons } : {}),
    };
  });
  const user =
    `STUDENT PROFILE:\n${compactProfile(profile)}\n\n` +
    wrapUntrusted(JSON.stringify(items), { label: "scholarship listings", maxChars: 24_000 });
  return { system, user };
}

function extractJsonArray(text: string): any[] {
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) throw new Error(`No JSON array in response: ${text.slice(0, 200)}`);
  return JSON.parse(m[0]);
}

async function scoreViaApi(system: string, user: string, apiKey: string): Promise<{ rows: any[]; cost: number }> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 3000,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as any;
  const text = data.content?.filter((b: any) => b.type === "text").map((b: any) => b.text).join("") ?? "";
  return { rows: extractJsonArray(text), cost: costUsd(data.usage, MODEL) };
}

async function scoreViaInferenceCli(system: string, user: string): Promise<{ rows: any[]; cost: number }> {
  const tool = join(HOME, ".claude", "PAI", "TOOLS", "Inference.ts");
  const proc = Bun.spawn(["bun", tool, "--level", "fast", "--timeout", "90000", system, user], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  await proc.exited;
  if (proc.exitCode !== 0) throw new Error(`Inference.ts exit ${proc.exitCode}: ${(err || out).slice(0, 300)}`);
  return { rows: extractJsonArray(out), cost: 0 }; // subscription-billed
}

async function scoreAll(
  profile: any,
  candidates: Candidate[],
): Promise<{ scored: Candidate[]; cost: number; backend: string; batches: number; failedBatches: number }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const backend = apiKey ? `Anthropic API (${MODEL}, $${PRICING[MODEL].in}/M in)` : "PAI Inference.ts (subscription)";
  let cost = 0;
  let batches = 0;
  let failedBatches = 0;
  const BATCH = 15;
  for (let off = 0; off < candidates.length; off += BATCH) {
    batches++;
    const batch = candidates.slice(off, off + BATCH);
    const { system, user } = scoringPrompt(profile, batch);
    // Inference.ts times out under load fairly often — one retry before defaulting.
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { rows, cost: c } = apiKey ? await scoreViaApi(system, user, apiKey) : await scoreViaInferenceCli(system, user);
        cost += c;
        for (const r of rows) {
          const target = batch[r.i];
          if (!target) continue;
          target.match = Math.max(0, Math.min(100, Number(r.match) || 0));
          target.effort = ["low", "med", "high"].includes(r.effort) ? r.effort : "med";
          target.flags = Array.isArray(r.flags) ? r.flags : [];
        }
        lastErr = undefined;
        console.log(`  scored ${Math.min(off + BATCH, candidates.length)}/${candidates.length}`);
        break;
      } catch (err) {
        lastErr = err;
      }
    }
    if (lastErr) {
      failedBatches++;
      console.error(`  batch at ${off} failed twice: ${lastErr instanceof Error ? lastErr.message : lastErr}`);
      for (const c2 of batch) if (c2.match === undefined) { c2.match = 50; c2.effort = "med"; c2.flags = ["score_failed"]; }
      // A backend that is down fails every batch in the same way, and 80 identical retries just
      // delay the honest answer. Bail after 3 consecutive total failures at the start of a run.
      if (failedBatches === batches && failedBatches >= 3) {
        console.error(`  scoring backend looks unreachable — stopping after ${failedBatches} failed batches`);
        break;
      }
    }
  }
  return { scored: candidates, cost, backend, batches, failedBatches };
}

// ---------------------------------------------------------------------------
// Ranking + deadline buckets
// ---------------------------------------------------------------------------

const FALLBACK_AMOUNT = 1500; // conservative stand-in when the listing says "Varies"

// Realized win-rate by (source, effort), from actually-resolved AWARD_NOTICE_REVIEW checkpoints
// (state/outcomes.ts). Loaded once per run; buckets below MIN_SAMPLE are excluded by
// realizedWinRate() itself, so an empty/missing projection just means "no signal yet" — the
// match%-only estimate below is the correct fallback, not an error.
let outcomeBuckets: OutcomeBucket[] = [];
if (existsSync(PROJECTION_PATH)) {
  try {
    outcomeBuckets = computeOutcomeBuckets(JSON.parse(readFileSync(PROJECTION_PATH, "utf8")));
  } catch { /* projection unreadable — proceed with no realized-rate signal */ }
}

function rank(c: Candidate): Candidate {
  const amt = c.amount ?? FALLBACK_AMOUNT;
  c.amountEstimated = c.amount === null;
  // P(win) proxy: prefer a realized win-rate for this (source, effort) once ≥5 outcomes have
  // resolved for it — a measured rate beats match% as a P(win) stand-in, since match% answers
  // "does this student qualify," not "how often do students like this actually win." Below that
  // sample size, match% remains the estimate (unchanged behavior).
  const realized = realizedWinRate(outcomeBuckets, c.source, c.effort ?? "med");
  const pWin = realized ?? (c.match ?? 50) / 100;
  c.expectedValue = Math.round(amt * pWin);
  return c;
}

function deadlineBucket(deadline: string | null): "apply_now" | "future" {
  if (!deadline) return "apply_now"; // unknown → check it now, don't bury it
  if (/varies|rolling|monthly|ongoing|continuous|open/i.test(deadline)) return "apply_now";
  const d = new Date(deadline);
  if (isNaN(d.getTime())) return "apply_now";
  const days = (d.getTime() - Date.now()) / 86_400_000;
  if (days < 0) return "future"; // past date listed — almost always an annual award; verify next cycle
  return days <= 150 ? "apply_now" : "future";
}

// ---------------------------------------------------------------------------
// --emit-app: write src/data/scoutFound.js — top finds in the defaults.js
// shape, deduped against the dashboard's seeded list. The app merges these
// into localStorage by id, so ids must be STABLE across re-runs (slug of the
// name, never Date.now()).
// ---------------------------------------------------------------------------

const EMIT_MIN_MATCH = 40;
const EMIT_MAX = 30;

function slugId(name: string): string {
  return "sc_scout_" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
}

async function emitAppFile(ranked: Candidate[], generatedAt: string) {
  const defaults = await Bun.file(join(import.meta.dir, "..", "src", "data", "defaults.js")).text();
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const seeded = [...defaults.matchAll(/name: '([^']+)'/g)].map((m) => norm(m[1]));
  const fresh = ranked.filter(
    (c) => (c.match ?? 0) > EMIT_MIN_MATCH && !seeded.some((s) => s.includes(norm(c.name).slice(0, 24)) || norm(c.name).includes(s)),
  );
  const byId = new Map<string, Candidate>();
  for (const c of fresh) if (!byId.has(slugId(c.name))) byId.set(slugId(c.name), c);
  const entries = [...byId.entries()].slice(0, EMIT_MAX).map(([id, c]) => ({
    id,
    name: c.name,
    // BigFuture cards carry no sponsor (that's only on the detail page), and the green
    // BIGFUTURE badge already signals provenance — so leave org blank rather than echoing
    // "bigfuture". Other sources keep their source tag as the org fallback.
    org: c.org ?? (c.source === "bigfuture" ? "" : c.source),
    amount: c.amount ?? 0,
    deadline: c.deadline ?? "Verify at URL",
    status: deadlineBucket(c.deadline) === "apply_now" ? "apply" : "future",
    priority: (c.expectedValue ?? 0) >= 5000 ? "high" : "medium",
    url: c.url,
    notes: `Scout find (match ${c.match}%, effort ${c.effort}). ${c.description ?? ""}`.trim().slice(0, 160),
    // Preserve BigFuture provenance so the app can badge curated finds; everything
    // else keeps the generic "scout" tag the dashboard already understands.
    source: c.source === "bigfuture" ? "bigfuture" : "scout",
    match: c.match,
    effort: c.effort,
    expectedValue: c.expectedValue,
  }));
  const file = join(import.meta.dir, "..", "src", "data", "scoutFound.js");
  const body =
    `// Auto-generated by \`bun scout/scout.ts --emit-app\` — do not edit by hand.\n` +
    `// Top scout finds (match > ${EMIT_MIN_MATCH}%, by expected value), deduped against defaults.js.\n` +
    `export const SCOUT_GENERATED_AT = ${JSON.stringify(generatedAt)};\n\n` +
    `export const SCOUT_SCHOLARSHIPS = ${JSON.stringify(entries, null, 2)};\n`;
  await Bun.write(file, body);
  console.log(`\nWrote ${entries.length} scout entries → src/data/scoutFound.js (generated ${generatedAt})`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // --from-cache: rebuild src/data/scoutFound.js from the last run's JSON,
  // no scraping or scoring. Fast path for the /scout command and UI iteration.
  if (flag("--from-cache")) {
    const cached = await Bun.file(OUTPUT_PATH).json();
    console.log(`From cache: ${OUTPUT_PATH} (generated ${cached.generated_at}, ${cached.ranked.length} ranked)`);
    await emitAppFile(cached.ranked, cached.generated_at);
    return;
  }

  // --rescore-failed: re-score only entries whose batch timed out last run
  // (flagged score_failed with the default 50% match), then re-rank everything.
  // --backfill-cache: remember the scores from the last run's JSON without re-scoring anything.
  // Used once to seed the cache from a full run that predates it; harmless to repeat.
  if (flag("--backfill-cache")) {
    const cached = await Bun.file(OUTPUT_PATH).json();
    const profile = await Bun.file(PROFILE_PATH).json();
    const all: Candidate[] = [...cached.ranked, ...cached.low_match, ...cached.removed_scams];
    const next = mergedCache(await readScoreCache(), profileHash(compactProfile(profile)), all);
    await writeScoreCache(next);
    console.log(`Backfilled from ${OUTPUT_PATH} (${all.length} entries, ${Object.keys(next.scores).length} remembered).`);
    return;
  }

  // --rescreen: no scraping and no scoring — re-run the free eligibility screen over the last
  // run's list, fetching BigFuture requirements for the top of it. Use it after a screening rule
  // changes, so the dashboard stops showing awards the student cannot win without waiting for a
  // full harvest.
  if (flag("--rescreen")) {
    const cached = await Bun.file(OUTPUT_PATH).json();
    const all: Candidate[] = [...cached.ranked, ...cached.low_match, ...cached.removed_scams, ...(cached.ineligible ?? [])];
    // Re-screening is the whole point, so a previous verdict must not stick.
    for (const c of all) {
      c.flags = (c.flags ?? []).filter((f) => f !== "ineligible");
      delete c.ineligibleReason;
    }
    console.log(`Re-screening ${all.length} entries from ${OUTPUT_PATH} (generated ${cached.generated_at}).`);
    await finalizeAndReport(all, cached.sources, 0, cached.scoring_backend ?? "cache");
    return;
  }

  if (flag("--rescore-failed")) {
    const cached = await Bun.file(OUTPUT_PATH).json();
    const profile = await Bun.file(PROFILE_PATH).json();
    const all: Candidate[] = [...cached.ranked, ...cached.low_match, ...cached.removed_scams];
    const failed = all.filter((c) => (c.flags ?? []).includes("score_failed"));
    if (!failed.length) {
      console.log("No score_failed entries in the cache — nothing to do.");
      return;
    }
    console.log(`Re-scoring ${failed.length} of ${all.length} entries that failed last run…`);
    for (const c of failed) c.match = undefined;
    const { cost, backend } = await scoreAll(profile, failed);
    // A rescue that worked is worth remembering too, or tomorrow pays for it again.
    const pHash = profileHash(compactProfile(profile));
    await writeScoreCache(mergedCache(await readScoreCache(), pHash, failed));
    await finalizeAndReport(all, cached.sources, cost, backend);
    return;
  }

  const profile = await Bun.file(PROFILE_PATH).json();
  console.log(`Profile: ${profile.personal.name} — ${profile.academic.major}, ${profile.academic.current_school}`);

  const statuses: SourceStatus[] = [];
  console.log("\nFetching sources…");
  const [cos, s360, unigo, bigfuture, propublica990, ...probes] = await Promise.all([
    scrapeCareerOneStop(statuses),
    scrapeScholarships360(statuses),
    scrapeUnigo(statuses),
    harvestBigFuture(statuses),
    scrapePropublica990(statuses),
    scrapePetersons(statuses),
    scrapeRaiseMe(statuses),
    scrapeAppily(statuses),
    scrapeScholly(statuses),
  ]);
  const probed = probes.flat();

  for (const s of statuses) console.log(`  [${s.status.toUpperCase().padEnd(7)}] ${s.source}: ${s.count}${s.note ? ` — ${s.note}` : ""}`);
  const rawTotal = statuses.reduce((sum, s) => sum + s.count, 0);
  console.log(`\n${rawTotal} raw candidates harvested before filtering`);

  // Cross-source dedupe by normalized name.
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const byName = new Map<string, Candidate>();
  // BigFuture first: it's the curated/vetted source, so on a name collision its entry wins
  // over the raw-directory duplicates. propublica990 goes last — it's a research lead (a
  // foundation, not a verified listing), so any verified source's entry should win on collision.
  for (const c of [...bigfuture, ...cos, ...s360, ...unigo, ...probed, ...propublica990]) if (!byName.has(norm(c.name))) byName.set(norm(c.name), c);
  let candidates = [...byName.values()];
  console.log(
    `${candidates.length} unique candidates (${bigfuture.length} BigFuture, ${cos.length} CareerOneStop, ${s360.length} Scholarships360, ` +
      `${unigo.length} Unigo, ${propublica990.length} ProPublica990, ${probed.length} probes)`,
  );

  // Eligibility screen — deterministic, free, and it runs BEFORE scoring so a disqualified
  // candidate never costs a model call and never reaches the dashboard.
  //
  // This module existed and was fully tested, but nothing in this pipeline ever called it: the
  // only caller was adjudicate.ts, which screens applications that have already been created by
  // hand. That is how the NSHSS Foundation STEM Scholarship — "High school students of all grade
  // levels" — arrived in the dashboard's brain dump as an actionable lead with a deadline.
  const eligibility = buildEligibilityProfile(resolveApplicant(loadVault()) as any);
  const requirementsTextOf = (c: Candidate) =>
    [c.name, c.org, c.description].filter(Boolean).join(". ");
  const ineligible: Candidate[] = [];
  candidates = candidates.filter((c) => {
    const v = screenEligibility(requirementsTextOf(c), eligibility);
    if (v.decision !== "disqualified") return true;
    c.flags = [...(c.flags ?? []), "ineligible"];
    c.ineligibleReason = v.reasons[0];
    ineligible.push(c);
    return false;
  });
  if (ineligible.length) {
    const byRule = new Map<string, number>();
    for (const c of ineligible) {
      const r = c.ineligibleReason ?? "unknown";
      byRule.set(r, (byRule.get(r) ?? 0) + 1);
    }
    console.log(`${ineligible.length} candidates disqualified on eligibility before scoring:`);
    for (const [reason, n] of [...byRule.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)) {
      console.log(`  ${String(n).padStart(5)}  ${reason}`);
    }
  }

  // Scores already taken stay taken. Only what the scout has never seen is sent to the model,
  // which is what makes a daily run minutes instead of hours.
  const pHash = profileHash(compactProfile(profile));
  const prevCache = flag("--no-score") ? null : await readScoreCache();
  if (!flag("--rescore-all") && !flag("--no-score")) {
    const remembered = usableScores(prevCache, pHash);
    let hits = 0;
    for (const c of candidates) {
      const hit = remembered.get(cacheKey(c.name));
      if (!hit) continue;
      c.match = hit.match; c.effort = hit.effort; c.flags = hit.flags;
      hits++;
    }
    if (remembered.size === 0 && prevCache) {
      console.log(`Remembered scores ignored — the profile changed since they were taken (re-scoring all).`);
    }
    console.log(`${hits} of ${candidates.length} candidates already scored (cache, <${MAX_AGE_DAYS}d) — ${candidates.length - hits} to score`);
  }

  // Everything already scored stays in the run for free; the budget applies to the rest.
  const scoredAlready = candidates.filter((c) => c.match !== undefined);
  let candidatesToScore = candidates.filter((c) => c.match === undefined);

  if (candidatesToScore.length > SCORE_LIMIT) {
    // Cap fairly: round-robin across sources, each source's list sorted by amount
    // ("Varies" competes at the fallback stand-in, not zero — otherwise a whole
    // source of no-listed-amount awards gets silently cut before scoring).
    const bySource = new Map<string, Candidate[]>();
    for (const c of candidatesToScore) (bySource.get(c.source) ?? bySource.set(c.source, []).get(c.source)!).push(c);
    for (const list of bySource.values()) list.sort((a, b) => (b.amount ?? FALLBACK_AMOUNT) - (a.amount ?? FALLBACK_AMOUNT));
    const capped: Candidate[] = [];
    while (capped.length < SCORE_LIMIT) {
      let took = false;
      for (const list of bySource.values()) {
        const next = list.shift();
        if (next) { capped.push(next); took = true; }
        if (capped.length >= SCORE_LIMIT) break;
      }
      if (!took) break;
    }
    candidatesToScore = capped;
    console.log(`Capped to ${SCORE_LIMIT} new candidates for scoring, round-robin by source (--limit to change)`);
  }

  let cost = 0;
  let backend = "none (--no-score)";
  if (!flag("--no-score") && candidatesToScore.length) {
    console.log(`\nScoring ${candidatesToScore.length} with ${process.env.ANTHROPIC_API_KEY ? "Anthropic API" : "PAI Inference.ts"}…`);
    const run = await scoreAll(profile, candidatesToScore);
    ({ cost, backend } = run);
    // Every batch failing is a dead backend, not a result. Publishing it would hand the
    // dashboard a few hundred fabricated 50% matches and overwrite a good ranked list with
    // them — so the run fails instead, loudly, and the daily chain stops right here.
    if (run.batches > 0 && run.failedBatches === run.batches) {
      console.error(
        `\nScoring failed on every batch (${run.failedBatches}/${run.batches}) — the scoring backend is unreachable.\n` +
          `Nothing was written: the previous ranked list is still the current one.`,
      );
      process.exit(1);
    }
    await writeScoreCache(mergedCache(prevCache, pHash, candidatesToScore));
  } else if (flag("--no-score")) {
    for (const c of candidatesToScore) { c.match = 50; c.effort = "med"; c.flags = []; }
  } else if (scoredAlready.length) {
    backend = "cache (nothing new to score)";
  }

  // A candidate the budget could not reach this run is not an unscored entry in the output —
  // it simply waits for tomorrow, rather than shipping as a fabricated 50% match.
  const reached = new Set(candidatesToScore);
  const unreached = candidates.filter((c) => c.match === undefined && !reached.has(c));
  if (unreached.length) console.log(`${unreached.length} candidates left unscored for a later run (--limit ${SCORE_LIMIT})`);

  await finalizeAndReport([...scoredAlready, ...candidatesToScore], statuses, cost, backend, ineligible);
}

/**
 * Should this run's results replace the ones already on disk?
 *
 * A blocked source is not an empty source. CareerOneStop rate-limits, and when all 28 of its
 * keyword queries come back BLOCKED the run harvests ~2,900 fewer candidates through no fault of
 * the catalog — then publishes the shortfall over a good list and regenerates the dashboard from
 * it. This is the same failure the BigFuture cache already guards against (see cacheVerdict in
 * bigfuture-harvest.ts): a partial pass must never overwrite a complete one.
 *
 * A clean run always publishes, including one that is legitimately smaller because listings
 * closed. The refusal is narrow: something was blocked AND the result collapsed.
 */
export function publishVerdict(opts: { blocked: string[]; fresh: number; existing: number }): { publish: boolean; reason: string } {
  const { blocked, fresh, existing } = opts;
  if (!blocked.length) return { publish: true, reason: "every source reported in" };
  if (existing <= 100) return { publish: true, reason: "no meaningful previous list to protect" };
  // 90%, not the 70% the BigFuture cache uses. That guard compares two harvests of the same
  // source, where churn is normal; here a blocked source means a whole slice is simply absent,
  // so any real shortfall is loss rather than listings closing.
  const floor = Math.round(existing * 0.9);
  if (fresh < floor) {
    return {
      publish: false,
      reason:
        `${blocked.length} source${blocked.length === 1 ? "" : "s"} blocked and the harvest fell to ${fresh} ` +
        `from ${existing} (floor ${floor}) — keeping the previous list`,
    };
  }
  return { publish: true, reason: `${blocked.length} source(s) blocked but ${fresh} of ${existing} survived` };
}

// Rank, filter, write JSON, print the summary, optionally regenerate scoutFound.js.
async function finalizeAndReport(candidates: Candidate[], statuses: SourceStatus[], cost: number, backend: string, ineligible: Candidate[] = []) {
  // eslint-disable-next-line prefer-const -- reassigned when the detail pass adds to it
  for (const c of candidates) rank(c);
  // Hard scam signals remove an entry; soft flags (suspicious, missing_org) only warn —
  // the scorer over-flags legitimate awards on data-quality gaps.
  const HARD_FLAGS = ["application_fee", "paid_service"];
  const scams = candidates.filter((c) => (c.flags ?? []).some((f) => HARD_FLAGS.includes(f)));
  // match < 20 = "doesn't qualify" — a $500K faculty award at 5% match is not a $25K EV.
  const lowMatch = candidates.filter((c) => !scams.includes(c) && (c.match ?? 50) < 20);
  let ranked = candidates
    .filter((c) => !scams.includes(c) && !lowMatch.includes(c))
    .sort((a, b) => (b.expectedValue ?? 0) - (a.expectedValue ?? 0));

  // Second eligibility pass, on the only candidates whose requirements are worth fetching: the
  // ones at the top of the list the dashboard actually shows. BigFuture's card list carries no
  // requirements at all, so these reached the scorer as a bare title; its detail page states them
  // plainly. Details are cached forever, so the backlog drains a slice per run.
  const eligibility = buildEligibilityProfile(resolveApplicant(loadVault()) as any);
  const detailCache = await readDetailCache();
  const wanted = ranked
    .filter((c) => c.source === "bigfuture")
    .map((c) => slugOf(c.url))
    .filter((x): x is string => !!x)
    .filter((slug) => !detailCache[slug])
    .slice(0, ENRICH_LIMIT);
  if (wanted.length && !flag("--no-enrich")) {
    console.log(`\nFetching BigFuture requirements for ${wanted.length} top-ranked candidates…`);
    const { fetched, failed } = await fetchDetails(wanted, detailCache, {
      onProgress: (done, total) => { if (done % 60 === 0 || done === total) console.log(`  ${done}/${total}`); },
    });
    await writeDetailCache(detailCache);
    console.log(`  ${fetched} fetched, ${failed} unreadable — ${Object.keys(detailCache).length} cached in all`);
  }

  const lateDq: Candidate[] = [];
  ranked = ranked.filter((c) => {
    const slug = c.source === "bigfuture" ? slugOf(c.url) : null;
    const d = slug ? detailCache[slug] : null;
    if (!d) return true;
    // The detail page is authoritative on the award amount too; the card list produced $20,002
    // for a $2,000 award because React's SSR splits "$" from the digits with a comment node.
    if (d.amountText && d.amountText !== c.amountText) {
      c.amountText = d.amountText;
      c.amount = parseAmount(d.amountText);
      c.amountEstimated = false;
      rank(c);
    }
    c.description = [c.description, detailText(d)].filter(Boolean).join(" ");
    const v = screenEligibility(detailText(d), eligibility);
    if (v.decision !== "disqualified") return true;
    c.flags = [...(c.flags ?? []), "ineligible"];
    c.ineligibleReason = v.reasons[0];
    lateDq.push(c);
    return false;
  });
  if (lateDq.length) {
    console.log(`${lateDq.length} top-ranked candidates disqualified once their requirements were read:`);
    for (const c of lateDq.slice(0, 8)) console.log(`  ${c.name} — ${c.ineligibleReason}`);
    ineligible = [...ineligible, ...lateDq];
  }
  ranked.sort((a, b) => (b.expectedValue ?? 0) - (a.expectedValue ?? 0));

  const output = {
    generated_at: new Date().toISOString(),
    profile: PROFILE_PATH,
    scoring_backend: backend,
    scoring_cost_usd: Number(cost.toFixed(4)),
    sources: statuses,
    ranked,
    low_match: lowMatch,
    removed_scams: scams,
    ineligible,
    needs_browser: NEEDS_BROWSER,
  };
  // Refuse to publish a collapsed harvest over a good one (see publishVerdict).
  const blocked = statuses.filter((st) => st.status === "blocked" || st.status === "error").map((st) => st.source);
  let existingTotal = 0;
  try {
    const prev = await Bun.file(OUTPUT_PATH).json();
    existingTotal = (prev.ranked?.length ?? 0) + (prev.low_match?.length ?? 0) + (prev.removed_scams?.length ?? 0) + (prev.ineligible?.length ?? 0);
  } catch { /* no previous run — nothing to protect */ }
  const freshTotal = ranked.length + lowMatch.length + scams.length + ineligible.length;
  const verdict = publishVerdict({ blocked, fresh: freshTotal, existing: existingTotal });
  if (!verdict.publish) {
    console.error(`\nNOT WRITTEN: ${verdict.reason}.`);
    console.error(`Blocked: ${[...new Set(blocked.map((b) => b.split(" (")[0]))].join(", ")}. Re-run when the source recovers.`);
    process.exitCode = 1;
    return;
  }
  if (blocked.length) console.log(`\n${verdict.reason}.`);
  await Bun.write(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(
    `\nWrote ${ranked.length} ranked (${lowMatch.length} low-match + ${scams.length} scam-flagged + ` +
      `${ineligible.length} ineligible set aside) → ${OUTPUT_PATH}`,
  );

  // Console summary: top N by EV, split by deadline bucket.
  const top = ranked.slice(0, TOP_N);
  const fmt = (c: Candidate) =>
    `  $${String(c.amount ?? `~${FALLBACK_AMOUNT}?`).padEnd(7)} EV $${String(c.expectedValue).padEnd(6)} match ${String(c.match).padStart(3)}% ${c.effort}${(c.flags ?? []).length ? " ⚠" + c.flags!.join(",") : ""}  ${c.name.slice(0, 58)}\n` +
    `           deadline: ${c.deadline ?? "verify at URL"} — ${c.url}`;
  const now = top.filter((c) => deadlineBucket(c.deadline) === "apply_now");
  const future = top.filter((c) => deadlineBucket(c.deadline) === "future");
  console.log(`\n═══ APPLY NOW (${now.length}) ═══`);
  for (const c of now) console.log(fmt(c));
  console.log(`\n═══ FUTURE / NEXT CYCLE (${future.length}) ═══`);
  for (const c of future) console.log(fmt(c));
  console.log(`\n═══ NEEDS BROWSER (Claude for Chrome — see ScholarshipAutomation.md) ═══`);
  for (const n of NEEDS_BROWSER) console.log(`  ${n.site}: ${n.url}\n    ${n.note}`);
  if (scams.length) console.log(`\nRemoved ${scams.length} flagged entries (see removed_scams in the JSON).`);
  if (cost) console.log(`\nScoring cost: $${cost.toFixed(4)}`);

  if (flag("--emit-app")) await emitAppFile(ranked, output.generated_at);
}

// Guarded: importing a helper from this file must not kick off a full harvest.
if (import.meta.main) main().catch((err) => {
  console.error(`scout failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
