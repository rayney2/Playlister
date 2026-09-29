# Playlister

On-demand human-curated music discovery: pull picks from sources where a person
chose the track, resolve them to Apple Music, and return a source-grounded
listening guide. Triggered by Siri on iPhone.

## Stack

- **Backend**: TypeScript, targeting Cloudflare Workers (free tier). Written
  dependency-free so modules run unchanged under Node and in a Worker.
- **Local runner**: Node 24, which executes TypeScript natively. No build step.
- **Client**: an iOS Shortcut. No Xcode project.

## Commands

```bash
node --experimental-strip-types src/cli.ts --storefront us --tracks 12
node --experimental-strip-types src/cli.ts --probe-feeds   # source diagnostics
```

Add `--commit` to record surfaced tracks in `data/history.json` so later runs
don't repeat them.

## Constraints

- **No Apple Developer Program.** No MusicKit / Apple Music API. Free iTunes
  Search API only; fuzzy text matching, no ISRC. The ISRC path stays stubbed at
  `resolveByIsrc()` for if that changes.
- **iPhone is the target device.** No Mac-only tricks; no AppleScript.
- **Build the playlist in the Music app**, don't just queue and play. Don't
  clutter the library.
- **Host outside mainland China.** Some sources are blocked or unreliable from
  Beijing.
- **Storefront**: `us` for the MVP. CN compatibility is a post-MVP concern; the
  resolver already supports it and `NOTES.md` records what it costs.

## How I want you to work on this

The rule: **nothing enters this repo that I can't explain to someone else** —
what it does, why it's structured that way, and what would break it. If I can't,
I either learn it or we delete it.

- **Plan before code.** For anything non-trivial, lead with the approach, the
  alternatives, and what it will touch. Wait for me to push back. Use plan mode.
- **One concern per request.** I commit before accepting changes so every diff is
  reviewable.
- **Don't invent architecture.** Abstractions are earned by duplication I have
  actually seen, not duplication you predict. A premature layer is a defect here.
- **Don't refactor across files I haven't read.** Say the refactor is needed and
  let me choose.
- **If I haven't stated what I want in two sentences, stop and make me.** Code
  generated against a vague ask is plausible and wrong, which is worse than none.
- Prefer explaining and reviewing over writing. I'd rather author it and get
  critiqued than accept something I merely approve of.
- When you write something novel, expect me to delete it and reimplement from
  your explanation. Write the explanation with that in mind.

`/output-style learning` is on for this project when I want the handoff
behaviour (`TODO(human)` markers) rather than finished code.

## Files that carry context

- `SOURCES.md` — the labelled source registry: what each source yields, what's
  verified working, and what's ruled out and why. Check here before hunting for
  a new source.
- `NOTES.md` — measured facts about live APIs. Read before touching sources or
  the resolver. Don't re-derive what's already measured there.
- `DECISIONS.md` — one entry per hard-to-reverse decision. Append, don't rewrite.
- `BACKLOG.md` — what's next, plus a parking lot. New ideas go to the parking
  lot, not the backlog.
- `LEARNED.md` — one thing per session in my own words. Ask me to fill it in at
  the end of a session and flag where my understanding looks thin.
