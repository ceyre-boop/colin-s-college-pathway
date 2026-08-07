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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { createHash } from "crypto";
import type { Applicant } from "./types";
import { mapField, pathForLabel, type MapResult } from "./field-map";
import { loadEssayLibrary, matchEssay } from "../scout/essay-match";
import { append as logEvent } from "../state/log";
import { scholarshipId } from "../src/lib/ids.js";
import { loadVault } from "../identity/vault";
import { grantForLabels, open } from "../identity/broker";
import { raise } from "../state/queue";
import { begin, complete, fail } from "../state/operations";

const HOME = homedir();
const ROOT = join(import.meta.dir, "..");
const RESULTS_DIR = join(ROOT, "apply", "results");
const USER_DATA_DIR = join(ROOT, "apply", ".userdata");
const SUBMITTED_PATH = join(RESULTS_DIR, "submitted.json");
// Identity is read from identity/vault.json via the broker — applicant.local.json is now only the
// migration source (see identity/migrate-vault.ts) and is no longer read at fill time.

const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const val = (f: string, d: string) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const DRY = !has("--submit"); // dry-run unless --submit is explicitly passed
const MAX_SUBMIT = Number(val("--max-submit", "3"));
const ONLY_SLUG = val("--slug", "");
const TARGETS_FILE = val("--targets", join(ROOT, "apply", "seed-targets.json"));

// Trusted platforms allowed to AUTO-submit. Conservative on purpose.
const AUTOSUBMIT_ALLOWLIST = new Set(["googleform", "direct-formidable"]);

// Confidence gates.
//   >= AUTOFILL : fill silently.
//   >= ASK      : fill, but flag for review — and never auto-submit the form.
//   <  ASK      : do not type anything; hand the field to the human.
// Full confidence-gated auto-submit also requires a proven portal adapter (a later phase); until
// then this only ever TIGHTENS the existing allowlist gate, never loosens it.
const AUTOFILL_THRESHOLD = 0.98;
const ASK_THRESHOLD = 0.8;

interface Target { slug: string; name: string; amount?: number | null; applyUrl: string; platform?: string; }

