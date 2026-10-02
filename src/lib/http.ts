const UA = 'Playlister/0.1 (personal music discovery; contact via github)';

// Deezer localises artist and genre names to the request locale, and with no
// Accept-Language it guessed Japanese: Tangerine Dream came back as
// タンジェリン・ドリーム, Kraftwerk as クラフトワーク. That silently SPLITS an artist
// into two separate nodes in the music map and two separate dedupe keys, so it is
// a correctness bug, not a cosmetic one. Measured: 13 of 30 artist names mangled
// without this header, 0 with it.
const ACCEPT_LANGUAGE = 'en-US,en;q=0.9';

/** fetch with retry on transient failures. KEXP 502s under load. */
export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  tries = 4,
): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: { 'User-Agent': UA, 'Accept-Language': ACCEPT_LANGUAGE, ...(init.headers ?? {}) },
      });
      // Retry server errors and rate limits; 4xx (except 429) won't improve.
      if (res.status >= 500 || res.status === 429) {
        throw new Error(`HTTP ${res.status}`);
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (i < tries - 1) await sleep(1200 * (i + 1));
    }
  }
  throw new Error(`fetch failed after ${tries} tries: ${url} (${lastErr})`);
}

export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return (await res.json()) as T;
}

export async function fetchText(url: string): Promise<string> {
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.text();
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
