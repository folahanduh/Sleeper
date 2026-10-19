/**
 * Traction model. A song's season growth is the MINIMUM of its per-source growth:
 *
 *   growth_s = max(0, final_s - base_s) / (base_s + K_s)
 *
 * across every source measured at both the start and the end of the season.
 * Last.fm (listeners) is always measured: "track not found" means 0 listeners. YouTube
 * (views) only counts if the launcher linked the official upload. Taking the minimum
 * means botting one platform can't lift a song; it has to grow everywhere.
 *
 * On-chain the program computes (final - baseline) / (baseline + K_chain), so we post
 * final = baseline + growth * (baseline + K_chain), which makes the on-chain score equal
 * the combined growth.
 */

export type Components = {
  /** Last.fm all-time unique listeners (0 if Last.fm doesn't know the track yet). */
  lastfm: number;
  /** YouTube view count of the linked video; null if not linked or the video is gone. */
  youtube: number | null;
};

export const YOUTUBE_SMOOTHING = 20_000n;

/** growth as an exact fraction */
export type Ratio = { num: bigint; den: bigint };

function sourceGrowth(base: number, fin: number, k: bigint): Ratio {
  const b = BigInt(base);
  const f = BigInt(fin);
  return { num: f > b ? f - b : 0n, den: b + (k > 0n ? k : 1n) };
}

function lt(a: Ratio, b: Ratio): boolean {
  return a.num * b.den < b.num * a.den;
}

export type GrowthBreakdown = {
  lastfm: Ratio;
  youtube: Ratio | null;
  combined: Ratio;
};

export function combinedGrowth(base: Components, fin: Components, lastfmSmoothing: bigint): GrowthBreakdown {
  const lastfm = sourceGrowth(base.lastfm, fin.lastfm, lastfmSmoothing);
  const youtube =
    base.youtube !== null && fin.youtube !== null ? sourceGrowth(base.youtube, fin.youtube, YOUTUBE_SMOOTHING) : null;
  let combined = lastfm;
  if (youtube && lt(youtube, combined)) combined = youtube;
  return { lastfm, youtube, combined };
}

/** The final_traction to post on-chain so the program's score equals `growth`. */
export function chainFinal(chainBaseline: bigint, chainSmoothing: bigint, growth: Ratio): bigint {
  if (growth.num === 0n) return chainBaseline;
  return chainBaseline + (growth.num * (chainBaseline + chainSmoothing)) / growth.den;
}

/** Mirror of the program's growth_score (SCORE_ONE = 1e6), for display and tests. */
export function chainScore(baseline: bigint, fin: bigint, smoothing: bigint, max: bigint): bigint {
  if (fin <= baseline) return 0n;
  const s = ((fin - baseline) * 1_000_000n) / (baseline + (smoothing > 0n ? smoothing : 1n));
  return s < max ? s : max;
}

export function ratioToNumber(r: Ratio): number {
  return Number((r.num * 1_000_000n) / r.den) / 1_000_000;
}

/** Loose title match for checking a linked YouTube video is really this song. */
export function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\((feat|ft|with|prod)[^)]*\)|\[(feat|ft|with|prod)[^\]]*\]/g, " ")
    .replace(/\b(feat|ft)\.?\s.*$/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Strip "(feat. X)", " - Remastered 2011" etc. for a second Last.fm lookup. */
export function baseTitle(s: string): string {
  return s
    .replace(/\s*[([](feat|ft|with|prod)\.?[^)\]]*[)\]]/gi, "")
    .replace(/\s+-\s+.*(remaster|version|edit|mix|live|mono|stereo).*$/i, "")
    .trim();
}
