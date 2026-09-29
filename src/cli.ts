import { readFile, writeFile } from 'node:fs/promises';
import { discover, trackKey } from './pipeline.ts';
import { SOURCES, type Reach } from './sources/registry.ts';
import { FEEDS, fetchFeed } from './sources/rss.ts';

const HISTORY_PATH = new URL('../data/history.json', import.meta.url);

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function loadHistory(): Promise<Set<string>> {
  try { return new Set(JSON.parse(await readFile(HISTORY_PATH, 'utf8')) as string[]); }
  catch { return new Set(); }
}

async function probeFeeds() {
  console.log('Feed extraction hit rate\n');
  for (const f of FEEDS) {
    try {
      const { candidates, itemsSeen } = await fetchFeed(f.name, f.url);
      const pct = itemsSeen ? Math.round((100 * candidates.length) / itemsSeen) : 0;
      console.log(`  ${f.name.padEnd(16)} ${String(candidates.length).padStart(3)}/${String(itemsSeen).padEnd(4)} (${pct}%)`);
    } catch (err) {
      console.log(`  ${f.name.padEnd(16)} FAILED: ${(err as Error).message}`);
    }
  }
}

function bar(n: number, total: number, width = 18): string {
  const filled = total ? Math.round((n / total) * width) : 0;
  return '█'.repeat(filled) + '·'.repeat(width - filled);
}

async function main() {
  if (process.argv.includes('--probe-feeds')) return probeFeeds();

  const storefront = arg('storefront', 'us');
  const target = Number(arg('tracks', '15'));
  const years = arg('years', '1968,1979,1985,1994,2003,2014').split(',').map(Number);
  const history = await loadHistory();

  console.log(`Discovering ${target} tracks · storefront=${storefront} · history=${history.size}`);
  console.log(`Sources registered: ${Object.keys(SOURCES).length} + ${FEEDS.length} editorial feeds\n`);

  const t0 = Date.now();
  const result = await discover({
    storefront,
    targetTracks: target,
    maxPerArtist: Number(arg('max-per-artist', '1')),
    maxSourceShare: Number(arg('max-source-share', '0.25')),
    reachMix: {
      popular: Number(arg('popular', '0.4')),
      mid: Number(arg('mid', '0.4')),
      niche: Number(arg('niche', '0.2')),
    } as Record<Reach, number>,
    billboardYears: years,
    history,
  });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const s = result.stats;

  console.log('Candidates by source');
  for (const [src, n] of Object.entries(s.bySource).sort((a, b) => b[1] - a[1])) {
    const d = SOURCES[src];
    const label = d ? `${d.reach.padEnd(7)} ${d.genres.slice(0, 30)}` : 'editorial';
    console.log(`  ${src.padEnd(15)} ${String(n).padStart(4)}  ${label}`);
  }

  console.log('\nFunnel');
  console.log(`  raw ${s.rawCandidates} -> merged ${s.afterMerge} -> after history ${s.afterHistory}` +
              ` -> after caps ${s.afterCaps} -> attempted ${s.attempted}`);
  console.log(`  resolved ${s.resolved} · not in storefront ${s.unavailableInStorefront} · unmatched ${s.unmatched}`);

  console.log('\nReach mix achieved (target 40/40/20)');
  for (const r of ['popular', 'mid', 'niche']) {
    const n = s.reachAchieved[r] ?? 0;
    console.log(`  ${r.padEnd(8)} ${String(n).padStart(2)}  ${bar(n, result.tracks.length)}`);
  }

  console.log('\nGenre spread');
  for (const [g, n] of Object.entries(s.genreSpread).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${g.padEnd(22)} ${String(n).padStart(2)}  ${bar(n, result.tracks.length)}`);
  }

  console.log('\nEra spread');
  for (const [e, n] of Object.entries(s.eraSpread).sort()) {
    console.log(`  ${e.padEnd(8)} ${String(n).padStart(2)}  ${bar(n, result.tracks.length)}`);
  }

  console.log(`\nPlaylist (${result.tracks.length} tracks, ${secs}s)\n`);
  result.tracks.forEach((t, i) => {
    const srcs = [...new Set(t.endorsements.map((e) => e.source))];
    const reach = SOURCES[t.source]?.reach ?? '?';
    console.log(`${String(i + 1).padStart(2)}. ${t.appleArtist} — ${t.appleTitle}`);
    console.log(`    ${(t.genre ?? '?')} · ${(t.releaseDate ?? '').slice(0, 4)} · ${reach} · via ${srcs.join(' + ')}`);
    const blurb = t.endorsements.find((e) => e.blurb)?.blurb;
    if (blurb) console.log(`    "${blurb.slice(0, 120)}${blurb.length > 120 ? '…' : ''}"`);
  });

  if (process.argv.includes('--commit')) {
    const next = new Set(history);
    for (const t of result.tracks) next.add(trackKey(t.artist, t.title));
    await writeFile(HISTORY_PATH, JSON.stringify([...next]));
    console.log(`\nHistory: ${history.size} -> ${next.size}`);
  } else {
    console.log('\n(dry run — pass --commit to record these)');
  }
}

main().catch((err) => { console.error('failed:', err); process.exit(1); });
