import { fetchKexp } from './sources/kexp.ts';
import { FEEDS, fetchFeed } from './sources/rss.ts';
import { fetchBbc } from './sources/bbc.ts';
import { fetchAbc } from './sources/abc.ts';
import { fetchSomaFm } from './sources/somafm.ts';
import { fetchDeezerCharts, fetchDeezerEditorial } from './sources/deezer.ts';
import { fetchBillboardYears } from './sources/billboard.ts';
import { SOURCES, type Reach } from './sources/registry.ts';
import { capPerArtist, excludeHeard, mergeCandidates, norm, trackKey } from './lib/normalize.ts';
import { resolveTracks, type ResolveReport } from './resolve/itunes.ts';
import type { Candidate, MergedCandidate } from './lib/types.ts';

export interface DiscoverOptions {
  storefront: string;
  targetTracks: number;
  maxPerArtist: number;
  /** Ceiling on any one source's share of the attempted pool (ADR-007). */
  maxSourceShare: number;
  /** Target mix across the obscure-to-mainstream axis. Must sum to ~1. */
  reachMix: Record<Reach, number>;
  /** Years to sample from Billboard's Year-End Hot 100 (ADR-006). */
  billboardYears: number[];
  history: Set<string>;
}

export interface DiscoverResult {
  tracks: ResolveReport['resolved'];
  unmatched: MergedCandidate[];
  unavailable: ResolveReport['unavailable'];
  stats: {
    bySource: Record<string, number>;
    rawCandidates: number;
    afterMerge: number;
    afterHistory: number;
    afterCaps: number;
    attempted: number;
    resolved: number;
    unavailableInStorefront: number;
    unmatched: number;
    reachAchieved: Record<string, number>;
    genreSpread: Record<string, number>;
    eraSpread: Record<string, number>;
  };
}

/** Which registry entry a candidate came from. */
function reachOf(sourceId: string): Reach {
  return SOURCES[sourceId]?.reach ?? 'niche';
}

/**
 * Cap how much any single source contributes.
 *
 * Without this, KEXP's ~90 candidates swamp a source that contributes six, and
 * the playlist is one station's taste no matter how many sources are wired up.
 */
function capPerSource<T extends { source: string }>(items: T[], maxShare: number, poolSize: number): T[] {
  const max = Math.max(1, Math.floor(poolSize * maxShare));
  const counts = new Map<string, number>();
  const kept: T[] = [];
  for (const item of items) {
    const n = counts.get(item.source) ?? 0;
    if (n >= max) continue;
    counts.set(item.source, n + 1);
    kept.push(item);
  }
  return kept;
}

/**
 * Interleave by reach so the attempted pool matches the requested mix.
 *
 * Resolution is the slow, rate-limited step, so the mix has to be applied BEFORE
 * resolving. Picking a nice mix afterwards would mean resolving hundreds of
 * tracks to throw most away.
 */
function applyReachMix(items: MergedCandidate[], mix: Record<Reach, number>, total: number): MergedCandidate[] {
  const buckets: Record<Reach, MergedCandidate[]> = { popular: [], mid: [], niche: [] };
  for (const it of items) buckets[reachOf(it.source)].push(it);

  const out: MergedCandidate[] = [];
  for (const reach of ['popular', 'mid', 'niche'] as Reach[]) {
    const want = Math.round(total * (mix[reach] ?? 0));
    out.push(...buckets[reach].slice(0, want));
  }
  // If a bucket was short, backfill from whatever is left rather than under-filling.
  if (out.length < total) {
    const used = new Set(out);
    for (const it of items) {
      if (out.length >= total) break;
      if (!used.has(it)) out.push(it);
    }
  }
  return out;
}

/**
 * Choose the final playlist from everything that resolved.
 *
 * This exists because applying the mix only when deciding what to RESOLVE is not
 * enough. The attempted pool is grouped by reach, so taking the first N resolved
 * tracks returned a playlist that was 12/15 "popular" - in one run, literally
 * Billboard's 2014 top twelve. The mix has to be enforced again here, on what
 * actually came back.
 *
 * Caps applied while filling: per source, per artist, and per genre. The genre cap
 * is what stops a chart source turning the whole playlist into Pop.
 */
