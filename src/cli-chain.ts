import { readFile } from 'node:fs/promises';
import { walk } from './map/chain.ts';
import { buildAdjacency, type MusicMap } from './map/cooccurrence.ts';
import { resolveTracks } from './resolve/itunes.ts';
import type { MergedCandidate } from './lib/types.ts';

// Walks the map built by `npm run harvest` and resolves the result to Apple Music.
//
// Only the chosen tracks get resolved - about 15 calls instead of thousands. That
// is the whole point of separating the offline map build from the playlist request.

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const map = JSON.parse(await readFile(new URL('../data/map.json', import.meta.url), 'utf8')) as MusicMap;
const adj = buildAdjacency(map);
const length = Number(arg('length', '12'));

console.log(`Map: ${map.stats.uniqueTracks.toLocaleString()} tracks, ${map.stats.keptEdges.toLocaleString()} edges, built ${map.builtAt.slice(0, 16)}`);
const degrees = [...adj.values()].map((l) => l.length);
console.log(`Connectivity: ${adj.size} tracks have at least one edge, max degree ${Math.max(...degrees, 0)}\n`);

const chain = walk(map, { length, requireSharedTerm: true });
if (!chain.length) { console.log('Walk produced nothing — map too sparse. Harvest more terms.'); process.exit(0); }

console.log(`Chain (${chain.length} steps)\n`);
chain.forEach((s, i) => {
  console.log(`${String(i + 1).padStart(2)}. ${s.node.artist} — ${s.node.title}`);
  console.log(`    terms: ${s.node.terms.join(', ')}`);
  if (i > 0) console.log(`    link: ${s.reason}  [pmi ${s.pmi.toFixed(1)}]`);
});

// Resolve only the chain, not the pool.
console.log('\nResolving to Apple Music...');
const candidates: MergedCandidate[] = chain.map((s) => ({
  artist: s.node.artist,
  title: s.node.title,
  source: 'music_map',
  confidence: 1,
  blurb: s.reason,
  endorsements: [{ source: 'music_map', blurb: s.reason }],
}));
const report = await resolveTracks(candidates, arg('storefront', 'us'));

console.log(`\nPlayable (${report.resolved.length}/${chain.length}):\n`);
for (const t of report.resolved) {
  console.log(`  ${t.appleArtist} — ${t.appleTitle}`);
  console.log(`     ${t.genre ?? '?'} · ${(t.releaseDate ?? '').slice(0, 4)}`);
}
if (report.unmatched.length) {
  console.log(`\nNot on Apple Music (${report.unmatched.length}): ${report.unmatched.map((u) => u.artist).join(', ')}`);
}
