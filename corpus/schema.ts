// The corpus record — one unit of Colin's prose, with its provenance and its verdict.
//
// WHY EVERY FIELD IS HERE: a voice model is only as honest as its corpus. Three of these fields
// exist purely to keep the corpus honest rather than to make it useful:
//   • `verifiedBy`   — null means unusable. There is no classifier that can tell whether Colin
//                      pasted his own text or an LLM's; only he knows, so a human must say so.
//   • `quarantine`   — the 20 essays in scholarship_essays/ are LLM output conditioned on
//                      voice_profile.md. Training a voice model on them models the LLM, not Colin.
//   • `split`        — frozen once, hashed into the event log. Re-splitting after seeing results
//                      is how a held-out set stops being held out.

export type Register = "directive" | "raw" | "narrative" | "academic" | "persuasive";

export const REGISTERS: Register[] = ["directive", "raw", "narrative", "academic", "persuasive"];

export type Source = "claude-jsonl" | "gdoc" | "obsidian" | "manual";

export type QuarantineReason =
  | "llm-generated"
  | "mixed-authorship"
  | "code-paste"
  | "unverified-academic";

export interface CorpusRecord {
  /** sha256(source|sourceId|text).slice(0,16) — the dedup key. */
  id: string;
  /** Colin's prose ONLY, post-clean. Pasted code and tool output are already stripped. */
  text: string;
  register: Register;
  /** Margin between the top two register scores. <0.2 routes to human triage. */
  registerConfidence: number;
  source: Source;
  /** `relativeTranscriptPath#lineNo`, or a Google Doc fileId. */
  sourceId: string;
  timestamp: string | null;
  wordCount: number;
  /** null = unverified, and therefore unusable by anything downstream. */
  verifiedBy: "heuristic" | "colin" | null;
  verifiedAt: string | null;
  split: "train" | "exemplar" | "holdout" | null;
  quarantine: null | { reason: QuarantineReason; note?: string };
}

export const DATA_DIR = `${import.meta.dir}/data`;

/** Stage files. Each is append-only; later stages never mutate earlier ones. */
export const PATHS = {
  harvest: `${DATA_DIR}/harvest.jsonl`,
  clean: `${DATA_DIR}/clean.jsonl`,
  /** The ONLY file any generation, eval, or training path may read. */
  verified: `${DATA_DIR}/verified.jsonl`,
  /** Never read by anything under voice/, eval/, or finetune/. Asserted in quarantine.test.ts. */
  quarantine: `${DATA_DIR}/quarantine.jsonl`,
  gdocs: `${DATA_DIR}/gdocs`,
  splits: `${DATA_DIR}/splits.json`,
  pairs: `${DATA_DIR}/pairs.jsonl`,
  edits: `${DATA_DIR}/edits.jsonl`,
  errorTable: `${DATA_DIR}/error-table.json`,
  stats: `${DATA_DIR}/stats.json`,
} as const;

export function words(text: string): number {
  return (text.match(/\S+/g) || []).length;
}

export async function readJsonl<T>(path: string): Promise<T[]> {
  const f = Bun.file(path);
  if (!(await f.exists())) return [];
  const raw = await f.text();
  return raw.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as T);
}

export async function writeJsonl<T>(path: string, rows: T[]): Promise<void> {
  await Bun.write(path, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
}

export function recordId(source: Source, sourceId: string, text: string): string {
  const h = new Bun.CryptoHasher("sha256");
  h.update(`${source}|${sourceId}|${text}`);
  return h.digest("hex").slice(0, 16);
}
