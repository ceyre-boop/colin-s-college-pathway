// Register tagging — deterministic heuristics, no model.
//
// Register is the conditioning variable this whole project turns on. Colin's 1 a.m. directive to a
// terminal and his submitted philosophy paper are the same voice in different clothes; a system
// trained on them mixed together produces mush, and a system that cannot move between them on
// command has not modelled his voice, only photocopied one of its outfits.
//
// Heuristics rather than an LLM classifier, for three reasons: the tagger runs over the whole
// corpus repeatedly (cost), its output feeds the register *contracts* that Phase 5 measures against
// (a model-tagged corpus would make the contract circular), and a rule that misfires can be read
// and fixed, while a classifier that misfires can only be retrained.
//
// `registerConfidence` is the margin between the top two scores. Below CONFIDENCE_FLOOR the record
// goes to human triage rather than being assigned on a coin flip.

import type { CorpusRecord, Register } from "./schema.ts";

export const CONFIDENCE_FLOOR = 0.2;

const ARGUMENT_CONNECTIVES = [
  "however", "therefore", "moreover", "furthermore", "nevertheless", "thus", "hence",
  "in contrast", "on the other hand", "but this", "the problem with", "it follows that",
  "this means that", "even so", "granted", "admittedly",
];

const FIRST_PERSON_PAST = /\b(i|we)\s+(was|were|had|did|went|saw|found|built|started|remember|thought|felt|learned|realised|realized)\b/gi;

const IMPERATIVE_START =
  /^\s*(add|fix|run|make|build|check|update|remove|delete|write|create|use|set|move|change|commit|push|pull|test|show|open|close|start|stop|read|find|search|refactor|rename|revert|merge|deploy|install|try|do|give|get|put|keep|let|go|look|see|tell|explain|continue|finish|implement|verify|confirm|ship|clean|kill|restart)\b/i;

const CITATION = /\((?:[A-Z][a-z]+(?:\s+(?:et al\.?|and\s+[A-Z][a-z]+))?,?\s*\d{1,4}|\d{4})\)|\[\d+\]/;

const CASUAL_MARKERS = /\b(idk|lol|yeah|yep|nah|ok|okay|gonna|wanna|kinda|sorta|dunno|tbh|imo|btw|anyway|whatever|shit|damn|fuck|hell)\b/i;

export interface RegisterSignals {
  wordCount: number;
  sentenceCount: number;
  meanSentenceWords: number;
  lowercaseStartRate: number;
  contractionRate: number;
  connectiveHits: number;
  firstPersonPastHits: number;
  hasCitation: boolean;
  maxParagraphWords: number;
  imperativeStart: boolean;
  casualHits: number;
}

export function sentences(text: string): string[] {
  return text
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function signals(text: string): RegisterSignals {
  const w = text.match(/\S+/g) || [];
  const sents = sentences(text);
  const starts = sents.filter((s) => /^[a-zA-Z]/.test(s));
  const lower = starts.filter((s) => /^[a-z]/.test(s));
  const paras = text.split(/\n{2,}/).map((p) => (p.match(/\S+/g) || []).length);
  const lc = text.toLowerCase();

  return {
    wordCount: w.length,
    sentenceCount: sents.length,
    meanSentenceWords: sents.length ? w.length / sents.length : w.length,
    lowercaseStartRate: starts.length ? lower.length / starts.length : 0,
    contractionRate: w.length ? ((text.match(/\b\w+'(t|s|re|ve|ll|d|m)\b/gi) || []).length / w.length) * 100 : 0,
    connectiveHits: ARGUMENT_CONNECTIVES.filter((c) => lc.includes(c)).length,
    firstPersonPastHits: (text.match(FIRST_PERSON_PAST) || []).length,
    hasCitation: CITATION.test(text),
    maxParagraphWords: paras.length ? Math.max(...paras) : 0,
    imperativeStart: IMPERATIVE_START.test(text),
    casualHits: (text.match(new RegExp(CASUAL_MARKERS, "gi")) || []).length,
  };
}

export interface RegisterVerdict {
  register: Register;
  confidence: number;
  scores: Record<Register, number>;
}

/**
 * Score each register in [0,1]-ish space, then take the top with the margin as confidence.
 * `isGdoc` matters: a Google Doc is a written artefact by construction, so the academic and
 * persuasive registers are only reachable from that source.
 */
export function classify(text: string, isGdoc = false): RegisterVerdict {
  const s = signals(text);
  const scores: Record<Register, number> = {
    directive: 0, raw: 0, narrative: 0, academic: 0, persuasive: 0,
  };

  // directive — short, imperative, terminal-shaped
  if (s.wordCount < 20) scores.directive += 0.5;
  if (s.wordCount < 40) scores.directive += 0.2;
  if (s.imperativeStart) scores.directive += 0.4;
  if (s.sentenceCount <= 2) scores.directive += 0.2;

  // raw — mid-length, lowercase, contractions, casual markers
  if (s.wordCount >= 20 && s.wordCount <= 400) scores.raw += 0.35;
  if (s.lowercaseStartRate >= 0.6) scores.raw += 0.4;
  if (s.contractionRate > 1) scores.raw += 0.2;
  if (s.casualHits > 0) scores.raw += 0.25;
  if (!s.imperativeStart && s.wordCount >= 20) scores.raw += 0.1;

  // narrative — first-person past tense, few argument connectives
  if (s.firstPersonPastHits >= 2) scores.narrative += 0.5;
  if (s.firstPersonPastHits >= 1 && s.connectiveHits <= 1) scores.narrative += 0.25;
  if (s.meanSentenceWords >= 12 && s.lowercaseStartRate < 0.3) scores.narrative += 0.2;

  // academic / persuasive — only reachable from a written document
  if (isGdoc) {
    const formal =
      (s.lowercaseStartRate < 0.1 ? 0.4 : 0) +
      (s.maxParagraphWords > 80 ? 0.3 : 0) +
      (s.hasCitation ? 0.3 : 0) +
      (s.meanSentenceWords >= 15 ? 0.2 : 0);
    scores.academic += formal;
    // persuasive is academic that argues: same formality, plus connective density
    scores.persuasive += formal + Math.min(s.connectiveHits, 4) * 0.15;
    // a document is never a terminal directive
    scores.directive = 0;
  }

  const ranked = (Object.entries(scores) as [Register, number][]).sort((a, b) => b[1] - a[1]);
  const [top, second] = ranked;
  const confidence = Math.max(0, top[1] - (second?.[1] ?? 0));
  return { register: top[0], confidence, scores };
}

/** Assign register in place. Records below the confidence floor are flagged for human triage. */
export function tag(record: CorpusRecord): CorpusRecord {
  const v = classify(record.text, record.source === "gdoc");
  return { ...record, register: v.register, registerConfidence: Number(v.confidence.toFixed(3)) };
}

export function needsTriage(record: CorpusRecord): boolean {
  // Every Google Doc needs a human regardless of confidence — the question there is authorship,
  // not register, and no score can answer it.
  if (record.source === "gdoc") return record.verifiedBy !== "colin";
  return record.registerConfidence < CONFIDENCE_FLOOR;
}
