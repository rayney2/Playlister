import { mkdir, writeFile } from 'node:fs/promises';
import { harvestTerms } from './sources/deezer-playlists.ts';
import { buildMap } from './map/cooccurrence.ts';

// Builds the music map and writes it to disk.
//
// This is the offline half of ADR-008: slow, rate-limited work done once on a
// schedule rather than inside a voice request. Locally it writes JSON; on Workers
// the same output would go to D1 or KV.

const DEFAULT_TERMS = [
  'krautrock', 'shoegaze', 'dub reggae', 'ethio jazz', 'post punk',
  'northern soul', 'highlife', 'cumbia', 'free jazz', 'city pop',
  'no wave', 'cosmic disco', 'spiritual jazz', 'tropicalia',
  'minimal synth', 'desert blues', 'boogie funk', 'new age ambient',
];

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const terms = arg('terms', DEFAULT_TERMS.join(',')).split(',').map((t) => t.trim()).filter(Boolean);
const perTerm = Number(arg('per-term', '10'));

console.log(`Harvesting playlists for ${terms.length} terms (up to ${perTerm} playlists each)\n`);
const t0 = Date.now();
const playlists = await harvestTerms(terms, perTerm);

console.log(`\nBuilding map from ${playlists.length} playlists...`);
const map = buildMap(playlists);
const s = map.stats;
console.log(`  track instances   ${s.trackInstances.toLocaleString()}`);
console.log(`  unique tracks     ${s.uniqueTracks.toLocaleString()}`);
console.log(`  candidate pairs   ${s.rawPairs.toLocaleString()}`);
console.log(`  edges kept        ${s.keptEdges.toLocaleString()}  (seen in >=2 playlists)`);

await mkdir(new URL('../data', import.meta.url), { recursive: true });
const out = new URL('../data/map.json', import.meta.url);
await writeFile(out, JSON.stringify(map));
console.log(`\nWrote data/map.json in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

console.log('\nStrongest associations found (highest PMI):');
for (const e of map.edges.slice(0, 10)) {
  const a = map.nodes[e.a], b = map.nodes[e.b];
  console.log(`  ${e.pmi.toFixed(1)}  ${a.artist} — ${a.title}`);
  console.log(`        ↔ ${b.artist} — ${b.title}   (${e.playlists} playlists)`);
}
