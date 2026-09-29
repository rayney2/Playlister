import { fetchJson, sleep } from '../lib/http.ts';
import type { Candidate } from '../lib/types.ts';

// ABC (Australia) exposes real play logs with no key. Different national taste,
// which is breadth no US station can give us.
const STATIONS: Array<{ sourceId: string; station: string }> = [
  { sourceId: 'abc_doublej',   station: 'doublej' },
  { sourceId: 'abc_unearthed', station: 'unearthed' },
];

interface Play {
  recording?: { title?: string; artists?: Array<{ name?: string }> };
  played_time?: string;
}

export async function fetchAbc(perStation = 40): Promise<Map<string, Candidate[]>> {
  const out = new Map<string, Candidate[]>();
  for (const { sourceId, station } of STATIONS) {
    try {
      const page = await fetchJson<{ items?: Play[] }>(
        `https://music.abcradio.net.au/api/v1/plays/search.json?station=${station}&limit=${perStation}`,
      );
      const cands: Candidate[] = [];
      for (const p of page.items ?? []) {
        const title = p.recording?.title?.trim();
        const artist = p.recording?.artists?.[0]?.name?.trim();
        if (!artist || !title) continue;
        cands.push({
          artist, title,
          source: sourceId,
          sourceUrl: `https://www.abc.net.au/${station}`,
          seenAt: p.played_time ?? undefined,
          confidence: 1,
        });
      }
      out.set(sourceId, cands);
    } catch {
      out.set(sourceId, []);
    }
    await sleep(250);
  }
  return out;
}
