// Essay selection layer — sits between the scout's ranked JSON and the essay
// directory. Picks the top N scholarships by expected value that clear the
// eligibility floor (match > 40), collapses near-duplicate listings, assigns
// each one an essay angle, and writes scholarship_essays/{slug}/metadata.json
// plus APPLICATION_QUEUE.md. Essays themselves are written by hand against
// scholarship_essays/voice_profile.md — this script never generates prose.
//
// Usage: bun scout/select.ts [--top N] [--dry]
//   --top N   how many scholarships to select (default 20)
//   --dry     print the selection, write nothing

import { homedir } from "os";
import { join } from "path";

const HOME = homedir();
const INPUT_PATH = join(HOME, "scholarships_found.json");
const ESSAYS_DIR = join(import.meta.dir, "..", "scholarship_essays");

interface Candidate {
  name: string;
  org: string | null;
  amount: number | null;
  amountText: string | null;
  deadline: string | null;
  url: string;
  description: string | null;
  source: string;
  match?: number;
  effort?: "low" | "med" | "high";
  flags?: string[];
  expectedValue?: number;
  amountEstimated?: boolean;
}

const args = process.argv.slice(2);
const TOP_N = (() => {
  const i = args.indexOf("--top");
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : 20;
})();
const DRY = args.includes("--dry");

// Same helpers as scout.ts (duplicated — scout.ts runs main() on import).
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const slugOf = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);

function deadlineBucket(deadline: string | null): "apply_now" | "future" {
  if (!deadline) return "apply_now";
  if (/varies|rolling|monthly|ongoing|continuous|open/i.test(deadline)) return "apply_now";
  const d = new Date(deadline);
  if (isNaN(d.getTime())) return "apply_now";
  const days = (d.getTime() - Date.now()) / 86_400_000;
  if (days < 0) return "future";
  return days <= 150 ? "apply_now" : "future";
}

// ---------------------------------------------------------------------------
// Angle classification — the five arcs from voice_profile.md. Order matters:
// specific signals (leadership, athletics, service) win before the need-based
// net, and STEM/builder is the default because it's Colin's strongest story.
// Entrepreneurship intentionally lands on the STEM/builder arc — it ends with
// Alta/TABOOST as proof he builds, which IS the entrepreneur pitch.
// ---------------------------------------------------------------------------

type Angle = "stem_mri" | "need_mott" | "leadership_lunchbunch" | "achievement_blackbelt" | "service_worship";

const ANGLE_LABEL: Record<Angle, string> = {
  stem_mri: "MRI moment → computational oncology → Alta/TABOOST as proof he builds",
  need_mott: "Mott as strategic choice → the gap is just a variable",
  leadership_lunchbunch: "Lunch Bunch reverse inclusion → systems that help people belong",
  achievement_blackbelt: "Black belt at 11 (6 years) → finish-what-you-start: Eagle, wrestling, production code",
  service_worship: "Worship gatherings → TABOOST: infrastructure people stand on",
};

function classifyAngle(c: Candidate): Angle {
  // Classify on the NAME — descriptions are noisy (a passing "leadership" in a
  // COS purpose blurb flipped the Astronaut STEM award to the wrong arc).
  // Descriptions only get a vote for financial-need signals, which rarely make
  // it into award names.
  const t = c.name.toLowerCase().replace(/community college/g, "cc");
  if (/cyber/.test(t)) return "stem_mri"; // "CyberCorps: Scholarship For Service" = government service, not community service
  if (/leader|president|student government|civic/.test(t)) return "leadership_lunchbunch";
  if (/athlet|sport|wrestl|martial|varsity|foot locker|scout/.test(t)) return "achievement_blackbelt";
  if (/service|volunteer|community|christian|faith|church|worship/.test(t)) return "service_worship";
  if (/\bneed\b|need.based|low.income|pell|grant\b|tuition|opportunity|access|first.gen/.test(t)) return "need_mott";
  if (/financial need|need.based|low.income|first.gen/.test((c.description ?? "").toLowerCase())) return "need_mott";
  return "stem_mri";
}

// Nomination-gated national awards (playbook §5: Goldwater is "not a form to
// batch" — it needs a faculty nomination and a year in a lab; Astronaut
// Scholarship likewise). An essay tonight would be a wasted slot.
const NOMINATION_GATED = /goldwater|astronaut scholarship|truman scholarship|rhodes|marshall scholarship/i;

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

