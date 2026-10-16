// BigFuture detail-page reader — the eligibility text the card list doesn't carry.
//
// The harvester reads BigFuture's *card list*, which gives a name, an amount and dates and
// nothing else. So every one of its ~6,900 candidates reached the scorer with no requirements
// at all, the deterministic screen had nothing to screen, and the model was left guessing from
// a title. Measured consequence: the "2+2 Transfer Scholarship" — "Resident of Maryland",
// "Planning to transfer to a 4year institution in Maryland" — scored 80% for a Michigan resident
// and sat at the top of the ranked list with a deadline of that same day.
//
// The detail page is plain server-rendered HTML, fetchable without a browser, and states the
// requirements as a clean list. Fetching it turns an expensive guess into a free, deterministic
// disqualification. Details are cached forever (a scholarship's requirements are not a daily
// fact), so each slug is fetched once.

import { join } from "path";
import { homedir } from "os";

const CACHE_PATH = join(homedir(), ".claude", "memory", "scholarship-scout", "bigfuture-details.json");

export interface BigFutureDetail {
  requirements: string[];
  about: string | null;
  amountText: string | null;
  at: string; // ISO — when it was fetched
}

export type DetailCache = Record<string, BigFutureDetail>;

function decode(s: string): string {
  return s
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]*>/g, "")
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Pull the requirements list, the description and the authoritative award amount out of a
 * BigFuture detail page. Returns empty requirements rather than throwing on an unexpected page —
 * a layout change must degrade to "we learned nothing", never to a wrong disqualification.
 */
export function parseDetail(html: string): Omit<BigFutureDetail, "at"> {
  const requirements: string[] = [];
  // Each bullet is <li data-testid="eligibility-criteria-description-N-list-item-id">text</li>.
  const re = /data-testid="eligibility-criteria-description-\d+-list-item-id"[^>]*>([\s\S]*?)<\/li>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const text = decode(m[1]);
    if (text) requirements.push(text);
  }

  // The description sits in the last <p> before the "Win up to" block.
  let about: string | null = null;
  const winIdx = html.indexOf("Win up to");
  const pRe = /<p[^>]*>([\s\S]*?)<\/p>/g;
  let p: RegExpExecArray | null;
  while ((p = pRe.exec(html))) {
    if (winIdx >= 0 && p.index > winIdx) break;
    const text = decode(p[1]);
    if (text.length > 60) about = text;
  }

  // "Win up to</span>…>$<!-- -->2,000</div>" — React's SSR comment splits the currency symbol
  // from the digits, which is how the list-card reader ended up recording $20,002 for a $2,000
  // award. Read it from the detail page instead.
  let amountText: string | null = null;
  if (winIdx >= 0) {
    const amt = html.slice(winIdx, winIdx + 400).match(/\$(?:<!--\s*-->)?\s*([\d,]+)/);
    if (amt) amountText = `$${amt[1]}`;
  }

  return { requirements, about, amountText };
}

export async function readDetailCache(path = CACHE_PATH): Promise<DetailCache> {
  try {
    return (await Bun.file(path).json()) as DetailCache;
  } catch {
    return {};
  }
}

export async function writeDetailCache(cache: DetailCache, path = CACHE_PATH): Promise<void> {
  await Bun.write(path, JSON.stringify(cache, null, 2));
}

/** The one-line requirements text the eligibility screen reads. */
export function detailText(d: Pick<BigFutureDetail, "requirements" | "about">): string {
  return [...d.requirements, d.about ?? ""].filter(Boolean).join(". ");
}

export function slugOf(url: string): string | null {
  const m = url.match(/bigfuture\.collegeboard\.org\/scholarships\/([a-z0-9-]+)/i);
  return m ? m[1] : null;
}

/**
 * Fetch details for slugs that aren't cached yet, politely and in small batches. Failures are
 * skipped, not cached — a timeout must not become a permanent "no requirements".
 */
export async function fetchDetails(
  slugs: string[],
  cache: DetailCache,
  opts: { concurrency?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<{ cache: DetailCache; fetched: number; failed: number }> {
  const todo = [...new Set(slugs)].filter((s) => !cache[s]);
  const concurrency = opts.concurrency ?? 6;
  let fetched = 0;
  let failed = 0;

  for (let i = 0; i < todo.length; i += concurrency) {
    const batch = todo.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (slug) => {
        try {
          const res = await fetch(`https://bigfuture.collegeboard.org/scholarships/${slug}`, {
            headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" },
            signal: AbortSignal.timeout(20_000),
          });
          if (!res.ok) { failed++; return; }
          const parsed = parseDetail(await res.text());
          // Nothing recognisable on the page is a failure, not an empty requirements list.
          if (!parsed.requirements.length && !parsed.about) { failed++; return; }
          cache[slug] = { ...parsed, at: new Date().toISOString() };
          fetched++;
        } catch {
          failed++;
        }
      }),
    );
    opts.onProgress?.(Math.min(i + concurrency, todo.length), todo.length);
  }
  return { cache, fetched, failed };
}
