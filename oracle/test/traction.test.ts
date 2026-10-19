import { expect, test } from "vitest";
import { clampUtf8 } from "../src/chain.js";
import { cleanSymbol, defaultSymbol } from "../src/launch.js";
import { canonicalJson, songIdFromIsrc } from "../src/snapshot.js";
import { baseTitle, chainFinal, chainScore, combinedGrowth, normalizeTitle, ratioToNumber } from "../src/traction.js";

const K = 1_000n;
const MAX = 100_000_000n;

test("growth is the minimum across sources, so botting one platform doesn't help", () => {
  const g = combinedGrowth({ lastfm: 1_000, youtube: 10_000 }, { lastfm: 3_000, youtube: 5_000_000 }, K);
  expect(ratioToNumber(g.lastfm)).toBeCloseTo(1.0, 5); // +2000 / (1000+1000)
  expect(ratioToNumber(g.youtube!)).toBeGreaterThan(100);
  expect(g.combined).toEqual(g.lastfm);
});

test("a source missing at either end drops out", () => {
  const g = combinedGrowth({ lastfm: 1_000, youtube: 10_000 }, { lastfm: 21_000, youtube: null }, K);
  expect(g.youtube).toBeNull();
  expect(ratioToNumber(g.combined)).toBeCloseTo(10, 5);
});

test("posted final makes the on-chain score equal the combined growth", () => {
  for (const [b, base, fin] of [
    [1_000n, 1_000, 101_000],
    [5_000_000n, 5_000_000, 5_250_000],
    [0n, 0, 777],
    [123_456n, 2_000, 2_500],
  ] as const) {
    const g = combinedGrowth({ lastfm: base, youtube: null }, { lastfm: fin, youtube: null }, K);
    const posted = chainFinal(b, K, g.combined);
    const onChain = chainScore(b, posted, K, MAX);
    const expected = BigInt(Math.floor(ratioToNumber(g.combined) * 1e6));
    // final_traction is an integer, so the score can be off by < 1e6/(baseline+K) units.
    const tol = 1_000_000n / (b + K) + 2n;
    const diff = onChain > expected ? onChain - expected : expected - onChain;
    expect(diff <= tol, `b=${b}: ${onChain} vs ${expected}`).toBe(true);
  }
  // no growth posts the baseline back
  const flat = combinedGrowth({ lastfm: 10, youtube: null }, { lastfm: 10, youtube: null }, K);
  expect(chainFinal(99n, K, flat.combined)).toBe(99n);
});

test("titles normalise for matching", () => {
  expect(normalizeTitle("Not Like Us (feat. Nobody) [Explicit]")).toBe("not like us explicit");
  expect(normalizeTitle("Beyoncé – CUFF IT")).toBe("beyonce cuff it");
  expect(baseTitle("Song (feat. X)")).toBe("Song");
  expect(baseTitle("Song - Remastered 2011")).toBe("Song");
});

test("symbols", () => {
  expect(defaultSymbol("Not Like Us")).toBe("NOTLIKEUS");
  expect(defaultSymbol("Somebody That I Used To Know")).toBe("STIUTK");
  expect(defaultSymbol("7")).toBe("7SONG");
  expect(cleanSymbol("$drake")).toBe("DRAKE");
  expect(cleanSymbol("a")).toBeNull();
  expect(cleanSymbol("RUG<script>")).toBeNull();
});

test("names are cut to 64 bytes on a character boundary", () => {
  const long = "é".repeat(40) + " — Artist";
  const out = clampUtf8(long, 64);
  expect(new TextEncoder().encode(out).length).toBeLessThanOrEqual(64);
  expect(out.endsWith("…")).toBe(true);
  expect(clampUtf8("short", 64)).toBe("short");
});

test("song id is per ISRC and case-insensitive; snapshot JSON is canonical", () => {
  expect(songIdFromIsrc("usug12400910")).toEqual(songIdFromIsrc("USUG12400910 "));
  expect(canonicalJson({ b: 1n, a: [{ d: 2, c: 3 }] })).toBe('{"a":[{"c":3,"d":2}],"b":"1"}');
});