type Outcome = "auto_submitted" | "filled_ready" | "needs_human" | "needs_essay" | "skipped_dedupe" | "error";
interface Result {
  slug: string; name: string; amount: number | null; applyUrl: string;
  outcome: Outcome; reasons: string[];
  filled: { label: string; path: string; confidence?: number; factors?: Record<string, number> }[];
  declined: string[]; unmapped: string[]; blocked: string[];
  /** Filled, but under the autofill bar — a human should glance at these before submitting. */
  flagged?: { label: string; path: string; confidence: number }[];
  /** Not filled: either policy-blocked or below the ask bar. */
  lowConfidence?: { label: string; path: string; confidence: number; reason: string }[];
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
  // Identity now comes from the vault, not the flat profile file. The vault carries per-field
  // verification metadata, which is what makes the freshness factor in the confidence score real
  // rather than a constant.
  let vault;
  try {
    vault = loadVault();
  } catch (e) {
    console.error(`✗ ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
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
    const appId = scholarshipId(t.name, t.applyUrl);
    const r: Result = { slug: t.slug, name: t.name, amount: t.amount ?? null, applyUrl: t.applyUrl, outcome: "filled_ready", reasons: [], filled: [], declined: [], unmapped: [], blocked: [] };
    try {
      if (submitted[t.slug]) { r.outcome = "skipped_dedupe"; r.reasons.push(`already submitted ${submitted[t.slug]}`); results.push(r); console.log(`  ⏭  ${t.slug}: already submitted`); continue; }

      await page.goto(t.applyUrl, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2500);

      // The page is an untrusted interface we observe and act through — never authoritative state.
      // Everything below reads it, decides, and records the decision in the log.

      // Bot challenge? Raise and STOP. Nothing here attempts to solve or evade one.
      const captcha = await page.locator(
        'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[title*="challenge" i], .g-recaptcha, .h-captcha, [data-sitekey], #cf-challenge-running',
      ).count();
      if (captcha) {
        raise({ type: "CAPTCHA_REQUIRED", applicationId: appId, context: { slug: t.slug, url: t.applyUrl } });
        r.outcome = "needs_human"; r.reasons.push("bot challenge present — never worked around");
        results.push(r); console.log(`  🤖 ${t.slug}: CAPTCHA → checkpoint`); continue;
      }

      // MFA is distinguishable from an ordinary login wall and is a different human action.
      const bodyForGates = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
      if (/\b(two[- ]factor|2fa|verification code|one[- ]time (code|passcode)|authenticator app)\b/i.test(bodyForGates)) {
        raise({ type: "MFA_REQUIRED", applicationId: appId, context: { slug: t.slug, url: t.applyUrl } });
        r.outcome = "needs_human"; r.reasons.push("two-factor prompt — code is on the user's device");
        results.push(r); console.log(`  🔑 ${t.slug}: MFA → checkpoint`); continue;
      }

      // login wall? (CB/OAuth or a password field)
      const url = page.url();
      const hasPassword = await page.locator('input[type="password"]').count();
      if (/login|signin|sign-in|oauth|authorize/i.test(url) || hasPassword) {
        raise({ type: "ACCOUNT_REQUIRED", applicationId: appId, context: { slug: t.slug, url: t.applyUrl } });
        r.outcome = "needs_human"; r.reasons.push("login/account wall — human must sign in"); results.push(r); console.log(`  🔒 ${t.slug}: login wall → checkpoint`); continue;
      }

      const fields = await page.evaluate(liveFormExtractor);
      if (!fields.length) {
        raise({ type: "PORTAL_MALFUNCTION", applicationId: appId, context: { slug: t.slug }, evidenceRefs: { error_detail: "no fillable form detected (JS-rendered / PDF / email apply)" } });
        r.outcome = "needs_human"; r.reasons.push("no fillable form detected (JS-rendered / PDF / email apply)"); results.push(r); console.log(`  📄 ${t.slug}: no form → checkpoint`); continue;
      }

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
      }, { applicationId: appId });

      // Grant is computed from THIS form's labels, before the vault is opened. A form asking for
      // six things gets six paths — a hidden seventh field cannot be answered even if something
      // tried, and the attempt is logged as capability_denied rather than passing silently.
      const grant = grantForLabels(
        fields.map((f) => f.label || f.name),
        pathForLabel,
        `fill:${t.slug}`,
        appId,
      );
      const broker = open(grant, vault);
      const applicant: Applicant = broker.restrictedApplicant();
      const flagged: NonNullable<Result["flagged"]> = [];
      const lowConfidence: NonNullable<Result["lowConfidence"]> = [];

      let hardBlocked = false;
      let hasEssayField = false;
      let feeDetected = false;
      try {
        const bodyText = await page.locator("body").innerText({ timeout: 3000 });
        feeDetected = /application\s+fee|processing\s+fee|entry\s+fee|pay\s+to\s+apply|credit\s+card\s+required/i.test(bodyText);
        if (feeDetected) {
          r.blocked.push("application/processing fee language detected on page");
          raise({ type: "APPLICATION_FEE", applicationId: appId, context: { slug: t.slug }, evidenceRefs: { fee_evidence: t.applyUrl } });
        }
      } catch { /* page may be transitioning; remain conservative below */ }
      for (const f of fields) {
        const label = f.label || f.name;
        const path = pathForLabel(label);
        const m: MapResult = mapField(label, applicant, {
          labelTier: f.labelTier,
          freshness: path ? broker.freshnessOf(path) : 1.0,
        });
        if (m.kind === "block") {
          r.blocked.push(`${label} (${m.reason})`);
          hardBlocked = true;
          raise({ type: "BLOCKED_FIELD_PRESENT", applicationId: appId, context: { slug: t.slug, fieldLabel: label, reason: m.reason }, evidenceRefs: { field_label: label } });
          continue;
        }
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
          const c = m.confidence.score;
          // Vault policy first: some paths are never auto-typed regardless of how confident the
          // mapper is (financial answers, document uploads). Policy outranks probability.
          if (!broker.autofillAllowed(m.path)) {
            r.declined.push(`${label} → ${m.path} is policy-blocked from autofill`);
            if (f.required) r.unmapped.push(`${label} — policy requires a human to enter this`);
            lowConfidence.push({ label, path: m.path, confidence: c, reason: "policy" });
            // Financial paths get their own checkpoint type — a different question with a
            // different answer shape than "is this mapping right".
            raise({
              type: m.path.startsWith("financial.") ? "FINANCIAL_FIELD_REVIEW" : "FIELD_MAPPING_UNCERTAIN",
              applicationId: appId,
              context: { slug: t.slug, fieldLabel: label, path: m.path, reason: "policy" },
              evidenceRefs: { field_label: label, confidence: String(c) },
            });
            continue;
          }
          if (c < ASK_THRESHOLD) {
            // Below the ask bar: do not type anything. This is the case that used to fill
            // silently and wrongly — "Marital Status" resolving to a class level, for instance.
            r.declined.push(`${label} → confidence ${c.toFixed(2)} below ${ASK_THRESHOLD} — left for human`);
            r.unmapped.push(`${label} — mapping uncertain (${m.path} @ ${c.toFixed(2)})`);
            lowConfidence.push({ label, path: m.path, confidence: c, reason: "below-ask-threshold" });
            logEvent("field_skipped", { label, path: m.path, confidence: m.confidence }, { applicationId: appId });
            raise({
              type: "FIELD_MAPPING_UNCERTAIN",
              applicationId: appId,
              context: { slug: t.slug, fieldLabel: label, path: m.path, competingRules: m.confidence.competingRules },
              evidenceRefs: { field_label: label, confidence: c.toFixed(3) },
            });
            continue;
          }
          const didFill = DRY_would_skip() ? true : await fillOne(page, f.name, m.value, f.type, f.value);
          if (didFill) {
            r.filled.push({ label, path: m.path, confidence: c, factors: m.confidence.factors });
            // Value is deliberately NOT logged — the log records which profile path answered which
            // label and why, which is what an audit needs, without duplicating PII into a second file.
            logEvent("field_filled", { label, path: m.path, confidence: m.confidence, flagged: c < AUTOFILL_THRESHOLD }, { applicationId: appId });
            if (c < AUTOFILL_THRESHOLD) flagged.push({ label, path: m.path, confidence: c });
          }
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
      if (flagged.length) r.flagged = flagged;
      if (lowConfidence.length) r.lowConfidence = lowConfidence;

      const platform = t.platform === "direct" ? "direct-formidable" : (t.platform || "unknown");
      // Every filled field must have cleared the autofill bar. This is an ADDITIONAL condition on
      // top of the pre-existing allowlist gate — it can only shrink the auto-submit class.
      const allConfident = flagged.length === 0;
      const safeClass = !hardBlocked && !feeDetected && !hasEssayField && r.unmapped.length === 0 && allConfident && AUTOSUBMIT_ALLOWLIST.has(platform);

      if (hardBlocked || feeDetected) { r.outcome = "needs_human"; r.reasons.push("hard-blocked field or fee language present — never auto-filled/submitted"); }
      else if (hasEssayField) { r.outcome = "needs_essay"; r.reasons.push("form has an essay/short-answer prompt — filled personal fields, queued for review"); }
      else if (r.unmapped.length) { r.outcome = "filled_ready"; r.reasons.push(`${r.unmapped.length} required field(s) unmapped — human completes + submits`); }
      else if (!allConfident) { r.outcome = "filled_ready"; r.reasons.push(`${flagged.length} field(s) filled below ${AUTOFILL_THRESHOLD} confidence — human verifies before submitting`); }
      else if (!AUTOSUBMIT_ALLOWLIST.has(platform)) { r.outcome = "filled_ready"; r.reasons.push(`platform "${platform}" not on auto-submit allowlist — queued for review`); }
      else r.outcome = "filled_ready";

      const denials = broker.denied();
      if (denials.length) r.reasons.push(`${denials.length} identity path(s) requested outside the grant — see capability_denied events`);

      // Evidence for an irreversible action: exactly what was rendered into the form. The full
      // values go to the gitignored artifact; the EVENT carries only the digest and a reference,
      // so the log stays free of duplicated PII while remaining verifiable against the artifact.
      const rendered = r.filled.map((x) => ({ label: x.label, path: x.path, confidence: x.confidence }));
      const renderedDigest = createHash("sha256").update(JSON.stringify(rendered)).digest("hex").slice(0, 16);
      const renderedPath = join(shotDir, `rendered-${renderedDigest}.json`);
      writeFileSync(renderedPath, JSON.stringify({ slug: t.slug, applicationId: appId, digest: renderedDigest, fields: rendered }, null, 2));

      // real submission — only safe class, only with --submit, only under the cap
      if (safeClass && !DRY && submits < MAX_SUBMIT) {
        // Idempotency: a crash between click and confirmation must NEVER produce a second attempt.
        const op = begin("submit_application", appId, { digest: renderedDigest, url: t.applyUrl });
        if (!op.proceed && op.reason === "already_completed") {
          r.outcome = "skipped_dedupe"; r.reasons.push("this exact submission already completed");
        } else if (!op.proceed) {
          // Started but never confirmed — genuinely unknown whether it went through. Ask.
          raise({
            type: "SUBMIT_APPROVAL",
            applicationId: appId,
            context: { slug: t.slug, situation: "a previous run clicked submit but never recorded a confirmation" },
            evidenceRefs: { filled_screenshot: shot, rendered_digest: renderedDigest },
          });
          r.outcome = "needs_human"; r.reasons.push("previous submission attempt is in doubt — verify before retrying");
        } else {
          const btn = page.locator('button[type="submit"], input[type="submit"], button:has-text("Submit"), button:has-text("Apply")').first();
          // Several forms render more than one submit control (a real one plus a newsletter
          // signup). Ambiguity about WHICH button submits is not something to resolve by guessing.
          const btnCount = await page.locator('button[type="submit"], input[type="submit"]').count();
          if (btnCount > 1) {
            fail(op.id, appId, "multiple submit controls");
            raise({
              type: "SUBMIT_APPROVAL",
              applicationId: appId,
              context: { slug: t.slug, situation: `${btnCount} submit controls on the page — which one is the application?` },
              evidenceRefs: { filled_screenshot: shot, rendered_digest: renderedDigest },
            });
            r.outcome = "needs_human"; r.reasons.push(`${btnCount} submit controls — ambiguous, queued`);
          } else if (await btn.count()) {
            await btn.click();
            await page.waitForTimeout(3000);
            await page.screenshot({ path: join(shotDir, "confirmation.png"), fullPage: true });
            const confirmationText = await page.locator("body").innerText().catch(() => "");
            const confirmed = /thank you|application (received|submitted)|submission (complete|confirmed)|successfully submitted/i.test(confirmationText) || /thank|confirmation|success/i.test(page.url());
            if (confirmed) {
              r.outcome = "auto_submitted"; r.submittedAt = new Date().toISOString();
              submitted[t.slug] = r.submittedAt; submits++;
              r.reasons.push("safe class — submission confirmation detected");
              complete(op.id, appId, { confirmationShot: join(shotDir, "confirmation.png") });
              logEvent("submitted", {
                slug: t.slug, operationId: op.id, renderedDigest, renderedRef: renderedPath,
                confirmationShot: join(shotDir, "confirmation.png"),
                actor: "agent", policy: `autoconfidence>=${AUTOFILL_THRESHOLD}, allowlist:${platform}`,
              }, { applicationId: appId });
              logEvent("state_changed", { to: "SUBMITTED", by: "agent" }, { applicationId: appId });
            } else {
              // Clicked, but the page never confirmed. Leave the operation OPEN so the next run
              // treats it as in-doubt rather than silently trying again.
              r.outcome = "needs_human";
              r.reasons.push("submit control was clicked but no confirmation was detected — verify manually");
              logEvent("submission_unconfirmed", { slug: t.slug, operationId: op.id, renderedDigest }, { applicationId: appId });
              raise({
                type: "SUBMIT_APPROVAL",
                applicationId: appId,
                context: { slug: t.slug, situation: "submit was clicked but no confirmation appeared" },
                evidenceRefs: { filled_screenshot: shot, rendered_digest: renderedDigest },
              });
            }
          } else {
            fail(op.id, appId, "no submit control found");
          }
        }
      } else if (safeClass && DRY) {
        r.reasons.push("safe class — WOULD auto-submit (dry run)");
      } else if (!DRY && !safeClass) {
        // Not auto-submittable, but filled and screenshotted: ask for approval rather than
        // dropping it into a results file nobody re-reads.
        raise({
          type: "SUBMIT_APPROVAL",
          applicationId: appId,
          context: { slug: t.slug, situation: r.reasons[0] ?? "not in the auto-submit class" },
          evidenceRefs: { filled_screenshot: shot, rendered_digest: renderedDigest },
        });
      }

      logEvent("form_filled", {
        slug: t.slug, outcome: r.outcome, filled: r.filled.length,
        unmapped: r.unmapped.length, blocked: r.blocked.length,
        flagged: flagged.length, renderedDigest,
      }, { applicationId: appId });

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
