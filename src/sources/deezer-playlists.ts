import { fetchJson, sleep } from '../lib/http.ts';
import { mapLimit } from '../lib/concurrent.ts';

/**
 * Parallel playlist fetches. Deezer tolerated 8 concurrent requests with no
 * rejections in testing, and it cuts effective per-request time from ~656ms to
 * ~165ms.
 */
const CONCURRENCY = 8;

// Harvests playlists made by other people. Free, no key.
//
// Deezer caps `total` near 150 per query regardless of the term, so pool size is
// set by how many SEARCH TERMS we use, not by paging deeper. The term vocabulary
// is therefore the real knob.

export interface HarvestedPlaylist {
  id: number;
  title: string;
  /** The search term that surfaced it. Doubles as a free genre hint. */
  term: string;
  /** Tracks IN ORDER. Order matters: adjacency is stronger evidence than membership. */
  tracks: Array<{ artist: string; title: string }>;
}

interface DzPlaylist { id: number; title: string; nb_tracks?: number }
interface DzTrack { title?: string; artist?: { name?: string } }

/** Lowercase, strip everything but letters and digits. */
const flatten = (s: string | undefined) => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * Reject playlists that are dumps rather than selections, or that only matched
 * the search term incidentally.
 *
 * Size: a 918-track "Disco Soul Dance Funk & HipHop Hits 70's" and a 70-track
 * "Krautrock Essentials" are not comparable evidence. The first is a bucket
 * someone poured music into; the second is a set of decisions.
 *
 * Relevance: Deezer's relevance ranking alone let generic pop playlists in under
 * specific terms, and the map then learned nonsense - a walk seeded in "post punk"
 * produced The Bangles, Meghan Trainor, Britney Spears and OneRepublic.
 *
 * The title must contain the search term as a PHRASE, compared with punctuation
 * and spacing removed. Word-level matching was too loose: "Pop Punk Essentials"
 * matched "post punk" on the word "punk", and "Bedroom Pop" matched "dream pop"
 * on "pop". Flattening both sides means "Post-Punk Essentials" and "Dreampop"
 * still match while those two do not.
 *
 * This trades recall for precision - a genuinely good "you're dreaming" shoegaze
 * playlist gets dropped - which is the right trade when 36 playlists per term are
 * available and only 30 are wanted.
 */
function isWorthHarvesting(p: DzPlaylist, term: string): boolean {
  const n = p.nb_tracks ?? 0;
  if (n < 8 || n > 200) return false;
  return flatten(p.title).includes(flatten(term));
}

export async function harvestTerm(term: string, maxPlaylists = 12, perPlaylistTracks = 100): Promise<HarvestedPlaylist[]> {
  const search = await fetchJson<{ data?: DzPlaylist[] }>(
    `https://api.deezer.com/search/playlist?q=${encodeURIComponent(term)}&limit=50`,
  );
  const picked = (search.data ?? []).filter((p) => isWorthHarvesting(p, term)).slice(0, maxPlaylists);

  const fetched = await mapLimit(picked, CONCURRENCY, async (p) => {
    try {
      const body = await fetchJson<{ data?: DzTrack[] }>(
        `https://api.deezer.com/playlist/${p.id}/tracks?limit=${perPlaylistTracks}`,
      );
      const tracks = (body.data ?? [])
        .filter((t) => t.title && t.artist?.name)
        .map((t) => ({ artist: t.artist!.name!.trim(), title: t.title!.trim() }));
      if (tracks.length < 8) return null;
      return { id: p.id, title: p.title, term, tracks } satisfies HarvestedPlaylist;
    } catch {
      return null; // one dead playlist must not fail the term
    }
  });

  return fetched.filter((p): p is HarvestedPlaylist => p !== null);
}

export async function harvestTerms(terms: string[], maxPlaylists = 12): Promise<HarvestedPlaylist[]> {
  const out: HarvestedPlaylist[] = [];
  // Terms stay serial so progress is legible and the concurrency ceiling is
  // predictable: CONCURRENCY in flight, not CONCURRENCY x terms.
  for (const term of terms) {
    const t0 = Date.now();
    try {
      const got = await harvestTerm(term, maxPlaylists);
      out.push(...got);
      const tracks = got.reduce((n, p) => n + p.tracks.length, 0);
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      const per = got.length ? ((Date.now() - t0) / got.length / 1000).toFixed(2) : '-';
      console.log(`  ${term.padEnd(20)} ${String(got.length).padStart(3)} playlists · ${String(tracks).padStart(5)} tracks · ${secs}s (${per}s each)`);
    } catch (err) {
      console.log(`  ${term.padEnd(20)} failed: ${(err as Error).message.slice(0, 50)}`);
    }
  }
  return out;
}
