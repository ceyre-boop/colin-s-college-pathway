// Degree requirements vs. what Colin has — from the UM-Flint 2026-2027 CMB catalog + his transcript.
// Deterministic (no LLM). Statuses: 'done' (green), 'partial' (yellow), 'gap' (red).

export const VERIFIED_CREDITS = {
  ap_transfer: 32, // official UM-Flint transcript (AP exams)
  umflint_fall25: 15, // 3.92 GPA, Dean's List
  mott_effective: 9, // non-duplicate Mott credits (MATH 145 duplicates AP MTH 120)
  in_hand: 56, // ap + umflint + mott_effective, as of June 2026
  mott_fall26_planned: 11, // ENGL 102 + FILM 181 + MUS 187 + MATH 164 (≈13 cr; aggregate kept at prior estimate)
  total_entering_w27: 67,
  degree_required: 120,
  remaining: 53, // to take at UM-Flint after Mott
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
      { name: 'COMP — ENG 112', cr: 3, status: 'gap', note: 'Mott ENGL 102 this fall' },
      { name: 'Fine Arts (F)', cr: 3, status: 'gap', note: '⚠ ZERO — add ARTC 110 / MUSC 100 at Mott this fall' },
      { name: 'Humanities (H)', cr: 6, status: 'partial', note: 'have PHL 168 (3) — need 3 more' },
    ],
  },
  {
    group: 'CS Minor', required: '~16-20 cr', status: 'gap',
    items: [
      { name: 'CSC 175 Programming I', cr: 4, status: 'partial', note: 'petition to waive — you code in production' },
      { name: 'CSC 275 Programming II', cr: 4, status: 'gap' },
      { name: 'CSC 375 Data Structures', cr: 3, status: 'gap' },
      { name: 'CSC 379 Algorithm Analysis', cr: 3, status: 'gap', note: 'your quant backtester is this' },
      { name: 'CSC 384 Database Design', cr: 3, status: 'gap', note: 'Firebase/Supabase = easy A' },
      { name: 'CSC 370 Info Security (elective)', cr: 3, status: 'gap' },
    ],
  },
];

export const ACTION_ITEMS = [
  'transfer.umflint.edu → verify ENGL 102→ENG 112, FILM 181→COM 272 (F), MUS 187→MUS 245 (H), MATH 164→MTH 118',
  'Register at Mott for Fall 2026: ENGL 102, FILM 181, MUS. 187, MATH 164 (13 cr — all 3 gen-ed gaps + calculus)',
  'CIT 100: COMI 160 does NOT transfer as CIT 100 (maps to CIS 200/BUS 115) — take CIT 100 at UM-Flint',
  'Apply for UM-Flint readmission for Winter 2027 (free, deadline Dec 18)',
  'Get a Michigan driver\'s license — needed for the in-state tuition application',
  'Email Dr. Sucic: returning Winter 2027, CMB, AI/Python experience, want to join the lab + SUCCES program',
];

export const KEY_CONTACTS = [
  { name: 'Cydnee Robertson', role: 'CMB Academic Advisor', info: 'cweirauc@umich.edu' },
  { name: 'Dr. Joseph Sucic', role: 'CMB Faculty / Research', info: 'umflint.edu/cit/faculty-staff' },
  { name: 'Suzanne Adam', role: 'Mott→UM-Flint Transfer Coordinator', info: 'suadam@umich.edu · MMB 1002' },
];
