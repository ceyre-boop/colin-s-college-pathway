// Source adapter: ProPublica Nonprofit Explorer (free, no key) — NTEE code B82
// ("Scholarships, Student Financial Aid, Awards"). Free-text HTTP JSON, no bot wall.
//
// This is a deliberately different kind of source than every other adapter in scout.ts. Those
// scrape *listings* — a live scholarship with a deadline and an apply link. A 990 filer is a
// *foundation* — evidence that a scholarship-granting org exists, not proof of a currently open
// program. Conflating the two would let a defunct or dormant foundation masquerade as a real
// opportunity, so every candidate here is marked `needsResearch: true` and carries no deadline;
// scoring and the human queue must treat it as a research lead, not a pre-verified listing.
//
// Why bother: the report this adapter answers points out that the big aggregators (CareerOneStop,
// Scholarships360, Unigo, BigFuture) all surface the same national pool with large applicant
// counts. Small local/regional foundations rarely make it onto those sites at all but file a 990
// like everyone else — this is the free, keyless way to find them.
//
// API docs: https://projects.propublica.org/nonprofits/api/ — no auth, ~1 req/sec is polite.

import type { Candidate, SourceStatus } from "./scout";

const BASE = "https://projects.propublica.org/nonprofits/api/v2/search.json";
const NTEE_SCHOLARSHIPS = "B82";
// One state-scoped pass (home state — best odds per the report's own thesis) plus one
// broader national pass, both capped in page count so this stays a fast, polite adapter.
const QUERIES: { label: string; params: Record<string, string>; maxPages: number }[] = [
  { label: "propublica990 (MI)", params: { "state[id]": "MI" }, maxPages: 2 },
  { label: "propublica990 (national)", params: {}, maxPages: 1 },
];

interface ProPublicaOrg {
  ein: number;
  name: string;
  sub_name: string | null;
  city: string | null;
  state: string | null;
  ntee_code: string | null;
  guidestar_url: string | null;
  nccs_url: string | null;
}

interface ProPublicaResponse {
  total_results: number;
  num_pages: number;
  organizations: ProPublicaOrg[];
}

async function fetchPage(params: Record<string, string>, page: number): Promise<{ status: "ok" | "blocked" | "error"; data: ProPublicaResponse | null }> {
  const url = new URL(BASE);
  url.searchParams.set("q", "scholarship");
  // NOTE: the API's own ntee[id] filter currently 500s (verified 2026-08-21, both alone and
  // combined with other params) — filtering by NTEE_SCHOLARSHIPS happens client-side below
  // instead. The free-text "scholarship" query already surfaces mostly B82-coded orgs.
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  if (page) url.searchParams.set("page", String(page));
  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return { status: res.status === 403 || res.status === 429 ? "blocked" : "error", data: null };
    const data = (await res.json()) as ProPublicaResponse;
    return { status: "ok", data };
  } catch (err) {
    return { status: "error", data: null };
  }
}

export async function scrapePropublica990(statuses: SourceStatus[]): Promise<Candidate[]> {
  const byEin = new Map<number, Candidate>();

  for (const { label, params, maxPages } of QUERIES) {
    let total = 0;
    let pagesFetched = 0;
    for (let page = 0; page < maxPages; page++) {
      if (pagesFetched) await new Promise((r) => setTimeout(r, 1000)); // polite pacing between pages
      const result = await fetchPage(params, page);
      pagesFetched++;
      if (result.status !== "ok" || !result.data) {
        statuses.push({ source: label, status: result.status, count: total });
        break;
      }
      for (const org of result.data.organizations) {
        // NTEE search is a text match, not a hard filter — re-check the code so a false
        // positive from the free-text "scholarship" query doesn't slip through as B82.
        if (org.ntee_code && !org.ntee_code.startsWith(NTEE_SCHOLARSHIPS)) continue;
        if (byEin.has(org.ein)) continue;
        total++;
        byEin.set(org.ein, {
          name: org.sub_name || org.name,
          org: org.name,
          amount: null, // 990 filings don't publish per-award amounts
          amountText: null,
          deadline: null, // a foundation has no single deadline — that lives on its own program page
          url: org.nccs_url || org.guidestar_url || `https://projects.propublica.org/nonprofits/organizations/${org.ein}`,
          description:
            `501(c)(3) scholarship-granting foundation (EIN ${org.ein}${org.city ? `, ${org.city}${org.state ? `, ${org.state}` : ""}` : ""}) ` +
            `found via IRS Form 990 (NTEE ${org.ntee_code ?? NTEE_SCHOLARSHIPS}). Research lead, not a verified open ` +
            `program — find the foundation's own site and confirm a current scholarship cycle before treating it as real.`,
          source: "propublica990",
          needsResearch: true,
        });
      }
      const morePages = result.data.num_pages > page + 1;
      if (!morePages) break;
    }
    if (!statuses.some((s) => s.source === label)) statuses.push({ source: label, status: total ? "ok" : "empty", count: total });
  }

  return [...byEin.values()];
}
