import { fetchText, sleep } from '../lib/http.ts';
import type { Candidate } from '../lib/types.ts';

// SomaFM: 46 listener-supported channels, each genre-labelled. Free, no key.
// Values arrive CDATA-wrapped. No DJ commentary, so story is false.
const CHANNELS = ['groovesalad', 'bootliquor', 'bossa', 'dronezone', 'digitalis', 'indiepop'];

function tag(block: string, name: string): string | undefined {
  const m = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i'));
  if (!m) return undefined;
  return m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() || undefined;
}

export async function fetchSomaFm(): Promise<Candidate[]> {
  const out: Candidate[] = [];
  for (const ch of CHANNELS) {
    try {
      const xml = await fetchText(`https://somafm.com/songs/${ch}.xml`);
      for (const block of xml.match(/<song[^>]*>[\s\S]*?<\/song>/g) ?? []) {
        const artist = tag(block, 'artist');
        const title = tag(block, 'title');
        if (!artist || !title) continue;
        out.push({
          artist, title,
          album: tag(block, 'album'),
          source: 'somafm',
          sourceUrl: `https://somafm.com/${ch}/`,
          confidence: 1,
        });
      }
    } catch { /* skip channel */ }
    await sleep(250);
  }
  return out;
}
