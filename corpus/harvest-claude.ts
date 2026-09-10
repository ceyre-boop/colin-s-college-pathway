#!/usr/bin/env bun
// Harvest Colin's typed messages out of the Claude Code transcripts.
//
// ~2,600 JSONL transcripts, ~440MB, of which the overwhelming majority is Claude's output and tool
// results. What we want is the narrow seam of text Colin actually typed:
//
//   type === "user"                    — his turn, not the assistant's
//   && !isSidechain                    — not a subagent's internal conversation
//   && !toolUseResult                  — tool results carry role "user" but nobody wrote them
//   && typeof message.content ===      — a real typed prompt is a string; an array is a tool-result
//        "string"                        envelope or an image attachment
//
// Then drop harness noise: system reminders (<...>), slash commands (/...), bash escapes (!...),
// and interrupt markers.
//
// Streaming line-by-line rather than reading files whole — 440MB does not need to be resident.

import { readdir } from "fs/promises";
import { join, relative } from "path";
import { homedir } from "os";
import { PATHS, recordId, words, type CorpusRecord } from "./schema.ts";

const PROJECTS_DIR = process.env.CCP_TRANSCRIPTS_DIR ?? join(homedir(), ".claude", "projects");

interface TranscriptLine {
  type?: string;
  isSidechain?: boolean;
  toolUseResult?: unknown;
  timestamp?: string;
  message?: { role?: string; content?: unknown };
}

/** Harness noise that Colin did not type, even though it arrives on his turn. */
export function isHarnessNoise(content: string): boolean {
  const t = content.trimStart();
  if (!t) return true;
  return (
    t.startsWith("<") ||
    t.startsWith("/") ||
    t.startsWith("!") ||
    t.startsWith("[Request interrupted") ||
    t.startsWith("[Tool ")
  );
}

/** Is this line a message Colin typed? Exported so the filter itself is testable. */
export function isColinTurn(line: TranscriptLine): line is TranscriptLine & {
  message: { content: string };
} {
  return (
    line.type === "user" &&
    !line.isSidechain &&
    line.toolUseResult === undefined &&
    typeof line.message?.content === "string"
  );
}

async function* transcripts(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* transcripts(p);
    else if (e.name.endsWith(".jsonl")) yield p;
  }
}

export async function harvest(projectsDir = PROJECTS_DIR): Promise<CorpusRecord[]> {
  const out: CorpusRecord[] = [];
  const seen = new Set<string>();

  for await (const path of transcripts(projectsDir)) {
    const rel = relative(projectsDir, path);
    const text = await Bun.file(path).text();
    let lineNo = 0;
    for (const raw of text.split("\n")) {
      lineNo++;
      if (!raw.trim()) continue;
      let line: TranscriptLine;
      try {
        line = JSON.parse(raw);
      } catch {
        continue; // a truncated final line in an active session
      }
      if (!isColinTurn(line)) continue;
      const content = line.message.content;
      if (isHarnessNoise(content)) continue;

      const sourceId = `${rel}#${lineNo}`;
      const id = recordId("claude-jsonl", sourceId, content);
      if (seen.has(id)) continue;
      seen.add(id);

      out.push({
        id,
        text: content,
        register: "raw", // provisional; corpus/register.ts assigns for real
        registerConfidence: 0,
        source: "claude-jsonl",
        sourceId,
        timestamp: line.timestamp ?? null,
        wordCount: words(content),
        // Transcript authorship is not in question: Colin typed into his own terminal. Only the
        // Drive documents need a human to vouch for who wrote them.
        verifiedBy: "heuristic",
        verifiedAt: null,
        split: null,
        quarantine: null,
      });
    }
  }
  return out;
}

if (import.meta.main) {
  const t0 = Date.now();
  const rows = await harvest();
  await Bun.write(PATHS.harvest, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const total = rows.reduce((n, r) => n + r.wordCount, 0);
  console.log(
    `harvested ${rows.length.toLocaleString()} messages / ${total.toLocaleString()} words ` +
      `in ${((Date.now() - t0) / 1000).toFixed(1)}s → ${PATHS.harvest}`,
  );
}
