# Backlog

Ordered. Top item is what we're doing next. Nothing enters this list until it
has a clear "done" condition.

## Next

1. **Rewrite `normalize.ts` and `itunes.ts` by hand** (Mason). These hold the
   real design decisions — what makes two tracks the same, what counts as a
   match — and they're pure functions, so tests first. Keep `http.ts`,
   `types.ts` and the RSS plumbing as boilerplate.
   *Done when:* both modules are Mason's own code, with tests for dedupe/merge
   and for match scoring, and he can explain both without notes.

2. **Verify the Shortcut can add catalog tracks to a playlist** (phone, manual).
   The single unresolved risk that could force a redesign. "Find Music" searches
   only the local library; the iTunes-ID workaround is reported working but
   undocumented, and its failure mode is silent.
   *Done when:* one track Mason doesn't own is provably in a playlist via
   Shortcuts, or we know it's impossible and pick a fallback.

3. **Check whether "Use Model" exists in Shortcuts on the device, in-region.**
   Determines whether the story runs on-device or in the Worker.
   *Done when:* answered yes/no.

4. **Source-grounded story generation.** Prompt gets only retrieved blurbs;
   attributes every pick; states no fact absent from the source text.
   *Done when:* a run prints a guide whose every claim traces to a blurb.

## Parking lot

Ideas, not commitments. Nothing here is scheduled. Promote to the backlog only
with a "done when".

- Probe more structured play-log sources in KEXP's shape: Spinitron's public API
  (many US stations), NTS, WFMU, BBC 6 Music. Cheapest path to source diversity
  and it needs no LLM.
- Backend LLM extraction from article text, to unlock Pitchfork / Bandcamp Daily
  / The Quietus as real sources (see ADR-004).
- Popularity buckets: ~40% well-known / 40% mid-tail / 20% wildcard, using
  Last.fm listener counts as the popularity proxy.
- Graph-based adjacent picks (~20% of the list): Last.fm `artist.getSimilar`,
  ListenBrainz, MusicBrainz.
- Genre/history context for richer stories: Wikipedia genre pages, Discogs (free
  key), Last.fm artist bios.
- Feedback loop: tracks Mason adds or loves feed a taste profile.
- ISRC/Apple Music API path, if the Developer Program gets bought (ADR-001).
- Move dedupe history from `data/history.json` to Workers KV or D1, keyed by
  ISRC or normalized "artist - title".
- Re-tune the over-fetch multiplier once the storefront is settled (ADR-003).
- Collapse the `resolve`/`pipeline` split if it hasn't earned itself.
