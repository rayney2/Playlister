# Decisions

One entry per hard-to-reverse decision. Append; don't rewrite history. If a
decision turns out wrong, add a new entry that supersedes it and say why.

Format: what we decided, what else we considered, why this won, what it costs.

---

## ADR-001 — Free iTunes Search path, defer MusicKit
**2026-09-29 · accepted**

Resolve tracks to Apple Music with the public iTunes Search API rather than the
Apple Music API.

**Alternatives:** Apple Music API (exact ISRC matching, playlist write access) —
rejected for now because it requires a $99/yr Apple Developer Program membership.

**Why:** the free API gets us a validated 95% resolve rate on real curated
tracks, which is enough to prove the idea is worth paying for. Paying first
would be buying a membership to test a hypothesis.

**Cost:** no ISRC matching, so resolution is fuzzy text matching and will
occasionally pick the wrong version of a song (a remaster, a live cut, the wrong
remix). `resolveByIsrc()` is stubbed so the exact path can be switched on later
without reshaping the resolver.

---

## ADR-002 — Two-step resolver: search US, verify on the listener's storefront
**2026-09-29 · accepted**

Always `search` the US storefront to turn artist+title into an Apple track ID,
then `lookup` that ID against the listener's storefront to confirm availability.

**Alternatives:** search the listener's storefront directly (the obvious design)
— impossible, because `/search?country=cn` returns 0 results for every query
including Chinese-language ones. It's a dead endpoint, not a catalog gap;
`/lookup` on the same storefront works normally.

**Why:** Apple track IDs are global, so one storefront can do the searching and
another can answer "can this person play it". This also turns availability into a
precise filter rather than a guess.

**Cost:** two HTTP calls per track instead of one, and a US-shaped view of the
catalog when searching. Measured: 95% resolve, 70% of those also present in CN.
See `NOTES.md`.

---

## ADR-003 — MVP assumes the US storefront
**2026-09-29 · accepted**

Default to `us`. Treat CN compatibility as post-MVP.

**Alternatives:** target CN from the start, since that's where the listening
happens.

**Why:** CN availability costs ~25% of resolved tracks and adds a lookup per
track, and we don't yet know the playlist is worth building. Don't pay a tax on
an unproven idea. The resolver is already storefront-parameterised, so this is a
flag, not a rewrite.

**Cost:** the 70% CN figure means over-fetching has to be re-tuned when we
switch. The current 1.8x over-fetch is sized for CN and is wasteful at 95%.

---

## ADR-004 — No regex extraction from editorial feeds
**2026-09-29 · accepted**

Don't parse artist/title out of editorial RSS headlines. Rely on structured
sources; revisit extraction as a backend LLM step if we want specific
publications.

**Alternatives:** (a) keep improving the regexes; (b) extract on-device with
Apple Intelligence; (c) extract in the backend with an LLM.

**Why:** measured yield was ~6 usable tracks from 115 items (Pitchfork 0/29,
Bandcamp Daily 0/36, NPR 0/10, Stereogum 6/40), and looser patterns produced
confidently wrong parses. Editorial prose doesn't announce tracks in a parseable
shape. On-device extraction is out on capability grounds: the Shortcuts "Use
Model" action has no network access and no tool calling, so it cannot fetch or
search — it can only transform text handed to it.

**Cost:** we lose critic-blurb grounding from the publications Mason named until
LLM extraction is built. KEXP's DJ comments carry the story layer alone for now.

---

## ADR-005 — Workflow: understand-before-merge
**2026-09-29 · accepted**

Nothing enters the repo that Mason can't explain. Generated novel logic gets
rewritten by hand from the explanation before it counts as his.

**Alternatives:** ship fast and refactor later — the approach that sank the
previous language-reader app.

**Why:** the prior failure was not insufficient discipline, it was a workflow
that let unread code accumulate until the codebase felt foreign. Rules that cost
speed on purpose are the point.