function selectFinal(resolved: ResolveReport['resolved'], opts: DiscoverOptions): ResolveReport['resolved'] {
  const target = opts.targetTracks;
  const maxPerSource = Math.max(1, Math.ceil(target * opts.maxSourceShare));
  const maxPerGenre = Math.max(1, Math.ceil(target / 3));
  // Era cap. Needed because fetchBillboardYears interleaves years, but the
  // pipeline's sort by seenAt puts the most recent year back at the front, so
  // every chart pick came from one year. Capping at selection is robust to
  // whatever upstream ordering happens to be.
  const maxPerEra = Math.max(1, Math.ceil(target / 3));

  const buckets: Record<Reach, ResolveReport['resolved']> = { popular: [], mid: [], niche: [] };
  for (const t of resolved) buckets[reachOf(t.source)].push(t);

  const perSource = new Map<string, number>();
  const perGenre = new Map<string, number>();
  const perArtist = new Map<string, number>();
  const perEra = new Map<string, number>();
  const eraOf = (t: ResolveReport['resolved'][number]) =>
    t.releaseDate ? `${t.releaseDate.slice(0, 3)}0s` : 'unknown';
  const chosen: ResolveReport['resolved'] = [];

  const eligible = (t: ResolveReport['resolved'][number]) => {
    const g = t.genre ?? 'unknown';
    const a = norm(t.appleArtist);
    return (perSource.get(t.source) ?? 0) < maxPerSource
      && (perGenre.get(g) ?? 0) < maxPerGenre
      && (perArtist.get(a) ?? 0) < opts.maxPerArtist
      && (perEra.get(eraOf(t)) ?? 0) < maxPerEra;
  };
  const take = (t: ResolveReport['resolved'][number]) => {
    chosen.push(t);
    perSource.set(t.source, (perSource.get(t.source) ?? 0) + 1);
    perGenre.set(t.genre ?? 'unknown', (perGenre.get(t.genre ?? 'unknown') ?? 0) + 1);
    perArtist.set(norm(t.appleArtist), (perArtist.get(norm(t.appleArtist)) ?? 0) + 1);
    perEra.set(eraOf(t), (perEra.get(eraOf(t)) ?? 0) + 1);
  };

  // Pass 1: honour the requested reach quotas.
  for (const reach of ['popular', 'mid', 'niche'] as Reach[]) {
    const want = Math.round(target * (opts.reachMix[reach] ?? 0));
    let got = 0;
    for (const t of buckets[reach]) {
      if (got >= want || chosen.length >= target) break;
      if (!eligible(t)) continue;
      take(t); got++;
    }
  }

  // Pass 2: a bucket may have been short. Backfill from anything still eligible
  // rather than returning a playlist under the requested length.
  if (chosen.length < target) {
    for (const t of resolved) {
      if (chosen.length >= target) break;
      if (chosen.includes(t) || !eligible(t)) continue;
      take(t);
    }
  }

  // Pass 3: last resort - relax the genre cap. Era spread bends before genre
  // spread, and genre spread bends before shipping a half-empty playlist
  // (the relaxation order is the open question in ADR-007).
  if (chosen.length < target) {
    for (const t of resolved) {
      if (chosen.length >= target) break;
      if (chosen.includes(t)) continue;
      if ((perSource.get(t.source) ?? 0) >= maxPerSource) continue;
      take(t);
    }
  }

  return chosen;
}

export async function discover(opts: DiscoverOptions): Promise<DiscoverResult> {
  const raw: Candidate[] = [];
  const bySource: Record<string, number> = {};
  const add = (id: string, c: Candidate[]) => {
    bySource[id] = (bySource[id] ?? 0) + c.length;
    raw.push(...c);
  };

  // Every source is independent; one failing must not end the run.
  const jobs = await Promise.allSettled([
    fetchKexp(120).then((c) => ({ kind: 'flat' as const, id: 'kexp', c })),
    fetchSomaFm().then((c) => ({ kind: 'flat' as const, id: 'somafm', c })),
    fetchDeezerCharts().then((c) => ({ kind: 'flat' as const, id: 'deezer_chart', c })),
    fetchDeezerEditorial().then((c) => ({ kind: 'flat' as const, id: 'deezer_edit', c })),
    fetchBillboardYears(opts.billboardYears).then((c) => ({ kind: 'flat' as const, id: 'billboard', c })),
    fetchBbc().then((m) => ({ kind: 'map' as const, m })),
    fetchAbc().then((m) => ({ kind: 'map' as const, m })),
    ...FEEDS.map((f) => fetchFeed(f.name, f.url).then((r) => ({ kind: 'flat' as const, id: f.name, c: r.candidates }))),
  ]);

  for (const j of jobs) {
    if (j.status !== 'fulfilled') { console.warn(`  ! source failed: ${j.reason}`); continue; }
    if (j.value.kind === 'flat') add(j.value.id, j.value.c);
    else for (const [id, c] of j.value.m) add(id, c);
  }

  const merged = mergeCandidates(raw);
  const fresh = excludeHeard(merged, opts.history);

  // Agreement across sources first, then parse confidence, then recency.
  fresh.sort((a, b) =>
    new Set(b.endorsements.map((e) => e.source)).size - new Set(a.endorsements.map((e) => e.source)).size ||
    b.confidence - a.confidence ||
    (b.endorsements[0]?.seenAt ?? '').localeCompare(a.endorsements[0]?.seenAt ?? ''),
  );

  // Over-fetch ~2x: some won't resolve, some won't be in the storefront.
  const poolSize = Math.ceil(opts.targetTracks * 2);
  const capped = capPerArtist(capPerSource(fresh, opts.maxSourceShare, poolSize * 2), opts.maxPerArtist);
  const attempt = applyReachMix(capped, opts.reachMix, poolSize);

  const report = await resolveTracks(attempt, opts.storefront);
  const tracks = selectFinal(report.resolved, opts);

  const tally = <T>(items: T[], key: (t: T) => string | undefined) => {
    const out: Record<string, number> = {};
    for (const i of items) { const k = key(i) ?? 'unknown'; out[k] = (out[k] ?? 0) + 1; }
    return out;
  };

  return {
    tracks,
    unmatched: report.unmatched,
    unavailable: report.unavailable,
    stats: {
      bySource,
      rawCandidates: raw.length,
      afterMerge: merged.length,
      afterHistory: fresh.length,
      afterCaps: capped.length,
      attempted: attempt.length,
      resolved: report.resolved.length,
      unavailableInStorefront: report.unavailable.length,
      unmatched: report.unmatched.length + report.errored.length,
      reachAchieved: tally(tracks, (t) => reachOf(t.source)),
      genreSpread: tally(tracks, (t) => t.genre),
      eraSpread: tally(tracks, (t) => t.releaseDate ? `${t.releaseDate.slice(0, 3)}0s` : undefined),
    },
  };
}

export { trackKey, norm };
