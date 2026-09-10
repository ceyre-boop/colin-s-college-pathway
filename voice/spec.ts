// Load scholarship_essays/voice_profile.md and make it addressable.
//
// The file holds ~3,900 words of carefully-derived voice doctrine and, before this module, no code
// path read a single byte of it. The live prompt was six lines long and its entire voice guidance
// was the word "wry". Wiring this up is the largest single improvement available in the project.
//
// Two design choices:
//
//   PARSE BY HEADING, don't regex for content. The document is edited by hand and will keep
//   changing; a parser that claims headings survives edits, and the test asserts every heading is
//   claimed by exactly one branch, so a future section cannot be silently dropped.
//
//   RENDER PER REGISTER. Dumping all 3,900 words into every prompt dilutes the instructions that
//   matter for the register at hand. voiceSpecBlock(register) emits only the relevant sections.

import { readFileSync, statSync } from "fs";
import { join } from "path";
import type { Register } from "../corpus/schema.ts";

export const SPEC_PATH = join(import.meta.dir, "..", "scholarship_essays", "voice_profile.md");

export interface Section {
  heading: string;
  level: number;
  body: string;
}

export interface VoiceSpec {
  /** Every section, in document order. */
  sections: Section[];
  corpusNote: string;
  voiceSamples: string;
  doctrine: string;
  engine: string;
  rewriteTest: string;
  mechanics: string;
  capitalization: string;
  factsBank: string;
  angleMap: string;
  smellTest: string;
  checklist: string;
  revisionConvention: string;
}

/** Which parsed field each heading feeds. Exported so the test can assert full coverage. */
export const HEADING_MAP: { match: RegExp; field: keyof Omit<VoiceSpec, "sections"> }[] = [
  { match: /^corpus note/i, field: "corpusNote" },
  { match: /^the voice, from actual writing samples/i, field: "voiceSamples" },
  { match: /^narrative doctrine/i, field: "doctrine" },
  { match: /^the eight rules/i, field: "doctrine" },
  { match: /^the storytelling engine/i, field: "engine" },
  { match: /^the rewrite test/i, field: "rewriteTest" },
  { match: /^voice rules for essays/i, field: "mechanics" },
  { match: /^capitalization decision/i, field: "capitalization" },
  { match: /^facts bank/i, field: "factsBank" },
  { match: /^angle map/i, field: "angleMap" },
  { match: /^smell test/i, field: "smellTest" },
  { match: /^authenticity checklist/i, field: "checklist" },
  { match: /^revision history/i, field: "revisionConvention" },
];

