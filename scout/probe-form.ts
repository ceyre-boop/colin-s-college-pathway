// Form-probe pass — Layer 2.5, the bridge between "we found a scholarship" and "we can fill it".
//
// The scout stores INFO-page URLs (CareerOneStop detail pages, Unigo listings) — not application
// forms. This script, per scholarship: resolves the info page → the real application URL, fetches
// it, and classifies the form (web form? login-walled? application fee? essay required?). It writes
// a `formMeta` block into scholarship_essays/{slug}/metadata.json and an aggregate apply/targets.json
// that apply/fill.ts consumes.
//
// Honesty doctrine (same as scout.ts): network failures / login walls / fee pages are reported as
// such and routed to the human Chrome path — never faked into "fillable".
//
// Usage:
//   bun scout/probe-form.ts                 # probe every scholarship_essays/*/metadata.json
//   bun scout/probe-form.ts --slug foo-bar  # probe one (repeatable)
//   bun scout/probe-form.ts --top 8         # probe the top N by expected value
//   bun scout/probe-form.ts --dry           # classify + print, write nothing

import { homedir } from "os";
import { join } from "path";
import { readdirSync, existsSync } from "fs";
import {
  type FormMeta,
  type Platform,
  type EssayPrompt,
  computeAutoSubmitEligible,
  routeFor,
} from "../apply/types";

const HOME = homedir();
const INPUT_PATH = join(HOME, "scholarships_found.json");
const ESSAYS_DIR = join(import.meta.dir, "..", "scholarship_essays");
const TARGETS_PATH = join(import.meta.dir, "..", "apply", "targets.json");

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const slugArgs = args.flatMap((a, i) => (a === "--slug" && args[i + 1] ? [args[i + 1]] : []));
const TOP = (() => {
  const i = args.indexOf("--top");
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : 0;
})();

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const slugOf = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);

const stripTags = (html: string) =>
  html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

interface Fetched { finalUrl: string; html: string; status: number; ok: boolean; error?: string }

async function fetchPage(url: string): Promise<Fetched> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html" }, redirect: "follow", signal: ctrl.signal });
    const html = await res.text();
    return { finalUrl: res.url || url, html, status: res.status, ok: res.ok };
  } catch (e) {
    return { finalUrl: url, html: "", status: 0, ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(t);
  }
}

// Infrastructure / nav / social hosts that appear on every page — never the application link.
const DENY_HOSTS = /(careeronestop|myskillsmyfuture|dol\.gov|usa\.gov|ogp\.me|schema\.org|w3\.org|gstatic|facebook|twitter|x\.com|linkedin|instagram|youtube|google\.com\/maps|googleadservices|doubleclick)/i;

function hostOf(u: string): string {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; }
}

function platformOf(host: string): Platform {
  if (/bold\.org/.test(host)) return "bold";
  if (/unigo\.com/.test(host)) return "unigo";
  if (/fastweb\.com/.test(host)) return "fastweb";
  if (/raise\.me/.test(host)) return "raiseme";
  if (/petersons\.com/.test(host)) return "petersons";
  if (/niche\.com/.test(host)) return "niche";
  if (/scholarships360/.test(host)) return "scholarships360";
  if (/docs\.google\.com\/forms|forms\.gle/.test(host)) return "googleform";
  if (/careeronestop\.org/.test(host)) return "careeronestop-info";
  return host ? "direct" : "unknown";
}

