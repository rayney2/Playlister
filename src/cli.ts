import { readFile, writeFile } from 'node:fs/promises';
import { discover, trackKey } from './pipeline.ts';
import { FEEDS, extractTrack, fetchFeed } from './sources/rss.ts';

const HISTORY_PATH = new URL('../data/history.json', import.meta.url);

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function loadHistory(): Promise<Set<string>> {
  try {
    const keys = JSON.parse(await readFile(HISTORY_PATH, 'utf8')) as string[];
    return new Set(keys);
  } catch {
    return new Set(); // first run
  }
}

/** Diagnostic: how well does headline extraction actually work per feed? */
async function probeFeeds() {
  console.log('Feed extraction hit rate\n');
  for (const f of FEEDS) {
    try {
      const { candidates, itemsSeen } = await fetchFeed(f.name, f.url);
      const pct = itemsSeen ? Math.round((100 * candidates.length) / itemsSeen) : 0;
      console.log(`  ${f.name.padEnd(16)} ${String(candidates.length).padStart(3)}/${String(itemsSeen).padEnd(4)} tracks (${pct}%)`);
      for (const c of candidates.slice(0, 3)) {
        console.log(`      · ${c.artist} — ${c.title}  [conf ${c.confidence}]`);
      }
    } catch (err) {
      console.log(`  ${f.name.padEnd(16)} FAILED: ${(err as Error).message}`);
    }
  }
}

async function main() {
  if (process.argv.includes('--probe-feeds')) return probeFeeds();

  const storefront = arg('storefront', 'us');
  const target = Number(arg('tracks', '12'));
  const maxPerArtist = Number(arg('max-per-artist', '2'));
  const history = await loadHistory();

  console.log(`Discovering ${target} tracks · storefront=${storefront} · history=${history.size} known tracks\n`);
  const t0 = Date.now();
  const result = await discover({ storefront, targetTracks: target, maxPerArtist, history });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  const s = result.stats;
  console.log('Funnel');
  for (const [src, n] of Object.entries(s.bySource)) console.log(`  ${src.padEnd(16)} ${n} candidates`);
  console.log(`  ${'—'.repeat(30)}`);
  console.log(`  raw                ${s.rawCandidates}`);
  console.log(`  after merge        ${s.afterMerge}`);
  console.log(`  after history      ${s.afterHistory}`);
  console.log(`  after artist cap   ${s.afterArtistCap}`);
  console.log(`  resolve attempted  ${s.attempted}`);
  console.log(`  resolved           ${s.resolved}`);
  console.log(`  not in storefront  ${s.unavailableInStorefront}`);
  console.log(`  unmatched          ${s.unmatched}`);

  console.log(`\nPlaylist (${result.tracks.length} tracks, ${secs}s)\n`);
  result.tracks.forEach((t, i) => {
    const sources = t.endorsements.map((e) => e.source).join(' + ');
    console.log(`${String(i + 1).padStart(2)}. ${t.appleArtist} — ${t.appleTitle}`);
    console.log(`    ${sources}${t.matchMethod === 'fuzzy' ? '  (fuzzy match)' : ''}`);
    const blurb = t.endorsements.find((e) => e.blurb)?.blurb;
    if (blurb) console.log(`    "${blurb.slice(0, 150)}${blurb.length > 150 ? '…' : ''}"`);
    console.log(`    ${t.appleUrl.split('?')[0]}`);
  });

  if (result.unmatched.length) {
    console.log(`\nCould not find in Apple Music (${result.unmatched.length}):`);
    for (const u of result.unmatched.slice(0, 10)) {
      console.log(`  · ${u.artist} — ${u.title}  [${u.endorsements.map((e) => e.source).join(',')}]`);
    }
  }
  if (result.unavailable.length) {
    console.log(`\nExists but not in "${storefront}" storefront (${result.unavailable.length}):`);
    for (const u of result.unavailable.slice(0, 10)) {
      console.log(`  · ${u.appleArtist} — ${u.appleTitle}`);
    }
  }

  // Remember what we surfaced so the next run recommends different music.
  if (process.argv.includes('--commit')) {
    const next = new Set(history);
    for (const t of result.tracks) next.add(trackKey(t.artist, t.title));
    await writeFile(HISTORY_PATH, JSON.stringify([...next], null, 0));
    console.log(`\nHistory updated: ${history.size} -> ${next.size} tracks.`);
  } else {
    console.log('\n(dry run — pass --commit to record these in history)');
  }
}

main().catch((err) => {
  console.error('failed:', err);
  process.exit(1);
});
