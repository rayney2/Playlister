import { fetchJson, sleep } from '../lib/http.ts';
import type { Candidate } from '../lib/types.ts';

// api.deezer.com is free and needs no key.
//
// Deezer localises artist names by request locale (Khruangbin comes back as
// クルアンビン, Bonobo as ボノボ). Those strings still resolve against iTunes often
// enough to be worth keeping, but they are why confidence here is below 1.

interface DzTrack { id: number; title: string; artist?: { name?: string }; rank?: number }
interface DzList { data?: DzTrack[] }
interface DzGenre { id: number; name: string }

/** Chart tracks per genre. The popular end of the catalogue, by design. */
export async function fetchDeezerCharts(genreLimit = 10, perGenre = 8): Promise<Candidate[]> {
  const genres = await fetchJson<{ data?: DzGenre[] }>('https://api.deezer.com/genre');
  const out: Candidate[] = [];
  for (const g of (genres.data ?? []).slice(0, genreLimit)) {
    try {
      const list = await fetchJson<DzList>(`https://api.deezer.com/chart/${g.id}/tracks?limit=${perGenre}`);
      for (const t of list.data ?? []) {
        if (!t.title || !t.artist?.name) continue;
        out.push({
          artist: t.artist.name.trim(),
          title: t.title.trim(),
          source: 'deezer_chart',
          blurb: `Currently charting in Deezer's ${g.name} genre.`,
          sourceUrl: `https://www.deezer.com/track/${t.id}`,
          confidence: 0.9,
        });
      }
    } catch { /* skip this genre */ }
    await sleep(250);
  }
  return out;
}

/** Deezer's own staff playlists. Themed human curation rather than raw charts. */
export async function fetchDeezerEditorial(playlistLimit = 5, perPlaylist = 8): Promise<Candidate[]> {
  const out: Candidate[] = [];
  try {
    const charts = await fetchJson<{ playlists?: { data?: Array<{ id: number; title: string }> } }>(
      'https://api.deezer.com/editorial/0/charts',
    );
    for (const pl of (charts.playlists?.data ?? []).slice(0, playlistLimit)) {
      try {
        const tracks = await fetchJson<DzList>(`https://api.deezer.com/playlist/${pl.id}/tracks?limit=${perPlaylist}`);
        for (const t of tracks.data ?? []) {
          if (!t.title || !t.artist?.name) continue;
          out.push({
            artist: t.artist.name.trim(),
            title: t.title.trim(),
            source: 'deezer_edit',
            blurb: `Picked for Deezer's "${pl.title}" playlist.`,
            sourceUrl: `https://www.deezer.com/playlist/${pl.id}`,
            confidence: 0.9,
          });
        }
      } catch { /* skip */ }
      await sleep(250);
    }
  } catch { /* editorial unavailable */ }
  return out;
}
