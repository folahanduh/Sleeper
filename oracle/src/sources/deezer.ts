/**
 * Deezer: identity (ISRC, canonical title/artist, cover art). Free, no key.
 * A song must be on Deezer to launch: that's our proof it is a real release.
 */
import { z } from "zod";
import { getJson, SourceError, type Fetch } from "./http.js";

const API = "https://api.deezer.com";

const Artist = z.object({ id: z.number(), name: z.string() });
const Album = z.object({ id: z.number(), title: z.string(), cover_xl: z.string().nullish() });
const SearchItem = z.object({
  id: z.number(),
  title: z.string(),
  rank: z.number(),
  artist: Artist,
  album: Album,
});
const Track = SearchItem.extend({
  isrc: z.string().min(1),
  readable: z.boolean(),
  link: z.string(),
  release_date: z.string().nullish(),
});
const ApiError = z.object({ error: z.object({ code: z.number(), message: z.string() }) });

export type DeezerTrack = {
  deezerId: number;
  isrc: string;
  title: string;
  artist: string;
  cover: string | null;
  link: string;
  rank: number;
  releaseDate: string | null;
};

export type DeezerSearchHit = Pick<DeezerTrack, "deezerId" | "title" | "artist" | "cover" | "rank">;

export async function deezerTrack(id: number, f?: Fetch): Promise<DeezerTrack | null> {
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const body = await getJson("deezer", `${API}/track/${id}`, { fetch: f });
  if (ApiError.safeParse(body).success) return null; // "no data"
  const t = Track.safeParse(body);
  if (!t.success) throw new SourceError("deezer", `unexpected track shape: ${t.error.message}`);
  if (!t.data.readable) return null; // not actually available
  return {
    deezerId: t.data.id,
    isrc: t.data.isrc.toUpperCase(),
    title: t.data.title,
    artist: t.data.artist.name,
    cover: t.data.album.cover_xl ?? null,
    link: t.data.link,
    rank: t.data.rank,
    releaseDate: t.data.release_date ?? null,
  };
}

export async function deezerSearch(q: string, f?: Fetch): Promise<DeezerSearchHit[]> {
  const query = q.trim().slice(0, 120);
  if (!query) return [];
  const body = await getJson("deezer", `${API}/search?q=${encodeURIComponent(query)}&limit=10`, { fetch: f });
  const parsed = z.object({ data: z.array(SearchItem) }).safeParse(body);
  if (!parsed.success) throw new SourceError("deezer", "unexpected search shape");
  return parsed.data.data.map((t) => ({
    deezerId: t.id,
    title: t.title,
    artist: t.artist.name,
    cover: t.album.cover_xl ?? null,
    rank: t.rank,
  }));
}

/** Accepts a numeric id or a deezer.com/track/<id> link. */
export function parseDeezerId(input: string | number): number | null {
  if (typeof input === "number") return Number.isSafeInteger(input) && input > 0 ? input : null;
  const m = input.trim().match(/^(?:https?:\/\/(?:www\.)?deezer\.com\/(?:[a-z]{2}\/)?track\/)?(\d{1,15})(?:[/?#].*)?$/);
  return m ? Number(m[1]) : null;
}
