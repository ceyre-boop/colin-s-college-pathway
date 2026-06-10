// EDITABLE DEFAULTS. Costs/aid are editable in-app and saved to localStorage. The scholarship
// list is Colin's real, targeted set (with contacts) — verify amounts/deadlines at the source.

export const DEFAULT_COSTS = [
  { id: 'tuition', label: 'Tuition & Fees', annualAmount: 13000, note: 'UM-Flint in-state estimate (out-of-state ~$25k)' },
  { id: 'housing', label: 'Housing & Utilities', annualAmount: 9000, note: 'On/off-campus room' },
  { id: 'food', label: 'Food & Dining', annualAmount: 4500, note: 'Meal plan or groceries' },
  { id: 'books', label: 'Books & Supplies', annualAmount: 1200, note: 'Textbooks, lab fees, software' },
  { id: 'transport', label: 'Transportation', annualAmount: 1500, note: 'Gas, parking, occasional travel home' },
  { id: 'personal', label: 'Personal & Misc', annualAmount: 2000, note: 'Clothing, health, phone, entertainment' },
];

export const PLAN_YEARS = 5;

export const STATUS_OPTIONS = [
  { value: 'apply', label: '🔴 Apply Now', color: '#FF1A1A', sort: 0 },
  { value: 'research', label: '🔍 Research', color: '#FFB800', sort: 1 },
  { value: 'applied', label: '📬 Applied', color: '#4D9FFF', sort: 2 },
  { value: 'pending', label: '⏳ Pending', color: '#FFB800', sort: 3 },
  { value: 'won', label: '🏆 Won', color: '#00D97E', sort: 4 },
  { value: 'rejected', label: '❌ Rejected', color: '#888', sort: 5 },
  { value: 'future', label: '📅 Future', color: '#555', sort: 6 },
];

export const PRIORITY_OPTIONS = [
  { value: 'critical', label: '🔥 Critical' },
  { value: 'high', label: '🎯 High' },
  { value: 'medium', label: '⚡ Medium' },
  { value: 'low', label: '🎲 Low' },
];

export const AID_TYPES = [
  { id: 'pell', label: 'Pell Grant', note: 'Federal need-based grant — SAI of -1500 means MAX Pell (~$7,395/yr). Does NOT repay.' },
  { id: 'seog', label: 'SEOG Grant', note: 'Supplemental Educational Opportunity Grant — need-based, does NOT repay' },
  { id: 'sub_loan', label: 'Subsidized Loan', note: 'Gov pays interest while in school — repayment required' },
  { id: 'unsub_loan', label: 'Unsubsidized Loan', note: 'Interest accrues immediately — repayment required' },
  { id: 'work_study', label: 'Work-Study', note: 'Request placement in a RESEARCH LAB — $12-15/hr doing CV-building work' },
  { id: 'state', label: 'State Grant', note: 'Michigan Competitive Scholarship, MI Tuition Grant — pulled from FAFSA' },
  { id: 'college', label: 'Institutional Aid', note: 'Go Blue Guarantee, UM-Flint Transfer Scholarship — direct from the school' },
];

