// The source registry in code. SOURCES.md is the prose version; this is the part
// the pipeline reads. Every source declares its shape so quotas can be filled
// from labels rather than from whatever happens to arrive first (ADR-007).

export type Curation = 'human-dj' | 'human-critic' | 'chart' | 'algorithmic' | 'archive';

/**
 * Where a source sits on the obscure-to-mainstream axis.
 *
 * This is a per-SOURCE claim, not a per-track measurement. It exists because a
 * playlist drawn only from tastemaker radio is uniformly niche, which is a real
 * failure mode: the goal is music Mason doesn't know, which includes well-known
 * songs he simply never played.
 */
export type Reach = 'popular' | 'mid' | 'niche';

export interface SourceDescriptor {
  id: string;
  name: string;
  curation: Curation;
  reach: Reach;
  /** Broad genre claim for sampling. The per-track genre comes from iTunes. */
  genres: string;
  era: 'current' | 'recent' | 'archive' | 'specific-year';
  /** Does it supply a quotable human reason? Drives the story layer. */
  story: boolean;
}

export const SOURCES: Record<string, SourceDescriptor> = {
  // --- niche / tastemaker ---
  kexp:        { id:'kexp',        name:'KEXP',                curation:'human-dj',     reach:'niche',   genres:'indie, experimental electronic', era:'recent',  story:true  },
  somafm:      { id:'somafm',      name:'SomaFM',              curation:'human-dj',     reach:'niche',   genres:'ambient, electronic, americana', era:'current', story:false },
  bbc_6music:  { id:'bbc_6music',  name:'BBC 6 Music',         curation:'human-dj',     reach:'mid',     genres:'eclectic, alternative',          era:'current', story:false },
  bbc_1xtra:   { id:'bbc_1xtra',   name:'BBC 1Xtra',           curation:'human-dj',     reach:'mid',     genres:'hip hop, R&B, dancehall',        era:'current', story:false },
  bbc_asian:   { id:'bbc_asian',   name:'BBC Asian Network',   curation:'human-dj',     reach:'mid',     genres:'South Asian',                    era:'current', story:false },
  bbc_radio3:  { id:'bbc_radio3',  name:'BBC Radio 3',         curation:'human-dj',     reach:'mid',     genres:'classical',                      era:'archive', story:false },
  abc_unearthed:{id:'abc_unearthed',name:'ABC Unearthed',      curation:'human-dj',     reach:'niche',   genres:'unsigned, emerging',             era:'current', story:false },
  abc_doublej: { id:'abc_doublej', name:'ABC Double J',        curation:'human-dj',     reach:'mid',     genres:'alternative, older catalogue',   era:'recent',  story:false },

  // --- the popular end, which the playlist was missing entirely ---
  bbc_radio1:  { id:'bbc_radio1',  name:'BBC Radio 1',         curation:'human-dj',     reach:'popular', genres:'pop, new releases',              era:'current', story:false },
  bbc_radio2:  { id:'bbc_radio2',  name:'BBC Radio 2',         curation:'human-dj',     reach:'popular', genres:'pop, soul, classic hits',        era:'recent',  story:false },
  deezer_chart:{ id:'deezer_chart',name:'Deezer genre charts', curation:'chart',        reach:'popular', genres:'broad: 28 genres',               era:'current', story:false },
  deezer_edit: { id:'deezer_edit', name:'Deezer editorial',    curation:'human-critic', reach:'mid',     genres:'themed playlists',               era:'current', story:false },
  billboard:   { id:'billboard',   name:'Billboard Year-End',  curation:'chart',        reach:'popular', genres:'broad: chart pop of its year',   era:'specific-year', story:false },

  // --- editorial feeds. story:true because a critic's own words are the best
  // grounding material we get, but they need LLM extraction first (ADR-004).
  pitchfork:      { id:'pitchfork',      name:'Pitchfork',      curation:'human-critic', reach:'mid',   genres:'indie, broad coverage', era:'recent', story:true },
  stereogum:      { id:'stereogum',      name:'Stereogum',      curation:'human-critic', reach:'mid',   genres:'indie rock',            era:'recent', story:true },
  bandcamp_daily: { id:'bandcamp_daily', name:'Bandcamp Daily', curation:'human-critic', reach:'niche', genres:'experimental, global',   era:'recent', story:true },
  npr_music:      { id:'npr_music',      name:'NPR Music',      curation:'human-critic', reach:'mid',   genres:'broad',                  era:'recent', story:true },
};
