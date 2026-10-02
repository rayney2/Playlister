import { fetchJson, sleep } from '../lib/http.ts';
import type { Candidate } from '../lib/types.ts';

// Last.fm. Free key, read-only. Never touches the account and never scrobbles.
//
// NOTE the response shapes - they are inconsistent and easy to get wrong:
//   tag.getTopTracks   -> { tracks: { track: [...] } }      NOT `toptracks`
//   artist.getSimilar  -> { similarartists: { artist: [...] } }
// Reading the wrong key returns zero results from a perfectly valid key, which
// looks exactly like a dead source.
const BASE = 'https://ws.audioscrobbler.com/2.0/';

function url(method: string, key: string, params: Record<string, string>): string {
  const q = new URLSearchParams({ method, api_key: key, format: 'json', ...params });
  return `${BASE}?${q}`;
}

interface LfmTrack { name?: string; artist?: { name?: string }; listeners?: string }

/**
 * Tracks carrying a genre tag.
 *
 * Tags are applied by listeners, so this is crowd curation: a human decided this
 * record is shoegaze. Good for widening the pool into specific scenes, including
 * obscure ones ("ethiopian jazz" returns Mulatu Astatke and Wallias Band).
 */
export async function fetchLastfmTag(tag: string, key: string, limit = 50): Promise<Candidate[]> {
  const body = await fetchJson<{ tracks?: { track?: LfmTrack[] } }>(
    url('tag.getTopTracks', key, { tag, limit: String(limit) }),
  );
  const out: Candidate[] = [];
  for (const t of body.tracks?.track ?? []) {
    if (!t.name || !t.artist?.name) continue;
    out.push({
      artist: t.artist.name.trim(),
      title: t.name.trim(),
      source: 'lastfm_tag',
      blurb: `Tagged "${tag}" by Last.fm listeners.`,
      sourceUrl: `https://www.last.fm/tag/${encodeURIComponent(tag)}/tracks`,
      confidence: 1,
    });
  }
  return out;
}

export async function fetchLastfmTags(tags: string[], key: string, perTag = 50): Promise<Candidate[]> {
  const out: Candidate[] = [];
  for (const tag of tags) {
    try { out.push(...await fetchLastfmTag(tag, key, perTag)); } catch { /* skip tag */ }
    await sleep(250); // Last.fm asks for max ~5 req/s; stay well under
  }
  return out;
}

/**
 * Similar artists, with a 0-1 match strength.
 *
 * Replaces Spotify's related-artists (403 for new apps). Derived from listener
 * tagging rather than playback behaviour, which suits a project built on human
 * curation. Used as a FALLBACK chain edge for tracks the co-occurrence map
 * doesn't cover yet.
 */
export async function fetchSimilarArtists(artist: string, key: string, limit = 20): Promise<Array<{ name: string; match: number }>> {
  const body = await fetchJson<{ similarartists?: { artist?: Array<{ name?: string; match?: string }> } }>(
    url('artist.getSimilar', key, { artist, limit: String(limit) }),
  );
  return (body.similarartists?.artist ?? [])
    .filter((a) => a.name)
    .map((a) => ({ name: a.name!, match: Number(a.match ?? 0) }));
}
