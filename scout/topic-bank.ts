// Essay TOPIC BANK — Layer 4b. One place that holds every essay topic Colin owes someone.
//
// Why this exists: the pipeline finds scholarships faster than anyone writes essays, and the
// topics were living in his head. This generates scholarship_essays/TOPIC_BANK.md from the
// scout's last run, so every new find that needs words shows up as a topic with its
// scholarship, deadline, and word limit attached.
//
// Generates NOTHING written. It only lists what needs writing, and what can be reused.
//
// Usage: bun scout/topic-bank.ts [--found ~/scholarships_found.json] [--top 150]

import { join } from "path";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { homedir } from "os";
import { loadEssayLibrary, matchEssay, type EssayLibraryEntry } from "./essay-match";

const ROOT = join(import.meta.dir, "..");
const ESSAYS_DIR = join(ROOT, "scholarship_essays");
const OUT = join(ESSAYS_DIR, "TOPIC_BANK.md");

// The marker Colin's own hand-added topics live below. Regeneration never touches that block.
const HAND_MARKER = "<!-- COLIN'S OWN TOPICS — regeneration never touches anything below this line -->";

// The ~7 archetypes that cover most scholarship prompts. `angle` ties an archetype to the
// 5 canonical angles in essay-match.ts so "is it written yet?" is answered from real files.
interface Archetype {
  id: string;
  title: string;
  angle: string | null;
  prompt: string;
  cues: string[];
}

const ARCHETYPES: Archetype[] = [
  {
    id: "personal-statement",
    title: "Personal statement — who you are",
    angle: "stem_mri",
    prompt: "Tell us about yourself. What shaped you, and what are you doing with it?",
    cues: ["tell us about yourself", "personal statement", "who you are", "background"],
  },
  {
    id: "why-deserve",
    title: "Why you deserve this award",
    angle: "need_mott",
    prompt: "Why should you receive this scholarship, and what will it change for you?",
    cues: ["deserve", "why should you receive", "how will this scholarship help", "financial need"],
  },
  {
    id: "career-goals",
    title: "Career and academic goals",
    angle: "stem_mri",
    prompt: "What are your academic and career goals, and how did you choose this field?",
    cues: ["career goals", "academic goals", "why this major", "future plans", "field of study"],
  },
  {
    id: "adversity",
    title: "Adversity / an obstacle you got past",
    angle: "achievement_blackbelt",
    prompt: "Describe a challenge or setback you faced and what it taught you.",
    cues: ["challenge", "obstacle", "adversity", "setback", "overcome", "hardship"],
  },
  {
    id: "leadership",
    title: "Leadership",
    angle: "leadership_lunchbunch",
    prompt: "Describe a time you led. What did you build or change, and who did it serve?",
    cues: ["leadership", "led a team", "initiative", "organized", "founded"],
  },
  {
    id: "community-service",
    title: "Community service and impact",
    angle: "service_worship",
    prompt: "How have you served your community, and what difference did it make?",
    cues: ["community service", "volunteer", "giving back", "impact on others", "service"],
  },
  {
    id: "why-business",
    title: "Entrepreneurship / why business",
    angle: null,
    prompt: "What have you built, and why does building a business matter to you?",
    cues: ["entrepreneur", "business", "startup", "venture", "innovation"],
  },
];

interface Ranked {
  name: string;
  org: string | null;
  amount: number | null;
  amountText?: string | null;
  deadline: string | null;
  url: string | null;
  description?: string | null;
  source?: string | null;
  match?: number | null;
  expectedValue?: number | null;
}

const arg = (flag: string, fallback: string) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const money = (n: number | null | undefined) =>
  n == null ? "—" : "$" + n.toLocaleString("en-US");

// Pull a word limit out of whatever prose the listing gave us ("500-word essay", "max 250 words").
function wordLimitFrom(text: string): number | null {
  const m = text.match(/(\d{2,5})\s*(?:-|\s)?word/i) || text.match(/words?\D{0,12}?(\d{2,5})/i);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 50 && n <= 5000 ? n : null;
}

// Which archetype does this listing's prompt text look like? Falls back to the angle the
// essay-matcher picked. Returns null rather than guessing — a listing whose blurb says nothing
// about its prompt lands in "unsorted", where the honest next step is opening the URL.
function archetypeFor(text: string, angle: string | null): Archetype | null {
  const lower = text.toLowerCase();
  let best: { a: Archetype; hits: number } | null = null;
  for (const a of ARCHETYPES) {
    const hits = a.cues.reduce((n, c) => n + (lower.includes(c) ? 1 : 0), 0);
    if (hits > 0 && (!best || hits > best.hits)) best = { a, hits };
  }
  if (best) return best.a;
  if (angle) return ARCHETYPES.find((a) => a.angle === angle) ?? null;
  return null;
}

