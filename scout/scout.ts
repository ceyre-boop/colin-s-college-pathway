// Scholarship Scout — Layer 1 (discover) + Layer 2 (score/filter) of the automation stack.
// Finds scholarships matching the profile at ~/.claude/memory/scholarship_profile.json,
// scores each with Claude (eligibility match, effort, legitimacy), and writes a ranked
// list to ~/scholarships_found.json. Layer 3 (form filling) stays with Claude for Chrome
// per ScholarshipAutomation.md — nothing here submits anything.
//
// Sources are split honestly:
//   - HTTP-scrapeable: CareerOneStop (US DOL database, server-rendered), Scholarships360
//     (server-rendered article cards). Fetched directly.
//   - Login-walled / client-side apps: Bold.org, Fastweb, Scholarships.com, Niche, Appily.
//     Emitted as a needs_browser worklist instead of pretending an HTTP fetch would work.
//
// Usage: bun scout/scout.ts [--no-score] [--emit-app] [--top N] [--limit N]
//   --no-score   skip Claude scoring (rank by amount only; no API key needed)
//   --emit-app   also print top finds in the src/data/defaults.js scholarship shape
//   --top N      how many ranked entries in the console summary (default 20)
//   --limit N    cap candidates sent to scoring (default 120)

import { homedir } from "os";
import { join } from "path";
import { PRICING, costUsd } from "../src/lib/essayCost.js";

const HOME = homedir();
const PROFILE_PATH = join(HOME, ".claude", "memory", "scholarship_profile.json");
const OUTPUT_PATH = join(HOME, "scholarships_found.json");
const MODEL = "claude-haiku-4-5";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

interface Candidate {
  name: string;
  org: string | null;
  amount: number | null; // null = "Varies" / unknown
  amountText: string | null;
  deadline: string | null;
  url: string;
  description: string | null;
  source: string;
  // filled by scoring
  match?: number;
  effort?: "low" | "med" | "high";
  flags?: string[];
  expectedValue?: number;
  amountEstimated?: boolean;
}

interface SourceStatus {
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
  "biology",
  "computer science",
  "artificial intelligence",
  "cancer",
  "eagle scout",
  "wrestling",
  "transfer student",
];

async function scrapeCareerOneStop(statuses: SourceStatus[]): Promise<Candidate[]> {
  const byId = new Map<string, Candidate>();
  for (const kw of COS_KEYWORDS) {
    const url = `https://www.careeronestop.org/toolkit/training/find-scholarships.aspx?keyword=${encodeURIComponent(kw)}&curPage=1&pagesize=100`;
    const page = await fetchPage(url);
    if (page.status !== "ok") {
      statuses.push({ source: `careeronestop (${kw})`, status: page.status, count: 0 });
      continue;
    }
    let count = 0;
    // Each result row: detail link + Organization/Purposes blocks, then LOS/type/amount/deadline cells.
    const rows = page.html.split(/<tr>/).slice(1);
    for (const row of rows) {
      const link = row.match(/<a href="(\/Toolkit\/Training\/find-scholarships-detail\.aspx[^"]*scholarshipId=(\d+))"[^>]*>\s*([^<]+?)\s*<\/a>/i);
      if (!link) continue;
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
    statuses.push({ source: `careeronestop (${kw})`, status: count ? "ok" : "empty", count });
  }
  return [...byId.values()];
}

// ---------------------------------------------------------------------------
// Source adapter: Scholarships360 (server-rendered article pages with cards
// linking to scholarships360.org/scholarships/search/<slug>/)
// ---------------------------------------------------------------------------

const S360_PAGES = [
  "https://scholarships360.org/scholarships/stem-scholarships/",
  "https://scholarships360.org/scholarships/no-essay-scholarships/",
  "https://scholarships360.org/scholarships/easy-scholarships-to-apply-for/",
  "https://scholarships360.org/scholarships/scholarships-for-college-sophomores/",
  "https://scholarships360.org/scholarships/michigan-scholarships/",
];

