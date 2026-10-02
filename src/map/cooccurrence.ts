import { norm, trackKey } from '../lib/normalize.ts';
import type { HarvestedPlaylist } from '../sources/deezer-playlists.ts';

/**
 * The music map: a graph where an edge means A HUMAN PUT THESE TWO TRACKS TOGETHER.
 *
 * This is the project's actual edge over similarity engines. Collaborative
 * filtering infers "people who played X also played Y" from behaviour. This
 * records "a person deliberately placed X near Y" from intent. Different
 * evidence, and free to us because we already fetch playlist tracks.
 */

/** Separator for pair ids. trackKey() already uses "|", so this must differ. */
const PAIR_SEP = '>>';

export interface MapNode {
  key: string;
  artist: string;
  title: string;
  /** Search terms whose playlists contained this track. A free genre proxy. */
  terms: string[];
  /** How many harvested playlists contain it. The popularity denominator. */
  playlists: number;
}

export interface MapEdge {
  a: string;
  b: string;
  /** Weighted count of co-placements. */
  weight: number;
  /** How many distinct playlists placed them together. */
  playlists: number;
  /**
   * Normalised association strength. Positive means "together more often than
   * their individual frequencies explain".
   */
  pmi: number;
}

export interface MusicMap {
  builtAt: string;
  nodes: Record<string, MapNode>;
  edges: MapEdge[];
  stats: {
    playlistsHarvested: number;
    trackInstances: number;
    uniqueTracks: number;
    rawPairs: number;
    keptEdges: number;
  };
}

/**
 * Only pair tracks within this many positions of each other.
 *
 * Whole-playlist co-membership would make every pair in a 100-track playlist an
 * edge - 4,950 pairs, mostly meaningless, and quadratic in playlist size. A
 * window keeps it linear and encodes something stronger: these tracks were placed
 * NEAR each other, which is a sequencing decision rather than mere inclusion in
 * the same bucket.
 */
const WINDOW = 4;

/** An edge seen in only one playlist is one person's whim, not a signal. */
const MIN_PLAYLISTS_PER_EDGE = 2;

/**
 * A playlist's evidential weight, falling off with size.
 *
 * A 20-track playlist is a tighter statement of "these belong together" than a
 * 180-track one. Without this, long playlists dominate purely by having more pairs.
 */
function playlistWeight(size: number): number {
  return 1 / Math.log2(size + 2);
}

export function buildMap(playlists: HarvestedPlaylist[]): MusicMap {
  const nodes = new Map<string, MapNode>();
  const pairWeight = new Map<string, number>();
  const pairPlaylists = new Map<string, Set<number>>();
  let trackInstances = 0;

  for (const pl of playlists) {
    const w = playlistWeight(pl.tracks.length);
    const keys: string[] = [];

    for (const t of pl.tracks) {
      const key = trackKey(t.artist, t.title);
      if (!key.replace('|', '').trim()) { keys.push(''); continue; }
      keys.push(key);
      trackInstances++;
      const existing = nodes.get(key);
      if (existing) {
        existing.playlists++;
        if (!existing.terms.includes(pl.term)) existing.terms.push(pl.term);
      } else {
        nodes.set(key, { key, artist: t.artist, title: t.title, terms: [pl.term], playlists: 1 });
      }
    }

    for (let i = 0; i < keys.length; i++) {
      if (!keys[i]) continue;
      for (let j = i + 1; j <= Math.min(i + WINDOW, keys.length - 1); j++) {
        if (!keys[j] || keys[i] === keys[j]) continue;
        const [a, b] = keys[i] < keys[j] ? [keys[i], keys[j]] : [keys[j], keys[i]];
        const id = a + PAIR_SEP + b;
        // Closer placement counts for more.
        pairWeight.set(id, (pairWeight.get(id) ?? 0) + w / (j - i));
        let set = pairPlaylists.get(id);
        if (!set) { set = new Set(); pairPlaylists.set(id, set); }
        set.add(pl.id);
      }
    }
  }

  // PMI. Without this the map is a popularity chart: a track on 40 playlists
  // co-occurs with everything, so raw counts rank ubiquity rather than affinity.
  const totalPairs = [...pairWeight.values()].reduce((s, v) => s + v, 0) || 1;
  const edges: MapEdge[] = [];
  for (const [id, weight] of pairWeight) {
    const pls = pairPlaylists.get(id)!;
    if (pls.size < MIN_PLAYLISTS_PER_EDGE) continue;
    const sep = id.indexOf(PAIR_SEP);
    const a = id.slice(0, sep), b = id.slice(sep + PAIR_SEP.length);
    const na = nodes.get(a), nb = nodes.get(b);
    if (!na || !nb) continue;
    // Same-artist pairs are consecutive album tracks. They score enormous PMI
    // (an artist's own songs rarely appear beside anyone else's) but they are
    // useless as chain hops, because the walk already forbids repeating an
    // artist. Left in, they crowd the top of every adjacency list.
    if (norm(na.artist) === norm(nb.artist)) continue;
    const pab = weight / totalPairs;
    const pa = na.playlists / trackInstances;
    const pb = nb.playlists / trackInstances;
    edges.push({ a, b, weight, playlists: pls.size, pmi: Math.log2(pab / (pa * pb)) });
  }
  edges.sort((x, y) => y.pmi - x.pmi);

  return {
    builtAt: new Date().toISOString(),
    nodes: Object.fromEntries(nodes),
    edges,
    stats: {
      playlistsHarvested: playlists.length,
      trackInstances,
      uniqueTracks: nodes.size,
      rawPairs: pairWeight.size,
      keptEdges: edges.length,
    },
  };
}

/** Adjacency index for walking. Built on load rather than stored. */
export function buildAdjacency(map: MusicMap): Map<string, MapEdge[]> {
  const adj = new Map<string, MapEdge[]>();
  const sameArtist = (e: MapEdge) => {
    const a = map.nodes[e.a], b = map.nodes[e.b];
    return !a || !b || norm(a.artist) === norm(b.artist);
  };
  const push = (k: string, e: MapEdge) => {
    let list = adj.get(k);
    if (!list) { list = []; adj.set(k, list); }
    list.push(e);
  };
  for (const e of map.edges) {
    if (sameArtist(e)) continue; // see note in buildMap
    push(e.a, e); push(e.b, e);
  }
  for (const list of adj.values()) list.sort((x, y) => y.pmi - x.pmi);
  return adj;
}
