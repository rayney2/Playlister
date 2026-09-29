// node --experimental-strip-types --test src/resolve/itunes.test.ts
//
// READ THIS FIRST — it's the lesson this file exists to teach.
//
// itunes.ts contains two very different kinds of code tangled together:
//
//   1. PURE LOGIC — scoreMatch(). Given a candidate and an iTunes result, is
//      this the same song? Same input always gives the same answer. No network,
//      no clock, no randomness. Trivially testable.
//
//   2. I/O ORCHESTRATION — resolveTracks(). Calls fetchJson(), sleeps between
//      requests, retries. Its behaviour depends on the internet.
//
// Right now resolveTracks() reaches for fetchJson() directly, at module scope.
// A test has no way to say "pretend iTunes returned this" — it would have to
// really call Apple, which makes the test slow, flaky, dependent on Apple's
// rate limit, and unable to reproduce the interesting cases (a 500, a timeout,
// an empty result set) on demand.
//
// That is what "untestable" means in practice. It is not about test frameworks;
// it's that the code has no SEAM — no place to substitute a fake.
//
// The fix is dependency injection, and it's smaller than it sounds: make the
// fetcher a parameter with a real default, so production passes nothing and
// tests pass a fake. See TODO(human) at the bottom.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { scoreMatch } from './itunes.ts';
import type { MergedCandidate } from '../lib/types.ts';

function cand(artist: string, title: string): MergedCandidate {
  return { artist, title, source: 'KEXP', confidence: 1, endorsements: [] };
}

function result(artistName: string, trackName: string) {
  return {
    trackId: 1,
    trackName,
    artistName,
    trackViewUrl: 'https://music.apple.com/us/album/x/1?i=1',
  };
}

describe('scoreMatch (pure — the easy half)', () => {
  // WORKED EXAMPLE 1 — the straightforward hit.
  test('identical artist and title is an exact match', () => {
    assert.equal(
      scoreMatch(cand('Bullion', 'Young Shiver'), result('Bullion', 'Young Shiver')),
      'exact',
    );
  });

  // WORKED EXAMPLE 2 — the case that made the collaboration rule necessary.
  // KEXP credits "DJ Python"; Apple credits "DJ Python & Tony Bontana". A naive
  // equality check on the artist string throws away a correct match.
  test('matches when Apple credits extra collaborators', () => {
    assert.equal(
      scoreMatch(cand('DJ Python', 'Forgetful Angel'), result('DJ Python & Tony Bontana', 'Forgetful Angel')),
      'exact',
    );
  });

  // TODO(human): these are the ones that decide whether the resolver is
  // trustworthy. Write them, and expect at least one to expose a bug.
  //
  //  a) A DIFFERENT song by the same artist must not match.
  //     cand('Bonobo','Equinoctial') vs result('Bonobo','Kerala') -> null?
  //     Run it before you assume. The fuzzy branch uses substring matching,
  //     so ask yourself what happens with short titles.
  //  b) The short-word rule. scoreMatch has a clause that every word under 3
  //     characters is skipped when comparing artists. Find two real artists it
  //     wrongly unifies. Hint: think about very short artist names.
  //  c) Live and remaster versions. cand('Talk Talk','Happiness Is Easy') vs
  //     result('Talk Talk','Happiness Is Easy (1997 - Remaster)'). Which verdict
  //     comes back, and is it the one you want for a DISCOVERY playlist?
  //  d) Empty or whitespace title on either side — no crash, and null.
});

// TODO(human): make resolveTracks testable, then test it.
//
// Step 1 — add a seam. Change the signature to something like:
//
//     export interface Deps { fetchJson: <T>(url: string) => Promise<T>; }
//     export async function resolveTracks(
//       candidates: MergedCandidate[],
//       storefront: string,
//       deps: Deps = { fetchJson },   // real default, so callers don't change
//     )
//
//   and have the body call deps.fetchJson(...) instead of fetchJson(...).
//
// Step 2 — in a test, pass a fake that returns canned responses keyed by URL.
//   No network, instant, and you control exactly what Apple "said".
//
// Step 3 — now the interesting cases are reachable. Write these:
//   e) A candidate that resolves but is absent from the storefront lands in
//      `unavailable`, not `resolved`.
//   f) A search that throws puts the candidate in `unmatched` and does NOT
//      abort the whole run.
//   g) A lookup that throws marks the track unavailable (fail-closed). This is
//      quiz question 3 — write the test, then decide if you agree with it.
//   h) With storefront 'us', existsInStorefront short-circuits and issues NO
//      lookup call. Assert on the number of fake calls made. This test is how
//      you'd have caught what that early return silently does.
