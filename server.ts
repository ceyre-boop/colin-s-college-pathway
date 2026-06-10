// Single Bun web server: serves the built SPA from dist/ and proxies essay
// generation to Anthropic. The API key lives here, server-side, and is never
// shipped to the browser.

const PORT = Number(process.env.PORT ?? 3000);
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = "claude-sonnet-4-6";
const DIST = `${import.meta.dir}/dist`;

interface EssayRequest {
  scholarshipName: string;
  scholarshipFocus: string;
  amount?: string;
  profile: string;
  extraContext?: string;
}

function buildPrompt(req: EssayRequest): string {
  return [
    "Write a scholarship application essay of 400-500 words.",
    "",
    `SCHOLARSHIP: ${req.scholarshipName}` + (req.amount ? ` (${req.amount})` : ""),
    `WHAT THIS SCHOLARSHIP REWARDS: ${req.scholarshipFocus}`,
    "",
    "APPLICANT PROFILE (ground every claim in these real facts — do not invent):",
    req.profile,
    req.extraContext ? `\nADDITIONAL CONTEXT FOR THIS ESSAY:\n${req.extraContext}` : "",
    "",
    "Requirements:",
    "- First person, specific, and concrete. Use the applicant's real moments and projects.",
    "- Tie the applicant's story directly to what this specific scholarship rewards.",
    "- No generic filler, no clichés, no fabricated achievements.",
    "- 400-500 words. Return only the essay text, no preamble or title.",
  ].join("\n");
}

async function generateEssay(req: EssayRequest): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY as string,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1500,
      messages: [{ role: "user", content: buildPrompt(req) }],
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${detail}`);
  }

  const data = (await res.json()) as { content: Array<{ type: string; text?: string }> };
  const text = data.content
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("")
    .trim();
  if (!text) throw new Error("Anthropic returned no text content");
  return text;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

Bun.serve({
  port: PORT,
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/api/essay" && request.method === "POST") {
      if (!ANTHROPIC_API_KEY) {
        return json({ error: "ANTHROPIC_API_KEY is not set on the server." }, 500);
      }
      let req: EssayRequest;
      try {
        req = (await request.json()) as EssayRequest;
      } catch {
        return json({ error: "Invalid JSON body." }, 400);
      }
      if (!req.scholarshipName || !req.profile) {
        return json({ error: "scholarshipName and profile are required." }, 400);
      }
      try {
        const essay = await generateEssay(req);
        return json({ essay });
      } catch (err) {
        return json({ error: err instanceof Error ? err.message : "Essay generation failed." }, 500);
      }
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

console.log(`Colin's College Pathway running on http://localhost:${PORT}`);
