import { useState } from 'react';
import { STATUS_OPTIONS, PRIORITY_OPTIONS } from '../data/defaults';

const fmt = (n) =>
  Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

const PRIORITY_ORDER = { easy: 0, medium: 1, long: 2 };
const STATUS_ORDER = { won: 0, applied: 1, found: 2, rejected: 3 };

const AI_TIPS = {
  easy: [
    'Search "[your city/county] community foundation scholarship" — these get maybe 10–30 applicants.',
    'Check your local Rotary Club, Elks Lodge, VFW, and Lions Club. They give $500–$2k and most students never apply.',
    'Ask every employer your family works for — many have employee dependent scholarships.',
    'Check your high school guidance office list. Local scholarships are the lowest competition you will ever find.',
  ],
  medium: [
    'Use Claude to write a base essay, then tweak the opening paragraph for each scholarship\'s specific prompt.',
    'Apply to every scholarship your intended major/department offers — program-specific ones have fewer applicants.',
    'Check professional associations in your field (engineering, nursing, IT, etc). They all have scholarships.',
    'DECA, FFA, FFA, 4-H, Boy Scouts, Girl Scouts — if you were in any of these, you have eligible scholarships.',
  ],
  long: [
    'National scholarships ($5k+) are worth 2–3 hours of effort each. Use your winning essays as a template.',
    'Apply to Coca-Cola Scholars, Gates Scholarship, Questbridge — even low odds are worth the time at scale.',
    'Bulk-apply: FastWeb, Scholarships.com, Bold.org — use Claude to churn essays for every matching one.',
    'Track your rejections. Many scholarships recycle applicants — reapply next cycle with a better essay.',
  ],
};

function StatusBadge({ status }) {
  const opt = STATUS_OPTIONS.find((s) => s.value === status);
  if (!opt) return null;
  return (
    <span className="status-badge" style={{ backgroundColor: opt.color }}>
      {opt.label}
    </span>
  );
}

function PriorityBadge({ priority }) {
  const opt = PRIORITY_OPTIONS.find((p) => p.value === priority);
  return <span className="priority-badge">{opt ? opt.label : priority}</span>;
}

