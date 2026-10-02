# Source registry

Every candidate source, with a label describing **what kind of music it actually
yields**. Volume from one source is not breadth (ADR-007), so the pipeline fills
quotas from these labels rather than concatenating whatever arrives.

All statuses below were tested live on 2026-09-29. Re-test before trusting one.

## The label schema

Each source declares:

| field | values | why it matters |
|---|---|---|
| `access` | `free` · `free+key` · `blocked` · `none` | Can we use it at all, at zero cost |
| `status` | `working` · `needs-llm` · `needs-scraping` · `broken` | How much work before it yields tracks |
| `curation` | `human-dj` · `human-critic` · `chart` · `algorithmic` · `archive` | Whether a person chose this, and can be credited |
| `genres` | list, or `narrow` / `broad` | The whole point of the registry |
| `era` | `current` · `recent` · `archive` · `specific-year` | Guards against the recency trap (ADR-006) |
| `volume` | rough tracks per pull | Decides whether a per-source cap is needed |
| `story` | `yes` · `no` | Does it supply a human reason we can quote and attribute |
| `resolve_risk` | `low` · `med` · `high` | Odds Apple Music actually has the track |

`story: no` sources can fill the playlist but cannot carry the listening guide.
A run made only of those has nothing to write about.

---

## Tier 1 — working, human-curated, breadth

These are the backbone. All free, no key, verified returning real tracks.

### KEXP genre programs
`access: free` · `status: working` · `curation: human-dj` · `story: yes` ·
`era: archive (to 2001)` · `volume: med` · `resolve_risk: low`

**41 programs, each genre-tagged.** Street Sounds (hip hop), El Sonido (Latin),
Positive Vibrations (reggae), Seek & Destroy (metal), Jazz Theatre, Shake the
Shack (rockabilly), Overnight Afrobeats, Best Ambiance (African), Mo'Glo (world),
Sonarchy (experimental), Sonic Reducer (punk), Swingin' Doors (blues/country).

The single best source: breadth **and** a DJ explaining the pick. Requires the
two-step window composition and the end-boundary fix (see NOTES.md).

### KEXP main rotation
`access: free` · `status: working` · `curation: human-dj` · `story: yes` ·
`era: recent` · `volume: high (~93/pull)` · `resolve_risk: low`

**Label honestly: narrow.** Indie and experimental electronic. Excellent quality,
one corridor of taste. Needs a hard cap or it drowns everything else.

### BBC — seven stations from one API pattern
`access: free` · `status: working` · `curation: human-dj` · `story: no` ·
`era: current` · `volume: med` · `resolve_risk: low`

`rms.api.bbc.co.uk/v2/services/<service_id>/segments/latest?limit=N`

The single widest genre unlock found. Seven services verified returning real
track data, no key:

| service_id | covers | verified sample |
|---|---|---|
| `bbc_6music` | eclectic / alternative | This Is Lorelei, Lime Garden, Marika Hackman |
| `bbc_radio_one` | pop / new | Blossoms & Declan McKenna |
| `bbc_radio_two` | adult / classic | Stevie Wonder, Erasure, Texas |
| `bbc_radio_three` | **classical** | Arnold Bax, William Byrd, Emilie Mayer |
| `bbc_1xtra` | hip hop / R&B / dancehall | Busta Rhymes, Ezra Collective |
| `bbc_asian_network` | **South Asian** | Shankar Mahadevan, Shaan & KK |
| `bbc_radio_nan_gaidheal` | Gaelic / mixed | varies widely |

**Field mapping is counterintuitive and matters:** `titles.primary` is the
**artist**, `titles.secondary` is the **track title** — the reverse of what the
names suggest. Getting this backwards silently produces garbage candidates.

`bbc_radio_scotland` returns 400. `bbc_world_service` returns an empty set. The
older `/v2/broadcasts/latest` endpoint gives programme slots, not tracks — the
`segments` path is the one that carries songs.

### Deezer editorial playlists
`access: free` · `status: working` · `curation: human-critic` · `story: no` ·
`era: current` · `volume: 50-180/playlist` · `resolve_risk: low`