export function parseSections(md: string): Section[] {
  const lines = md.split("\n");
  const out: Section[] = [];
  let cur: Section | null = null;
  for (const l of lines) {
    const m = /^(#{1,6})\s+(.*)$/.exec(l);
    if (m) {
      if (cur) out.push(cur);
      // The top-level title is the document name, not a section.
      cur = m[1].length === 1 ? null : { heading: m[2].trim(), level: m[1].length, body: "" };
      continue;
    }
    if (cur) cur.body += l + "\n";
  }
  if (cur) out.push(cur);
  return out.map((s) => ({ ...s, body: s.body.trim() }));
}

export function parse(md: string): VoiceSpec {
  const sections = parseSections(md);
  const spec = {
    sections,
    corpusNote: "", voiceSamples: "", doctrine: "", engine: "", rewriteTest: "",
    mechanics: "", capitalization: "", factsBank: "", angleMap: "", smellTest: "",
    checklist: "", revisionConvention: "",
  } as VoiceSpec;

  for (const s of sections) {
    const rule = HEADING_MAP.find((r) => r.match.test(s.heading));
    if (!rule) continue;
    const block = `${s.body}`;
    spec[rule.field] = spec[rule.field] ? `${spec[rule.field]}\n\n${block}` : block;
  }
  return spec;
}

let cache: { mtimeMs: number; spec: VoiceSpec } | null = null;

export function voiceSpec(path = SPEC_PATH): VoiceSpec {
  const mtimeMs = statSync(path).mtimeMs;
  if (cache && cache.mtimeMs === mtimeMs) return cache.spec;
  const spec = parse(readFileSync(path, "utf8"));
  cache = { mtimeMs, spec };
  return spec;
}

/** Headings in the file that no parser branch claims — a silently-dropped section. */
export function unclaimedHeadings(path = SPEC_PATH): string[] {
  return parseSections(readFileSync(path, "utf8"))
    .filter((s) => !HEADING_MAP.some((r) => r.match.test(s.heading)))
    .map((s) => s.heading);
}

/**
 * Which sections matter for which register.
 *
 * The doctrine, engine and rewrite test are essay-craft instructions: they belong to the registers
 * that produce essays. Sending them along with a request for raw-register prose would tell the
 * model to build a five-beat arc out of a text message.
 */
const SECTIONS_BY_REGISTER: Record<Register, (keyof Omit<VoiceSpec, "sections">)[]> = {
  academic: ["voiceSamples", "doctrine", "engine", "rewriteTest", "mechanics", "capitalization", "smellTest"],
  persuasive: ["voiceSamples", "doctrine", "engine", "rewriteTest", "mechanics", "capitalization", "smellTest"],
  narrative: ["voiceSamples", "doctrine", "engine", "rewriteTest", "mechanics", "capitalization", "smellTest"],
  raw: ["voiceSamples", "capitalization"],
  directive: ["voiceSamples", "capitalization"],
};

const TITLES: Record<string, string> = {
  voiceSamples: "The voice, from actual writing samples",
  doctrine: "Narrative doctrine (overrides everything below it)",
  engine: "The storytelling engine",
  rewriteTest: "The rewrite test",
  mechanics: "Voice mechanics",
  capitalization: "Capitalization",
  smellTest: "Smell test — run before saving",
  factsBank: "Facts bank",
  angleMap: "Angle map",
  checklist: "Authenticity checklist",
};

/** Render only the sections that bear on this register. */
export function voiceSpecBlock(register: Register, spec = voiceSpec()): string {
  const keys = SECTIONS_BY_REGISTER[register] ?? SECTIONS_BY_REGISTER.raw;
  return keys
    .map((k) => ({ title: TITLES[k] ?? k, body: spec[k] }))
    .filter((s) => s.body)
    .map((s) => `## ${s.title}\n\n${s.body}`)
    .join("\n\n");
}

// ---- facts bank ------------------------------------------------------------

export interface Fact {
  /** The group this fact sits under, e.g. "Builder numbers." — used to retrieve related facts together. */
  group: string;
  text: string;
}

/**
 * The facts bank mixes two shapes: bold-headed paragraphs ("**The origin story.**" followed by
 * prose) and bullet lists under a bold heading. Both are facts; an earlier version read only the
 * bullets and silently dropped the origin story, which is the single most-used fact in the corpus.
 */
export function facts(spec = voiceSpec()): Fact[] {
  const out: Fact[] = [];
  let group = "";
  for (const raw of spec.factsBank.split("\n")) {
    const line = raw.trim();
    if (!line || line === "---") continue;
    if (/^\*\*never claim/i.test(line)) break; // boundaries are handled separately

    const head = /^\*\*(.+?)\*\*\s*$/.exec(line);
    if (head) { group = head[1].replace(/\.$/, ""); continue; }

    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) { out.push({ group, text: bullet[1].trim() }); continue; }

    // A continuation line of a bullet, or a paragraph fact.
    if (/^\*?\(?\*?Source|^\*Verified/i.test(line)) continue; // provenance notes, not claims
    if (out.length && group && /^[a-z(]/.test(line)) {
      out[out.length - 1].text += " " + line;
      continue;
    }
    if (group) out.push({ group, text: line });
  }
  return out.filter((f) => f.text.length > 20);
}

/**
 * Claims the facts bank explicitly forbids. These ride WITH retrieved facts into the prompt rather
 * than sitting in a distant region, because a boundary the model has to remember across 3,000 words
 * is a boundary it will cross.
 */
export function neverClaim(spec = voiceSpec()): string[] {
  const m = /\*\*Never claim:\*\*\s*([\s\S]*?)(?:\n\s*\n|\n---|$)/i.exec(spec.factsBank);
  if (!m) return [];
  return m[1]
    .split(/\s+—\s+|\s+-\s+|;/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 3);
}
