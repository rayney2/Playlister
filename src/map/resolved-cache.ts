import { readFile, writeFile } from 'node:fs/promises';

/**
 * A persistent record of which map tracks exist on Apple Music.
 *
 * Why a cache rather than resolving during the walk: iTunes tolerates roughly 20
 * requests a minute, so resolving a 9,000-track map takes about an hour. That is
 * fine on a schedule and impossible inside a request. It is also pure waste to
 * redo - whether Apple has a 1982 Junko Ohashi record does not change daily.
 *
 * Negative results are stored too. Without that, every run would retry the same
 * thousands of misses forever.
 */

export interface ResolvedEntry {
  /** null means confirmed absent from the storefront. */
  apple: null | {
    trackId: number;
    artist: string;
    title: string;
    url: string;
    genre?: string;
    releaseDate?: string;
    matchMethod: 'exact' | 'fuzzy';
  };
  checkedAt: string;
}

export type ResolvedCache = Record<string, ResolvedEntry>;

const PATH = new URL('../../data/resolved.json', import.meta.url);

export async function loadCache(): Promise<ResolvedCache> {
  try { return JSON.parse(await readFile(PATH, 'utf8')) as ResolvedCache; }
  catch { return {}; }
}

export async function saveCache(cache: ResolvedCache): Promise<void> {
  await writeFile(PATH, JSON.stringify(cache));
}

/** Keys the walk is allowed to visit: present on Apple Music. */
export function playableKeys(cache: ResolvedCache): Set<string> {
  const out = new Set<string>();
  for (const [key, entry] of Object.entries(cache)) if (entry.apple) out.add(key);
  return out;
}
