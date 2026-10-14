// Essay writer — generation on the Claude Max subscription, voice enforced by voiceprint.
//
// Colin asked for essays written in his voice off his subscription, pointing at the voiceprint
// repo. Two facts shaped this file:
//
//   1. voiceprint CANNOT generate. `test/no-generation.test.ts` fails its build if an LLM call
//      appears. It measures and judges. So voiceprint supplies the prompt material and the gate;
//      the model call lives here.
//   2. The `colin/chat` voice is trained on 394 Claude Code PROMPTS — 77 words mean, 84% of
//      sentences lowercase, 64 misspellings per 1,000 words, and that misspelling rate is its
//      strongest signature against AI. Writing a scholarship essay to that profile would submit
//      150 lowercase words with typos. The default here is the `philosophy` voice: 8 samples of
//      his real school essays, 573 words mean, 17.8-word sentences, proper capitalization.
//
// The loop: voiceprint `voice prompt` → Inference.ts (subscription) → voiceprint `voice check` →
// revise against the exact misses → repeat. If the gate never passes, this writes NOTHING and
// says so. A draft that fails the voice gate is worse than no draft.
//
// Usage:
//   bun llm/write-essay.ts --slug nase-future-entrepreneur-award --words 500
//   bun llm/write-essay.ts --archetype why-business --words 500 --out /tmp/draft.md
//   bun llm/write-essay.ts --slug x --voice philosophy --attempts 4
//   bun llm/write-essay.ts --slug x --dry       # print the prompt, call no model

import { spawnSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const ROOT = join(import.meta.dir, "..");
const VOICEPRINT = process.env.VOICEPRINT_REPO ?? join(homedir(), "voiceprint");
const INFERENCE = join(homedir(), ".claude", "PAI", "TOOLS", "Inference.ts");
const PROFILE = join(ROOT, "scholarship_essays", "voice_profile.md");

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);
const val = (f: string, d: string | null = null) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

const SLUG = val("--slug");
const ARCHETYPE = val("--archetype");
const WORDS = Number(val("--words", "500"));
// Essay register, not chat register. See the header note on colin/chat.
const VOICE = val("--voice", "philosophy")!;
const ATTEMPTS = Number(val("--attempts", "4"));
const DRY = has("--dry");
const OUT = val("--out");

// The seven archetype prompts, kept in step with scout/topic-bank.ts.
const ARCHETYPE_PROMPTS: Record<string, string> = {
  "personal-statement": "Tell us about yourself. What shaped you, and what are you doing with it?",
  "why-deserve": "Why should you receive this scholarship, and what will it change for you?",
  "career-goals": "What are your academic and career goals, and how did you choose this field?",
  "adversity": "Describe a challenge or setback you faced and what it taught you.",
  "leadership": "Describe a time you led. What did you build or change, and who did it serve?",
  "community-service": "How have you served your community, and what difference did it make?",
  "why-business": "What have you built, and why does building a business matter to you?",
};

