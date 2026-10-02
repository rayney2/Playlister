import { fetchJson, sleep } from '../lib/http.ts';

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

/**
 * Reject playlists that are dumps rather than selections.
 *
 * A 918-track "Disco Soul Dance Funk & HipHop Hits 70's" and a 70-track
 * "Krautrock Essentials" are not comparable evidence. The first is a bucket
 * someone poured music into; the second is a set of decisions.
 */
function isWorthHarvesting(p: DzPlaylist): boolean {
  const n = p.nb_tracks ?? 0;
  return n >= 8 && n <= 200;
}

export async function harvestTerm(term: string, maxPlaylists = 12, perPlaylistTracks = 100): Promise<HarvestedPlaylist[]> {
  const search = await fetchJson<{ data?: DzPlaylist[] }>(
    `https://api.deezer.com/search/playlist?q=${encodeURIComponent(term)}&limit=50`,
  );
  const picked = (search.data ?? []).filter(isWorthHarvesting).slice(0, maxPlaylists);

  const out: HarvestedPlaylist[] = [];
  for (const p of picked) {
    try {
      const body = await fetchJson<{ data?: DzTrack[] }>(
        `https://api.deezer.com/playlist/${p.id}/tracks?limit=${perPlaylistTracks}`,
      );
      const tracks = (body.data ?? [])
        .filter((t) => t.title && t.artist?.name)
        .map((t) => ({ artist: t.artist!.name!.trim(), title: t.title!.trim() }));
      if (tracks.length >= 8) out.push({ id: p.id, title: p.title, term, tracks });
    } catch { /* skip playlist */ }
    await sleep(220);
  }
  return out;
}

export async function harvestTerms(terms: string[], maxPlaylists = 12): Promise<HarvestedPlaylist[]> {
  const out: HarvestedPlaylist[] = [];
  for (const term of terms) {
    try {
      const got = await harvestTerm(term, maxPlaylists);
      out.push(...got);
      const tracks = got.reduce((n, p) => n + p.tracks.length, 0);
      console.log(`  ${term.padEnd(20)} ${String(got.length).padStart(3)} playlists · ${tracks} tracks`);
    } catch {
      console.log(`  ${term.padEnd(20)} failed`);
    }
    await sleep(220);
  }
  return out;
}