function slugToName(slug: string): string {
  return slug
    .split("-")
    .map((w) => (w.length > 2 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
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
      const amountText = pairs["amount"] ?? null;
      bySlug.set(slug, {
        name: slugToName(slug),
        org: null,
        amount: parseAmount(amountText),
        amountText,
        deadline: pairs["deadline"] ?? null,
        url,
        description: null,
        source: "scholarships360",
      });
      count++;
    }
    statuses.push({ source: label, status: count ? "ok" : "empty", count });
  }
  return [...bySlug.values()];
}

// ---------------------------------------------------------------------------
// Login-walled / client-side sources → browser worklist (Claude for Chrome
// handles these per ScholarshipAutomation.md; an HTTP scraper gets nothing).
// ---------------------------------------------------------------------------

const NEEDS_BROWSER = [
  { site: "Bold.org", url: "https://bold.org/scholarships/", note: "Open-scholarship list is client-side; filter STEM + need-based + no-essay. High volume of $500-$2,500 awards." },
  { site: "Fastweb", url: "https://www.fastweb.com/", note: "Login required. Profile-matched feed; set profile once, harvest matches." },
  { site: "Scholarships.com", url: "https://www.scholarships.com/", note: "Login required. Directory search after profile setup." },
  { site: "Niche", url: "https://www.niche.com/colleges/scholarships/", note: "Bot-detected. $10K no-essay monthly drawing — re-enter every month." },
  { site: "Appily", url: "https://www.appily.com/scholarships/college-sophomores", note: "Client-side search app. Sophomore + transfer filters." },
];

// ---------------------------------------------------------------------------
// Scoring (Layer 2): Claude scores eligibility match, effort, legitimacy.
// Primary: Anthropic API via raw fetch (same pattern as server.ts).
// Fallback: PAI Inference.ts CLI (subscription-billed, no API key needed).
// ---------------------------------------------------------------------------

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
    '  or "suspicious" if the entry smells like lead-gen or a scam.',
    'Note: a category "first generation college student (verify)" is UNVERIFIED — never count it toward a match.',
    'Respond with ONLY a JSON array: [{"i":0,"match":85,"effort":"low","flags":[]},...] — one entry per scholarship, same order.',
  ].join("\n");
  const items = batch.map((c, i) => ({
    i,
    name: c.name,
    org: c.org,
    amount: c.amountText ?? c.amount,
    deadline: c.deadline,
    description: c.description?.slice(0, 250) ?? null,
  }));
  const user = `STUDENT PROFILE:\n${compactProfile(profile)}\n\nSCHOLARSHIPS:\n${JSON.stringify(items)}`;
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

async function scoreAll(profile: any, candidates: Candidate[]): Promise<{ scored: Candidate[]; cost: number; backend: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const backend = apiKey ? `Anthropic API (${MODEL}, $${PRICING[MODEL].in}/M in)` : "PAI Inference.ts (subscription)";
  let cost = 0;
  const BATCH = 15;
  for (let off = 0; off < candidates.length; off += BATCH) {
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
      console.error(`  batch at ${off} failed twice: ${lastErr instanceof Error ? lastErr.message : lastErr}`);
      for (const c2 of batch) if (c2.match === undefined) { c2.match = 50; c2.effort = "med"; c2.flags = ["score_failed"]; }
    }
  }
  return { scored: candidates, cost, backend };
}

// ---------------------------------------------------------------------------
// Ranking + deadline buckets
// ---------------------------------------------------------------------------

const FALLBACK_AMOUNT = 1500; // conservative stand-in when the listing says "Varies"

