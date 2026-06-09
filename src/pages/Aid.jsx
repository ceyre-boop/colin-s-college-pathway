import { AID_TYPES } from '../data/defaults';
import { PLAN_YEARS } from '../data/defaults';

const fmt = (n) =>
  Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

const IS_LOAN = ['sub_loan', 'unsub_loan'];

export default function Aid({ aid, setAid }) {
  function updateAid(id, field, value) {
    setAid((prev) =>
      prev.map((a) => (a.id === id ? { ...a, [field]: value } : a))
    );
  }

  const totalAnnual = aid.reduce((s, a) => s + Number(a.annualAmount || 0), 0);
  const total5yr = totalAnnual * PLAN_YEARS;
  const grantAnnual = aid
    .filter((a) => !IS_LOAN.includes(a.id) && a.id !== 'work_study')
    .reduce((s, a) => s + Number(a.annualAmount || 0), 0);
  const loanAnnual = aid
    .filter((a) => IS_LOAN.includes(a.id))
    .reduce((s, a) => s + Number(a.annualAmount || 0), 0);
  const workStudyAnnual = aid.find((a) => a.id === 'work_study')?.annualAmount || 0;

  return (
    <div className="page">
      <h1>Government &amp; Institutional Aid</h1>
      <p className="subtitle">
        Enter your expected annual aid amounts from your FAFSA award letter and school offers.
        Grants = free money. Loans = debt. Work-study = earned.
      </p>

      <div className="card-grid">
        <div className="card card-green">
          <div className="card-label">🎁 Free Aid (Grants)</div>
          <div className="card-value green">{fmt(grantAnnual * PLAN_YEARS)}</div>
          <div className="card-sublabel">{fmt(grantAnnual)}/yr</div>
        </div>
        <div className={`card ${loanAnnual > 0 ? 'card-yellow' : ''}`}>
          <div className="card-label">🏦 Loans (must repay)</div>
          <div className={`card-value ${loanAnnual > 0 ? 'yellow' : ''}`}>{fmt(loanAnnual * PLAN_YEARS)}</div>
          <div className="card-sublabel">{fmt(loanAnnual)}/yr</div>
        </div>
        <div className="card">
          <div className="card-label">💼 Work-Study (earned)</div>
          <div className="card-value">{fmt(Number(workStudyAnnual) * PLAN_YEARS)}</div>
          <div className="card-sublabel">{fmt(workStudyAnnual)}/yr</div>
        </div>
        <div className="card">
          <div className="card-label">Total Aid (5 yr)</div>
          <div className="card-value">{fmt(total5yr)}</div>
        </div>
      </div>

      <table className="data-table mt-1">
        <thead>
          <tr>
            <th>Aid Type</th>
            <th className="right">Annual Amount</th>
            <th className="right">5-Year Total</th>
            <th>Type</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {AID_TYPES.map((type) => {
            const row = aid.find((a) => a.id === type.id) || { id: type.id, annualAmount: 0 };
            const isLoan = IS_LOAN.includes(type.id);
            const isWS = type.id === 'work_study';
            return (
              <tr key={type.id}>
                <td>
                  <strong>{type.label}</strong>
                  <div className="note-text">{type.note}</div>
                </td>
                <td className="right">
                  <input
                    className="inline-input amount-input"
                    type="number"
                    min="0"
                    value={row.annualAmount || ''}
                    placeholder="0"
                    onChange={(e) => updateAid(type.id, 'annualAmount', e.target.value)}
                  />
                </td>
                <td className={`right ${isLoan ? 'yellow' : 'green'}`}>
                  {fmt(Number(row.annualAmount || 0) * PLAN_YEARS)}
                </td>
                <td>
                  {isLoan ? (
                    <span className="badge badge-yellow">Loan 💳</span>
                  ) : isWS ? (
                    <span className="badge badge-blue">Earned 💼</span>
                  ) : (
                    <span className="badge badge-green">Grant 🎁</span>
                  )}
                </td>
                <td>
                  <input
                    className="inline-input note-input"
                    value={row.notes || ''}
                    placeholder="Notes…"
                    onChange={(e) => updateAid(type.id, 'notes', e.target.value)}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="total-row">
            <td><strong>Total</strong></td>
            <td className="right"><strong>{fmt(totalAnnual)}</strong></td>
            <td className="right"><strong>{fmt(total5yr)}</strong></td>
            <td colSpan={2}></td>
          </tr>
        </tfoot>
      </table>

      <div className="info-box mt-2">
        <strong>📋 FAFSA Checklist — file at studentaid.gov</strong>
        <ul className="checklist">
          <li>File as early as possible after Oct 1 each year — aid is first-come, first-served.</li>
          <li>Use the IRS Data Retrieval Tool to auto-fill tax info.</li>
          <li>List every school you&apos;re considering — it&apos;s free to add them.</li>
          <li>After filing, check each school&apos;s portal for your award letter.</li>
          <li>You can appeal your aid package — write a letter explaining financial changes.</li>
        </ul>
      </div>

      <div className="info-box mt-1">
        <strong>⚠️ Loan Reality Check</strong>
        <p>
          Subsidized loans: the government pays interest while you&apos;re in school. Unsubsidized:
          interest starts immediately. Use loans as a last resort after exhausting all grants and
          scholarships. The goal is to minimize the red number on the Dashboard.
        </p>
      </div>
    </div>
  );
}