`api.deezer.com/editorial/0/charts` lists staff playlists; then
`api.deezer.com/playlist/<id>/tracks`. Verified: "bedroom rave" (50), "New Folk"
(180), "Soul Coffee" (70), "Reggaeton Classics" (73).

Genuinely themed human curation rather than raw charts. Same localisation trap as
the rest of Deezer (Khruangbin returns as クルアンビン), so never match on its
artist string.

### SomaFM
`access: free` · `status: working` · `curation: human-dj` · `story: no` ·
`era: current` · `volume: 18/channel` · `resolve_risk: med`

**46 genre-labelled channels**: ambient (dronezone, deepspaceone, darkzone),
electronic (beatblender, cliqhop, digitalis), americana (bootliquor), bossanova
and world (bossa), industrial (doomed), covers, eclectic. Listener-programmed,
no DJ commentary, so it adds variety but no story material.
`somafm.com/channels.json`, then `somafm.com/songs/<id>.xml`. Values are
CDATA-wrapped.

### ABC / Australian public radio — four stations
`access: free` · `status: working` · `curation: human-dj` · `story: no` ·
`volume: high (10,000 plays queryable)` · `resolve_risk: low`

`music.abcradio.net.au/api/v1/plays/search.json?station=<id>`

- **triplej** — contemporary, mainstream-alternative
- **doublej** — older skew, deeper catalog
- **unearthed** — unsigned and emerging artists (DON WEST, FUKHED, PASH). The
  obscure end, verified.
- **classic** — actual classical (Sydney Symphony, Kammerorchester Basel). The
  only classical source found.

A different country's taste, which is breadth we can't get from US stations.

---

## Genre labelling: already solved, free

**iTunes returns `primaryGenreName` in the search call the resolver already
makes.** No new integration, no extra request. Verified granularity, which is
exactly the "broad, not too precise" level wanted:

`Hip-Hop/Rap` · `Jazz` · `Metal` · `Reggae` · `Classical` · `Indie Pop` ·
`Rock y Alternativo`

The same response also carries `releaseDate`, which gives era bucketing for free
(ADR-006).

Two notes:

1. A few labels need collapsing into broader buckets — `Indie Pop` and
   `Rock y Alternativo` are narrower or more localised than the rest. A small
   hand-written mapping table from iTunes genre to about a dozen broad buckets is
   the whole job.
2. For comparison, MusicBrainz's genre vocabulary has **2,209** entries. Far too
   precise to group a playlist by, which confirms staying broad.

**Use both labels, for different jobs.** The *source* label (SomaFM's channel is
"ambient", BBC Radio 3 is "classical") decides where to go looking. The *track*
label from iTunes says what actually arrived. When the two disagree, that is a
signal worth logging: it means either the source drifted from its label or the
resolver matched the wrong song.

---

## Tier 2 — working, canon and era coverage

### Wikipedia: Billboard Year-End Hot 100
`access: free` · `status: working` · `curation: chart` · `story: no` ·
`era: specific-year` · `volume: ~100/year x ~65 years` · `resolve_risk: low`

**The answer to "classic rock" and to era targeting.** One page per year, clean
parseable tables, no key:
`en.wikipedia.org/api/rest_v1/page/html/Billboard_Year-End_Hot_100_singles_of_<year>`

Verified: 1968 → Hey Jude; 1975 → Rhinestone Cowboy; 1983 → Billie Jean; 1991,
2004 all ~100 rows each. Roughly **6,500 canonical songs** addressable by year.

It is popularity canon, not critical curation, and carries no human reasoning —
so it fills the "genuinely popular" and historical buckets but needs a story
source alongside it.

### Wikipedia: Pazz & Jop
`access: free` · `status: working` · `curation: human-critic` · `story: no` ·
`era: archive` · `volume: ~126 rows` · `resolve_risk: low`

Village Voice critics' poll by year. The Who, Joni Mitchell, Dylan & The Band.
Critic consensus rather than sales.

### Wikipedia: Rolling Stone 500 Greatest Songs
`access: free` · `status: working` · `curation: human-critic` · `story: no` ·
`volume: ~20 only` · `resolve_risk: low`

Works, but Wikipedia publishes only each edition's top ten. Canon anchors, not a
pool. "1001 Albums You Must Hear" similarly yielded 15 rows.

