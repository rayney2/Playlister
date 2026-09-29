import { fetchKexp } from './sources/kexp.ts';
import { FEEDS, fetchFeed } from './sources/rss.ts';
import { capPerArtist, excludeHeard, mergeCandidates, trackKey } from './lib/normalize.ts';
import { resolveTracks, type ResolveReport } from './resolve/itunes.ts';
import type { Candidate, MergedCandidate } from './lib/types.ts';

export interface DiscoverOptions {
  /** The listener's Apple Music storefront, e.g. "cn" or "us". */
  storefront: string;
  /** Target playlist length. */
  targetTracks: number;
  /** Max tracks from any one artist. */
  maxPerArtist: number;
  /** Normalized track keys already heard; these are never recommended. */
  history: Set<string>;
}

export interface DiscoverResult {
  tracks: ResolveReport['resolved'];
  stats: {
    bySource: Record<string, number>;
    rawCandidates: number;
    afterMerge: number;
    afterHistory: number;
    afterArtistCap: number;
    attempted: number;
    resolved: number;
    unavailableInStorefront: number;
    unmatched: number;
  };
  unmatched: MergedCandidate[];
  unavailable: ResolveReport['unavailable'];
}

export async function discover(opts: DiscoverOptions): Promise<DiscoverResult> {
  const bySource: Record<string, number> = {};
  const raw: Candidate[] = [];

  // Sources are independent, so one failing feed must not kill the run.
  const results = await Promise.allSettled([
    fetchKexp(120).then((c) => ({ name: 'KEXP', c })),
    ...FEEDS.map((f) => fetchFeed(f.name, f.url).then((r) => ({ name: f.name, c: r.candidates }))),
  ]);

  for (const r of results) {
    if (r.status !== 'fulfilled') {
      console.warn(`  ! source failed: ${r.reason}`);
      continue;
    }
    bySource[r.value.name] = r.value.c.length;
    raw.push(...r.value.c);
  }

  const merged = mergeCandidates(raw);
  const fresh = excludeHeard(merged, opts.history);

  // Rank before capping: tracks several sources agree on come first, then
  // higher-confidence parses, then most recent.
  fresh.sort((a, b) =>
    b.endorsements.length - a.endorsements.length ||
    b.confidence - a.confidence ||
    (b.endorsements[0]?.seenAt ?? '').localeCompare(a.endorsements[0]?.seenAt ?? ''),
  );

  const capped = capPerArtist(fresh, opts.maxPerArtist);

  // Over-fetch: ~30% of candidates won't resolve or won't be in the
  // storefront, so attempt more than we need to land targetTracks.
  const attempt = capped.slice(0, Math.ceil(opts.targetTracks * 1.8));
  const report = await resolveTracks(attempt, opts.storefront);

  return {
    tracks: report.resolved.slice(0, opts.targetTracks),
    unmatched: report.unmatched,
    unavailable: report.unavailable,
    stats: {
      bySource,
      rawCandidates: raw.length,
      afterMerge: merged.length,
      afterHistory: fresh.length,
      afterArtistCap: capped.length,
      attempted: attempt.length,
      resolved: report.resolved.length,
      unavailableInStorefront: report.unavailable.length,
      unmatched: report.unmatched.length,
    },
  };
}

export { trackKey };
