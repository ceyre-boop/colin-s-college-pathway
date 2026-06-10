import { useState } from 'react';
import { PROFILE } from '../data/profile';

const CUSTOM = '__custom__';

export default function Essays({ scholarships }) {
  const [selectedId, setSelectedId] = useState(scholarships[0]?.id ?? CUSTOM);
  const [customName, setCustomName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [profile, setProfile] = useState(PROFILE);
  const [essay, setEssay] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const selected = scholarships.find((s) => s.id === selectedId) ?? null;
  const scholarshipName = selectedId === CUSTOM ? customName.trim() : selected?.name ?? '';
  const scholarshipFocus = selected?.notes || 'General merit + financial need scholarship.';

  async function generate() {
    if (!scholarshipName) {
      setError('Pick a scholarship or enter a name first.');
      return;
    }
    setLoading(true);
    setError('');
    setEssay('');
    setCopied(false);
    try {
      const res = await fetch('/api/essay', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          scholarshipName,
          scholarshipFocus,
          amount: selected?.amount ? `$${Number(selected.amount).toLocaleString()}` : undefined,
          profile,
          extraContext: prompt.trim() || undefined,
        }),
      });
      // On a static host (GitHub Pages) there is no /api/essay — the request returns the SPA's
      // HTML, not JSON. Detect that and explain instead of throwing a cryptic parse error.
      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.includes('application/json')) {
        throw new Error(
          "Essay generation needs the backend, which isn't on this static preview yet — it goes " +
            'live once the app is deployed to Render. Everything else on this site works here.',
        );
      }
      const data = await res.json();
      if (!res.ok || !data.essay) throw new Error(data.error || `Request failed (${res.status})`);
      setEssay(data.essay);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed.');
    } finally {
      setLoading(false);
    }
  }

  async function copy() {
    await navigator.clipboard.writeText(essay);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="page">
      <h1>AI Essays</h1>
      <p className="subtitle">
        Draft a 400–500 word essay grounded in your real profile — not generic filler. Pick a
        tracked scholarship or enter any name, then generate.
      </p>

      <div className="info-box">
        <strong>⚙️ Backend required:</strong> essay generation runs on the Render deployment
        (it keeps the Claude API key server-side). On the static GitHub Pages preview the rest of
        the app works fully; this button activates once we deploy to Render.
      </div>

      <div className="card" style={{ marginTop: '1rem' }}>
        <div className="form-grid">
          <label>Scholarship</label>
          <select className="input" value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
            {scholarships.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.amount ? ` — $${Number(s.amount).toLocaleString()}` : ''}
              </option>
            ))}
            <option value={CUSTOM}>✏️ Custom (type a name)…</option>
          </select>

          {selectedId === CUSTOM && (
            <>
              <label>Scholarship name *</label>
              <input
                className="input"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="e.g. Acme Foundation STEM Award"
              />
            </>
          )}

          <label>Essay prompt / extra context</label>
          <textarea
            className="input"
            rows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Paste the scholarship's essay question, or note what to emphasize (e.g. leadership, the MRI project)…"
          />

          <label>Your profile</label>
          <textarea
            className="input"
            rows={8}
            value={profile}
            onChange={(e) => setProfile(e.target.value)}
          />
        </div>

        <div className="modal-actions" style={{ marginTop: '1rem' }}>
          <button className="btn btn-primary" onClick={generate} disabled={loading}>
            {loading ? 'Generating…' : 'Generate Essay'}
          </button>
        </div>

        {error && <div className="alert alert-yellow" style={{ marginTop: '1rem' }}>⚠ {error}</div>}
      </div>

      {essay && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <div className="toolbar" style={{ marginBottom: '0.75rem' }}>
            <span className="note-text">{essay.trim().split(/\s+/).length} words</span>
            <button className="btn btn-sm" onClick={copy} style={{ marginLeft: 'auto' }}>
              {copied ? 'Copied ✓' : 'Copy'}
            </button>
          </div>
          <div className="essay-output">{essay}</div>
        </div>
      )}
    </div>
  );
}
