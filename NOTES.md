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

## Free data sources, probed 2026-09-29

All tested live. "No key" means no registration, no token, no paid tier.

| source | key? | status | what it gives |
|---|---|---|---|
| **KEXP** `api.kexp.org/v2/plays` | no | **works** | DJ play logs + written DJ comments + MB artist IDs. The anchor. |
| **Deezer** `api.deezer.com` | no | **works** | **ISRCs** (4/4 on real picks), `rank` popularity score, release dates. |
| **Apple marketing RSS** `rss.applemarketingtools.com` | no | works | Per-storefront most-played songs/albums. Free popularity signal from Apple itself. |
| **ListenBrainz** `api.listenbrainz.org` | no | works | `fresh-releases`, sitewide stats. Note: needs the trailing slash, else 308. |
| **MusicBrainz** `musicbrainz.org/ws/2` | no | partial | Artist/recording metadata. ISRC lookup returned 400 for a valid ISRC — unneeded now that Deezer supplies them directly. |
| Bandcamp Daily RSS | no | works | 36 items, but editorial prose (see ADR-004). |
| Bandcamp API | — | **none exists** | Both unofficial autocomplete endpoints return `{error}`. No public API. |
| NTS `nts.live/api/v2/shows` | no | works | 12 shows with genres/moods — *shows*, not tracklists. Per-show tracklists would need scraping. |
| Spinitron | **yes** | 401 | Per-station token required. Many US stations use it. |
| Hype Machine RSS | no | dead | 386B stub. |
| WFMU playlists RSS | no | 404 | |

### Deezer is the significant find

Three things fall out of it, none of which cost anything:

1. **ISRCs now, free.** This was supposed to require the Apple Developer Program
   (ADR-001). We can store an ISRC per track immediately, which makes dedupe
   history durable and version-proof — "artist - title" keys break on remasters
   and remixes, ISRCs don't. It also means the day MusicKit is bought,
   `filter[isrc]` exact matching works with no backfill.
2. **`rank` is a free popularity proxy**, so the 40% well-known / 40% mid-tail /
   20% wildcard split needs no Last.fm key.
3. **A cross-check on fuzzy matching.** If Deezer and iTunes independently agree
   on artist + title for a candidate, the match is far more trustworthy than one
   fuzzy string hit. This directly reduces ADR-001's stated risk of picking the
   wrong version of a song.

Quirk: Deezer localises artist names (Bonobo came back as ボノボ). Match on ISRC
or normalized title, not on the artist string it returns.

### Bandcamp: no API, but we already have the useful part

There is no public Bandcamp API and the unofficial endpoints are closed. Scraping
album pages is possible but is a terms question and a maintenance burden.

Not needed: **KEXP DJ comments already contain Bandcamp artist links** —
`kaaziny.bandcamp.com`, `djpythonnyc.bandcamp.com`, `bullion.bandcamp.com` all
appeared in a single 12-track run. So the story layer can already point at
"buy this directly from the artist" for free, just by extracting URLs from the
blurbs we're storing anyway.
