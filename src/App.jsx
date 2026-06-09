import { useState } from 'react';
import { useLocalStorage } from './hooks/useLocalStorage';
import { DEFAULT_COSTS, AID_TYPES, PLAN_YEARS } from './data/defaults';
import Dashboard from './pages/Dashboard';
import Costs from './pages/Costs';
import Scholarships from './pages/Scholarships';
import Aid from './pages/Aid';
import Budget from './pages/Budget';
import './index.css';

const TABS = [
  { id: 'dashboard',    label: '📊 Dashboard'   },
  { id: 'costs',        label: '💸 Costs'        },
  { id: 'aid',          label: '🏛️ Gov Aid'      },
  { id: 'scholarships', label: '🎓 Scholarships' },
  { id: 'budget',       label: '📋 Budget'       },
];

const DEFAULT_AID = AID_TYPES.map((t) => ({ id: t.id, annualAmount: 0, notes: '' }));

export default function App() {
  const [tab, setTab] = useState('dashboard');
  const [costs, setCosts] = useLocalStorage('ccp_costs', DEFAULT_COSTS);
  const [scholarships, setScholarships] = useLocalStorage('ccp_scholarships', []);
  const [aid, setAid] = useLocalStorage('ccp_aid', DEFAULT_AID);

  function resetAll() {
    if (!window.confirm('Reset ALL data to defaults? This cannot be undone.')) return;
    setCosts(DEFAULT_COSTS);
    setScholarships([]);
    setAid(DEFAULT_AID);
  }

  const totalCost = costs.reduce((s, c) => s + Number(c.annualAmount || 0) * PLAN_YEARS, 0);
  const totalFunding =
    scholarships.filter((s) => s.status === 'won').reduce((s, sc) => s + Number(sc.amount || 0), 0) +
    aid.reduce((s, a) => s + Number(a.annualAmount || 0) * PLAN_YEARS, 0);
  const gap = totalCost - totalFunding;

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-inner">
          <div className="logo">
            <span className="logo-icon">🎓</span>
            <span className="logo-text">Colin&apos;s College Pathway</span>
          </div>
          <div className="header-gap">
            {gap > 0 ? (
              <span className="gap-indicator red">
                Gap: {gap.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}
              </span>
            ) : (
              <span className="gap-indicator green">✅ Fully Funded</span>
            )}
          </div>
        </div>
      </header>

      <nav className="app-nav">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`nav-btn ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="app-main">
        {tab === 'dashboard'    && <Dashboard    costs={costs} scholarships={scholarships} aid={aid} />}
        {tab === 'costs'        && <Costs        costs={costs} setCosts={setCosts} />}
        {tab === 'aid'          && <Aid          aid={aid} setAid={setAid} />}
        {tab === 'scholarships' && <Scholarships scholarships={scholarships} setScholarships={setScholarships} />}
        {tab === 'budget'       && <Budget       costs={costs} scholarships={scholarships} aid={aid} />}
      </main>

      <footer className="app-footer">
        <button className="btn btn-sm btn-danger" onClick={resetAll}>
          Reset All Data
        </button>
        <span className="footer-note">All data saved locally in your browser.</span>
      </footer>
    </div>
  );
}
