import { readFile, writeFile } from 'node:fs/promises';
import { norm } from '../lib/normalize.ts';
import { fetchSimilarArtists } from '../sources/lastfm.ts';
import { mapLimit } from '../lib/concurrent.ts';

/**
 * Artist-level fallback edges, from Last.fm.
 *
 * Co-occurrence is the better signal - a person placed two specific tracks
 * together - but the map is 206 disconnected components, so a walk routinely runs
 * out of co-occurrence options while plenty of fitting music sits in another
 * component. A post-punk chain stopped honestly at 5 steps for exactly this reason.
 *
 * Last.fm's similarity is derived from listener TAGGING rather than playback, which
 * keeps it closer to the human-curation premise than a behavioural similarity
 * engine. It replaces Spotify's related-artists, which returns 403 for new apps.
 *
 * Used only as a last resort, and labelled differently in the chain output so the
 * story never claims a person sequenced two tracks when nobody did.
 */

export type SimilarIndex = Record<string, Array<{ artist: string; match: number }>>;

const PATH = new URL('../../data/similar.json', import.meta.url);

export async function loadSimilar(): Promise<SimilarIndex> {
  try { return JSON.parse(await readFile(PATH, 'utf8')) as SimilarIndex; }
  catch { return {}; }
}

export async function saveSimilar(index: SimilarIndex): Promise<void> {
  await writeFile(PATH, JSON.stringify(index));
}

/** Last.fm asks for at most ~5 requests/second; 4 in flight stays polite. */
const CONCURRENCY = 4;

export async function buildSimilarIndex(
  artists: string[],
  apiKey: string,
  existing: SimilarIndex = {},
  onProgress?: (done: number, total: number) => void,
): Promise<SimilarIndex> {
  const index: SimilarIndex = { ...existing };
  const todo = artists.filter((a) => !(norm(a) in index));
  let done = 0;

  await mapLimit(todo, CONCURRENCY, async (artist) => {
    try {
      const similar = await fetchSimilarArtists(artist, apiKey, 20);
      index[norm(artist)] = similar
        .filter((s) => s.match > 0.1) // below this the suggestions are noise
        .map((s) => ({ artist: s.artist, match: s.match }));
    } catch {
      index[norm(artist)] = []; // cache the failure so we don't retry forever
    }
    done++;
    if (onProgress && done % 100 === 0) onProgress(done, todo.length);
  });

  return index;
}

/** Match strength between two artist names, 0 if unrelated. */
export function similarity(index: SimilarIndex, a: string, b: string): number {
  const list = index[norm(a)];
  if (!list) return 0;
  const nb = norm(b);
  for (const s of list) if (norm(s.artist) === nb) return s.match;
  return 0;
}
