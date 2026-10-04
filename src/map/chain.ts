import { norm } from '../lib/normalize.ts';
import type { SimilarIndex } from './similar-artists.ts';
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
  /** How this link was established. Co-occurrence is the stronger evidence. */
  via: 'seed' | 'cooccurrence' | 'similar-artist';
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
  /**
   * Artist-similarity fallback, used only when no co-occurrence hop exists.
   * Co-occurrence means a person sequenced two tracks; this does not, so hops
   * taken this way are labelled differently and the story must not claim
   * otherwise.
   */
  similar?: SimilarIndex;
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

/**
 * Find a hop by artist similarity when co-occurrence has run out.
 *
 * Deliberately conservative: the destination must still belong to a genre already
 * in play, so similarity cannot be used to wander off. It exists to cross between
 * the map's 206 components, not to loosen the walk.
 */
function similarHop(
  map: MusicMap,
  opts: ChainOptions,
  byArtist: Map<string, string[]>,
  current: string,
  visitedTracks: Set<string>,
  visitedArtists: Set<string>,
  genresUsed: Set<string>,
): ChainStep | undefined {
  const index = opts.similar;
  if (!index) return undefined;
  const list = index[norm(map.nodes[current].artist)] ?? [];

  for (const cand of [...list].sort((a, b) => b.match - a.match)) {
    const key = norm(cand.artist);
    if (visitedArtists.has(key)) continue;
    for (const nodeKey of byArtist.get(key) ?? []) {
      const n = map.nodes[nodeKey];
      if (!n || visitedTracks.has(nodeKey)) continue;
      if (opts.playable && !opts.playable.has(nodeKey)) continue;
      if (!n.terms.some((t) => genresUsed.has(t))) continue;
      return {
        node: n,
        reason: `no shared playlist; bridged by artist similarity (Last.fm match ${cand.match.toFixed(2)} from ${map.nodes[current].artist})`,
        sharedTerms: n.terms.filter((t) => genresUsed.has(t)),
        pmi: 0,
        isPivot: false,
        via: 'similar-artist',
      };
    }
  }
  return undefined;
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

  // artist -> track keys, for the similarity fallback.
  const byArtist = new Map<string, string[]>();
  for (const n of Object.values(map.nodes)) {
    const a = norm(n.artist);
    let list = byArtist.get(a);
    if (!list) { list = []; byArtist.set(a, list); }
    list.push(n.key);
  }

  const chain: ChainStep[] = [{
    node: map.nodes[start],
    reason: 'seed',
    sharedTerms: termsOf(map, start),
    pmi: 0,
    isPivot: false,
    via: 'seed',
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
    // When co-occurrence is exhausted, this is EXACTLY when the similarity bridge
    // is wanted. An earlier version broke out here, before the fallback below was
    // ever reached, so the bridge could never fire - it measured 0 uses across
    // every seed tried.
    if (!options.length) {
      const bridged = similarHop(map, opts, byArtist, current, visitedTracks, visitedArtists, genresUsed);
      if (!bridged) break;
      chain.push(bridged);
      visitedTracks.add(bridged.node.key);
      visitedArtists.add(norm(bridged.node.artist));
      hopsInCurrentGenre++;
      current = bridged.node.key;
      continue;
    }

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

    /**
     * Preference order: stay in genre, else pivot if the budget allows, else hop
     * to somewhere connected to a genre we have already used, else STOP.
     *
     * The earlier version fell back to `options[0]` - the strongest edge
     * regardless of genre - whenever nothing shared the current term. That is how
     * a post-punk walk ended up at Meghan Trainor and Britney Spears: one
     * genre-less hop into a generic pop cluster and every later hop was judged
     * against pop. A short honest chain beats a long incoherent one.
     */
    const relatedToSomethingUsed = options.filter((o) =>
      termsOf(map, o.next).some((t) => genresUsed.has(t)));

    let chosen: typeof options[number];
    let isPivot = false;
    if (canPivot && pivots.length) {
      chosen = pivots[0];
      isPivot = true;
    } else if (stays.length) {
      chosen = stays[0];           // adjacency is pre-sorted by pmi
    } else if (pivots.length && genresUsed.size < opts.maxGenres) {
      chosen = pivots[0];
      isPivot = true;
    } else if (relatedToSomethingUsed.length) {
      chosen = relatedToSomethingUsed[0];
    } else if (opts.similar) {
      // Last resort: cross to a different component via artist similarity.
      const step = similarHop(map, opts, byArtist, current, visitedTracks, visitedArtists, genresUsed);
      if (!step) break;
      chain.push(step);
      visitedTracks.add(step.node.key);
      visitedArtists.add(norm(step.node.artist));
      hopsInCurrentGenre++;
      current = step.node.key;
      continue;
    } else {
      break;                       // no coherent hop available
    }

    const next = chosen.next;
    const nextTerms = termsOf(map, next);
    const shared = nextTerms.includes(currentGenre) ? [currentGenre] : [];
    const newTerms = nextTerms.filter((t) => !genresUsed.has(t));

    chain.push({
      via: 'cooccurrence',
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
