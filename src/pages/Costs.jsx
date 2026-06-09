import { useState } from 'react';
import { PLAN_YEARS } from '../data/defaults';

const fmt = (n) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export default function Costs({ costs, setCosts }) {
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState({});

  const totalAnnual = costs.reduce((s, c) => s + Number(c.annualAmount || 0), 0);
  const total5yr = totalAnnual * PLAN_YEARS;

  function startEdit(cost) {
    setEditing(cost.id);
    setDraft({ annualAmount: cost.annualAmount, note: cost.note });
  }

  function saveEdit(id) {
    setCosts((prev) =>
      prev.map((c) =>
        c.id === id
          ? { ...c, annualAmount: Number(draft.annualAmount) || 0, note: draft.note }
          : c
      )
    );
    setEditing(null);
  }

  function cancelEdit() {
    setEditing(null);
  }

  function addCustomCost() {
    const newItem = {
      id: `custom_${Date.now()}`,
      label: 'New Cost Item',
      annualAmount: 0,
      note: '',
    };
    setCosts((prev) => [...prev, newItem]);
    startEdit(newItem.id);
    setDraft({ annualAmount: 0, note: '' });
  }

  function removeCost(id) {
    setCosts((prev) => prev.filter((c) => c.id !== id));
  }

  function updateLabel(id, label) {
    setCosts((prev) => prev.map((c) => (c.id === id ? { ...c, label } : c)));
  }

  return (
    <div className="page">
      <h1>Cost Estimator</h1>
      <p className="subtitle">
        Estimated annual costs × {PLAN_YEARS} years. Click any row to edit.
      </p>

      <table className="data-table">
        <thead>
          <tr>
            <th>Category</th>
            <th className="right">Per Year</th>
            <th className="right">5-Year Total</th>
            <th>Notes</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {costs.map((cost) =>
            editing === cost.id ? (
              <tr key={cost.id} className="editing-row">
                <td>
                  <input
                    className="inline-input"
                    defaultValue={cost.label}
                    onBlur={(e) => updateLabel(cost.id, e.target.value)}
                  />
                </td>
                <td className="right">
                  <input
                    className="inline-input amount-input"
                    type="number"
                    min="0"
                    value={draft.annualAmount}
                    onChange={(e) => setDraft((d) => ({ ...d, annualAmount: e.target.value }))}
                  />
                </td>
                <td className="right">{fmt((Number(draft.annualAmount) || 0) * PLAN_YEARS)}</td>
                <td>
                  <input
                    className="inline-input note-input"
                    value={draft.note}
                    onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
                    placeholder="Note…"
                  />
                </td>
                <td className="actions">
                  <button className="btn btn-sm btn-green" onClick={() => saveEdit(cost.id)}>
                    Save
                  </button>
                  <button className="btn btn-sm" onClick={cancelEdit}>
                    Cancel
                  </button>
                </td>
              </tr>
            ) : (
              <tr key={cost.id} className="clickable-row" onClick={() => startEdit(cost)}>
                <td>{cost.label}</td>
                <td className="right">{fmt(cost.annualAmount)}</td>
                <td className="right">{fmt(cost.annualAmount * PLAN_YEARS)}</td>
                <td className="note-text">{cost.note}</td>
                <td className="actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={() => removeCost(cost.id)}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            )
          )}
        </tbody>
        <tfoot>
          <tr className="total-row">
            <td>
              <strong>Total</strong>
            </td>
            <td className="right">
              <strong>{fmt(totalAnnual)}</strong>
            </td>
            <td className="right">
              <strong>{fmt(total5yr)}</strong>
            </td>
            <td colSpan={2}></td>
          </tr>
        </tfoot>
      </table>

      <button className="btn btn-primary mt-1" onClick={addCustomCost}>
        + Add Cost Item
      </button>

      <div className="info-box mt-2">
        <strong>💡 Tip:</strong> These are estimates for an in-state public university. Adjust
        each row to match your actual school&apos;s cost of attendance (CoA) once you have an
        acceptance letter. Your school&apos;s financial aid portal will show the official CoA.
      </div>
    </div>
  );
}
