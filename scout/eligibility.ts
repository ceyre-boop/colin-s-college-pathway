// Eligibility pre-filter — Layer 1.5, the free cost lever.
//
// ~80-90% of scholarship listings are locked to a specific state, institution, field,
// grade level, or demographic identity the student doesn't have. Screening those out with
// DETERMINISTIC rules (zero network, zero Claude) before any paid adjudication is where the
// cost is eliminated: 36k catalog → the 10-20% "pass"+"ambiguous" survivors, for $0.
//
// Design doctrine (matches scout.ts's honesty rule): BIAS TO "ambiguous", NEVER over-DQ.
// A false "disqualified" silently throws away real money, so we only DQ on an explicit,
// SCOPED requirement (e.g. "must be a resident of Texas") — vague text goes to "ambiguous"
// and gets a cheap Haiku adjudication later. Every decision carries a human-readable reason.
//
// Never claims first-generation (Colin's profile marks it "(verify)" = unverified), and
// first-gen-REQUIRED awards are disqualified.

export type EligibilityDecision = "pass" | "disqualified" | "ambiguous";

export interface EligibilityVerdict {
  decision: EligibilityDecision;
  reasons: string[]; // why — human-readable, always populated
  hardDqRule?: string; // which rule fired the DQ (for auditing the disqualified pile)
}

export interface EligibilityProfile {
  stateNames: string[]; // lowercase full names the student counts as home, e.g. ["michigan"]
  stateAbbrs: string[]; // e.g. ["mi"]
  institutions: string[]; // lowercase names/aliases the student attends/targets
  allowedFields: string[]; // field synonyms the student can honestly claim
  disallowedFields: string[]; // fields that hard-DQ when named as required
  allowedLevels: string[]; // grade-level tokens that pass
  isFirstGeneration: boolean; // false = cannot claim; first-gen-required awards DQ
  isUsCitizen: boolean;
  /** undefined = declined to state; gender-restricted awards then screen ambiguous, never DQ. */
  gender?: "male" | "female";
}

// SCREENING POLICY — which academic fields and levels the student can honestly claim. This is
// judgement about the scholarship landscape, not identity, so it lives here as a constant.
//
// The identity half (home state, institutions, citizenship, gender, first-gen) used to be
// hardcoded alongside it in a constant named COLIN_PROFILE. That was the third copy of the
// applicant profile in this repo, and it had already drifted: it asserted gender "male" while the
// actual profile declines to state. Identity now comes from the vault via
// buildEligibilityProfile(); only the policy lists remain hardcoded.
const SCREENING_POLICY = {
  allowedFields: [
    "biology", "biological science", "biological sciences", "molecular biology",
    "cellular biology", "cell biology", "molecular and cellular biology", "life science",
    "life sciences", "computer science", "computing", "computer engineering", "software",
    "information technology", "data science", "stem", "science", "technology", "engineering",
    "mathematics", "math", "chemistry", "biochemistry", "biomedical", "bioinformatics",
    "medicine", "medical", "pre-med", "premed", "health", "healthcare", "oncology",
    "neuroscience", "physics", "artificial intelligence", "machine learning",
  ],
  disallowedFields: [
    "nursing", "law", "legal studies", "culinary", "aviation", "cosmetology", "welding",
    "accounting", "agriculture", "agricultural", "veterinary", "dentistry", "dental hygiene",
    "education major", "teaching", "teacher education", "social work", "journalism",
    "fashion", "interior design", "real estate", "hvac", "automotive", "truck driving",
    "funeral", "mortuary", "theology", "seminary", "fine arts", "performing arts", "music",
    "dance", "theatre", "theater", "film", "architecture", "landscape",
  ],
  allowedLevels: [
    "undergraduate", "undergrad", "associate", "bachelor", "bachelor's", "transfer",
    "sophomore", "community college", "current college", "college student", "any level",
    "freshman", // he's a returning/transfer student; entering-freshman-only is handled separately
  ],
};