**Cost:** materially slower. Accepted. Full rules in `CLAUDE.md`.

---

## ADR-006 — Sample across eras, not just recent plays
**2026-09-29 · accepted**

Draw candidates from random historical windows of the KEXP archive as well as
from recent plays, and budget the playlist across eras.

**Alternatives:** (a) recent plays only — simplest, but it's the recency trap
that makes Apple Music's own discovery boring; (b) buy a catalog dataset;
(c) use critic aggregates like Album of the Year or Acclaimed Music, which skew
historical — rejected for now because neither has an API.

**Why:** the stated goal is music Mason doesn't know, not music that is new. Those
are different sets, and only the second one is what a play log's first page gives
you. KEXP's `airdate_after`/`airdate_before` filters reach back to 2001 at no
cost, with the same DJ-comment grounding that makes the source worth using.

**Cost:** more API calls per run, and DJ comments thin out before ~2015, so
older picks carry less story material. An era budget is another tuning knob that
can be got wrong.

**Open:** what the budget should be. A starting guess is recent / last decade /
older, but it should be a parameter, not a constant, until it's been listened to.

---

## ADR-007 — Label every source, then fill quotas from it
**2026-09-29 · accepted**

Stop treating sources as one undifferentiated pool. Each source declares what it
covers, and the pipeline fills a target shape from those declarations rather than
concatenating whatever arrives.

Each source carries at least: curation type (human / algorithmic), genre coverage,
era coverage, expected volume, and whether it supplies story material. KEXP's main
rotation is labelled honestly as one narrow corridor — indie and experimental
electronic — not as a general-purpose source.

The pipeline then enforces caps: no single source above a set share, and a target
spread across genres and eras.

**Alternatives:** (a) keep concatenating and hope more sources balance it out —
this is what produced a run that was 94% one station; (b) weight sources by a
single quality score, which cannot express "excellent, but only for one genre".

**Why:** volume from one source is not breadth. The stated goal is music Mason
doesn't know across all kinds of music, and a source's *shape* is as important as
its quality. A cap is also the only thing that makes adding a small,
high-quality source worthwhile — otherwise six good tracks drown in ninety.

**Cost:** more bookkeeping, and quotas can starve the playlist when sources fail.
Needs a defined fallback when a genre's quota can't be filled. The labels are also
hand-written claims about each source, so they can drift from reality.

**Open:** the target shape itself. Genre spread, era spread and the per-source cap
should all be parameters, not constants, until Mason has listened to a few runs.

---

## ADR-008 — Build a scheduled candidate pool; serve Siri from it
**2026-09-30 · proposed**

Split the system into two jobs instead of one.

1. A **scheduled builder** (Cloudflare Cron Triggers, free tier) runs on a timer:
   pulls every source, merges, resolves to Apple Music, and writes each track to
   storage with its genre, era, reach, ISRC and grounding blurbs. This is the
   candidate pool.
2. The **Siri request** only assembles a playlist from that pool and generates the
   story. No source fetching, no resolution.

**Alternatives:** (a) keep everything in the request, as now; (b) cache responses
per source with a TTL, which reduces but does not remove per-request fetching and
resolution.

**Why.** Four measured problems all have the same cause — doing slow work inside a
voice request:

- **Latency.** A 13-track run takes ~39 seconds with 17 sources. Nobody says
  "Hey Siri, discover music" and waits that long, and adding sources makes it
  worse.
- **Rate limits.** iTunes tolerates roughly 20 requests a minute, and the resolver
  needs two calls per track. That ceiling caps how large a candidate pool can be
  when it has to be built during a request.
- **Under-filling.** With per-source, per-genre, per-artist and per-era caps all
  active, a 15-track request returned 13 tracks. The caps are not wrong; the
  attempted pool (30) is too small to satisfy them. A bigger pool is the fix, and
  a bigger pool is only affordable offline.
