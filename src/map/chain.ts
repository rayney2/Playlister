import { norm } from '../lib/normalize.ts';
import type { MapEdge, MapNode, MusicMap } from './cooccurrence.ts';
import { buildAdjacency } from './cooccurrence.ts';

/**
 * Walk the music map to build a playlist (ADR-010).
 *
 * Each step moves to a track a human placed near the current one. The walk is
 * acyclic - no track and no artist twice - and genre is the CONTINUITY rather than
 * the variable.
 *
 * The first version of this never left one genre: nine steps, all city pop.
 * Greedy highest-PMI plus "prefer a shared term" circles a single neighbourhood
 * forever. So the walk now has a budget: it stays inside a genre for a few hops,
 * then is allowed - not forced - to move, up to a ceiling on distinct genres.
 */

export interface ChainStep {
  node: MapNode;
  /** Why this track follows the previous one. Becomes the story's spine. */
  reason: string;
  sharedTerms: string[];
  pmi: number;
  /** True when this hop deliberately changed genre neighbourhood. */
  isPivot: boolean;
}

export interface ChainOptions {
  length: number;
  /** Hops to stay within one genre term before a shift is allowed. */
  hopsPerGenre: number;
  /** Ceiling on distinct genre terms across the whole chain. */
  maxGenres: number;
  /** Only walk to tracks in this set. Used to keep chains playable. */
  playable?: Set<string>;
  /** Start in a particular genre rather than wherever the map is densest. */
  seedTerm?: string;
}

function termsOf(map: MusicMap, key: string): string[] {
  return map.nodes[key]?.terms ?? [];
}

/**
 * Seed selection: well-connected but not ubiquitous.
 *
 * A track on 40 playlists is a hub, so the first hops would be generic. A track
 * with one edge dead-ends immediately. The interesting seeds sit between.
 */
export function pickSeed(
  map: MusicMap,
  adj: Map<string, MapEdge[]>,
  playable?: Set<string>,
  rng = Math.random,
  seedTerm?: string,
): string | undefined {
  const candidates = Object.values(map.nodes)
    .filter((n) => {
      if (playable && !playable.has(n.key)) return false;
      // Without this the walk always starts in the densest cluster, because that
      // is where the highest-degree nodes are.
      if (seedTerm && !n.terms.includes(seedTerm)) return false;
      const degree = adj.get(n.key)?.length ?? 0;
      return degree >= 3 && n.playlists >= 2 && n.playlists <= 8;
    })
    .sort((a, b) => (adj.get(b.key)?.length ?? 0) - (adj.get(a.key)?.length ?? 0));
  if (!candidates.length) return undefined;
  const slice = candidates.slice(0, Math.max(1, Math.floor(candidates.length * 0.25)));
  return slice[Math.floor(rng() * slice.length)]?.key;
}

export function walk(
  map: MusicMap,
  opts: ChainOptions,
  seedKey?: string,
  rng = Math.random,
): ChainStep[] {
  const adj = buildAdjacency(map);
  const start = seedKey ?? pickSeed(map, adj, opts.playable, rng, opts.seedTerm);
  if (!start || !map.nodes[start]) return [];

  const visitedTracks = new Set<string>([start]);
  const visitedArtists = new Set<string>([norm(map.nodes[start].artist)]);
  const genresUsed = new Set<string>(termsOf(map, start).slice(0, 1));

  const chain: ChainStep[] = [{
    node: map.nodes[start],
    reason: 'seed',
    sharedTerms: termsOf(map, start),
    pmi: 0,
    isPivot: false,
  }];

  let current = start;
  let hopsInCurrentGenre = 1;
  /**
   * The ONE term the walk currently considers itself to be in.
   *
   * An earlier version compared against every term on the current node, which made
   * pivots cosmetic: a track tagged both "city pop" and "boogie funk" let the walk
   * announce a pivot and then carry straight on in city pop, because city pop was
   * still among the current node's terms. Tracking a single active genre is what
   * makes a pivot actually move.
   */
  let currentGenre = termsOf(map, start)[0];

  while (chain.length < opts.length) {

    const options = (adj.get(current) ?? [])
      .map((e) => ({ e, next: e.a === current ? e.b : e.a }))
      .filter(({ next }) => {
        const n = map.nodes[next];
        if (!n) return false;
        if (visitedTracks.has(next)) return false;            // acyclic
        if (visitedArtists.has(norm(n.artist))) return false; // no artist twice
        if (opts.playable && !opts.playable.has(next)) return false;
        return true;
      });
    if (!options.length) break;

    const shares = ({ next }: { next: string }) => termsOf(map, next).includes(currentGenre);

    // A pivot introduces a genre term we haven't used, and is only allowed once
    // we've spent enough hops here and haven't hit the genre ceiling.
    const canPivot = hopsInCurrentGenre >= opts.hopsPerGenre && genresUsed.size < opts.maxGenres;
    /**
     * A pivot destination is a BRIDGE: a track carrying a genre term we have not
     * used yet.
     *
     * An earlier version also required the destination not to carry the current
     * genre, reasoning that a real pivot should leave. That excluded every actual
     * bridge — measured, 305 of the map's connected tracks carry two or more terms,
     * and those dual-tagged tracks are the only crossings between genre clusters.
     * The graph has 132 components; without bridges a walk can never leave the one
     * it started in.
     *
     * What makes the pivot real is not the destination, it is that `currentGenre`
     * switches afterwards, so every subsequent hop is judged against the new genre.
     */
    const pivots = options.filter((o) => termsOf(map, o.next).some((x) => !genresUsed.has(x)));
    const stays = options.filter(shares);

    let chosen: typeof options[number];
    let isPivot = false;
    if (canPivot && pivots.length) {
      chosen = pivots[0];          // adjacency is pre-sorted by pmi
      isPivot = true;
    } else if (stays.length) {
      chosen = stays[0];
    } else {
      chosen = options[0];         // nothing shares a term; take the best link
    }

    const next = chosen.next;
    const nextTerms = termsOf(map, next);
    const shared = nextTerms.includes(currentGenre) ? [currentGenre] : [];
    const newTerms = nextTerms.filter((t) => !genresUsed.has(t));

    chain.push({
      node: map.nodes[next],
      reason: isPivot
        ? `pivot into ${newTerms.slice(0, 2).join(' / ')} — placed near "${map.nodes[current].title}" in ${chosen.e.playlists} playlists`
        : shared.length
          ? `placed near "${map.nodes[current].title}" in ${chosen.e.playlists} playlists; both tagged ${shared.slice(0, 2).join(' / ')}`
          : `placed near "${map.nodes[current].title}" in ${chosen.e.playlists} playlists`,
      sharedTerms: shared,
      pmi: chosen.e.pmi,
      isPivot,
    });

    visitedTracks.add(next);
    visitedArtists.add(norm(map.nodes[next].artist));
    if (isPivot && newTerms.length) {
      currentGenre = newTerms[0];
      genresUsed.add(currentGenre);
      hopsInCurrentGenre = 1;
    } else {
      hopsInCurrentGenre++;
    }
    current = next;
  }

  return chain;
}
