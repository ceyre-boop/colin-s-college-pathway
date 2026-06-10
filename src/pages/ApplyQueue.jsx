import { useMemo, useState } from 'react';
import { PROFILE, fieldsBlock } from '../data/profile';
import { estimateBatchCost, fmtUsd } from '../lib/essayCost';

// Which scholarships to draft for. "To apply" = not yet won/rejected.
function isPursuing(s) {
  return s.status === 'found' || s.status === 'applied';
}

export default function ApplyQueue({ scholarships, setScholarships }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [includeAll, setIncludeAll] = useState(false);
  const [totalCost, setTotalCost] = useState(null);

  const targets = useMemo(
    () => scholarships.filter((s) => (includeAll ? s.status !== 'rejected' : isPursuing(s))),
    [scholarships, includeAll],
  );
  const estimate = useMemo(() => estimateBatchCost(targets), [targets]);

  // Cards = targets that have a draft, newest drafts first.
  const drafted = useMemo(
    () => scholarships.filter((s) => s.draftEssay),
    [scholarships],
  );

  function patch(id, fields) {
    setScholarships((prev) => prev.map((s) => (s.id === id ? { ...s, ...fields } : s)));
  }

  async function generate() {
    if (!targets.length) return;
    setLoading(true);
    setError('');
    setTotalCost(null);
    try {
      const res = await fetch('/api/batch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scholarships: targets, profile: PROFILE }),
      });
      const ct = res.headers.get('content-type') ?? '';
      if (!ct.includes('application/json')) {
        throw new Error(
          "The drafting backend isn't reachable here. It runs on the deployed Render service " +
            '(with your API key set). Run `bun run start` locally, or use the live site.',
        );
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      // Write drafts back onto each scholarship.
      for (const r of data.results) {
        if (r.ok) patch(r.id, { draftEssay: r.essay, draftModel: r.model, draftWords: r.words, approved: false });
      }
      const failed = data.results.filter((r) => !r.ok);
      setTotalCost(data.totalCostUsd ?? 0);
      if (failed.length) setError(`${failed.length} essay(s) failed: ${failed[0].error}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed.');
    } finally {
      setLoading(false);
    }
  }

  async function copyForChrome(s) {
    const text = [
      `Fill this scholarship application using my profile, then STOP before submitting so I can review.`,
      ``,
      `SCHOLARSHIP: ${s.name}${s.amount ? ` ($${Number(s.amount).toLocaleString()})` : ''}`,
      ``,
      `MY INFO:`,
      fieldsBlock(),
      ``,
      `ESSAY (use as-is or trim to the form's word limit):`,
      s.draftEssay,
    ].join('\n');
    await navigator.clipboard.writeText(text);
    patch(s.id, { copied: Date.now() });
    setTimeout(() => patch(s.id, { copied: 0 }), 1500);
  }

  return (
    <div className="page">
      <h1>Apply Queue</h1>
      <p className="subtitle">
        Draft tailored essays for every scholarship you're pursuing, review them, then hand approved
        ones to Claude for Chrome to fill.
      </p>

      <div className="info-box">
        <strong>💸 Token-minimal:</strong> Haiku drafts most essays; the big Tier-3 ones use Sonnet.
        Roughly <strong>$0.50 per 100 essays</strong>. Set a hard monthly cap in the Anthropic console
        as your backstop. Nothing is submitted here — you approve, then fill via Claude for Chrome.
      </div>

      <div className="toolbar" style={{ marginTop: '1rem' }}>
        <button className="btn btn-primary" onClick={generate} disabled={loading || !targets.length}>
          {loading ? 'Drafting…' : `Generate batch (${targets.length})`}
        </button>
        <span className="note-text">est. {fmtUsd(estimate)}</span>
        <label className="filter-group" style={{ marginLeft: 'auto' }}>
          <input type="checkbox" checked={includeAll} onChange={(e) => setIncludeAll(e.target.checked)} />
          include all (not just To-Apply / Applied)
        </label>
      </div>

      {error && <div className="alert alert-yellow" style={{ marginTop: '0.5rem' }}>⚠ {error}</div>}
      {totalCost != null && !error && (
        <div className="alert alert-green" style={{ marginTop: '0.5rem' }}>
          Drafted {drafted.length} essay(s). Actual cost this run: <strong>{fmtUsd(totalCost)}</strong>.
        </div>
      )}

      {drafted.length === 0 ? (
        <div className="empty-state" style={{ marginTop: '1rem' }}>
          No drafts yet. Hit “Generate batch” to draft essays for the {targets.length} scholarship(s) you're pursuing.
        </div>
      ) : (
        <div style={{ marginTop: '1rem' }}>
          {drafted.map((s) => (
            <div key={s.id} className={`scholarship-card ${s.approved ? 'status-won' : ''}`}>
              <div className="sc-header">
                <div className="sc-name">{s.name}</div>
                <div className="sc-meta" style={{ gap: '0.5rem' }}>
                  {s.approved && <span className="status-badge" style={{ backgroundColor: '#10b981' }}>✅ Approved</span>}
                  <span className="priority-badge">{s.draftModel?.includes('sonnet') ? 'Sonnet' : 'Haiku'}</span>
                  <span className="note-text">{s.draftWords} words</span>
                </div>
              </div>

              <textarea
                className="input"
                rows={8}
                value={s.draftEssay}
                onChange={(e) => patch(s.id, { draftEssay: e.target.value, draftWords: e.target.value.trim().split(/\s+/).length })}
                style={{ marginTop: '0.5rem' }}
              />

              <div className="sc-actions" style={{ marginTop: '0.5rem' }}>
                {!s.approved ? (
                  <button className="btn btn-green" onClick={() => patch(s.id, { approved: true })}>
                    Approve
                  </button>
                ) : (
                  <button className="btn" onClick={() => patch(s.id, { approved: false })}>
                    Un-approve
                  </button>
                )}
                <button className="btn" onClick={() => copyForChrome(s)}>
                  {s.copied ? 'Copied ✓' : 'Copy for Chrome'}
                </button>
                <button className="btn btn-danger" onClick={() => patch(s.id, { draftEssay: '', approved: false })}>
                  Discard draft
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
