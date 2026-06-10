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

```
Fill this scholarship application using my profile:
- Name: Colin Eyre
- Age: 19, Swartz Creek MI
- School: University of Michigan–Flint
- Major: BS Cellular & Molecular Biology, CS minor
- GPA: 3.7; AP Scholar with Distinction (x2)
- Work: Founding AI Engineer @ TABOOST; Founder @ Alta Investments (quant trading)
- Goal: Computational oncology / AI drug discovery
- Financial: FAFSA SAI -1500 (max Pell), high need, Michigan resident
- Origin story: Outlined tumors on my uncle's MRI scans at a radiation oncology clinic —
  that turned an abstract interest in computation into a drive to build tools that fight cancer.
- Essay angle: [pick one per form — see section 4]

Generate the essay to match this form's prompt and word limit, fill every field,
then STOP before submitting so I can review.
```

---

## 3. Reusable shortcut — "Apply to Scholarship"

Claude for Chrome supports saved shortcuts. Build this once (side panel → shortcuts → new):

```
SHORTCUT NAME: Apply to Scholarship
TRIGGER: Manual
STEPS:
1. Read the current page — extract scholarship name, org, amount, requirements, word limits.
2. Load my profile (paste from section 2, or save it to the extension's memory once).
3. Fill all personal-info fields.
4. Generate a custom essay matching the form's prompt and word limit.
5. Fill the essay field.
6. STOP — show me everything you filled. Do NOT submit. I review and submit myself.
```

Then every new form is: open it → run **Apply to Scholarship** → review → submit. Target ~20 in an afternoon.

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
