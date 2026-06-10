// Real per-semester financials (Colin's actual plan: Mott Fall '26 → UM-Flint Winter '29).
// cost/pell/other are dollars; school drives the in-state/out-of-state adjustment.
export const SEMESTERS_COST = [
  { id: 'F26', label: "Fall '26", school: 'Mott', credits: 10, cost: 1900, pell: 3500, other: 0 },
  { id: 'W27', label: "Win '27", school: 'UM-Flint', credits: 16, cost: 9440, pell: 3697, other: 2500 },
  { id: 'SS27', label: "Sum '27", school: 'UM-Flint', credits: 9, cost: 5310, pell: 1500, other: 0 },
  { id: 'F27', label: "Fall '27", school: 'UM-Flint', credits: 16, cost: 9440, pell: 3697, other: 0 },
  { id: 'W28', label: "Win '28", school: 'UM-Flint', credits: 14, cost: 8260, pell: 3697, other: 0 },
  { id: 'SS28', label: "Sum '28", school: 'UM-Flint', credits: 9, cost: 5310, pell: 1500, other: 0 },
  { id: 'F28', label: "Fall '28", school: 'UM-Flint', credits: 14, cost: 8260, pell: 3697, other: 0 },
  { id: 'W29', label: "Win '29", school: 'UM-Flint', credits: 14, cost: 8260, pell: 3697, other: 0 },
];

// In-state tuition baseline vs out-of-state (UM-Flint per-year est.). Applied to UM-Flint cost only.
export const OUT_OF_STATE_RATIO = 22600 / 12280;

// Returns per-semester { cost, funded, gap } adjusted for residency, plus scholarships won.
export function semesterFinancials(inState, scholarshipsWon = 0) {
  const adj = inState ? 1 : OUT_OF_STATE_RATIO;
  const rows = SEMESTERS_COST.map((s) => {
    const cost = Math.round(s.cost * (s.school === 'UM-Flint' ? adj : 1));
    const funded = Math.min(cost, s.pell + s.other);
    return { ...s, cost, funded, gap: Math.max(0, cost - s.pell - s.other) };
  });
  const totalCost = rows.reduce((a, s) => a + s.cost, 0);
  const totalPell = rows.reduce((a, s) => a + s.pell, 0);
  const totalOther = rows.reduce((a, s) => a + s.other, 0);
  const totalFunded = totalPell + totalOther + scholarshipsWon;
  return { rows, totalCost, totalPell, totalOther, totalFunded, gap: Math.max(0, totalCost - totalFunded) };
}