/** Split a school name into the aliases a listing might use ("UM-Flint", "um flint", "umflint"). */
function institutionAliases(name: string): string[] {
  const n = (name || "").toLowerCase().trim();
  if (!n) return [];
  const out = new Set<string>([n]);
  const noPunct = n.replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  out.add(noPunct);
  out.add(noPunct.replace(/\s+/g, ""));
  // "University of Michigan-Flint" → "um-flint" / "um flint" / "umflint"
  const m = noPunct.match(/^university of ([a-z]+)[ -]?([a-z]*)$/);
  if (m) {
    const initials = `u${m[1][0]}`;
    if (m[2]) { out.add(`${initials}-${m[2]}`); out.add(`${initials} ${m[2]}`); out.add(`${initials}${m[2]}`); }
  }
  // Shorten to the distinctive part: "Mott Community College" → "mott college", "mott".
  // Only when the leading word is actually distinctive — emitting the bare word "university" for
  // "University of Michigan-Flint" would make EVERY university read as the student's own school,
  // which silently defeats the wrong-institution rule.
  const GENERIC = new Set(["university", "college", "the", "state", "community", "institute", "school", "academy", "of", "a", "an"]);
  const words = noPunct.split(" ");
  if (words.length > 1 && !GENERIC.has(words[0])) {
    out.add(words[0]);
    out.add(`${words[0]} ${words[words.length - 1]}`);
  }
  return [...out].filter((s) => s && s.length > 2 && !GENERIC.has(s));
}

const STATE_NAME_BY_ABBR: Record<string, string> = { mi: "michigan", ga: "georgia" };

