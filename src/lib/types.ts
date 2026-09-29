// Shared shapes. Kept dependency-free so every module runs unchanged
// in Node (local CLI) and in a Cloudflare Worker.

/** A track recommended by a human, before we know if Apple Music has it. */
export interface Candidate {
  artist: string;
  title: string;
  album?: string;
  /** Which source recommended it, e.g. "KEXP" or "Pitchfork". */
  source: string;
  /** Human context: DJ comment, critic blurb. This is what grounds the story. */
  blurb?: string;
  /** Link back to the source, for attribution. */
  sourceUrl?: string;
  /** When the source recommended it (ISO 8601). */
  seenAt?: string;
  /** MusicBrainz artist MBIDs when the source provides them (KEXP does). */
  mbidArtists?: string[];
  /** MusicBrainz recording MBID, the bridge to an ISRC lookup. */
  mbidRecording?: string;
  /** ISRC when known. Unused on the free path; see resolve/itunes.ts. */
  isrc?: string;
  /** 0-1. How sure we are we parsed a real artist/title out of the source. */
  confidence: number;
}

/** A candidate merged across sources, with every endorsement kept. */
export interface MergedCandidate extends Candidate {
  /** All sources that recommended this track, most recent first. */
  endorsements: Array<{
    source: string;
    blurb?: string;
    sourceUrl?: string;
    seenAt?: string;
  }>;
}

/** A candidate successfully located in Apple Music. */
export interface ResolvedTrack extends MergedCandidate {
  appleTrackId: number;
  appleUrl: string;
  appleArtist: string;
  appleTitle: string;
  durationMs?: number;
  /** True when the track exists in the user's own storefront. */
  availableInStorefront: boolean;
  /** How we matched: exact string, fuzzy string, or ISRC (paid path). */
  matchMethod: 'exact' | 'fuzzy' | 'isrc';
}
