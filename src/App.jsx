import { useEffect, useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { useLocalStorage } from "./hooks/useLocalStorage";
import { semesterFinancials } from "./data/semesters";
import { INIT_TIMELINE, CAT_META } from "./data/timeline";
import { PATHWAY_DATA, COURSE_STATUS, ALREADY_HAVE, DEGREE_TOTAL, UPPER_DIVISION_NEEDED, UPPER_DIVISION_HAVE, GRAD_TARGET } from "./data/pathway";
import { REQUIREMENTS, ACTION_ITEMS, KEY_CONTACTS, VERIFIED_CREDITS } from "./data/requirements";
import { DEFAULT_SCHOLARSHIPS, STATUS_OPTIONS } from "./data/defaults";
import { SCOUT_SCHOLARSHIPS, SCOUT_GENERATED_AT } from "./data/scoutFound";
import { APPLY_KITS } from "./data/essays";
import { INTERVENTIONS, INTERVENTIONS_GENERATED_AT } from "./data/interventions";
import { fullProfile, fieldsBlock } from "./data/profile";
import { buildLegacyPrompt } from "./lib/legacyPrompt";
import { estimateBatchCost, fmtUsd } from "./lib/essayCost";
import { WORKFLOW_STATES, WORKFLOW_LABELS, EVIDENCE_STATUS, normalizeScholarship, expectedBenefit, advance, prioritize } from "./lib/scholarshipWorkflow";
import "./index.css";

const usd = (n) => (n >= 1000 ? `$${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K` : `$${n.toLocaleString()}`);
const fullUsd = (n) => `$${Math.round(n).toLocaleString()}`;
const slugOf = (name) => (name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);

// /api/* is bearer-gated server-side (server.ts). The token is a shared secret for a single-user
// deploy, not a per-user credential — it stops a stranger who finds the URL from spending the
// Anthropic budget. Build-time env, so it ships in the bundle; keep the deploy private.
const apiHeaders = () => ({
  "content-type": "application/json",
  ...(import.meta.env.VITE_APP_TOKEN ? { authorization: `Bearer ${import.meta.env.VITE_APP_TOKEN}` } : {}),
});

const STATUS_META = Object.fromEntries(STATUS_OPTIONS.map((s) => [s.value, s]));
const PURSUING = ["apply", "research", "applied"];

// Timeline months mix explicit month abbreviations ("Jan") and academic-term names
// ("Fall"). Plain string sort puts "Fall" before "Spring" alphabetically, which is
// wrong within a year — rank both onto the same numeric axis instead.
const MONTH_RANK = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11, Winter: 0, Spring: 3, Summer: 6, Fall: 9 };
const monthRank = (m) => (m ? MONTH_RANK[m] ?? 0 : -1);