### Deezer genre charts
`access: free` · `status: working` · `curation: chart` · `story: no` ·
`era: current` · `volume: high` · `resolve_risk: low`

28 genres via `api.deezer.com/genre` then `api.deezer.com/chart/<id>/tracks`.
Genres overlap heavily (Tame Impala appeared under All, Dance and Alternative).

### Deezer track lookup — enrichment, not discovery
`access: free` · `status: working`

Supplies **ISRC** (4/4 verified) and a `rank` popularity score. Use for the
durable history key, popularity buckets, and as a second opinion on fuzzy
matches. Localises artist names (Bonobo → ボノボ) so never match on its artist
string.

### ListenBrainz
`access: free` · `status: working` · `curation: algorithmic` · `story: no`

`fresh-releases` and sitewide stats. Needs the trailing slash or it 308s.

---

## Tier 3 — editorial, all reachable but need LLM extraction

Every one of these returns a healthy RSS feed **with a browser User-Agent** — the
earlier 403s were bot blocking, not dead feeds. But headlines are prose, so regex
extraction fails (ADR-004). They become usable once the story-step LLM also does
extraction. All are `story: yes`, which makes them worth the effort: a critic's
blurb is the best grounding material there is.

`access: free` · `status: needs-llm` · `curation: human-critic` · `era: recent`

| feed | items |
|---|---|
| Crack Magazine | 99 |
| NPR All Songs Considered | 81 |
| Gorilla vs Bear | 35 |
| The Quietus | 32 |
| Dusted | 20 |
| Brooklyn Vegan | 15 |
| Aquarium Drunkard | 15 |
| Consequence | 15 |
| Fact Magazine | 10 |
| Loud And Quiet | 10 |
| Paste Music | 10 |
| NPR New Music Friday | 10 |
| Bandcamp Daily | 36 |
| Stereogum | 40 (6 parse by regex today) |

Note: Stereogum's `/feed/` 308-redirects when hit with a browser UA; the
non-redirecting URL is already in `src/sources/rss.ts`. KEXP's own blog feed is
404.

---

## Tier 4 — deep archive, high resolve risk

### Internet Archive
`access: free` · `status: working` · `curation: archive` · `story: no`

