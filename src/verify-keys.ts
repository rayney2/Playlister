// Checks every credential in .env against its live service and reports pass/fail.
//
// It never prints a secret - only a masked fingerprint, so output is safe to paste
// anywhere. Run it after editing .env:
//
//   npm run verify:keys
//
// Why this exists: a wrong credential doesn't throw, it returns an empty result
// set. That looks identical to "this source has no data today". All six BBC
// stations silently contributed zero for exactly this class of reason. Checking
// credentials explicitly, once, is cheaper than debugging a quiet pipeline.

const mask = (v: string) => v.length < 8 ? '*'.repeat(v.length) : `${v.slice(0, 4)}…${v.slice(-3)} (${v.length} chars)`;

type Result = { name: string; state: 'ok' | 'bad' | 'unset'; detail: string };

async function checkLastfm(key?: string): Promise<Result> {
  const name = 'Last.fm';
  if (!key) return { name, state: 'unset', detail: 'LASTFM_API_KEY not set' };
  const url = `https://ws.audioscrobbler.com/2.0/?method=tag.getTopTracks&tag=shoegaze&api_key=${key}&format=json&limit=3`;
  try {
    const res = await fetch(url);
    const body = await res.json() as { tracks?: { track?: unknown[] }; message?: string };
    if (body.message) return { name, state: 'bad', detail: body.message };
    // The payload key is `tracks`, NOT `toptracks` - getting this wrong reads as
    // zero results from a perfectly good key.
    const n = body.tracks?.track?.length ?? 0;
    return n > 0
      ? { name, state: 'ok', detail: `${n} tracks returned · ${mask(key)}` }
      : { name, state: 'bad', detail: 'authenticated but returned no tracks' };
  } catch (err) {
    return { name, state: 'bad', detail: (err as Error).message };
  }
}

async function checkDiscogs(token?: string): Promise<Result> {
  const name = 'Discogs';
  if (!token) return { name, state: 'unset', detail: 'DISCOGS_TOKEN not set (works unauthenticated, but rate-limited to ~25/min)' };
  try {
    const res = await fetch('https://api.discogs.com/database/search?q=krautrock&type=release&per_page=2', {
      // Discogs rejects requests without a descriptive User-Agent.
      headers: { 'User-Agent': 'Playlister/0.1', Authorization: `Discogs token=${token}` },
    });
    if (res.status === 401) return { name, state: 'bad', detail: 'HTTP 401 — invalid token. Is this the personal access token, not the consumer key?' };
    const body = await res.json() as { results?: unknown[]; pagination?: { items?: number } };
    const items = body.pagination?.items ?? 0;
    return { name, state: 'ok', detail: `${items.toLocaleString()} releases matched · ${mask(token)}` };
  } catch (err) {
    return { name, state: 'bad', detail: (err as Error).message };
  }
}

async function checkSpotify(id?: string, secret?: string): Promise<Result> {
  const name = 'Spotify';
  if (!id || !secret) return { name, state: 'unset', detail: 'SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET not set' };
  try {
    // Client Credentials: trade id+secret for a 1-hour token. No user involved,
    // which is why this flow can only ever reach public data.
    const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret }),
    });
    const tok = await tokenRes.json() as { access_token?: string; error?: string; error_description?: string };
    if (!tok.access_token) {
      return { name, state: 'bad', detail: `${tok.error ?? 'no token'} — ${tok.error_description ?? 'check the id and secret'}` };
    }
    const searchRes = await fetch('https://api.spotify.com/v1/search?q=krautrock&type=playlist&limit=3', {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    });
    if (!searchRes.ok) return { name, state: 'bad', detail: `token minted, but search returned HTTP ${searchRes.status}` };
    const body = await searchRes.json() as { playlists?: { total?: number } };
    return { name, state: 'ok', detail: `token minted · ${body.playlists?.total?.toLocaleString() ?? '?'} playlists matched · id ${mask(id)}` };
  } catch (err) {
    return { name, state: 'bad', detail: (err as Error).message };
  }
}

const results = await Promise.all([
  checkLastfm(process.env.LASTFM_API_KEY),
  checkDiscogs(process.env.DISCOGS_TOKEN),
  checkSpotify(process.env.SPOTIFY_CLIENT_ID, process.env.SPOTIFY_CLIENT_SECRET),
]);

console.log('\nCredential check (no secrets printed)\n');
for (const r of results) {
  const badge = { ok: 'PASS', bad: 'FAIL', unset: ' -- ' }[r.state];
  console.log(`  ${badge}  ${r.name.padEnd(9)} ${r.detail}`);
}
const bad = results.filter((r) => r.state === 'bad');
const unset = results.filter((r) => r.state === 'unset');
console.log(`\n  ${results.length - bad.length - unset.length} working · ${bad.length} failing · ${unset.length} not set`);
console.log('\nEverything else in the pipeline needs no credentials at all. See ACCESS.md.\n');
