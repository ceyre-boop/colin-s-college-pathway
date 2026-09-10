// Retrieve the life-experience facts that fit a given essay prompt.
//
// WHY TOKEN OVERLAP AND NOT EMBEDDINGS. The candidate set is ~40 short strings over a small closed
// vocabulary — scholarship prompts talk about leadership, need, service and STEM in near-fixed
// terms. Embeddings would mean a new runtime dependency (the repo has none), an API round trip or a
// local model, and a cache to invalidate, to solve a ranking problem that scout/essay-match.ts
// already solves with token overlap. The honest upgrade path is IDF weighting and a usage penalty,
// both of which cost nothing.
//
// THE USAGE PENALTY IS THE POINT. The existing corpus uses the stem_mri angle in 15 of 20 essays.
// That is not a retrieval-quality failure an embedding would fix; it is the absence of any
// mechanism that notices an angle has already been spent. Reading prior angle_used from the event
// log and down-weighting accordingly fixes the actual problem.

import { readAll } from "../state/log.ts";
import { facts, neverClaim, voiceSpec, type Fact } from "./spec.ts";
import { INIT_TIMELINE } from "../src/data/timeline.js";

const WORD_RE = /[a-z][a-z'-]+/g;

export function tokenize(s: string): string[] {
  return (s.toLowerCase().match(WORD_RE) || []).filter((w) => w.length > 2);
}

/** Prompt vocabulary that means the same thing across scholarship boilerplate. */
export const SYNONYMS: Record<string, string[]> = {
  leadership: ["lead", "leader", "president", "captain", "organize", "initiative"],
  service: ["volunteer", "community", "give", "help", "serve", "outreach"],
  need: ["financial", "hardship", "afford", "cost", "tuition", "pell", "income"],
  research: ["stem", "science", "lab", "study", "investigate", "data"],
  perseverance: ["persist", "overcome", "challenge", "obstacle", "adversity", "resilience"],
  entrepreneur: ["founder", "startup", "business", "venture", "built", "company"],
  medicine: ["health", "medical", "clinical", "patient", "cancer", "oncology", "doctor"],
};

export function expand(tokens: string[]): string[] {
  const out = new Set(tokens);
  for (const t of tokens) {
    for (const [key, syns] of Object.entries(SYNONYMS)) {
      if (t === key || syns.includes(t)) {
        out.add(key);
        for (const s of syns) out.add(s);
      }
    }
  }
  return [...out];
}

export interface Experience {
  id: string;
  text: string;
  provenance: string;
  /** Retrieval score; higher is better. */
  score: number;
}

interface Candidate {
  id: string;
  text: string;
  provenance: string;
  /** The angle key this candidate belongs to, for the usage penalty. */
  angle: string | null;
  tokens: string[];
}

/** Map a candidate onto one of the five canonical angles in the voice profile's angle map. */
export function angleOf(text: string): string | null {
  const t = text.toLowerCase();
  if (/mri|tumor|tumour|oncology|radiation|scan|segmentation/.test(t)) return "stem_mri";
  if (/black belt|wrestling|eagle scout|martial arts|legacy mma/.test(t)) return "achievement_blackbelt";
  if (/lunch bunch|inclusion|belong/.test(t)) return "leadership_lunchbunch";
  if (/sai|pell|fafsa|mott|tuition|afford/.test(t)) return "need_mott";
  if (/worship|gathering|service/.test(t)) return "service_worship";
  return null;
}

export function candidates(spec = voiceSpec()): Candidate[] {
  const out: Candidate[] = [];

  for (const [i, f] of facts(spec).entries()) {
    out.push({
      id: `fact:${i}`,
      text: f.text,
      provenance: `facts bank — ${f.group}`,
      angle: angleOf(f.text),
      tokens: tokenize(`${f.group} ${f.text}`),
    });
  }

  for (const e of INIT_TIMELINE as { id: number; title: string; essay?: string; year?: number }[]) {
    if (!e.essay) continue;
    out.push({
      id: `timeline:${e.id}`,
      text: e.essay,
      provenance: `timeline — ${e.title}${e.year ? ` (${e.year})` : ""}`,
      angle: angleOf(`${e.title} ${e.essay}`),
      tokens: tokenize(`${e.title} ${e.essay}`),
    });
  }

  return out;
}

/** Inverse document frequency across the candidate set — so "the" and "community" do not tie. */
export function idf(cands: Candidate[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const c of cands) {
    for (const t of new Set(c.tokens)) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const n = cands.length;
  const out = new Map<string, number>();
  for (const [t, d] of df) out.set(t, Math.log((n + 1) / (d + 0.5)));
  return out;
}

/** How many times each angle has already been used, from the event log. */
export function angleUsage(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of readAll()) {
    const a = (e.data as Record<string, unknown>)?.angle_used ?? (e.data as Record<string, unknown>)?.angleUsed;
    if (typeof a === "string" && a) counts.set(a, (counts.get(a) ?? 0) + 1);
  }
  return counts;
}

/** Each prior use multiplies an angle's score by this. 15-of-20 skew needs a real penalty. */
export const USAGE_DECAY = 0.7;

/**
 * Fact groups that ground almost any scholarship essay. Used only to top up when the prompt's
 * wording overlaps little — a generic "tell us about yourself" should still get real facts rather
 * than one thin match or nothing.
 */
export const SPINE_GROUPS = new Set(["The origin story", "Builder numbers", "Academics & money"]);

function groupOf(c: { provenance: string }): string {
  const m = /^facts bank — (.*)$/.exec(c.provenance);
  return m ? m[1] : "";
}

export interface RetrieveOpts {
  prompt: string;
  n?: number;
  /** Override for tests. */
  usage?: Map<string, number>;
  spec?: ReturnType<typeof voiceSpec>;
}

export function retrieve(opts: RetrieveOpts): { experiences: Experience[]; neverClaim: string[] } {
  const spec = opts.spec ?? voiceSpec();
  const cands = candidates(spec);
  const weights = idf(cands);
  const usage = opts.usage ?? angleUsage();
  const q = new Set(expand(tokenize(opts.prompt)));

  const scored = cands.map((c) => {
    let score = 0;
    for (const t of new Set(c.tokens)) if (q.has(t)) score += weights.get(t) ?? 0;
    // normalise by length so a long fact does not win on surface area alone
    score /= Math.sqrt(new Set(c.tokens).size || 1);
    if (c.angle) score *= USAGE_DECAY ** (usage.get(c.angle) ?? 0);
    return { ...c, score };
  });

  const n = opts.n ?? 4;
  const ranked = scored.sort((a, b) => b.score - a.score);
  const picked = ranked.filter((c) => c.score > 0).slice(0, n);

  // A prompt whose wording overlaps nothing ("Tell us about yourself") would otherwise return one
  // fact or none, and an essay with no grounding invents its own. Top up from the spine — the facts
  // that are load-bearing for essentially every scholarship essay — rather than from noise.
  if (picked.length < n) {
    const chosen = new Set(picked.map((c) => c.id));
    for (const c of ranked) {
      if (picked.length >= n) break;
      if (chosen.has(c.id) || !SPINE_GROUPS.has(groupOf(c))) continue;
      picked.push(c);
      chosen.add(c.id);
    }
  }

  const experiences = picked.map((c) => ({
    id: c.id,
    text: c.text,
    provenance: c.provenance,
    score: Number(c.score.toFixed(4)),
  }));

  return { experiences, neverClaim: neverClaim(spec) };
}

/** Render for the prompt, with the boundaries attached to the facts rather than far from them. */
export function renderExperiences(r: { experiences: Experience[]; neverClaim: string[] }): string {
  const lines = r.experiences.map((e) => `- ${e.text}\n  (source: ${e.provenance})`);
  const block = [`Real facts to ground this in — invent nothing beyond them:`, ...lines].join("\n");
  if (!r.neverClaim.length) return block;
  return `${block}\n\nNEVER claim: ${r.neverClaim.join("; ")}`;
}