- **Live Music Archive** (`collection:etree`) — **304,788** live recordings.
  Skews jam-band and taper culture (Umphrey's McGee, Horse Flies).
- **Great 78 Project** (`collection:78rpm`) — **310,936** pre-1950 items, real
  1914–1940 material (Hot Lips Page, Marjorie Lawrence).

Unmatched for era range. But `resolve_risk: high` — obscure 78s and taped live
sets mostly are not on Apple Music, so most candidates would be discarded. Useful
as a *story and context* source, or if the playlist ever tolerates non-Apple
sources.

---

## Ruled out, with reasons

Recorded so nobody re-investigates.

| source | why |
|---|---|
| **Bandcamp API** | Does not exist. Both unofficial autocomplete endpoints return `{error}`. KEXP DJ comments already contain Bandcamp artist links, which is the useful part. |
| **Mixcloud** | `sections` (the tracklist field) is **always empty** on the public API — verified across NTS, Rinse FM and jazz mixes. Gives show names and tags only. |
| **Audius** | Works (`discoveryprovider.audius.co`, free, has a `genre` field) but content is self-uploaded amateur electronic/dubstep. `resolve_risk: high` — almost none of it is on Apple Music. |
| **Airnet / 3RRR / PBS FM** | Program lists work (243 and 220 programs) but `slug` is null and the episodes endpoint 500s. No route to tracklists. |
| **Record shop charts** (Boomkat, Rough Trade, Norman) | 403 to requests. Piccadilly Records and Phonica return HTML that would need scraping. Staff picks would be excellent obscure curation if reachable. |
| **College radio** (BFF.fm, KALX, KUTX, WFUV, Radio K, WXYC) | 404s, dead endpoints or SSL failures. CHIRP returns a tiny widget. WPRB gives blog posts only. |
| **CBC, NPO 3FM, ByteFM, RNZ** | 403/404. |
| **TheAudioDB, Every Noise at Once, SecondHandSongs** | 404 or 403. |
| **NTS** | Episodes expose `genres`, `moods`, `intensity` but `tracklist: {}`. No tracks without scraping. |
| **Spinitron** | Per-station token required (401). Many US stations use it, so worth revisiting if a token is ever obtained. |
| **Acclaimed Music** | 403 to all requests. Would be ideal (thousands of critic-list songs); blocked. |
| **Metal Archives** | 403. |
| **Robert Christgau** | 404 on the guessed path; database may be reachable another way. |
| **Radio France / FIP** | 401 (needs key); the old open `livemeta` endpoint is 410 Gone. |
| **Radio Paradise** | Only a single now-playing track; `get_block` returns data but needs decoding for volume. Low priority. |
| **KCRW** | Endpoint returns all nulls. |
| **WFMU, WWOZ, Worldwide FM, Rinse FM, Free Music Archive, Hype Machine** | 404 / dead / empty. |
| **Rolling Stone direct** | Paywalled, JS-rendered prose. Use the Wikipedia tables instead. |
| **RateYourMusic** | No API and scraping violates their terms. Excluded by choice. |
| **Reddit** | API access restricted. Unverified. |

---

## What this gives us

Counting only `status: working` sources: **hip hop, Latin, reggae, metal, jazz,
rockabilly, blues, country, Afrobeat, African, world, classical, ambient,
industrial, americana, bossa nova, punk, experimental, indie, electronic, pop,
R&B, reggaeton**, plus era coverage from 1914 to this week.

The remaining gap is **critic-curated canon at volume**. Wikipedia's critic lists
are excerpts, and Acclaimed Music — the one source that would solve it — blocks
us. Billboard year-end fills the hole with popularity canon instead.

---

## Playlists made by other people — the volume answer (2026-09-30)

### Deezer playlist search
`access: free` · `status: working` · `curation: human-crowd` · `story: no` ·
`era: any` · `volume: very high` · `resolve_risk: low`

`api.deezer.com/search/playlist?q=<term>` then `api.deezer.com/playlist/<id>/tracks`

No key. Searchable by any genre, scene or mood term. Someone sat down and built
each of these, which makes it human curation at a scale no radio station can match.

Measured across 14 genre terms:

| term | playlists matched | tracks in top 30 |
|---|---|---|
| post punk | 153 | 10,175 |
| shoegaze | 150 | 8,866 |
| krautrock | 150 | 8,464 |
| free jazz | 150 | 7,576 |
| dungeon synth | 150 | 6,775 |
| dub | 151 | 5,630 |
| northern soul | 150 | 5,660 |
| ethio jazz | 150 | 5,515 |
| cumbia | 150 | 4,567 |
| bossa nova | 158 | 4,281 |
| no wave | 151 | 4,169 |
| city pop | 150 | 3,833 |
| highlife | 151 | 3,299 |
| funk 45 | 151 | 1,988 |

**14 terms → 2,115 playlists → roughly 80,000 tracks** from sampling 30 playlists
each. Even deliberately obscure terms return full result sets: "dungeon synth" and
"funk 45" match as many playlists as "dub".

Verified content is records rather than radio sets — "Krautrock Essentials" returns
CAN's "Vitamin C", Neu!'s "Hallogallo", Harmonia, La Düsseldorf.

**Important limit:** `total` caps around 150–158 per query regardless of the term,
so scale comes from *many queries*, not deep pagination. A genre-term vocabulary is
therefore the thing that determines pool size.

### Discogs — actual records, no token needed
`access: free` · `status: working` · `curation: archive` · `story: no` ·
`era: archive` · `volume: very high` · `resolve_risk: med`

`api.discogs.com/database/search?q=<term>&type=release` returned **29,796**
krautrock releases with year and label, with no token — despite Discogs
documenting one. Release-oriented rather than track-oriented, which suits
"actual records".

Treat as unverified for sustained use: Discogs rate-limits unauthenticated
requests hard (documented around 25/minute), so a token is probably needed in
practice even though one isn't needed to get a response.

### Also working
- **ListenBrainz user playlists** — `api.listenbrainz.org/1/user/<name>/playlists`.
- **MusicBrainz release-by-label** — `?query=label:4AD` works, which gives
  label-mates for any label without depending on KEXP.

### Needs a key (free to obtain, not obtained)
- **Last.fm** — 400 without a key. `tag.getTopTracks` would give genre-tagged
  tracks at volume.
- **Spotify** — 401 without auth. Client Credentials is free to register and has
  the largest playlist ecosystem of any service.

---

## Universal chain edges (2026-09-30)

Chain links must work for a candidate from *any* source. KEXP's `labels` and
MusicBrainz artist ids only exist on KEXP rows, so they cannot carry the chain.
These four are available for every track, free and keyless:

| edge | source | verified |
|---|---|---|
| **related artist** | `api.deezer.com/artist/<id>/related` | Portishead → Massive Attack, Hooverphonic, Archive, UNKLE, Morcheeba, Björk, Sneaker Pimps, Goldfrapp |
| **record label** | `api.deezer.com/album/<id>` → `label` | Portishead album → `"Island Mercury"` |
| **broad genre** | iTunes `primaryGenreName` | already fetched by the resolver |
| **era** | iTunes `releaseDate` | already fetched by the resolver |

**Use iTunes for genre, never Deezer.** Deezer localises: that album's genre came
back as `ロック` and Portishead's top track as `グローリー・ボックス`. Its `label`
and `related` fields are language-neutral and safe.

---

## Spotify: credentials work, the endpoints we need do not (2026-10-02)

Tested with a valid Client Credentials token. The token mints fine and catalogue
search works, but **everything the music map needs is blocked**:

| endpoint | result |
|---|---|
| `/v1/search?type=artist\|track\|album` | **200** — works |
| `/v1/albums/<id>/tracks` | **200** — works |
| `/v1/search?type=playlist` | 200, but `limit` above 19 returns `Invalid limit`, and results are null-padded (limit=10 yields 8 usable) |
| **`/v1/playlists/<id>/tracks`** | **403 Forbidden** — for *every* playlist, including Spotify's own editorial ones (`37i9dQZF1DXcBWIGoYBM5M`) |
| **`/v1/artists/<id>/related-artists`** | **403 Forbidden** |

This is Spotify's late-2024 restriction on new third-party apps, not a scope or
token problem — the same token succeeds on catalogue endpoints in the same run.

**Consequence:** Spotify cannot feed the co-occurrence map (ADR-011) and cannot
supply chain edges (ADR-010). It offers nothing we don't already get free from
iTunes and Deezer, so it is not wired in. The credentials stay in `.env` in case
the policy changes.

**Deezer remains the playlist workhorse**: 150 playlists per query, full track
access, no key. Last.fm's `artist.getSimilar` replaces Spotify's related-artists
and is arguably better for this project — it is derived from human tagging rather
than listening behaviour (Slowdive → my bloody valentine 1.00, Lush 0.89, Cocteau
Twins 0.78).

---

## Spotify: credentials work, the endpoints we need do not (2026-10-02)

Tested with a valid Client Credentials token. The token mints fine and catalogue
search works, but **everything the music map needs is blocked**:

| endpoint | result |
|---|---|
| `/v1/search?type=artist`, `track`, `album` | **200** — works |
| `/v1/albums/<id>/tracks` | **200** — works |
| `/v1/search?type=playlist` | 200, but `limit` above 19 returns `Invalid limit`, and results are null-padded (limit=10 yields 8 usable) |
| **`/v1/playlists/<id>/tracks`** | **403 Forbidden** — for *every* playlist, including Spotify's own editorial ones (`37i9dQZF1DXcBWIGoYBM5M`) |
| **`/v1/artists/<id>/related-artists`** | **403 Forbidden** |

This is Spotify's late-2024 restriction on new third-party apps, not a scope or
token problem — the same token succeeds on catalogue endpoints in the same run.

**Consequence:** Spotify cannot feed the co-occurrence map (ADR-011) and cannot
supply chain edges (ADR-010). It offers nothing we don't already get free from
iTunes and Deezer, so it is not wired in. The credentials stay in `.env` in case
the policy changes.

**Deezer remains the playlist workhorse**: 150 playlists per query, full track
access, no key. Last.fm's `artist.getSimilar` replaces Spotify's related-artists
and is arguably better here — it derives from human tagging rather than listening
behaviour (Slowdive → my bloody valentine 1.00, Lush 0.89, Cocteau Twins 0.78).
