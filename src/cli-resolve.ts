import { walk } from './map/chain.ts';
import { buildAdjacency, type MusicMap } from './map/cooccurrence.ts';
import { loadCache, playableKeys, saveCache, type ResolvedCache } from './map/resolved-cache.ts';
import { resolveTracks } from './resolve/itunes.ts';
import { readFile } from 'node:fs/promises';
import type { MergedCandidate } from './lib/types.ts';

// Incrementally resolves map tracks against Apple Music and caches the answers.
//
// Bounded per run (--limit) and resumable, because the full map takes about an
// hour at iTunes' rate limit. Run it repeatedly; coverage accumulates.
//
// Priority is by DEGREE: a track with 14 edges is reachable from fourteen places
// in the graph, so knowing whether it is playable is worth far more than knowing
// about an isolated node the walk can never use anyway.

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const limit = Number(arg('limit', '300'));
const storefront = arg('storefront', 'us');

const map = JSON.parse(await readFile(new URL('../data/map.json', import.meta.url), 'utf8')) as MusicMap;
const adj = buildAdjacency(map);
const cache: ResolvedCache = await loadCache();

// Only tracks with edges matter - an isolated node is unreachable by the walk.
const queue = [...adj.keys()]
  .filter((k) => !cache[k] && map.nodes[k])
  .sort((a, b) => (adj.get(b)?.length ?? 0) - (adj.get(a)?.length ?? 0))
  .slice(0, limit);

const connected = adj.size;
const already = [...adj.keys()].filter((k) => cache[k]).length;
console.log(`Map: ${map.stats.uniqueTracks.toLocaleString()} tracks, ${connected.toLocaleString()} with edges`);
console.log(`Cache: ${already.toLocaleString()} of those already checked`);
console.log(`Resolving ${queue.length} more (highest degree first)...\n`);

if (!queue.length) {
  console.log('Nothing left to resolve. All connected tracks are cached.');
} else {
  const candidates: MergedCandidate[] = queue.map((k) => ({
    artist: map.nodes[k].artist,
    title: map.nodes[k].title,
    source: 'music_map',
    confidence: 1,
    endorsements: [],
  }));

  const t0 = Date.now();
  const mins = Math.ceil((queue.length * 6) / 60);
  console.log(`At ~3s per call this will take roughly ${mins} minutes. Progress saves as it goes.\n`);
  const report = await resolveTracks(candidates, storefront);
  const now = new Date().toISOString();

  // Index results back onto map keys. resolveTracks preserves artist/title, so
  // rebuilding the key from those is safe.
  const { trackKey } = await import('./lib/normalize.ts');
  const hit = new Map(report.resolved.map((t) => [trackKey(t.artist, t.title), t]));

  // Only tracks we actually learned something about get cached. Throttled and
  // failed lookups are left absent from the cache so a later run retries them -
  // caching those as "not on Apple Music" was the bug that made an earlier run
  // worthless.
  const erroredKeys = new Set(report.errored.map((c) => trackKey(c.artist, c.title)));

  let found = 0, missing = 0, skipped = 0;
  for (const k of queue) {
    const t = hit.get(k);
    if (t) {
      cache[k] = {
        apple: {
          trackId: t.appleTrackId, artist: t.appleArtist, title: t.appleTitle,
          url: t.appleUrl, genre: t.genre, releaseDate: t.releaseDate,
          matchMethod: t.matchMethod === 'isrc' ? 'exact' : t.matchMethod,
        },
        checkedAt: now,
      };
      found++;
    } else if (erroredKeys.has(k)) {
      skipped++; // deliberately NOT cached
    } else {
      cache[k] = { apple: null, checkedAt: now }; // genuinely absent
      missing++;
    }
  }

  await saveCache(cache);
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`\nFound ${found} · genuinely absent ${missing} · could not check ${skipped} (will retry) · ${secs}s`);
  if (skipped > found) {
    console.log('\nMost lookups failed rather than returned an answer — iTunes is');
    console.log('throttling. Wait a while before running again.');
  }
}

const playable = playableKeys(cache);
const connectedPlayable = [...adj.keys()].filter((k) => playable.has(k)).length;
console.log(`\nPlayable and connected: ${connectedPlayable.toLocaleString()} of ${connected.toLocaleString()} (${Math.round(100 * connectedPlayable / Math.max(1, connected))}%)`);
const remaining = connected - [...adj.keys()].filter((k) => cache[k]).length;
if (remaining > 0) console.log(`Run again to check ${remaining.toLocaleString()} more.`);
