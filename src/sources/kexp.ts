import { fetchJson, sleep } from '../lib/http.ts';
import type { Candidate } from '../lib/types.ts';

// KEXP's v2 API is public and needs no key. It 502s on limit=100, so page by 40.
const PAGE = 40;
const BASE = 'https://api.kexp.org/v2/plays/';

interface KexpPlay {
  id: number;
  airdate: string;
  song?: string | null;
  artist?: string | null;
  album?: string | null;
  comment?: string | null;
  play_type: string;
  artist_ids?: string[] | null;
  recording_id?: string | null;
  is_local?: boolean;
  rotation_status?: string | null;
}

interface KexpPage {
  next: string | null;
  results: KexpPlay[];
}

/**
 * Recent KEXP DJ plays.
 *
 * This is the best free source of *human context*: DJs frequently leave a
 * `comment` explaining the pick, which is exactly the grounding material the
 * story step needs. Plays without a comment are still good picks, just quieter.
 */
export async function fetchKexp(limit = 120): Promise<Candidate[]> {
  const plays: KexpPlay[] = [];
  for (let offset = 0; plays.length < limit; offset += PAGE) {
    const page = await fetchJson<KexpPage>(`${BASE}?limit=${PAGE}&offset=${offset}&format=json`);
    if (!page.results?.length) break;
    plays.push(...page.results);
    if (!page.next) break;
    await sleep(350); // be a good citizen
  }

  return plays
    // "airbreak" and "nontrackplay" entries are DJ talk, not songs.
    .filter((p) => p.play_type === 'trackplay' && p.song && p.artist)
    .map((p) => ({
      artist: p.artist!.trim(),
      title: p.song!.trim(),
      album: p.album?.trim() || undefined,
      source: 'KEXP',
      blurb: p.comment?.trim() || undefined,
      sourceUrl: `https://kexp.org/playlist/${p.airdate.slice(0, 10)}/`,
      seenAt: p.airdate,
      mbidArtists: p.artist_ids ?? undefined,
      mbidRecording: p.recording_id ?? undefined,
      // Structured API fields, so the artist/title parse is certain.
      confidence: 1,
    }));
}
