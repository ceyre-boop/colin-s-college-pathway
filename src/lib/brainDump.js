// Brain dump — for every scholarship that wants words, what the prompt is and which of
// Colin's own timeline events he could build it out of.
//
// He writes his essays himself and fast; what he needs is not prose but the two things he'd
// otherwise dig for each time: the topic, and the material. This module answers both from data
// already in the repo — the scout's finds and `src/data/timeline.js`, where every event already
// carries a hand-written `essay` angle.
//
// Pure functions, no React, no network. The archetype list and its cues mirror
// scout/topic-bank.ts so the dashboard and the generated TOPIC_BANK.md never disagree.

// The ~7 prompts that cover most scholarship essays. `cats` biases which timeline categories
// are relevant; `cues` match the listing's own words when it says anything about its prompt.
export const ARCHETYPES = [
  {
    id: 'personal-statement',
    title: 'Personal statement',
    prompt: 'Tell us about yourself. What shaped you, and what are you doing with it?',
    cues: ['tell us about yourself', 'personal statement', 'who you are', 'background', 'your story'],
    cats: ['personal', 'academic', 'professional'],
    keywords: ['born', 'family', 'moved', 'faith', 'church', 'first'],
  },
  {
    id: 'why-deserve',
    title: 'Why you deserve it',
    prompt: 'Why should you receive this scholarship, and what will it change for you?',
    cues: ['deserve', 'why should you receive', 'how will this scholarship help', 'financial need', 'need-based'],
    cats: ['academic', 'personal'],
    keywords: ['cost', 'tuition', 'work', 'job', 'transfer', 'mott', 'pell', 'afford'],
  },
  {
    id: 'career-goals',
    title: 'Career & academic goals',
    prompt: 'What are your academic and career goals, and how did you choose this field?',
    cues: ['career goals', 'academic goals', 'why this major', 'future plans', 'field of study', 'intended major'],
    cats: ['academic', 'professional', 'future'],
    keywords: ['mri', 'oncology', 'biology', 'research', 'degree', 'major', 'ap ', 'clinic', 'tumor'],
  },
  {
    id: 'adversity',
    title: 'Adversity / an obstacle',
    prompt: 'Describe a challenge or setback you faced and what it taught you.',
    cues: ['challenge', 'obstacle', 'adversity', 'setback', 'overcome', 'hardship', 'difficulty'],
    cats: ['athletic', 'personal', 'academic'],
    keywords: ['wrestling', 'state', 'belt', 'injury', 'moved', 'lost', 'failed', 'hard'],
  },
  {
    id: 'leadership',
    title: 'Leadership',
    prompt: 'Describe a time you led. What did you build or change, and who did it serve?',
    cues: ['leadership', 'led a team', 'initiative', 'organized', 'founded', 'leader'],
    cats: ['professional', 'personal'],
    keywords: ['eagle', 'scout', 'founded', 'built', 'led', 'developer', 'agency', 'team', 'captain'],
  },
  {
    id: 'community-service',
    title: 'Community service',
    prompt: 'How have you served your community, and what difference did it make?',
    cues: ['community service', 'volunteer', 'giving back', 'impact on others', 'service to others'],
    cats: ['personal'],
    keywords: ['eagle', 'scout', 'volunteer', 'church', 'worship', 'service', 'lunch', 'special needs'],
  },
  {
    id: 'why-business',
    title: 'Entrepreneurship',
    prompt: 'What have you built, and why does building a business matter to you?',
    cues: ['entrepreneur', 'business', 'startup', 'venture', 'innovation', 'small business'],
    cats: ['professional'],
    keywords: ['built', 'company', 'agency', 'taboost', 'trading', 'quant', 'automation', 'developer', 'launched'],
  },
];

const lower = (s) => String(s || '').toLowerCase();

/** A listing's stated word limit, if its own blurb happens to mention one. */
export function wordLimitFrom(text) {
  const t = String(text || '');
  const m = t.match(/(\d{2,5})\s*(?:-|\s)?word/i) || t.match(/words?\D{0,12}?(\d{2,5})/i);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 50 && n <= 5000 ? n : null;
}

/**
 * Which archetype does this listing look like? Returns null rather than guessing — a blurb that
 * says nothing about its prompt is honestly unsorted, and the UI says to open the URL.
 */
export function archetypeFor(text) {
  const t = lower(text);
  let best = null;
  for (const a of ARCHETYPES) {
    const hits = a.cues.reduce((n, c) => n + (t.includes(c) ? 1 : 0), 0);
    if (hits > 0 && (!best || hits > best.hits)) best = { a, hits };
  }
  return best ? best.a : null;
}

/** A listing whose own blurb says "no essay" is money, not a topic. */
export function needsEssay(sch) {
  const t = lower(`${sch?.notes} ${sch?.name}`);
  return !/\bno essay\b/.test(t);
}

/**
 * Timeline events worth raiding for a given archetype, best first. An event scores for matching
 * the archetype's categories and for keyword overlap; events that already carry a hand-written
 * `essay` angle are ranked above bare ones, because that angle is the actual usable material.
 */
