// Run all tests:      node --experimental-strip-types --test
// Run just this file:  node --experimental-strip-types --test src/lib/normalize.test.ts
// Watch mode:          node --experimental-strip-types --test --watch
//
// node:test and node:assert ship with Node. No jest, no vitest, no config.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { norm, trackKey, mergeCandidates, capPerArtist, excludeHeard } from './normalize.ts';
import type { Candidate } from './types.ts';

/** Test-data helper: a Candidate with only the fields a test cares about. */
function candidate(partial: Partial<Candidate>): Candidate {
  return { artist: 'A', title: 'T', source: 'KEXP', confidence: 1, ...partial };
}

describe('norm', () => {
  // WORKED EXAMPLE 1 — the case that actually bit us. KEXP sent "Deee‐Lite"
  // with a U+2010 hyphen; every other source writes an ASCII hyphen. Without
  // NFKD normalization these are two different artists and the dedupe misses.
  test('collapses unicode hyphen variants to the same key', () => {
    assert.equal(norm('Deee‐Lite'), norm('Deee-Lite'));
  });

  // WORKED EXAMPLE 2 — this test documents the behaviour you were asked about
  // in the quiz. It passes today. Whether it SHOULD pass is your call: if you
  // decide a remix is a distinct recording, change the assertion to notEqual
  // and then make the code satisfy it.
  test('strips bracketed text, so a remix collapses into its original', () => {
    assert.equal(
      norm('Andata (Oneohtrix Point Never Remodel)'),
      norm('Andata'),
    );
  });

  // TODO(human): write these. Each one is a real decision, not busywork.
  //
  //  a) Two artists whose names differ only by "feat." — should they collapse?
  //     Try norm('Kiefer feat. Amber Navran') vs norm('Kiefer').
  //  b) What does norm('') return, and what does trackKey('', '') return?
  //     Look at how mergeCandidates guards against that, and decide whether
  //     the guard belongs there or in norm.
  //  c) A title that is ENTIRELY bracketed, e.g. '(Untitled)'. What comes
  //     out? Is that safe to use as a dedupe key?
  //  d) Case and punctuation: "Won't Be Long" vs "Wont Be Long".
});

describe('mergeCandidates', () => {
  // WORKED EXAMPLE 3 — this is the bug from quiz question 1, pinned down.
  // Two plays of the same song on the SAME source produce two endorsements,
  // which is indistinguishable from two different sources endorsing it. The
  // pipeline then ranks by endorsement count, treating "KEXP played it twice"
  // as equal acclaim to "KEXP and Pitchfork both picked it".
  test('repeat plays on one source inflate the endorsement count', () => {
    const merged = mergeCandidates([
      candidate({ artist: 'Bullion', title: 'Young Shiver', source: 'KEXP' }),
      candidate({ artist: 'Bullion', title: 'Young Shiver', source: 'KEXP' }),
    ]);
    assert.equal(merged.length, 1, 'should merge into one track');
    assert.equal(merged[0].endorsements.length, 2);

    const distinctSources = new Set(merged[0].endorsements.map((e) => e.source));
    assert.equal(distinctSources.size, 1, 'but only ONE source actually endorsed it');
    // TODO(human): decide the fix. Options: count distinct sources instead of
    // endorsements; keep both numbers; or treat repeat plays on one station as
    // their own signal (a station spinning a track 5 times means something).
    // Whichever you pick, express it as a test first.
  });

  // TODO(human): write these.
  //  e) Two sources, same song, different capitalisation of the artist.
  //     Assert one merged entry with two endorsements.
  //  f) The higher-confidence parse should win for the canonical artist/title.
  //     Feed a confidence-1 KEXP entry and a confidence-0.65 Stereogum entry
  //     with slightly different strings, and assert which strings survive.
  //  g) Endorsements should come back newest-first. Feed two seenAt values
  //     out of order and assert the ordering.
});

describe('capPerArtist', () => {
  // TODO(human): write these.
  //  h) Three tracks by one artist with max=2 keeps exactly two.
  //  i) Relative order of the kept items is preserved.
  //  j) The cap is per-artist, not global: two artists x two tracks, max=2,
  //     should keep all four.
});

describe('excludeHeard', () => {
  // TODO(human): write these.
  //  k) A track whose key is in history is dropped.
  //  l) History matching survives a formatting difference — put the ASCII
  //     spelling in history and pass the unicode-hyphen spelling in. This is
  //     the test that proves history actually works across sources.
});