export default function Scholarships({ scholarships, setScholarships }) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterPriority, setFilterPriority] = useState('all');
  const [sortBy, setSortBy] = useState('priority');
  const [draft, setDraft] = useState({
    name: '',
    amount: '',
    deadline: '',
    status: 'found',
    priority: 'easy',
    url: '',
    notes: '',
  });

  const totalWon = scholarships
    .filter((s) => s.status === 'won')
    .reduce((s, sc) => s + Number(sc.amount || 0), 0);

  const totalApplied = scholarships
    .filter((s) => s.status === 'applied')
    .reduce((s, sc) => s + Number(sc.amount || 0), 0);

  const totalPipeline = scholarships
    .filter((s) => s.status !== 'rejected')
    .reduce((s, sc) => s + Number(sc.amount || 0), 0);

  function openNew() {
    setDraft({ name: '', amount: '', deadline: '', status: 'found', priority: 'easy', url: '', notes: '' });
    setEditingId(null);
    setShowForm(true);
  }

  function openEdit(sc) {
    setDraft({ ...sc });
    setEditingId(sc.id);
    setShowForm(true);
  }

  function saveDraft() {
    if (!draft.name.trim()) return;
    if (editingId) {
      setScholarships((prev) => prev.map((s) => (s.id === editingId ? { ...draft, id: editingId } : s)));
    } else {
      setScholarships((prev) => [...prev, { ...draft, id: `sc_${Date.now()}` }]);
    }
    setShowForm(false);
    setEditingId(null);
  }

  function remove(id) {
    setScholarships((prev) => prev.filter((s) => s.id !== id));
  }

  function updateStatus(id, status) {
    setScholarships((prev) => prev.map((s) => (s.id === id ? { ...s, status } : s)));
  }

  let visible = [...scholarships];
  if (filterStatus !== 'all') visible = visible.filter((s) => s.status === filterStatus);
  if (filterPriority !== 'all') visible = visible.filter((s) => s.priority === filterPriority);

  if (sortBy === 'priority') {
    visible.sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9));
  } else if (sortBy === 'status') {
    visible.sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9));
  } else if (sortBy === 'amount') {
    visible.sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0));
  } else if (sortBy === 'deadline') {
    visible.sort((a, b) => (a.deadline || '').localeCompare(b.deadline || ''));
  }

  const currentTipPriority = filterPriority !== 'all' ? filterPriority : 'easy';

  return (
    <div className="page">
      <h1>Scholarships</h1>
      <p className="subtitle">Track every scholarship. Easiest wins first, then mass-apply with AI.</p>

      <div className="card-grid">
        <div className="card card-green">
          <div className="card-label">🏆 Won</div>
          <div className="card-value green">{fmt(totalWon)}</div>
        </div>
        <div className="card">
          <div className="card-label">📬 Applied (pending)</div>
          <div className="card-value">{fmt(totalApplied)}</div>
        </div>
        <div className="card">
          <div className="card-label">💰 Total Pipeline</div>
          <div className="card-value">{fmt(totalPipeline)}</div>
        </div>
        <div className="card">
          <div className="card-label">Total Tracked</div>
          <div className="card-value">{scholarships.length}</div>
        </div>
      </div>

      <div className="ai-tips-box">
        <h3>🤖 AI Application Tips — {PRIORITY_OPTIONS.find((p) => p.value === currentTipPriority)?.label}</h3>
        <ul>
          {AI_TIPS[currentTipPriority]?.map((tip, i) => (
            <li key={i}>{tip}</li>
          ))}
        </ul>
        <p className="tip-note">
          <strong>How to use Claude:</strong> Paste a scholarship prompt into Claude and say: &ldquo;Write a
          600-word scholarship essay for this prompt based on my background: [your bio]. Make it
          personal, specific, and highlight my plans for [your field].&rdquo; Then tweak the result.
          Volume beats perfection at the easy-win level.
        </p>
      </div>

      <div className="toolbar">
        <div className="filter-group">
          <label>Status:</label>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            <option value="all">All</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
        <div className="filter-group">
          <label>Priority:</label>
          <select value={filterPriority} onChange={(e) => setFilterPriority(e.target.value)}>
            <option value="all">All</option>
            {PRIORITY_OPTIONS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>
        <div className="filter-group">
          <label>Sort:</label>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            <option value="priority">Priority (Easy First)</option>
            <option value="status">Status</option>
            <option value="amount">Amount (High First)</option>
            <option value="deadline">Deadline</option>
          </select>
        </div>
        <button className="btn btn-primary" onClick={openNew}>
          + Add Scholarship
        </button>
      </div>

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editingId ? 'Edit Scholarship' : 'Add Scholarship'}</h2>
            <div className="form-grid">
              <label>Name *</label>
              <input
                className="input"
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="Scholarship name"
              />
              <label>Amount ($)</label>
              <input
                className="input"
                type="number"
                min="0"
                value={draft.amount}
                onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value }))}
                placeholder="0"
              />
              <label>Deadline</label>
              <input
                className="input"
                type="date"
                value={draft.deadline}
                onChange={(e) => setDraft((d) => ({ ...d, deadline: e.target.value }))}
              />
              <label>Priority</label>
              <select
                className="input"
                value={draft.priority}
                onChange={(e) => setDraft((d) => ({ ...d, priority: e.target.value }))}
              >
                {PRIORITY_OPTIONS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
              <label>Status</label>
              <select
                className="input"
                value={draft.status}
                onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value }))}
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
              <label>URL</label>
              <input
                className="input"
                value={draft.url}
                onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value }))}
                placeholder="https://..."
              />
              <label>Notes</label>
              <textarea
                className="input"
                rows={3}
                value={draft.notes}
                onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
                placeholder="Essay prompt, requirements, contacts…"
              />
            </div>
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={saveDraft}>
                {editingId ? 'Save Changes' : 'Add'}
              </button>
              <button className="btn" onClick={() => setShowForm(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {visible.length === 0 ? (
        <div className="empty-state">
          No scholarships match your filters. Add one with the button above!
        </div>
      ) : (
        <div className="scholarship-list">
          {visible.map((sc) => (
            <div key={sc.id} className={`scholarship-card status-${sc.status}`}>
              <div className="sc-header">
                <div className="sc-name">
                  {sc.url ? (
                    <a href={sc.url} target="_blank" rel="noopener noreferrer">
                      {sc.name}
                    </a>
                  ) : (
                    sc.name
                  )}
                </div>
                <div className="sc-amount">
                  {sc.amount ? fmt(sc.amount) : '?'}
                </div>
              </div>
              <div className="sc-meta">
                <StatusBadge status={sc.status} />
                <PriorityBadge priority={sc.priority} />
                {sc.deadline && <span className="deadline">📅 {sc.deadline}</span>}
              </div>
              {sc.notes && <div className="sc-notes">{sc.notes}</div>}
              <div className="sc-actions">
                <select
                  className="status-select"
                  value={sc.status}
                  onChange={(e) => updateStatus(sc.id, e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
                <button className="btn btn-sm" onClick={() => openEdit(sc)}>
                  Edit
                </button>
                <button className="btn btn-sm btn-danger" onClick={() => remove(sc.id)}>
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="info-box mt-2">
        <strong>📋 Good scholarship databases to mine:</strong> Fastweb, Scholarships.com,
        Bold.org, Unigo, Cappex, your state higher ed agency, your school&apos;s financial aid
        page, and every local community foundation within 50 miles.
      </div>
    </div>
  );
}
