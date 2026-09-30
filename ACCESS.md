# Getting access to the data

What needs a key, what doesn't, how to get each one, and how to check it worked.

Every command below is copy-pasteable. Endpoint behaviour and error messages were
verified on 2026-09-30.

---

## Part 1 — What needs nothing at all

**Most of the system already works with zero credentials.** Nothing to sign up for,
nothing to configure. These are live and in use:

| source | what it gives |
|---|---|
| **KEXP** `api.kexp.org` | DJ play logs with written comments, archive to 2001 |
| **BBC** `rms.api.bbc.co.uk` | 7 stations: 6 Music, R1, R2, R3 (classical), 1Xtra, Asian Network |
| **ABC Australia** `music.abcradio.net.au` | Double J, Unearthed (unsigned artists), Classic |
| **SomaFM** `somafm.com` | 46 genre-labelled channels |
| **Deezer** `api.deezer.com` | playlist search, editorial playlists, genre charts, ISRCs, related artists, album labels |
| **iTunes Search** `itunes.apple.com` | Apple Music resolution, broad genre, release date |
| **Wikipedia** `en.wikipedia.org/api/rest_v1` | critic lists, Billboard year-end tables |
| **ListenBrainz** `api.listenbrainz.org` | fresh releases, user playlists |
| **MusicBrainz** `musicbrainz.org/ws/2` | release and label metadata |
| **Internet Archive** `archive.org` | 300k+ live recordings, 310k+ pre-1950 items |
| **Editorial RSS** | Quietus, Crack, Gorilla vs Bear, Bandcamp Daily, NPR, Stereogum and more |

**Discogs is a special case.** `api.discogs.com/database/search` returns **200 with
no token at all** (263,697 results for a one-word query). But an *invalid* token
returns 401 — so if you're not authenticating, send no token rather than a wrong
one. Unauthenticated requests are rate-limited to roughly 25/minute, which is fine
for a scheduled build and not for a live request.

Two etiquette rules for the keyless sources, both already handled in `src/lib/http.ts`:
send a real User-Agent identifying the project, and space requests out. MusicBrainz
in particular will block a client that hammers it.

---

## Part 2 — Free keys worth getting

Three services need a key, all free, all a few minutes. None require payment or a
card.

### Last.fm — genre-tagged tracks at volume

Best for `tag.getTopTracks`, which returns tracks by genre tag — useful for
widening the pool beyond playlist search.

1. Go to **https://www.last.fm/api/account/create**
2. Sign in (or make a free Last.fm account).
3. Fill in an application name (`Playlister`) and a description. Callback URL and
   homepage can be left blank for read-only use.
4. Submit. The **API key** appears immediately. Copy it. (There's also a shared
   secret — you don't need it for read-only calls.)

Verify:

```bash
curl -s "https://ws.audioscrobbler.com/2.0/?method=tag.gettoptracks&tag=shoegaze&api_key=YOUR_KEY&format=json" | head -c 300
```

You should see a `toptracks` object. If the key is wrong you get a clear message:

```json
{"message":"Invalid API key - You must be granted a valid key by last.fm","error":10}
```

### Spotify — the largest playlist ecosystem

Worth having because no other service has as many user playlists. Read-only public
data needs no user login, just an app registration (the Client Credentials flow).

1. Go to **https://developer.spotify.com/dashboard**
2. Log in with a normal Spotify account (free tier is fine).
3. **Create app**. Name and description can be anything. Redirect URI is required
   by the form but unused by this flow — `http://localhost:3000` is fine.
4. Agree to the terms, create, then open the app's **Settings**.
5. Copy the **Client ID**, then **View client secret** and copy that too.

Get a token (they last 1 hour, so the backend requests one per run):

```bash
curl -s -X POST https://accounts.spotify.com/api/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=YOUR_ID&client_secret=YOUR_SECRET"
```

You get `{"access_token":"...","token_type":"Bearer","expires_in":3600}`. Then:

```bash
curl -s -H "Authorization: Bearer YOUR_TOKEN" \
  "https://api.spotify.com/v1/search?q=krautrock&type=playlist&limit=3" | head -c 400
```

Wrong or missing credentials give `{"error":"invalid_client"}` with HTTP 400 from
the token endpoint, and HTTP 401 from the API.

One caveat: Spotify restricted some playlist and recommendation endpoints for new
third-party apps in late 2024. Search and reading public playlists is the part we
want — confirm it still returns what you need before building on it.

### Discogs — actual records, with labels and years

Only needed to lift the ~25/minute unauthenticated rate limit.

1. Go to **https://www.discogs.com/settings/developers**
2. Sign in to a free Discogs account.
3. Click **Generate new token** under *Personal access token*.
4. Copy it. This is a single token — no OAuth dance needed for read-only search.

Verify:

```bash
curl -s -A "Playlister/0.1" "https://api.discogs.com/database/search?q=krautrock&type=release&per_page=2&token=YOUR_TOKEN" | head -c 300
```

A bad token gives HTTP 401 and
`{"message":"Invalid consumer token. Please register an app before making requests."}`

Discogs requires a descriptive User-Agent and will reject requests without one.

---

## Part 3 — Where to put the keys

Never in source. Both filenames below are already in `.gitignore`, and
`.env.example` documents the variables.

**Locally:**

```bash
cp .env.example .env
# then edit .env and paste the values in
```

**On Cloudflare Workers**, local dev reads `.dev.vars` (same format as `.env`), and
production secrets are set with Wrangler rather than committed:

```bash
npx wrangler secret put LASTFM_API_KEY
npx wrangler secret put SPOTIFY_CLIENT_ID
npx wrangler secret put SPOTIFY_CLIENT_SECRET
npx wrangler secret put DISCOGS_TOKEN
```

Each prompts for the value and stores it encrypted. They arrive in the Worker on
the `env` object.

Check nothing leaked before committing:

```bash
git ls-files | grep -iE "\.env$|\.dev\.vars|secret|token" || echo "clean"
```

---

## Part 4 — Deliberately not obtained

**Apple Developer Program — $99/year.** The only thing that unlocks the Apple Music
API, which would give exact ISRC matching (`filter[isrc]`) and real playlist write
access. Deferred by ADR-001. The code keeps a stub at `resolveByIsrc()` so it can be
switched on without reshaping the resolver, and Deezer already supplies the ISRCs
for free, so nothing needs backfilling later.

**Spinitron** — needs a per-station token, and many US college stations use it.
Worth revisiting if a token is ever obtainable, since those stations are exactly
the obscure curation that record shops would have given us.

**RateYourMusic** — no API, and scraping breaks their terms. Excluded by choice,
not by capability.
