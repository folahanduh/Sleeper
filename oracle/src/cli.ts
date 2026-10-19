import { join } from "node:path";
import { Command } from "commander";
import { PublicKey } from "@solana/web3.js";
import { DEFAULT_PARAMS, RpcChain, SleeperClient } from "./chain.js";
import { loadConfig, loadKeypair } from "./config.js";
import { createOracleServer } from "./server.js";
import { settle } from "./settle.js";
import { liveStats } from "./stats.js";
import { Store } from "./store.js";
import { parseDeezerId } from "./sources/deezer.js";
import { parseYoutubeId } from "./sources/youtube.js";
import { baseTitle } from "./traction.js";

const cfg = loadConfig();
const stats = () => liveStats({ lastfm: cfg.LASTFM_API_KEY, youtube: cfg.YOUTUBE_API_KEY });
const client = () => new SleeperClient(new RpcChain(cfg.SLEEPER_RPC_URL));
const store = () => new Store(join(cfg.SLEEPER_DATA_DIR, "oracle.db"));
const sol = (l: bigint) => `${(Number(l) / 1e9).toFixed(4)} SOL`;

const program = new Command("sleeper-oracle").description("Sleeper oracle: real song data in, season scores out");

program
  .command("search")
  .description("search Deezer for a song")
  .argument("<query...>")
  .action(async (q: string[]) => {
    for (const t of await stats().deezerSearch(q.join(" "))) {
      console.log(`${String(t.deezerId).padEnd(12)} ${t.title} — ${t.artist}   (deezer rank ${t.rank})`);
    }
  });

program
  .command("measure")
  .description("measure a song's real traction right now, without launching anything")
  .argument("<deezer>", "Deezer track link or id")
  .option("--youtube <video>", "official YouTube video link or id")
  .action(async (deezer: string, opts: { youtube?: string }) => {
    const s = stats();
    const id = parseDeezerId(deezer);
    const t = id ? await s.deezerTrack(id) : null;
    if (!t) throw new Error("Deezer has no playable track with that id");
    console.log(`${t.title} — ${t.artist}`);
    console.log(`  ISRC ${t.isrc}  released ${t.releaseDate ?? "?"}  deezer rank ${t.rank}`);
    if (cfg.LASTFM_API_KEY) {
      const lf = (await s.lastfm(t.artist, t.title)) ?? (await s.lastfm(t.artist, baseTitle(t.title)));
      console.log(lf ? `  Last.fm  ${lf.listeners.toLocaleString()} listeners, ${lf.playcount.toLocaleString()} plays` : "  Last.fm  not found (0 listeners)");
    } else console.log("  Last.fm  (set LASTFM_API_KEY)");
    if (opts.youtube) {
      const vid = parseYoutubeId(opts.youtube);
      if (!cfg.YOUTUBE_API_KEY) console.log("  YouTube  (set YOUTUBE_API_KEY)");
      else if (vid) {
        const v = await s.youtube(vid);
        console.log(v ? `  YouTube  ${v.views.toLocaleString()} views — "${v.title}" by ${v.channel}` : "  YouTube  video not found");
      }
    }
  });

program
  .command("status")
  .description("show on-chain config and the current season")
  .action(async () => {
    const c = client();
    const config = await c.config();
    const season = await c.season(config.currentSeason);
    const now = await c.now();
    console.log(`program   ${c.programId.toBase58()}  (${cfg.SLEEPER_RPC_URL})`);
    console.log(`oracle    ${config.oracle.toBase58()}`);
    console.log(`treasury  ${config.treasury.toBase58()}`);
    console.log(`fees      ${config.feeProtocolBps}/${config.feeCreatorBps}/${config.feePotBps} bps  stake ${config.stakeBps} bps  paused ${config.paused}`);
    if (season) {
      const left = Number(season.endTs - now);
      console.log(
        `season ${season.id}  songs ${season.songCount}  scored ${season.scoredCount}  pot ${sol(season.pot)}  ` +
          (left > 0 ? `ends in ${(left / 86400).toFixed(2)} days` : `ENDED ${(-left / 3600).toFixed(1)}h ago`),
      );
    }
    const st = store();
    console.log(`registry  ${st.list("live").length} live, ${st.list("pending").length} pending`);
    st.close();
  });

