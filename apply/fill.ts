// apply/fill.ts — the apply engine. Opens a scholarship's real application form in a
// persistent-login browser, maps the student's profile into it, applies the hybrid gate,
// and either stages it for human review or (only with --submit, only for the safe class)
// submits it. This is the "applying machine."
//
// SAFETY (enforced in code, non-negotiable — it submits in a real person's name):
//   • --dry is the DEFAULT. It fills + screenshots + classifies and submits NOTHING.
//     Real submission requires the explicit --submit flag.
//   • --max-submit N (default 3) caps submissions per run; can't fire a bug's worth of apps.
//   • Dedupe via apply/results/submitted.json — a slug is never submitted twice.
//   • Any HARD-BLOCK field (SSN/password/payment/bank/gov-id — see field-map.ts) aborts the
//     whole target to the human queue. Login walls and application fees do the same.
//   • Auto-submit is limited to the SAFE CLASS: a fillable web form with no essay/short-answer
//     prompt, no login, no fee, no unmapped-required field, on the trusted-platform allowlist.
//     Anything with an essay/attestation is filled and QUEUED — never auto-sent.
//   • All artifacts (screenshots, filled JSON) go to gitignored apply/results/.
//
// Usage:
//   bun apply/fill.ts                      # dry-run every seed target (fills, submits nothing)
//   bun apply/fill.ts --slug shape-plus-fitness
//   bun apply/fill.ts --submit --max-submit 1   # real submit, safe class only, capped
//   bun apply/fill.ts --targets apply/targets.json

import { homedir } from "os";
import { join } from "path";
import { existsSync, mkdirSync, readFileSync } from "fs";
import type { Applicant } from "./types";
import { mapField, type MapResult } from "./field-map";
import { loadEssayLibrary, matchEssay } from "../scout/essay-match";

const HOME = homedir();
const ROOT = join(import.meta.dir, "..");
const RESULTS_DIR = join(ROOT, "apply", "results");
const USER_DATA_DIR = join(ROOT, "apply", ".userdata");
const SUBMITTED_PATH = join(RESULTS_DIR, "submitted.json");
const APPLICANT_PATH = join(ROOT, "applicant.local.json");

const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const val = (f: string, d: string) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const DRY = !has("--submit"); // dry-run unless --submit is explicitly passed
const MAX_SUBMIT = Number(val("--max-submit", "3"));
const ONLY_SLUG = val("--slug", "");
const TARGETS_FILE = val("--targets", join(ROOT, "apply", "seed-targets.json"));

// Trusted platforms allowed to AUTO-submit. Conservative on purpose.
const AUTOSUBMIT_ALLOWLIST = new Set(["googleform", "direct-formidable"]);

interface Target { slug: string; name: string; amount?: number | null; applyUrl: string; platform?: string; }

type Outcome = "auto_submitted" | "filled_ready" | "needs_human" | "needs_essay" | "skipped_dedupe" | "error";
interface Result {
  slug: string; name: string; amount: number | null; applyUrl: string;
  outcome: Outcome; reasons: string[];
  filled: { label: string; path: string }[];
  declined: string[]; unmapped: string[]; blocked: string[];
  essay?: { bucket: string; angle: string | null };
  filledShot?: string; submittedAt?: string;
}

// --- live form extraction (platform-aware label resolution) ---------------------------------
// Returns {name, label, type, required, isEssay} for every visible, fillable field.
function liveFormExtractor() {
  function labelFor(el: Element): string {
    const inp = el as HTMLInputElement;
    if (inp.labels && inp.labels[0]) return inp.labels[0].textContent || "";
    // Formidable: label inside the .frm_form_field wrapper
    const frm = el.closest(".frm_form_field");
    if (frm) { const lb = frm.querySelector(".frm_primary_label, label"); if (lb) return lb.textContent || ""; }
    // Google Forms: question heading on the enclosing listitem
    const li = el.closest('[role="listitem"]');
    if (li) { const h = li.querySelector('[role="heading"], .M7eMe'); if (h) return h.textContent || ""; }
    // aria-label / placeholder fallback
    return inp.getAttribute("aria-label") || inp.getAttribute("placeholder") || inp.name || "";
  }
  const out: { name: string; label: string; type: string; required: boolean; isEssay: boolean; tag: string }[] = [];
  const els = document.querySelectorAll("input, textarea, select");
  els.forEach((el) => {
    const inp = el as HTMLInputElement;
    const type = (inp.type || inp.tagName).toLowerCase();
    if (["hidden", "submit", "button", "image", "reset", "file"].includes(type)) return;
    if ((el as HTMLElement).offsetParent === null && type !== "radio" && type !== "checkbox") return; // not visible
    const label = (labelFor(el) || "").replace(/\s+/g, " ").trim();
    const required = inp.required || /frm_required|required/.test((el.closest(".frm_form_field") || {}).className || "") || (el.closest('[role="listitem"]')?.querySelector('[aria-label*="Required"]') != null);
    const isEssay = el.tagName === "TEXTAREA" || /describe|why |explain|tell us|essay|personal statement|in \d{2,4} words|short answer|how (have|do|will) you|what (are|do)/i.test(label);
    out.push({ name: inp.name || inp.id || "", label, type, required, isEssay, tag: el.tagName });
  });
  return out;
}

