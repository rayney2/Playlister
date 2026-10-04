import { mkdir, writeFile } from 'node:fs/promises';
import { harvestTerms } from './sources/deezer-playlists.ts';
import { buildMap } from './map/cooccurrence.ts';

// Builds the music map and writes it to disk.
//
// This is the offline half of ADR-008: slow, rate-limited work done once on a
// schedule rather than inside a voice request. Locally it writes JSON; on Workers
// the same output would go to D1 or KV.

/**
 * Search terms grouped into SYNONYM CLUSTERS, several per scene.
 *
 * The previous vocabulary used one term per genre, which produced 132 disconnected
 * components - the walk could never leave the cluster it started in. Two measured
 * facts drive this change:
 *
 *  - An edge needs a PAIR to recur across playlists. Terms covering the same scene
 *    harvest overlapping playlist communities, so the same pairs reappear and the
 *    cluster densifies. Disjoint terms never reinforce each other.
 *  - Components merged exactly where communities overlapped (post punk with no
 *    wave, city pop with boogie funk) and stayed islands where they did not
 *    (ethio jazz, 281 tracks, almost no outside connection).
 *
 * So each line below is one scene approached from several angles. The adjacent
 * lines are also chosen to touch: "no wave" sits with post punk, "free jazz" with
 * spiritual jazz, so clusters have a chance of bridging.
 */
const TERM_CLUSTERS: Record<string, string[]> = {
  krautrock:    ['krautrock', 'kosmische', 'berlin school', 'motorik'],
  shoegaze:     ['shoegaze', 'dream pop', 'nugaze'],
  postpunk:     ['post punk', 'coldwave', 'minimal wave', 'no wave'],
  citypop:      ['city pop', 'japanese funk', 'showa boogie'],
  ethiojazz:    ['ethio jazz', 'ethiopiques', 'african jazz'],
  spiritual:    ['spiritual jazz', 'free jazz', 'astral jazz', 'modal jazz'],
  dub:          ['dub reggae', 'roots reggae', 'dubwise'],
  northernsoul: ['northern soul', 'mod soul', 'modern soul'],
  desertblues:  ['desert blues', 'tuareg guitar', 'sahel'],
  cumbia:       ['cumbia', 'chicha', 'cumbia psicodelica'],
  highlife:     ['highlife', 'afrobeat', 'afro funk'],
  boogie:       ['boogie funk', '80s boogie', 'disco funk'],
  ambient:      ['new age ambient', 'kankyo ongaku', 'ambient'],
  cosmic:       ['cosmic disco', 'italo disco', 'space disco'],
  synth:        ['minimal synth', 'synthwave', 'ebm'],
  tropicalia:   ['tropicalia', 'mpb', 'brazilian psych'],
};

const DEFAULT_TERMS = Object.values(TERM_CLUSTERS).flat();

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
