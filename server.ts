// Bun web service: serves the built SPA from dist/ and drafts scholarship essays via the
// Anthropic Messages API. The API key lives here, server-side, never shipped to the browser.
// Token-minimal: Haiku by default, Sonnet only for high-value scholarships (see pickModel).

import { pickModel, costUsd, DEFAULT_MODEL } from "./src/lib/essayCost.js";

const PORT = Number(process.env.PORT ?? 3000);
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
// Shared bearer token gating /api/*. Set it in the Render dashboard and in the client's
// VITE_APP_TOKEN. Without it the endpoints refuse to serve rather than falling open.
const APP_TOKEN = process.env.APP_TOKEN;
const DIST = `${import.meta.dir}/dist`;
const MAX_BATCH = 100;
const MAX_PROFILE_CHARS = 24_000;
const MAX_CONTEXT_CHARS = 6_000;
const requestCounts = new Map<string, { started: number; count: number }>();

interface Scholarship {
  id: string;
  name: string;
  amount?: number | string;
  priority?: string;
  notes?: string;
}

function buildPrompt(s: Scholarship, profile: string, context?: string): string {
  const amount = s.amount ? ` ($${Number(s.amount).toLocaleString()})` : "";
  return [
    `Write a scholarship application essay of 400-500 words for "${s.name}"${amount}.`,
    s.notes ? `What it rewards: ${s.notes}` : "",
    "",
    "Applicant profile (ground every claim in these real facts — do not invent):",
    profile,
    context ? `\nExtra context for this essay:\n${context}` : "",
    "",
    "First person, specific, concrete; tie the story to what this scholarship rewards; no clichés",
    "or fabrication. Return only the essay text — no preamble, no title.",
  ]
    .filter(Boolean)
    .join("\n");
}

async function draftEssay(s: Scholarship, profile: string, context: string | undefined, modelOverride?: string) {
  const requestedModel = modelOverride && ["claude-3-5-haiku-latest", "claude-3-7-sonnet-latest"].includes(modelOverride) ? modelOverride : undefined;
  const model = requestedModel || pickModel(s);
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY as string,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1200,
      messages: [{ role: "user", content: buildPrompt(s, profile, context) }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as {
    content: Array<{ type: string; text?: string }>;
    usage?: { input_tokens: number; output_tokens: number };
  };
  const essay = data.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim();
  if (!essay) throw new Error("Anthropic returned no text");
  return { essay, model, words: essay.split(/\s+/).length, costUsd: costUsd(data.usage, model) };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

Bun.serve({
  port: PORT,
  // Bun's per-request timeout; batch of many essays can take a while.
  idleTimeout: 255,
  async fetch(request) {
    const url = new URL(request.url);

    // Read the open checkpoint queue. Same bearer gate as everything else under /api/.
    if (url.pathname === "/api/queue" && request.method === "GET") {
      if (!APP_TOKEN) return json({ error: "APP_TOKEN is not set on the server." }, 500);
      if (request.headers.get("authorization") !== `Bearer ${APP_TOKEN}`) return json({ error: "Unauthorized." }, 401);
      try {
        const { buildQueue } = await import("./state/emit-queue");
        return json({ queue: buildQueue() });
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : String(e) }, 500);
      }
    }

    if (url.pathname.startsWith("/api/") && request.method === "POST") {
      if (!ANTHROPIC_API_KEY) return json({ error: "ANTHROPIC_API_KEY is not set on the server." }, 500);
      // Auth before anything else. The rate limit below keys on x-forwarded-for, which the client
      // controls and can rotate freely — it is a politeness measure, never an access control. Without
      // this check anyone who finds the deployed URL can spend the Anthropic budget.
      if (!APP_TOKEN) return json({ error: "APP_TOKEN is not set on the server." }, 500);
      if (request.headers.get("authorization") !== `Bearer ${APP_TOKEN}`) return json({ error: "Unauthorized." }, 401);
      const client = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
      const now = Date.now();
      const bucket = requestCounts.get(client);
      if (!bucket || now - bucket.started > 60_000) requestCounts.set(client, { started: now, count: 1 });
      else if (bucket.count++ >= 30) return json({ error: "Rate limit reached. Try again in a minute." }, 429);
      let body: any;
      try {
        body = await request.json();
      } catch {
        return json({ error: "Invalid JSON body." }, 400);
      }
      // Checkpoint resolution — the queue's write path. This is why the queue cannot live in
      // localStorage: a Bun process has to read the human's answer back out of the event log.
      const resolveMatch = url.pathname.match(/^\/api\/queue\/([^/]+)\/resolve$/);
      if (resolveMatch) {
        // Attribution is never defaulted. Substituting a generic name here would satisfy the
        // queue's resolvedBy check while destroying the property it exists to guarantee: that an
        // irreversible decision can be traced to the person who made it.
        if (typeof body.resolvedBy !== "string" || !body.resolvedBy.trim()) {
          return json({ error: "resolvedBy is required — resolutions must be attributable to a person." }, 400);
        }
        try {
          const { resolve } = await import("./state/queue");
          resolve({
            checkpointId: decodeURIComponent(resolveMatch[1]),
            resolution: body.resolution,
            resolvedBy: body.resolvedBy,
            role: "human",
            note: body.note,
            evidenceRefs: body.evidenceRefs,
          });
          return json({ ok: true });
        } catch (e) {
          // Contract violations (illegal resolution, missing evidence, no attribution) are 400s —
          // the request was understood and deliberately refused.
          return json({ error: e instanceof Error ? e.message : String(e) }, 400);
        }
      }

      const profile: string = body.profile;
      if (!profile) return json({ error: "profile is required." }, 400);
      if (typeof profile !== "string" || profile.length > MAX_PROFILE_CHARS) return json({ error: "profile is too large." }, 413);

      try {
        // One essay.
        if (url.pathname === "/api/draft") {
          if (!body.scholarship?.name) return json({ error: "scholarship.name required." }, 400);
          if (typeof body.context === "string" && body.context.length > MAX_CONTEXT_CHARS) return json({ error: "context is too large." }, 413);
          const r = await draftEssay(body.scholarship, profile, body.context, body.model);
          return json({ id: body.scholarship.id, ...r });
        }
        // Many essays — sequential to stay gentle on rate limits.
        if (url.pathname === "/api/batch") {
          const list: Scholarship[] = body.scholarships ?? [];
          if (!list.length) return json({ error: "scholarships[] required." }, 400);
          if (list.length > MAX_BATCH) return json({ error: `Batch is limited to ${MAX_BATCH} essays.` }, 413);
          const results = [];
          for (const s of list) {
            try {
              const r = await draftEssay(s, profile, undefined, body.model);
              results.push({ id: s.id, ok: true, ...r });
            } catch (err) {
              results.push({ id: s.id, ok: false, error: err instanceof Error ? err.message : "failed" });
            }
          }
          return json({ results, totalCostUsd: results.reduce((a, r: any) => a + (r.costUsd ?? 0), 0) });
        }
      } catch (err) {
        return json({ error: err instanceof Error ? err.message : "draft failed." }, 500);
      }
      return json({ error: "Unknown endpoint." }, 404);
    }

    // Static files from dist/, with index.html fallback for client routing.
    if (request.method === "GET") {
      const filePath = url.pathname === "/" ? "/index.html" : url.pathname;
      const file = Bun.file(`${DIST}${filePath}`);
      if (await file.exists()) return new Response(file);
      const index = Bun.file(`${DIST}/index.html`);
      if (await index.exists()) return new Response(index);
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`Colin's College Pathway running on http://localhost:${PORT} (default model: ${DEFAULT_MODEL})`);
