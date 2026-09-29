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

## KEXP serves its whole archive, not just the last hour (2026-09-29)

`api.kexp.org/v2/plays/` accepts `airdate_after` and `airdate_before` as ISO
timestamps, and the archive reaches back to at least 2001. Verified samples:

| window | example play | DJ comment? |
|---|---|---|
| 2019-06-01 | Saint Etienne — Only Love Can Break Your Heart | — |
| 2015-06-01 | Blur — My Terracotta Heart | yes |
| 2010-06-01 | Anita Tijoux — Crisis de un MC | no |
| 2005-06-01 | Head of Femur — Ringodom or Proctor | no |
| 2001-06-01 | Gorillaz — Clint Eastwood (alternate version) | — |

This matters because the default pull (`offset=0`) is the last ~2 hours of radio,
which is a recency trap: every run would surface this month's releases. Sampling
random historical windows fixes it for free, from the API we already use, with
the same DJ-comment grounding. Comments thin out before ~2015.

Note `offset` does NOT paginate backwards in time usefully — `offset=20000`
returned plays from 2026-08-09 and `offset=200000` from 2025-05-03, so the
ordering isn't a clean reverse chronology at depth. Use the date filters.

## Breadth of sound: what each source actually covers (2026-09-29)

The problem: KEXP supplied 93 of 99 candidates, and KEXP's main rotation is one
corridor of taste — indie and experimental electronic. A run full of DJ Python,
Andy Stott, Fennesz and Oneohtrix Point Never is not "diverse", it is one station's
house style. Volume from one source is not breadth.

So every source needs a **label** describing what kind of music it yields, and the
pipeline needs quotas. Measured coverage:

| source | curation | genre coverage | era | volume | verified |
|---|---|---|---|---|---|
| KEXP main rotation | human (DJ + comment) | narrow: indie / experimental electronic | recent | high (~93/pull) | yes |
| KEXP genre programs | human (DJ + comment) | **broad**: hip-hop, Latin, reggae, metal, jazz, blues, Afrobeat, rockabilly, world | any (archive to 2001) | medium | partly — see caveat |
| Deezer genre charts | algorithmic (popularity) | broad: 28 genres | current only | high | yes |
| Wikipedia critic lists | human (canon) | classic rock, soul, some hip-hop | historical | **thin (~20 songs)** | yes |
| Stereogum | human (critic) | indie rock | recent | very low (6/40) | yes |

### KEXP genre programs — best option, one bug to fix

41 programs, each genre-tagged. Street Sounds (Hip Hop), El Sonido (Latin),
Positive Vibrations (Reggae), Seek & Destroy (Metal), Jazz Theatre, Shake the
Shack (Rockabilly), Overnight Afrobeats, Mo'Glo (World), Best Ambiance (African).

This is the only source that gives **both** breadth and human context.

Two API facts, both important:

1. **KEXP silently ignores query params it doesn't recognise.** `?program=12` and
   `?show=67921` return the latest plays regardless. No error, no warning. Every
   program I requested returned the identical three songs. Only `limit`, `offset`,
   `airdate_after` and `airdate_before` actually filter.
2. **So genre targeting must be composed**: list shows, find an episode of the
   program you want, read its `start_time`, then pull plays inside that window
   with the date filters.

Verified working — real output from time-windowed pulls:

- **El Sonido** → Café Tacvba, Caifanes, Wyyrd (Latin rock, with detailed
  Spanish-language DJ context)
- **Street Sounds** → Wreckx-N-Effect, MC Hammer, Rob Base, Kid 'n Play
- **Jazz Theatre** → Greg Foat, Cleo Sol, Brainstory
- **Positive Vibrations** → The Congos, Alice Coltrane

**Known bug in my approach:** I assumed every episode runs three hours. For Seek &
Destroy (Metal) that window returned LCD Soundsystem and Beck — it overshot into
the next program. Use the *next* show's `start_time` as the end boundary instead
of a fixed duration.

### Wikipedia gives canon, but only excerpts

`en.wikipedia.org/api/rest_v1/page/html/<title>` returns clean HTML with parseable
tables, no key. From "Rolling Stone's 500 Greatest Songs of All Time" I extracted
20 ranked entries: Dylan, The Rolling Stones, Aretha, Chuck Berry, The Beatles,
Outkast, Fleetwood Mac, Missy Elliott.

But it is **20, not 500** — Wikipedia publishes the top ten of each edition, not
the full list, presumably for copyright reasons. "500 Greatest Albums" yielded 1
row. So Wikipedia is a source of a few dozen canonical anchors, not a deep pool.

Scraping rollingstone.com directly is a poor substitute: paywalled, JavaScript
rendered, and prose rather than tables (same problem as ADR-004).

### Deezer genre charts: breadth without curation

`api.deezer.com/genre` lists 28 genres; `api.deezer.com/chart/{id}/tracks` returns
each one's chart. Free, no key. Rock → Bruce Springsteen. Rap/Hip Hop → Drake.
Reggaeton → Omar Courtz.

Caveat: these are **current popularity charts, not curation**, and genres overlap
(Tame Impala appeared in All, Dance and Alternative). Good for the "genuinely
popular" bucket. No human wrote a reason for any of these picks, so they bring no
story material.
