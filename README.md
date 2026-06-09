# Colin's College Pathway 🎓

A personal college funding tracker built with React + Vite. Tracks costs, scholarships, government aid, and shows the remaining funding gap (in red — that's the bad number to eliminate).

## Features

- **Dashboard** — 5-year funding snapshot. The red number is the gap. Make it zero.
- **Cost Estimator** — Edit tuition, housing, food, books, transport, and misc. Calculates 5-year totals.
- **Government Aid** — FAFSA award tracking: Pell Grants, SEOG, subsidized/unsubsidized loans, work-study, state grants, institutional aid.
- **Scholarships** — Full scholarship pipeline tracker with status (Found → Applied → Won/Rejected), priority (Easy Win / Medium / Long Shot), AI application tips, and bulk-apply strategy.
- **Budget** — Complete picture combining all funding sources vs. total cost. Progress bars + color-coded breakdown.

## Strategy (built into the app)

1. File FAFSA first — free money, no excuse not to.
2. Apply for all state grants.
3. Sweep local scholarships (easiest wins, least competition).
4. Mass-apply with AI (Claude) using the scholarship tracker.
5. Long-shot national scholarships last.

## Development

```bash
npm install
npm run dev      # start dev server
npm run build    # production build
npm run preview  # preview production build
npm run lint     # lint
```

All data is saved in your browser's localStorage — nothing leaves your computer.
