/**
 * Season settlement. Idempotent: safe to run every few minutes. Each pass:
 *   1. promotes pending launches that landed on-chain (and forgets expired ones)
 *   2. applies payouts for songs of an already-finalized season
 *   3. once the season has ended: measures every song, publishes the snapshot,
 *      posts score_song with the snapshot's sha256
 *   4. finalizes the season when every song is scored
 *   5. applies payouts, which resumes trading
 */
import type { Keypair, TransactionInstruction } from "@solana/web3.js";
import type { SleeperClient, SongState } from "./chain.js";
import { canonicalJson, sha256 } from "./snapshot.js";
import { measure, type Stats } from "./stats.js";
import type { Store } from "./store.js";
import { chainFinal, chainScore, combinedGrowth, ratioToNumber, type Components } from "./traction.js";

export const PENDING_TTL_MS = 10 * 60_000;

export type SettleReport = {
  season: number;
  phase: "running" | "settling" | "settled";
  endsInSecs?: number;
  promoted: number;
  expired: number;
  scored: string[];
  failed: { songId: string; error: string }[];
  finalized: boolean;
  applied: number;
  waitingOn?: string;
};

type Deps = { client: SleeperClient; store: Store; stats: Stats; oracle: Keypair; priority?: number; log?: (m: string) => void };

async function send(deps: Deps, ixs: TransactionInstruction[]): Promise<string> {
  const tx = await deps.client.tx(deps.oracle.publicKey, ixs, { priorityMicroLamports: deps.priority });
  tx.sign(deps.oracle);
  return deps.client.io.sendAndConfirm(tx);
}

export async function settle(deps: Deps): Promise<SettleReport> {
  const { client, store } = deps;
  const log = deps.log ?? (() => {});
  const config = await client.config();
  const report: SettleReport = {
    season: config.currentSeason,
    phase: "running",
    promoted: 0,
    expired: 0,
    scored: [],
    failed: [],
    finalized: false,
    applied: 0,
  };

  // 1. pending -> live
  const pending = store.list("pending");
  if (pending.length) {
    const onChain = await client.songs(pending.map((p) => Buffer.from(p.songId, "hex")));
    const live = new Map(onChain.map((s) => [s.songId.toString("hex"), s]));
    for (const p of pending) {
      const s = live.get(p.songId);
      if (s) {
        store.markLive(p.songId, s.creator.toBase58());
        report.promoted++;
      } else if (Date.now() - p.createdAt > PENDING_TTL_MS) {
        store.deletePending(p.songId);
        report.expired++;
      }
    }
  }

  const rows = store.list("live");
  const byId = new Map(rows.map((r) => [r.songId, r]));
  const loadSongs = () => client.songs(rows.map((r) => Buffer.from(r.songId, "hex")));

  // 2 & 5. apply payouts for finalized seasons
  const applyAll = async (songs: SongState[]) => {
    const seasons = new Map<number, boolean>();
    for (const s of songs.filter((x) => x.phase === "scored")) {
      if (!seasons.has(s.seasonId)) seasons.set(s.seasonId, (await client.season(s.seasonId))?.finalized ?? false);
      if (!seasons.get(s.seasonId)) continue;
      try {
        await send(deps, [await client.applyIx(s)]);
        report.applied++;
      } catch (e) {
        report.failed.push({ songId: s.songId.toString("hex"), error: `apply: ${(e as Error).message}` });
      }
    }
  };
  await applyAll(await loadSongs());

  const cur = config.currentSeason;
  const season = await client.season(cur);
  if (!season) throw new Error(`season ${cur} account missing`);
  const now = await client.now();
  if (now < season.endTs) {
    report.endsInSecs = Number(season.endTs - now);
    return report;
  }
  report.phase = "settling";

  // 3. score
  for (const s of await loadSongs()) {
    if (s.seasonId !== cur || s.phase !== "trading") continue;
    const id = s.songId.toString("hex");
    const row = byId.get(id)!;
    try {
      let snap = store.getSnapshot(cur, id);
      if (!snap) {
        const base: Components = row.comps;
        const fin = await measure(deps.stats, row, base);
        const g = combinedGrowth(base, fin, config.scoreSmoothing);
        const finalTraction = chainFinal(s.baseline, config.scoreSmoothing, g.combined);
        const json = canonicalJson({
          v: 1,
          program: client.programId.toBase58(),
          season: cur,
          song: s.address.toBase58(),
          songId: id,
          isrc: row.isrc,
          title: row.title,
          artist: row.artist,
          sources: { lastfm: { artist: row.lastfmArtist, track: row.lastfmTrack }, youtube: row.youtubeId },
          start: base,
          end: fin,
          measuredAt: new Date().toISOString(),
          growth: {
            lastfm: ratioToNumber(g.lastfm),
            youtube: g.youtube ? ratioToNumber(g.youtube) : null,
            combined: ratioToNumber(g.combined),
          },
          chain: {
            baseline: s.baseline,
            finalTraction,
            smoothing: config.scoreSmoothing,
            score: chainScore(s.baseline, finalTraction, config.scoreSmoothing, config.maxScore),
          },
        });
        store.putSnapshot({ season: cur, songId: id, hash: sha256(json).toString("hex"), json, signature: null });
        snap = store.getSnapshot(cur, id)!;
      }
      const parsed = JSON.parse(snap.json) as { end: Components; chain: { finalTraction: string } };
      const sig = await send(deps, [
        await client.scoreIx(deps.oracle.publicKey, s, BigInt(parsed.chain.finalTraction), Buffer.from(snap.hash, "hex")),
      ]);
      store.setSnapshotSignature(cur, id, sig);
      store.setComps(id, parsed.end, cur + 1);
      report.scored.push(id);
      log(`scored ${row.title} — ${row.artist}: ${parsed.chain.finalTraction}`);
    } catch (e) {
      report.failed.push({ songId: id, error: (e as Error).message });
    }
  }

  // 4. finalize
  const after = await client.season(cur);
  const cfg = await client.config();
  if (after && !after.finalized) {
    if (after.scoredCount < after.songCount) {
      report.waitingOn = `${after.songCount - after.scoredCount} song(s) still unscored`;
      return report;
    }
    if (cfg.unapplied > 0) {
      report.waitingOn = `${cfg.unapplied} payout(s) from the previous season`;
      return report;
    }
    await send(deps, [await client.finalizeIx(deps.oracle.publicKey, cur)]);
    report.finalized = true;
    log(`season ${cur} finalized`);
  }

  // 5. apply
  await applyAll(await loadSongs());
  report.phase = "settled";
  return report;
}
