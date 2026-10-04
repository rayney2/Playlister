import { readFile } from 'node:fs/promises';
import { buildAdjacency, type MusicMap } from './map/cooccurrence.ts';
import { buildSimilarIndex, loadSimilar, saveSimilar } from './map/similar-artists.ts';

// Builds the artist-similarity index for artists the walk can actually reach.
// Resumable: already-indexed artists are skipped.

const key = process.env.LASTFM_API_KEY;
if (!key) { console.error('LASTFM_API_KEY not set — see ACCESS.md'); process.exit(1); }

const map = JSON.parse(await readFile(new URL('../data/map.json', import.meta.url), 'utf8')) as MusicMap;
const adj = buildAdjacency(map);

// Only artists of CONNECTED tracks matter; an isolated node is unreachable.
const artists = [...new Set([...adj.keys()].map((k) => map.nodes[k]?.artist).filter(Boolean) as string[])];
const existing = await loadSimilar();
const todo = artists.filter((a) => !(a.toLowerCase() in existing));

console.log(`Connected tracks: ${adj.size.toLocaleString()} across ${artists.length.toLocaleString()} artists`);
console.log(`Already indexed: ${Object.keys(existing).length.toLocaleString()}`);
console.log(`Fetching ${artists.length - Object.keys(existing).length} more...\n`);

const t0 = Date.now();
const index = await buildSimilarIndex(artists, key, existing, (done, total) => {
  console.log(`  ${done}/${total} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
});
await saveSimilar(index);

const withLinks = Object.values(index).filter((l) => l.length > 0).length;
console.log(`\nIndexed ${Object.keys(index).length.toLocaleString()} artists · ${withLinks.toLocaleString()} have similar artists · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