function loadJson<T>(p: string, d: T): T { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return d; } }

async function run() {
  if (!existsSync(APPLICANT_PATH)) { console.error(`Missing ${APPLICANT_PATH} — populate it first (gitignored).`); process.exit(1); }
  const applicant: Applicant = loadJson(APPLICANT_PATH, {} as Applicant);
  const essayLib = loadEssayLibrary();
  const targetsData = loadJson<{ targets: Target[] }>(TARGETS_FILE, { targets: [] });
  let targets = targetsData.targets || [];
  if (ONLY_SLUG) targets = targets.filter((t) => t.slug === ONLY_SLUG);
  if (!targets.length) { console.error(`No targets in ${TARGETS_FILE}${ONLY_SLUG ? ` matching --slug ${ONLY_SLUG}` : ""}.`); process.exit(1); }

  mkdirSync(RESULTS_DIR, { recursive: true });
  const submitted: Record<string, string> = loadJson(SUBMITTED_PATH, {});

  console.log(`\n${DRY ? "🌵 DRY RUN (nothing will be submitted)" : `🚨 LIVE SUBMIT enabled — max ${MAX_SUBMIT}`} · ${targets.length} target(s)\n`);

  const { chromium } = await import("playwright");
  const ctx = await chromium.launchPersistentContext(USER_DATA_DIR, { headless: false, viewport: { width: 1440, height: 900 } });
  const page = ctx.pages()[0] ?? (await ctx.newPage());

  const results: Result[] = [];
  let submits = 0;

  for (const t of targets) {
    const r: Result = { slug: t.slug, name: t.name, amount: t.amount ?? null, applyUrl: t.applyUrl, outcome: "filled_ready", reasons: [], filled: [], declined: [], unmapped: [], blocked: [] };
    try {
      if (submitted[t.slug]) { r.outcome = "skipped_dedupe"; r.reasons.push(`already submitted ${submitted[t.slug]}`); results.push(r); console.log(`  ⏭  ${t.slug}: already submitted`); continue; }

      await page.goto(t.applyUrl, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2500);

      // login wall? (CB/OAuth or a password field)
      const url = page.url();
      const hasPassword = await page.locator('input[type="password"]').count();
      if (/login|signin|sign-in|oauth|authorize/i.test(url) || hasPassword) {
        r.outcome = "needs_human"; r.reasons.push("login/account wall — human must sign in"); results.push(r); console.log(`  🔒 ${t.slug}: login wall → queued`); continue;
      }

      const fields = await page.evaluate(liveFormExtractor);
      if (!fields.length) { r.outcome = "needs_human"; r.reasons.push("no fillable form detected (JS-rendered / PDF / email apply)"); results.push(r); console.log(`  📄 ${t.slug}: no form → queued`); continue; }

      let hardBlocked = false;
      let hasEssayField = false;
      for (const f of fields) {
        const label = f.label || f.name;
        const m: MapResult = mapField(label, applicant);
        if (m.kind === "block") { r.blocked.push(`${label} (${m.reason})`); hardBlocked = true; continue; }
        if (f.isEssay) {
          hasEssayField = true;
          const em = matchEssay(label, null, essayLib);
          r.essay = { bucket: em.bucket, angle: em.angle };
          // Short-answer/essay prompts are human-gated; we don't jam a reused essay in and we
          // never auto-submit. Leave for review (or fill if a same-length reuse existed).
          r.declined.push(`${label} → essay/short-answer (${em.bucket}) — left for human`);
          continue;
        }
        if (m.kind === "fill") {
          if (!DRY_would_skip()) await fillOne(page, f.name, m.value);
          r.filled.push({ label, path: m.path });
        } else if (m.kind === "decline") {
          r.declined.push(`${label} (${m.reason})`);
        } else {
          if (f.required) r.unmapped.push(label);
        }
      }

      // screenshot the filled form
      const shotDir = join(RESULTS_DIR, t.slug); mkdirSync(shotDir, { recursive: true });
      const shot = join(shotDir, "filled.png");
      await page.screenshot({ path: shot, fullPage: true });
      r.filledShot = shot;

      // classify (the gate)
      const platform = t.platform === "direct" ? "direct-formidable" : (t.platform || "unknown");
      const safeClass = !hardBlocked && !hasEssayField && r.unmapped.length === 0 && AUTOSUBMIT_ALLOWLIST.has(platform);

      if (hardBlocked) { r.outcome = "needs_human"; r.reasons.push("hard-blocked field present (SSN/fee/login) — never auto-filled"); }
      else if (hasEssayField) { r.outcome = "needs_essay"; r.reasons.push("form has an essay/short-answer prompt — filled personal fields, queued for review"); }
      else if (r.unmapped.length) { r.outcome = "filled_ready"; r.reasons.push(`${r.unmapped.length} required field(s) unmapped — human completes + submits`); }
      else if (!AUTOSUBMIT_ALLOWLIST.has(platform)) { r.outcome = "filled_ready"; r.reasons.push(`platform "${platform}" not on auto-submit allowlist — queued for review`); }
      else r.outcome = "filled_ready";

      // real submission — only safe class, only with --submit, only under the cap
      if (safeClass && !DRY && submits < MAX_SUBMIT) {
        const btn = page.locator('button[type="submit"], input[type="submit"], button:has-text("Submit"), button:has-text("Apply")').first();
        if (await btn.count()) {
          await btn.click();
          await page.waitForTimeout(3000);
          await page.screenshot({ path: join(shotDir, "confirmation.png"), fullPage: true });
          r.outcome = "auto_submitted"; r.submittedAt = new Date().toISOString();
          submitted[t.slug] = r.submittedAt; submits++;
          r.reasons.push("safe class — auto-submitted");
        }
      } else if (safeClass && DRY) {
        r.reasons.push("safe class — WOULD auto-submit (dry run)");
      }

      const icon = { auto_submitted: "✅", filled_ready: "🟡", needs_human: "🔒", needs_essay: "📝", skipped_dedupe: "⏭", error: "⚠" }[r.outcome];
      console.log(`  ${icon} ${t.slug}: ${r.outcome} — filled ${r.filled.length}, unmapped ${r.unmapped.length}, blocked ${r.blocked.length}${r.essay ? `, essay:${r.essay.bucket}` : ""}`);
      results.push(r);
    } catch (e) {
      r.outcome = "error"; r.reasons.push(e instanceof Error ? e.message : String(e));
      results.push(r); console.log(`  ⚠  ${t.slug}: error — ${r.reasons.at(-1)}`);
    }
    // write per-target result
    const shotDir = join(RESULTS_DIR, t.slug); mkdirSync(shotDir, { recursive: true });
    await Bun.write(join(shotDir, "result.json"), JSON.stringify(r, null, 2));
  }

  await Bun.write(SUBMITTED_PATH, JSON.stringify(submitted, null, 2));
  await Bun.write(join(RESULTS_DIR, "last-run.json"), JSON.stringify({ ranAt: new Date().toISOString(), dry: DRY, results }, null, 2));
  await ctx.close();

  const by = (o: Outcome) => results.filter((r) => r.outcome === o).length;
  console.log(`\n── summary ──`);
  console.log(`  ✅ auto-submitted: ${by("auto_submitted")}   🟡 filled & ready: ${by("filled_ready")}   📝 needs essay: ${by("needs_essay")}   🔒 needs human: ${by("needs_human")}`);
  console.log(`  artifacts → apply/results/  (this run cost $0.00 — no API calls)\n`);
}

// helper: fill one field by its name/id via a resilient locator
async function fillOne(page: any, name: string, value: string) {
  if (!name) return;
  const loc = page.locator(`[name="${name}"]`).first();
  try { if (await loc.count()) { await loc.fill(value, { timeout: 4000 }); return; } } catch { /* fall through */ }
  try { const byId = page.locator(`#${CSS.escape(name)}`).first(); if (await byId.count()) await byId.fill(value, { timeout: 4000 }); } catch { /* give up quietly */ }
}

// In dry-run we still FILL the form (so the screenshot shows real data); we only skip SUBMIT.
function DRY_would_skip() { return false; }

run().catch((e) => { console.error(`fill failed: ${e instanceof Error ? e.message : e}`); process.exit(1); });
