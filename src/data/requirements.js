// Degree requirements vs. what Colin has — from the UM-Flint 2026-2027 CMB catalog + his transcript.
// Deterministic (no LLM). Statuses: 'done' (green), 'partial' (yellow), 'gap' (red).

export const VERIFIED_CREDITS = {
  ap_transfer: 32, // official UM-Flint transcript (AP exams)
  umflint_fall25: 15, // 3.92 GPA, Dean's List
  mott_effective: 9, // non-duplicate Mott Winter '26 credits (MATH 145 duplicates AP MTH 120)
  in_hand: 56, // ap + umflint + mott_effective, as of June 2026
  mott_fall26_enrolled: 14, // COMM 131 + FILM 181 + MATH 170 + PHIL 101 (waitlists are padding/backups)
  mott_winter27_residency: 8, // residency semester: COMM 131 + TECH 121A + open elective
  total_entering_f27: 70, // 56 + 14 — current secured Fall '26 schedule before residency padding
  degree_required: 120,
  remaining: 50, // conservative remaining credits after Fall '26 secured schedule; residency padding is excluded until transfer review
  upper_division_required: 33, // at least 33 must be 300+
  upper_division_have: 3, // PHL 168
};

export const GRAD_TARGET = 'Spring 2030';

// Each requirement category: what it needs, what's done, and the line items.
export const REQUIREMENTS = [
  {
    group: 'Major — Biology (BIO/BTC)', required: '44 cr (max 18 below 300-level)', status: 'partial',
    items: [
      { name: 'BIO 111 Organismal Biology', cr: 4, status: 'done', note: 'A-' },
      { name: 'BIO 113 Principles of Biology', cr: 4, status: 'done', note: 'AP (4)' },
      { name: 'PSY 316 Biological Psychology', cr: 3, status: 'done', note: 'A — counts toward 44' },
      { name: 'BIO 326 Cell Biology', cr: 4, status: 'gap' },
      { name: 'BIO 328 Genetics', cr: 4, status: 'gap' },
      { name: 'BIO 301 Biostatistics', cr: 4, status: 'gap', note: 'bridges bio + data' },
      { name: 'BIO 435 Microbiology', cr: 4, status: 'gap' },
      { name: 'BIO 467 Molecular Biology of Prokaryotes', cr: 4, status: 'gap' },
      { name: 'BIO 468 Molecular Biology of Eukaryotes', cr: 4, status: 'gap' },
      { name: 'BTC 120 Phage Hunters: Discovery', cr: 3, status: 'gap' },
      { name: 'BTC 122 Phage Hunters: Omics', cr: 3, status: 'gap' },
      { name: 'BIO 487 Pathology / 525 Immunology (electives → 44)', cr: 6, status: 'gap', note: 'tie to oncology' },
    ],
  },
  {
    group: 'Major — Chemistry', required: '24-26 cr', status: 'partial',
    items: [
      { name: 'CHM 260 Principles of Chemistry I', cr: 4, status: 'done', note: 'A+' },
      { name: 'CHM 261 General Chemistry Lab', cr: 1, status: 'done', note: 'A' },
      { name: 'CHM 262 / 263 Chem II + Lab', cr: 5, status: 'gap', note: 'take at UM-Flint (no longer in the Mott plan)' },
      { name: 'CHM 330/331 Organic Chemistry I + Lab', cr: 5, status: 'gap' },
      { name: 'CHM 332/333 Organic Chemistry II + Lab', cr: 5, status: 'gap' },
      { name: 'CHM 450 Biochemistry I', cr: 3, status: 'gap' },
      { name: 'CHM 452 Biochemistry II', cr: 3, status: 'gap' },
    ],
  },
  {
    group: 'Major — Mathematics', required: '4 cr', status: 'gap',
    items: [{ name: 'MTH 118 Applied Calculus', cr: 4, status: 'gap', note: 'have the pre-calc prereq (AP), still need the course' }],
  },
  {
    group: 'Major — Physics', required: '8 cr', status: 'gap',
    items: [
      { name: 'PHY 143/243 Physics I', cr: 4, status: 'gap', note: '243 (calc-based) reads better for PhD' },
      { name: 'PHY 145/245 Physics II', cr: 4, status: 'gap' },
    ],
  },
  {
    group: 'Gen Ed', required: '30 cr across 7 categories', status: 'partial',
    items: [
      { name: 'ENG 111 Composition', cr: 3, status: 'done', note: 'AP' },
      { name: 'FQ Quantitative Literacy', cr: 3, status: 'done', note: 'AP Stats' },
      { name: 'Natural Science + Lab', cr: 4, status: 'done', note: 'CHM 260/261' },
      { name: 'Social Science', cr: 6, status: 'done', note: 'way over (24 cr from AP)' },
      { name: 'COMP — ENG 112', cr: 3, status: 'gap', note: 'COMM 131 may satisfy this; verify transfer first' },
      { name: 'Fine Arts (F)', cr: 3, status: 'gap', note: 'Mott FILM 181 (Fall 2026) → COM 272' },
      { name: 'Humanities (H)', cr: 6, status: 'partial', note: 'PHL 168 (3) done + Mott PHIL 101 (Fall 2026) → PHL 101 closes it' },
    ],
  },
  {
    group: 'Optional Support — CS / Computation', required: 'Not required for the degree', status: 'partial',
    items: [
      { name: 'CIT 100 Technology Foundations', cr: 4, status: 'gap', note: 'nice-to-have, not required' },
      { name: 'CSC 127 Unix Systems', cr: 1, status: 'gap', note: 'small skill-up, not a degree gate' },
      { name: 'CSC 384 Database Design', cr: 3, status: 'gap', note: 'most directly useful computing elective' },
      { name: 'MTH 220 Linear Algebra', cr: 3, status: 'gap', note: 'strong for computational oncology / bioinformatics' },
      { name: 'BIO 492 Independent Study / Research', cr: 3, status: 'gap', note: 'take only if it becomes real lab work' },
    ],
    note: 'PIBS/DCMB coursework in actual ML (bioinformatics-specific) comes AFTER admission — these courses aren\'t the gap. The pre-application gap is a documented ML portfolio: TABOOST infra + Alta Investments quant system are the evidence PIBS reviewers want, so keep writing them up as you build.',
  },
];