// An archetype counts as WRITTEN when a drafted essay exists under its angle.
function writtenArchetypes(library: EssayLibraryEntry[]): Map<string, EssayLibraryEntry> {
  const out = new Map<string, EssayLibraryEntry>();
  for (const a of ARCHETYPES) {
    if (!a.angle) continue;
    const longest = library
      .filter((e) => e.angle === a.angle)
      .sort((x, y) => y.words - x.words)[0];
    if (longest) out.set(a.id, longest);
  }
  return out;
}

function loadRanked(path: string): { ranked: Ranked[]; generatedAt: string | null } {
  if (!existsSync(path)) return { ranked: [], generatedAt: null };
  const d = JSON.parse(readFileSync(path, "utf8"));
  return { ranked: Array.isArray(d.ranked) ? d.ranked : [], generatedAt: d.generated_at ?? null };
}

// Everything Colin hand-wrote under the marker survives regeneration verbatim.
function preservedTail(): string {
  if (!existsSync(OUT)) return "";
  const prev = readFileSync(OUT, "utf8");
  const i = prev.indexOf(HAND_MARKER);
  return i < 0 ? "" : prev.slice(i + HAND_MARKER.length).replace(/^\s*\n/, "");
}

function main() {
  const foundPath = arg("--found", join(homedir(), "scholarships_found.json"));
  const top = Number(arg("--top", "150"));
  // Below this match score Colin doesn't qualify (grad-only, faculty awards, wrong field) —
  // those are not topics he owes anyone, so they never reach the bank.
  const minMatch = Number(arg("--min-match", "50"));

  const library = loadEssayLibrary();
  const written = writtenArchetypes(library);
  const { ranked, generatedAt } = loadRanked(foundPath);

  // Already-selected scholarships (they have a folder) are tracked separately from new finds.
  const haveFolder = new Set(
    existsSync(ESSAYS_DIR)
      ? readdirSync(ESSAYS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
      : [],
  );
  const slugify = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);

  interface Topic {
    archetype: Archetype | null;
    sch: Ranked;
    wordLimit: number | null;
    bucket: string;
    reuse: string | null;
    reuseWords: number | null;
  }

  const topics: Topic[] = [];
  // The harvest stamps every listing's description with "essay required" or "no essay".
  // A no-essay award is money, not a topic — it belongs in the queue, never in this bank.
  const noEssay = (s: Ranked) => /\bno essay\b/i.test(s.description ?? "");
  const eligible = ranked.filter((s) => (s.match ?? 0) >= minMatch && !noEssay(s));
  const skippedNoEssay = ranked.filter((s) => (s.match ?? 0) >= minMatch && noEssay(s)).length;
  for (const s of eligible.slice(0, top)) {
    const text = [s.name, s.description ?? ""].join(" — ");
    const wordLimit = wordLimitFrom(text);
    const m = matchEssay(text, wordLimit, library);
    const archetype = archetypeFor(text, m.angle);
    topics.push({
      archetype,
      sch: s,
      wordLimit,
      bucket: m.bucket,
      reuse: m.essayPath ? m.essayPath.replace(ROOT + "/", "") : null,
      reuseWords: m.essayWords,
    });
  }

  const needNew = topics.filter((t) => t.bucket === "needs_new_essay");
  const byArchetype = new Map<string, Topic[]>();
  for (const t of needNew) {
    const key = t.archetype?.id ?? "unsorted";
    const list = byArchetype.get(key) ?? [];
    list.push(t);
    byArchetype.set(key, list);
  }

  const today = new Date().toISOString().slice(0, 10);
  const L: string[] = [];
  L.push("# Essay Topic Bank");
  L.push("");
  L.push(`> Generated ${today} by \`bun scout/topic-bank.ts\` from the scout run of ${generatedAt ? generatedAt.slice(0, 10) : "— (no run found)"}.`);
  L.push("> Regenerate after every scout run. Nothing here is written for you — this is the list of what to write.");
  L.push("");
  L.push("**How to use it:** write the 500-word version of each archetype below once, then cut it down per");
  L.push("scholarship. Most prompts want 250–500 words, so the long draft is the parent of all the short ones.");
  L.push("");
  L.push(`**Not in here:** ${skippedNoEssay} no-essay awards at ${minMatch}%+ match from the same run — those need no words,`);
  L.push("so they stay in `APPLICATION_QUEUE.md` as straight applications.");
  L.push("");
  L.push("---");
  L.push("");
  L.push("## The archetypes — write these once");
  L.push("");
  L.push("| # | Topic | Target | Status | Draft |");
  L.push("|---|-------|--------|--------|-------|");
  ARCHETYPES.forEach((a, i) => {
    const w = written.get(a.id);
    const status = w ? `drafted (${w.words}w)` : "**not written**";
    const draft = w ? `\`scholarship_essays/${w.slug}/essay.md\`` : "—";
    L.push(`| ${i + 1} | ${a.title} | 500w | ${status} | ${draft} |`);
  });
  L.push("");
  for (const a of ARCHETYPES) {
    const list = byArchetype.get(a.id) ?? [];
    L.push(`### ${a.title}`);
    L.push("");
    L.push(`*Prompt to write against:* ${a.prompt}`);
    L.push("");
    if (!list.length) {
      L.push("_No open scholarship is waiting on this one right now._");
      L.push("");
      continue;
    }
    L.push(`${list.length} scholarship${list.length === 1 ? "" : "s"} waiting on this topic:`);
    L.push("");
    for (const t of list.sort((x, y) => (y.sch.expectedValue ?? 0) - (x.sch.expectedValue ?? 0))) {
      const s = t.sch;
      const bits = [
        money(s.amount),
        `due ${s.deadline || "verify at URL"}`,
        t.wordLimit ? `${t.wordLimit}w` : "word limit unknown",
        s.match != null ? `${s.match}% match` : null,
      ].filter(Boolean);
      L.push(`- [ ] **${s.name}** — ${bits.join(" · ")}`);
      if (s.url) L.push(`  - ${s.url}`);
      if (haveFolder.has(slugify(s.name))) L.push(`  - folder exists: \`scholarship_essays/${slugify(s.name)}/\``);
    }
    L.push("");
  }
  const unsorted = byArchetype.get("unsorted") ?? [];
  if (unsorted.length) {
    L.push("### Unsorted — open the URL to see the real prompt");
    L.push("");
    L.push(`${unsorted.length} listing${unsorted.length === 1 ? "" : "s"} whose blurb doesn't say what the essay asks for.`);
    L.push("Each one asks for an essay; the listing just doesn't say which kind.");
    L.push("Sorted by expected value, so work down from the top.");
    L.push("");
    for (const t of unsorted.sort((x, y) => (y.sch.expectedValue ?? 0) - (x.sch.expectedValue ?? 0))) {
      const s = t.sch;
      L.push(`- [ ] **${s.name}** — ${money(s.amount)} · due ${s.deadline || "verify at URL"} · ${s.match ?? "?"}% match${s.url ? ` · ${s.url}` : ""}`);
    }
    L.push("");
  }

  L.push("---");
  L.push("");
  L.push("## Already covered — reuse, don't rewrite");
  L.push("");
  const reusable = topics.filter((t) => t.bucket !== "needs_new_essay");
  if (!reusable.length) {
    L.push("_Nothing in the last run matched an existing essay._");
  } else {
    L.push("| Scholarship | Amount | Deadline | Reuse | Action |");
    L.push("|-------------|--------|----------|-------|--------|");
    for (const t of reusable.sort((x, y) => (y.sch.expectedValue ?? 0) - (x.sch.expectedValue ?? 0))) {
      const action = t.bucket === "reuse" ? "send as-is" : `trim to ~${t.wordLimit ?? "?"}w`;
      L.push(`| ${t.sch.name} | ${money(t.sch.amount)} | ${t.sch.deadline || "verify"} | \`${t.reuse}\` (${t.reuseWords}w) | ${action} |`);
    }
  }
  L.push("");
  L.push(`**Totals:** ${topics.length} scholarships at ${minMatch}%+ match · ${needNew.length} need new words · ${reusable.length} reusable · ${unsorted.length} unsorted.`);
  L.push("");
  L.push("---");
  L.push("");
  L.push(HAND_MARKER);
  L.push("");
  const tail = preservedTail();
  L.push(tail || "## Topics Colin added by hand\n\n- (nothing yet — add topics here and they survive every regeneration)\n");

  writeFileSync(OUT, L.join("\n"));
  console.log(`TOPIC_BANK.md written: ${topics.length} scholarships (match >= ${minMatch}%), ${needNew.length} need new essays, ${reusable.length} reusable, ${unsorted.length} unsorted.`);
  console.log(`  archetypes drafted: ${written.size}/${ARCHETYPES.length}`);
  console.log(`  → ${OUT.replace(ROOT + "/", "")}`);
}

main();