// Pull the outbound application link from a CareerOneStop / Unigo info page.
// confidence: high = an explicit apply/website link; medium = exactly one external org host
// (usually the foundation homepage, not the form itself); low = ambiguous / none.
function resolveApplyUrl(infoUrl: string, html: string): { applyUrl: string | null; note: string; confidence: "high" | "medium" | "low" } {
  const base = infoUrl;
  const anchors = [...html.matchAll(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  const byHost = new Map<string, { url: string; text: string; score: number }>();
  for (const m of anchors) {
    const href = m[1];
    const text = stripTags(m[2]).toLowerCase();
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) continue;
    let abs: string;
    try { abs = new URL(href, base).toString(); } catch { continue; }
    const host = hostOf(abs);
    if (!host || DENY_HOSTS.test(host) || host === hostOf(infoUrl)) continue;
    let score = 0;
    if (/apply|application/.test(text)) score += 3;
    if (/scholarship website|visit (the )?(scholarship )?website|official site|learn more/.test(text)) score += 2;
    if (/website/.test(text)) score += 1;
    const prev = byHost.get(host);
    if (!prev || score > prev.score) byHost.set(host, { url: abs, text, score });
  }
  const candidates = [...byHost.values()].sort((a, b) => b.score - a.score);
  if (!candidates.length) return { applyUrl: null, note: "no outbound application link on info page (likely JS-rendered)", confidence: "low" };
  const best = candidates[0];
  const confidence = best.score > 0 ? "high" : candidates.length === 1 ? "medium" : "low";
  const note =
    best.score > 0 ? `resolved via link text "${best.text.slice(0, 40)}"`
    : candidates.length === 1 ? `single external host ${hostOf(best.url)} (homepage, not the form)`
    : `ambiguous: ${candidates.length} external hosts — took ${hostOf(best.url)}`;
  return { applyUrl: best.url, note, confidence };
}

function classifyForm(applyUrl: string, html: string): Omit<FormMeta, "slug" | "infoUrl" | "applyUrl" | "autoSubmitEligible" | "route" | "probedAt"> & { notes: string[] } {
  const host = hostOf(applyUrl);
  const platform = platformOf(host);
  const text = stripTags(html).toLowerCase();
  const notes: string[] = [];

  const applicationFee = /(application|processing|entry)\s+fee|non-?refundable fee|\$\d{1,4}\s+(application|processing) fee/.test(text);
  if (applicationFee) notes.push("⚠ application/processing fee detected — hard stop");

  const passwordField = /<input[^>]*type=["']password["']/i.test(html);
  const loginCopy = /(sign in|log ?in|create an account|register)\s+(to )?(apply|continue|start)/.test(text);
  const knownWalled = /bold\.org|fastweb\.com|raise\.me|niche\.com|petersons\.com/.test(host);
  const loginRequired = passwordField || loginCopy || knownWalled;
  if (loginRequired) notes.push(knownWalled ? `login-walled platform (${platform})` : "login/account required to apply");

  // Form detection: a <form> carrying a textarea or several real inputs (skip pure search/newsletter).
  const forms = [...html.matchAll(/<form[\s\S]*?<\/form>/gi)].map((m) => m[0]);
  let textareaCount = 0;
  let meaningfulInputs = 0;
  const detectedFields = new Set<string>();
  for (const f of forms) {
    textareaCount += (f.match(/<textarea/gi) || []).length;
    for (const im of f.matchAll(/<input\s+[^>]*>/gi)) {
      const tag = im[0];
      const type = (tag.match(/type=["']([^"']+)["']/i)?.[1] || "text").toLowerCase();
      if (["hidden", "submit", "button", "image", "search"].includes(type)) continue;
      meaningfulInputs++;
      const name = tag.match(/name=["']([^"']+)["']/i)?.[1] || tag.match(/placeholder=["']([^"']+)["']/i)?.[1] || tag.match(/id=["']([^"']+)["']/i)?.[1];
      if (name) detectedFields.add(name);
    }
    for (const tm of f.matchAll(/<textarea[^>]*(?:name|id|placeholder)=["']([^"']+)["']/gi)) detectedFields.add(tm[1]);
  }
  const hasWebForm = textareaCount > 0 || meaningfulInputs >= 3;
  if (!hasWebForm && forms.length) notes.push("forms present but look like search/newsletter, not an application");
  if (!forms.length) notes.push("no <form> on page (likely JS-rendered, PDF, or email/mail application)");

  // Essay detection.
  const essayRequired = textareaCount > 0 && /essay|personal statement|tell us|describe|why |short answer|response|in \d{2,4} words/.test(text);
  const essayPrompts: EssayPrompt[] = [];
  if (essayRequired) {
    const wl = text.match(/(\d{2,4})\s*[- ]?word/);
    essayPrompts.push({ prompt: "(detected essay field — verify the real prompt on the page)", wordLimit: wl ? Number(wl[1]) : null });
  }

  return {
    platform,
    hasWebForm,
    loginRequired,
    applicationFee,
    essayRequired,
    essayPrompts,
    detectedFields: [...detectedFields].slice(0, 40),
    notes,
  };
}

async function probeOne(slug: string, name: string, infoUrl: string): Promise<FormMeta> {
  const probedAt = new Date().toISOString();
  const notes: string[] = [];
  const infoHost = hostOf(infoUrl);
  const infoIsAggregator = /careeronestop|unigo/.test(infoHost);

  // 1) resolve the real application URL
  let applyUrl: string | null = infoUrl;
  let confidence: "high" | "medium" | "low" = "high"; // a non-aggregator URL is the apply URL itself
  if (infoIsAggregator) {
    const info = await fetchPage(infoUrl);
    if (!info.ok) { notes.push(`info page fetch failed (${info.status}${info.error ? ": " + info.error : ""})`); }
    const r = resolveApplyUrl(info.finalUrl, info.html);
    applyUrl = r.applyUrl;
    confidence = r.confidence;
    notes.push(r.note);
  }

  if (!applyUrl) {
    const m: Omit<FormMeta, "autoSubmitEligible" | "route"> = {
      slug, infoUrl, applyUrl: null, platform: platformOf(infoHost), hasWebForm: false,
      loginRequired: false, applicationFee: false, essayRequired: false, essayPrompts: [],
      detectedFields: [], probedAt, notes,
    };
    return { ...m, autoSubmitEligible: false, route: "chrome" };
  }

  // 2) fetch + classify the application page
  const page = await fetchPage(applyUrl);
  if (!page.ok) notes.push(`apply page fetch failed (${page.status}${page.error ? ": " + page.error : ""})`);
  const c = classifyForm(page.finalUrl, page.html);
  // A homepage/ambiguous resolution is NOT a verified form URL — never auto-submit it; let a
  // human navigate to the real form via Chrome. Only high-confidence apply links stay automatable.
  const lowTrust = infoIsAggregator && confidence !== "high";
  const allNotes = [...notes, ...c.notes];
  if (lowTrust) allNotes.push(`resolution confidence ${confidence} → Chrome (human navigates to the real form)`);
  const base: Omit<FormMeta, "autoSubmitEligible" | "route"> = {
    slug, infoUrl, applyUrl: page.finalUrl, probedAt,
    platform: c.platform, hasWebForm: c.hasWebForm, loginRequired: c.loginRequired,
    applicationFee: c.applicationFee, essayRequired: c.essayRequired, essayPrompts: c.essayPrompts,
    detectedFields: c.detectedFields, notes: allNotes,
  };
  return {
    ...base,
    autoSubmitEligible: !lowTrust && computeAutoSubmitEligible(base),
    route: lowTrust ? "chrome" : routeFor(base),
  };
}

async function main() {
  if (!existsSync(INPUT_PATH)) { console.error(`No ${INPUT_PATH} — run scout first.`); process.exit(1); }
  const data = await Bun.file(INPUT_PATH).json();
  const ranked: { name: string; url: string }[] = data.ranked ?? [];
  const bySlug = new Map(ranked.map((c) => [slugOf(c.name), c]));

  // Which slugs to probe?
  let slugs: string[];
  if (slugArgs.length) slugs = slugArgs;
  else {
    const dirs = readdirSync(ESSAYS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(ESSAYS_DIR, d.name, "metadata.json")))
      .map((d) => d.name);
    // readdir order is filesystem-dependent — sort by expected_value so --top means top-by-EV.
    const withEv = await Promise.all(dirs.map(async (slug) => {
      let ev = 0;
      try { ev = (await Bun.file(join(ESSAYS_DIR, slug, "metadata.json")).json()).expected_value ?? 0; } catch {}
      return { slug, ev };
    }));
    withEv.sort((a, b) => b.ev - a.ev);
    slugs = (TOP > 0 ? withEv.slice(0, TOP) : withEv).map((x) => x.slug);
  }

  console.log(`Probing ${slugs.length} scholarship(s)...\n`);
  const results: FormMeta[] = [];
  for (const slug of slugs) {
    const metaPath = join(ESSAYS_DIR, slug, "metadata.json");
    let name = slug, infoUrl = "";
    if (existsSync(metaPath)) {
      const md = await Bun.file(metaPath).json();
      name = md.name ?? slug; infoUrl = md.url ?? "";
    }
    if (!infoUrl) { const c = bySlug.get(slug); if (c) { name = c.name; infoUrl = c.url; } }
    if (!infoUrl) { console.log(`  ${slug}: no URL on record — skipping`); continue; }

    const fm = await probeOne(slug, name, infoUrl);
    results.push(fm);
    const tag = fm.route === "playwright" ? (fm.autoSubmitEligible ? "🟢 auto-submit" : "🟡 fill+review") : "🔵 chrome";
    console.log(`  ${tag.padEnd(16)} ${fm.platform.padEnd(18)} ${slug}`);
    console.log(`      apply: ${fm.applyUrl ?? "(unresolved)"}`);
    if (fm.notes.length) console.log(`      notes: ${fm.notes.join(" · ")}`);

    if (!DRY && existsSync(metaPath)) {
      const md = await Bun.file(metaPath).json();
      md.formMeta = fm;
      await Bun.write(metaPath, JSON.stringify(md, null, 2) + "\n");
    }
    await new Promise((r) => setTimeout(r, 800)); // pace
  }

  if (!DRY) {
    await Bun.write(TARGETS_PATH, JSON.stringify({ probedAt: new Date().toISOString(), targets: results }, null, 2) + "\n");
    console.log(`\nWrote ${results.length} formMeta blocks + ${TARGETS_PATH}`);
  }
  const pw = results.filter((r) => r.route === "playwright");
  const auto = pw.filter((r) => r.autoSubmitEligible);
  console.log(`\nRoutes: ${pw.length} playwright (${auto.length} auto-submit / ${pw.length - auto.length} fill+review) · ${results.length - pw.length} chrome`);
}

main().catch((e) => { console.error(`probe failed: ${e instanceof Error ? e.message : e}`); process.exit(1); });
