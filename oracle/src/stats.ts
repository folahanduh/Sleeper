/** All real-world data access, behind one interface so tests can substitute it. */
import { deezerSearch, deezerTrack, type DeezerSearchHit, type DeezerTrack } from "./sources/deezer.js";
import type { Fetch } from "./sources/http.js";
import { lastfmTrack, type LastfmStats } from "./sources/lastfm.js";
import { youtubeVideo, type YoutubeStats } from "./sources/youtube.js";
import type { Components } from "./traction.js";

export interface Stats {
  deezerTrack(id: number): Promise<DeezerTrack | null>;
  deezerSearch(q: string): Promise<DeezerSearchHit[]>;
  lastfm(artist: string, track: string): Promise<LastfmStats | null>;
  youtube(videoId: string): Promise<YoutubeStats | null>;
}

export function liveStats(keys: { lastfm: string; youtube: string }, f?: Fetch): Stats {
  return {
    deezerTrack: (id) => deezerTrack(id, f),
    deezerSearch: (q) => deezerSearch(q, f),
    lastfm: (artist, track) => lastfmTrack(keys.lastfm, artist, track, f),
    youtube: (id) => youtubeVideo(keys.youtube, id, f),
  };
}

export class TransientDataError extends Error {}

/**
 * Measure a launched song at season end, using exactly the sources fixed at launch.
 * Last.fm losing a track it used to know is treated as a glitch (retry later), not a crash.
 */
export async function measure(
  stats: Stats,
  song: { lastfmArtist: string; lastfmTrack: string; youtubeId: string | null },
  base: Components,
): Promise<Components> {
  const lf = await stats.lastfm(song.lastfmArtist, song.lastfmTrack);
  if (!lf && base.lastfm > 0) {
    throw new TransientDataError(`Last.fm no longer finds "${song.lastfmArtist} - ${song.lastfmTrack}"`);
  }
  let youtube: number | null = null;
  if (song.youtubeId && base.youtube !== null) {
    const yt = await stats.youtube(song.youtubeId);
    youtube = yt ? yt.views : null; // deleted video: YouTube drops out of this song's score
  }
  return { lastfm: lf?.listeners ?? 0, youtube };
}
