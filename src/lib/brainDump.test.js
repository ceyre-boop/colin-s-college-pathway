import { expect, test, describe } from 'bun:test';
import { archetypeFor, ideasFor, needsEssay, wordLimitFrom, brainDump, dumpAsText, daysUntil } from './brainDump.js';
import { INIT_TIMELINE } from '../data/timeline.js';

const TODAY = new Date('2026-10-14T00:00:00Z');

describe('brain dump', () => {
  test('a listing that names its prompt gets the matching archetype', () => {
    expect(archetypeFor('Essay on leadership: describe a time you led a team').id).toBe('leadership');
    expect(archetypeFor('Tell us about yourself — personal statement required').id).toBe('personal-statement');
    expect(archetypeFor('For the young entrepreneur starting a business').id).toBe('why-business');
  });

  test('a blurb with no prompt signal stays unsorted instead of being guessed', () => {
    expect(archetypeFor('Barrat Scholarship. BigFuture curated (CollegeBoard).')).toBeNull();
  });

  test('a no-essay award is money, not a topic', () => {
    expect(needsEssay({ name: 'X', notes: 'Scout find (match 60%). no essay; opens 07/01.' })).toBe(false);
    expect(needsEssay({ name: 'X', notes: 'Scout find. essay required.' })).toBe(true);
  });

  test('word limits are read out of the listing when stated', () => {
    expect(wordLimitFrom('500-word essay required')).toBe(500);
    expect(wordLimitFrom('essay of 250 words')).toBe(250);
    expect(wordLimitFrom('no length given')).toBeNull();
    expect(wordLimitFrom('5 word')).toBeNull(); // out of plausible range
  });

  test('leadership pulls Eagle Scout off the real timeline, with its angle', () => {
    const ideas = ideasFor(archetypeFor('leadership essay'), INIT_TIMELINE);
    const eagle = ideas.find((e) => /eagle/i.test(e.title));
    expect(eagle).toBeTruthy();
    expect(eagle.essay).toContain('Leadership');
  });

  test('adversity pulls the athletic grind, not the coding work', () => {
    const ideas = ideasFor(archetypeFor('describe an obstacle you had to overcome'), INIT_TIMELINE);
    expect(ideas.some((e) => /black belt|wrestling/i.test(e.title))).toBe(true);
  });

  test('an unsorted listing yields no ideas rather than random ones', () => {
    expect(ideasFor(null, INIT_TIMELINE)).toEqual([]);
  });

  test('entries sort by soonest real deadline, undated ones last', () => {
    const rows = brainDump([
      { id: 'a', name: 'Leadership Award', amount: 1000, deadline: '2026-12-01', notes: 'leadership essay' },
      { id: 'b', name: 'Entrepreneur Grant', amount: 5000, deadline: null, notes: 'business essay' },
      { id: 'c', name: 'Service Prize', amount: 2000, deadline: '2026-10-20', notes: 'community service essay' },
    ], INIT_TIMELINE, { today: TODAY });
    expect(rows.map((r) => r.id)).toEqual(['c', 'a', 'b']);
    expect(rows[0].daysLeft).toBe(6);
  });

  test('finished scholarships and no-essay awards never appear', () => {
    const rows = brainDump([
      { id: 'won', name: 'Already Won', amount: 1, status: 'won', notes: 'leadership essay' },
      { id: 'none', name: 'Easy Money', amount: 1, notes: 'no essay' },
      { id: 'keep', name: 'Leadership Award', amount: 1, notes: 'leadership essay' },
    ], INIT_TIMELINE, { today: TODAY });
    expect(rows.map((r) => r.id)).toEqual(['keep']);
  });

  test('the text dump carries the prompt and the material, ready to paste', () => {
    const [row] = brainDump(
      [{ id: 'a', name: 'Leadership Award', amount: 1000, deadline: '2026-12-01', notes: '500-word leadership essay', url: 'https://x.test' }],
      INIT_TIMELINE, { today: TODAY },
    );
    const txt = dumpAsText(row);
    expect(txt).toContain('PROMPT (Leadership)');
    expect(txt).toContain('YOUR MATERIAL:');
    expect(txt).toContain('About 500 words');
    expect(txt).toContain('https://x.test');
  });

  test('an unsorted entry says to go read the real prompt', () => {
    const [row] = brainDump([{ id: 'a', name: 'Barrat Scholarship', amount: 80000, notes: 'BigFuture curated' }], INIT_TIMELINE, { today: TODAY });
    expect(row.prompt).toBeNull();
    expect(dumpAsText(row)).toContain('open the URL and read the real one');
  });

  test('daysUntil ignores a deadline that is not a date', () => {
    expect(daysUntil('verify at URL', TODAY)).toBeNull();
    expect(daysUntil(null, TODAY)).toBeNull();
  });
});

describe('year-less deadlines', () => {
  // Listings say "Jan 15" because the award is annual; reading that literally put the date in
  // 2001 and showed "-9404 days" beside a live scholarship on the first build of this tab.
  test('a month/day deadline rolls forward instead of landing in 2001', () => {
    expect(daysUntil('Jan 15', TODAY)).toBe(93);   // next 15 Jan after 14 Oct 2026
    expect(daysUntil('December 1', TODAY)).toBe(48);
  });

  test('an explicit year is still honoured exactly', () => {
    expect(daysUntil('2026-10-20', TODAY)).toBe(6);
    expect(daysUntil('11/01/2026', TODAY)).toBe(18);
  });

  test('a past dated deadline stays negative — it really did pass', () => {
    expect(daysUntil('2026-09-01', TODAY)).toBeLessThan(0);
  });
});

describe('deadline strings that are not dates', () => {
  // Scout listings frequently carry prose in the deadline slot. JS Date will happily find a
  // year inside one, so these must be rejected outright rather than shown as a countdown.
  test.each([
    'verify at URL', 'rolling', 'varies', 'Contact sponsor', 'see website 2026', '',
  ])('rejects %p', (s) => {
    expect(daysUntil(s, TODAY)).toBeNull();
  });

  test('a bare month name is still usable', () => {
    expect(daysUntil('January', TODAY)).toBeGreaterThan(0);
  });
});

describe('ordering puts live deadlines first', () => {
  // The first build sorted purely by daysLeft, so scholarships that closed months ago led the
  // list with "-107 days" while live ones sat below them.
  const rows = () => brainDump([
    { id: 'expired', name: 'Closed Leadership Award', amount: 140000, deadline: '2026-06-30', notes: 'leadership essay' },
    { id: 'undated', name: 'Undated Business Grant', amount: 50000, deadline: 'verify at URL', notes: 'business essay' },
    { id: 'live-far', name: 'Service Prize', amount: 2000, deadline: '2026-12-20', notes: 'community service essay' },
    { id: 'live-soon', name: 'Adversity Award', amount: 1000, deadline: '2026-10-20', notes: 'describe an obstacle you overcame' },
  ], INIT_TIMELINE, { today: TODAY });

  test('live deadlines lead, soonest first; expired sink to the bottom', () => {
    expect(rows().map((r) => r.id)).toEqual(['live-soon', 'live-far', 'undated', 'expired']);
  });

  test('an expired entry still reports its real negative countdown', () => {
    const expired = rows().find((r) => r.id === 'expired');
    expect(expired.daysLeft).toBeLessThan(0);
  });
});
