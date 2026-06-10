import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { PLAN_YEARS } from '../data/defaults';

const fmt = (n) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export default function Dashboard({ costs, scholarships, aid }) {
  const totalCost = costs.reduce((s, c) => s + c.annualAmount * PLAN_YEARS, 0);

  const scholarshipWon = scholarships
    .filter((s) => s.status === 'won')
    .reduce((s, sc) => s + Number(sc.amount || 0), 0);

  const aidSecured = aid.reduce((s, a) => s + Number(a.annualAmount || 0) * PLAN_YEARS, 0);

  const loansInAid = aid
    .filter((a) => a.id === 'sub_loan' || a.id === 'unsub_loan')
    .reduce((s, a) => s + Number(a.annualAmount || 0) * PLAN_YEARS, 0);

  const totalFunding = scholarshipWon + aidSecured;
  const gap = totalCost - totalFunding;
  const gapIsGood = gap <= 0;

  const scholarshipsApplied = scholarships.filter((s) => s.status === 'applied').length;
  const scholarshipsWon = scholarships.filter((s) => s.status === 'won').length;
  const scholarshipsFound = scholarships.filter((s) => s.status === 'found').length;

  // Funding coverage: one stacked bar of secured funding (green) vs remaining gap (red).
  const coverageData = [
    { name: '5-Year Plan', Funded: Math.min(totalFunding, totalCost), Gap: Math.max(0, gap) },
  ];

  // 5-year cost broken down by category.
  const costByCategory = costs.map((c) => ({
    name: c.label,
    total: Number(c.annualAmount || 0) * PLAN_YEARS,
  }));

  return (
    <div className="page">
      <h1>Dashboard</h1>
      <p className="subtitle">Your 5-year college funding snapshot.</p>

      <div className="card-grid">
        <div className="card">
          <div className="card-label">Total 5-Year Cost</div>
          <div className="card-value">{fmt(totalCost)}</div>
        </div>
        <div className="card">
          <div className="card-label">Scholarships Won</div>
          <div className="card-value green">{fmt(scholarshipWon)}</div>
        </div>
        <div className="card">
          <div className="card-label">Government Aid (5 yr)</div>
          <div className="card-value green">{fmt(aidSecured)}</div>
        </div>
        <div className={`card ${gapIsGood ? 'card-green' : 'card-red'}`}>
          <div className="card-label">{gapIsGood ? '🎉 Surplus' : '⚠️ Funding Gap'}</div>
          <div className={`card-value ${gapIsGood ? 'green' : 'red'}`}>
            {gapIsGood ? `+${fmt(Math.abs(gap))}` : fmt(gap)}
          </div>
        </div>
      </div>

      {gap > 0 && (
        <div className="alert alert-red">
          <strong>You still need {fmt(gap)}</strong> — that&apos;s money that would have to come
          from loans, out-of-pocket, or more scholarships. Let&apos;s fix that.
          {loansInAid > 0 && (
            <span>
              {' '}
              Note: {fmt(loansInAid)} of your aid is loans that must be repaid.
            </span>
          )}
        </div>
      )}

      {gap <= 0 && (
        <div className="alert alert-green">
          You&apos;re fully funded for all 5 years 🎉 Keep stacking scholarships to build a buffer.
        </div>
      )}

      <h2>Funding Coverage</h2>
      <div className="chart-card">
        <ResponsiveContainer width="100%" height={120}>
          <BarChart data={coverageData} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
            <XAxis
              type="number"
              tick={{ fill: '#8890b0', fontSize: 12 }}
              tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
            />
            <YAxis type="category" dataKey="name" tick={{ fill: '#8890b0', fontSize: 12 }} width={80} />
            <Tooltip
              formatter={(v) => fmt(v)}
              contentStyle={{ background: '#1a1d27', border: '1px solid #2d3252', borderRadius: 8 }}
              labelStyle={{ color: '#e8eaf0' }}
              cursor={{ fill: 'rgba(255,255,255,0.04)' }}
            />
            <Legend wrapperStyle={{ fontSize: 13 }} />
            <Bar dataKey="Funded" stackId="a" fill="#22c55e" radius={[4, 0, 0, 4]} />
            <Bar dataKey="Gap" stackId="a" fill="#ef4444" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <h2>5-Year Cost by Category</h2>
      <div className="chart-card">
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={costByCategory} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2d3252" vertical={false} />
            <XAxis dataKey="name" tick={{ fill: '#8890b0', fontSize: 11 }} interval={0} angle={-15} textAnchor="end" height={50} />
            <YAxis
              tick={{ fill: '#8890b0', fontSize: 12 }}
              tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
            />
            <Tooltip
              formatter={(v) => fmt(v)}
              contentStyle={{ background: '#1a1d27', border: '1px solid #2d3252', borderRadius: 8 }}
              labelStyle={{ color: '#e8eaf0' }}
              cursor={{ fill: 'rgba(255,255,255,0.04)' }}
            />
            <Bar dataKey="total" radius={[4, 4, 0, 0]}>
              {costByCategory.map((_, i) => (
                <Cell key={i} fill="#6366f1" />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <h2>Scholarship Pipeline</h2>
      <div className="card-grid">
        <div className="card">
          <div className="card-label">🔍 Found (to apply)</div>
          <div className="card-value">{scholarshipsFound}</div>
        </div>
        <div className="card">
          <div className="card-label">📬 Applied</div>
          <div className="card-value">{scholarshipsApplied}</div>
        </div>
        <div className="card">
          <div className="card-label">🏆 Won</div>
          <div className="card-value green">{scholarshipsWon}</div>
        </div>
      </div>

      <h2>Strategy</h2>
      <ol className="strategy-list">
        <li>
          <strong>File FAFSA first.</strong> Free money from the government — Pell Grant, SEOG,
          and subsidized loans. No FAFSA = leaving thousands on the table.
        </li>
        <li>
          <strong>Lock in Michigan residency + Go Blue Guarantee.</strong> In-state status plus the
          Go Blue Guarantee can cover tuition outright — the single biggest lever, worth ~$15–20k.
        </li>
        <li>
          <strong>Easy wins first.</strong> Local scholarships ($250–$2k) have almost no competition.
          Apply to every single one in your area.
        </li>
        <li>
          <strong>Mass-apply with AI.</strong> Use the Scholarships tab to track every
          opportunity. Use Claude to draft and tailor essays fast.
        </li>
        <li>
          <strong>Long shots last.</strong> National competitions are worth a few tries but
          shouldn&apos;t eat your time before you&apos;ve swept the easy wins.
        </li>
      </ol>
    </div>
  );
}