export function ideasFor(archetype, timeline = [], limit = 5) {
  if (!archetype) return [];
  const scored = timeline
    .map((e) => {
      const hay = lower(`${e.title} ${e.desc} ${e.essay}`);
      let score = 0;
      if (archetype.cats.includes(e.cat)) score += 2;
      for (const k of archetype.keywords) if (hay.includes(k)) score += 3;
      if (e.essay && e.essay.trim()) score += 2;
      return { event: e, score };
    })
    .filter((x) => x.score >= 3)
    .sort((a, b) => b.score - a.score || (b.event.year || 0) - (a.event.year || 0));
  return scored.slice(0, limit).map((x) => x.event);
}

/**
 * Days until a deadline string, or null when it isn't a real date.
 *
 * Scholarship listings commonly give a year-less deadline ("Jan 15", "February 1") because the
 * award is annual. `new Date("Jan 15")` silently resolves those to the year 2001, which is how
 * the dashboard first shipped "-9404 days" next to a live scholarship. A year-less date is
 * therefore rolled forward to its next occurrence instead of being read literally.
 */
export function daysUntil(deadline, today = new Date()) {
  if (!deadline) return null;
  const raw = String(deadline).trim();
  if (!raw) return null;

  // JS Date is lenient enough to find a date inside prose like "verify at URL 2026", so the
  // string has to look like a date before it is trusted at all.
  const MONTH = /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;
  const looksLikeDate = /^\s*\d{1,4}[-/]\d{1,2}([-/]\d{1,4})?\s*$/.test(raw)
    || (MONTH.test(raw) && /\d/.test(raw) && raw.split(/\s+/).length <= 3)
    || MONTH.test(raw.trim()) && raw.trim().split(/\s+/).length === 1;
  if (!looksLikeDate) return null;

  const hasYear = /\b(19|20)\d{2}\b/.test(raw);
  const d = new Date(hasYear ? raw : `${raw} ${today.getFullYear()}`);
  if (Number.isNaN(d.getTime())) return null;

  if (!hasYear && d < today) {
    // The date already passed this year, so the next cycle is the one being advertised.
    const next = new Date(d);
    next.setFullYear(today.getFullYear() + 1);
    return Math.round((next - today) / 86400000);
  }
  return Math.round((d - today) / 86400000);
}

/**
 * The brain dump itself: one entry per scholarship that needs words, newest deadline first,
 * each carrying its prompt, its word limit, and the timeline events to build it from.
 */
export function brainDump(scholarships = [], timeline = [], { today = new Date() } = {}) {
  const out = [];
  for (const s of scholarships) {
    if (['won', 'lost', 'submitted', 'rejected'].includes(s.status)) continue;
    if (!needsEssay(s)) continue;
    const text = `${s.name} ${s.notes || ''}`;
    const archetype = archetypeFor(text);
    const days = daysUntil(s.deadline, today);
    out.push({
      id: s.id,
      name: s.name,
      amount: Number(s.amount || 0),
      url: s.url || null,
      deadline: s.deadline || null,
      daysLeft: days,
      wordLimit: wordLimitFrom(text),
      archetype,
      prompt: archetype ? archetype.prompt : null,
      ideas: ideasFor(archetype, timeline),
    });
  }
  // Soonest LIVE deadline first. A passed date sorts below everything still open — most of
  // these listings are annual, so a past date means "next cycle", not "work on this first".
  // Undated listings sit between the two, biggest award first.
  const rank = (d) => (d.daysLeft == null ? 1 : d.daysLeft >= 0 ? 0 : 2);
  return out.sort((a, b) => {
    const ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 0) return a.daysLeft - b.daysLeft;        // live: soonest first
    if (ra === 2) return b.daysLeft - a.daysLeft;        // expired: most recent first
    return b.amount - a.amount;                           // undated: biggest award first
  });
}

/** Everything for one entry as plain text, so it can go straight into his own editor. */
export function dumpAsText(entry) {
  const L = [];
  L.push(entry.name);
  if (entry.amount) L.push(`$${entry.amount.toLocaleString('en-US')}`);
  if (entry.deadline) L.push(`Due ${entry.deadline}${entry.daysLeft != null ? ` (${entry.daysLeft} days)` : ''}`);
  L.push(entry.wordLimit ? `About ${entry.wordLimit} words` : 'Word limit: check the URL');
  L.push('');
  L.push(entry.prompt
    ? `PROMPT (${entry.archetype.title}): ${entry.prompt}`
    : 'PROMPT: not stated in the listing — open the URL and read the real one.');
  L.push('');
  if (entry.ideas.length) {
    L.push('YOUR MATERIAL:');
    for (const e of entry.ideas) {
      L.push(`- ${e.title} (${e.year})${e.desc ? ` — ${e.desc}` : ''}`);
      if (e.essay && e.essay.trim()) L.push(`    angle: ${e.essay.trim()}`);
    }
  } else {
    L.push('YOUR MATERIAL: nothing on the timeline matched — add the event on the Timeline tab.');
  }
  if (entry.url) { L.push(''); L.push(entry.url); }
  return L.join('\n');
}
