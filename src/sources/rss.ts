import { fetchText } from '../lib/http.ts';
import type { Candidate } from '../lib/types.ts';

/** Editorial feeds that respond to a bot User-Agent. Verified 2026-09-29. */
export const FEEDS: Array<{ name: string; url: string }> = [
  { name: 'Pitchfork', url: 'https://pitchfork.com/rss/news/' },
  { name: 'Stereogum', url: 'https://www.stereogum.com/feed/' },
  { name: 'Bandcamp Daily', url: 'https://daily.bandcamp.com/feed' },
  { name: 'NPR Music', url: 'https://feeds.npr.org/1039/rss.xml' },
];
// Known-bad: pitchfork.com/feed/feed-best-new-*/rss and /rss/reviews/best/tracks/
// both 404 as of 2026-09-29. thequietus.com/feed/ returns 403 to a bot UA.

interface RssItem {
  title: string;
  link?: string;
  description?: string;
  pubDate?: string;
}

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Reject sentence fragments masquerading as an artist name. */
function looksLikeArtist(name: string): boolean {
  const words = name.trim().split(/\s+/);
  if (words.length > 5) return false;
  return !/\b(haunt|sing|star|join|announce|cover|perform|talk|play|share|release|feature)s?\b/i.test(name);
}

function parseRss(xml: string): RssItem[] {
  const items: RssItem[] = [];
  // Handles both RSS <item> and Atom <entry>.
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/g) ?? [];
  for (const b of blocks) {
    const pick = (tag: string) => {
      const m = b.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
      return m ? decode(m[1]) : undefined;
    };
    const title = pick('title');
    if (!title) continue;
    const hrefMatch = b.match(/<link[^>]*href="([^"]+)"/i);
    items.push({
      title,
      link: pick('link') || hrefMatch?.[1],
      description: pick('description') || pick('summary') || pick('content'),
      pubDate: pick('pubDate') || pick('updated') || pick('published'),
    });
  }
  return items;
}

const QUOTE = '["“‘’”]';

/**
 * Pull an artist + track out of an editorial headline.
 *
 * Editorial feeds are prose, not structured data, so this is best-effort and
 * every result carries a confidence below 1. Headlines that don't announce a
 * specific song (interviews, album reviews, lists) return null rather than a
 * guess — a wrong artist/title poisons the resolver and the story.
 */
export function extractTrack(headline: string): { artist: string; title: string; confidence: number } | null {
  const h = headline.trim();

  // "Artist – "Title"" / "Artist: "Title"" — Stereogum's standard track post.
  let m = h.match(new RegExp(`^(.{2,60}?)\\s*[–—:-]\\s*${QUOTE}(.{1,80}?)${QUOTE}\\s*$`));
  if (m) return { artist: m[1].trim(), title: m[2].trim(), confidence: 0.75 };

  // "Artist Shares/Releases/Drops (New) (Song|Single|Track) "Title""
  m = h.match(
    new RegExp(
      `^(.{2,60}?)\\s+(?:shares?|releases?|drops?|unveils?|debuts?|announces?[^"“]*?,\\s*shares?)\\s+` +
      `(?:a\\s+|the\\s+|new\\s+|first\\s+)*(?:song|single|track|video)?\\s*${QUOTE}(.{1,80}?)${QUOTE}`,
      'i',
    ),
  );
  if (m) return { artist: m[1].trim(), title: m[2].trim(), confidence: 0.65 };

  // "Listen to Artist's new song "Title"". The artist group is deliberately
  // tight and guarded: a looser earlier version matched an entire sentence
  // ("Taylor Swift Haunt Dakota Johnson and Colin Farrell in") as the artist.
  m = h.match(
    new RegExp(`^(?:listen to|watch|hear)\\s+([^,"\u201c]{2,40}?)(?:'s|\u2019s)\\s+(?:new\\s+)?(?:song|single|track|video)\\s*${QUOTE}(.{1,80}?)${QUOTE}`, 'i'),
  );
  if (m && looksLikeArtist(m[1])) return { artist: m[1].trim(), title: m[2].trim(), confidence: 0.6 };

  return null;
}

/** Fetch one feed and return only the items we could parse into a track. */
export async function fetchFeed(name: string, url: string): Promise<{ candidates: Candidate[]; itemsSeen: number }> {
  const items = parseRss(await fetchText(url));
  const candidates: Candidate[] = [];
  for (const it of items) {
    const parsed = extractTrack(it.title);
    if (!parsed) continue;
    candidates.push({
      artist: parsed.artist,
      title: parsed.title,
      source: name,
      // The article body is the critic's own words: prime grounding material.
      blurb: it.description?.slice(0, 600) || it.title,
      sourceUrl: it.link,
      seenAt: it.pubDate ? new Date(it.pubDate).toISOString() : undefined,
      confidence: parsed.confidence,
    });
  }
  return { candidates, itemsSeen: items.length };
}