export default function CollegePathway() {
  const [tab, setTab] = useState("dashboard");
  const [inState, setInState] = useState(true);
  // v3 adds `canonicalState` alongside the legacy `workflowState`. normalizeScholarship derives it
  // from whichever vocabulary a record already speaks, so the v2 blob upconverts losslessly and
  // the v2 key is left untouched in case the migration needs undoing by hand.
  const [scholarships, setScholarships] = useLocalStorage(
    "ccp_scholarships_v3",
    DEFAULT_SCHOLARSHIPS.map(normalizeScholarship),
    { fromKey: "ccp_scholarships_v2", convert: (rows) => (Array.isArray(rows) ? rows.map(normalizeScholarship) : rows) },
  );
  // The checkpoint queue is NOT localStorage state. It is a projection of the event log, which a
  // Bun process must be able to read back — the agent needs the human's answer. The generated
  // module is the static fallback; when server.ts is reachable we prefer the live endpoint.
  const [openCheckpoints, setOpenCheckpoints] = useState(INTERVENTIONS);
  const [queueLive, setQueueLive] = useState(false);
  const [queueBusy, setQueueBusy] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/queue", { headers: apiHeaders() })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("no backend"))))
      .then((d) => { if (!cancelled && Array.isArray(d.queue)) { setOpenCheckpoints(d.queue); setQueueLive(true); } })
      .catch(() => { /* static build — the generated file already loaded */ });
    return () => { cancelled = true; };
  }, []);

  async function resolveCheckpoint(cp, resolution) {
    if (!queueLive) return;
    setQueueBusy(cp.checkpointId);
    try {
      const res = await fetch(`/api/queue/${encodeURIComponent(cp.checkpointId)}/resolve`, {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify({ resolution, resolvedBy: "colin" }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "resolve failed");
      setOpenCheckpoints((prev) => prev.filter((x) => x.checkpointId !== cp.checkpointId));
    } catch (e) {
      alert(`Could not resolve: ${e instanceof Error ? e.message : e}`);
    }
    setQueueBusy("");
  }

  const [timeline, setTimeline] = useLocalStorage("ccp_timeline_v3", INIT_TIMELINE);
  const [pathway, setPathway] = useLocalStorage("ccp_pathway_v4", PATHWAY_DATA);
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
  const [copiedPrompt, setCopiedPrompt] = useState(false);

  // Merge scout finds (src/data/scoutFound.js) into the localStorage-backed list.
  // Scout ids are stable slugs, so re-runs only add genuinely new scholarships and
  // the user's status/amount edits on existing ones persist.
  useEffect(() => {
    setScholarships((prev) => {
      const normalized = prev.map(normalizeScholarship);
      const fresh = SCOUT_SCHOLARSHIPS.filter((s) => !normalized.some((p) => p.id === s.id)).map(normalizeScholarship);
      return [...normalized, ...fresh];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── computed financials ──
  const wonAmt = scholarships.filter((s) => s.status === "won").reduce((a, s) => a + Number(s.amount || 0), 0);
  const pellSch = scholarships.find((s) => s.id === "sc_pell");
  const pellLocked = !!pellSch && !["apply", "research"].includes(pellSch.status);
  const fin = useMemo(() => semesterFinancials(inState, wonAmt), [inState, wonAmt]);
  const { rows: semData, totalCost, totalPell, totalOther, totalFunded, gap } = fin;

  // ALREADY_HAVE (56) already includes the "Done" block (AP + Fall '25). Only count newly
  // completed credits from forward semesters so the tally doesn't double-count.
  const completedCredits = pathway
    .filter((s) => s.status !== "completed")
    .flatMap((s) => s.courses)
    .filter((c) => c.status === "completed" && c.countTowardDegree !== false)
    .reduce((a, c) => a + c.cr, 0);
  const optionalCredits = pathway
    .filter((s) => s.status !== "completed")
    .flatMap((s) => s.courses)
    .filter((c) => c.status === "completed" && c.countTowardDegree === false)
    .reduce((a, c) => a + c.cr, 0);
  const haveCredits = ALREADY_HAVE + completedCredits;

  const filteredTimeline = timeline
    .filter((e) => catFilter === "all" || e.cat === catFilter)
    .slice()
    .sort((a, b) => a.year - b.year || monthRank(a.month) - monthRank(b.month));

  const drafted = scholarships.filter((s) => s.draftEssay);
  const pursuing = scholarships.filter((s) => ["prepared", "needs-review"].includes(s.workflowState) || PURSUING.includes(s.status));

  // ── actions ──
  async function generateEssay() {
    setEssayLoading(true); setEssayOut("");
    const sc = scholarships.find((s) => s.id === essaySch);
    try {
      const res = await fetch("/api/draft", {
        method: "POST",
        headers: apiHeaders(),
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
        headers: apiHeaders(),
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

  const patchSch = (id, fields) => setScholarships((prev) => prev.map((s) => (s.id === id ? normalizeScholarship({ ...s, ...fields }) : s)));
  const updateSchStatus = (id, status) => patchSch(id, {
    status,
    ...(status === "applied" ? { workflowState: "submitted" } : {}),
    ...(status === "pending" ? { workflowState: "confirmed" } : {}),
    ...(status === "won" || status === "rejected" ? { workflowState: "won/rejected" } : {}),
  });
  const updateWorkflow = (id, next) => setScholarships((prev) => prev.map((s) => {
    if (s.id !== id) return s;
    const result = advance(normalizeScholarship(s), next);
    if (result.error) {
      window.alert(result.error);
      return s;
    }
    return normalizeScholarship(result.scholarship);
  }));
  const markPrioritized = (s) => patchSch(s.id, prioritize(normalizeScholarship(s)));
  const updateCourseStatus = (si, ci, status) => setPathway((prev) => prev.map((s, i) => i !== si ? s : { ...s, courses: s.courses.map((c, j) => j !== ci ? c : { ...c, status }) }));

  async function copyForChrome(s) {
    const kit = APPLY_KITS[slugOf(s.name)];
    const essay = kit?.essay || s.draftEssay || "";
    const warn = [];
    if (kit?.applicationFee) warn.push("⚠ An application/processing FEE was detected — do NOT pay. Legitimate scholarships don't charge to apply; verify before continuing.");
    if (kit?.loginRequired) warn.push("🔒 This platform needs a login/account — sign in first, then run this on the actual application page.");
    if (kit?.essayRequired) warn.push(`✍ This form has an essay field${kit?.essayWordLimit ? ` (~${kit.essayWordLimit} words)` : ""} — the essay below is pre-written; trim to the form's limit.`);
    const applyLine = kit?.applyUrl ? `APPLICATION URL: ${kit.applyUrl}` : (s.url ? `START URL (find the application link here): ${s.url}` : "");
    const text = [
      `You are assisting with a College Board BigFuture scholarship application on the current page. Use only facts explicitly present in MY INFO or confirmed by me. Never guess, infer, embellish, or claim an eligibility fact that is not verified. Fill only fields supported by those facts, flag everything else, then STOP at the final review screen. I will personally review attestations and click submit. If the page is not a BigFuture application, charges a fee, asks for a password, SSN, bank/payment information, or redirects to a paid service, STOP immediately.`,
      ``, `SCHOLARSHIP: ${s.name}${s.amount ? ` ($${Number(s.amount).toLocaleString()})` : ""}`,
      applyLine,
      warn.length ? `\n${warn.join("\n")}` : ``,
      ``, `MY INFO (for contact fields — email/phone/DOB/address — use my saved "Apply to Scholarship" shortcut profile):`, fieldsBlock(),
      ``, `ESSAY (pre-written in my voice — trim to the form's word limit; never invent facts):`,
      essay || "(no essay yet — draft one on the AI Essays tab first)",
    ].filter(Boolean).join("\n");
    await navigator.clipboard.writeText(text);
    patchSch(s.id, { copied: true });
    setTimeout(() => patchSch(s.id, { copied: false }), 1500);
  }

  function addEvent() {
    const id = timeline.reduce((m, e) => Math.max(m, e.id), 0) + 1;
    setTimeline((prev) => [...prev, { ...newEvent, id }]);
    setShowAddEvent(false);
    setNewEvent({ year: 2026, month: "", title: "", desc: "", cat: "academic", icon: "⭐", essay: "" });
  }

  const TABS = [["dashboard", "DASHBOARD"], ["pathway", "PATHWAY"], ["requirements", "REQUIREMENTS"], ["timeline", "TIMELINE"], ["scholarships", "SCHOLARSHIPS"], ["essay", "AI ESSAYS"], ["queue", "APPLY QUEUE"], ["interventions", `NEEDS YOU${openCheckpoints.length ? ` (${openCheckpoints.length})` : ""}`]];

  const REQ_COLOR = { done: "green", partial: "yellow", gap: "red" };
  const REQ_MARK = { done: "✅", partial: "🟡", gap: "❌" };

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-inner">
          <div className="logo">
            <span className="logo-icon">🎓</span>
            <span className="logo-text">COLIN'S COLLEGE PATHWAY</span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", letterSpacing: 1 }}>TUITION:</span>
            {["IN-STATE", "OUT-OF-STATE"].map((l, i) => (
              <button 
                key={l} 
                className={`btn btn-sm ${inState === (i === 0) ? "btn-green" : ""}`} 
                onClick={() => setInState(i === 0)}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
      </header>

      <nav className="app-nav">
        {TABS.map(([id, label]) => (
          <button 
            key={id} 
            className={`nav-btn ${tab === id ? "active" : ""}`} 
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      <main className="app-main">
        {/* METRICS Persistent Summary Bar */}
        <div className="card-grid" style={{ marginBottom: "2rem" }}>
          {[
            ["5-YR COST", fullUsd(totalCost), ""],
            [`PELL+INST${pellLocked ? " 🔒" : ""}`, fullUsd(totalPell + totalOther), "blue"],
            ["SCHOLARSHIPS", fullUsd(wonAmt), "green"],
            ["TOTAL FUNDED", fullUsd(totalFunded), "green"],
            ["GAP", fullUsd(gap), gap > 0 ? "red" : "green"],
            ["CREDITS", `${haveCredits}/${DEGREE_TOTAL}`, "blue"],
          ].map(([l, v, c]) => (
            <div key={l} className={`card ${c ? `card-${c}` : ""}`}>
              <div className="card-label">{l}</div>
              <div className="card-value">{v}</div>
            </div>
          ))}
        </div>

        {/* DASHBOARD TAB */}
        {tab === "dashboard" && (
          <div className="page">
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <div className="card" style={{ flex: 2, minWidth: 280 }}>
                <div className="card-label">Cost vs Funding by Semester</div>
                <div style={{ width: "100%", height: 200, marginTop: 12 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={semData.map((s) => ({ name: s.label, Funded: s.funded, Gap: s.gap }))} barSize={18} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                      <XAxis dataKey="name" stroke="var(--text-muted)" tick={{ fontSize: 9, fill: "var(--text-muted)" }} />
                      <YAxis stroke="transparent" tick={{ fontSize: 9, fill: "var(--text-muted)" }} tickFormatter={(v) => `$${v / 1000}K`} />
                      <Tooltip 
                        contentStyle={{ 
                          background: "var(--surface)", 
                          border: `1px solid var(--border)`, 
                          borderRadius: "var(--radius)",
                          fontSize: 11, 
                          color: "var(--text)",
                          fontFamily: "inherit" 
                        }} 
                        formatter={(v, n) => [fullUsd(v), n]} 
                      />
                      <Bar dataKey="Funded" stackId="a" fill="var(--green)" isAnimationActive={false} />
                      <Bar dataKey="Gap" stackId="a" fill="var(--red)" isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div style={{ display: "flex", gap: 16, marginTop: 12 }}>
                  <span className="green" style={{ fontSize: "0.8rem", fontWeight: "bold" }}>■ FUNDED</span>
                  <span className="red" style={{ fontSize: "0.8rem", fontWeight: "bold" }}>■ GAP</span>
                </div>
              </div>
              <div className="card" style={{ flex: 1, minWidth: 200 }}>
                <div className="card-label">Funding Stack</div>
                <div style={{ marginTop: 12 }}>
                  {[[`Pell Grant${pellLocked ? " 🔒" : ""}`, totalPell, "blue"], ["Institutional Aid", totalOther, "yellow"], ["Scholarships Won", wonAmt, "green"], ["Remaining Gap", gap, gap > 0 ? "red" : "green"]].map(([l, v, c]) => (
                    <div key={l} style={{ marginBottom: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                        <span style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>{l}</span>
                        <span className={c} style={{ fontSize: "0.82rem", fontWeight: "bold" }}>{fullUsd(v)}</span>
                      </div>
                      <div className="progress-bar" style={{ height: 6 }}>
                        <div 
                          className={`progress-fill ${c === "green" ? "green-fill" : c === "blue" ? "blue-fill" : ""}`} 
                          style={{ 
                            width: `${Math.min(100, (v / totalCost) * 100)}%`,
                            background: c === "yellow" ? "var(--yellow)" : c === "red" ? "var(--red)" : undefined 
                          }} 
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <div className={`alert ${gap > 5000 ? "alert-yellow" : gap > 0 ? "alert-yellow" : "alert-green"}`} style={{ marginTop: 16, padding: "10px 12px" }}>
                  <div style={{ fontSize: "0.85rem", fontWeight: "bold" }}>
                    {gap > 15000 ? "🔴 Win in-state tuition ASAP" : gap > 5000 ? "🟡 Barry Goldwater + Go Blue Guarantee closes this" : gap > 0 ? "🟡 A few scholarships closes the gap" : "🟢 Fully funded — keep applying anyway"}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* PATHWAY TAB */}
        {tab === "pathway" && (
          <div className="page">
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-label">Degree Progress</div>
              <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 12, marginTop: 12 }}>
                {[["ALREADY HAVE", ALREADY_HAVE, "green"], ["COMPLETED", completedCredits, "blue"], ["REMAINING", DEGREE_TOTAL - haveCredits, "red"], ["DEGREE TOTAL", DEGREE_TOTAL, "text"]].map(([l, v, c]) => (
                  <div key={l}>
                    <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", letterSpacing: 1 }}>{l}</span>
                    <div className={c !== "text" ? c : ""} style={{ fontSize: "1.8rem", fontWeight: 800 }}>{v} cr</div>
                  </div>
                ))}
              </div>
              <div className="progress-bar" style={{ height: 8 }}>
                <div 
                  className="progress-fill" 
                  style={{ 
                    width: `${Math.min(100, (haveCredits / DEGREE_TOTAL) * 100)}%`,
                    background: `linear-gradient(90deg, var(--green), var(--blue))`
                  }} 
                />
              </div>
              <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 8, letterSpacing: 0.5 }}>{Math.round((haveCredits / DEGREE_TOTAL) * 100)}% TOWARD BS CELLULAR & MOLECULAR BIOLOGY · GRAD TARGET {GRAD_TARGET.toUpperCase()}</div>
              <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 4, letterSpacing: 0.5 }}>OPTIONAL SUPPORT: <span className="yellow" style={{ fontWeight: "bold" }}>{optionalCredits} cr</span> · counted credits exclude anything marked optional</div>
              <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 4, letterSpacing: 0.5 }}>UPPER-DIVISION (300+): <span className={UPPER_DIVISION_HAVE >= UPPER_DIVISION_NEEDED ? "green" : "yellow"} style={{ fontWeight: "bold" }}>{UPPER_DIVISION_HAVE}/{UPPER_DIVISION_NEEDED}</span> · most core BIO/CHM/CSC courses ahead are 300+</div>
            </div>
            {pathway.map((sem, si) => (
              <div key={sem.sem} className="card" style={{ marginBottom: 16, borderLeft: `4px solid ${sem.status === "current" ? "var(--green)" : "var(--border)"}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                  <div>
                    <h3 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text)" }}>{sem.sem}</h3>
                    <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{sem.school} · {sem.courses.reduce((a, c) => a + c.cr, 0)} credits</div>
                  </div>
                  <span className={`badge ${sem.status === "current" ? "badge-green" : "badge-gray"}`}>{sem.status.toUpperCase()}</span>
                </div>
                {sem.note && <div className="alert alert-yellow" style={{ margin: "0 0 12px 0", padding: "8px 12px", fontSize: "0.85rem" }}>{sem.note}</div>}
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {sem.courses.map((c, ci) => (
                    <div key={ci} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "var(--surface2)", borderRadius: "var(--radius)", flexWrap: "wrap" }}>
                      <div style={{ flex: 1, minWidth: 200 }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                          <span className="red" style={{ fontSize: "0.85rem", fontWeight: "bold" }}>{c.code}</span>
                          <span style={{ color: "var(--text)", fontSize: "0.9rem" }}>{c.name}</span>
                          <span style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>{c.cr} cr</span>
                          {c.grade && <span className="badge badge-green" style={{ padding: "0.1rem 0.4rem" }}>{c.grade}</span>}
                          {c.countTowardDegree === false && <span className="badge badge-yellow" style={{ padding: "0.1rem 0.4rem" }}>OPTIONAL</span>}
                        </div>
                        <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 2 }}>{c.req}</div>
                      </div>
                      <div style={{ display: "flex", gap: 4 }}>
                        {Object.entries(COURSE_STATUS).map(([k, v]) => (
                          <button 
                            key={k} 
                            onClick={() => updateCourseStatus(si, ci, k)} 
                            className="btn btn-sm"
                            style={{ 
                              padding: "2px 6px", 
                              fontSize: "0.75rem",
                              borderColor: c.status === k ? v.color : "var(--border)",
                              color: c.status === k ? v.color : "var(--text-muted)",
                              background: c.status === k ? `${v.color}22` : "transparent"
                            }}
                          >
                            {v.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* REQUIREMENTS TAB */}
        {tab === "requirements" && (
          <div className="page">
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
              <div className="card" style={{ flex: 1, minWidth: 240 }}>
                <div className="card-label">Credits Verified</div>
                <div style={{ marginTop: 12 }}>
                  {[["AP transfer", 32, "blue"], ["UM-Flint Fall '25 (3.92)", 15, "green"], ["Mott Winter '26 (non-dup)", 9, "yellow"], ["Mott Fall '26 (enrolled)", 13, "text-muted"], ["Mott Winter '27 residency", 8, "text-muted"]].map(([l, v, c]) => (
                    <div key={l} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", marginBottom: 6 }}>
                      <span style={{ color: "var(--text-muted)" }}>{l}</span>
                      <span style={{ color: c === "text-muted" ? "var(--text-muted)" : `var(--${c})`, fontWeight: "bold" }}>{v} cr</span>
                    </div>
                  ))}
                </div>
                <div style={{ borderTop: `1px solid var(--border)`, marginTop: 10, paddingTop: 10, display: "flex", justifyContent: "space-between", fontSize: "0.9rem" }}>
                  <span style={{ color: "var(--text)" }}>Entering Fall '27</span>
                  <span className="green" style={{ fontWeight: "bold" }}>{VERIFIED_CREDITS.total_entering_f27} / 120</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", marginTop: 4 }}>
                  <span style={{ color: "var(--text-muted)" }}>Upper-division (300+)</span>
                  <span className="yellow" style={{ fontWeight: "bold" }}>{UPPER_DIVISION_HAVE} / {UPPER_DIVISION_NEEDED}</span>
                </div>
              </div>
              <div className="card" style={{ flex: 2, minWidth: 280 }}>
                <div className="card-label">This Week — Action Items</div>
                <ol style={{ margin: "12px 0 0 0", paddingLeft: 18, fontSize: "0.9rem", color: "var(--text)", lineHeight: 1.8 }}>
                  {ACTION_ITEMS.map((a, i) => <li key={i}>{a}</li>)}
                </ol>
                <div style={{ marginTop: 16, display: "flex", gap: 16, flexWrap: "wrap", borderTop: `1px solid var(--border)`, paddingTop: 12 }}>
                  {KEY_CONTACTS.map((c) => (
                    <div key={c.name} style={{ fontSize: "0.8rem", color: "var(--text-muted)", lineHeight: 1.4 }}>
                      <span className="blue" style={{ fontWeight: "bold" }}>{c.name}</span> · {c.role}<br />{c.info}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {REQUIREMENTS.map((req) => (
              <div key={req.group} className="card" style={{ marginBottom: 16, borderLeft: `4px solid var(--${REQ_COLOR[req.status]})` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                  <span style={{ fontSize: "1.1rem", fontWeight: "bold", color: "var(--text)" }}>{req.group}</span>
                  <span className={`badge badge-${REQ_COLOR[req.status]}`}>{req.required}</span>
                </div>
                {req.note && <div className="alert alert-yellow" style={{ margin: "0 0 10px 0", padding: "8px 12px", fontSize: "0.85rem" }}>{req.note}</div>}
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {req.items.map((it, i) => (
                    <div key={i} style={{ display: "flex", gap: 8, alignItems: "baseline", padding: "6px 10px", background: "var(--surface2)", borderRadius: "var(--radius)", flexWrap: "wrap" }}>
                      <span style={{ fontSize: "0.9rem" }}>{REQ_MARK[it.status]}</span>
                      <span style={{ flex: 1, minWidth: 180, fontSize: "0.88rem", color: it.status === "gap" ? "var(--text)" : "var(--text-muted)" }}>{it.name}</span>
                      <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{it.cr} cr</span>
                      {it.note && <span className={REQ_COLOR[it.status]} style={{ fontSize: "0.8rem", minWidth: 120 }}>{it.note}</span>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* TIMELINE TAB */}
        {tab === "timeline" && (
          <div className="page">
            <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
              {[["all", "ALL", "var(--text-muted)"], ...Object.entries(CAT_META).map(([k, v]) => [k, v.label, v.color])].map(([k, l, c]) => (
                <button 
                  key={k} 
                  className="btn btn-sm"
                  style={{
                    borderColor: catFilter === k ? c : "var(--border)",
                    background: catFilter === k ? `${c}22` : "transparent",
                    color: catFilter === k ? c : "var(--text-muted)"
                  }}
                  onClick={() => setCatFilter(k)}
                >
                  {l}
                </button>
              ))}
              <button className="btn btn-sm btn-primary" style={{ marginLeft: "auto" }} onClick={() => setShowAddEvent(true)}>+ ADD EVENT</button>
            </div>
            
            {showAddEvent && (
              <div className="card" style={{ border: `1px solid var(--green)`, marginBottom: 16 }}>
                <div className="card-label">Add Timeline Event</div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
                  {[["Year", "year", "number"], ["Month", "month", "text"], ["Icon", "icon", "text"], ["Title", "title", "text"]].map(([l, k, t]) => (
                    <div key={k} style={{ flex: 1, minWidth: 120 }}>
                      <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: 4 }}>{l}</div>
                      <input type={t} value={newEvent[k]} onChange={(e) => setNewEvent((p) => ({ ...p, [k]: t === "number" ? parseInt(e.target.value) || 0 : e.target.value }))} className="input" />
                    </div>
                  ))}
                  <div style={{ flex: 1, minWidth: 120 }}>
                    <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: 4 }}>CATEGORY</div>
                    <select value={newEvent.cat} onChange={(e) => setNewEvent((p) => ({ ...p, cat: e.target.value }))} className="input">
                      {Object.entries(CAT_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </select>
                  </div>
                </div>
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: 4 }}>DESCRIPTION</div>
                  <input value={newEvent.desc} onChange={(e) => setNewEvent((p) => ({ ...p, desc: e.target.value }))} className="input" />
                </div>
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: 4 }}>ESSAY NOTES (the scholarship angle)</div>
                  <textarea value={newEvent.essay} onChange={(e) => setNewEvent((p) => ({ ...p, essay: e.target.value }))} className="input" style={{ minHeight: 60 }} />
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  <button className="btn btn-green" onClick={addEvent}>SAVE EVENT</button>
                  <button className="btn" onClick={() => setShowAddEvent(false)}>CANCEL</button>
                </div>
              </div>
            )}
            
            <div style={{ position: "relative", paddingLeft: 28 }}>
              <div style={{ position: "absolute", left: 12, top: 0, bottom: 0, width: 2, background: "var(--border)" }} />
              {filteredTimeline.map((e) => {
                const c = CAT_META[e.cat]?.color || "var(--text-muted)";
                const isFuture = e.cat === "future";
                return (
                  <div key={e.id} style={{ position: "relative", marginBottom: 20 }}>
                    <div style={{ position: "absolute", left: -22, top: 12, width: 12, height: 12, borderRadius: "50%", background: isFuture ? "var(--bg)" : c, border: `2px solid ${c}`, zIndex: 1 }} />
                    <div className="card" style={{ borderLeft: `4px solid ${c}`, opacity: isFuture ? 0.65 : 1, marginBottom: 0 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 6 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap", marginBottom: 4 }}>
                            <span style={{ fontSize: "1.2rem" }}>{e.icon}</span>
                            <span style={{ fontSize: "1.1rem", fontWeight: "bold", color: "var(--text)" }}>{e.title}</span>
                            <span className="badge" style={{ borderColor: c, color: c, background: `${c}11`, borderWidth: 1, borderStyle: "solid" }}>{CAT_META[e.cat]?.label}</span>
                          </div>
                          <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: e.essay ? 8 : 0 }}>{e.desc}</div>
                          {e.essay && <div className="alert alert-yellow" style={{ margin: "8px 0 0 0", padding: "6px 10px", fontSize: "0.85rem" }}>{e.essay}</div>}
                        </div>
                        <div style={{ textAlign: "right", minWidth: 80 }}>
                          <div style={{ fontSize: "1.3rem", fontWeight: 800, color: isFuture ? "var(--text-muted)" : "var(--text)" }}>{e.year}</div>
                          {e.month && <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", letterSpacing: 0.5 }}>{e.month}</div>}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* SCHOLARSHIPS TAB */}
        {tab === "scholarships" && (
          <div className="page">
            {SCOUT_SCHOLARSHIPS.length > 0 && (
              <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: 12, letterSpacing: 0.5 }}>
                SCOUT LAST RUN: {new Date(SCOUT_GENERATED_AT).toLocaleDateString()} · {SCOUT_SCHOLARSHIPS.length} IMPORTED ·{" "}
                <span className="blue" style={{ fontWeight: "bold" }}>bun scout/scout.ts --emit-app</span> to refresh
              </div>
            )}
            <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
              {[["all", "ALL"], ...STATUS_OPTIONS.map((s) => [s.value, s.label])].map(([k, l]) => {
                const statusMeta = STATUS_META[k];
                const color = statusMeta ? statusMeta.color : "var(--text-muted)";
                const count = k === "all" ? scholarships.length : scholarships.filter((s) => s.status === k).length;
                const active = schFilter === k;
                return (
                  <button 
                    key={k} 
                    className="btn btn-sm"
                    style={{
                      borderColor: active ? color : "var(--border)",
                      background: active ? `${color}22` : "transparent",
                      color: active ? color : "var(--text-muted)"
                    }}
                    onClick={() => setSchFilter(k)}
                  >
                    {l} ({count})
                  </button>
                );
              })}
            </div>
            <div className="card" style={{ borderLeft: "4px solid var(--green)", marginBottom: 16 }}>
              <div className="card-label">BigFuture application workflow</div>
              <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", lineHeight: 1.5, margin: "8px 0" }}>
                College Board is the trusted discovery source, not permission to guess. The score below uses award × realistic win rate × verified eligibility confidence − effort. Any uncertain claim stays in review.
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: "0.78rem" }}>
                {WORKFLOW_STATES.map((state, i) => <span key={state} className="badge badge-gray">{i + 1}. {WORKFLOW_LABELS[state]}</span>)}
              </div>
            </div>
            <div className="scholarship-list">
              {scholarships
                .filter((s) => schFilter === "all" || s.status === schFilter)
                .slice()
                .sort((a, b) => expectedBenefit(b) - expectedBenefit(a))
                .map((s) => {
                  const kit = APPLY_KITS[slugOf(s.name)];
                  const benefit = expectedBenefit(s);
                  const stateIndex = WORKFLOW_STATES.indexOf(s.workflowState);
                  return (
                    <div key={s.id} className={`scholarship-card status-${s.status}`}>
                      <div className="sc-header">
                        <div style={{ flex: 1, minWidth: 220 }}>
                          <div className="sc-meta">
                            <span className="sc-name">{s.name}</span>
                            <span className="badge badge-gray">{s.org}</span>
                            {s.source === "scout" && (
                              <span className="badge badge-blue">
                                SCOUT{typeof s.match === "number" ? ` ${s.match}%` : ""}
                              </span>
                            )}
                            {s.source === "bigfuture" && (
                              <span className="badge badge-green">
                                BIGFUTURE{typeof s.match === "number" ? ` ${s.match}%` : ""}
                              </span>
                            )}
                            <span className="badge badge-gray">{WORKFLOW_LABELS[s.workflowState] || "Discovered"}</span>
                          </div>
                          {kit && (
                            <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 6, marginBottom: 6 }}>
                              <span className="badge badge-green">📝 ESSAY READY · {kit.wordCount}w</span>
                              {kit.applicationFee && <span className="badge badge-red">⚠ FEE — VERIFY</span>}
                              {kit.loginRequired && <span className="badge badge-yellow">🔒 LOGIN FIRST</span>}
                              {kit.essayRequired && <span className="badge badge-yellow">✍ ESSAY FIELD{kit.essayWordLimit ? ` ${kit.essayWordLimit}w` : ""}</span>}
                              <span className="badge badge-gray">{(kit.route || "").toUpperCase()}</span>
                            </div>
                          )}
                          <div className="sc-notes">{s.notes}</div>
                          <div className="deadline">DEADLINE: {s.deadline}{s.url ? <> · <a href={s.url} target="_blank" rel="noreferrer">link ↗</a></> : null}</div>
                          <div style={{ fontSize: "0.78rem", color: benefit > 0 ? "var(--green)" : "var(--text-muted)", marginTop: 5 }}>
                            EXPECTED BENEFIT: {fullUsd(benefit)} · ELIGIBILITY EVIDENCE: {EVIDENCE_STATUS[s.evidenceStatus] || "Unknown"}
                          </div>
                        </div>
                        <div className="sc-actions-column">
                          <div className="sc-amount">{usd(s.amount)}</div>
                          <div className="sc-actions">
                            {["apply", "applied", "won", "rejected"].map((k) => {
                              const active = s.status === k;
                              const color = STATUS_META[k]?.color || "var(--border)";
                              return (
                                <button 
                                  key={k} 
                                  className="btn btn-sm"
                                  style={{
                                    fontSize: "0.75rem",
                                    padding: "2px 6px",
                                    borderColor: active ? color : "var(--border)",
                                    background: active ? `${color}22` : "transparent",
                                    color: active ? color : "var(--text-muted)"
                                  }}
                                  onClick={() => updateSchStatus(s.id, k)}
                                >
                                  {k.toUpperCase()}
                                </button>
                              );
                            })}
                          </div>
                          <div className="sc-actions" style={{ marginTop: 5 }}>
                            {s.workflowState === "discovered" && <button className="btn btn-sm" onClick={() => patchSch(s.id, { workflowState: "verified", sourceTrust: "collegeboard" })}>VERIFY SOURCE</button>}
                            {s.workflowState === "verified" && <button className="btn btn-sm" onClick={() => patchSch(s.id, { evidenceStatus: "verified", workflowState: "eligible" })}>CONFIRM ELIGIBILITY</button>}
                            {s.workflowState === "eligible" && <button className="btn btn-sm" onClick={() => markPrioritized(s)}>PRIORITIZE</button>}
                            {s.workflowState === "prioritized" && <button className="btn btn-sm" onClick={() => updateWorkflow(s.id, "prepared")}>MARK PREPARED</button>}
                            {s.workflowState === "prepared" && <button className="btn btn-sm" onClick={() => updateWorkflow(s.id, "needs-review")}>QUEUE REVIEW</button>}
                            {s.workflowState === "needs-review" && <button className="btn btn-sm btn-green" onClick={() => updateWorkflow(s.id, "submitted")}>MARK SUBMITTED</button>}
                            {s.workflowState === "submitted" && <button className="btn btn-sm" onClick={() => updateWorkflow(s.id, "confirmed")}>CONFIRM EMAIL</button>}
                            {stateIndex >= 0 && stateIndex < WORKFLOW_STATES.length - 1 && <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", alignSelf: "center" }}>review gate protected</span>}
                          </div>
                          <div className="sc-actions">
                            {kit && <button className="btn btn-sm btn-green" onClick={() => copyForChrome(s)}>{s.copied ? "COPIED ✓" : "COPY APPLY KIT"}</button>}
                            <button className="btn btn-sm btn-primary" onClick={() => { setEssaySch(s.id); setTab("essay"); }}>ESSAY →</button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {/* AI ESSAYS TAB */}
        {tab === "essay" && (
          <div className="page" style={{ maxWidth: 720 }}>
            <div className="card">
              <div className="card-label">AI Essay Generator — Secure backend (Haiku/Sonnet)</div>
              <div style={{ marginBottom: 12, marginTop: 12 }}>
                <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: 6 }}>SELECT SCHOLARSHIP</div>
                <select value={essaySch} onChange={(e) => setEssaySch(e.target.value)} className="input">
                  <option value="">— select from your list —</option>
                  {scholarships.map((s) => <option key={s.id} value={s.id}>{s.name} ({usd(s.amount)})</option>)}
                </select>
              </div>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: 6 }}>ADDITIONAL CONTEXT / PROMPT</div>
                <textarea value={essayPrompt} onChange={(e) => setEssayPrompt(e.target.value)} placeholder="Paste the form's essay question, word limit, or angle to emphasize…" className="input" style={{ minHeight: 80 }} />
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button 
                  onClick={generateEssay} 
                  disabled={essayLoading || (!essaySch && !essayPrompt)} 
                  className="btn btn-primary"
                  style={{ padding: "8px 20px" }}
                >
                  {essayLoading ? "GENERATING..." : "GENERATE ESSAY"}
                </button>
                {essaySch && (
                  <button 
                    className="btn"
                    style={{ padding: "8px 20px" }}
                    onClick={() => {
                      const sc = scholarships.find((s) => s.id === essaySch);
                      const p = buildLegacyPrompt(sc, fullProfile(timeline), essayPrompt);
                      navigator.clipboard.writeText(p);
                      setCopiedPrompt(true);
                      setTimeout(() => setCopiedPrompt(false), 1500);
                    }}
                  >
                    {copiedPrompt ? "PROMPT COPIED ✓" : "COPY PROMPT FOR CLAUDE"}
                  </button>
                )}
              </div>
            </div>
            {essayOut && (
              <div className="card" style={{ marginTop: 16 }}>
                {essayOut.startsWith("⚠") ? (
                  <div className="alert alert-yellow" style={{ margin: 0 }}>
                    <strong>API Backend Offline (Static Mode)</strong>
                    <p style={{ fontSize: "0.85rem", marginTop: 4, marginBottom: 12 }}>
                      The direct generation API is offline. You can copy the generated prompt below and paste it into Claude yourself:
                    </p>
                    <textarea 
                      readOnly 
                      className="input" 
                      style={{ height: 160, fontFamily: "monospace", fontSize: "0.8rem", whiteSpace: "pre-wrap" }} 
                      value={buildLegacyPrompt(scholarships.find((s) => s.id === essaySch), fullProfile(timeline), essayPrompt)} 
                      onClick={(e) => e.target.select()}
                    />
                  </div>
                ) : (
                  <>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12, alignItems: "center" }}>
                      <div className="card-label" style={{ marginBottom: 0 }}>Generated Essay</div>
                      <button className="btn btn-sm btn-green" onClick={() => navigator.clipboard.writeText(essayOut)}>COPY</button>
                    </div>
                    <div className="essay-output">{essayOut}</div>
                  </>
                )}
              </div>
            )}
            <div className="info-box" style={{ marginTop: 24, opacity: 0.9 }}>
              <strong>Story bank baked into every essay</strong>
              <p>
                Every Timeline event with essay notes (Black Belt → discipline, Eagle Scout → leadership,
                state wrestling → performance under pressure, the MRI moment → computational-oncology origin)
                is automatically included. Add events on the Timeline tab to expand it.
              </p>
            </div>
          </div>
        )}

        {/* INTERVENTIONS TAB — the human checkpoint queue */}
        {tab === "interventions" && (
          <div className="page">
            <div className="card" style={{ borderLeft: "4px solid var(--amber, #d97706)", marginBottom: 16 }}>
              <div className="card-label">Needs you</div>
              <p style={{ fontSize: "0.88rem", color: "var(--text-muted)", marginTop: 8, lineHeight: 1.5 }}>
                {openCheckpoints.length === 0
                  ? "Nothing is waiting on you."
                  : `${openCheckpoints.filter((c) => c.blocking).length} blocking, ${openCheckpoints.filter((c) => !c.blocking).length} non-blocking.`}
                {" "}Each item is a decision the system deliberately refused to make for you.
              </p>
              {!queueLive && (
                <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 6 }}>
                  Read-only snapshot{INTERVENTIONS_GENERATED_AT ? ` from ${new Date(INTERVENTIONS_GENERATED_AT).toLocaleString()}` : ""}.
                  Run <code>bun run start</code> to resolve items here.
                </p>
              )}
            </div>

            {openCheckpoints.map((cp) => (
              <div key={cp.checkpointId} className="card" style={{ marginBottom: 12, borderLeft: `4px solid ${cp.blocking ? "var(--red, #dc2626)" : "var(--text-muted)"}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div className="card-label">{cp.type}{cp.blocking ? " · BLOCKING" : ""}</div>
                  <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{new Date(cp.createdAt).toLocaleString()}</span>
                </div>
                <p style={{ fontSize: "0.95rem", marginTop: 8, marginBottom: 6 }}>{cp.question}</p>
                {cp.context?.slug && <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{cp.context.name || cp.context.slug}</div>}
                {cp.context?.fieldLabel && <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Field: “{cp.context.fieldLabel}” → {cp.context.path}</div>}
                {cp.context?.situation && <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{cp.context.situation}</div>}
                {cp.rationale && <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: 6, fontStyle: "italic" }}>{cp.rationale}</p>}
                {cp.missingEvidence?.length > 0 && (
                  <div style={{ fontSize: "0.78rem", color: "var(--red, #dc2626)", marginTop: 6 }}>
                    Missing evidence: {cp.missingEvidence.join(", ")} — cannot be resolved until attached.
                  </div>
                )}
                <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                  {cp.allowedResolutions.map((res) => (
                    <button
                      key={res}
                      onClick={() => resolveCheckpoint(cp, res)}
                      disabled={!queueLive || queueBusy === cp.checkpointId || cp.missingEvidence?.length > 0}
                      style={{ fontSize: "0.8rem", padding: "6px 12px", cursor: queueLive ? "pointer" : "not-allowed", opacity: queueLive ? 1 : 0.5 }}
                    >
                      {res.replace(/_/g, " ")}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* APPLY QUEUE TAB */}
        {tab === "queue" && (
          <div className="page">
            <div className="card" style={{ borderLeft: "4px solid var(--green)", marginBottom: 16 }}>
              <div className="card-label">Batch Drafting</div>
              <p style={{ fontSize: "0.88rem", color: "var(--text-muted)", marginTop: 8, marginBottom: 12, lineHeight: 1.5 }}>
                Drafts an essay for every scholarship you're pursuing ({pursuing.length}). ~$0.50 / 100 essays.
                Nothing is submitted — approve, then "Copy for Chrome" and fill via Claude for Chrome.
                Set a hard spend cap in the Anthropic console.
              </p>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <button 
                  onClick={generateBatch} 
                  disabled={batchLoading || !pursuing.length} 
                  className="btn btn-green"
                >
                  {batchLoading ? "DRAFTING..." : `GENERATE BATCH (${pursuing.length})`}
                </button>
                <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>est. {fmtUsd(estimateBatchCost(pursuing))}</span>
                {batchMsg && <span className="badge badge-green">{batchMsg}</span>}
              </div>
            </div>
            {drafted.length === 0 ? (
              <div className="card empty-state">No drafts yet. Hit GENERATE BATCH.</div>
            ) : drafted.map((s) => (
              <div key={s.id} className="card" style={{ borderLeft: `4px solid ${s.approved ? "var(--green)" : "var(--border)"}`, marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: "0.95rem", fontWeight: "bold", color: "var(--text)" }}>{s.name}</span>
                  <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                    {s.approved && <span className="green">✅ APPROVED · </span>}
                    {s.draftModel?.includes("sonnet") ? "Sonnet" : "Haiku"} · {s.draftWords} words
                  </span>
                </div>
                <textarea className="input" value={s.draftEssay} onChange={(e) => patchSch(s.id, { draftEssay: e.target.value, draftWords: e.target.value.trim().split(/\s+/).length })} style={{ minHeight: 140, lineHeight: 1.6, fontFamily: "inherit" }} />
                <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                  <button className={`btn btn-sm ${s.approved ? "" : "btn-green"}`} onClick={() => patchSch(s.id, { approved: !s.approved })}>{s.approved ? "UN-APPROVE" : "APPROVE"}</button>
                  <button className="btn btn-sm btn-primary" onClick={() => copyForChrome(s)}>{s.copied ? "COPIED ✓" : "COPY FOR CHROME"}</button>
                  <button className="btn btn-sm btn-danger" onClick={() => patchSch(s.id, { draftEssay: "", approved: false })}>DISCARD</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
