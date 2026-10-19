/**
 * YouTube: optional second signal (view count of the song's official upload).
 * Uses videos.list only (1 quota unit); we never call search (100 units).
 */
import { z } from "zod";
import { getJson, SourceError, type Fetch } from "./http.js";

const API = "https://www.googleapis.com/youtube/v3/videos";

const Resp = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      snippet: z.object({ title: z.string(), channelTitle: z.string() }),
      statistics: z.object({ viewCount: z.coerce.number().int().nonnegative() }),
    }),
  ),
});

export type YoutubeStats = { videoId: string; title: string; channel: string; views: number };

export function parseYoutubeId(input: string): string | null {
  const s = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  const m = s.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m?.[1] ?? null;
}

/** null = video gone (deleted/private). */
export async function youtubeVideo(apiKey: string, videoId: string, f?: Fetch): Promise<YoutubeStats | null> {
  if (!apiKey) throw new SourceError("youtube", "YOUTUBE_API_KEY is not set");
  const url = `${API}?part=snippet,statistics&id=${encodeURIComponent(videoId)}&key=${encodeURIComponent(apiKey)}`;
  const body = await getJson("youtube", url, { fetch: f });
  const p = Resp.safeParse(body);
  if (!p.success) throw new SourceError("youtube", `unexpected shape or API error`);
  const v = p.data.items[0];
  if (!v) return null;
  return { videoId: v.id, title: v.snippet.title, channel: v.snippet.channelTitle, views: v.statistics.viewCount };
}
