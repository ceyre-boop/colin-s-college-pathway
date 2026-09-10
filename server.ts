// Bun web service: serves the built SPA from dist/ and drafts scholarship essays via the
// Anthropic Messages API. The API key lives here, server-side, never shipped to the browser.
// Token-minimal: Haiku by default, Sonnet only for high-value scholarships (see pickModel).

import { pickModel, costUsd, DEFAULT_MODEL, PRICING } from "./src/lib/essayCost.js";

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

// Which prompt arm to run. "v2" is the conditioned arm (voice_profile.md + register contract +
// register-matched exemplars + retrieved facts). "v1" is the original six-line prompt, kept
// runnable so eval/ always has a control to compare against — a conditioning result without a
// control is not a result.
type Arm = "v1" | "v2";
const VOICE_PROMPT = (process.env.VOICE_PROMPT ?? "v2") as Arm;

/** Build the messages for one essay under the given arm. */
async function promptFor(
  arm: Arm,
  s: Scholarship,
  profile: string,
  context: string | undefined,
  register: string,
): Promise<{ system?: string; user: string; provenance?: unknown }> {
  const { buildVoicePrompt } = await import("./voice/build-prompt.ts");
  const { buildLegacyPrompt } = await import("./src/lib/legacyPrompt.js");
  if (arm === "v1") return { user: buildLegacyPrompt(s, profile, context) };

  const { contractFor } = await import("./voice/registers.ts");
  const reg = register as Parameters<typeof contractFor>[0];
  const built = await buildVoicePrompt({
    scholarship: s,
    seed: context ?? "",
    register: reg,
    context,
    contract: contractFor(reg),
  });
  return { system: built.system, user: built.user, provenance: built.provenance };
}

async function draftEssay(
  s: Scholarship,
  profile: string,
  context: string | undefined,
  modelOverride?: string,
  arm: Arm = VOICE_PROMPT,
  register = "narrative",
) {
  // Derived from PRICING, never restated. A hand-written allowlist drifted out of sync with the
  // pricing table once already, so every client override silently fell through to pickModel().
  const requestedModel = modelOverride && Object.keys(PRICING).includes(modelOverride) ? modelOverride : undefined;
  const model = requestedModel || pickModel(s);
  const { system, user, provenance } = await promptFor(arm, s, profile, context, register);
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
      ...(system ? { system } : {}),
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as {
    content: Array<{ type: string; text?: string }>;
    usage?: { input_tokens: number; output_tokens: number };
  };
  const essay = data.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim();
  if (!essay) throw new Error("Anthropic returned no text");

  // Report the register verdict alongside the draft. Silently shipping text that missed its own
  // contract would make the register claim unfalsifiable — the failures are the finding.
  let registerCheck: unknown = null;
  if (arm === "v2") {
    const { validate } = await import("./voice/registers.ts");
    registerCheck = validate(essay, register as Parameters<typeof validate>[1]);
  }

  return {
    essay,
    model,
    arm,
    words: essay.split(/\s+/).length,
    costUsd: costUsd(data.usage, model),
    registerCheck,
    provenance,
  };
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
          const r = await draftEssay(body.scholarship, profile, body.context, body.model, body.arm ?? VOICE_PROMPT, body.register ?? "narrative");
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
              const r = await draftEssay(s, profile, undefined, body.model, body.arm ?? VOICE_PROMPT, body.register ?? "narrative");
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

console.log(`Colin's College Pathway running on http://localhost:${PORT} (default model: ${DEFAULT_MODEL}, prompt arm: ${VOICE_PROMPT})`);
