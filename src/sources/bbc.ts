import { fetchJson, sleep } from '../lib/http.ts';
import type { Candidate } from '../lib/types.ts';

// rms.api.bbc.co.uk needs no key. One endpoint shape covers every station, which
// makes this the widest genre unlock we have for the cost of one adapter.
//
// CRITICAL: titles.primary is the ARTIST and titles.secondary is the TRACK TITLE.
// That is the reverse of what the field names suggest. Swapping them produces
// candidates that look plausible and never resolve.
//
// `limit` has a low ceiling: 20 returns HTTP 400, and 10 yields about 7 segments
// (the current programme's window). So each station gives only a handful per
// call. Building volume means polling over time, which is what the scheduled
// candidate pool is for - not a bigger limit.
const STATIONS: Array<{ sourceId: string; service: string }> = [
  { sourceId: 'bbc_radio1',   service: 'bbc_radio_one' },
  { sourceId: 'bbc_radio2',   service: 'bbc_radio_two' },
  { sourceId: 'bbc_6music',   service: 'bbc_6music' },
  { sourceId: 'bbc_radio3',   service: 'bbc_radio_three' },
  { sourceId: 'bbc_1xtra',    service: 'bbc_1xtra' },
  { sourceId: 'bbc_asian',    service: 'bbc_asian_network' },
];

interface Segment {
  titles?: { primary?: string | null; secondary?: string | null };
  offset?: { start?: string | null };
}
interface SegmentPage { data?: Segment[] }

export async function fetchBbc(perStation = 10): Promise<Map<string, Candidate[]>> {
  const out = new Map<string, Candidate[]>();
  for (const { sourceId, service } of STATIONS) {
    try {
      const page = await fetchJson<SegmentPage>(
        `https://rms.api.bbc.co.uk/v2/services/${service}/segments/latest?limit=${perStation}`,
      );
      const cands: Candidate[] = [];
      for (const seg of page.data ?? []) {
        const artist = seg.titles?.primary?.trim();
        const title = seg.titles?.secondary?.trim();
        if (!artist || !title) continue;
        cands.push({
          artist,
          title,
          source: sourceId,
          sourceUrl: `https://www.bbc.co.uk/sounds/play/live:${service}`,
          confidence: 1, // structured API, so the parse is certain
        });
      }
      out.set(sourceId, cands);
    } catch {
      out.set(sourceId, []); // one dead station must not kill the run
    }
    await sleep(250);
  }
  return out;
}
