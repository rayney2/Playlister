# Playlister — findings log

Measured facts, so we don't re-litigate them later. Dates matter; these are live APIs.

## Apple Music resolution without a Developer account (2026-09-29)

**The `search` endpoint is broken for the CN storefront; `lookup` is not.**
`itunes.apple.com/search?country=cn` returns `resultCount: 0` for *every* query —
including `周杰伦` in Chinese characters, and Taylor Swift. That is not a catalog
gap, it's a dead endpoint for that storefront. Meanwhile
`itunes.apple.com/lookup?id=<trackId>&country=cn` returns results normally.

Apple track IDs are global. So the resolver is two-step:

1. `search` on the **US** storefront to turn "artist + title" into a track ID.
2. `lookup` that ID on the **listener's** storefront to confirm availability.

Measured on 20 live KEXP tracks:

| stage | rate |
|---|---|
| resolved via US text search | 19/20 (95%) |
| also present in CN storefront | 14/20 (70%) |

So the pipeline must over-fetch ~1.8x to reliably land a 12-track playlist for a
CN listener. Implemented in `src/resolve/itunes.ts`.

**No ISRC on the free path.** The iTunes Search API neither returns nor accepts
ISRCs. Exact-match ISRC resolution requires the Apple Music API
(`/v1/catalog/{sf}/songs?filter[isrc]=`) and therefore a paid Apple Developer
membership. The seam is stubbed at `resolveByIsrc()` — wire it up and call it
first, keeping text search as fallback. KEXP already hands us MusicBrainz
recording MBIDs, which is the route to ISRCs for candidates lacking one.

## Sources (2026-09-29)

**KEXP is the anchor and it's excellent.** Public, no key, ~93 usable trackplays
per pull, and a large share carry a DJ `comment` — real human context, which is
exactly what grounds the story. Also returns MusicBrainz artist MBIDs.
Caveat: `limit=100` returns 502; page by 40.

**Editorial RSS via headline regex does not work.** Measured extraction rate:

| feed | tracks / items |
|---|---|
| Pitchfork `/rss/news/` | 0 / 29 |
| Stereogum | 6 / 40 (clean parses) |
| Bandcamp Daily | 0 / 36 |
| NPR Music | 0 / 10 |

~6 usable tracks from 115 items, and a looser regex produced actively wrong
parses ("Taylor Swift Haunt Dakota Johnson and Colin Farrell in" as an artist).
Editorial prose doesn't announce tracks in a parseable shape at useful volume.

Dead feed URLs: `pitchfork.com/rss/reviews/best/tracks/` and
`pitchfork.com/feed/feed-best-new-*/rss` both 404. `thequietus.com/feed/` 403s a
bot User-Agent.

Implication: a second *structured* source beats a second editorial one. Either
find more station play logs in KEXP's shape, or let the story-step LLM do
extraction from article text (it's already reading these blurbs).

## Still unverified — needs the phone

The Shortcuts leg is the only thing that can still force a redesign.

- The native **"Find Music" action searches the local library only**, not the
  Apple Music catalog. Confirmed in multiple places.
- Known workaround: iTunes Search → track ID → feed into the playlist action.
  Someone reports this working as of Jan 2026, but hasn't published the
  mechanics.
- Reported failure mode: the shortcut **runs without error and adds nothing**.

So: verify by hand on the iPhone before building the Shortcut half.

Also open:
- Does **"Use Model"** (Apple Intelligence) appear in Shortcuts on the device,
  in-region? Fallback is a backend LLM call.
- Is there a "clear playlist" action? If not, decide: dated playlist per run, or
  overwrite one fixed playlist.
- Which storefront is the Apple Music account actually on? The 70% figure
  assumes `cn`. A US-storefront account would see ~95%.
