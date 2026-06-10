// Colin's course-by-course degree plan toward BS Cellular & Molecular Biology + CS minor.
// He already holds ~50 credits (AP + prior UM-Flint work) before any of these.
export const ALREADY_HAVE = 50;
export const DEGREE_TOTAL = 120;

export const COURSE_STATUS = {
  completed: { label: 'Completed', color: '#00D97E' },
  enrolled: { label: 'Enrolled', color: '#4D9FFF' },
  planned: { label: 'Planned', color: '#888' },
  waived: { label: 'Waived', color: '#FFB800' },
};

export const PATHWAY_DATA = [
  { sem: 'Fall 2026', school: 'Mott', status: 'current', courses: [
    { code: 'CHEM 160', name: 'General Chemistry II', cr: 3, req: 'CHM 262 → Organic Chem prereq', status: 'planned' },
    { code: 'CHEM 161', name: 'General Chemistry II Lab', cr: 1, req: 'CHM 263 → pairs with CHEM 160', status: 'planned' },
    { code: 'ENGL 101', name: 'English Composition I', cr: 3, req: 'ENG 111 → writing gen ed', status: 'planned' },
    { code: 'HUM elective', name: 'Humanities Elective (Art/Lit/Language)', cr: 3, req: 'Humanities gen ed (2nd discipline)', status: 'planned' },
  ] },
  { sem: 'Winter 2027', school: 'UM Flint', status: 'planned', courses: [
    { code: 'CHM 330', name: 'Organic Chemistry I', cr: 4, req: 'Core CMB — hardest chem course', status: 'planned' },
    { code: 'CHM 331', name: 'Organic Chemistry Lab I', cr: 1, req: 'Always paired with CHM 330', status: 'planned' },
    { code: 'BIO 326', name: 'Cell Biology', cr: 4, req: 'Core CMB — where molecular bio begins', status: 'planned' },
    { code: 'CIT 100', name: 'Technology Foundations', cr: 4, req: 'CMB requirement — easy A for you', status: 'planned' },
    { code: 'ENG 112', name: 'College Writing', cr: 3, req: 'Required second writing course', status: 'planned' },
  ] },
  { sem: 'Spring/Summer 2027', school: 'UM Flint', status: 'planned', courses: [
    { code: 'CHM 332', name: 'Organic Chemistry II', cr: 4, req: 'Complete the orgo sequence', status: 'planned' },
    { code: 'CHM 333', name: 'Organic Chemistry Lab II', cr: 1, req: 'Paired with CHM 332', status: 'planned' },
    { code: 'CSC 175', name: 'Problem Solving & Programming I', cr: 4, req: 'CS minor — petition to waive/test out', status: 'planned' },
  ] },
  { sem: 'Fall 2027', school: 'UM Flint', status: 'planned', courses: [
    { code: 'BIO 328', name: 'Genetics', cr: 4, req: 'Core CMB — foundation of everything', status: 'planned' },
    { code: 'BIO 301', name: 'Biostatistics', cr: 4, req: 'Bridges bio + data → comp oncology', status: 'planned' },
    { code: 'PHY 243', name: 'Principles of Physics I', cr: 4, req: 'CMB requirement (calc-based)', status: 'planned' },
    { code: 'CSC 275', name: 'Problem Solving & Programming II', cr: 4, req: 'CS minor', status: 'planned' },
  ] },
  { sem: 'Winter 2028', school: 'UM Flint', status: 'planned', courses: [
    { code: 'BIO 435', name: 'Microbiology', cr: 4, req: 'Core CMB requirement', status: 'planned' },
    { code: 'PHY 245', name: 'Principles of Physics II', cr: 4, req: 'CMB requirement', status: 'planned' },
    { code: 'CSC 375', name: 'Data Structures', cr: 3, req: 'CS minor', status: 'planned' },
    { code: 'BTC 120', name: 'Phage Hunters: Phage Discovery', cr: 3, req: 'CMB requirement — hands-on lab', status: 'planned' },
  ] },
  { sem: 'Spring/Summer 2028', school: 'UM Flint', status: 'planned', courses: [
    { code: 'CHM 450', name: 'Biochemistry I', cr: 3, req: 'CMB — where chem meets bio', status: 'planned' },
    { code: 'BTC 122', name: 'Phage Hunters: Intro to Omics', cr: 3, req: 'CMB — genomics', status: 'planned' },
    { code: 'CSC 379', name: 'Algorithm Analysis', cr: 3, req: 'CS minor — your quant backtester is this', status: 'planned' },
  ] },
  { sem: 'Fall 2028', school: 'UM Flint', status: 'planned', courses: [
    { code: 'BIO 467', name: 'Molecular Biology of Prokaryotes', cr: 4, req: 'Core CMB — advanced mol bio', status: 'planned' },
    { code: 'CHM 452', name: 'Biochemistry II', cr: 3, req: 'CMB requirement', status: 'planned' },
    { code: 'CSC 384', name: 'Database Design', cr: 3, req: 'CS minor — Firebase background = easy A', status: 'planned' },
    { code: 'BIO 487', name: 'General Pathology', cr: 4, req: 'Elective — ties to cancer/radiation work', status: 'planned' },
  ] },
  { sem: 'Winter 2029', school: 'UM Flint', status: 'planned', courses: [
    { code: 'BIO 468', name: 'Molecular Biology of Eukaryotes', cr: 4, req: 'CMB capstone-level course', status: 'planned' },
    { code: 'BIO 525', name: 'Immunology', cr: 4, req: 'Elective — feeds comp oncology track', status: 'planned' },
    { code: 'CSC 370', name: 'Intro to Information Security', cr: 3, req: 'CS minor elective', status: 'planned' },
  ] },
];