function die(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function vp(args: string[], stdin?: string) {
  return spawnSync("bun", ["cli.ts", ...args], {
    cwd: VOICEPRINT, encoding: "utf8", input: stdin, maxBuffer: 32 * 1024 * 1024, timeout: 120_000,
  });
}

// What the essay is for: the scholarship's own facts, so the piece can name them.
function scholarshipContext(slug: string): { name: string; request: string } {
  const metaPath = join(ROOT, "scholarship_essays", slug, "metadata.json");
  if (!existsSync(metaPath)) die(`no metadata for slug "${slug}" — expected ${metaPath}`);
  const m = JSON.parse(readFileSync(metaPath, "utf8"));
  const prompts: string[] = m.formMeta?.essayPrompts ?? [];
  // A probed prompt is the real thing; the archetype is the fallback when probing found none.
  const promptText = prompts.length
    ? prompts.join("\n")
    : ARCHETYPE_PROMPTS[ARCHETYPE ?? ""] ?? ARCHETYPE_PROMPTS["personal-statement"];
  const bits = [
    `Scholarship: ${m.name}${m.org ? ` (${m.org})` : ""}`,
    m.amount ? `Award: $${Number(m.amount).toLocaleString("en-US")}` : null,
    m.angle_summary ? `Angle already chosen for this one: ${m.angle_summary}` : null,
    `Essay prompt: ${promptText}`,
    `Target length: about ${WORDS} words.`,
  ].filter(Boolean);
  return { name: m.name ?? slug, request: bits.join("\n") };
}

function main() {
  if (!existsSync(VOICEPRINT)) die(`voiceprint repo not found at ${VOICEPRINT} (set VOICEPRINT_REPO)`);
  if (!existsSync(INFERENCE)) die(`Inference.ts not found at ${INFERENCE}`);
  if (!SLUG && !ARCHETYPE) die("pass --slug <scholarship> or --archetype <one of: " + Object.keys(ARCHETYPE_PROMPTS).join(", ") + ")");
  if (ARCHETYPE && !ARCHETYPE_PROMPTS[ARCHETYPE]) die(`unknown archetype "${ARCHETYPE}"`);

  const listed = vp(["voice", "list"]);
  if (!listed.stdout?.includes(VOICE.split("@")[0])) {
    die(`voice "${VOICE}" not frozen in ${VOICEPRINT}. Available:\n${listed.stdout ?? listed.stderr}`);
  }

  const ctx = SLUG ? scholarshipContext(SLUG) : { name: ARCHETYPE!, request: `Essay prompt: ${ARCHETYPE_PROMPTS[ARCHETYPE!]}\nTarget length: about ${WORDS} words.` };

  // voice_profile.md carries the hand-written rules the measured bands can't express — the
  // no-corporate-phrases list, the MRI north star, outcome-first ordering.
  const rules = existsSync(PROFILE)
    ? readFileSync(PROFILE, "utf8").split("## The voice, from actual writing samples")[1]?.slice(0, 4000) ?? ""
    : "";

  let previous: string | null = null;
  let misses = "";

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    // 1. voiceprint builds the prompt material: the measured bands, the AI tells, the samples.
    //    No model call happens inside voiceprint.
    const req = [ctx.request, rules ? `\nAdditional voice rules:${rules}` : "",
                 misses ? `\nYour previous draft missed these measured bands — fix exactly these:\n${misses}` : ""].join("\n");
    const promptRes = vp(["voice", "prompt", VOICE], JSON.stringify({ request: req, previous }));
    if (promptRes.status !== 0) die(`voiceprint voice prompt failed:\n${promptRes.stderr ?? promptRes.stdout}`);
    const material = promptRes.stdout.trim();

    if (DRY) {
      console.log(material);
      console.log(`\n--- (dry run: no model call; would use Inference.ts --level smart, attempt ${attempt}/${ATTEMPTS}) ---`);
      return;
    }

    // 2. The model call — Claude Max subscription via Inference.ts, no API key involved.
    console.error(`attempt ${attempt}/${ATTEMPTS}: writing with Inference.ts (subscription, smart tier)…`);
    const gen = spawnSync("bun", [INFERENCE, "--level", "smart", material,
      `Write the piece now. ${WORDS} words.`],
      { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 15 * 60_000 });
    if (gen.status !== 0) die(`Inference.ts failed (attempt ${attempt}):\n${(gen.stderr ?? "").slice(0, 1200)}`);
    const draft = (gen.stdout ?? "").trim();
    if (!draft) die(`Inference.ts returned nothing (attempt ${attempt})`);

    // 3. The gate. voiceprint measures the draft against the frozen voice.
    const tmpDir = join(homedir(), ".claude", "memory", "scholarship-scout");
    mkdirSync(tmpDir, { recursive: true });
    const tmp = join(tmpDir, `draft-attempt-${attempt}.md`);
    writeFileSync(tmp, draft);
    const check = vp(["voice", "check", VOICE, tmp]);
    const verdict = `${check.stdout ?? ""}${check.stderr ?? ""}`.trim();
    const inBand = /IN BAND/.test(verdict);
    console.error(inBand ? `  ✓ IN BAND (attempt ${attempt})` : `  ✗ OUT OF BAND (attempt ${attempt})`);

    if (inBand) {
      const dest = OUT ?? (SLUG ? join(ROOT, "scholarship_essays", SLUG, "essay.md") : join(tmpDir, `${ARCHETYPE}.md`));
      writeFileSync(dest, draft + "\n");
      console.error(`\nwrote ${dest.replace(ROOT + "/", "")} — ${draft.split(/\s+/).length} words, voice "${VOICE}", passed on attempt ${attempt}.`);
      console.error(`Read it and make it yours before it goes anywhere. Nothing here submits.`);
      console.log(draft);
      return;
    }

    previous = draft;
    // Feed the exact band misses back, which is what voiceprint's revise loop is designed for.
    misses = verdict.split("\n").filter((l) => /miss|out of band|allowed|expected/i.test(l)).join("\n").slice(0, 3000);
  }

  // Deliberate: no file is written. A draft that fails the voice gate reads as AI, and that is
  // the one thing this whole pipeline exists to avoid.
  console.error(`\nFAILED the "${VOICE}" voice gate ${ATTEMPTS} times — writing nothing.`);
  console.error(`Last misses:\n${misses}`);
  console.error(`\nThe honest fix is more samples: the voice has few enough that its own gate`);
  console.error(`rejects even Colin's real essays some of the time. Add essays with`);
  console.error(`\`bun cli.ts train\` in ${VOICEPRINT.replace(homedir(), "~")} and re-freeze the voice.`);
  process.exit(2);
}

main();
