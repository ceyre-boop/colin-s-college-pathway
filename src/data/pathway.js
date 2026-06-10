// Colin's real course-by-course plan toward BS Cellular & Molecular Biology + CS minor.
// Verified against the UM-Flint 2026-2027 catalog + his transcript (June 2026).
export { VERIFIED_CREDITS, GRAD_TARGET } from "./requirements";

// Real credits in hand today (AP 32 + UM-Flint Fall '25 15 + Mott non-duplicate 9). The progress
// bar adds 'completed' courses from the forward plan on top of this.
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
  { sem: 'Done — AP + UM-Flint Fall 2025', school: '32 AP cr + 15 UM-Flint cr · 3.92 Dean\'s List', status: 'completed', courses: [
    { code: 'BIO 113', name: 'Principles of Biology', cr: 4, req: 'AP Biology (4) → transfer', status: 'waived' },
    { code: 'MTH 120', name: 'Pre-Calculus', cr: 4, req: 'AP Precalc (4) → transfer (prereq for MTH 118)', status: 'waived' },
    { code: 'SOC 215', name: 'General Statistics', cr: 3, req: 'AP Stats → satisfies Quantitative Literacy', status: 'waived' },
    { code: 'AP gen-ed', name: 'ENG 111, HIS, POL, PSY (AP)', cr: 18, req: 'AP transfer — gen-ed + social science', status: 'waived' },
    { code: 'BIO 111', name: 'Organismal Biology', cr: 4, req: 'Core bio', status: 'completed' },
    { code: 'CHM 260', name: 'Principles of Chemistry I', cr: 4, req: 'A+', status: 'completed' },
    { code: 'CHM 261', name: 'General Chemistry Lab', cr: 1, req: 'A', status: 'completed' },
    { code: 'PHL 168', name: 'Philosophy of Bioethics', cr: 3, req: 'A · Humanities (upper div)', status: 'completed' },
    { code: 'PSY 316', name: 'Biological Psychology', cr: 3, req: 'A · bio elective', status: 'completed' },
  ] },
  { sem: 'Fall 2026', school: 'Mott — final Mott semester', status: 'current', courses: [
    { code: 'CHEM 160', name: 'General Chemistry II', cr: 3, req: '→ CHM 262 · #1 priority', status: 'planned' },
    { code: 'CHEM 161', name: 'Gen Chem II Lab', cr: 1, req: '→ CHM 263 · paired with 160', status: 'planned' },
    { code: 'ENGL 102', name: 'English Composition II', cr: 3, req: '→ ENG 112 · COMP gen ed', status: 'planned' },
    { code: 'Fine Arts', name: 'ARTC 110 or MUSC 100', cr: 3, req: 'Fine Arts (F) gen ed — closes the last gap', status: 'planned' },
  ] },
  { sem: 'Winter 2027', school: 'UM-Flint · ~67 cr entering · apply residency + Go Blue + email Dr. Sucic', status: 'planned', courses: [
    { code: 'CHM 330', name: 'Organic Chemistry I', cr: 4, req: 'Next in chem sequence', status: 'planned' },
    { code: 'CHM 331', name: 'Organic Chemistry Lab I', cr: 1, req: 'Paired with CHM 330', status: 'planned' },
    { code: 'MTH 118', name: 'Applied Calculus', cr: 4, req: 'Only math requirement', status: 'planned' },
    { code: 'CIT 100', name: 'Technology Foundations', cr: 4, req: 'CMB req — easy A (verify Mott COMI 160 covers it)', status: 'planned' },
    { code: 'H elective', name: 'Humanities (H)', cr: 3, req: 'Finish the H gen ed', status: 'planned' },
  ] },
  { sem: 'Spring/Summer 2027', school: 'UM-Flint (lighter)', status: 'planned', courses: [
    { code: 'CHM 332', name: 'Organic Chemistry II', cr: 4, req: 'Complete orgo sequence', status: 'planned' },
    { code: 'CHM 333', name: 'Organic Chemistry Lab II', cr: 1, req: 'Paired with CHM 332', status: 'planned' },
    { code: 'BTC 120', name: 'Phage Hunters: Discovery', cr: 3, req: 'CMB req — hands-on lab', status: 'planned' },
    { code: 'CSC 175', name: 'Programming I', cr: 4, req: 'CS minor — petition to waive/test out', status: 'planned' },
  ] },
  { sem: 'Fall 2027', school: 'UM-Flint · JOIN DR. SUCIC LAB · apply SUCCES/UROP', status: 'planned', courses: [
    { code: 'BIO 326', name: 'Cell Biology', cr: 4, req: 'Core CMB', status: 'planned' },
    { code: 'BIO 328', name: 'Genetics', cr: 4, req: 'Core CMB — foundation', status: 'planned' },
    { code: 'BIO 301', name: 'Biostatistics', cr: 4, req: 'Bridges bio + data → comp oncology', status: 'planned' },
    { code: 'PHY 143', name: 'College Physics I', cr: 4, req: 'Start physics sequence', status: 'planned' },
  ] },
  { sem: 'Winter 2028', school: 'UM-Flint', status: 'planned', courses: [
    { code: 'BIO 435', name: 'Microbiology', cr: 4, req: 'Core CMB', status: 'planned' },
    { code: 'PHY 145', name: 'College Physics II', cr: 4, req: 'Complete physics', status: 'planned' },
    { code: 'CHM 450', name: 'Biochemistry I', cr: 3, req: 'Chem meets bio', status: 'planned' },
    { code: 'BTC 122', name: 'Phage Hunters: Omics', cr: 3, req: 'CMB — genomics, feeds comp path', status: 'planned' },
  ] },
  { sem: 'Spring/Summer 2028', school: 'UM-Flint · apply NSF REU (Feb)', status: 'planned', courses: [
    { code: 'CHM 452', name: 'Biochemistry II', cr: 3, req: 'Complete biochem', status: 'planned' },
    { code: 'BIO 487', name: 'General Pathology', cr: 4, req: 'Elective — ties to cancer/radiation', status: 'planned' },
    { code: 'CSC 275', name: 'Programming II', cr: 4, req: 'CS minor', status: 'planned' },
  ] },
  { sem: 'Fall 2028', school: 'UM-Flint · apply Goldwater (due Jan 2029)', status: 'planned', courses: [
    { code: 'BIO 467', name: 'Molecular Biology of Prokaryotes', cr: 4, req: 'Advanced mol bio', status: 'planned' },
    { code: 'BIO 525', name: 'Immunology', cr: 4, req: 'Elective — oncology/drug response', status: 'planned' },
    { code: 'CSC 375', name: 'Data Structures', cr: 3, req: 'CS minor', status: 'planned' },
    { code: 'BIO 492', name: 'Independent Study / Research', cr: 3, req: 'Credit for lab work', status: 'planned' },
  ] },
  { sem: 'Winter 2029', school: 'UM-Flint', status: 'planned', courses: [
    { code: 'BIO 468', name: 'Molecular Biology of Eukaryotes', cr: 4, req: 'CMB capstone-level', status: 'planned' },
    { code: 'CSC 379', name: 'Algorithm Analysis', cr: 3, req: 'CS minor — your backtester', status: 'planned' },
    { code: 'CSC 384', name: 'Database Design', cr: 3, req: 'CS minor', status: 'planned' },
    { code: 'BIO 492', name: 'Research', cr: 3, req: 'Final research semester', status: 'planned' },
  ] },
  { sem: 'Fall 2029 / Winter 2030 (buffer)', school: 'UM-Flint · finish + grad Spring 2030', status: 'planned', courses: [
    { code: 'CSC 370', name: 'Info Security (CS elective)', cr: 3, req: 'CS minor completion', status: 'planned' },
    { code: 'BIO elective', name: 'Reach 44 BIO/BTC + any senior seminar', cr: 6, req: 'Final degree requirements', status: 'planned' },
    { code: 'Free elective', name: 'To 120 + 33 upper-division', cr: 3, req: 'Buffer for lighter research-heavy terms', status: 'planned' },
  ] },
];
