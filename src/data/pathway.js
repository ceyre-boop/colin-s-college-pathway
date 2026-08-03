// Colin's course-by-course plan toward BS Cellular & Molecular Biology.
// Source: UM-Flint 2026-2027 official catalog + real transcript + Mott transfer guide (June 2026).
// This version separates the strict degree audit from optional CS / research support.
// UM-Flint return moved to Fall 2027 (Winter 2027 is a Mott residency semester); grad Spring 2030.
export { VERIFIED_CREDITS, GRAD_TARGET } from "./requirements";

// Real credits in hand today (AP 32 + UM-Flint Fall '25 15 + Mott non-duplicate 9 = 56). The progress
// bar adds counted courses from the forward plan on top of this. Courses flagged countTowardDegree:false
// are support work only and do not inflate the strict degree audit.
export const ALREADY_HAVE = 56;
export const DEGREE_TOTAL = 120;
export const UPPER_DIVISION_NEEDED = 33;
export const UPPER_DIVISION_HAVE = 3; // PHL 168

export const COURSE_STATUS = {
  completed: { label: 'Completed', color: '#00D97E' },
  enrolled: { label: 'Enrolled', color: '#4D9FFF' },
  planned: { label: 'Planned', color: '#888' },
  waived: { label: 'Waived', color: '#FFB800' },
};

