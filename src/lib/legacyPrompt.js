// The original six-line essay prompt — arm v1, and the offline fallback.
//
// This lived in TWO places, character-identical: server.ts and src/App.jsx. Two copies of a prompt
// drift, and a drifted control arm silently invalidates every comparison made against it.
//
// It is deliberately FROZEN. Improvements belong in voice/build-prompt.ts (arm v2). If this
// changes, the eval control changes with it and prior results stop being comparable.
//
// Kept dependency-free so both the Bun server and the browser bundle can import it.

export function buildLegacyPrompt(s, profile, context) {
  if (!s) return "";
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