// Colin's real, targeted scholarships. priority: critical/high/medium drives essay model choice.
export const DEFAULT_SCHOLARSHIPS = [
  { id: 'sc_pell', name: 'Pell Grant Renewal', org: 'Federal', amount: 7395, deadline: 'FAFSA Dec 2026', status: 'apply', priority: 'critical', url: 'https://studentaid.gov', notes: 'SAI -1500 = max eligibility. File FAFSA at studentaid.gov NOW.' },
  { id: 'sc_umflint_transfer', name: 'UM Flint Transfer Scholarship', org: 'UM Flint', amount: 5000, deadline: 'Auto on admission', status: 'apply', priority: 'critical', url: 'https://www.umflint.edu/financialaid/', notes: '$2,500/yr × 2. Automatic at 3.0+. You have 3.92 (UM-Flint, Dean\'s List).' },
  { id: 'sc_go_blue', name: 'Go Blue Guarantee', org: 'UM Flint', amount: 12280, deadline: 'With readmission app', status: 'apply', priority: 'critical', url: 'https://goblue.umich.edu', notes: 'Free in-state tuition if family income <$125K.' },
  { id: 'sc_mi_competitive', name: 'Michigan Competitive Scholarship', org: 'Michigan OSFA', amount: 1000, deadline: 'FAFSA by Feb 2027', status: 'apply', priority: 'high', url: 'https://www.michigan.gov/mistudentaid', notes: 'Auto-considered when FAFSA filed.' },
  { id: 'sc_mckinnon', name: 'Zelpha E. McKinnon Science Scholarship', org: 'UM Flint Biology', amount: 2000, deadline: 'Spring 2027', status: 'research', priority: 'high', url: 'https://www.umflint.edu/financialaid/', notes: 'CMB-specific. Email Cydnee Robertson: cweirauc@umich.edu' },
  { id: 'sc_dorland', name: 'John Terrill & Lora Dorland Bio Sciences Fund', org: 'UM Flint Biology', amount: 1500, deadline: 'Spring 2027', status: 'research', priority: 'high', url: 'https://www.umflint.edu/financialaid/', notes: 'Biological sciences major. Ask Cydnee Robertson.' },
  { id: 'sc_goldwater', name: 'Barry Goldwater Scholarship', org: 'Goldwater Foundation', amount: 7500, deadline: 'Jan 2028', status: 'future', priority: 'critical', url: 'https://goldwater.scholarsapply.org', notes: 'THE scholarship for STEM undergrads. Need research exp + faculty nomination. Get in lab Fall 2027 FOR THIS.' },
  { id: 'sc_nsf_reu', name: 'NSF REU — Computational Biology', org: 'NSF', amount: 5500, deadline: 'Feb 2028', status: 'future', priority: 'high', url: 'https://www.nsf.gov/crssprgm/reu/', notes: '$5K-6K stipend + housing. Summer research at top university. Apply junior year.' },
  { id: 'sc_gen_google', name: 'Google Generation Scholarship', org: 'Google', amount: 10000, deadline: 'Dec 2027', status: 'future', priority: 'high', url: 'https://buildyourfuture.withgoogle.com/scholarships', notes: 'CS+STEM. Your AI engineering background is exactly what they want.' },
  { id: 'sc_microsoft', name: 'Microsoft Scholarship', org: 'Microsoft', amount: 5000, deadline: 'Feb 2027', status: 'apply', priority: 'medium', url: 'https://www.microsoft.com/en-us/diversity/programs/microsoft-scholarship-program', notes: 'STEM + CS. Developer background helps.' },
  { id: 'sc_ai4all', name: 'AI4ALL Ignite Accelerator', org: 'AI4ALL', amount: 2500, deadline: 'Rolling', status: 'apply', priority: 'medium', url: 'https://ai-4-all.org/ignite/', notes: 'AI builder background. TABOOST + Alta are your application.' },
  { id: 'sc_bold', name: 'Bold.org STEM Essay Batch', org: 'Bold.org', amount: 500, deadline: 'Monthly', status: 'apply', priority: 'medium', url: 'https://bold.org/scholarships/', notes: '50+ scholarships $250-$2,500. Apply in one Claude session.' },
  { id: 'sc_niche', name: 'Niche $10K No Essay', org: 'Niche', amount: 10000, deadline: 'Monthly', status: 'apply', priority: 'medium', url: 'https://www.niche.com/colleges/scholarship/no-essay-scholarship/', notes: 'No essay. Pure volume play. Apply every month.' },
  { id: 'sc_afcea', name: 'AFCEA STEM Scholarship', org: 'AFCEA', amount: 3000, deadline: 'May 2027', status: 'apply', priority: 'medium', url: 'https://www.afcea.org/scholarships', notes: 'STEM undergrad. SAI -1500 qualifies.' },
  { id: 'sc_flint_cf', name: 'Flint Community Foundation', org: 'Community Foundation of Greater Flint', amount: 2000, deadline: 'Mar 2027', status: 'research', priority: 'medium', url: 'https://www.cfgf.org/scholarships/', notes: 'Local scholarships massively undersubscribed. Genesee County student qualifies.' },
  { id: 'sc_succes', name: 'SUCCES Program Stipend', org: 'UM Flint', amount: 3000, deadline: 'Contact Dr. Sucic Fall 2027', status: 'future', priority: 'critical', url: 'https://www.umflint.edu/biology/', notes: 'PAID research on cancer biology. Email Dr. Joseph Sucic the day you return.' },
  { id: 'sc_work_study', name: 'Federal Work-Study (Research Lab)', org: 'Federal', amount: 4000, deadline: 'With FAFSA', status: 'apply', priority: 'high', url: 'https://studentaid.gov', notes: 'Request work-study placement IN A RESEARCH LAB. $12-15/hr to do CV-building work.' },
  { id: 'sc_btt_ai', name: 'Break Through Tech AI Fellowship', org: 'Cornell Tech', amount: 3000, deadline: 'Rolling', status: 'apply', priority: 'medium', url: 'https://breakthroughtech.org/', notes: 'CS/AI students. Stipend + mentorship.' },
];
