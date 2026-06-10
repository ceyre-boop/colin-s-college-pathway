// Colin's real essay-facts — the raw material every generated essay is grounded in.
export const PROFILE = `
Name: Colin Eyre — 19, Swartz Creek, Michigan (Michigan resident).
School: University of Michigan–Flint — BS Cellular & Molecular Biology, CS minor.
  Currently knocking out prereqs at Mott Community College (strategic, lower cost), 3.7 GPA, ~50 credits banked.
Academics: 3.7 GPA. AP Scholar with Distinction (x2 — back-to-back). 9 total AP exams. SAT 1260.
Financial: FAFSA SAI -1500 — maximum need-based eligibility (full Pell). High financial need.

Character / athletics:
- Black belt in martial arts at age 11 (6 years of training).
- Eagle Scout at 13/14 (top ~4% of scouts).
- 4th place at state in wrestling as a junior — while maintaining a 4.1 GPA.

Work / building:
- Founding AI Engineer at TABOOST — built a production AI inbox manager handling 200+ emails/day across
  16 talent inboxes, replacing a full human team. One person, professional-grade infrastructure, at 19.
- Founder of Alta Investments — a sovereign quantitative trading system built from scratch at 18.
  Live forex, Sharpe 1.08, 0% bust probability across 100K simulations.

Goal: Computational oncology / AI drug discovery — building AI for cancer treatment planning.

Origin story (THE moment — real, specific):
- At his uncle's radiation oncology clinic in North Dakota, Colin outlined actual tumors on MRI scans that
  were then used to plan radiation targeting. That direct line from data to a human life is why he's building
  computational oncology tools.

Voice: direct, concrete, a little wry. "The gap is just a variable. Variables can be solved."
Avoid: clichés, generic ambition statements, anything not grounded in the facts above.
`.trim();

// Structured fields for form-filling (copied into Claude for Chrome alongside the essay).
export const PROFILE_FIELDS = {
  'Full name': 'Colin Eyre',
  Age: '19',
  Location: 'Swartz Creek, Michigan',
  School: 'University of Michigan–Flint (via Mott CC for prereqs)',
  Major: 'BS Cellular & Molecular Biology, CS minor',
  GPA: '3.7',
  Honors: 'AP Scholar with Distinction (x2), 9 AP exams, Eagle Scout, Black Belt, state wrestler',
  Work: 'Founding AI Engineer @ TABOOST; Founder @ Alta Investments',
  'Career goal': 'Computational oncology / AI drug discovery',
  'Financial need': 'FAFSA SAI -1500 (maximum Pell), high need, Michigan resident',
};

export function fieldsBlock() {
  return Object.entries(PROFILE_FIELDS)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');
}

// Compiles per-event "why this matters for scholarships" notes into a story bank that gets
// baked into the profile sent to the essay backend — the timeline's "secret weapon."
export function storyBank(timeline = []) {
  const lines = timeline
    .filter((e) => e.essay && e.essay.trim())
    .map((e) => `- ${e.title} (${e.year}): ${e.essay.trim()}`);
  return lines.length ? `STORY BANK (pick the angle that fits the prompt):\n${lines.join('\n')}` : '';
}

// Full profile for the essay backend: facts + story bank.
export function fullProfile(timeline) {
  const bank = storyBank(timeline);
  return bank ? `${PROFILE}\n\n${bank}` : PROFILE;
}