async function main() {
  const data = await Bun.file(INPUT_PATH).json();
  const ranked: Candidate[] = [...data.ranked].sort(
    (a, b) => (b.expectedValue ?? 0) - (a.expectedValue ?? 0),
  );

  const dropped: string[] = [];
  const seen: string[] = [];
  const picked: Candidate[] = [];
  for (const c of ranked) {
    if (picked.length >= TOP_N) break;
    const flags = c.flags ?? [];
    if ((c.match ?? 0) <= 40) continue; // eligibility floor — fake-default 50s were rescored upstream
    if (flags.includes("score_failed")) { dropped.push(`${c.name} — match is a failed-batch default, not a score`); continue; }
    if (flags.includes("suspicious")) { dropped.push(`${c.name} — scorer flagged suspicious`); continue; }
    if (NOMINATION_GATED.test(c.name)) { dropped.push(`${c.name} — nomination-gated (needs faculty/institutional backing, not a batch essay)`); continue; }
    // Stale-cache guard: unigo entries scraped before the Total-Amount-Awarded
    // parser fix can carry a multi-winner pool as the award. No legitimate
    // single undergrad award from these directory pages is $50K+.
    if (c.source === "unigo" && (c.amount ?? 0) >= 50_000) { dropped.push(`${c.name} — $${c.amount} is a prize-pool total, not an award`); continue; }
    // Near-duplicate collapse (same matching as scout's emitAppFile dedupe).
    const n = norm(c.name);
    if (seen.some((s) => s.includes(n.slice(0, 24)) || n.includes(s.slice(0, 24)))) { dropped.push(`${c.name} — near-duplicate of an already-picked listing`); continue; }
    seen.push(n);
    picked.push(c);
  }

  // Queue order: apply-now bucket first, then future; EV descending inside each.
  const queueOrder = [
    ...picked.filter((c) => deadlineBucket(c.deadline) === "apply_now"),
    ...picked.filter((c) => deadlineBucket(c.deadline) === "future"),
  ];

  console.log(`Selected ${picked.length}/${TOP_N} (from ${ranked.length} ranked, generated ${data.generated_at})`);
  for (const d of dropped) console.log(`  skipped: ${d}`);
  console.log("");
  for (const c of queueOrder) {
    const angle = classifyAngle(c);
    console.log(
      `  [${deadlineBucket(c.deadline) === "apply_now" ? "NOW" : "FUT"}] EV $${String(c.expectedValue).padEnd(6)} $${String(c.amount ?? "varies").padEnd(7)} ${String(c.match).padStart(3)}% ${c.effort}  ${angle.padEnd(22)} ${c.name.slice(0, 60)}`,
    );
  }
  if (DRY) return;

  // Per-scholarship metadata + the master queue.
  const today = new Date().toISOString().slice(0, 10);
  const queueLines: string[] = [
    `# Application Queue — ${today}`,
    "",
    `Top ${picked.length} by expected value (match% × amount) from the scout run of ${data.generated_at.slice(0, 10)}`,
    `(${data.ranked.length} ranked candidates). Apply-now deadlines first, then next-cycle.`,
    "",
    "**Before each submit:** amounts and deadlines are the listing's claims — verify at the URL.",
    "Check each scholarship's originality / AI-assistance policy. Every essay is yours to read,",
    "tweak 2-3 sentences, and own before it goes anywhere.",
    "",
    "Workflow: open the URL → run the **Apply to Scholarship** Chrome shortcut (ScholarshipAutomation.md §3)",
    "→ paste the essay from the path below → review every field → submit yourself.",
    "",
    "---",
    "",
  ];
  let section = "";
  for (const c of queueOrder) {
    const bucket = deadlineBucket(c.deadline);
    if (bucket !== section) {
      section = bucket;
      queueLines.push(bucket === "apply_now" ? "## Apply now" : "## Future / next cycle", "");
    }
    const angle = classifyAngle(c);
    const slug = slugOf(c.name);
    const amount = c.amount ? `$${c.amount.toLocaleString()}` : `~$1,500 (listed: ${c.amountText ?? "varies"})`;
    const time = c.effort === "low" ? "Low" : "Med";
    queueLines.push(
      `- [ ] **${c.name}** | ${c.org ?? c.source} | ${amount} | ${c.deadline ?? "verify at URL"} | ${c.match}% match`,
      `  - Apply: ${c.url}`,
      `  - Angle: ${ANGLE_LABEL[angle]}`,
      `  - Essay: \`~/scholarship_essays/${slug}/essay.md\``,
      `  - Est. time: ${time} (effort: ${c.effort})`,
      "",
    );
    const metadata = {
      name: c.name,
      org: c.org,
      amount: c.amount,
      amount_text: c.amountText,
      amount_estimated: c.amountEstimated ?? c.amount === null,
      deadline: c.deadline,
      url: c.url,
      match_pct: c.match,
      effort: c.effort,
      expected_value: c.expectedValue,
      angle_used: angle,
      angle_summary: ANGLE_LABEL[angle],
      source: c.source,
      selected_at: today,
    };
    await Bun.write(join(ESSAYS_DIR, slug, "metadata.json"), JSON.stringify(metadata, null, 2) + "\n");
  }
  queueLines.push("---", "", `Voice profile: \`~/scholarship_essays/voice_profile.md\` · Browser-only sources (Bold.org, Fastweb, …): see \`needs_browser\` in \`~/scholarships_found.json\``, "");
  await Bun.write(join(ESSAYS_DIR, "APPLICATION_QUEUE.md"), queueLines.join("\n"));
  console.log(`\nWrote ${picked.length} metadata.json files + APPLICATION_QUEUE.md → ${ESSAYS_DIR}`);
}

main().catch((err) => {
  console.error(`select failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