export const PATHWAY_DATA = [
  // ─── COMPLETED ──────────────────────────────────────────────────────────
  { sem: 'Done — AP Credits', school: 'AP / College Board', status: 'completed', credits: 32, courses: [
    { code: 'BIO 113', name: 'Principles of Biology', cr: 4, req: 'CMB core bio requirement ✓', status: 'completed', grade: 'AP (4)' },
    { code: 'ENG 111', name: 'College Rhetoric', cr: 3, req: 'Writing gen ed ✓', status: 'completed', grade: 'AP (3)' },
    { code: 'HIS 112', name: 'World History to 1400', cr: 3, req: 'Social Science gen ed ✓', status: 'completed', grade: 'AP (4)' },
    { code: 'HIS 113', name: 'World History: 1400 to 1900', cr: 3, req: 'Social Science gen ed ✓', status: 'completed', grade: 'AP (4)' },
    { code: 'HIS 120', name: 'United States to 1865', cr: 3, req: 'Social Science gen ed ✓', status: 'completed', grade: 'AP (4)' },
    { code: 'HIS 121', name: 'United States since 1865', cr: 3, req: 'Social Science gen ed ✓', status: 'completed', grade: 'AP (4)' },
    { code: 'MTH 120', name: 'Pre-Calculus Mathematics', cr: 4, req: 'Prereq for MTH 118 — applied calculus coming at Mott', status: 'completed', grade: 'AP (4)' },
    { code: 'POL 120', name: 'U.S. Nat Gov\'t & Politics', cr: 3, req: 'Social Science gen ed ✓', status: 'completed', grade: 'AP (4)' },
    { code: 'PSY 100', name: 'Principles of Psychology', cr: 3, req: 'Social Science gen ed ✓', status: 'completed', grade: 'AP (5)' },
    { code: 'SOC 215', name: 'General Statistics', cr: 3, req: 'Quantitative Literacy FQ gen ed ✓', status: 'completed', grade: 'AP (3)' },
  ] },
  { sem: 'Fall 2025', school: 'UM-Flint', status: 'completed', credits: 15, note: '3.92 GPA — Dean\'s List', courses: [
    { code: 'BIO 111', name: 'Organismal Biology', cr: 4, req: 'CMB core bio requirement ✓', status: 'completed', grade: 'A-' },
    { code: 'CHM 260', name: 'Principles of Chemistry I', cr: 4, req: 'CMB chemistry sequence start ✓', status: 'completed', grade: 'A+' },
    { code: 'CHM 261', name: 'General Chemistry Laboratory', cr: 1, req: 'CMB chemistry lab ✓', status: 'completed', grade: 'A' },
    { code: 'PHL 168', name: 'Philosophy of Bioethics', cr: 3, req: 'Humanities H gen ed ✓ (3 of 6 cr) · upper division', status: 'completed', grade: 'A' },
    { code: 'PSY 316', name: 'Biological Psychology', cr: 3, req: 'Bio elective toward 44 BIO/BTC credits', status: 'completed', grade: 'A' },
  ] },
  { sem: 'Winter 2026', school: 'Mott', status: 'completed', credits: 15, note: '3.70 GPA', courses: [
    { code: 'SOCY 191', name: 'Introduction to Sociology', cr: 3, req: '→ SOC 100 Social Science gen ed ✓', status: 'completed', grade: '4.0' },
    { code: 'MATH 145', name: 'Pre-Calculus', cr: 5, req: '→ MTH 120 (duplicate with AP — confirms prereq for MTH 118)', status: 'completed', grade: '3.5' },
    { code: 'MATH 115', name: 'Foundations of Mathematics II', cr: 4, req: '→ MTH 109 (lower elective credit)', status: 'completed', grade: '3.5' },
    { code: 'COMI 160', name: 'Intro to Computer Info Systems', cr: 3, req: '→ CIS 200 (NOT CIT 100 — CIT 100 must be taken at UM Flint)', status: 'completed', grade: '4.0' },
  ] },

  // ─── CURRENT SEMESTER ───────────────────────────────────────────────────
  { sem: 'Fall 2026', school: 'Mott', status: 'current', credits: 14, note: 'Current secured schedule: COMM 131, FILM 181, MATH 170, PHIL 101. MUS 187 and the alternate PHIL 101 section are waitlist padding, not degree drivers. Verify COMM 131 and MATH 170 transfer cleanly; if not, the fallback is ENGL 102 later.', courses: [
    { code: 'COMM 131', name: 'Fund. of Public Speaking', cr: 3, req: 'Likely covers the communication component; verify transfer before count it as closed', status: 'enrolled' },
    { code: 'FILM 181', name: 'Introduction to Film', cr: 3, req: '→ COM 272 Film Genre | Fine Arts F gen ed ✓', status: 'enrolled' },
    { code: 'MATH 170', name: 'Analytic Geometry & Calculus I', cr: 5, req: 'Likely stronger than MATH 165 for the calculus slot; verify it maps to MTH 118 or equivalent', status: 'enrolled' },
    { code: 'PHIL 101', name: 'Introduction to Philosophy', cr: 3, req: '→ PHL 101 Intro to Philosophy | Humanities H gen ed ✓ (closes last H gap)', status: 'enrolled' },
  ] },

  // ─── WINTER 2027 AT MOTT (RESIDENCY SEMESTER) ───────────────────────────
  { sem: 'Winter 2027', school: 'Mott', status: 'planned', credits: 8, note: 'Residency semester. COMM 131 and the open elective are the counted credits; TECH 121A is optional padding if you need the extra load for aid/residency.', courses: [
    { code: 'COMM 131', name: 'Fund. of Public Speaking', cr: 3, req: '→ COM 210 Intro to Public Speaking | helpful communication skill', status: 'planned' },
    { code: 'TECH 121A', name: 'STEM App — Guitar', cr: 2, req: '→ MUS 117 Guitar Class | optional enrichment, not part of the strict audit', status: 'planned', countTowardDegree: false },
    { code: 'Elective TBD', name: 'Any open elective', cr: 3, req: 'Keep this only if you need half-time status or want a transferable elective', status: 'planned' },
  ] },

  // ─── UM FLINT: RETURN ───────────────────────────────────────────────────
  { sem: 'Fall 2027', school: 'UM-Flint', status: 'planned', credits: 13, note: 'Core science restart. Keep the load as lean as possible while protecting GPA.', courses: [
    { code: 'CHM 262', name: 'Principles of Chemistry II', cr: 4, req: 'CMB required — must come before Organic Chem', status: 'planned' },
    { code: 'CHM 263', name: 'Introductory Quantitative Analysis Lab', cr: 1, req: 'CMB required — paired with CHM 262', status: 'planned' },
    { code: 'BIO 326', name: 'Cell Biology', cr: 4, req: 'CMB core — actual molecular biology starts here', status: 'planned' },
    { code: 'CIT 100', name: 'Technology Foundations', cr: 4, req: 'Optional support — useful, but not required for the strict degree audit', status: 'planned', countTowardDegree: false },
  ] },
  { sem: 'Winter 2028', school: 'UM-Flint', status: 'planned', credits: 13, note: 'Hard semester. Keep the course list clean and protect the GPA.', courses: [
    { code: 'CHM 330', name: 'Organic Chemistry I', cr: 4, req: 'CMB required — the first real filter', status: 'planned' },
    { code: 'CHM 331', name: 'Organic Chemistry Laboratory I', cr: 1, req: 'CMB required — paired with CHM 330', status: 'planned' },
    { code: 'BIO 301', name: 'Biostatistics', cr: 4, req: 'CMB required — bridge biology and data', status: 'planned' },
    { code: 'BIO 328', name: 'Genetics', cr: 4, req: 'CMB core — foundational for oncology work', status: 'planned' },
  ] },
  { sem: 'Spring/Summer 2028', school: 'UM-Flint', status: 'planned', credits: 13, note: 'Summer is better used for momentum than for padding. Keep only what moves the degree.', courses: [
    { code: 'CHM 332', name: 'Organic Chemistry II', cr: 4, req: 'CMB required — complete the organic sequence', status: 'planned' },
    { code: 'CHM 333', name: 'Organic Chemistry Laboratory II', cr: 1, req: 'CMB required — paired with CHM 332', status: 'planned' },
    { code: 'PHY 143', name: 'College Physics I', cr: 4, req: 'CMB required — start physics', status: 'planned' },
    { code: 'MTH 220', name: 'Elementary Linear Algebra', cr: 3, req: 'Optional support — useful for computational oncology, not required for the degree', status: 'planned', countTowardDegree: false },
  ] },
  { sem: 'Fall 2028', school: 'UM-Flint', status: 'planned', credits: 11, note: 'This is the semester to add research if the lab slot exists. Keep the academic load manageable.', courses: [
    { code: 'BIO 435', name: 'Microbiology', cr: 4, req: 'CMB core required', status: 'planned' },
    { code: 'PHY 145', name: 'College Physics II', cr: 4, req: 'CMB required — finish physics', status: 'planned' },
    { code: 'CHM 450', name: 'Biochemistry I', cr: 3, req: 'CMB required — the chemistry/biology merge point', status: 'planned' },
    { code: 'BIO 492', name: 'Independent Study / Research', cr: 3, req: 'Optional support — only take if the lab work is real and transcripted', status: 'planned', countTowardDegree: false },
  ] },
  { sem: 'Winter 2029', school: 'UM-Flint', status: 'planned', credits: 10, note: 'Advanced molecular biology. This is where the story starts to look like a research application.', courses: [
    { code: 'BIO 467', name: 'Molecular Biology of Prokaryotes', cr: 4, req: 'CMB core — advanced molecular biology', status: 'planned' },
    { code: 'CHM 452', name: 'Biochemistry II', cr: 3, req: 'CMB required — finish biochemistry', status: 'planned' },
    { code: 'BTC 120', name: 'Phage Hunters: Phage Discovery', cr: 3, req: 'CMB required — genomics / wet lab experience', status: 'planned' },
  ] },
  { sem: 'Spring/Summer 2029', school: 'UM-Flint', status: 'planned', credits: 11, note: 'Use the summer for the most useful thing you can get: either research or the last required bio work.', courses: [
    { code: 'BTC 122', name: 'Phage Hunters: Introduction to Omics', cr: 3, req: 'CMB required — genomics and computational biology', status: 'planned' },
    { code: 'BIO 468', name: 'Molecular Biology of Eukaryotes', cr: 4, req: 'CMB capstone-level — final core biology', status: 'planned' },
    { code: 'BIO 487', name: 'General Pathology', cr: 4, req: 'Bio elective — if pathology fits the oncology goal better than immunology', status: 'planned' },
  ] },
  { sem: 'Fall 2029', school: 'UM-Flint', status: 'planned', credits: 0, note: 'Buffer only. If the advisor says a requirement is still open, use this term to close it. Otherwise, stop adding credits just to add credits.', courses: [
  ] },
  { sem: 'Winter 2030 (buffer)', school: 'UM-Flint', status: 'planned', credits: 0, note: 'Buffer semester only if any requirements remain. Graduation: Spring 2030. Degree: BS Cellular and Molecular Biology, University of Michigan-Flint.', courses: [] },
];
