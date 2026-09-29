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

5. **Add Deezer enrichment** (free, no key). Per resolved track: fetch ISRC and
   `rank`. Store the ISRC as the durable history key, and use agreement between
   Deezer and iTunes as a match-confidence signal.
   *Done when:* every track in a run carries an ISRC, history is keyed by it, and
   the resolver reports when its two sources disagree.

6. **Era sampling** (ADR-006). Pull from random historical KEXP windows
   alongside recent plays, and budget the playlist across eras using release
   dates from iTunes/Deezer.
   *Done when:* a single run contains picks from at least three different
   decades, and the budget is a parameter rather than a constant.

7. **Fix the KEXP genre-program window, then sample genres** (ADR-007). Compose
   shows -> episode start_time -> date-filtered plays. Use the next show's
   start_time as the end boundary; a fixed 3-hour window overshoots into the
   following program.
   *Done when:* one run contains picks from at least four genre programs, and a
   metal episode returns metal.

8. **Source registry with labels and quotas** (ADR-007). Declare coverage per
   source; cap any one source's share; target a genre and era spread.
   *Done when:* no source exceeds its cap in a run, and the funnel output reports
   the genre/era spread achieved versus targeted.

## Parking lot

Ideas, not commitments. Nothing here is scheduled. Promote to the backlog only
with a "done when".

- More structured play logs. Probed 2026-09-29: NTS exposes shows but not
  tracklists; Spinitron needs a per-station token; WFMU and Hype Machine RSS are
  dead. BBC 6 Music still unprobed. See NOTES.md before re-investigating.
- ListenBrainz `fresh-releases` as a new-release source (free, no key, works).
- Wikipedia canonical lists for classic-rock anchors. Works and needs no key, but
  yields ~20 songs, not 500 (Wikipedia publishes only each edition's top ten).
  Worth it for canon seeds, not for volume.
- Deezer genre charts (28 genres, free, no key) for the "genuinely popular"
  bucket. Note these are popularity charts with no human reasoning attached, so
  they contribute no story material.
- Backend LLM extraction from article text, to unlock Pitchfork / Bandcamp Daily
  / The Quietus as real sources (see ADR-004).
- Popularity buckets: ~40% well-known / 40% mid-tail / 20% wildcard. Use
  Deezer's `rank` (free, no key) rather than Last.fm listener counts, and Apple's
  own marketing RSS for the "genuinely popular" end.
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