function rank(c: Candidate): Candidate {
  const amt = c.amount ?? FALLBACK_AMOUNT;
  c.amountEstimated = c.amount === null;
  c.expectedValue = Math.round(amt * ((c.match ?? 50) / 100));
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
    org: c.org ?? c.source,
    amount: c.amount ?? 0,
    deadline: c.deadline ?? "Verify at URL",
    status: deadlineBucket(c.deadline) === "apply_now" ? "apply" : "future",
    priority: (c.expectedValue ?? 0) >= 5000 ? "high" : "medium",
    url: c.url,
    notes: `Scout find (match ${c.match}%, effort ${c.effort}). ${c.description ?? ""}`.trim().slice(0, 160),
    source: "scout",
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
    await finalizeAndReport(all, cached.sources, cost, backend);
    return;
  }

  const profile = await Bun.file(PROFILE_PATH).json();
  console.log(`Profile: ${profile.personal.name} — ${profile.academic.major}, ${profile.academic.current_school}`);

  const statuses: SourceStatus[] = [];
  console.log("\nFetching sources…");
  const [cos, s360] = await Promise.all([scrapeCareerOneStop(statuses), scrapeScholarships360(statuses)]);

  for (const s of statuses) console.log(`  [${s.status.toUpperCase().padEnd(7)}] ${s.source}: ${s.count}`);

  // Cross-source dedupe by normalized name.
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const byName = new Map<string, Candidate>();
  for (const c of [...cos, ...s360]) if (!byName.has(norm(c.name))) byName.set(norm(c.name), c);
  let candidates = [...byName.values()];
  console.log(`\n${candidates.length} unique candidates (${cos.length} CareerOneStop, ${s360.length} Scholarships360)`);

  if (candidates.length > SCORE_LIMIT) {
    // Cap fairly: round-robin across sources, each source's list sorted by amount
    // ("Varies" competes at the fallback stand-in, not zero — otherwise a whole
    // source of no-listed-amount awards gets silently cut before scoring).
    const bySource = new Map<string, Candidate[]>();
    for (const c of candidates) (bySource.get(c.source) ?? bySource.set(c.source, []).get(c.source)!).push(c);
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
    candidates = capped;
    console.log(`Capped to ${SCORE_LIMIT} for scoring, round-robin by source (--limit to change)`);
  }

  let cost = 0;
  let backend = "none (--no-score)";
  if (!flag("--no-score") && candidates.length) {
    console.log(`\nScoring with ${process.env.ANTHROPIC_API_KEY ? "Anthropic API" : "PAI Inference.ts"}…`);
    ({ cost, backend } = await scoreAll(profile, candidates));
  } else {
    for (const c of candidates) { c.match = 50; c.effort = "med"; c.flags = []; }
  }

  await finalizeAndReport(candidates, statuses, cost, backend);
}

// Rank, filter, write JSON, print the summary, optionally regenerate scoutFound.js.
async function finalizeAndReport(candidates: Candidate[], statuses: SourceStatus[], cost: number, backend: string) {
  for (const c of candidates) rank(c);
  // Hard scam signals remove an entry; soft flags (suspicious, missing_org) only warn —
  // the scorer over-flags legitimate awards on data-quality gaps.
  const HARD_FLAGS = ["application_fee", "paid_service"];
  const scams = candidates.filter((c) => (c.flags ?? []).some((f) => HARD_FLAGS.includes(f)));
  // match < 20 = "doesn't qualify" — a $500K faculty award at 5% match is not a $25K EV.
  const lowMatch = candidates.filter((c) => !scams.includes(c) && (c.match ?? 50) < 20);
  const ranked = candidates
    .filter((c) => !scams.includes(c) && !lowMatch.includes(c))
    .sort((a, b) => (b.expectedValue ?? 0) - (a.expectedValue ?? 0));

  const output = {
    generated_at: new Date().toISOString(),
    profile: PROFILE_PATH,
    scoring_backend: backend,
    scoring_cost_usd: Number(cost.toFixed(4)),
    sources: statuses,
    ranked,
    low_match: lowMatch,
    removed_scams: scams,
    needs_browser: NEEDS_BROWSER,
  };
  await Bun.write(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`\nWrote ${ranked.length} ranked (${lowMatch.length} low-match + ${scams.length} scam-flagged set aside) → ${OUTPUT_PATH}`);

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

main().catch((err) => {
  console.error(`scout failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
