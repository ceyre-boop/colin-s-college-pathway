# Scholarship Automation Playbook — Claude in Chrome

Your browser agent is already covered by Max (no API key, no extra cost). Install once, then
batch applications. Everything below is paste-ready.

---

## 1. Install (2 minutes — only you can do this part)

1. Go to **claude.ai/chrome** (or the Chrome Web Store → search "Claude").
2. Install the **official Anthropic "Claude for Chrome"** extension.
3. Pin it to your toolbar.
4. Open the side panel and **sign in with your claude.ai Max account**.
5. Done — no API key. Max has covered Claude for Chrome since Nov 24, 2025.

> **Safety (Anthropic's own guidance):** it recommends caution on sites involving financial or
> sensitive info, and scholarship forms qualify. So the workflow below **always stops before
> submitting** — you review every field and click submit yourself. Start on trusted sites
> (Bold.org, Niche, Fastweb) and watch the first few runs before trusting it.

---

## 2. Your profile block (paste into the side panel)

> Do not hand-edit profile facts here. This section used to hold a typed copy that drifted out of
> sync with the real profile. Generate the current block instead:
>
> ```
> bun identity/emit-prompt-profile.ts
> ```
>
> It prints from `identity/vault.json` — one identity source — and deliberately omits email, phone,
> street address, and DOB, since this text gets pasted into a browser chat. The same block is kept
> inline in section 4 between the `GENERATED PROFILE` markers.

Paste the generated block, then this instruction:

```
Fill this scholarship application using the profile above.
- Origin story: Outlined tumors on my uncle's MRI scans at a radiation oncology clinic —
  that turned an abstract interest in computation into a drive to build tools that fight cancer.
- Essay angle: [pick one per form — see section 4]

Generate the essay to match this form's prompt and word limit, fill every field,
then STOP before submitting so I can review.
```

---

## 3. Reusable shortcut — "Apply to Scholarship" (complete, paste-ready)

**Install (one time):** Claude for Chrome side panel → **Shortcuts** → **New** → name it
`Apply to Scholarship`, trigger **Manual**, paste the entire block below as the instruction.
The extension can't read local files or call the API with a key, so the profile is embedded
in the shortcut text itself — it travels with the shortcut. When facts change (GPA, school),
update them here and re-paste.

```
You are filling a scholarship application form on the current page for me. Follow these steps exactly.

STEP 1 — READ THE PAGE
Extract: scholarship name, organization, award amount, deadline, every required field,
every essay prompt and its word/character limit. If this page charges an application fee
or redirects to a paid service, STOP and tell me — do not fill anything.

STEP 2 — MY PROFILE (ground every field and every essay claim in these facts; never invent)
<!-- BEGIN GENERATED PROFILE -->
- Name: Colin Eyre
- Residency: MI · US citizen
- School: Mott Community College — Transfer student completing prerequisites at Mott Community College; home institution University of Michigan-Flint (returning).
- Major: Cellular and Molecular Biology, with optional Computer Science coursework
- GPA: 3.92/4.0 (3.92 at UM-Flint (Dean's List); 3.7 at Mott Community College) · 3.7 prior · SAT 1260
- Expected graduation: 2028
- Honors: AP Scholar with Distinction (2 consecutive years); Dean's List, University of Michigan-Flint; Eagle Scout (age 13)
- Work: Founding AI Engineer @ TABOOST (Production AI email system processing 200+ partnership emails/day across 16 inboxes); Founder @ Alta Investments (Live quantitative trading system built at 18)
- Activities: President, Lunch Bunch — reverse-inclusion program for special-needs and socially isolated students; Black belt in martial arts (6 years); 4th place state wrestling (Georgia); Youth instructor, Legacy MMA
- Goal: Build AI-driven computational oncology tools for cancer treatment planning and drug discovery
- Financial: FAFSA SAI -1500 (maximum Pell eligibility)
- NEVER claim: first-generation college student; any award requiring a demographic, geographic, institutional, or field eligibility Colin does not genuinely hold
- Contact details (email · phone · address · DOB): NOT in this block. Pull from the saved shortcut profile.
<!-- END GENERATED PROFILE -->
> Regenerate with: bun identity/emit-prompt-profile.ts --write

STEP 3 — FILL PERSONAL FIELDS
Fill every personal/academic/contact field from the profile. Leave anything the profile
doesn't cover blank and flag it for me at the end.

STEP 4 — ESSAYS
For each essay prompt, pick the ONE angle that best matches it:
- Leadership / community → Lunch Bunch: building belonging for kids who couldn't find it.
- Adversity / financial need → builder under constraint: shipping TABOOST and Alta solo at
  18-19 with maximum financial need; "the gap is just a variable — variables can be solved."
- Why your field / career goals → the MRI moment: outlining real tumors on scans at my uncle's
  radiation oncology clinic in North Dakota, used to plan radiation targeting — the direct line
  from data to a human life is why I'm building computational oncology tools.
- Perseverance / commitment → the pattern: black belt (6 years), Eagle Scout, state wrestling —
  multi-year commitments seen through to the result.
Write in first person, direct and concrete, a little wry. No clichés, no generic ambition
statements, nothing not grounded in the profile. Match the word limit exactly. Fill the field.

STEP 5 — HARD STOP
Do NOT submit. Do NOT click anything past the final review screen. List every field you
filled and its value, list anything you left blank, and wait for me to review and submit.
```

Then every new form is: open it → run **Apply to Scholarship** → review → submit. Target ~20 in an afternoon.

## BigFuture workflow (current safety contract)

College Board BigFuture is the preferred discovery surface because it is the trusted, logged-in
source. A login session is still not permission to guess or mass-submit representations. The app
tracks each opportunity through:

`discovered → verified → eligible → prioritized → prepared → needs-review → submitted → confirmed → won/rejected`

The prioritization score is:

`estimated award × realistic win-rate × verified eligibility confidence − application effort`

Eligibility confidence is evidence quality, not a license to round up an uncertain fact. If the
official rules do not establish that Colin qualifies, the opportunity stays in review. The browser
assistant may fill only facts explicitly present in the approved profile and must stop at the final
review screen. Colin personally checks attestations, uploads, and submission before clicking it.

---

## 4. Essay angles (rotate to avoid repetition)

- **The MRI moment** — tracing a tumor's boundary on a loved one's scan; computation made personal.
- **Builder under constraint** — shipping TABOOST and Alta solo, high financial need, no permission asked.
- **AI × biology** — why computational oncology / AI drug discovery is the lever that matters.
- **First-principles quant** — Alta Investments as proof of self-taught, rigorous systems thinking.
- **Long-horizon** — "the gap is just a variable" — engineering a path through college funding.

Match the angle to the prompt: leadership → builder; adversity → constraint; "why your field" → AI×biology / MRI.

---

## 5. Platform notes

- **Bold.org** — many small STEM awards; reuse one strong base essay, tweak the opening per prompt. High volume.
- **Niche / Scholarships360 / Appily** — no-essay, recurring monthly. Just fill + enter; near-zero effort.
- **Fastweb** — profile-matched; filter to STEM + essay-reuse candidates first.
- **Goldwater (Tier 3)** — not a form to batch. Needs a faculty nomination + ~1 yr research; get into a UM-Flint lab by Fall 2027.

---

## 6. Two engines, no redundant spend

| Need | Tool | Cost |
|------|------|------|
| Form-filling, multi-site research, batch applies | **Claude for Chrome** | Covered by Max |
| Drafting essays from your profile (this repo's AI Essays tab → paste to Claude) | **Claude Code on Max** | Free |
| *(Optional)* in-dashboard "Generate" button on the live site | Anthropic API key (Haiku, ~$0.07 / 100 essays, set a $10/mo hard cap) | ~$3–5/mo |

The dashboard tracks the money; Claude for Chrome does the clicking; Claude Code writes the words.
