// Colin's life timeline — past + future. Events with an `essay` note carry a pre-written
// "why this matters for scholarships" angle; storyBank() (profile.js) compiles those into essays.

export const CAT_META = {
  academic: { color: '#4D9FFF', label: 'Academic' },
  athletic: { color: '#FF1A1A', label: 'Athletic' },
  professional: { color: '#00D97E', label: 'Professional' },
  personal: { color: '#FFB800', label: 'Personal' },
  future: { color: '#555', label: 'Future' },
};

export const INIT_TIMELINE = [
  { id: 1, year: 2006, month: 'Dec', title: 'Born', desc: 'Swartz Creek, MI', cat: 'personal', icon: '⭐', essay: '' },
  { id: 2, year: 2011, month: null, title: 'Started Martial Arts', desc: '6-year journey begins', cat: 'athletic', icon: '🥋', essay: 'Commitment at age 5 — before most kids could tie their shoes' },
  { id: 3, year: 2017, month: null, title: 'Black Belt', desc: 'After 6 years of training, earned black belt at age 11', cat: 'athletic', icon: '🏆', essay: 'Discipline, perseverance, years of showing up when it was hard. Shows character before pressure.' },
  { id: 4, year: 2020, month: null, title: 'Eagle Scout', desc: 'Earned Eagle Scout rank — highest in scouting — at age 13/14', cat: 'personal', icon: '🦅', essay: 'Only ~4% of scouts achieve Eagle. Leadership, community service, long-term commitment under no external pressure.' },
  { id: 5, year: 2022, month: 'Aug', title: 'Started High School', desc: 'Freshman year, Georgia. 4.1 GPA track begins.', cat: 'academic', icon: '📚', essay: '' },
  { id: 6, year: 2023, month: 'May', title: 'AP World History — Score 4', desc: 'First AP exam. College credit earned.', cat: 'academic', icon: '📝', essay: '' },
  { id: 7, year: 2024, month: 'Feb', title: '4th Place State — Wrestling (Junior)', desc: 'Competed at state level as a Junior. Top 4 in Georgia.', cat: 'athletic', icon: '🤼', essay: 'High-pressure performance, years of grinding, competing at state level while maintaining 4.1 GPA.' },
  { id: 8, year: 2024, month: 'Mar', title: 'SAT — 1260 (82nd Percentile)', desc: 'Math 640 (83rd), Reading/Writing 620 (78th)', cat: 'academic', icon: '📊', essay: '' },
  { id: 9, year: 2024, month: 'May', title: 'AP Scholar with Distinction — First Year', desc: 'AP Biology (4), English Lang (3), Precalc (4), US History (4)', cat: 'academic', icon: '🏅', essay: 'AP Scholar with Distinction means scoring 3.5+ avg across 5+ APs with 3+ scores of 5. Two consecutive years shows sustained academic rigor.' },
  { id: 10, year: 2024, month: 'Jun', title: 'SAT — 1250 (81st Percentile)', desc: 'Reading/Writing 660 (87th), Math 590', cat: 'academic', icon: '📊', essay: '' },
  { id: 11, year: 2024, month: 'Summer', title: "Visited Uncle's Radiation Oncology Clinic", desc: 'North Dakota. Toured every department. Outlined tumors on MRI scans. Fell in love with the machines.', cat: 'personal', icon: '🏥', essay: "THE essay moment. Outlined actual tumors on MRI scans that were then used to plan radiation targeting. That direct connection between data and human life is why I'm building computational oncology tools." },
  { id: 12, year: 2025, month: 'Jan', title: 'TABOOST — Founding AI Engineer', desc: 'Built production AI inbox manager. 200+ emails/day. 16 talent inboxes. Replaced a full human team.', cat: 'professional', icon: '💼', essay: '19 years old, production AI infrastructure, full team output as one person.' },
  { id: 13, year: 2025, month: 'May', title: 'AP Scholar with Distinction — Second Consecutive Year', desc: 'AP Psych (5), Stats (3), US Gov (4), English Lit (3). 9 total AP exams.', cat: 'academic', icon: '🏅', essay: 'Back-to-back AP Scholar with Distinction. 9 total AP exams. Demonstrates sustained academic intensity alongside varsity athletics and work.' },
  { id: 14, year: 2025, month: 'May', title: 'High School Graduation', desc: '4.1 GPA. Georgia. Eagle Scout. Black Belt. AP Scholar x2. State wrestler.', cat: 'academic', icon: '🎓', essay: '' },
  { id: 15, year: 2025, month: 'Jun', title: 'Founded Alta Investments', desc: 'Sovereign Trading Intelligence — multi-phase quant architecture. Live forex system. Sharpe 1.25.', cat: 'professional', icon: '📈', essay: 'Built a production quantitative trading system from scratch at 18. 0% bust probability across 100K simulations.' },
  { id: 16, year: 2025, month: 'Aug', title: "UM-Flint Fall '25 — 3.92 GPA, Dean's List", desc: 'First UM-Flint semester: CHM 260 (A+), CHM 261 (A), PHL 168 (A), PSY 316 (A), BIO 111 (A-). 3.92 GPA, Dean’s List.', cat: 'academic', icon: '🔬', essay: 'A 3.92 GPA with a University of Michigan Dean’s List in the first semester back — all A’s and one A-, in chemistry and biology. This is the number that goes on every application.' },
  { id: 17, year: 2026, month: 'Jan', title: 'Transferred to Mott Community College', desc: 'Strategic move — Mott pays me. Completed 15 credits, 3.7 GPA. Knocking out prereqs at community college cost.', cat: 'academic', icon: '🔄', essay: '' },
  { id: 18, year: 2026, month: 'Jun', title: "Built Colin's College Pathway", desc: 'AI-powered scholarship tracker, course planner, and essay generator. Full-stack deployed app.', cat: 'professional', icon: '💻', essay: '' },
  // FUTURE
  { id: 19, year: 2026, month: 'Fall', title: 'Final Semester at Mott', desc: 'COMM 131, FILM 181, MATH 170, PHIL 101 (14 enrolled cr) — current secured schedule. Verify transfer equivalencies; MUS 187 and the alternate PHIL 101 section are waitlist padding. Apply to UM Flint for Fall 2027.', cat: 'future', icon: '📅', essay: '' },
  { id: 20, year: 2027, month: 'Fall', title: 'Return to UM Flint', desc: 'BS Cellular & Molecular Biology with optional computational support work. Back on campus with the required science sequence.', cat: 'future', icon: '🎯', essay: '' },
  { id: 21, year: 2027, month: 'Fall', title: 'Join Research Lab', desc: 'SUCCES Program — Dr. Joseph Sucic. If the slot is real, this is where the research story starts.', cat: 'future', icon: '🧬', essay: '' },
  { id: 22, year: 2028, month: 'Fall', title: 'PIBS Preview Weekend — UM Ann Arbor', desc: 'Funded recruiting visit (UM covers travel/lodging/food) for students targeting Fall 2029/2030 start. Meet DCMB faculty, tour labs, before the formal application.', cat: 'future', icon: '✈️', essay: '' },
  { id: 23, year: 2029, month: 'Jan', title: 'Apply — Barry Goldwater Scholarship', desc: '$7,500/yr. The career-defining STEM scholarship. Faculty nomination from Dr. Sucic + REU lab; needs the research started Fall 2027.', cat: 'future', icon: '🌟', essay: '' },
  { id: 24, year: 2029, month: 'Dec', title: 'Apply — PIBS (UM Program in Biomedical Sciences)', desc: 'Application opens late Aug, due Dec 1. No GRE required. Umbrella app into 14 PhD programs — targeting DCMB Bioinformatics (Track A) or Cancer Biology (Track B). 2+ years in Dr. Sucic\'s lab plus TABOOST/Alta as the documented ML portfolio.', cat: 'future', icon: '📨', essay: '' },
  { id: 25, year: 2030, month: 'Spring', title: 'BS Cellular & Molecular Biology', desc: 'University of Michigan-Flint. Optional CS / research support on top of the degree, not a second hidden degree. (Conservative target; could finish earlier if the plan compresses.)', cat: 'future', icon: '🎓', essay: '' },
  { id: 26, year: 2030, month: 'Fall', title: 'PhD — PIBS / DCMB Computational Oncology (UM Ann Arbor)', desc: 'Fully funded PhD — $43,788/yr stipend + full tuition + health/dental, guaranteed for the program\'s duration. No debt. Or industry at Tempus AI/PathAI/Recursion. Building the AI that replaces the mouse cursor from the MRI room.', cat: 'future', icon: '🚀', essay: '' },
];
