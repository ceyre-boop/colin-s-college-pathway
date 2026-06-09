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
          <strong>Apply for all state grants.</strong> Oregon Opportunity Grant and OregonPromise
          are need-based and often overlooked.
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