program
  .command("settle")
  .description("run one settlement pass (safe to repeat)")
  .action(async () => {
    const st = store();
    const report = await settle({
      client: client(),
      store: st,
      stats: stats(),
      oracle: loadKeypair(cfg.SLEEPER_ORACLE_KEYPAIR),
      priority: cfg.SLEEPER_PRIORITY_MICROLAMPORTS,
      log: console.log,
    });
    console.log(JSON.stringify(report, null, 2));
    st.close();
  });

program
  .command("serve")
  .description("run the HTTP API and settle every few minutes")
  .action(async () => {
    const oracle = loadKeypair(cfg.SLEEPER_ORACLE_KEYPAIR);
    const c = client();
    const st = store();
    const s = stats();
    if (!cfg.LASTFM_API_KEY) console.warn("[oracle] LASTFM_API_KEY not set: launches will fail");
    const server = createOracleServer({
      client: c,
      stats: s,
      store: st,
      oracle,
      publicUrl: cfg.SLEEPER_PUBLIC_URL,
      webOrigin: cfg.SLEEPER_WEB_ORIGIN,
      priority: cfg.SLEEPER_PRIORITY_MICROLAMPORTS,
    });
    server.listen(cfg.SLEEPER_PORT, "127.0.0.1", () =>
      console.log(`[oracle] ${oracle.publicKey.toBase58()} listening on 127.0.0.1:${cfg.SLEEPER_PORT}`),
    );
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        const r = await settle({ client: c, store: st, stats: s, oracle, priority: cfg.SLEEPER_PRIORITY_MICROLAMPORTS, log: console.log });
        if (r.phase !== "running" || r.failed.length || r.promoted || r.expired) console.log("[settle]", JSON.stringify(r));
      } catch (e) {
        console.error("[settle] error", (e as Error).message);
      } finally {
        running = false;
      }
    };
    void tick();
    setInterval(tick, cfg.SLEEPER_SETTLE_EVERY_MIN * 60_000);
  });

program
  .command("init")
  .description("initialize the program config (admin, one time). Prints the plan; --send to submit")
  .requiredOption("--admin <keypair>", "admin keypair file (pays rent)")
  .requiredOption("--treasury <pubkey>", "fee treasury (must already hold some SOL)")
  .option("--send", "actually submit the transaction")
  .action(async (opts: { admin: string; treasury: string; send?: boolean }) => {
    const admin = loadKeypair(opts.admin);
    const oracle = loadKeypair(cfg.SLEEPER_ORACLE_KEYPAIR);
    const c = client();
    const params = DEFAULT_PARAMS(oracle.publicKey, new PublicKey(opts.treasury));
    console.log(`cluster   ${cfg.SLEEPER_RPC_URL}`);
    console.log(`program   ${c.programId.toBase58()}`);
    console.log(`admin     ${admin.publicKey.toBase58()}`);
    console.log(`oracle    ${oracle.publicKey.toBase58()}`);
    console.log(`treasury  ${params.treasury.toBase58()}`);
    if (!opts.send) return console.log("dry run: add --send to submit");
    const tx = await c.tx(admin.publicKey, [await c.initializeIx(admin.publicKey, params)], {
      priorityMicroLamports: cfg.SLEEPER_PRIORITY_MICROLAMPORTS,
    });
    tx.sign(admin);
    console.log(`initialized: ${await c.io.sendAndConfirm(tx)}`);
  });

program.parseAsync().catch((e: unknown) => {
  console.error((e as Error).message);
  process.exit(1);
});