export const ACTION_ITEMS = [
  'transfer.umflint.edu → verify COMM 131→COM 210 or comm/gen-ed coverage, MATH 170→MTH 118 or equivalent, FILM 181→COM 272 (F), PHIL 101→PHL 101 (H)',
  'Fall 2026 at Mott: COMM 131, MATH 170, FILM 181, PHIL 101 (14 enrolled cr; MUS 187 / PHIL waitlist are padding, not degree drivers)',
  'Winter 2027 = Mott residency semester (8 cr, half-time for partial Pell) — establishes 12+ months MI residency',
  'Get a Michigan driver\'s license, then submit the MI residency application Feb 2027 for in-state tuition',
  'Apply for UM-Flint readmission for Fall 2027 (deadline Aug 10)',
  'CIT 100 / CSC 127 / CSC 384 / MTH 220 are support courses, not degree gates — do not let them push out required biology and chemistry',
  'CHM chain: take CHM 262/263 in Fall 2027 BEFORE CHM 330 Organic (Winter 2028)',
  'Email Dr. Sucic: returning Fall 2027, CMB, AI/Python experience, want lab access + SUCCES/UROP if the fit is real',
  'Fall 2028 (junior year): apply for the PIBS Preview weekend at UM Ann Arbor — UM pays travel/lodging/food; meet DCMB faculty before the formal application',
  'PIBS application (Bioinformatics Track A or Cancer Biology Track B) opens late Aug 2029, due Dec 1 2029 — no GRE required; go in with 2 years of Dr. Sucic lab experience plus TABOOST/Alta as the documented ML portfolio',
];

export const KEY_CONTACTS = [
  { name: 'Cydnee Robertson', role: 'CMB Academic Advisor', info: 'cweirauc@umich.edu' },
  { name: 'Dr. Joseph Sucic', role: 'CMB Faculty / Research', info: 'umflint.edu/cit/faculty-staff' },
  { name: 'Suzanne Adam', role: 'Mott→UM-Flint Transfer Coordinator', info: 'suadam@umich.edu · MMB 1002' },
];
