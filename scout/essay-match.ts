// Essay-REUSE matcher — Layer 4, free/heuristic, generates NOTHING.
//
// Cost rule (Colin): reuse existing essays aggressively; if a scholarship needs a genuinely
// NEW essay, tag it and defer — never auto-generate. So this module only ever MATCHES a
// scholarship's essay prompt to the existing library (the 5 angles + the drafted essays under
// scholarship_essays/{slug}/), and buckets it. Zero API spend.
//
//   reuse           — a strong angle match AND an existing essay whose length fits → use as-is.
//   reuse_with_edit — strong angle match but wrong length → one-click human trim (no generation).
//   needs_new_essay — no angle above threshold → defer; the user may write it later, or not.

import { join } from "path";
import { readdirSync, existsSync, readFileSync } from "fs";

const ESSAYS_DIR = join(import.meta.dir, "..", "scholarship_essays");

// The 5 canonical angles with keyword signatures (from scholarship_profile essay_angles +
// voice_profile.md). Scoring is simple token-overlap — deterministic, no model.
const ANGLES: Record<string, string[]> = {
  stem_mri: ["stem", "science", "biology", "biomedical", "medicine", "medical", "cancer", "oncology", "tumor", "mri", "computational", "research", "drug", "discovery", "why", "major", "field", "career", "future", "technology", "engineering", "innovation", "discipline"],
  achievement_blackbelt: ["perseverance", "persevere", "commitment", "committed", "dedication", "discipline", "overcome", "overcame", "obstacle", "obstacles", "adversity", "challenge", "challenges", "eagle", "scout", "black", "belt", "wrestling", "athlete", "sport", "resilience", "grit", "hard", "work"],
  leadership_lunchbunch: ["leadership", "leader", "lead", "led", "community", "inclusion", "belonging", "special", "needs", "service", "volunteer", "impact", "others", "help", "helping", "mentor", "team", "organized", "founded", "difference", "give", "back"],
  need_mott: ["financial", "need", "need-based", "pell", "low", "income", "afford", "cost", "tuition", "transfer", "community", "college", "barrier", "barriers", "work", "working", "economic", "hardship", "family", "support", "fund"],
  service_worship: ["service", "faith", "church", "worship", "values", "giving", "volunteer", "volunteering", "compassion", "character", "integrity", "religious", "christian", "spiritual", "community"],
};

export interface EssayLibraryEntry { slug: string; angle: string; words: number; essayPath: string; }
export type EssayBucket = "reuse" | "reuse_with_edit" | "needs_new_essay";
export interface EssayMatch {
  bucket: EssayBucket;
  angle: string | null; // best-matching angle (null if nothing scored)
  score: number; // token-overlap score for the winning angle
  essayPath: string | null; // reusable essay to point at (reuse / reuse_with_edit)
  essayWords: number | null;
  reason: string;
}

const WORD_RE = /[a-z][a-z'-]+/g;
function tokens(s: string): string[] {
  return (s.toLowerCase().match(WORD_RE) || []).filter((w) => w.length > 2);
}
function wordCount(md: string): number {
  return (md.replace(/[#*_>`\-]/g, " ").match(/\S+/g) || []).length;
}

// Load the drafted-essay library: one representative essay per angle, with word counts.
export function loadEssayLibrary(): EssayLibraryEntry[] {
  if (!existsSync(ESSAYS_DIR)) return [];
  const out: EssayLibraryEntry[] = [];
  for (const d of readdirSync(ESSAYS_DIR, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const metaPath = join(ESSAYS_DIR, d.name, "metadata.json");
    const essayPath = join(ESSAYS_DIR, d.name, "essay.md");
    if (!existsSync(metaPath) || !existsSync(essayPath)) continue;
    try {
      const meta = JSON.parse(readFileSync(metaPath, "utf8"));
      const angle = meta.angle_used || "stem_mri";
      const words = wordCount(readFileSync(essayPath, "utf8"));
      out.push({ slug: d.name, angle, words, essayPath });
    } catch { /* skip unreadable */ }
  }
  return out;
}

// Score a prompt's tokens against each angle's signature; return sorted [angle, score].
function scoreAngles(prompt: string): [string, number][] {
  const toks = new Set(tokens(prompt));
  const scores: [string, number][] = Object.entries(ANGLES).map(([angle, sig]) => {
    const hits = sig.reduce((n, kw) => n + (toks.has(kw) ? 1 : 0), 0);
    return [angle, hits];
  });
  return scores.sort((a, b) => b[1] - a[1]);
}

const MATCH_THRESHOLD = 2; // need at least this many keyword hits to claim an angle fits

export function matchEssay(prompt: string, wordLimit: number | null, library: EssayLibraryEntry[]): EssayMatch {
  if (!prompt || tokens(prompt).length < 3) {
    return { bucket: "needs_new_essay", angle: null, score: 0, essayPath: null, essayWords: null, reason: "no usable essay prompt" };
  }
  const ranked = scoreAngles(prompt);
  const [angle, score] = ranked[0];
  if (score < MATCH_THRESHOLD) {
    return { bucket: "needs_new_essay", angle: null, score, essayPath: null, essayWords: null, reason: `no angle above threshold (best ${angle} @ ${score})` };
  }
  // pick the best existing essay for that angle
  const candidates = library.filter((e) => e.angle === angle);
  if (!candidates.length) {
    return { bucket: "needs_new_essay", angle, score, essayPath: null, essayWords: null, reason: `angle "${angle}" matched but no drafted essay exists for it yet` };
  }
  // length fit: within ±20% of the limit is reusable as-is (or any essay if no limit given)
  const fits = (w: number) => wordLimit == null || (w <= wordLimit * 1.05 && w >= wordLimit * 0.6);
  const asIs = candidates.find((e) => fits(e.words));
  if (asIs) {
    return { bucket: "reuse", angle, score, essayPath: asIs.essayPath, essayWords: asIs.words, reason: `reuse "${angle}" essay (${asIs.words}w${wordLimit ? ` for ~${wordLimit}w limit` : ""})` };
  }
  const closest = candidates.sort((a, b) => Math.abs((a.words - (wordLimit ?? a.words))) - Math.abs(b.words - (wordLimit ?? b.words)))[0];
  return { bucket: "reuse_with_edit", angle, score, essayPath: closest.essayPath, essayWords: closest.words, reason: `angle "${angle}" fits but ${closest.words}w needs trimming to ~${wordLimit}w — human edit, no generation` };
}
