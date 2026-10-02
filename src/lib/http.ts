const UA = 'Playlister/0.1 (personal music discovery; contact via github)';

// Deezer localises artist and genre names to the request locale, and with no
// Accept-Language it guessed Japanese: Tangerine Dream came back as
// タンジェリン・ドリーム, Kraftwerk as クラフトワーク. That silently SPLITS an artist
// into two separate nodes in the music map and two separate dedupe keys, so it is
// a correctness bug, not a cosmetic one. Measured: 13 of 30 artist names mangled
// without this header, 0 with it.
const ACCEPT_LANGUAGE = 'en-US,en;q=0.9';

export interface RetryOptions {
  tries?: number;
  /**
   * Extra status codes to treat as transient. iTunes answers 403 when it is
   * throttling, not when access is genuinely forbidden, so the resolver passes
   * [403] here. Other APIs mean 403 literally (Spotify's playlist endpoints), so
   * this is opt-in rather than global.
   */
  retryStatuses?: number[];
  /** Base backoff. Throttle penalties need far longer waits than a 502 does. */
  backoffMs?: number;
}

/** fetch with retry on transient failures. KEXP 502s under load. */
export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  opts: RetryOptions = {},
): Promise<Response> {
  const tries = opts.tries ?? 4;
  const extra = new Set(opts.retryStatuses ?? []);
  const backoff = opts.backoffMs ?? 1200;
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: { 'User-Agent': UA, 'Accept-Language': ACCEPT_LANGUAGE, ...(init.headers ?? {}) },
      });
      if (res.status >= 500 || res.status === 429 || extra.has(res.status)) {
        throw new ThrottledError(res.status);
      }
      return res;
    } catch (err) {
      lastErr = err;
      // Exponential, because a throttle window does not clear on a fixed schedule.
      if (i < tries - 1) await sleep(backoff * Math.pow(2, i));
    }
  }
  throw new Error(`fetch failed after ${tries} tries: ${url} (${lastErr})`);
}

/** Distinguishes "the service pushed back" from "the data is not there". */
export class ThrottledError extends Error {
  // Declared explicitly rather than as a constructor parameter property: Node's
  // strip-only TypeScript mode removes types but cannot GENERATE the assignment a
  // parameter property implies, so `constructor(public readonly status: number)`
  // is a syntax error here. Same reason enums and decorators are unavailable.
  readonly status: number;

  constructor(status: number) {
    super(`HTTP ${status} (transient)`);
    this.name = 'ThrottledError';
    this.status = status;
  }
}

export async function fetchJson<T>(url: string, opts?: RetryOptions): Promise<T> {
  const res = await fetchWithRetry(url, {}, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return (await res.json()) as T;
}

export async function fetchText(url: string): Promise<string> {
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.text();
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
