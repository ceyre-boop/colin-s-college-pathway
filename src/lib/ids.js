// Stable scholarship identity — ONE implementation.
//
// Before this, the join key between a scout record, an essay directory, metadata.json, targets.json
// and the dashboard was a 48-char name slug computed independently in three files (scout/select.ts,
// scout/probe-form.ts, scout/scout.ts), with fuzzy 24-char prefix dedup in two more. Two failure
// modes came out of that: a listing renamed between runs ("… 2026" appended) produced a brand-new
// slug and orphaned its essay directory, and two awards sharing a 48-char prefix silently collapsed
// into one record.
//
// Fix: identity is (host, normalized name). The host is stable across renames and distinguishes two
// awards with similar names from different sponsors. The name is normalized hard — punctuation,
// stopwords, and a trailing year are all stripped — so cosmetic edits do not mint a new identity.

const STOPWORDS = new Set([
  "the", "a", "an", "of", "for", "and", "in", "to",
  "scholarship", "scholarships", "award", "awards", "program", "programs",
  "fund", "foundation", "memorial", "annual", "inc", "llc",
]);

/**
 * Lowercase, strip punctuation, drop a trailing year, drop stopwords, collapse whitespace.
 *
 * Runs of single letters are glued back together, because stripping punctuation turns "U.S. Bank"
 * into "u s bank" while "US Bank" stays "us bank" — the same sponsor would otherwise get two ids
 * purely on the strength of two periods.
 */
export function normalizeName(name) {
  const words = String(name || "")
    .toLowerCase()
    .replace(/[‘’“”]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(19|20)\d{2}\b/g, " ")
    .split(" ")
    .filter(Boolean);

  const glued = [];
  for (const w of words) {
    const prev = glued[glued.length - 1];
    if (w.length === 1 && prev && prev.length <= 2 && /^[a-z]+$/.test(prev) && /^[a-z]$/.test(w)) {
      glued[glued.length - 1] = prev + w;
    } else {
      glued.push(w);
    }
  }

  return glued.filter((w) => !STOPWORDS.has(w)).join(" ").trim();
}

/** Registrable-ish host: lowercased, `www.` stripped. Empty string when the URL is unusable. */
export function normalizeHost(url) {
  if (!url) return "";
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Short, stable, non-cryptographic digest (FNV-1a, base36). Deterministic across runs. */
function digest(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/**
 * Canonical id for a scholarship. Same award from two sources → same id, provided the host matches
 * or is absent. Format: `sch_<host-ish>_<digest>` — readable enough to grep in a log.
 */
export function scholarshipId(name, url) {
  const n = normalizeName(name);
  const host = normalizeHost(url);
  if (!n && !host) return "sch_unknown_" + digest(String(name || url || ""));
  const hostTag = host ? host.split(".").slice(-2, -1)[0] || host.split(".")[0] : "nohost";
  return `sch_${hostTag.replace(/[^a-z0-9]/g, "").slice(0, 16)}_${digest(`${host}|${n}`)}`;
}

/**
 * Human-facing directory slug. Kept separate from the id on purpose: the slug is allowed to be
 * pretty and may change, the id may not. Existing scholarship_essays/<slug>/ directories keep
 * working because this reproduces the previous slugOf() exactly.
 */
export function slugOf(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

/** True when two records are the same award. Uses identity, not fuzzy prefix matching. */
export function sameScholarship(a, b) {
  return scholarshipId(a.name, a.url) === scholarshipId(b.name, b.url);
}
