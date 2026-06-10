import { useMemo, useState } from 'react';
import { PROFILE } from '../data/profile';

const CUSTOM = '__custom__';

// Assembles a ready-to-paste essay prompt. You paste this into a Claude Code session
// and Claude drafts the essay on your Max subscription — no API key, no backend, no cost.
function buildPrompt({ name, focus, amount, profile, context }) {
  return [
    `Write a scholarship application essay of 400–500 words for the "${name}" scholarship` +
      (amount ? ` (${amount}).` : '.'),
    '',
    focus ? `WHAT THIS SCHOLARSHIP REWARDS:\n${focus}` : '',
    '',
    'APPLICANT PROFILE (ground every claim in these real facts — do not invent):',
    profile,
    context ? `\nADDITIONAL CONTEXT FOR THIS ESSAY:\n${context}` : '',
    '',
    'Requirements:',
    '- First person, specific, concrete. Use my real moments and projects.',
    "- Tie my story directly to what this specific scholarship rewards.",
    '- No generic filler, no clichés, no fabricated achievements.',
    '- 400–500 words. Return only the essay text, no preamble or title.',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

export default function Essays({ scholarships }) {
  const [selectedId, setSelectedId] = useState(scholarships[0]?.id ?? CUSTOM);
  const [customName, setCustomName] = useState('');
  const [context, setContext] = useState('');
  const [profile, setProfile] = useState(PROFILE);
  const [copied, setCopied] = useState(false);

  const selected = scholarships.find((s) => s.id === selectedId) ?? null;
  const name = selectedId === CUSTOM ? customName.trim() : selected?.name ?? '';

  const prompt = useMemo(
    () =>
      name
        ? buildPrompt({
            name,
            focus: selected?.notes ?? '',
            amount: selected?.amount ? `$${Number(selected.amount).toLocaleString()}` : '',
            profile,
            context: context.trim(),
          })
        : '',
    [name, selected, profile, context],
  );

  async function copy() {
    if (!prompt) return;
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="page">
      <h1>AI Essays</h1>
      <p className="subtitle">
        Build a tailored essay prompt grounded in your real profile, then have Claude draft it.
      </p>

      <div className="info-box">
        <strong>🤖 How this works (free, on your Max plan):</strong>
        <ol>
          <li>Pick a scholarship (or type a name) and add any prompt-specific context.</li>
          <li>Hit <strong>Copy Prompt</strong>.</li>
          <li>Paste it into a Claude Code session and Claude drafts a 400–500 word essay from your profile.</li>
        </ol>
        <p className="tip-note">
          For a batch, paste several prompts at once — or just ask Claude to “write essays for every
          scholarship marked Applied.” Edit your real details in <code>src/data/profile.js</code> for sharper essays.
        </p>
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
              <label>Scholarship name</label>
              <input
                className="input"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="e.g. Acme Foundation STEM Award"
              />
            </>
          )}

          <label>Essay prompt / context</label>
          <textarea
            className="input"
            rows={3}
            value={context}
            onChange={(e) => setContext(e.target.value)}
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
      </div>

      {prompt && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <div className="toolbar" style={{ marginBottom: '0.75rem' }}>
            <span className="note-text">Ready-to-paste prompt</span>
            <button className="btn btn-primary" onClick={copy} style={{ marginLeft: 'auto' }}>
              {copied ? 'Copied ✓' : 'Copy Prompt'}
            </button>
          </div>
          <div className="essay-output">{prompt}</div>
        </div>
      )}
    </div>
  );
}
