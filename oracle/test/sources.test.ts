import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { deezerSearch, deezerTrack, parseDeezerId } from "../src/sources/deezer.js";
import { SourceError } from "../src/sources/http.js";
import { lastfmTrack } from "../src/sources/lastfm.js";
import { parseYoutubeId, youtubeVideo } from "../src/sources/youtube.js";

const fixture = (n: string) => readFileSync(resolve(import.meta.dirname, "fixtures", n), "utf8");
const fakeFetch = (body: string, status = 200) =>
  (async () => new Response(body, { status, headers: { "content-type": "application/json" } })) as typeof fetch;

describe("deezer", () => {
  test("parses a real track response", async () => {
    const t = await deezerTrack(2783963122, fakeFetch(fixture("deezer-track.json")));
    expect(t).toMatchObject({ deezerId: 2783963122, isrc: "USUG12400910", title: "Not Like Us", artist: "Kendrick Lamar" });
    expect(t!.cover).toMatch(/^https:\/\//);
  });
  test("'no data' means not found", async () => {
    const body = '{"error":{"type":"DataException","message":"no data","code":800}}';
    expect(await deezerTrack(1, fakeFetch(body))).toBeNull();
  });
  test("parses a real search response", async () => {
    const hits = await deezerSearch("kendrick not like us", fakeFetch(fixture("deezer-search.json")));
    expect(hits[0]).toMatchObject({ title: "Not Like Us", artist: "Kendrick Lamar" });
  });
  test("accepts links and ids, rejects junk", () => {
    expect(parseDeezerId("https://www.deezer.com/en/track/2783963122?utm=x")).toBe(2783963122);
    expect(parseDeezerId("https://deezer.com/track/42")).toBe(42);
    expect(parseDeezerId("2783963122")).toBe(2783963122);
    expect(parseDeezerId("https://evil.com/track/1")).toBeNull();
    expect(parseDeezerId("1; drop table")).toBeNull();
  });
});

describe("lastfm", () => {
  test("parses listeners as numbers", async () => {
    const t = await lastfmTrack("k", "Kendrick Lamar", "Not Like Us", fakeFetch(fixture("lastfm-track.json")));
    expect(t).toMatchObject({ listeners: 2104455, playcount: 41837201, track: "Not Like Us" });
  });
  test("track not found is null, other API errors throw", async () => {
    expect(await lastfmTrack("k", "a", "b", fakeFetch('{"error":6,"message":"Track not found"}'))).toBeNull();
    await expect(lastfmTrack("k", "a", "b", fakeFetch('{"error":10,"message":"Invalid API key"}'))).rejects.toThrow(SourceError);
    await expect(lastfmTrack("", "a", "b")).rejects.toThrow(/LASTFM_API_KEY/);
  });
});

describe("youtube", () => {
  test("parses views and spots deleted videos", async () => {
    const v = await youtubeVideo("k", "H58vbez_m4E", fakeFetch(fixture("youtube-video.json")));
    expect(v).toMatchObject({ views: 511881302, channel: "KendrickLamarVEVO" });
    expect(await youtubeVideo("k", "T6eK-2OQtew", fakeFetch('{"items":[]}'))).toBeNull();
  });
  test("extracts ids from the usual link shapes", () => {
    expect(parseYoutubeId("https://www.youtube.com/watch?v=T6eK-2OQtew&t=3")).toBe("T6eK-2OQtew");
    expect(parseYoutubeId("https://youtu.be/T6eK-2OQtew")).toBe("T6eK-2OQtew");
    expect(parseYoutubeId("https://youtube.com/shorts/T6eK-2OQtew")).toBe("T6eK-2OQtew");
    expect(parseYoutubeId("not a link")).toBeNull();
  });
});

test("retries 5xx then gives up", async () => {
  let calls = 0;
  const f = (async () => {
    calls++;
    return new Response("oops", { status: 503 });
  }) as typeof fetch;
  await expect(deezerTrack(5, f)).rejects.toThrow(/503/);
  expect(calls).toBe(3);
});
