import { PLAN_YEARS } from '../data/defaults';

const fmt = (n) =>
  Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

const IS_LOAN = ['sub_loan', 'unsub_loan'];

export default function Budget({ costs, scholarships, aid }) {
  const totalCost = costs.reduce((s, c) => s + Number(c.annualAmount || 0) * PLAN_YEARS, 0);

  const scholarshipWon = scholarships
    .filter((s) => s.status === 'won')
    .reduce((s, sc) => s + Number(sc.amount || 0), 0);

  const scholarshipPending = scholarships
    .filter((s) => s.status === 'applied')
    .reduce((s, sc) => s + Number(sc.amount || 0), 0);

  const grantAid = aid
    .filter((a) => !IS_LOAN.includes(a.id) && a.id !== 'work_study')
    .reduce((s, a) => s + Number(a.annualAmount || 0) * PLAN_YEARS, 0);

  const loanAid = aid
    .filter((a) => IS_LOAN.includes(a.id))
    .reduce((s, a) => s + Number(a.annualAmount || 0) * PLAN_YEARS, 0);

  const workStudy = aid
    .filter((a) => a.id === 'work_study')
    .reduce((s, a) => s + Number(a.annualAmount || 0) * PLAN_YEARS, 0);

  const totalFree = scholarshipWon + grantAid;
  const totalFunding = totalFree + loanAid + workStudy;
  const gap = totalCost - totalFunding;
  const gapAfterLoans = totalCost - totalFree;
  const gapIsGood = gap <= 0;
  const pctCovered = totalCost > 0 ? Math.min(100, (totalFunding / totalCost) * 100) : 0;
  const pctFree = totalCost > 0 ? Math.min(100, (totalFree / totalCost) * 100) : 0;

  const rows = [
    {
      label: '🎓 Scholarships Won',
      amount: scholarshipWon,
      type: 'free',
      note: 'Does not need to be repaid',
    },
    {
      label: '📬 Scholarships Pending',
      amount: scholarshipPending,
      type: 'pending',
      note: 'Applied — awaiting decision',
    },
    {
      label: '🎁 Grants & Institutional Aid',
      amount: grantAid,
      type: 'free',
      note: 'Pell, SEOG, state, school grants — free money',
    },
    {
      label: '💼 Work-Study (estimated earnings)',
      amount: workStudy,
      type: 'earned',
      note: 'Earned through part-time work program',
    },
    {
      label: '🏦 Loans',
      amount: loanAid,
      type: 'loan',
      note: '⚠️ Must be repaid with interest',
    },
  ];

  return (
    <div className="page">
      <h1>Budget Overview</h1>
      <p className="subtitle">Full 5-year picture — costs vs. every funding source.</p>

      <div className="progress-section">
        <div className="progress-labels">
          <span>Free funding coverage</span>
          <span>{pctFree.toFixed(0)}%</span>
        </div>
        <div className="progress-bar">
          <div
            className="progress-fill green-fill"
            style={{ width: `${pctFree}%` }}
          />
        </div>
        <div className="progress-labels mt-half">
          <span>Total funding coverage (incl. loans)</span>
          <span>{pctCovered.toFixed(0)}%</span>
        </div>
        <div className="progress-bar">
          <div
            className="progress-fill blue-fill"
            style={{ width: `${pctCovered}%` }}
          />
        </div>
      </div>

      <table className="data-table mt-1">
        <thead>
          <tr>
            <th>Source</th>
            <th className="right">5-Year Total</th>
            <th>Category</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>
          <tr className="cost-row">
            <td><strong>📚 Total Cost of Attendance</strong></td>
            <td className="right"><strong>{fmt(totalCost)}</strong></td>
            <td><span className="badge badge-gray">Cost</span></td>
            <td>All expenses × 5 years</td>
          </tr>
          {rows.map((row) => (
            <tr key={row.label} className={row.amount === 0 ? 'zero-row' : ''}>
              <td>{row.label}</td>
              <td className={`right ${row.type === 'loan' ? 'yellow' : row.type === 'pending' ? '' : 'green'}`}>
                {fmt(row.amount)}
              </td>
              <td>
                {row.type === 'free' && <span className="badge badge-green">Free 🎁</span>}
                {row.type === 'pending' && <span className="badge badge-gray">Pending ⏳</span>}
                {row.type === 'earned' && <span className="badge badge-blue">Earned 💼</span>}
                {row.type === 'loan' && <span className="badge badge-yellow">Loan 💳</span>}
              </td>
              <td className="note-text">{row.note}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className={`total-row ${gapIsGood ? '' : 'gap-row'}`}>
            <td><strong>{gapIsGood ? '🎉 Surplus' : '⚠️ Funding Gap'}</strong></td>
            <td className={`right ${gapIsGood ? 'green' : 'red'}`}>
              <strong>{gapIsGood ? `+${fmt(Math.abs(gap))}` : fmt(gap)}</strong>
            </td>
            <td colSpan={2}></td>
          </tr>
        </tfoot>
      </table>

      {!gapIsGood && (
        <div className="alert alert-red">
          <strong>Funding gap: {fmt(gap)}</strong> — You need more scholarships or grants.
          Without additional funding, this amount must come from out-of-pocket or extra loans.
          {loanAid > 0 && (
            <>
              {' '}You&apos;re already counting {fmt(loanAid)} in loans over 5 years. Minimize
              this number — every dollar of loan debt costs you ~1.5× at repayment.
            </>
          )}
        </div>
      )}

      {gap > 0 && gapAfterLoans > loanAid && (
        <div className="alert alert-yellow">
          Even with loans included, you still have a gap. Focus on the Scholarships page to close
          it with free money first.
        </div>
      )}

      {gapIsGood && (
        <div className="alert alert-green">
          Fully funded! 🎉 Keep applying to scholarships — any surplus can reduce loan dependence
          or create a financial buffer.
        </div>
      )}

      <div className="info-box mt-2">
        <strong>💡 Interpretation guide:</strong>
        <ul>
          <li><span className="green">Green numbers</span> = free money (grants, scholarships won). Best kind.</li>
          <li><span className="yellow">Yellow numbers</span> = loans. Real but must be repaid.</li>
          <li><span className="red">Red numbers</span> = funding gap. Your #1 priority to eliminate.</li>
          <li>Pending scholarships are NOT counted as secured — only won ones reduce your gap.</li>
        </ul>
      </div>
    </div>
  );
}
