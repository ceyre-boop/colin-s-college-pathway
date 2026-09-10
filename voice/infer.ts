// The single inference entry point for corpus/, voice/, and eval/.
//
// Mirrors the backend selection already proven in scout/scout.ts: use the Anthropic API when a key
// is present, otherwise shell out to PAI's Inference.ts, which is subscription-billed and therefore
// free at the margin. There is no ANTHROPIC_API_KEY in .env today, so the CLI path is the default
// and the whole project costs nothing to run.
//
// Everything routes through here so the backend is one edit away, and so eval runs and production
// drafts cannot silently diverge onto different models.

import { join } from "path";
import { homedir } from "os";

export type Level = "fast" | "standard" | "smart";

export interface InferOpts {
  system?: string;
  user: string;
  maxTokens?: number;
  level?: Level;
  /** Sampling temperature. Eval uses a fixed value so runs are comparable. */
  temperature?: number;
  timeoutMs?: number;
}

export interface InferResult {
  text: string;
  backend: "anthropic-api" | "pai-inference";
  model: string;
  costUsd: number;
}

const LEVEL_MODEL: Record<Level, string> = {
  fast: "claude-haiku-4-5",
  standard: "claude-sonnet-4-6",
  smart: "claude-sonnet-4-6",
};

async function viaApi(o: InferOpts, apiKey: string): Promise<InferResult> {
  const model = LEVEL_MODEL[o.level ?? "standard"];
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: o.maxTokens ?? 2000,
      ...(o.temperature !== undefined ? { temperature: o.temperature } : {}),
      ...(o.system ? { system: o.system } : {}),
      messages: [{ role: "user", content: o.user }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as {
    content: Array<{ type: string; text?: string }>;
    usage?: { input_tokens: number; output_tokens: number };
  };
  const text = data.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim();
  const { costUsd } = await import("../src/lib/essayCost.js");
  return { text, backend: "anthropic-api", model, costUsd: costUsd(data.usage, model) };
}

async function viaCli(o: InferOpts): Promise<InferResult> {
  const tool = join(homedir(), ".claude", "PAI", "TOOLS", "Inference.ts");
  const level = o.level ?? "standard";
  const proc = Bun.spawn(
    ["bun", tool, "--level", level, "--timeout", String(o.timeoutMs ?? 120_000), o.system ?? "", o.user],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;
  if (proc.exitCode !== 0) {
    throw new Error(`Inference.ts exit ${proc.exitCode}: ${(err || out).slice(0, 300)}`);
  }
  return { text: out.trim(), backend: "pai-inference", model: level, costUsd: 0 };
}

/** One retry: Inference.ts times out under load often enough that a single attempt is flaky. */
export async function infer(o: InferOpts): Promise<InferResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return apiKey ? await viaApi(o, apiKey) : await viaCli(o);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

export function backendName(): string {
  return process.env.ANTHROPIC_API_KEY ? "Anthropic API" : "PAI Inference.ts (subscription, $0 marginal)";
}
