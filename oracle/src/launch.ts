/**
 * Launch preparation: prove the song is a real release, measure its baseline, and
 * return a launch transaction co-signed by the oracle for the creator to sign.
 * The name comes from Deezer, never from the user, so coins can't carry scam text.
 */
import { Keypair, PublicKey } from "@solana/web3.js";
import { clampUtf8, type SleeperClient } from "./chain.js";
import { parseDeezerId } from "./sources/deezer.js";
import { parseYoutubeId } from "./sources/youtube.js";
import { songIdFromIsrc } from "./snapshot.js";
import type { Stats } from "./stats.js";
import type { SongRow, Store } from "./store.js";
import { baseTitle, normalizeTitle, type Components } from "./traction.js";

/** Deezer rank above this with zero Last.fm listeners means our lookup is wrong, not that the song is new. */
export const MAX_RANK_WITHOUT_LASTFM = 100_000;
export const LAUNCH_COMPUTE_UNITS = 300_000;

export class LaunchError extends Error {
  constructor(
    readonly code: "bad_input" | "not_found" | "exists" | "unmeasurable" | "closed",
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export type PrepareInput = { deezer: string | number; creator: string; symbol?: string; youtube?: string };

export type Prepared = {
  transaction: string; // base64, oracle-signed, creator still to sign
  lastValidBlockHeight: number;
  songId: string;
  song: string;
  mint: string;
  name: string;
  symbol: string;
  uri: string;
  baseline: string;
  sources: { deezer: string; lastfm: { artist: string; track: string; listeners: number } | null; youtube: string | null };
};

export function defaultSymbol(title: string): string {
  const words = normalizeTitle(baseTitle(title)).toUpperCase().split(" ").filter(Boolean);
  const joined = words.join("");
  const sym = joined.length <= 10 ? joined : words.map((w) => w[0]).join("").slice(0, 10);
  return sym.length >= 2 ? sym : `${sym}SONG`.slice(0, 10);
}

export function cleanSymbol(s: string): string | null {
  const v = s.trim().replace(/^\$/, "").toUpperCase();
  return /^[A-Z0-9]{2,10}$/.test(v) ? v : null;
}

export async function prepareLaunch(
  deps: { client: SleeperClient; stats: Stats; store: Store; oracle: Keypair; publicUrl: string; priority?: number },
  input: PrepareInput,
): Promise<Prepared> {
  const { client, stats, store, oracle } = deps;
  let creator: PublicKey;
  try {
    creator = new PublicKey(input.creator);
  } catch {
    throw new LaunchError("bad_input", "creator is not a valid Solana address");
  }
  const deezerId = parseDeezerId(input.deezer);
  if (!deezerId) throw new LaunchError("bad_input", "give a Deezer track link or id");

  const track = await stats.deezerTrack(deezerId);
  if (!track) throw new LaunchError("not_found", "Deezer has no playable track with that id");
  const songId = songIdFromIsrc(track.isrc);
  const songKey = client.songPda(songId);
  const mint = client.mintPda(songKey);

  const [existing] = await client.songs([songId]);
  if (existing) {
    throw new LaunchError("exists", "this song already has a coin", { song: songKey.toBase58(), mint: mint.toBase58() });
  }

  const config = await client.config();
  if (config.paused) throw new LaunchError("closed", "launches are paused");
  const season = await client.season(config.currentSeason);
  const now = await client.now();
  if (!season || now >= season.endTs - 60n) {
    throw new LaunchError("closed", "the season is settling; launches reopen shortly");
  }

  // Last.fm: try the exact title, then without "(feat. ...)" / "- Remastered".
  let lf = await stats.lastfm(track.artist, track.title);
  const plain = baseTitle(track.title);
  if (!lf && plain !== track.title) lf = await stats.lastfm(track.artist, plain);
  if (!lf && track.rank > MAX_RANK_WITHOUT_LASTFM) {
    throw new LaunchError(
      "unmeasurable",
      "this song is popular on Deezer but Last.fm can't find it, so its traction can't be measured fairly",
    );
  }

  let youtubeId: string | null = null;
  let youtubeViews: number | null = null;
  if (input.youtube) {
    youtubeId = parseYoutubeId(input.youtube);
    if (!youtubeId) throw new LaunchError("bad_input", "not a YouTube video link");
    const v = await stats.youtube(youtubeId);
    if (!v) throw new LaunchError("not_found", "that YouTube video doesn't exist or is private");
    const want = normalizeTitle(baseTitle(track.title));
    const artist = normalizeTitle(track.artist).replace(/ /g, "");
    const hay = normalizeTitle(v.title);
    const who = normalizeTitle(`${v.channel} ${v.title}`).replace(/ /g, "");
    if (!hay.includes(want) || !who.includes(artist)) {
      throw new LaunchError("bad_input", `that video ("${v.title}" by ${v.channel}) doesn't look like this song`);
    }
    youtubeViews = v.views;
  }

  const symbol = input.symbol ? cleanSymbol(input.symbol) : defaultSymbol(track.title);
  if (!symbol) throw new LaunchError("bad_input", "symbol must be 2-10 letters or digits");
  const name = clampUtf8(`${track.title} — ${track.artist}`, 64);
  const songIdHex = songId.toString("hex");
  const uri = `${deps.publicUrl.replace(/\/$/, "")}/meta/${songIdHex}.json`;
  const comps: Components = { lastfm: lf?.listeners ?? 0, youtube: youtubeViews };
  const baseline = BigInt(comps.lastfm);

  const ix = await client.launchIx({
    creator,
    oracle: oracle.publicKey,
    currentSeason: config.currentSeason,
    songId,
    baseline,
    name,
    symbol,
    uri,
  });
  const tx = await client.tx(creator, [ix], {
    computeUnits: LAUNCH_COMPUTE_UNITS,
    priorityMicroLamports: deps.priority,
  });
  tx.partialSign(oracle);

  const row: SongRow = {
    songId: songIdHex,
    isrc: track.isrc,
    deezerId: track.deezerId,
    title: track.title,
    artist: track.artist,
    cover: track.cover,
    deezerLink: track.link,
    lastfmArtist: lf?.artist ?? track.artist,
    lastfmTrack: lf?.track ?? plain,
    youtubeId,
    symbol,
    name,
    creator: creator.toBase58(),
    status: "pending",
    comps,
    compsSeason: config.currentSeason,
    createdAt: Date.now(),
  };
  store.putPending(row);

  return {
    transaction: tx.serialize({ requireAllSignatures: false }).toString("base64"),
    lastValidBlockHeight: tx.lastValidBlockHeight!,
    songId: songIdHex,
    song: songKey.toBase58(),
    mint: mint.toBase58(),
    name,
    symbol,
    uri,
    baseline: baseline.toString(),
    sources: {
      deezer: track.link,
      lastfm: lf ? { artist: lf.artist, track: lf.track, listeners: lf.listeners } : null,
      youtube: youtubeId,
    },
  };
}

/** Token metadata JSON served at the coin's uri. */
export function metadataJson(row: SongRow, publicUrl: string) {
  return {
    name: row.name,
    symbol: row.symbol,
    description:
      `Sleeper song coin for "${row.title}" by ${row.artist}. Its price is settled each season on the ` +
      `song's public traction (Last.fm, YouTube). A speculative prediction, not royalties. ` +
      `Not affiliated with or endorsed by the artist, their label, or any streaming service.`,
    image: row.cover,
    external_url: `${publicUrl.replace(/\/$/, "")}/song/${row.songId}`,
    attributes: [
      { trait_type: "ISRC", value: row.isrc },
      { trait_type: "Artist", value: row.artist },
      { trait_type: "Deezer", value: row.deezerLink },
    ],
  };
}
