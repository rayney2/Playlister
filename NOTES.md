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

## Expanded-source test run (2026-09-30)

17 sources wired: KEXP, SomaFM, 6 BBC stations, 2 ABC stations, Deezer charts,
Deezer editorial, Billboard year-end, and 4 editorial feeds.

**Before** (2 sources, no caps): 12 tracks, all indie/experimental electronic, one
station supplying 94% of candidates.

**After** (17 sources, caps + reach mix): 13 tracks across Pop, Alternative, Indie
Pop and Rock; four decades (1980s, 2000s, 2010s, 2020s); reach 4 popular / 5 mid /
4 niche.

Cross-source agreement now works, which it could not before — with two
non-overlapping sources every track had exactly one endorsement. Real examples
from one run: "Na Na" appeared on BBC Radio 1, 1Xtra *and* Asian Network; Lime
Garden on Stereogum and 6 Music; Beck on Double J and KEXP; Tears for Fears on
KEXP and Billboard. That agreement is the acclaim signal the ranking was always
meant to use.

### Bugs found and fixed in this round

- **BBC `limit` has a low ceiling.** `limit=20` returns HTTP 400 and `limit=10`
  yields about 7 segments. The adapter asked for 30, so all six stations threw and
  silently contributed zero. Now 10.
- **Billboard in rank order produced the actual charts.** The first run returned
  Billboard's 2014 top twelve in order — maximally familiar, zero discovery.
  Fixed by striding ranks (now samples #1, #35, #69, …).
- **Source ids must match registry keys exactly.** The adapter emitted `KEXP`
  while the registry key was `kexp`, so those tracks were mislabelled rather than
  erroring. All 17 ids are now asserted present.
- **The reach mix has to be applied at selection, not only at resolution.** The
  attempted pool is grouped by reach, so taking the first N resolved tracks gave
  12 of 15 "popular". Added `selectFinal()`.

### Known problems, unfixed

- **Under-filling.** 13 tracks returned for a 15-track request. Four simultaneous
  caps cannot be satisfied from a 30-track attempted pool. This is the
  over-constraint risk, and the fix is a larger pool, which is what ADR-008 is for.
- **Billboard picks still cluster in one year.** `fetchBillboardYears` interleaves
  years, but the pipeline sorts candidates by `seenAt` descending and chart entries
  carry `seenAt = <year>-12-31`, so the most recent sampled year sorts to the front
  again. A fix upstream was defeated by a sort downstream. Options: stop setting
  `seenAt` on chart sources (a chart year is not a recommendation date), or sort
  chart candidates separately.
- **Genre cap leaks.** Pop reached 6 against a cap of 5, because the third
  selection pass relaxes the genre cap rather than return a short playlist. That
  relaxation order is deliberate but unratified — see ADR-007's open question.

## First working music map and chain walk (2026-10-02)

The mechanism works end to end. The tuning does not. Real numbers.

### Build

180 Deezer playlists across 18 genre terms, 266 seconds:

| | |
|---|---|
| track instances | 11,209 |
| unique tracks | 9,236 |
| candidate pairs | 40,730 |
| **edges kept** | **1,626** (pair seen in 2+ playlists) |
| **tracks with any edge** | **587 of 9,236 — 6%** |
| max degree | 14 |

### The walk

Seeded into 1980s Japanese city pop and produced nine coherent hops, each link
justified by two different people placing those tracks near each other:

```
Kazuhito Murata — Mizu No Envelope
  -> Akira Inoue — Linda Raru Ram No Oodoori Nite   [pmi 10.9]
  -> Junko Ohashi — Simple Love                     [pmi 9.6]
  -> Kaoru Sudo — Tsunoru Omoi                      [pmi 9.6]
  -> Makoto Matsushita — Lazy Night                 [pmi 10.4]
  ... 9 steps
```

That is genuinely obscure, genuinely related music, discovered from human
groupings. The idea is sound.

### Three problems, all measured

1. **The map is far too sparse: only 6% of tracks have an edge.** Most tracks
   appear in exactly one harvested playlist, and an edge needs two. Fix is volume -
   more playlists per term, not more terms.

2. **The chain never left city pop.** All nine steps, one genre. Greedy
   highest-PMI plus "prefer a shared term" is a recipe for circling one
   neighbourhood. This is exactly the sameness failure predicted in ADR-010's risk
   section. Genre should stay *broadly* stable, not frozen - the walk needs to be
   allowed to move after a few hops.

3. **Only 3 of 9 steps are on Apple Music (33%).** Obscure Japanese reissues are
   largely absent from the US storefront. Obscurity raises resolve risk, as flagged
   in ADR-009.

   **This one has a clean fix and it strengthens ADR-008**: resolve tracks during
   the offline build and keep only playable ones in the map. Then the walk cannot
   produce an unplayable chain at all. Resolving 9,236 tracks live is impossible;
   resolving them on a schedule is routine.

4. The walk also dead-ended at 9 of 12 requested steps, a consequence of (1).

### Bugs fixed in this round

- **Deezer localisation was splitting artists in two.** With no `Accept-Language`
  header Deezer guessed Japanese: Tangerine Dream arrived as タンジェリン・ドリーム,
  Kraftwerk as クラフトワーク. Those become separate map nodes and separate dedupe
  keys, so it was a correctness bug. Measured 13 of 30 artist names mangled before,
  0 after. `Accept-Language: en-US,en;q=0.9` is now sent on every request.
- **Same-artist edges crowded out every useful hop.** Consecutive album tracks score
  the highest PMI of anything (an artist's own songs rarely sit beside strangers'),
  but the walk forbids repeating an artist, so they can never be taken. Now filtered
  at both build and load time.

## Dense harvest, 527 playlists (2026-10-02)

Re-harvested at 30 playlists per term instead of 10.

| | 10/term | 30/term |
|---|---|---|
| playlists | 180 | **527** |
| track instances | 11,209 | **31,214** |
| unique tracks | 9,236 | **22,366** |
| candidate pairs | 40,730 | **108,037** |
| edges kept | 1,626 | **5,304** |
| **tracks with an edge** | 587 (6%) | **1,934 (9%)** |
| max degree | 14 | **28** |
| viable seeds (degree 3+) | — | **1,414** |
| build time | 266s | **3,614s** |

Connectivity roughly tripled, which is the number that matters — the walk can only
move through connected tracks. But it is still only 9%.

**Timing correction:** I estimated ~13 minutes and it took 60. The per-request
pacing (220ms between playlist fetches) dominates, so build time scales linearly
with playlist count, not with anything cleverer. Budget about 7 seconds per
playlist harvested.

### Why connectivity stays low, and what would actually fix it

An edge requires a *pair* to appear in two or more playlists. Tracks recur across
playlists readily; specific pairs do not. Tripling playlists per term tripled
connectivity, so volume works — but there is a ceiling, because Deezer returns at
most ~50 playlists per query and we reject the oversized ones.

So the lever is **more terms covering the same scene**, not more distinct genres.
Searching "krautrock", "kosmische", "berlin school" and "motorik" harvests
overlapping playlist communities, which makes the same pairs recur. Searching
"krautrock" and "cumbia" harvests disjoint communities that never reinforce each
other. A synonym-cluster vocabulary should densify the map far more per request
than a broader one.

## iTunes throttling, and a cache-poisoning bug (2026-10-02)

A run resolving 1,934 map tracks was killed after 30 minutes. It was about to write
a cache that would have been actively harmful.

**What happened.** The resolver paced calls at 350ms — roughly 170 requests a
minute against an API documented at about 20. iTunes responded with a **rolling
HTTP 403 block**. `fetchWithRetry` treated 403 as permanent (only 5xx and 429 were
retried), so every throttled lookup threw, and `resolveTracks` recorded the
candidate as having no Apple Music match.

**Why that is worse than a slow run.** Those negatives were about to be written to
`data/resolved.json` as permanent answers, with the explicit design goal of never
re-checking them. The map would have been left believing thousands of available
tracks do not exist — invisibly, and for good.

**The block is stateful.** Measured after killing the run, with the penalty active:

| gap between calls | succeeded |
|---|---|
| 0.3s | 3 of 5 |
| 1s | 1 of 5 |
| 2s | 2 of 5 |
| 3s | 3 of 5 |

No clean relationship, because the limiter was still punishing earlier behaviour.
The real sustainable rate can't be measured from inside a penalty window.

### Fixes

1. **403 is now retried for iTunes specifically**, with exponential backoff from 4s.
   It is opt-in per call site (`retryStatuses: [403]`) because other APIs mean 403
   literally — Spotify's playlist endpoints genuinely forbid access.
2. **Pacing raised from 350ms to 3s**, just under the documented ~20/minute.
3. **`ResolveReport` now separates `errored` from `unmatched`.** `unmatched` means a
   successful search returned no match — a real answer, safe to cache. `errored`
   means we never got an answer. Only `unmatched` is cached as a negative.
4. A regression test pins the distinction, with `TODO(human)` cases for once the
   resolver has an injectable fetcher.

**Cost of fix 2:** resolving 1,934 connected tracks now takes about 3 hours rather
than 11 minutes. That is the real price of this API, and it is the strongest
argument yet for ADR-008 — this work belongs in a scheduled job that runs
unattended, not anywhere near a request.

### Also found

Node's strip-only TypeScript mode cannot compile constructor parameter properties
(`constructor(public readonly status: number)`) because it erases types without
generating code. Enums and decorators are out for the same reason. Noted in
CLAUDE.md.

## The map is genre islands, and bridges are what cross them (2026-10-02)

Measured on the 527-playlist map: **132 connected components.** 97 of them have
fewer than 5 tracks. The large ones map almost exactly onto search terms:

| size | dominant terms |
|---|---|
| 281 | ethio jazz (281), highlife (17), desert blues (12) |
| 267 | post punk (118), no wave (103), boogie funk (58) |
| 224 | city pop (174), boogie funk (56) |
| 201 | new age ambient (129), spiritual jazz (75) |
| 156 | desert blues (156) |
| 117 | northern soul (117) |

Components **merge** when playlist communities overlap — post punk with no wave,
city pop with boogie funk, new age with spiritual jazz. They stay **islands** when
communities don't: ethio jazz is 281 tracks with almost no outside connection.

**941 tracks carry two or more search terms; 305 of those are connected.** Those
dual-tagged tracks are the only crossings between clusters.

### The pivot bug this exposed

The first pivot implementation required a pivot destination *not* to carry the
current genre — reasoning that a genuine pivot should leave the neighbourhood. That
excluded every actual bridge, because bridges are by definition tagged with both
genres. Result: pivots were either impossible or cosmetic (the walk announced a
pivot into "boogie funk" and then continued in city pop, because the destination
carried both terms and the walk compared against all of them).

Two fixes, both needed:

1. **Track a single active genre**, not every term on the current node. Otherwise a
   dual-tagged track lets the walk claim to move while staying put.
2. **Allow bridges as pivot destinations.** What makes a pivot real is that
   `currentGenre` switches afterwards, so later hops are judged against the new
   genre — not that the destination lacks the old one.

Working output, seeded in post punk:

```
The Cure — Jumping Someone Else's Train
  -> The B-52's — Rock Lobster
  -> Television — Marquee Moon
  -> Echo and the Bunnymen — A Promise
  -> PIVOT into no wave: OMD — Electricity
  -> Lizzy Mercier Descloux — Fire
  -> Bush Tetras — Can't Be Funky
  -> James Chance & The Contortions — Super Bad
  -> Von Lmo — Future Language
  -> The Contortions — Contort Yourself
```

UK post-punk into synth into New York no wave, mixing famous names with genuinely
obscure ones.

### Remaining: chain length varies with component size

Seeded in spiritual jazz, the walk managed only 3 steps (Don Cherry → Gato Barbieri
→ Sun Ra) because that part of the graph is small. Seeded in post punk or city pop
it reaches 10 comfortably. Options: harvest synonym terms to grow the thin clusters,
or add Last.fm `artist.getSimilar` as a fallback edge so the walk can cross between
components where no co-occurrence bridge exists — which is what ADR-010 specified
and is now clearly necessary rather than merely nice.

## Speed: 54x faster, and the hour was pathological (2026-10-04)

The 527-playlist harvest took 60 minutes — about 7s per playlist. Measured the
actual costs:

| | |
|---|---|
| Deezer playlist fetch, single | **656ms** average |
| 8 requests at concurrency 1 | 564ms each |
| 8 requests at concurrency 4 | **250ms** each |
| 8 requests at concurrency 8 | **165ms** each |
| rejections at concurrency 8 | **none** (8/8 returned 200) |

So latency was never the constraint; the serial loop was. With `mapLimit` at
concurrency 8, a 3-term 84-playlist harvest ran in **10.9s — 0.13s per playlist**,
against 7s before. The full 51-term harvest now takes **~160s instead of 60
minutes**.

The original 7s/playlist cannot be explained by latency (0.66s) plus the old sleep
(0.22s). Most likely retry backoff compounding under sustained serial load. Per-term
timing is now printed so this is visible rather than inferred.

**iTunes is the exception.** Its ~20/minute cap is a hard server-side limit, so
concurrency cannot help there. Resolution stays slow and belongs in a scheduled job.

## Option 1: synonym term clusters (2026-10-04)

Replaced one-term-per-genre with 51 terms in 16 synonym clusters ("krautrock,
kosmische, berlin school, motorik" rather than just "krautrock").

| | single-term | synonym clusters |
|---|---|---|
| playlists | 527 | **1,422** |
| unique tracks | 22,366 | **52,685** |
| edges | 5,304 | **15,051** |
| connected tracks | 1,934 | **4,787** |
| components | 132 | 278 |
| **largest component** | 281 | **1,573** |
| connected bridge tracks | 305 | **2,309** |

The largest component now spans scenes rather than sitting inside one: disco funk +
mod soul + 80s boogie + italo disco. The second pairs japanese funk and city pop
with astral and spiritual jazz.

Two terms returned nothing usable: "showa boogie" (0 playlists) and "brazilian
psych" (6). Dead terms are harmless but worth pruning.

## Playlist selection, and the Britney problem

Selection was: Deezer's relevance ranking for the term, filtered only by size
(8–200 tracks), first 30 kept. No other quality signal.

That let generic pop playlists in under specific terms, and the map learned
nonsense. A walk seeded in "post punk" produced **The Bangles, Meghan Trainor,
Britney Spears, OneRepublic, Dua Lipa**.

**Fix: the title must contain the search term as a phrase**, compared with spacing
and punctuation stripped. Word-level matching was too loose — "Pop Punk Essentials"
matched "post punk" on *punk*, and "Bedroom Pop" matched "dream pop" on *pop*.
Flattening both sides keeps "Post-Punk Essentials" and "Dreampop" while rejecting
those two.

Cost: 1,422 → 966 playlists, 4,787 → 3,618 connected. Recall traded for precision,
which is right when 36 playlists per term are available and only 30 are wanted.

### A second bug the Britney chain exposed

The walk fell back to the strongest edge *regardless of genre* when nothing shared
the current term. One genre-less hop into a generic pop cluster and every later hop
was judged against pop. Preference order is now: stay in genre → pivot if the budget
allows → hop to something connected to a genre already used → **stop**. A short
honest chain beats a long incoherent one; post punk now stops at 5 rather than
wandering.

After both fixes, seeded in krautrock:

```
Michael Rother -> Harmonia -> Ashra -> Peter Baumann
  -> PIVOT into berlin school: Klaus Schulze
  -> Neuronium -> Michael Garrison -> You -> Robert Schroeder -> Serge Blenner
```

That is the actual historical lineage from Neu!-adjacent krautrock into Berlin
School.

## Option 2: Last.fm similar-artist bridges (2026-10-04)

Built an artist-similarity index for artists of connected tracks: **2,138 artists in
265s, 2,123 of them with similar artists (99%)**. Used only when co-occurrence is
exhausted, and labelled `BRIDGE` in output so the story never claims a human
sequenced two tracks when none did.

**Two bugs found while testing it:**

1. **The bridge could never fire.** A `break` ran when co-occurrence options were
   exhausted — precisely the condition the bridge exists for — before the fallback
   was reached. Measured 0 uses across every seed until this was fixed.
2. **A/B testing was meaningless** because the seed is chosen randomly each run, so
   flag effects were indistinguishable from seed luck ("tropicalia" gave 6 steps
   without the flag and 3 with, purely from different seeds). Added
   `--deterministic`.

With both fixed, comparing identical seeds:

| seed | co-occurrence only | with bridges |
|---|---|---|
| nugaze | 11 steps | **12 steps, 1 bridge** |
| tropicalia | 12 | 12, 0 bridges |
| mpb | 12 | 12, 0 bridges |
| space disco | 12 | 12, 0 bridges |

**Verdict: it works but is now rarely needed.** Option 1 densified the map enough
that co-occurrence usually reaches 12 steps alone. The bridge is a safety net for
thin clusters, not a main mechanism — which is the right role for it, since
co-occurrence is the stronger evidence.

**Caveat on the scores:** Last.fm normalises so the top similar artist always has
`match: 1.00`. It is a relative rank within one artist's list, not an absolute
similarity, so "match 1.00" must not be presented as "these are the same thing".
