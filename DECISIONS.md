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
