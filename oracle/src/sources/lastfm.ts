/**
 * Last.fm: the primary traction signal, all-time unique listeners for a track.
 * Free API key: https://www.last.fm/api/account/create
 */
import { z } from "zod";
import { getJson, SourceError, type Fetch } from "./http.js";

const API = "https://ws.audioscrobbler.com/2.0/";
const TRACK_NOT_FOUND = 6;

const Info = z.object({
  track: z.object({
    name: z.string(),
    listeners: z.coerce.number().int().nonnegative(),
    playcount: z.coerce.number().int().nonnegative(),
    url: z.string(),
    artist: z.object({ name: z.string() }),
  }),
});
const ApiError = z.object({ error: z.number(), message: z.string() });

export type LastfmStats = { artist: string; track: string; listeners: number; playcount: number; url: string };

/** null = Last.fm has no such track (common for brand-new underground releases). */
export async function lastfmTrack(
  apiKey: string,
  artist: string,
  track: string,
  f?: Fetch,
): Promise<LastfmStats | null> {
  if (!apiKey) throw new SourceError("lastfm", "LASTFM_API_KEY is not set");
  const url =
    `${API}?method=track.getInfo&format=json&autocorrect=1` +
    `&api_key=${encodeURIComponent(apiKey)}` +
    `&artist=${encodeURIComponent(artist)}&track=${encodeURIComponent(track)}`;
  const body = await getJson("lastfm", url, { fetch: f });
  const err = ApiError.safeParse(body);
  if (err.success) {
    if (err.data.error === TRACK_NOT_FOUND) return null;
    throw new SourceError("lastfm", `API error ${err.data.error}: ${err.data.message}`);
  }
  const p = Info.safeParse(body);
  if (!p.success) throw new SourceError("lastfm", `unexpected shape: ${p.error.message}`);
  const t = p.data.track;
  return { artist: t.artist.name, track: t.name, listeners: t.listeners, playcount: t.playcount, url: t.url };
}