/** Pull institution names out of free prose, e.g. an enrollment note. */
export function extractInstitutions(text: string): string[] {
  const out = new Set<string>();
  const patterns = [
    /\bUniversity of [A-Z][A-Za-z]+(?:[- ][A-Z][A-Za-z]+)?/g,
    /\b[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*\s+(?:Community College|College|University|Institute)\b/g,
  ];
  for (const re of patterns) for (const m of text.matchAll(re)) out.add(m[0].trim());
  return [...out];
}

/**
 * Build the eligibility profile from the applicant record (which resolves out of the vault),
 * combined with the screening policy above. One identity source, not three.
 */
export function buildEligibilityProfile(a: {
  identity: { citizenship: string; gender: string };
  contact: { address: { state: string } };
  academic: { currentSchool: string; highSchool: string; classLevel: string };
  financial: { residency: string };
  doNotClaim?: string[];
}): EligibilityProfile {
  const abbr = (a.financial?.residency || a.contact?.address?.state || "").toLowerCase().trim();
  const stateAbbrs = abbr ? [abbr.length === 2 ? abbr : abbr.slice(0, 2)] : [];
  const stateNames = [
    ...(STATE_NAME_BY_ABBR[stateAbbrs[0]] ? [STATE_NAME_BY_ABBR[stateAbbrs[0]]] : []),
    ...(abbr.length > 2 ? [abbr] : []),
  ];

  return {
    stateNames: [...new Set(stateNames)],
    stateAbbrs: [...new Set(stateAbbrs)],
    institutions: [...new Set([
      ...institutionAliases(a.academic?.currentSchool || ""),
      // A transfer student has two home institutions; the second usually only appears in the
      // enrollment note ("...home institution University of Michigan-Flint (returning)"). Missing
      // it would make the student's own destination school read as a foreign scope and DQ them.
      ...(a.academic?.enrollmentInstitution ? institutionAliases(a.academic.enrollmentInstitution) : []),
      ...extractInstitutions(a.academic?.enrollmentNote || "").flatMap(institutionAliases),
    ])],
    allowedFields: SCREENING_POLICY.allowedFields,
    disallowedFields: SCREENING_POLICY.disallowedFields,
    allowedLevels: SCREENING_POLICY.allowedLevels,
    // Never inferred: first-gen is claimable only if it is NOT on the do-not-claim list.
    isFirstGeneration: !(a.doNotClaim ?? []).some((x) => /first[- ]?gen/i.test(x)),
    isUsCitizen: /u\.?s\.?|american|citizen/i.test(a.identity?.citizenship || ""),
    // "" in the profile means decline-to-state. Gender-restricted awards must then screen as
    // ambiguous rather than being answered on the student's behalf.
    gender: (a.identity?.gender || "").toLowerCase() === "female" ? "female" : (a.identity?.gender || "").toLowerCase() === "male" ? "male" : undefined,
  };
}

// ---------------------------------------------------------------------------
// State table (full name → abbreviation), for the wrong-state rule.
// ---------------------------------------------------------------------------
const US_STATES: Record<string, string> = {
  alabama: "al", alaska: "ak", arizona: "az", arkansas: "ar", california: "ca",
  colorado: "co", connecticut: "ct", delaware: "de", florida: "fl", georgia: "ga",
  hawaii: "hi", idaho: "id", illinois: "il", indiana: "in", iowa: "ia", kansas: "ks",
  kentucky: "ky", louisiana: "la", maine: "me", maryland: "md", massachusetts: "ma",
  michigan: "mi", minnesota: "mn", mississippi: "ms", missouri: "mo", montana: "mt",
  nebraska: "ne", nevada: "nv", "new hampshire": "nh", "new jersey": "nj",
  "new mexico": "nm", "new york": "ny", "north carolina": "nc", "north dakota": "nd",
  ohio: "oh", oklahoma: "ok", oregon: "or", pennsylvania: "pa", "rhode island": "ri",
  "south carolina": "sc", "south dakota": "sd", tennessee: "tn", texas: "tx", utah: "ut",
  vermont: "vt", virginia: "va", washington: "wa", "west virginia": "wv",
  wisconsin: "wi", wyoming: "wy",
};

// Signals that eligibility is NATIONAL / open — never DQ on geography when present.
const NATIONAL_HINTS =
  /\b(all 50 states|any state|nationwide|national|united states|u\.?s\.?\s+(citizen|resident)|residing (in|or) (one of )?the (fifty|50) states|throughout the (country|u\.?s))\b/i;

// A geographic RESTRICTION phrase, capturing the scoped location word after it.
const STATE_SCOPE = new RegExp(
  "(?:reside(?:nt|nts|s|ncy)?|residing|living|live|domiciled|located|based)\\s+(?:in|of|within)\\s+" +
    "|(?:attend(?:ing)?|enrolled(?:\\s+in)?|studying)\\s+(?:a\\s+)?(?:school|college|university|institution|high\\s+school)s?\\s+in\\s+" +
    "|(?:graduat\\w+\\s+from\\s+a\\s+)?high\\s+school\\s+in\\s+" +
    "|(?:from|of)\\s+the\\s+(?:state\\s+of\\s+)?",
  "i",
);

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

// Which specific US states does the text scope eligibility to? Empty = no specific scope found.
function scopedStates(text: string): string[] {
  const found = new Set<string>();
  for (const [name, abbr] of Object.entries(US_STATES)) {
    // Only count a state when it appears right after a residency/attendance scope phrase.
    // STATE_SCOPE.source is an alternation — wrap it so the name binds to ALL branches.
    const scoped = new RegExp("(?:" + STATE_SCOPE.source + ")(?:the\\s+)?" + name + "\\b", "i");
    if (scoped.test(text)) found.add(name);
    // "<State> resident" / "<State> high school" / "<State> student"
    const trailing = new RegExp("\\b" + name + "\\s+(resident|residents|high\\s+school|students?)\\b", "i");
    if (trailing.test(text)) found.add(name);
    // Abbreviation only counts in an obvious residency context to avoid false hits (e.g. "in").
    const abbrCtx = new RegExp("\\bresident[s]?\\s+of\\s+" + abbr + "\\b", "i");
    if (abbr !== "in" && abbr !== "or" && abbr !== "me" && abbr !== "ok" && abbrCtx.test(text)) found.add(name);
  }
  return [...found];
}

// ---------------------------------------------------------------------------
// The screen.
// ---------------------------------------------------------------------------
export function screenEligibility(
  requirementsText: string | null | undefined,
  profile: EligibilityProfile,
): EligibilityVerdict {
  const reasons: string[] = [];
  if (!requirementsText || norm(requirementsText).length < 12) {
    return { decision: "ambiguous", reasons: ["no requirements text to screen — send to adjudication"] };
  }
  const text = " " + norm(requirementsText) + " ";
  const national = NATIONAL_HINTS.test(text);

  // 1) Wrong-state — only when eligibility is scoped to specific non-home states.
  if (!national) {
    const states = scopedStates(text);
    const homeIncluded = states.some((s) => profile.stateNames.includes(s));
    if (states.length && !homeIncluded) {
      return {
        decision: "disqualified",
        reasons: [`scoped to ${states.map((s) => s.replace(/\b\w/g, (c) => c.toUpperCase())).join("/")}; student is a ${profile.stateNames[0]} resident`],
        hardDqRule: "wrong-state",
      };
    }
    if (states.length && homeIncluded) reasons.push(`home state (${profile.stateNames[0]}) is in scope`);
  }

  // 2) Wrong-institution — text scopes eligibility to a named school that isn't the student's.
  //    Home-school-first: if any of the student's own institutions is named anywhere, the
  //    award is not restricted against them — never DQ. Only otherwise look for a foreign scope.
  const homeNamed = profile.institutions.some((inst) => text.includes(inst));
  if (homeNamed) {
    reasons.push("student's institution is in scope");
  } else {
    const instScope = /(?:enrolled\s+at|attend(?:ing)?|students?\s+(?:of|at)|must\s+attend)\s+(?:the\s+)?([a-z][a-z.'&\- ]{3,60}?(?:university|college|institute|academy))\b/gi;
    let m: RegExpExecArray | null;
    const namedSchools: string[] = [];
    while ((m = instScope.exec(text))) {
      const school = norm(m[1]);
      // ignore generic ("a university", "any college", "an accredited college")
      if (/^(a|an|any|accredited|four-?year|two-?year|participating|eligible|your|their|local|community)\b/.test(school)) continue;
      namedSchools.push(school);
    }
    if (namedSchools.length) {
      return {
        decision: "disqualified",
        reasons: [`restricted to ${namedSchools[0]}; student attends Mott CC / UM-Flint`],
        hardDqRule: "wrong-institution",
      };
    }
  }

  // 3) Demographic-identity DQ (highest-value cut). Only when scoped as a REQUIREMENT.
  //    first-generation is a hard guardrail: required first-gen → DQ (Colin can't claim it).
  const FEMALE_REQUIRED = /\b(female|women|woman|girls?)\s+(only|students?|applicants?)\b|\bmust\s+(be|identify\s+as)\s+(a\s+)?(female|woman)\b/i;
  // Gender is decline-to-state in the profile by default. When it is unknown we must NOT answer on
  // the student's behalf in either direction — a gender-restricted award becomes a human question.
  if (FEMALE_REQUIRED.test(text) && !profile.gender) {
    return { decision: "ambiguous", reasons: ["award is gender-restricted and the profile declines to state — human decides"] };
  }

  const identityDq: [RegExp, string][] = [
    // first-generation DQs only when the student genuinely cannot claim it (doNotClaim).
    ...(profile.isFirstGeneration ? [] : [[/\b(first[- ]generation|first[- ]gen)\b/i, "requires first-generation status (student cannot verify/claim it)"] as [RegExp, string]]),
    ...(profile.gender === "female" ? [] : [[FEMALE_REQUIRED, "requires female applicant"] as [RegExp, string]]),
    [/\b(veteran|active[- ]duty|military\s+service|served\s+in\s+the\s+(armed\s+forces|military))\b/i, "requires veteran/military status"],
    [/\b(member|enrolled\s+member)\s+of\s+(a\s+)?(federally\s+recognized\s+)?(tribe|nation|band)\b|\btribal\s+enrollment\b/i, "requires tribal enrollment"],
    [/\b(lgbtq|transgender|gay|lesbian)\s+(students?|applicants?|community)\b/i, "requires LGBTQ+ identity"],
    [/\bmust\s+(be|have)\s+(a\s+)?(disab|blind|deaf|hearing[- ]impaired)/i, "requires a specific disability"],
    [/\b(children|dependents?|employees?)\s+of\s+([a-z][a-z.'&\- ]{2,40}?(?:members|employees|union|company|corporation|inc\.?|llc|co\.))\b/i, "restricted to employees'/members' children of a specific organization"],
    [/\bmust\s+be\s+(a\s+)?(muslim|jewish|hindu|buddhist|catholic\s+of\s+the\s+diocese)\b/i, "requires a specific religion the student doesn't hold"],
  ];
  for (const [re, why] of identityDq) {
    if (re.test(text)) return { decision: "disqualified", reasons: [why], hardDqRule: "demographic-identity" };
  }

  // 4) Wrong grade level — graduate/faculty/HS-senior-only scopes.
  const levelDq: [RegExp, string][] = [
    [/\bgraduate\s+students?\s+only\b|\b(ph\.?d|doctoral|master'?s?)\s+(students?|candidates?)\s+only\b|\bmust\s+be\s+(a\s+)?(graduate|doctoral|ph\.?d)\s+student\b/i, "graduate/doctoral only"],
    [/\b(current\s+)?high\s+school\s+(senior|junior|student)s?\s+only\b|\bmust\s+be\s+(a\s+)?(current\s+|graduating\s+)*high\s+school\s+(senior|student)\b/i, "high-school-only (student is in college)"],
    [/\b(teacher|faculty|professor|educator|administrator)\s+(applicants?|only)\b|\bmust\s+be\s+(a\s+|an\s+)?(teacher|faculty|educator)\b/i, "requires being a teacher/faculty member"],
    [/\bentering\s+freshm(a|e)n\s+only\b|\bincoming\s+freshm(a|e)n\s+only\b|\bfirst[- ]time\s+freshm(a|e)n\s+only\b/i, "entering-freshman only (student is a returning transfer)"],
  ];
  for (const [re, why] of levelDq) {
    if (re.test(text)) return { decision: "disqualified", reasons: [why], hardDqRule: "wrong-grade-level" };
  }

  // 5) Citizenship — DACA/undocumented-required, or a specific non-US citizenship required.
  if (/\b(daca|undocumented|dreamer)\s+(students?|applicants?|only)\b|\bmust\s+be\s+(a\s+)?(daca|undocumented)\b/i.test(text)) {
    return { decision: "disqualified", reasons: ["requires DACA/undocumented status; student is a US citizen"], hardDqRule: "citizenship" };
  }

  // 6) Wrong field — a required major named that isn't in the student's allowed set.
  //    Only DQ when a disallowed field is scoped as required; a passing field short-circuits.
  const fieldRequired = /\b(major(?:ing)?\s+in|degree\s+in|studying|pursuing|field\s+of\s+study|students?\s+(?:in|of)|enrolled\s+in\s+(?:a\s+)?)\b/i.test(text);
  if (fieldRequired) {
    const hasAllowed = profile.allowedFields.some((f) => new RegExp("\\b" + f.replace(/[-/]/g, "[-/ ]") + "\\b", "i").test(text));
    if (hasAllowed) {
      reasons.push("an allowed field of study is named");
    } else {
      const badField = profile.disallowedFields.find((f) => new RegExp("\\b" + f.replace(/[-/]/g, "[-/ ]") + "\\b", "i").test(text));
      if (badField) {
        return { decision: "disqualified", reasons: [`requires an unrelated field: ${badField}`], hardDqRule: "wrong-field" };
      }
      // a field is required but neither clearly allowed nor clearly disallowed → ambiguous
      return { decision: "ambiguous", reasons: ["a field of study is required but not clearly matched — adjudicate"] };
    }
  }

  // Passed every hard rule. If we found at least one positive scope signal, call it pass;
  // otherwise ambiguous (open-looking, but nothing affirmatively matched → cheap adjudication).
  if (reasons.length) return { decision: "pass", reasons };
  return { decision: "ambiguous", reasons: ["no disqualifier found, but nothing affirmatively matched — adjudicate"] };
}
