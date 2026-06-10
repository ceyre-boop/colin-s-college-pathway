// EDITABLE DEFAULTS. Dollar figures are estimates from the funding strategy — replace with
// UM-Flint's official tuition/fees and your real costs. All of this is editable in-app and
// saved to your browser's localStorage.

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
  { value: 'found',    label: '🔍 Found',    color: '#6b7280' },
  { value: 'applied',  label: '📬 Applied',  color: '#f59e0b' },
  { value: 'won',      label: '🏆 Won',      color: '#10b981' },
  { value: 'rejected', label: '❌ Rejected', color: '#ef4444' },
];

export const PRIORITY_OPTIONS = [
  { value: 'easy',   label: '⚡ Easy Win' },
  { value: 'medium', label: '🎯 Medium'   },
  { value: 'long',   label: '🎲 Long Shot' },
];

export const AID_TYPES = [
  { id: 'pell',       label: 'Pell Grant',        note: 'Federal need-based grant — SAI of -1500 means MAX Pell (~$7,395/yr). Does NOT repay.' },
  { id: 'seog',       label: 'SEOG Grant',        note: 'Supplemental Educational Opportunity Grant — need-based, does NOT repay' },
  { id: 'sub_loan',   label: 'Subsidized Loan',   note: 'Gov pays interest while in school — repayment required' },
  { id: 'unsub_loan', label: 'Unsubsidized Loan', note: 'Interest accrues immediately — repayment required' },
  { id: 'work_study', label: 'Work-Study',        note: 'Part-time job earnings, not a grant' },
  { id: 'state',      label: 'State Grant',        note: 'Michigan Competitive Scholarship, MI Tuition Grant — pulled from FAFSA' },
  { id: 'college',    label: 'Institutional Aid',  note: 'Go Blue Guarantee, UM-Flint Transfer Scholarship — direct from the school' },
];

// Colin's tiered scholarship list, pre-seeded into the tracker.
// priority maps to strategy tier: easy = guaranteed/near-guaranteed, medium = high probability,
// long = career-defining / competitive. Amounts are display estimates — verify each at the URL.
export const DEFAULT_SCHOLARSHIPS = [
  // ── Tier 1: guaranteed / near-guaranteed ──
  { id: 'sc_pell', name: 'Federal Pell Grant', amount: 7395, deadline: 'File FAFSA ASAP', status: 'found', priority: 'easy', url: 'https://studentaid.gov', notes: 'SAI -1500 = maximum Pell. File FAFSA at studentaid.gov. Renews yearly.' },
  { id: 'sc_umflint_transfer', name: 'UM-Flint Transfer Scholarship', amount: 5000, deadline: 'Automatic on admission', status: 'found', priority: 'easy', url: 'https://www.umflint.edu/financialaid/', notes: 'Automatic at 3.0+ GPA — confirm it posts to your account.' },
  { id: 'sc_go_blue', name: 'Go Blue Guarantee', amount: 13000, deadline: 'With readmission / FAFSA', status: 'found', priority: 'easy', url: 'https://goblue.umich.edu', notes: 'Covers in-state tuition under an income threshold. Michigan residency is the unlock.' },
  { id: 'sc_mi_competitive', name: 'Michigan Competitive Scholarship', amount: 1000, deadline: 'Auto from FAFSA', status: 'found', priority: 'easy', url: 'https://www.michigan.gov/mistudentaid', notes: 'Pulled automatically from FAFSA for eligible residents.' },
  // ── Tier 2: high probability ──
  { id: 'sc_microsoft', name: 'Microsoft Scholarship', amount: 5000, deadline: 'Check annual cycle', status: 'found', priority: 'medium', url: 'https://www.microsoft.com/en-us/diversity/programs/microsoft-scholarship-program', notes: 'Strong CS + STEM profile fit.' },
  { id: 'sc_ai4all', name: 'AI4ALL Ignite', amount: 2500, deadline: 'Rolling cohorts', status: 'found', priority: 'medium', url: 'https://ai-4-all.org/ignite/', notes: 'AI builder background — lead with TABOOST and the quant work.' },
  { id: 'sc_niche', name: 'Niche $10K No Essay', amount: 10000, deadline: 'Monthly', status: 'found', priority: 'easy', url: 'https://www.niche.com/colleges/scholarship/no-essay-scholarship/', notes: 'Zero effort, enter every month.' },
  { id: 'sc_bold', name: 'Bold.org STEM Batch', amount: 1500, deadline: 'Rolling', status: 'found', priority: 'medium', url: 'https://bold.org/scholarships/', notes: 'Many small STEM awards — batch-apply with the AI Essays tab.' },
  { id: 'sc_coolidge', name: 'Coolidge Scholarship', amount: 20000, deadline: 'Winter', status: 'found', priority: 'long', url: 'https://coolidgescholars.org', notes: 'Full-ride upside. Academic merit + intellectual curiosity. Reach, but worth one strong essay.' },
  { id: 'sc_jkc', name: 'Jack Kent Cooke Transfer Scholarship', amount: 30000, deadline: 'Fall', status: 'found', priority: 'long', url: 'https://www.jkcf.org/our-scholarships/undergraduate-transfer-scholarship/', notes: 'Up to $55k/yr. Need + transfer fit is strong; very competitive.' },
  { id: 'sc_gen_google', name: 'Generation Google Scholarship', amount: 10000, deadline: 'Winter', status: 'found', priority: 'medium', url: 'https://buildyourfuture.withgoogle.com/scholarships', notes: 'CS students committed to diversity in tech.' },
  { id: 'sc_swsis', name: 'SWSIS / Security Award', amount: 2000, deadline: 'Spring', status: 'found', priority: 'medium', url: 'https://www.cra.org/swsis/', notes: 'Computing/security fields — tie in the quant/systems angle.' },
  { id: 'sc_fastweb', name: 'Fastweb Matched Batch', amount: 1000, deadline: 'Rolling', status: 'found', priority: 'easy', url: 'https://www.fastweb.com', notes: 'Profile-matched scholarships — volume play, filter to STEM + essay-reuse.' },
  { id: 'sc_scholarships360', name: 'Scholarships360 No-Essay', amount: 10000, deadline: 'Monthly', status: 'found', priority: 'easy', url: 'https://scholarships360.org', notes: 'No-essay recurring — enter monthly.' },
  { id: 'sc_appily', name: 'Appily Easy Money', amount: 2500, deadline: 'Monthly', status: 'found', priority: 'easy', url: 'https://www.appily.com/scholarships', notes: 'Low-effort recurring — enter monthly.' },
  { id: 'sc_swe', name: 'SWE / NSBE STEM Awards', amount: 2500, deadline: 'Spring', status: 'found', priority: 'medium', url: 'https://swe.org/scholarships/', notes: 'Engineering/computing — reuse the STEM essay.' },
  { id: 'sc_horatio', name: 'Horatio Alger Scholarship', amount: 15000, deadline: 'Fall', status: 'found', priority: 'medium', url: 'https://scholars.horatioalger.org', notes: 'Overcoming adversity + financial need narrative fits.' },
  // ── Tier 3: the career-defining one ──
  { id: 'sc_goldwater', name: 'Barry Goldwater Scholarship', amount: 7500, deadline: 'Apply Jan 2028', status: 'found', priority: 'long', url: 'https://goldwater.scholarsapply.org', notes: 'Needs ~1 yr research + faculty nomination. Get into a lab Fall 2027. This one changes everything.' },
];
