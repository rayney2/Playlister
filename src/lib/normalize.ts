import type { Candidate, MergedCandidate } from './types.ts';

/**
 * Collapse a string to a comparison key: strip diacritics, bracketed
 * asides, featured-artist tails, and punctuation. "Deee‐Lite" and
 * "Deee-Lite" must land on the same key, so the unicode hyphen matters.
 */
export function norm(input: string | undefined): string {
  return (input ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, '')
    .replace(/\b(feat|ft|featuring|with)\b.*$/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function trackKey(artist: string, title: string): string {
  return `${norm(artist)}|${norm(title)}`;
}

/**
 * Merge candidates that are the same song from different sources.
 *
 * A track two sources independently picked is a stronger signal than one
 * pick, so we keep every endorsement rather than discarding duplicates —
 * the story step cites all of them.
 */
export function mergeCandidates(candidates: Candidate[]): MergedCandidate[] {
  const byKey = new Map<string, MergedCandidate>();

  for (const c of candidates) {
    const key = trackKey(c.artist, c.title);
    if (!key.replace('|', '').trim()) continue;

    const existing = byKey.get(key);
    const endorsement = {
      source: c.source,
      blurb: c.blurb,
      sourceUrl: c.sourceUrl,
      seenAt: c.seenAt,
    };

    if (!existing) {
      byKey.set(key, { ...c, endorsements: [endorsement] });
      continue;
    }

    existing.endorsements.push(endorsement);
    // Prefer the higher-confidence parse for the canonical strings.
    if (c.confidence > existing.confidence) {
      existing.artist = c.artist;
      existing.title = c.title;
      existing.confidence = c.confidence;
    }
    existing.album ??= c.album;
    existing.blurb ??= c.blurb;
    existing.mbidArtists ??= c.mbidArtists;
    existing.mbidRecording ??= c.mbidRecording;
    existing.isrc ??= c.isrc;
  }

  for (const m of byKey.values()) {
    m.endorsements.sort((a, b) => (b.seenAt ?? '').localeCompare(a.seenAt ?? ''));
  }
  return [...byKey.values()];
}

/**
 * Cap how many tracks one artist can contribute, so a single heavy-rotation
 * act can't take over the playlist. Order is otherwise preserved.
 */
export function capPerArtist<T extends { artist: string }>(items: T[], max: number): T[] {
  const counts = new Map<string, number>();
  const kept: T[] = [];
  for (const item of items) {
    const key = norm(item.artist);
    const n = counts.get(key) ?? 0;
    if (n >= max) continue;
    counts.set(key, n + 1);
    kept.push(item);
  }
  return kept;
}

/**
 * Drop anything already heard. `history` holds normalized track keys, so the
 * playlist only ever contains music that is new to the listener.
 */
export function excludeHeard<T extends { artist: string; title: string }>(
  items: T[],
  history: Set<string>,
): T[] {
  return items.filter((i) => !history.has(trackKey(i.artist, i.title)));
}
