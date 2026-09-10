// Prose extraction — the step that decides whether this corpus is Colin's writing or a pile of
// pasted stack traces.
//
// Colin's typed messages are laced with code he pasted for review, tracebacks, file listings, and
// tool output he copied back in. All of it is text he "sent", none of it is text he WROTE. Left in,
// it wrecks every stylometric measure downstream: sentence length collapses, type-token ratio
// explodes, punctuation rhythm becomes the punctuation of JSON.
//
// Each step is a pure exported function with its own test, because a silent regression here is
// invisible until an eval number looks wrong for reasons nobody can trace.

/** Fenced code blocks: triple-backtick and triple-tilde. */
export function stripFencedCode(s: string): string {
  return s
    .replace(/^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]*\1[^\n]*$/gm, "\n")
    // an unterminated fence runs to end of message — that is still a paste
    .replace(/^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*$/m, "\n");
}

/** Runs of >=3 consecutive lines indented >=4 spaces: markdown code blocks and pasted output. */
export function stripIndentedBlocks(s: string): string {
  const lines = s.split("\n");
  const out: string[] = [];
  let buf: string[] = [];
  const flush = () => {
    if (buf.length >= 3) out.push("");
    else out.push(...buf);
    buf = [];
  };
  for (const l of lines) {
    if (/^(\s{4,}|\t)\S/.test(l)) buf.push(l);
    else {
      flush();
      out.push(l);
    }
  }
  flush();
  return out.join("\n");
}

const OUTPUT_LINE =
  /^\s*(at\s+\S+|Error:|Traceback|npm ERR|warning:|\+\+\+|---|\d+\s*\||[│├└─╭╰]|\$\s|>\s*bun|✓|✗|PASS|FAIL)/;

/** Pasted tool output: recognisable prefixes, plus long runs of lines with no sentence punctuation. */
export function stripPastedOutput(s: string): string {
  const lines = s.split("\n");
  const keep: string[] = [];
  let run: string[] = [];
  const unsentenceish = (l: string) =>
    l.trim().length > 0 && !/[.!?:][)"']?\s*$/.test(l.trim()) && !/^[-*>]\s/.test(l.trim());
  const flush = () => {
    // 4+ consecutive lines that never end a sentence is a table, a listing, or a log — not prose.
    if (run.length < 4) keep.push(...run);
    run = [];
  };
  for (const l of lines) {
    if (OUTPUT_LINE.test(l)) {
      flush();
      continue;
    }
    if (unsentenceish(l)) {
      run.push(l);
      continue;
    }
    flush();
    keep.push(l);
  }
  flush();
  return keep.join("\n");
}

/** Replace rather than delete: a URL occupied a slot in the sentence, and rhythm is the signal. */
export function stripUrlsAndPaths(s: string): string {
  return s
    .replace(/\bhttps?:\/\/\S+/g, "[url]")
    .replace(/(^|\s)(~|\.{0,2})\/[\w.\-/]{4,}/g, "$1[path]");
}

const CODE_EXT = "ts|tsx|js|jsx|py|json|md|sh|css|html";
const FILE_REF = new RegExp(String.raw`\b[\w\-/]+\.(${CODE_EXT}):\d+(:\d+)?`, "g");

/** @-mentions of files and `file.ts:33` references. */
export function stripFileRefs(s: string): string {
  // Consume the trailing space too, or removing "@src/App.jsx" leaves a double space behind.
  return s.replace(/(^|\s)@[\w.\-/]+[ \t]?/g, "$1").replace(FILE_REF, "[ref]");
}

export function collapseWhitespace(s: string): string {
  return s.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

export interface CleanResult {
  text: string;
  /** Fraction of the original characters removed. >0.5 means it was mostly a paste. */
  strippedRatio: number;
  /** Fraction of characters that are letters/spaces. <0.7 means it was mostly symbols. */
  alphaRatio: number;
  wordCount: number;
  rejected: null | "too-short" | "mostly-stripped" | "mostly-symbols";
}

export const MIN_WORDS = 8;
export const MAX_STRIPPED_RATIO = 0.5;
export const MIN_ALPHA_RATIO = 0.7;

export function clean(raw: string): CleanResult {
  const steps = [
    stripFencedCode,
    stripIndentedBlocks,
    stripPastedOutput,
    stripUrlsAndPaths,
    stripFileRefs,
    collapseWhitespace,
  ];
  let text = raw;
  for (const f of steps) text = f(text);

  const strippedRatio = raw.length ? 1 - text.length / raw.length : 1;
  const alpha = (text.match(/[a-zA-Z'\s]/g) || []).length;
  const alphaRatio = text.length ? alpha / text.length : 0;
  const wordCount = (text.match(/\S+/g) || []).length;

  // Order matters for diagnosis, not for the verdict. "mostly-stripped" is checked first because a
  // code paste that leaves two words behind is more usefully reported as a paste than as too-short.
  let rejected: CleanResult["rejected"] = null;
  if (strippedRatio > MAX_STRIPPED_RATIO) rejected = "mostly-stripped";
  else if (wordCount < MIN_WORDS) rejected = "too-short";
  else if (alphaRatio < MIN_ALPHA_RATIO) rejected = "mostly-symbols";

  return { text, strippedRatio, alphaRatio, wordCount, rejected };
}

// ---- dedup -----------------------------------------------------------------
// Colin retypes the same directive constantly ("run the tests", "commit and push"). Exact-id dedup
// misses near-duplicates, and near-duplicates would let one habitual phrasing dominate the
// function-word distribution.

function shingles(s: string, n = 5): Set<string> {
  const t = s.toLowerCase().match(/[a-z0-9']+/g) || [];
  const out = new Set<string>();
  for (let i = 0; i + n <= t.length; i++) out.add(t.slice(i, i + n).join(" "));
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export const NEAR_DUP_THRESHOLD = 0.9;

/** Keep the first of each near-duplicate cluster. Order-stable. */
export function dedupeNear<T extends { text: string }>(rows: T[], threshold = NEAR_DUP_THRESHOLD): T[] {
  const kept: { row: T; sh: Set<string> }[] = [];
  for (const row of rows) {
    const sh = shingles(row.text);
    if (sh.size === 0) {
      kept.push({ row, sh });
      continue;
    }
    let dup = false;
    for (const k of kept) {
      if (k.sh.size === 0) continue;
      if (jaccard(sh, k.sh) >= threshold) {
        dup = true;
        break;
      }
    }
    if (!dup) kept.push({ row, sh });
  }
  return kept.map((k) => k.row);
}
