/**
 * The whole oracle against the real compiled program in LiteSVM:
 * HTTP prepare -> creator signs -> trade -> season ends -> settle -> payouts.
 * Stats are a scripted stand-in for Last.fm/YouTube/Deezer (the parsers are tested
 * separately against captured responses).
 */
import type { AddressInfo } from "node:net";
import { Keypair, Transaction } from "@solana/web3.js";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { DEFAULT_PARAMS, SleeperClient } from "../src/chain.js";
import { createOracleServer } from "../src/server.js";
import { settle, PENDING_TTL_MS } from "../src/settle.js";
import { sha256 } from "../src/snapshot.js";
import type { Stats } from "../src/stats.js";
import { Store } from "../src/store.js";
import type { DeezerTrack } from "../src/sources/deezer.js";
import { SOL, SvmChain } from "./svm.js";

type Fake = { track: DeezerTrack; listeners: number | null; views?: number; videoTitle?: string };

function fakeStats(songs: Map<number, Fake>): Stats {
  const byName = (artist: string, title: string) =>
    [...songs.values()].find((s) => s.track.artist === artist && s.track.title === title);
  return {
    deezerTrack: async (id) => songs.get(id)?.track ?? null,
    deezerSearch: async () => [...songs.values()].map((s) => ({ ...s.track })),
    lastfm: async (artist, title) => {
      const s = byName(artist, title);
      return s && s.listeners !== null
        ? { artist, track: title, listeners: s.listeners, playcount: s.listeners * 10, url: "x" }
        : null;
    },
    youtube: async (id) => {
      const s = [...songs.values()].find((x) => x.views !== undefined && id === `vid${x.track.deezerId}`.padEnd(11, "x"));
      return s ? { videoId: id, title: s.videoTitle ?? s.track.title, channel: `${s.track.artist}VEVO`, views: s.views! } : null;
    },
  };
}

const track = (id: number, title: string, artist: string, rank = 5_000): DeezerTrack => ({
  deezerId: id,
  isrc: `QZTEST${String(id).padStart(6, "0")}`,
  title,
  artist,
  cover: `https://cdn.example/${id}.jpg`,
  link: `https://www.deezer.com/track/${id}`,
  rank,
  releaseDate: "2026-10-01",
});