- **LLM extraction.** Editorial feeds need a model to extract tracks from prose
  (ADR-004). Paying for that per Siri invocation is wasteful; doing it once per
  scheduled build is cheap.

**Cost.** Two deploy targets instead of one, and a storage dependency (Workers KV
or D1) that the current in-memory pipeline doesn't need. Recommendations become as
fresh as the schedule rather than live — acceptable, since nothing here is
breaking news. Adds a failure mode where a stale pool serves old picks, so the
builder needs monitoring.

**Open:** schedule frequency; whether the pool is one flat table or partitioned by
reach/genre; and how the feedback loop marks pool entries as already served.

---

## ADR-009 — Score tracks for specialness; stop labelling reach per source
**2026-09-30 · proposed**

Replace the per-source `reach` label as the selection axis with a **per-track
specialness score**, computed from data the pipeline already fetches.

### The problem with what we have

`reach` is a hand-written claim about a *source*, so every track from Billboard is
"popular" and every track from KEXP is "niche". That is too coarse to express the
thing actually wanted. Billboard's #1 of 2014 and Billboard's #78 of 1979 carry
the same label, but one is a song everybody has heard and the other is a forgotten
chart record — which is exactly the interesting case.

It also conflated two different asks. "More popular" and "truly special" pull in
opposite directions when popular means *current chart-topper*. They stop
conflicting once the axis is **familiar versus chart-current** rather than
popular versus obscure.

### The score

Five components, all available from calls already being made:

1. **Dissimilar-source agreement.** Not the number of endorsements, but how
   *unlike* the endorsing sources are. Two indie blogs agreeing is weak. A track
   played on both a hip-hop show and a jazz show is crossing taste communities.
   Collaborative filtering structurally cannot find this — it works within
   clusters, and this signal is about travelling between them.

2. **Rediscovery gap** = curation date − release date. A DJ choosing a 1983 record
   *this week* means a person reached back for it. **Measured: 37% of a 100-play
   KEXP sample were records 15+ years old**, including Colourbox (1983), Portishead
   album cuts, Leonard Cohen (1967). Streaming algorithms cannot surface these,
   because an old track with no current streams has no collaborative signal.
   This is the strongest single edge available and it costs nothing — `releaseDate`
   comes free from iTunes and the play date comes free from the source.

3. **Obscurity** = inverse of Deezer's `rank`. The valuable quadrant is *low
   popularity × high curator conviction*: a record several respected curators
   played that almost nobody streams.

4. **Canon penalty.** Subtract for presence on current charts or Apple's
   most-played. The inverse of what every other generator optimises for.

5. **Has a human reason** — a gate, not a score component. Without a DJ comment or
   critic blurb there is nothing for the story layer to quote, and the story is
   half the product.

### Alternatives

- **Keep per-source reach** — simple, already built, but cannot distinguish a
  chart #1 from a chart #78, which is the whole point.
