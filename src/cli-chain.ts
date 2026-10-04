import { readFile } from 'node:fs/promises';
import { walk } from './map/chain.ts';
import { buildAdjacency, type MusicMap } from './map/cooccurrence.ts';
import { loadCache, playableKeys } from './map/resolved-cache.ts';
import { loadSimilar } from './map/similar-artists.ts';

// Walks the map built by `npm run harvest`, restricted to tracks `npm run resolve`
// has confirmed are on Apple Music. No resolution happens here, so this is fast.

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const map = JSON.parse(await readFile(new URL('../data/map.json', import.meta.url), 'utf8')) as MusicMap;
const adj = buildAdjacency(map);
const cache = await loadCache();
const playable = playableKeys(cache);
const usePlayable = !process.argv.includes('--any');

const connected = adj.size;
const connectedPlayable = [...adj.keys()].filter((k) => playable.has(k)).length;
console.log(`Map: ${map.stats.uniqueTracks.toLocaleString()} tracks · ${map.stats.keptEdges.toLocaleString()} edges · ${connected.toLocaleString()} connected`);
console.log(`Confirmed playable among connected: ${connectedPlayable.toLocaleString()}`);
if (usePlayable && connectedPlayable < 20) {
  console.log('\nToo few confirmed-playable tracks to walk. Run `npm run resolve` first,');
  console.log('or pass --any to walk unresolved tracks (chain may contain unplayable picks).');
  process.exit(0);
}

const similar = process.argv.includes('--no-similar') ? undefined : await loadSimilar();
if (similar) console.log(`Similar-artist index: ${Object.keys(similar).length.toLocaleString()} artists`);

// A fixed seed makes A/B comparisons meaningful; without it every run starts
// somewhere different and flag effects are indistinguishable from seed luck.
const deterministic = process.argv.includes('--deterministic');
const rng = deterministic ? () => 0 : Math.random;

const chain = walk(map, {
  length: Number(arg('length', '12')),
  hopsPerGenre: Number(arg('hops-per-genre', '4')),
  maxGenres: Number(arg('max-genres', '3')),
  playable: usePlayable ? playable : undefined,
  seedTerm: process.argv.includes('--seed-term') ? arg('seed-term', '') : undefined,
  similar,
}, undefined, rng);

if (!chain.length) {
  console.log('\nWalk produced nothing — no suitable seed. Harvest more playlists.');
  process.exit(0);
}

const genres = new Set(chain.flatMap((s) => s.node.terms));
const bridges = chain.filter((s) => s.via === 'similar-artist').length;
console.log(`\nChain: ${chain.length} steps · ${chain.filter((s) => s.isPivot).length} pivots · ${bridges} similarity bridges · terms: ${[...genres].join(', ')}\n`);

chain.forEach((s, i) => {
  const entry = cache[s.node.key]?.apple;
  const name = entry ? `${entry.artist} — ${entry.title}` : `${s.node.artist} — ${s.node.title}`;
  const meta = entry ? `${entry.genre ?? '?'} · ${(entry.releaseDate ?? '').slice(0, 4)}` : 'unresolved';
  console.log(`${String(i + 1).padStart(2)}. ${name}`);
  console.log(`    ${meta}`);
  if (i > 0) {
    const tag = s.via === 'similar-artist' ? 'BRIDGE' : s.isPivot ? 'PIVOT ' : 'link  ';
    const score = s.via === 'similar-artist' ? '' : `  [pmi ${s.pmi.toFixed(1)}]`;
    console.log(`    ${tag}: ${s.reason}${score}`);
  }
});

console.log('\nThese hop reasons are the story layer\'s spine — each one is a human-made');
console.log('connection we can cite rather than a similarity score we have to explain.');