describe("oracle end to end", () => {
  let chain: SvmChain;
  let client: SleeperClient;
  let store: Store;
  let songs: Map<number, Fake>;
  let oracle: Keypair;
  let admin: Keypair;
  let treasury: Keypair;
  let base: string;
  let close: () => void;

  beforeEach(async () => {
    chain = new SvmChain();
    client = new SleeperClient(chain);
    store = new Store(":memory:");
    oracle = Keypair.generate();
    admin = Keypair.generate();
    treasury = Keypair.generate();
    for (const k of [oracle, admin, treasury]) chain.airdrop(k.publicKey, 10n * SOL);
    const init = await client.tx(admin.publicKey, [
      await client.initializeIx(admin.publicKey, DEFAULT_PARAMS(oracle.publicKey, treasury.publicKey)),
    ]);
    init.sign(admin);
    await chain.sendAndConfirm(init);

    songs = new Map([
      [101, { track: track(101, "Basement Tape", "Nobody Yet"), listeners: 800 }],
      [202, { track: track(202, "Stadium Anthem", "Megastar", 950_000), listeners: 9_000_000, views: 400_000_000 }],
      [303, { track: track(303, "Big Song (feat. Someone)", "Popular", 900_000), listeners: null }],
    ]);
    const server = createOracleServer({
      client,
      stats: fakeStats(songs),
      store,
      oracle,
      publicUrl: "https://sleeper.test",
      webOrigin: "https://sleeper.test",
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => server.close();
  });
  afterEach(() => close());

  const post = (path: string, body: unknown) =>
    fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  async function launch(creator: Keypair, deezer: number | string, extra: Record<string, string> = {}) {
    const res = await post("/api/launch/prepare", { deezer, creator: creator.publicKey.toBase58(), ...extra });
    const body = (await res.json()) as Record<string, string>;
    if (res.status !== 200) return { status: res.status, body };
    const tx = Transaction.from(Buffer.from(body.transaction!, "base64"));
    tx.partialSign(creator);
    await chain.sendAndConfirm(tx);
    return { status: 200, body };
  }

  async function song(songId: string) {
    const [s] = await client.songs([Buffer.from(songId, "hex")]);
    return s!;
  }

  async function buy(who: Keypair, songId: string, sol: bigint) {
    const s = await song(songId);
    const tx = await client.tx(who.publicKey, [await client.buyIx(who.publicKey, s, treasury.publicKey, sol, 1n)]);
    tx.sign(who);
    await chain.sendAndConfirm(tx);
  }

  const price = (s: { virtualSol: bigint; virtualToken: bigint }) => Number((s.virtualSol * 10n ** 12n) / s.virtualToken);
  const run = () => settle({ client, store, stats: fakeStats(songs), oracle });

  test("launch, trade, settle a season, pay out", async () => {
    const creator = Keypair.generate();
    const fan = Keypair.generate();
    const stan = Keypair.generate();
    for (const k of [creator, fan, stan]) chain.airdrop(k.publicKey, 200n * SOL);

    const a = await launch(creator, "https://www.deezer.com/track/101");
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ name: "Basement Tape — Nobody Yet", symbol: "BT", baseline: "800" });
    const b = await launch(creator, 202, { symbol: "$anthem", youtube: "https://youtu.be/vid202xxxxx" });
    expect(b.status).toBe(200);
    expect(b.body.symbol).toBe("ANTHEM");

    // Metadata the wallet will fetch; promoted to live by confirm.
    const meta = await (await fetch(`${base}/meta/${a.body.songId}.json`)).json();
    expect(meta).toMatchObject({ name: "Basement Tape — Nobody Yet", image: "https://cdn.example/101.jpg" });
    expect((await (await post("/api/launch/confirm", { songId: a.body.songId })).json())).toMatchObject({ live: true });

    // One coin per song, popular-but-unmeasurable refused, wrong video refused.
    expect((await launch(fan, 101)).status).toBe(409);
    expect((await launch(fan, 303)).status).toBe(422);
    songs.set(404, { track: track(404, "Quiet Song", "Someone"), listeners: 50, views: 10, videoTitle: "Totally Different" });
    const wrongVideo = await post("/api/launch/prepare", {
      deezer: 404,
      creator: fan.publicKey.toBase58(),
      youtube: "vid404xxxxx",
    });
    expect(wrongVideo.status).toBe(422);
    expect(((await wrongVideo.json()) as { error: string }).error).toMatch(/doesn't look like this song/);
    songs.delete(404);
    expect((await post("/api/launch/prepare", { deezer: 999, creator: fan.publicKey.toBase58() })).status).toBe(404);

    await buy(fan, a.body.songId!, 3n * SOL);
    await buy(stan, b.body.songId!, 100n * SOL);
    const pa = price(await song(a.body.songId!));
    const pb = price(await song(b.body.songId!));

    // Mid-season: settle only promotes pending songs.
    let r = await run();
    expect(r.phase).toBe("running");
    expect(r.promoted).toBe(1);
    expect(store.list("live")).toHaveLength(2);

    // Season ends. The underground song goes 800 -> 60k listeners; the megastar barely moves,
    // and its YouTube views (if botted) can't save it because growth is the min of sources.
    const season = (await client.season(0))!;
    chain.warpTo(season.endTs + 60n);
    songs.get(101)!.listeners = 60_000;
    songs.get(202)!.listeners = 9_050_000;
    songs.get(202)!.views = 900_000_000;

    r = await run();
    expect(r.failed).toEqual([]);
    expect(r.scored).toHaveLength(2);
    expect(r.finalized).toBe(true);
    expect(r.applied).toBe(2);
    expect(r.phase).toBe("settled");

    const sa = await song(a.body.songId!);
    const sb = await song(b.body.songId!);
    expect(sa.seasonId).toBe(1);
    expect(sa.phase).toBe("trading");
    expect(price(sa) / pa).toBeGreaterThan(3);
    expect(price(sb) / pb).toBeLessThan(0.75);
    console.log(`underground x${(price(sa) / pa).toFixed(2)}, megastar x${(price(sb) / pb).toFixed(2)}`);

    // Published snapshot hashes to what was posted, and next season measures from it.
    const snapRes = await fetch(`${base}/snapshots/0/${a.body.songId}.json`);
    const raw = await snapRes.text();
    expect(sha256(raw).toString("hex")).toBe(store.getSnapshot(0, a.body.songId!)!.hash);
    const snap = JSON.parse(raw);
    expect(snap.end).toEqual({ lastfm: 60_000, youtube: null });
    expect(snap.chain.finalTraction).toBe(sa.baseline.toString());
    expect(store.get(b.body.songId!)!.comps).toEqual({ lastfm: 9_050_000, youtube: 900_000_000 });

    // Idempotent: another pass does nothing.
    r = await run();
    expect(r).toMatchObject({ scored: [], applied: 0, finalized: false, phase: "running" });

    // Trading is open again in season 1.
    await buy(fan, a.body.songId!, SOL);
  });

  test("tampering with the oracle-signed launch is rejected", async () => {
    const creator = Keypair.generate();
    chain.airdrop(creator.publicKey, 10n * SOL);
    const res = await post("/api/launch/prepare", { deezer: 101, creator: creator.publicKey.toBase58() });
    const body = (await res.json()) as { transaction: string };
    const tx = Transaction.from(Buffer.from(body.transaction, "base64"));
    // Try to raise the baseline (to dodge a future crash): the oracle's signature no longer matches.
    const ix = tx.instructions[tx.instructions.length - 1]!;
    ix.data[8 + 32] = (ix.data[8 + 32]! + 1) % 256;
    const forged = new Transaction({ feePayer: tx.feePayer!, blockhash: tx.recentBlockhash!, lastValidBlockHeight: 1e6 });
    forged.add(...tx.instructions);
    forged.addSignature(oracle.publicKey, tx.signatures.find((s) => s.publicKey.equals(oracle.publicKey))!.signature!);
    forged.partialSign(creator);
    await expect(chain.sendAndConfirm(forged)).rejects.toThrow();
  });

  test("abandoned launches expire from the registry", async () => {
    const creator = Keypair.generate();
    chain.airdrop(creator.publicKey, 10n * SOL);
    await post("/api/launch/prepare", { deezer: 101, creator: creator.publicKey.toBase58() });
    expect(store.list("pending")).toHaveLength(1);
    const row = store.list("pending")[0]!;
    store.db.prepare("UPDATE songs SET created_at=? WHERE song_id=?").run(Date.now() - PENDING_TTL_MS - 1, row.songId);
    const r = await run();
    expect(r.expired).toBe(1);
    expect(store.list()).toHaveLength(0);
  });

  test("api rejects bad input without leaking internals", async () => {
    const bad = await post("/api/launch/prepare", { deezer: 101, creator: "not-a-key" });
    expect(bad.status).toBe(422);
    const notJson = await fetch(base + "/api/launch/prepare", { method: "POST", body: "x" });
    expect(notJson.status).toBe(415);
    const huge = await post("/api/launch/prepare", { deezer: "1".repeat(5000), creator: "x" });
    expect(huge.status).toBe(413);
    expect((await fetch(`${base}/meta/${"0".repeat(64)}.json`)).status).toBe(404);
    expect((await fetch(`${base}/meta/../../etc/passwd`)).status).toBe(404);
    for (let i = 0; i < 7; i++) await post("/api/launch/prepare", { deezer: 101, creator: "x" });
    expect((await post("/api/launch/prepare", { deezer: 101, creator: "x" })).status).toBe(429);
    const health = await (await fetch(`${base}/api/health`)).json();
    expect(health).toMatchObject({ ok: true, oracleMatchesChain: true, season: 0 });
  });
});