- **Audio-feature similarity** — what Spotify does; unavailable on the free path
  (Deezer's `bpm` returned 0 in testing) and would make this a worse copy of an
  existing product rather than a different one.
- **Ask an LLM to rate specialness** — unreliable and expensive per track, and it
  would be guessing from training data rather than measuring our own signals.

### Why

The goal was never a better recommendation engine. Streaming services have more
data and will win on similarity forever. The defensible position is the set of
songs their signals *cannot reach*: records with no current engagement, records
loved by curators but not streamed, records that travel between communities. Those
are findable with what we already have.

### Cost

A scoring function is a new thing to tune, and tuning needs listening rather than
metrics — there is no ground truth for "special". Weights will be wrong at first.
Rediscovery and obscurity also raise `resolve_risk`: older and less popular records
are likelier to be missing from Apple Music, so over-fetching has to increase.

### Open

The weights, and whether specialness ranks candidates or merely gates them. Also
whether to keep a small deliberate share of genuinely familiar tracks as anchors,
so the playlist has somewhere to stand.

---

## ADR-010 — Build the playlist as an acyclic chain over a large curated pool
**2026-09-30 · proposed**

Supersedes the reach-quota selection in ADR-007 and the reach labelling in ADR-009.
Labels stay, but as **description of what a run produced**, not as selection quotas.

### Shape

1. **Pool**: a large set of candidates, from curated sources only.
2. **Walk**: start at a seed track, then repeatedly step to a track linked to the
   *previous* one. Never revisit a track or an artist — the chain is acyclic and
   has no repeats.
3. **Genre is the continuity, not the variable.** Genre should stay broadly stable
   along the chain. Movement comes from the other edges. Drift is permitted but
   never forced.
4. **Story**: pick a few tracks, or the genre the chain spent most of its length in,
   and research those by retrieval.

Each hop records *why* it was taken. Those reasons are the story's spine, so the
narrative structure falls out of selection rather than being invented afterwards.

### Sources: curated only, no charts

**Billboard is dropped.** Chart position is not curation — no person chose those
songs, so a chart entry can contribute no reason and cannot justify a hop.

Dropping it costs no mainstream music, which was the worry. Katy Perry on BBC
Radio 2 is a *person* choosing to play Katy Perry. Familiar music arrives through
curated sources with a human attached, which is what was wanted; taking it from a
chart was the error.

Sources become: radio play logs (KEXP, BBC ×6, ABC ×2, SomaFM), editorial
(Deezer editorial, and the critic feeds once LLM extraction exists), and
**playlists made by other people**, which is where the volume comes from.

### Edges must be universal

KEXP's `labels` and MusicBrainz artist ids exist only on KEXP rows, so they cannot
carry a chain that spans every source. Four edges work for any track, free and
keyless (all verified, see SOURCES.md):

- **related artist** — Deezer `/artist/<id>/related`
- **shared record label** — Deezer `/album/<id>` → `label`
- **same broad genre** — iTunes `primaryGenreName`
- **near in time** — iTunes `releaseDate`

Strong links (same label, related artist) are preferred; weak links (same genre,
same decade) are the fallback when the walk would otherwise stall.

### Pool size is the prerequisite

A chain needs density or most hops have no candidate. Deezer playlist search
supplies it: **14 genre terms returned 2,115 playlists holding roughly 80,000
tracks**, and obscure terms ("dungeon synth", "funk 45", "no wave") return as many
matches as broad ones. `total` caps near 150 per query, so pool size is set by how
large the genre-term vocabulary is, not by pagination.

Cross-source agreement is **no longer a ranking signal**. Merging still dedupes the
same song arriving twice, but agreement doesn't decide order.

### Alternatives

- **Filter, sort, cap, slice** — what exists now. Produces a set with no relation
  between neighbours, so the story has no structure to describe.
- **Cluster into genre buckets** — gives grouping, but a playlist assembled from
  buckets reads as several playlists concatenated. A chain relates each track to
  its neighbour, which is what "loosely connected" means.
- **Forced drift** — considered and rejected: it fights the requirement that genre
  stay stable.

### Cost and risk

- **Sameness is now the failure mode**, not incoherence. With genre stable and no
  forced drift, a walk can circle one small neighbourhood. The counterweight is
  pool size plus a specialness preference among eligible next steps.
- **A chain is a sequence**, so this reintroduces ordering, which was previously
  called unimportant. Playback order can still be ignored; the chain is needed for
  *selection* and for the story regardless.
- Walks can dead-end and need a restart-or-backtrack rule.
- Edge lookups cost extra API calls per candidate, which only works against a
  pre-built pool — so ADR-008 becomes a prerequisite rather than an optimisation.

### Open

Seed choice; how many hops before a genre may shift; the strong-to-weak edge
ordering; and whether artists are unique per chain or only tracks.

---

## ADR-011 — Build a music map from playlist co-occurrence
**2026-09-30 · proposed**

Mine the playlists we harvest for **track co-occurrence** and store the result as a
persistent graph. An edge means *a human put these two tracks together*.

This changes ADR-010's edges: co-occurrence becomes the primary chain link, and the
four universal attribute edges (related artist, shared label, genre, era) become the
fallback for tracks the map doesn't cover yet.

### Why this is better than what ADR-010 proposed

ADR-010's edges are indirect. Deezer's related-artists is algorithmic and works at
*artist* level. Shared genre and nearby release date are attribute coincidences —
two 1983 records aren't meaningfully connected just because they're both from 1983.

Playlist co-occurrence is **track-level and human-authored**. If two tracks appear
together in fourteen different playlists, fourteen people independently decided they
belong near each other. That is exactly the "loosely connected" link the chain needs,
and it is a much stronger claim than any attribute match.

It also costs no extra fetching. We are already pulling playlist tracks for the pool;
the map is built from storing what passes through.

### Two grades of edge

**Co-membership** — both tracks appear in the same playlist.
**Adjacency** — they appear *consecutively*. Someone sequenced them deliberately, so
this is the stronger signal. Deezer returns playlist tracks in order, so adjacency is
available for free.

### The critical detail: normalise, don't count

Raw co-occurrence counts will surface hits and nothing else, because a popular track
co-occurs with everything. The edge has to mean "these two appear together *more than
their individual popularity explains*" — a pointwise-mutual-information style measure
rather than a tally.

Without this the map degenerates into a popularity chart with extra steps, which is
the exact failure this project exists to avoid.

### Playlist quality has to be weighted

Not all harvested playlists are equal signal. Observed while probing: a 918-track
"Disco Soul Dance Funk & HipHop Hits 70's" and a 292-track "Ambient Dreams - Peaceful
Relaxation Music" sit alongside a 70-track "Krautrock Essentials". The first two are
near-random dumps; the third is a considered selection.

So weight each playlist's contribution inversely to its size, and consider excluding
very large or generically-titled playlists outright. A 50-track themed playlist is
worth more than a 900-track catch-all.

### What the map gives beyond chain edges

- **Emergent genre neighbourhoods**, discovered from how people actually group music
  rather than from iTunes' genre labels.
- **Bridge tracks** — tracks connecting otherwise separate clusters. This recovers the
  "crossing taste communities" idea from ADR-009, but measured at track level from real
  human groupings instead of inferred from source labels.
- **A compounding asset.** Every scheduled build makes the map denser. Unlike a
  candidate pool, it does not go stale — a human grouping from last year is still a
  human grouping.

A second, personal layer can sit on top later: the playlists *we* generate, plus what
Mason keeps or skips, form a much smaller graph of his own taste. Worth keeping
separate from the public map so one can't contaminate the other.

### Alternatives

- **Attribute edges only** (ADR-010 as written) — works with no storage, but the links
  are weak and not human-authored.
- **Deezer related-artists only** — free and universal, but artist-level and
  algorithmic, so it recreates the similarity engines we can't beat.
- **Audio-feature similarity** — unavailable free, and competes where we lose.

### Cost and risk

- **Needs real storage**, so ADR-008's scheduled builder becomes a hard prerequisite.
  A graph cannot be rebuilt inside a voice request.
- **Cold start.** A track in one playlist has no usable edges. The attribute edges are
  the fallback, which means both systems must exist.
- **Scope.** This is a graph-building project sitting inside a playlist project. It is
  the largest single piece of work proposed so far and should be timeboxed against a
  question it answers, not built speculatively.
- Deezer's per-query `total` caps near 150, so map growth depends on the breadth of the
  genre-term vocabulary used to harvest.

### Open

Storage shape (D1 relational vs KV adjacency lists); the normalisation formula and its
minimum-occurrence threshold; playlist quality cutoffs; and whether adjacency and
co-membership are one weighted edge or two separate ones.
