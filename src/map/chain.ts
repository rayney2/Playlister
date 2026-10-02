import { norm } from '../lib/normalize.ts';
import type { MapEdge, MapNode, MusicMap } from './cooccurrence.ts';
import { buildAdjacency } from './cooccurrence.ts';

/**
 * Walk the music map to build a playlist (ADR-010).
 *
 * Each step moves to a track that a human placed near the current one. The walk
 * is acyclic - no track and no artist twice - and genre is the CONTINUITY rather
 * than the variable: drift is permitted but never forced.
 */

export interface ChainStep {
  node: MapNode;
  /** Why this track follows the previous one. Becomes the story's spine. */
  reason: string;
  /** Shared search terms with the previous step, i.e. the genre thread. */
  sharedTerms: string[];
  pmi: number;
}

export interface ChainOptions {
  length: number;
  /**
   * Require each hop to share a term with the previous track. This is what keeps
   * genre broadly stable. Relaxed automatically if the walk would otherwise stall.
   */
  requireSharedTerm: boolean;
}

function termsOf(map: MusicMap, key: string): string[] {
  return map.nodes[key]?.terms ?? [];
}

/**
 * Seed selection: a track with several edges but which is not ubiquitous.
 *
 * A track on 40 playlists is a hub - starting there makes the first hops generic.
 * A track with one edge dead-ends immediately. The interesting seeds sit between.
 */
export function pickSeed(map: MusicMap, adj: Map<string, MapEdge[]>, rng = Math.random): string | undefined {
  const candidates = Object.values(map.nodes)
    .filter((n) => {
      const degree = adj.get(n.key)?.length ?? 0;
      return degree >= 3 && n.playlists >= 2 && n.playlists <= 8;
    })
    .sort((a, b) => (adj.get(b.key)?.length ?? 0) - (adj.get(a.key)?.length ?? 0));
  if (!candidates.length) return Object.keys(map.nodes)[0];
  // Pick randomly from the top slice so repeat runs differ.
  const slice = candidates.slice(0, Math.max(1, Math.floor(candidates.length * 0.2)));
  return slice[Math.floor(rng() * slice.length)]?.key;
}

export function walk(map: MusicMap, opts: ChainOptions, seedKey?: string, rng = Math.random): ChainStep[] {
  const adj = buildAdjacency(map);
  const start = seedKey ?? pickSeed(map, adj, rng);
  if (!start || !map.nodes[start]) return [];

  const visitedTracks = new Set<string>([start]);
  const visitedArtists = new Set<string>([norm(map.nodes[start].artist)]);
  const chain: ChainStep[] = [{
    node: map.nodes[start],
    reason: 'seed',
    sharedTerms: map.nodes[start].terms,
    pmi: 0,
  }];

  let current = start;
  while (chain.length < opts.length) {
    const edges = adj.get(current) ?? [];
    const currentTerms = termsOf(map, current);

    // Candidate next steps: unvisited track, unvisited artist.
    const options = edges
      .map((e) => ({ e, next: e.a === current ? e.b : e.a }))
      .filter(({ next }) => {
        const n = map.nodes[next];
        if (!n) return false;
        if (visitedTracks.has(next)) return false;          // acyclic
        if (visitedArtists.has(norm(n.artist))) return false; // no artist twice
        return true;
      });

    // Prefer hops that share a genre term; fall back only if nothing shares one.
    const withShared = options.filter(({ next }) =>
      termsOf(map, next).some((t) => currentTerms.includes(t)));
    const pool = (opts.requireSharedTerm && withShared.length) ? withShared : options;
    if (!pool.length) break; // dead end

    const chosen = pool[0]; // edges are pre-sorted by pmi
    const next = chosen.next;
    const shared = termsOf(map, next).filter((t) => currentTerms.includes(t));

    chain.push({
      node: map.nodes[next],
      reason: shared.length
        ? `placed near "${map.nodes[current].title}" in ${chosen.e.playlists} playlists; both tagged ${shared.slice(0, 2).join(' / ')}`
        : `placed near "${map.nodes[current].title}" in ${chosen.e.playlists} playlists`,
      sharedTerms: shared,
      pmi: chosen.e.pmi,
    });

    visitedTracks.add(next);
    visitedArtists.add(norm(map.nodes[next].artist));
    current = next;
  }

  return chain;
}
