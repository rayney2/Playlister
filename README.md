# Playlister

On-demand curated music discovery. Pulls picks from sources where a **person**
chose the track, resolves them to Apple Music, and (eventually) writes a
source-grounded listening guide. Triggered by Siri.

See `CLAUDE.md` for how to work on it, `SOURCES.md` for what each source yields,
`DECISIONS.md` for why things are the way they are, and `NOTES.md` for measured
facts about the live APIs.

## Open it

There is no Xcode project — this is TypeScript, not Swift. Use VS Code:

```bash
open -a "Visual Studio Code" /Users/mason/Projects/Playlister
```

The `code` command isn't on your PATH. To add it: open VS Code, press
`Cmd+Shift+P`, run **Shell Command: Install 'code' command in PATH**. Then
`code .` works from any directory.

Node 24 runs TypeScript natively, so there is nothing to install and no build
step. No `npm install` needed — the project has zero dependencies.

## Run it

```bash
npm run discover                  # 15 tracks, default 40/40/20 popularity mix
npm run discover:niche            # bias hard toward obscure picks
npm run discover:wide             # 25 tracks, tighter per-source cap
npm run probe:feeds               # diagnose editorial feed extraction rates
```

A run takes roughly 40 seconds, almost all of it waiting on iTunes rate limits.
(ADR-008 proposes fixing that with a scheduled pool.)

### Knobs

Every flag can go on `npm run discover -- --flag value`:

| flag | default | what it does |
|---|---|---|
| `--tracks` | 15 | playlist length |
| `--storefront` | `us` | Apple Music storefront; `cn` also works |
| `--popular` `--mid` `--niche` | 0.4 / 0.4 / 0.2 | target mix across the obscure-to-mainstream axis |
| `--max-per-artist` | 1 | ceiling per artist |
| `--max-source-share` | 0.25 | ceiling on any one source's share |
| `--years` | 1968,1979,1985,1994,2003,2014 | which Billboard year-end charts to sample |
| `--commit` | off | record the surfaced tracks in `data/history.json` so later runs don't repeat them |

Without `--commit` it's a dry run and nothing is written.

### What the output means

- **Candidates by source** — how much each source contributed, with its label.
  A source showing `0` is broken; check `NOTES.md` before assuming it's dead.
- **Funnel** — raw → merged → after history → after caps → attempted → resolved.
  Where tracks are being lost.
- **Reach / genre / era spread** — whether the diversity targets were actually met.
- **`via a + b`** on a track means more than one source picked it independently.
  That's the strongest quality signal in the system.

## Test it

```bash
npm test              # all tests
npm run test:watch    # re-run on save
```

Tests use `node:test` and `node:assert`, which ship with Node. No framework.

`src/lib/normalize.test.ts` and `src/resolve/itunes.test.ts` each contain worked
examples plus `TODO(human)` cases left deliberately unwritten — see `CLAUDE.md`.
