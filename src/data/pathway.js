// Colin's real course-by-course plan toward BS Cellular & Molecular Biology + CS minor.
// Source: UM-Flint 2026-2027 official catalog + real transcript + Mott transfer guide (June 2026).
// UM-Flint return moved to Fall 2027 (Winter 2027 is a Mott residency semester); grad Spring 2030.
export { VERIFIED_CREDITS, GRAD_TARGET } from "./requirements";

// Real credits in hand today (AP 32 + UM-Flint Fall '25 15 + Mott non-duplicate 9 = 56). The progress
// bar adds 'completed' courses from the forward plan on top of this. The "Done" blocks below are marked
// status:"completed" so App.jsx excludes them from the forward tally (they're already inside ALREADY_HAVE).
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
  { sem: 'Fall 2026', school: 'Mott', status: 'current', credits: 13, note: 'Final productive Mott semester — closes all 3 gen ed gaps + CMB calculus', courses: [
    { code: 'ENGL 102', name: 'English Composition II', cr: 3, req: '→ ENG 112 Critical Writing & Reading | COMP gen ed ✓', status: 'enrolled' },
    { code: 'MATH 165', name: 'Applied Calculus', cr: 4, req: '→ MTH 118 Applied Calculus | CMB math requirement ✓ | saves ~$1,840 vs UM Flint', status: 'enrolled' },
    { code: 'FILM 181', name: 'Introduction to Film', cr: 3, req: '→ COM 272 Film Genre | Fine Arts F gen ed ✓', status: 'enrolled' },
    { code: 'PHIL 101', name: 'Introduction to Philosophy', cr: 3, req: '→ PHL 101 Intro to Philosophy | Humanities H gen ed ✓ (closes last H gap)', status: 'enrolled' },
  ] },

  // ─── WINTER 2027 AT MOTT (RESIDENCY SEMESTER) ───────────────────────────
  { sem: 'Winter 2027', school: 'Mott', status: 'planned', credits: 8, note: 'Light semester — establishing 12+ months Michigan residency for in-state tuition. Submit residency application Feb 2027. Apply UM Flint readmission for Fall 2027 (deadline Aug 10).', courses: [
    { code: 'COMM 131', name: 'Fund. of Public Speaking', cr: 3, req: '→ COM 210 Intro to Public Speaking | COMP credit + actually useful skill', status: 'planned' },
    { code: 'TECH 121A', name: 'STEM App — Guitar', cr: 2, req: '→ MUS 117 Guitar Class | no gen ed value, just fun padding', status: 'planned' },
    { code: 'Elective TBD', name: 'Any open elective', cr: 3, req: 'Pad to 8 cr half-time for partial Pell | pick something interesting', status: 'planned' },
  ] },

  // ─── UM FLINT: RETURN ───────────────────────────────────────────────────
  { sem: 'Fall 2027', school: 'UM-Flint', status: 'planned', credits: 14, note: 'RETURN TO UM FLINT — in-state tuition secured. Email Dr. Sucic immediately. Apply SUCCES program + UROP for paid research.', courses: [
    { code: 'CHM 262', name: 'Principles of Chemistry II', cr: 4, req: 'CMB required — MUST take before CHM 330 Organic Chem', status: 'planned' },
    { code: 'CHM 263', name: 'Introductory Quantitative Analysis Lab', cr: 1, req: 'CMB required — paired with CHM 262', status: 'planned' },
    { code: 'CIT 100', name: 'Technology Foundations', cr: 4, req: 'CMB required — easy A given your background', status: 'planned' },
    { code: 'CSC 127', name: 'Using a Unix Computer System', cr: 1, req: 'CS minor — you can do this in your sleep', status: 'planned' },
    { code: 'BIO 326', name: 'Cell Biology', cr: 4, req: 'CMB core — where molecular biology actually begins', status: 'planned' },
  ] },
  { sem: 'Winter 2028', school: 'UM-Flint', status: 'planned', credits: 17, note: 'Hardest chemistry semester. CHM 262 prereq now done.', courses: [
    { code: 'CHM 330', name: 'Organic Chemistry I', cr: 4, req: 'CMB required — hardest course in the sequence', status: 'planned' },
    { code: 'CHM 331', name: 'Organic Chemistry Laboratory I', cr: 1, req: 'CMB required — always paired with CHM 330', status: 'planned' },
    { code: 'BIO 301', name: 'Biostatistics', cr: 4, req: 'CMB required — bridges biology and data science | MTH 118 prereq now done ✓', status: 'planned' },
    { code: 'BIO 328', name: 'Genetics', cr: 4, req: 'CMB core — foundation of everything in molecular biology', status: 'planned' },
    { code: 'CSC 175', name: 'Problem Solving & Programming I', cr: 4, req: 'CS minor — petition to waive based on professional dev experience', status: 'planned' },
  ] },
  { sem: 'Spring/Summer 2028', school: 'UM-Flint', status: 'planned', credits: 13, note: 'Apply NSF REU (due Feb 2028) — $5,500 stipend + housing for summer research at another university.', courses: [
    { code: 'CHM 332', name: 'Organic Chemistry II', cr: 4, req: 'CMB required — complete the organic sequence', status: 'planned' },
    { code: 'CHM 333', name: 'Organic Chemistry Laboratory II', cr: 1, req: 'CMB required — paired with CHM 332', status: 'planned' },
    { code: 'PHY 143', name: 'College Physics I', cr: 4, req: 'CMB required — start physics sequence (algebra-based)', status: 'planned' },
    { code: 'CSC 275', name: 'Problem Solving & Programming II', cr: 4, req: 'CS minor — needs CSC 175 first', status: 'planned' },
  ] },
  { sem: 'Fall 2028', school: 'UM-Flint', status: 'planned', credits: 17, note: 'APPLY BARRY GOLDWATER SCHOLARSHIP — due January 2029. Need faculty nomination from Dr. Sucic. THE scholarship for STEM undergrads going to grad school ($7,500/yr).', courses: [
    { code: 'BIO 435', name: 'Microbiology', cr: 4, req: 'CMB core required', status: 'planned' },
    { code: 'PHY 145', name: 'College Physics II', cr: 4, req: 'CMB required — complete physics sequence', status: 'planned' },
    { code: 'CHM 450', name: 'Biochemistry I', cr: 3, req: 'CMB required — where chemistry and biology finally merge', status: 'planned' },
    { code: 'CSC 335', name: 'Computer Networks I', cr: 3, req: 'CS minor elective (choose 4 from: CSC 310, 335, CIS 363, CSC 382, CSC 384)', status: 'planned' },
    { code: 'BIO 492', name: 'Independent Study / Research', cr: 3, req: 'Credit for Dr. Sucic lab work — get this on your transcript', status: 'planned' },
  ] },
  { sem: 'Winter 2029', school: 'UM-Flint', status: 'planned', credits: 16, note: 'Advanced molecular biology. Start PhD/industry applications.', courses: [
    { code: 'BIO 467', name: 'Molecular Biology of Prokaryotes', cr: 4, req: 'CMB core — advanced molecular biology', status: 'planned' },
    { code: 'CHM 452', name: 'Biochemistry II', cr: 3, req: 'CMB required — complete biochemistry sequence', status: 'planned' },
    { code: 'BTC 120', name: 'Phage Hunters: Phage Discovery', cr: 3, req: 'CMB required — hands-on genomics lab', status: 'planned' },
    { code: 'CSC 382', name: 'Software Engineering', cr: 3, req: 'CS minor elective — production code fundamentals', status: 'planned' },
    { code: 'MTH 220', name: 'Elementary Linear Algebra', cr: 3, req: 'NOT in CS minor but REQUIRED for ML/bioinformatics/comp oncology work. Add as elective. Essential for grad school.', status: 'planned' },
  ] },
  { sem: 'Spring/Summer 2029', school: 'UM-Flint', status: 'planned', credits: 12, note: 'Lighter semester — research focus, PhD application prep.', courses: [
    { code: 'BTC 122', name: 'Phage Hunters: Introduction to Omics', cr: 3, req: 'CMB required — genomics and computational biology', status: 'planned' },
    { code: 'BIO 492', name: 'Independent Study / Research', cr: 3, req: 'Second research semester — aim for co-authorship', status: 'planned' },
    { code: 'CSC 384', name: 'Database Design', cr: 3, req: 'CS minor elective — Firebase/Supabase background = easy A', status: 'planned' },
    { code: 'CIS 363', name: 'Advanced Web Application Programming', cr: 3, req: 'CS minor elective — 4th and final elective to complete minor', status: 'planned' },
  ] },
  { sem: 'Fall 2029', school: 'UM-Flint', status: 'planned', credits: 15, note: 'Final required courses. Apply PhD programs (Bioinformatics, Computational Biology, Biomedical Engineering) — UM Ann Arbor PIBS is the target.', courses: [
    { code: 'BIO 468', name: 'Molecular Biology of Eukaryotes', cr: 4, req: 'CMB capstone-level — final core course', status: 'planned' },
    { code: 'BIO 487', name: 'General Pathology', cr: 4, req: 'Bio elective — ties directly to cancer/radiation oncology', status: 'planned' },
    { code: 'BIO 525', name: 'Immunology', cr: 4, req: 'Bio elective — oncology + drug response research', status: 'planned' },
    { code: 'Free elective', name: 'To reach 120 credits / 33 upper div', cr: 3, req: 'Any 300+ level course if needed for credit total', status: 'planned' },
  ] },
  { sem: 'Winter 2030 (buffer)', school: 'UM-Flint', status: 'planned', credits: 0, note: 'Buffer semester only if any requirements remain. Graduation: Spring 2030. Degree: BS Cellular and Molecular Biology + CS Minor, University of Michigan.', courses: [] },
];
