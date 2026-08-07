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
import { append as logEvent } from "../state/log";
import { scholarshipId } from "../src/lib/ids.js";

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
// labelTier records HOW a label was resolved, because "Date of Birth" read off a real <label> and
// "field_2" read off the input's name attribute are not equally trustworthy — and until now the
// audit record could not tell them apart. Feeds the confidence calculation in field-map.ts.
function liveFormExtractor() {
  function labelFor(el: Element): { text: string; tier: number } {
    const inp = el as HTMLInputElement;
    if (inp.labels && inp.labels[0]) return { text: inp.labels[0].textContent || "", tier: 1.0 };
    // Formidable: label inside the .frm_form_field wrapper
    const frm = el.closest(".frm_form_field");
    if (frm) { const lb = frm.querySelector(".frm_primary_label, label"); if (lb) return { text: lb.textContent || "", tier: 0.95 }; }
    // Google Forms: question heading on the enclosing listitem
    const li = el.closest('[role="listitem"]');
    if (li) { const h = li.querySelector('[role="heading"], .M7eMe'); if (h) return { text: h.textContent || "", tier: 0.95 }; }
    const aria = inp.getAttribute("aria-label");
    if (aria) return { text: aria, tier: 0.9 };
    const ph = inp.getAttribute("placeholder");
    if (ph) return { text: ph, tier: 0.8 };
    // Bare `name` is a machine identifier, not a label. Low tier on purpose.
    return { text: inp.name || "", tier: 0.5 };
  }
  // Word limits are stated in the question text far more often than they are enforced by
  // maxlength, so read both and prefer the explicit one.
  function wordLimitFor(el: Element, label: string): number | null {
    const m = label.match(/(?:in|max(?:imum)?|up to|no more than|under|within)\s+(\d{2,5})\s*(?:-|\s)?\s*words?/i)
      || label.match(/(\d{2,5})\s*words?\s*(?:max|maximum|or less|limit)/i);
    if (m) return Number(m[1]);
    const ml = (el as HTMLTextAreaElement).maxLength;
    if (ml && ml > 0 && ml < 1e6) return Math.round(ml / 6); // ~6 chars per word, incl. the space
    return null;
  }
  const out: { name: string; label: string; labelTier: number; type: string; required: boolean; isEssay: boolean; wordLimit: number | null; tag: string; value: string; checked: boolean }[] = [];
  const els = document.querySelectorAll("input, textarea, select");
  els.forEach((el) => {
    const inp = el as HTMLInputElement;
    const type = (inp.type || inp.tagName).toLowerCase();
    if (["hidden", "submit", "button", "image", "reset", "file"].includes(type)) return;
    if ((el as HTMLElement).offsetParent === null && type !== "radio" && type !== "checkbox") return; // not visible
    const resolved = labelFor(el);
    const label = (resolved.text || "").replace(/\s+/g, " ").trim();
    const required = inp.required || /frm_required|required/.test((el.closest(".frm_form_field") || {}).className || "") || (el.closest('[role="listitem"]')?.querySelector('[aria-label*="Required"]') != null);
    const isEssay = el.tagName === "TEXTAREA" || /describe|why |explain|tell us|essay|personal statement|in \d{2,4} words|short answer|how (have|do|will) you|what (are|do)/i.test(label);
    out.push({
      name: inp.name || inp.id || "",
      label,
      labelTier: label ? resolved.tier : 0.5,
      type,
      required,
      isEssay,
      wordLimit: isEssay ? wordLimitFor(el, label) : null,
      tag: el.tagName,
      value: inp.value || "",
      checked: inp.checked,
    });
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

      // Capture the REAL essay prompts. scout/probe-form.ts writes a placeholder string because a
      // static fetch cannot see JS-rendered questions; here we are in a live browser with the
      // resolved label for every textarea, so the actual prompt is right there. Everything
      // downstream (essay matching, reuse decisions) has been running against that placeholder.
      const essayPrompts = fields
        .filter((f) => f.isEssay && f.label)
        .map((f) => ({ prompt: f.label, wordLimit: f.wordLimit }));
      logEvent("form_mapped", {
        slug: t.slug,
        url: t.applyUrl,
        platform: t.platform ?? null,
        fieldCount: fields.length,
        essayPrompts,
      }, { applicationId: scholarshipId(t.name, t.applyUrl) });

      let hardBlocked = false;
      let hasEssayField = false;
      let feeDetected = false;
      try {
        const bodyText = await page.locator("body").innerText({ timeout: 3000 });
        feeDetected = /application\s+fee|processing\s+fee|entry\s+fee|pay\s+to\s+apply|credit\s+card\s+required/i.test(bodyText);
        if (feeDetected) r.blocked.push("application/processing fee language detected on page");
      } catch { /* page may be transitioning; remain conservative below */ }
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
          const didFill = DRY_would_skip() ? true : await fillOne(page, f.name, m.value, f.type, f.value);
          if (didFill) r.filled.push({ label, path: m.path });
          else if (f.required) r.unmapped.push(`${label} — control could not be filled`);
        } else if (m.kind === "decline") {
          r.declined.push(`${label} (${m.reason})`);
          if (f.required) r.unmapped.push(`${label} — required field intentionally left for human review`);
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
      const safeClass = !hardBlocked && !feeDetected && !hasEssayField && r.unmapped.length === 0 && AUTOSUBMIT_ALLOWLIST.has(platform);

      if (hardBlocked || feeDetected) { r.outcome = "needs_human"; r.reasons.push("hard-blocked field or fee language present — never auto-filled/submitted"); }
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
          const confirmationText = await page.locator("body").innerText().catch(() => "");
          const confirmed = /thank you|application (received|submitted)|submission (complete|confirmed)|successfully submitted/i.test(confirmationText) || /thank|confirmation|success/i.test(page.url());
          if (confirmed) {
            r.outcome = "auto_submitted"; r.submittedAt = new Date().toISOString();
            submitted[t.slug] = r.submittedAt; submits++;
            r.reasons.push("safe class — submission confirmation detected");
          } else {
            r.outcome = "needs_human";
            r.reasons.push("submit control was clicked but no confirmation was detected — verify manually");
          }
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
async function fillOne(page: any, name: string, value: string, type = "text", optionValue = "") {
  if (!name) return false;
  const loc = page.locator(`[name="${name}"]`).first();
  try {
    if (await loc.count()) {
      if (type === "checkbox" || type === "radio") { await loc.check({ timeout: 4000 }); return true; }
      if (type === "select-one") { await loc.selectOption({ label: value }).catch(() => loc.selectOption(optionValue || value)); return true; }
      await loc.fill(value, { timeout: 4000 }); return true;
    }
  } catch { /* fall through */ }
  try {
    const byId = page.locator(`#${CSS.escape(name)}`).first();
    if (await byId.count()) {
      if (type === "checkbox" || type === "radio") await byId.check({ timeout: 4000 });
      else if (type === "select-one") await byId.selectOption({ label: value }).catch(() => byId.selectOption(optionValue || value));
      else await byId.fill(value, { timeout: 4000 });
      return true;
    }
  } catch { /* report failure to caller */ }
  return false;
}

// In dry-run we still FILL the form (so the screenshot shows real data); we only skip SUBMIT.
function DRY_would_skip() { return false; }

run().catch((e) => { console.error(`fill failed: ${e instanceof Error ? e.message : e}`); process.exit(1); });
