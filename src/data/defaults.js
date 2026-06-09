export const DEFAULT_COSTS = [
  { id: 'tuition', label: 'Tuition & Fees', annualAmount: 11000, note: 'In-state public university estimate' },
  { id: 'housing', label: 'Housing & Utilities', annualAmount: 9000, note: 'On/off-campus room' },
  { id: 'food', label: 'Food & Dining', annualAmount: 4500, note: 'Meal plan or groceries' },
  { id: 'books', label: 'Books & Supplies', annualAmount: 1200, note: 'Textbooks, lab fees, software' },
  { id: 'transport', label: 'Transportation', annualAmount: 1500, note: 'Bus pass, gas, occasional travel home' },
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
  { id: 'pell',       label: 'Pell Grant',                  note: 'Federal need-based grant — does NOT need to be repaid' },
  { id: 'seog',       label: 'SEOG Grant',                  note: 'Supplemental Educational Opportunity Grant' },
  { id: 'sub_loan',   label: 'Subsidized Loan',             note: 'Gov pays interest while in school — repayment required' },
  { id: 'unsub_loan', label: 'Unsubsidized Loan',           note: 'Interest accrues immediately — repayment required' },
  { id: 'work_study', label: 'Work-Study',                  note: 'Part-time job earnings, not a grant' },
  { id: 'state',      label: 'State Grant',                 note: 'Oregon Opportunity Grant, OregonPromise, etc.' },
  { id: 'college',    label: 'Institutional Aid',           note: 'Direct from your school' },
];
