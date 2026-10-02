import { fetchJson, sleep } from '../lib/http.ts';
import { norm } from '../lib/normalize.ts';
import type { MergedCandidate, ResolvedTrack } from '../lib/types.ts';

/**
 * Resolve tracks to Apple Music without an Apple Developer account.
 *
 * Two measured facts drive the shape of this (spike, 2026-09-29):
 *
 *  1. `/search?country=cn` returns resultCount 0 for EVERY query, including
 *     Chinese-language ones. It is not a catalog gap, it is a broken/blocked
 *     endpoint for that storefront. `/lookup?country=cn` works fine.
 *  2. Apple track IDs are global, so an ID found via the US storefront can be
 *     looked up against any other storefront to test availability there.
 *
 * So: always SEARCH on a storefront where search works, then LOOKUP on the
 * listener's own storefront to confirm they can actually play it.
 * Measured on 20 live KEXP tracks: 95% found via US search, 70% also present
 * in the CN storefront.
 */
const SEARCH_STOREFRONT = 'US';

/**
 * Pacing between iTunes calls.
 *
 * 350ms was far too fast. Running ~170 requests/minute against this API earned a
 * rolling 403 block that persisted for many minutes, and because 403 was treated
 * as a permanent answer, every throttled track was being recorded as "not on
 * Apple Music". That is a cache-poisoning bug, not a slow-down.
 *
 * iTunes documents roughly 20 requests/minute. 3s keeps us just under it.
 */
const ITUNES_RATE_LIMIT_MS = 3000;

/** iTunes answers 403 when throttling, so it must be retried, not believed. */
const ITUNES_RETRY = { retryStatuses: [403], tries: 5, backoffMs: 4000 };

interface ItunesResult {
  trackId: number;
  trackName: string;
  artistName: string;
  collectionName?: string;
  trackViewUrl: string;
  trackTimeMillis?: number;
  /** Broad genre, e.g. "Hip-Hop/Rap", "Jazz", "Classical". Free in this response. */
  primaryGenreName?: string;
  /** ISO date. Used for era bucketing without a second lookup. */
  releaseDate?: string;
}

interface ItunesResponse {
  resultCount: number;
  results: ItunesResult[];
}

export function scoreMatch(c: MergedCandidate, r: ItunesResult): 'exact' | 'fuzzy' | null {
  const wantTitle = norm(c.title);
  const wantArtist = norm(c.artist);
  const gotTitle = norm(r.trackName);
  const gotArtist = norm(r.artistName);
  if (!wantTitle || !gotTitle) return null;

  const artistOk =
    gotArtist.includes(wantArtist) || wantArtist.includes(gotArtist) ||
    // Collaborations: "Andy Stott" vs "Andy Stott & Elaine Howley"
    wantArtist.split(' ').every((w) => w.length < 3 || gotArtist.includes(w));

  if (gotTitle === wantTitle && artistOk) return 'exact';
  if (artistOk && (gotTitle.includes(wantTitle) || wantTitle.includes(gotTitle))) return 'fuzzy';
  return null;
}

/** Search the catalog by artist + title string. */
async function searchByText(c: MergedCandidate) {
  const term = encodeURIComponent(`${c.artist} ${c.title}`);
  const url = `https://itunes.apple.com/search?term=${term}&entity=song&limit=8&country=${SEARCH_STOREFRONT}`;
  const res = await fetchJson<ItunesResponse>(url, ITUNES_RETRY);

  for (const method of ['exact', 'fuzzy'] as const) {
    for (const r of res.results ?? []) {
      if (scoreMatch(c, r) === method) return { result: r, method };
    }
  }
  return null;
}

/**
 * Is this track in the listener's storefront? Uses /lookup, which — unlike
 * /search — works for every storefront including CN.
 */
async function existsInStorefront(trackId: number, storefront: string): Promise<boolean> {
  if (storefront.toUpperCase() === SEARCH_STOREFRONT) return true;
  const url = `https://itunes.apple.com/lookup?id=${trackId}&country=${storefront.toLowerCase()}`;
  const res = await fetchJson<ItunesResponse>(url, ITUNES_RETRY);
  return (res.resultCount ?? 0) > 0;
}

/**
 * ISRC lookup — the paid path, deliberately left as a seam.
 *
 * The iTunes Search API does not expose or accept ISRCs (verified: no `isrc`
 * field on any result). Only the Apple Music API, which needs an Apple
 * Developer Program membership, supports
 *   GET /v1/catalog/{storefront}/songs?filter[isrc]={isrc}
 * which is an exact match and would remove the fuzzy-matching guesswork below.
 *
 * When that membership exists: implement this, call it first in resolveTracks,
 * and fall back to text search only when it returns null. MusicBrainz
 * recording MBIDs (which KEXP already gives us) are the way to obtain ISRCs
 * for candidates that don't carry one.
 */
async function resolveByIsrc(_isrc: string, _storefront: string): Promise<ResolvedTrack | null> {
  return null;
}

export interface ResolveReport {
  resolved: ResolvedTrack[];
  unmatched: MergedCandidate[];
  /** Found in the catalog but absent from the listener's storefront. */
  unavailable: ResolvedTrack[];
}

export async function resolveTracks(
  candidates: MergedCandidate[],
  storefront: string,
): Promise<ResolveReport> {
  const resolved: ResolvedTrack[] = [];
  const unmatched: MergedCandidate[] = [];
  const errored: MergedCandidate[] = [];
  const unavailable: ResolvedTrack[] = [];

  for (const c of candidates) {
    // Paid path first when an ISRC is known; no-op until MusicKit is enabled.
    if (c.isrc) {
      const viaIsrc = await resolveByIsrc(c.isrc, storefront);
      if (viaIsrc) {
        resolved.push(viaIsrc);
        continue;
      }
    }

    let hit: Awaited<ReturnType<typeof searchByText>> = null;
    try {
      hit = await searchByText(c);
    } catch {
      // The search itself failed, so we learned nothing about this track.
      errored.push(c);
      await sleep(ITUNES_RATE_LIMIT_MS);
      continue;
    }
    await sleep(ITUNES_RATE_LIMIT_MS);

    if (!hit) {
      unmatched.push(c); // a real 200 with no match: Apple does not have it
      continue;
    }

    let available: boolean;
    try {
      available = await existsInStorefront(hit.result.trackId, storefront);
    } catch {
      errored.push(c);
      await sleep(ITUNES_RATE_LIMIT_MS);
      continue;
    }
    await sleep(ITUNES_RATE_LIMIT_MS);

    const track: ResolvedTrack = {
      ...c,
      appleTrackId: hit.result.trackId,
      // trackViewUrl comes back pointing at the search storefront; point it at
      // the listener's instead so the link opens in their own catalog.
      appleUrl: hit.result.trackViewUrl.replace(
        `music.apple.com/${SEARCH_STOREFRONT.toLowerCase()}/`,
        `music.apple.com/${storefront.toLowerCase()}/`,
      ),
      appleArtist: hit.result.artistName,
      appleTitle: hit.result.trackName,
      durationMs: hit.result.trackTimeMillis,
      genre: hit.result.primaryGenreName,
      releaseDate: hit.result.releaseDate,
      availableInStorefront: available,
      matchMethod: hit.method,
    };
    (available ? resolved : unavailable).push(track);
  }

  return { resolved, unmatched, errored, unavailable };
}
