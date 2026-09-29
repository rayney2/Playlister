import { fetchText, sleep } from '../lib/http.ts';
import type { Candidate } from '../lib/types.ts';

// Wikipedia hosts Billboard's Year-End Hot 100 for each year as a clean table.
// No key. ~100 songs per year, ~65 years available, so this is the only source
// that gives both mainstream familiarity AND deep era coverage.
//
// It is popularity canon, not curation: nobody wrote a reason for any pick, so
// these carry no story material of their own.

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function cellText(cell: string): string {
  return decodeEntities(cell.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/**
 * One year of the Year-End Hot 100.
 *
 * Table layout is [rank, title, artist]; the title cell is quoted in the source,
 * so the quotes are stripped. Rows whose first cell isn't a number are headers
 * or footnotes and get skipped.
 */
export async function fetchBillboardYear(year: number): Promise<Candidate[]> {
  const url = `https://en.wikipedia.org/api/rest_v1/page/html/Billboard_Year-End_Hot_100_singles_of_${year}`;
  const html = await fetchText(url);
  const out: Candidate[] = [];

  for (const row of html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? []) {
    const cells = (row.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/g) ?? [])
      .map((c) => cellText(c.replace(/^<t[dh][^>]*>|<\/t[dh]>$/g, '')))
      .filter(Boolean);
    if (cells.length < 3) continue;
    if (!/^\d+\.?$/.test(cells[0])) continue;

    const title = cells[1].replace(/^["'“‘]|["'”’]$/g, '').trim();
    const artist = cells[2].trim();
    if (!title || !artist) continue;

    out.push({
      artist,
      title,
      source: 'billboard',
      blurb: `Ranked #${cells[0].replace('.', '')} on Billboard's Year-End Hot 100 for ${year}.`,
      sourceUrl: url.replace('/api/rest_v1/page/html/', '/wiki/'),
      seenAt: `${year}-12-31T00:00:00Z`,
      confidence: 1,
    });
  }
  return out;
}

/**
 * Reorder one year's chart so early picks span the whole hundred.
 *
 * Taking the list in rank order means the playlist fills with #1..#12 of a single
 * year - which is exactly the music the listener is most likely to already know,
 * and the opposite of discovery. Striding samples ranks 1, 34, 67, 2, 35, ...
 * so a small sample still reaches deep into the chart.
 */
function strideByRank(items: Candidate[], buckets = 3): Candidate[] {
  const out: Candidate[] = [];
  const size = Math.ceil(items.length / buckets);
  for (let offset = 0; offset < size; offset++) {
    for (let b = 0; b < buckets; b++) {
      const item = items[b * size + offset];
      if (item) out.push(item);
    }
  }
  return out;
}

/**
 * Sample several years so the playlist spans eras rather than one decade.
 *
 * Years are interleaved round-robin. Concatenating them instead would sort one
 * year to the front and that year would win every slot.
 */
export async function fetchBillboardYears(years: number[]): Promise<Candidate[]> {
  const perYear: Candidate[][] = [];
  for (const y of years) {
    try {
      perYear.push(strideByRank(await fetchBillboardYear(y)));
    } catch { /* that year's page may be named differently */ }
    await sleep(300);
  }
  const out: Candidate[] = [];
  const longest = Math.max(0, ...perYear.map((a) => a.length));
  for (let i = 0; i < longest; i++) {
    for (const year of perYear) if (year[i]) out.push(year[i]);
  }
  return out;
}
