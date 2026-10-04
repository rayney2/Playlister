/**
 * Run an async function over a list with bounded concurrency.
 *
 * The harvest was serial, paying full network latency for every playlist in turn.
 * Measured: Deezer answers a playlist fetch in ~656ms, and 8 requests in parallel
 * complete at an effective 165ms each - a 3.4x speedup - with no rejections
 * (8 of 8 returned 200). So the latency was never the limit; the serial loop was.
 *
 * Order of results matches order of input, which matters for the map: playlist
 * track order encodes sequencing, and we rely on it for adjacency.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
