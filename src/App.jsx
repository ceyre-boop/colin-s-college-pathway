import { useEffect, useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { useLocalStorage } from "./hooks/useLocalStorage";
import { semesterFinancials } from "./data/semesters";
import { INIT_TIMELINE, CAT_META } from "./data/timeline";
import { PATHWAY_DATA, COURSE_STATUS, ALREADY_HAVE, DEGREE_TOTAL, UPPER_DIVISION_NEEDED, UPPER_DIVISION_HAVE, GRAD_TARGET } from "./data/pathway";
import { REQUIREMENTS, ACTION_ITEMS, KEY_CONTACTS } from "./data/requirements";
import { DEFAULT_SCHOLARSHIPS, STATUS_OPTIONS, PRIORITY_OPTIONS } from "./data/defaults";
import { SCOUT_SCHOLARSHIPS, SCOUT_GENERATED_AT } from "./data/scoutFound";
import { fullProfile, fieldsBlock } from "./data/profile";
import { estimateBatchCost, fmtUsd } from "./lib/essayCost";
import "./index.css";

const T = {
  bg: "#080808", card: "#111", border: "#1e1e1e",
  red: "#FF1A1A", green: "#00D97E", yellow: "#FFB800",
  blue: "#4D9FFF", white: "#F4F4EE", muted: "#555", dim: "#2a2a2a",
};

const usd = (n) => (n >= 1000 ? `$${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K` : `$${n.toLocaleString()}`);
const fullUsd = (n) => `$${Math.round(n).toLocaleString()}`;

const STATUS_META = Object.fromEntries(STATUS_OPTIONS.map((s) => [s.value, s]));
const PURSUING = ["apply", "research", "applied"];

export default function CollegePathway() {
  const [tab, setTab] = useState("dashboard");
  const [inState, setInState] = useState(true);
  const [scholarships, setScholarships] = useLocalStorage("ccp_scholarships_v2", DEFAULT_SCHOLARSHIPS);
  const [timeline, setTimeline] = useLocalStorage("ccp_timeline_v2", INIT_TIMELINE);
  const [pathway, setPathway] = useLocalStorage("ccp_pathway_v2", PATHWAY_DATA);
  const [schFilter, setSchFilter] = useState("all");
  const [catFilter, setCatFilter] = useState("all");
  const [essaySch, setEssaySch] = useState("");
  const [essayPrompt, setEssayPrompt] = useState("");
  const [essayOut, setEssayOut] = useState("");
  const [essayLoading, setEssayLoading] = useState(false);
  const [showAddEvent, setShowAddEvent] = useState(false);
  const [newEvent, setNewEvent] = useState({ year: 2026, month: "", title: "", desc: "", cat: "academic", icon: "⭐", essay: "" });
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchMsg, setBatchMsg] = useState("");

  // Merge scout finds (src/data/scoutFound.js) into the localStorage-backed list.
  // Scout ids are stable slugs, so re-runs only add genuinely new scholarships and
  // the user's status/amount edits on existing ones persist.
  useEffect(() => {
    setScholarships((prev) => {
      const fresh = SCOUT_SCHOLARSHIPS.filter((s) => !prev.some((p) => p.id === s.id));
      return fresh.length ? [...prev, ...fresh] : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── computed financials ──
  const wonAmt = scholarships.filter((s) => s.status === "won").reduce((a, s) => a + Number(s.amount || 0), 0);
  const fin = useMemo(() => semesterFinancials(inState, wonAmt), [inState, wonAmt]);
  const { rows: semData, totalCost, totalPell, totalOther, totalFunded, gap } = fin;

  // ALREADY_HAVE (56) already includes the "Done" block (AP + Fall '25). Only count newly
  // completed credits from forward semesters so the tally doesn't double-count.
  const completedCredits = pathway
    .filter((s) => s.status !== "completed")
    .flatMap((s) => s.courses)
    .filter((c) => c.status === "completed")
    .reduce((a, c) => a + c.cr, 0);
  const haveCredits = ALREADY_HAVE + completedCredits;

  const filteredTimeline = timeline
    .filter((e) => catFilter === "all" || e.cat === catFilter)
    .slice()
    .sort((a, b) => a.year - b.year || (a.month || "").localeCompare(b.month || ""));

  const drafted = scholarships.filter((s) => s.draftEssay);
  const pursuing = scholarships.filter((s) => PURSUING.includes(s.status));

  // ── styles ──
  const S = {
    app: { background: T.bg, minHeight: "100vh", color: T.white, fontFamily: "monospace", fontSize: 13 },
    header: { borderBottom: `1px solid ${T.border}`, padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 },
    logo: { fontFamily: "'Arial Black',Impact,sans-serif", fontSize: 16, letterSpacing: 2, color: T.white },
    tabs: { display: "flex", gap: 2, background: T.card, padding: 3, flexWrap: "wrap" },
    tab: (active) => ({ padding: "6px 12px", cursor: "pointer", fontSize: 9, letterSpacing: 2, background: active ? T.red : "transparent", color: active ? T.bg : T.muted, border: "none", fontFamily: "monospace" }),
    card: { background: T.card, border: `1px solid ${T.border}`, padding: 16, marginBottom: 12 },
    label: { fontSize: 9, letterSpacing: 5, color: T.red, textTransform: "uppercase", marginBottom: 12 },
    metric: { background: T.card, border: `1px solid ${T.border}`, padding: "12px 16px", flex: 1, minWidth: 100 },
    mLabel: { fontSize: 9, letterSpacing: 3, color: T.muted, marginBottom: 4 },
    mVal: { fontSize: 22, fontFamily: "'Arial Black',Impact,sans-serif" },
    input: { background: T.bg, border: `1px solid ${T.border}`, color: T.white, padding: "6px 10px", fontFamily: "monospace", fontSize: 11, width: "100%" },
    btn: (c) => ({ padding: "6px 14px", cursor: "pointer", fontSize: 9, letterSpacing: 2, background: c + "22", color: c, border: `1px solid ${c}`, fontFamily: "monospace" }),
  };

  // ── actions ──
  async function generateEssay() {
    setEssayLoading(true); setEssayOut("");
    const sc = scholarships.find((s) => s.id === essaySch);
    try {
      const res = await fetch("/api/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scholarship: sc, profile: fullProfile(timeline), context: essayPrompt }),
      });
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.includes("application/json")) throw new Error("Backend not reachable — run the deployed site or `bun run start` with ANTHROPIC_API_KEY.");
      const data = await res.json();
      if (!res.ok || !data.essay) throw new Error(data.error || "Generation failed.");
      setEssayOut(data.essay);
    } catch (e) { setEssayOut("⚠ " + (e instanceof Error ? e.message : "API error.")); }
    setEssayLoading(false);
  }

  async function generateBatch() {
    if (!pursuing.length) return;
    setBatchLoading(true); setBatchMsg("");
    try {
      const res = await fetch("/api/batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scholarships: pursuing, profile: fullProfile(timeline) }),
      });
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.includes("application/json")) throw new Error("Backend not reachable — use the deployed site (key set), or `bun run start`.");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Batch failed.");
      setScholarships((prev) => prev.map((s) => {
        const r = data.results.find((x) => x.id === s.id && x.ok);
        return r ? { ...s, draftEssay: r.essay, draftModel: r.model, draftWords: r.words, approved: false } : s;
      }));
      const failed = data.results.filter((r) => !r.ok).length;
      setBatchMsg(`Drafted ${data.results.length - failed}/${data.results.length} · ${fmtUsd(data.totalCostUsd ?? 0)}${failed ? ` · ${failed} failed` : ""}`);
    } catch (e) { setBatchMsg("⚠ " + (e instanceof Error ? e.message : "failed")); }
    setBatchLoading(false);
  }

  const patchSch = (id, fields) => setScholarships((prev) => prev.map((s) => (s.id === id ? { ...s, ...fields } : s)));
  const updateSchStatus = (id, status) => patchSch(id, { status });
  const updateCourseStatus = (si, ci, status) => setPathway((prev) => prev.map((s, i) => i !== si ? s : { ...s, courses: s.courses.map((c, j) => j !== ci ? c : { ...c, status }) }));

  async function copyForChrome(s) {
    const text = [
      `Fill this scholarship application using my profile, then STOP before submitting so I can review.`,
      ``, `SCHOLARSHIP: ${s.name}${s.amount ? ` ($${Number(s.amount).toLocaleString()})` : ""}`,
      ``, `MY INFO:`, fieldsBlock(),
      ``, `ESSAY (trim to the form's word limit):`, s.draftEssay,
    ].join("\n");
    await navigator.clipboard.writeText(text);
    patchSch(s.id, { copied: Date.now() });
    setTimeout(() => patchSch(s.id, { copied: 0 }), 1500);
  }

  function addEvent() {
    const id = timeline.reduce((m, e) => Math.max(m, e.id), 0) + 1;
    setTimeline((prev) => [...prev, { ...newEvent, id }]);
    setShowAddEvent(false);
    setNewEvent({ year: 2026, month: "", title: "", desc: "", cat: "academic", icon: "⭐", essay: "" });
  }

  const TABS = [["dashboard", "DASHBOARD"], ["pathway", "PATHWAY"], ["requirements", "REQUIREMENTS"], ["timeline", "TIMELINE"], ["scholarships", "SCHOLARSHIPS"], ["essay", "AI ESSAYS"], ["queue", "APPLY QUEUE"]];

  const REQ_COLOR = { done: T.green, partial: T.yellow, gap: T.red };
  const REQ_MARK = { done: "✅", partial: "🟡", gap: "❌" };

  return (
    <div style={S.app}>
      <div style={S.header}>
        <div style={S.logo}>COLIN'S <span style={{ color: T.red }}>COLLEGE</span> PATHWAY</div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 9, color: T.muted, letterSpacing: 2 }}>TUITION:</span>
          {["IN-STATE", "OUT-OF-STATE"].map((l, i) => (
            <button key={l} style={S.btn(inState === (i === 0) ? T.green : T.muted)} onClick={() => setInState(i === 0)}>{l}</button>
          ))}
        </div>
        <div style={S.tabs}>
          {TABS.map(([id, label]) => (
            <button key={id} style={S.tab(tab === id)} onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>
      </div>

      {/* METRICS */}
      <div style={{ display: "flex", gap: 1, padding: 1, background: T.border, flexWrap: "wrap" }}>
        {[
          ["5-YR COST", fullUsd(totalCost), T.white],
          ["PELL+INST", fullUsd(totalPell + totalOther), T.blue],
          ["SCHOLARSHIPS", fullUsd(wonAmt), T.green],
          ["TOTAL FUNDED", fullUsd(totalFunded), T.green],
          ["GAP", fullUsd(gap), gap > 0 ? T.red : T.green],
          ["CREDITS", `${haveCredits}/${DEGREE_TOTAL}`, T.blue],
        ].map(([l, v, c]) => (
          <div key={l} style={S.metric}><div style={S.mLabel}>{l}</div><div style={{ ...S.mVal, color: c }}>{v}</div></div>
        ))}
      </div>

      <div style={{ padding: "16px 20px" }}>
        {/* DASHBOARD */}
        {tab === "dashboard" && (
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <div style={{ ...S.card, flex: 2, minWidth: 280 }}>
              <div style={S.label}>Cost vs Funding by Semester</div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={semData.map((s) => ({ name: s.label, Funded: s.funded, Gap: s.gap }))} barSize={18} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <XAxis dataKey="name" stroke={T.muted} tick={{ fontSize: 9, fill: T.muted }} />
                  <YAxis stroke="transparent" tick={{ fontSize: 9, fill: T.muted }} tickFormatter={(v) => `$${v / 1000}K`} />
                  <Tooltip contentStyle={{ background: T.card, border: `1px solid ${T.border}`, fontSize: 11, fontFamily: "monospace" }} formatter={(v, n) => [fullUsd(v), n]} />
                  <Bar dataKey="Funded" stackId="a" fill={T.green} isAnimationActive={false} />
                  <Bar dataKey="Gap" stackId="a" fill={T.red} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
              <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
                <span style={{ fontSize: 9, color: T.green }}>■ FUNDED</span>
                <span style={{ fontSize: 9, color: T.red }}>■ GAP</span>
              </div>
            </div>
            <div style={{ ...S.card, flex: 1, minWidth: 200 }}>
              <div style={S.label}>Funding Stack</div>
              {[["Pell Grant", totalPell, T.blue], ["Institutional Aid", totalOther, T.yellow], ["Scholarships Won", wonAmt, T.green], ["Remaining Gap", gap, gap > 0 ? T.red : T.green]].map(([l, v, c]) => (
                <div key={l} style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                    <span style={{ fontSize: 10, color: T.muted }}>{l}</span>
                    <span style={{ fontSize: 10, color: c }}>{fullUsd(v)}</span>
                  </div>
                  <div style={{ height: 4, background: T.dim }}><div style={{ height: 4, width: `${Math.min(100, (v / totalCost) * 100)}%`, background: c, transition: "width 0.5s" }} /></div>
                </div>
              ))}
              <div style={{ marginTop: 16, padding: "10px 12px", background: gap > 5000 ? T.red + "11" : T.green + "11", border: `1px solid ${gap > 5000 ? T.red : T.green}` }}>
                <div style={{ fontSize: 10, color: gap > 5000 ? T.red : T.green }}>
                  {gap > 15000 ? "🔴 Win in-state tuition ASAP" : gap > 5000 ? "🟡 Barry Goldwater + Go Blue Guarantee closes this" : gap > 0 ? "🟡 A few scholarships closes the gap" : "🟢 Fully funded — keep applying anyway"}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* PATHWAY */}
        {tab === "pathway" && (
          <div>
            <div style={{ ...S.card, marginBottom: 16 }}>
              <div style={S.label}>Degree Progress</div>
              <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 12 }}>
                {[["ALREADY HAVE", ALREADY_HAVE, T.green], ["COMPLETED", completedCredits, T.blue], ["REMAINING", DEGREE_TOTAL - haveCredits, T.red], ["DEGREE TOTAL", DEGREE_TOTAL, T.white]].map(([l, v, c]) => (
                  <div key={l}><span style={{ fontSize: 9, color: T.muted, letterSpacing: 3 }}>{l}</span><div style={{ fontSize: 28, fontFamily: "Impact,sans-serif", color: c }}>{v} cr</div></div>
                ))}
              </div>
              <div style={{ height: 6, background: T.dim, borderRadius: 3 }}>
                <div style={{ height: 6, background: `linear-gradient(90deg,${T.green},${T.blue})`, borderRadius: 3, width: `${Math.min(100, (haveCredits / DEGREE_TOTAL) * 100)}%`, transition: "width 0.5s" }} />
              </div>
              <div style={{ fontSize: 9, color: T.muted, marginTop: 6, letterSpacing: 2 }}>{Math.round((haveCredits / DEGREE_TOTAL) * 100)}% TOWARD BS CELLULAR & MOLECULAR BIOLOGY · GRAD TARGET {GRAD_TARGET.toUpperCase()}</div>
              <div style={{ fontSize: 9, color: T.muted, marginTop: 6, letterSpacing: 2 }}>UPPER-DIVISION (300+): <span style={{ color: UPPER_DIVISION_HAVE >= UPPER_DIVISION_NEEDED ? T.green : T.yellow }}>{UPPER_DIVISION_HAVE}/{UPPER_DIVISION_NEEDED}</span> · most core BIO/CHM/CSC courses ahead are 300+</div>
            </div>
            {pathway.map((sem, si) => (
              <div key={sem.sem} style={{ ...S.card, borderLeft: `3px solid ${sem.status === "current" ? T.green : T.muted}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                  <div>
                    <div style={{ fontFamily: "Impact,sans-serif", fontSize: 18, color: T.white, letterSpacing: 1 }}>{sem.sem}</div>
                    <div style={{ fontSize: 9, color: T.muted, letterSpacing: 3 }}>{sem.school} · {sem.courses.reduce((a, c) => a + c.cr, 0)} credits</div>
                  </div>
                  <span style={{ fontSize: 9, color: sem.status === "current" ? T.green : T.muted, letterSpacing: 3, border: `1px solid ${sem.status === "current" ? T.green : T.dim}`, padding: "3px 8px" }}>{sem.status.toUpperCase()}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {sem.courses.map((c, ci) => (
                    <div key={ci} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: T.bg, flexWrap: "wrap" }}>
                      <div style={{ flex: 1, minWidth: 200 }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                          <span style={{ color: T.red, fontSize: 10, letterSpacing: 1, fontWeight: "bold" }}>{c.code}</span>
                          <span style={{ color: T.white, fontSize: 11 }}>{c.name}</span>
                          <span style={{ color: T.muted, fontSize: 9 }}>{c.cr} cr</span>
                        </div>
                        <div style={{ fontSize: 9, color: T.muted, marginTop: 2 }}>{c.req}</div>
                      </div>
                      <div style={{ display: "flex", gap: 3 }}>
                        {Object.entries(COURSE_STATUS).map(([k, v]) => (
                          <button key={k} onClick={() => updateCourseStatus(si, ci, k)} style={{ padding: "2px 8px", cursor: "pointer", fontSize: 8, letterSpacing: 1, background: c.status === k ? v.color + "22" : "transparent", color: c.status === k ? v.color : T.dim, border: `1px solid ${c.status === k ? v.color : T.dim}`, fontFamily: "monospace" }}>{v.label}</button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* REQUIREMENTS */}
        {tab === "requirements" && (
          <div>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 4 }}>
              <div style={{ ...S.card, flex: 1, minWidth: 240 }}>
                <div style={S.label}>Credits Verified</div>
                {[["AP transfer", 32, T.blue], ["UM-Flint Fall '25 (3.92)", 15, T.green], ["Mott (non-duplicate)", 9, T.yellow], ["Mott Fall '26 (planned)", 11, T.muted]].map(([l, v, c]) => (
                  <div key={l} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 4 }}><span style={{ color: T.muted }}>{l}</span><span style={{ color: c }}>{v} cr</span></div>
                ))}
                <div style={{ borderTop: `1px solid ${T.border}`, marginTop: 8, paddingTop: 8, display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                  <span style={{ color: T.white }}>Entering Winter '27</span><span style={{ color: T.green, fontFamily: "Impact,sans-serif" }}>67 / 120</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginTop: 4 }}>
                  <span style={{ color: T.muted }}>Upper-division (300+)</span><span style={{ color: T.yellow }}>{UPPER_DIVISION_HAVE} / {UPPER_DIVISION_NEEDED}</span>
                </div>
              </div>
              <div style={{ ...S.card, flex: 2, minWidth: 280 }}>
                <div style={S.label}>This Week — Action Items</div>
                <ol style={{ margin: 0, paddingLeft: 18, fontSize: 10.5, color: T.white, lineHeight: 1.9 }}>
                  {ACTION_ITEMS.map((a, i) => <li key={i}>{a}</li>)}
                </ol>
                <div style={{ marginTop: 12, display: "flex", gap: 16, flexWrap: "wrap" }}>
                  {KEY_CONTACTS.map((c) => (
                    <div key={c.name} style={{ fontSize: 9, color: T.muted }}><span style={{ color: T.blue }}>{c.name}</span> · {c.role}<br />{c.info}</div>
                  ))}
                </div>
              </div>
            </div>

            {REQUIREMENTS.map((req) => (
              <div key={req.group} style={{ ...S.card, borderLeft: `3px solid ${REQ_COLOR[req.status]}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                  <span style={{ fontFamily: "Impact,sans-serif", fontSize: 16, color: T.white, letterSpacing: 1 }}>{req.group}</span>
                  <span style={{ fontSize: 9, color: REQ_COLOR[req.status], letterSpacing: 2, border: `1px solid ${REQ_COLOR[req.status]}`, padding: "2px 8px" }}>{req.required}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {req.items.map((it, i) => (
                    <div key={i} style={{ display: "flex", gap: 8, alignItems: "baseline", padding: "5px 8px", background: T.bg, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 11 }}>{REQ_MARK[it.status]}</span>
                      <span style={{ flex: 1, minWidth: 180, fontSize: 11, color: it.status === "gap" ? T.white : T.muted }}>{it.name}</span>
                      <span style={{ fontSize: 9, color: T.muted }}>{it.cr} cr</span>
                      {it.note && <span style={{ fontSize: 9, color: REQ_COLOR[it.status], minWidth: 120 }}>{it.note}</span>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* TIMELINE */}
        {tab === "timeline" && (
          <div>
            <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
              {[["all", "ALL", "#555"], ...Object.entries(CAT_META).map(([k, v]) => [k, v.label, v.color])].map(([k, l, c]) => (
                <button key={k} style={S.btn(catFilter === k ? c : T.dim)} onClick={() => setCatFilter(k)}>{l}</button>
              ))}
              <button style={{ ...S.btn(T.green), marginLeft: "auto" }} onClick={() => setShowAddEvent(true)}>+ ADD EVENT</button>
            </div>
            {showAddEvent && (
              <div style={{ ...S.card, border: `1px solid ${T.green}`, marginBottom: 16 }}>
                <div style={S.label}>Add Timeline Event</div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {[["Year", "year", "number"], ["Month", "month", "text"], ["Icon", "icon", "text"], ["Title", "title", "text"]].map(([l, k, t]) => (
                    <div key={k} style={{ flex: 1, minWidth: 120 }}>
                      <div style={{ fontSize: 9, color: T.muted, marginBottom: 4, letterSpacing: 2 }}>{l}</div>
                      <input type={t} value={newEvent[k]} onChange={(e) => setNewEvent((p) => ({ ...p, [k]: t === "number" ? parseInt(e.target.value) || 0 : e.target.value }))} style={S.input} />
                    </div>
                  ))}
                  <div style={{ flex: 1, minWidth: 120 }}>
                    <div style={{ fontSize: 9, color: T.muted, marginBottom: 4, letterSpacing: 2 }}>CATEGORY</div>
                    <select value={newEvent.cat} onChange={(e) => setNewEvent((p) => ({ ...p, cat: e.target.value }))} style={S.input}>
                      {Object.entries(CAT_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </select>
                  </div>
                </div>
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 9, color: T.muted, marginBottom: 4, letterSpacing: 2 }}>DESCRIPTION</div>
                  <input value={newEvent.desc} onChange={(e) => setNewEvent((p) => ({ ...p, desc: e.target.value }))} style={S.input} />
                </div>
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 9, color: T.muted, marginBottom: 4, letterSpacing: 2 }}>ESSAY NOTES (the scholarship angle)</div>
                  <textarea value={newEvent.essay} onChange={(e) => setNewEvent((p) => ({ ...p, essay: e.target.value }))} style={{ ...S.input, minHeight: 60, resize: "vertical" }} />
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  <button style={S.btn(T.green)} onClick={addEvent}>SAVE EVENT</button>
                  <button style={S.btn(T.muted)} onClick={() => setShowAddEvent(false)}>CANCEL</button>
                </div>
              </div>
            )}
            <div style={{ position: "relative", paddingLeft: 28 }}>
              <div style={{ position: "absolute", left: 12, top: 0, bottom: 0, width: 2, background: T.border }} />
              {filteredTimeline.map((e) => {
                const c = CAT_META[e.cat]?.color || T.muted;
                const isFuture = e.cat === "future";
                return (
                  <div key={e.id} style={{ position: "relative", marginBottom: 20 }}>
                    <div style={{ position: "absolute", left: -22, top: 10, width: 12, height: 12, borderRadius: "50%", background: isFuture ? T.bg : c, border: `2px solid ${c}`, zIndex: 1 }} />
                    <div style={{ ...S.card, borderLeft: `3px solid ${c}`, opacity: isFuture ? 0.65 : 1, marginBottom: 0 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 6 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap", marginBottom: 4 }}>
                            <span style={{ fontSize: 18 }}>{e.icon}</span>
                            <span style={{ fontFamily: "Impact,sans-serif", fontSize: 16, color: T.white, letterSpacing: 1 }}>{e.title}</span>
                            <span style={{ fontSize: 9, color: c, letterSpacing: 3, border: `1px solid ${c}`, padding: "1px 6px" }}>{CAT_META[e.cat]?.label}</span>
                          </div>
                          <div style={{ fontSize: 10, color: T.muted, marginBottom: e.essay ? 8 : 0 }}>{e.desc}</div>
                          {e.essay && <div style={{ fontSize: 10, color: T.yellow, lineHeight: 1.6, padding: "6px 10px", background: T.yellow + "11", borderLeft: `2px solid ${T.yellow}` }}>{e.essay}</div>}
                        </div>
                        <div style={{ textAlign: "right", minWidth: 80 }}>
                          <div style={{ fontFamily: "Impact,sans-serif", fontSize: 20, color: isFuture ? T.muted : T.white }}>{e.year}</div>
                          {e.month && <div style={{ fontSize: 9, color: T.muted, letterSpacing: 2 }}>{e.month}</div>}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* SCHOLARSHIPS */}
        {tab === "scholarships" && (
          <div>
            {SCOUT_SCHOLARSHIPS.length > 0 && (
              <div style={{ fontSize: 9, color: T.muted, letterSpacing: 2, marginBottom: 10 }}>
                SCOUT LAST RUN: {new Date(SCOUT_GENERATED_AT).toLocaleDateString()} · {SCOUT_SCHOLARSHIPS.length} IMPORTED ·{" "}
                <span style={{ color: T.blue }}>bun scout/scout.ts --emit-app</span> to refresh
              </div>
            )}
            <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
              {[["all", "ALL"], ...STATUS_OPTIONS.map((s) => [s.value, s.label])].map(([k, l]) => {
                const c = STATUS_META[k]?.color || T.muted;
                const count = k === "all" ? scholarships.length : scholarships.filter((s) => s.status === k).length;
                return <button key={k} style={S.btn(schFilter === k ? c : T.dim)} onClick={() => setSchFilter(k)}>{l} ({count})</button>;
              })}
            </div>
            {scholarships
              .filter((s) => schFilter === "all" || s.status === schFilter)
              .slice()
              .sort((a, b) => (STATUS_META[a.status]?.sort ?? 9) - (STATUS_META[b.status]?.sort ?? 9))
              .map((s) => (
                <div key={s.id} style={{ ...S.card, borderLeft: `3px solid ${STATUS_META[s.status]?.color || T.muted}`, marginBottom: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 220 }}>
                      <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                        <span style={{ fontSize: 13, color: T.white, fontWeight: "bold" }}>{s.name}</span>
                        <span style={{ fontSize: 9, color: T.muted, letterSpacing: 2 }}>{s.org}</span>
                        {s.source === "scout" && (
                          <span style={{ fontSize: 8, color: T.blue, border: `1px solid ${T.blue}`, borderRadius: 3, padding: "1px 5px", letterSpacing: 1 }}>
                            SCOUT{typeof s.match === "number" ? ` ${s.match}%` : ""}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 10, color: T.muted, marginTop: 4, lineHeight: 1.6 }}>{s.notes}</div>
                      <div style={{ fontSize: 9, color: T.muted, marginTop: 4 }}>DEADLINE: {s.deadline}{s.url ? <> · <a href={s.url} target="_blank" rel="noreferrer" style={{ color: T.blue }}>link ↗</a></> : null}</div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, minWidth: 120 }}>
                      <div style={{ fontFamily: "Impact,sans-serif", fontSize: 22, color: T.green }}>{usd(s.amount)}</div>
                      <div style={{ display: "flex", gap: 3, flexWrap: "wrap", justifyContent: "flex-end" }}>
                        {["apply", "applied", "won", "rejected"].map((k) => (
                          <button key={k} style={S.btn(s.status === k ? STATUS_META[k].color : T.dim)} onClick={() => updateSchStatus(s.id, k)}>{k.toUpperCase()}</button>
                        ))}
                      </div>
                      <button style={S.btn(T.blue)} onClick={() => { setEssaySch(s.id); setTab("essay"); }}>ESSAY →</button>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        )}

        {/* AI ESSAYS */}
        {tab === "essay" && (
          <div style={{ maxWidth: 720 }}>
            <div style={S.card}>
              <div style={S.label}>AI Essay Generator — Secure backend (Haiku/Sonnet)</div>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 9, color: T.muted, letterSpacing: 3, marginBottom: 6 }}>SELECT SCHOLARSHIP</div>
                <select value={essaySch} onChange={(e) => setEssaySch(e.target.value)} style={S.input}>
                  <option value="">— select from your list —</option>
                  {scholarships.map((s) => <option key={s.id} value={s.id}>{s.name} ({usd(s.amount)})</option>)}
                </select>
              </div>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 9, color: T.muted, letterSpacing: 3, marginBottom: 6 }}>ADDITIONAL CONTEXT / PROMPT</div>
                <textarea value={essayPrompt} onChange={(e) => setEssayPrompt(e.target.value)} placeholder="Paste the form's essay question, word limit, or angle to emphasize…" style={{ ...S.input, minHeight: 60, resize: "vertical" }} />
              </div>
              <button onClick={generateEssay} disabled={essayLoading || (!essaySch && !essayPrompt)} style={{ padding: "10px 24px", cursor: "pointer", fontSize: 11, letterSpacing: 3, background: essayLoading ? T.dim : T.red, color: T.white, border: "none", fontFamily: "monospace" }}>
                {essayLoading ? "GENERATING..." : "GENERATE ESSAY"}
              </button>
            </div>
            {essayOut && (
              <div style={S.card}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                  <div style={S.label}>Generated Essay</div>
                  <button style={S.btn(T.green)} onClick={() => navigator.clipboard.writeText(essayOut)}>COPY</button>
                </div>
                <div style={{ fontSize: 12, lineHeight: 1.9, color: T.white, whiteSpace: "pre-wrap" }}>{essayOut}</div>
              </div>
            )}
            <div style={{ ...S.card, opacity: 0.6 }}>
              <div style={S.label}>Story bank baked into every essay</div>
              <div style={{ fontSize: 10, color: T.muted, lineHeight: 1.8 }}>
                Every Timeline event with essay notes (Black Belt → discipline, Eagle Scout → leadership,
                state wrestling → performance under pressure, the MRI moment → computational-oncology origin)
                is automatically included. Add events on the Timeline tab to expand it.
              </div>
            </div>
          </div>
        )}

        {/* APPLY QUEUE */}
        {tab === "queue" && (
          <div>
            <div style={{ ...S.card, borderLeft: `3px solid ${T.green}` }}>
              <div style={S.label}>Batch Drafting — token-minimal (Haiku default, Sonnet for critical)</div>
              <div style={{ fontSize: 10, color: T.muted, lineHeight: 1.7, marginBottom: 12 }}>
                Drafts an essay for every scholarship you're pursuing ({pursuing.length}). ~$0.50 / 100 essays.
                Nothing is submitted — approve, then "Copy for Chrome" and fill via Claude for Chrome.
                Set a hard spend cap in the Anthropic console.
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <button onClick={generateBatch} disabled={batchLoading || !pursuing.length} style={{ padding: "10px 20px", cursor: "pointer", fontSize: 10, letterSpacing: 2, background: batchLoading ? T.dim : T.green, color: T.bg, border: "none", fontFamily: "monospace", fontWeight: "bold" }}>
                  {batchLoading ? "DRAFTING..." : `GENERATE BATCH (${pursuing.length})`}
                </button>
                <span style={{ fontSize: 9, color: T.muted }}>est. {fmtUsd(estimateBatchCost(pursuing))}</span>
                {batchMsg && <span style={{ fontSize: 10, color: batchMsg.startsWith("⚠") ? T.yellow : T.green }}>{batchMsg}</span>}
              </div>
            </div>
            {drafted.length === 0 ? (
              <div style={{ ...S.card, color: T.muted, fontSize: 11 }}>No drafts yet. Hit GENERATE BATCH.</div>
            ) : drafted.map((s) => (
              <div key={s.id} style={{ ...S.card, borderLeft: `3px solid ${s.approved ? T.green : T.dim}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 12, color: T.white, fontWeight: "bold" }}>{s.name}</span>
                  <span style={{ fontSize: 9, color: T.muted }}>
                    {s.approved && <span style={{ color: T.green }}>✅ APPROVED · </span>}
                    {s.draftModel?.includes("sonnet") ? "Sonnet" : "Haiku"} · {s.draftWords} words
                  </span>
                </div>
                <textarea value={s.draftEssay} onChange={(e) => patchSch(s.id, { draftEssay: e.target.value, draftWords: e.target.value.trim().split(/\s+/).length })} style={{ ...S.input, minHeight: 140, resize: "vertical", lineHeight: 1.7 }} />
                <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                  <button style={S.btn(s.approved ? T.muted : T.green)} onClick={() => patchSch(s.id, { approved: !s.approved })}>{s.approved ? "UN-APPROVE" : "APPROVE"}</button>
                  <button style={S.btn(T.blue)} onClick={() => copyForChrome(s)}>{s.copied ? "COPIED ✓" : "COPY FOR CHROME"}</button>
                  <button style={S.btn(T.red)} onClick={() => patchSch(s.id, { draftEssay: "", approved: false })}>DISCARD</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
