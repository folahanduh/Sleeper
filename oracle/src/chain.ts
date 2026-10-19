/**
 * Thin client for the Sleeper program. All chain access goes through `ChainIO`, so the
 * same code runs against a real RPC (RpcChain) or LiteSVM in tests.
 */
import { BN, BorshAccountsCoder, Program, type Idl } from "@anchor-lang/core";
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  SYSVAR_CLOCK_PUBKEY,
  SystemProgram,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import idlJson from "./idl/sleeper.json" with { type: "json" };
import type { Sleeper } from "./idl/sleeper.js";

export const IDL = idlJson as Idl;
export const PROGRAM_ID = new PublicKey(idlJson.address);

export interface ChainIO {
  /** Raw account data, null when the account doesn't exist. */
  getAccountsData(keys: PublicKey[]): Promise<(Buffer | null)[]>;
  latestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }>;
  /** Send a fully signed transaction and wait for confirmation. Throws with logs on failure. */
  sendAndConfirm(tx: Transaction): Promise<string>;
}

export class RpcChain implements ChainIO {
  readonly connection: Connection;
  constructor(url: string) {
    this.connection = new Connection(url, "confirmed");
  }
  async getAccountsData(keys: PublicKey[]) {
    const out: (Buffer | null)[] = [];
    for (let i = 0; i < keys.length; i += 100) {
      const infos = await this.connection.getMultipleAccountsInfo(keys.slice(i, i + 100));
      for (const a of infos) out.push(a ? Buffer.from(a.data) : null);
    }
    return out;
  }
  latestBlockhash() {
    return this.connection.getLatestBlockhash("confirmed");
  }
  async sendAndConfirm(tx: Transaction) {
    const sig = await this.connection.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
    const res = await this.connection.confirmTransaction(
      { signature: sig, blockhash: tx.recentBlockhash!, lastValidBlockHeight: tx.lastValidBlockHeight! },
      "confirmed",
    );
    if (res.value.err) throw new Error(`tx ${sig} failed: ${JSON.stringify(res.value.err)}`);
    return sig;
  }
}

// ---------- decoded state ----------

export type ConfigState = {
  admin: PublicKey;
  oracle: PublicKey;
  treasury: PublicKey;
  feeProtocolBps: number;
  feeCreatorBps: number;
  feePotBps: number;
  stakeBps: number;
  seasonSecs: bigint;
  graceSecs: bigint;
  scoreSmoothing: bigint;
  maxScore: bigint;
  initialVirtualSol: bigint;
  initialVirtualToken: bigint;
  currentSeason: number;
  unapplied: number;
  paused: boolean;
};

export type SeasonState = {
  id: number;
  startTs: bigint;
  endTs: bigint;
  songCount: number;
  scoredCount: number;
  appliedCount: number;
  pot: bigint;
  staked: bigint;
  payoutPot: bigint;
  totalWeight: bigint;
  finalized: boolean;
  refund: boolean;
};

export type SongState = {
  address: PublicKey;
  songId: Buffer;
  mint: PublicKey;
  creator: PublicKey;
  seasonId: number;
  phase: "trading" | "scored";
  baseline: bigint;
  virtualSol: bigint;
  virtualToken: bigint;
  realSol: bigint;
  realToken: bigint;
  creatorFees: bigint;
  lastFinal: bigint;
  lastScore: bigint;
  lastStake: bigint;
  launchedTs: bigint;
};

const big = (v: BN | number): bigint => BigInt(v.toString());

export type ConfigParams = {
  oracle: PublicKey;
  treasury: PublicKey;
  feeProtocolBps: number;
  feeCreatorBps: number;
  feePotBps: number;
  stakeBps: number;
  seasonSecs: bigint;
  graceSecs: bigint;
  scoreSmoothing: bigint;
  maxScore: bigint;
  initialVirtualSol: bigint;
  initialVirtualToken: bigint;
};

export const DEFAULT_PARAMS = (oracle: PublicKey, treasury: PublicKey): ConfigParams => ({
  oracle,
  treasury,
  feeProtocolBps: 50,
  feeCreatorBps: 25,
  feePotBps: 25,
  stakeBps: 3_000,
  seasonSecs: 30n * 86_400n,
  graceSecs: 7n * 86_400n,
  scoreSmoothing: 1_000n,
  maxScore: 100n * 1_000_000n,
  initialVirtualSol: 30n * 1_000_000_000n,
  initialVirtualToken: 1_073_000_000_000_000n,
});

const bn = (v: bigint | number) => new BN(v.toString());

export class SleeperClient {
  readonly coder = new BorshAccountsCoder(IDL);
  readonly program: Program<Sleeper>;

  constructor(
    readonly io: ChainIO,
    readonly programId: PublicKey = PROGRAM_ID,
  ) {
    // Only used to build instructions; never sends, so it needs no wallet.
    this.program = new Program<Sleeper>({ ...(idlJson as Sleeper), address: programId.toBase58() }, { connection: {} } as never);
  }

  // ---------- addresses ----------
  pda(...seeds: (Buffer | Uint8Array)[]): PublicKey {
    return PublicKey.findProgramAddressSync(seeds, this.programId)[0];
  }
  configPda() {
    return this.pda(Buffer.from("config"));
  }
  seasonPda(id: number) {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(id);
    return this.pda(Buffer.from("season"), b);
  }
  songPda(songId: Buffer) {
    return this.pda(Buffer.from("song"), songId);
  }
  mintPda(song: PublicKey) {
    return this.pda(Buffer.from("mint"), song.toBuffer());
  }
  ata(owner: PublicKey, mint: PublicKey) {
    return getAssociatedTokenAddressSync(mint, owner, true, TOKEN_2022_PROGRAM_ID);
  }

  // ---------- reads ----------
  async now(): Promise<bigint> {
    const [clock] = await this.io.getAccountsData([SYSVAR_CLOCK_PUBKEY]);
    if (!clock) throw new Error("clock sysvar missing");
    return clock.readBigInt64LE(32);
  }

  async config(): Promise<ConfigState> {
    const [data] = await this.io.getAccountsData([this.configPda()]);
    if (!data) throw new Error("Sleeper config not initialized on this cluster");
    const c = this.coder.decode("Config", data);
    return {
      admin: c.admin,
      oracle: c.oracle,
      treasury: c.treasury,
      feeProtocolBps: c.fee_protocol_bps,
      feeCreatorBps: c.fee_creator_bps,
      feePotBps: c.fee_pot_bps,
      stakeBps: c.stake_bps,
      seasonSecs: big(c.season_secs),
      graceSecs: big(c.grace_secs),
      scoreSmoothing: big(c.score_smoothing),
      maxScore: big(c.max_score),
      initialVirtualSol: big(c.initial_virtual_sol),
      initialVirtualToken: big(c.initial_virtual_token),
      currentSeason: c.current_season,
      unapplied: c.unapplied,
      paused: c.paused,
    };
  }

  async season(id: number): Promise<SeasonState | null> {
    const [data] = await this.io.getAccountsData([this.seasonPda(id)]);
    if (!data) return null;
    const s = this.coder.decode("Season", data);
    return {
      id: s.id,
      startTs: big(s.start_ts),
      endTs: big(s.end_ts),
      songCount: s.song_count,
      scoredCount: s.scored_count,
      appliedCount: s.applied_count,
      pot: big(s.pot),
      staked: big(s.staked),
      payoutPot: big(s.payout_pot),
      totalWeight: big(s.total_weight),
      finalized: s.finalized,
      refund: s.refund,
    };
  }

  decodeSong(address: PublicKey, data: Buffer): SongState {
    const s = this.coder.decode("Song", data);
    return {
      address,
      songId: Buffer.from(s.song_id),
      mint: s.mint,
      creator: s.creator,
      seasonId: s.season_id,
      phase: Object.keys(s.phase)[0]!.toLowerCase() === "trading" ? "trading" : "scored",
      baseline: big(s.baseline),
      virtualSol: big(s.virtual_sol),
      virtualToken: big(s.virtual_token),
      realSol: big(s.real_sol),
      realToken: big(s.real_token),
      creatorFees: big(s.creator_fees),
      lastFinal: big(s.last_final),
      lastScore: big(s.last_score),
      lastStake: big(s.last_stake),
      launchedTs: big(s.launched_ts),
    };
  }

  /** Songs by song id; missing ones are left out. */
  async songs(songIds: Buffer[]): Promise<SongState[]> {
    const keys = songIds.map((id) => this.songPda(id));
    const data = await this.io.getAccountsData(keys);
    const out: SongState[] = [];
    data.forEach((d, i) => d && out.push(this.decodeSong(keys[i]!, d)));
    return out;
  }

  // ---------- instructions ----------
  initializeIx(admin: PublicKey, p: ConfigParams) {
    return this.program.methods
      .initialize(this.params(p))
      .accountsStrict({
        admin,
        config: this.configPda(),
        season: this.seasonPda(0),
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  updateConfigIx(admin: PublicKey, p: ConfigParams) {
    return this.program.methods
      .updateConfig(this.params(p))
      .accountsStrict({ admin, config: this.configPda() })
      .instruction();
  }

  private params(p: ConfigParams) {
    return {
      oracle: p.oracle,
      treasury: p.treasury,
      feeProtocolBps: p.feeProtocolBps,
      feeCreatorBps: p.feeCreatorBps,
      feePotBps: p.feePotBps,
      stakeBps: p.stakeBps,
      seasonSecs: bn(p.seasonSecs),
      graceSecs: bn(p.graceSecs),
      scoreSmoothing: bn(p.scoreSmoothing),
      maxScore: bn(p.maxScore),
      initialVirtualSol: bn(p.initialVirtualSol),
      initialVirtualToken: bn(p.initialVirtualToken),
    };
  }

  launchIx(a: {
    creator: PublicKey;
    oracle: PublicKey;
    currentSeason: number;
    songId: Buffer;
    baseline: bigint;
    name: string;
    symbol: string;
    uri: string;
  }) {
    const song = this.songPda(a.songId);
    const mint = this.mintPda(song);
    return this.program.methods
      .launchSong({ songId: [...a.songId], baseline: bn(a.baseline), name: a.name, symbol: a.symbol, uri: a.uri })
      .accountsStrict({
        creator: a.creator,
        oracle: a.oracle,
        config: this.configPda(),
        season: this.seasonPda(a.currentSeason),
        song,
        mint,
        vault: this.ata(song, mint),
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  private tradeAccounts(trader: PublicKey, song: SongState, treasury: PublicKey) {
    return {
      trader,
      config: this.configPda(),
      song: song.address,
      season: this.seasonPda(song.seasonId),
      treasury,
      mint: song.mint,
      vault: this.ata(song.address, song.mint),
      traderAta: this.ata(trader, song.mint),
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    };
  }

  buyIx(trader: PublicKey, song: SongState, treasury: PublicKey, maxSol: bigint, minTokens: bigint) {
    return this.program.methods
      .buy(bn(maxSol), bn(minTokens))
      .accountsStrict(this.tradeAccounts(trader, song, treasury))
      .instruction();
  }

  sellIx(trader: PublicKey, song: SongState, treasury: PublicKey, tokens: bigint, minSol: bigint) {
    return this.program.methods
      .sell(bn(tokens), bn(minSol))
      .accountsStrict(this.tradeAccounts(trader, song, treasury))
      .instruction();
  }

  scoreIx(scorer: PublicKey, song: SongState, finalTraction: bigint, snapshotHash: Buffer) {
    return this.program.methods
      .scoreSong(bn(finalTraction), [...snapshotHash])
      .accountsStrict({
        scorer,
        config: this.configPda(),
        song: song.address,
        season: this.seasonPda(song.seasonId),
      })
      .instruction();
  }

  finalizeIx(payer: PublicKey, currentSeason: number) {
    return this.program.methods
      .finalizeSeason()
      .accountsStrict({
        payer,
        config: this.configPda(),
        season: this.seasonPda(currentSeason),
        nextSeason: this.seasonPda(currentSeason + 1),
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  applyIx(song: SongState) {
    return this.program.methods
      .applyPayout()
      .accountsStrict({
        config: this.configPda(),
        song: song.address,
        season: this.seasonPda(song.seasonId),
        nextSeason: this.seasonPda(song.seasonId + 1),
      })
      .instruction();
  }

  async tx(
    feePayer: PublicKey,
    ixs: TransactionInstruction[],
    opts: { computeUnits?: number; priorityMicroLamports?: number } = {},
  ): Promise<Transaction> {
    const { blockhash, lastValidBlockHeight } = await this.io.latestBlockhash();
    const tx = new Transaction({ feePayer, blockhash, lastValidBlockHeight });
    if (opts.computeUnits) tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: opts.computeUnits }));
    if (opts.priorityMicroLamports) {
      tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: opts.priorityMicroLamports }));
    }
    tx.add(...ixs);
    return tx;
  }
}

/** Token-2022 metadata name is checked in bytes on-chain (<= 64). Cut on a char boundary. */
export function clampUtf8(s: string, maxBytes: number): string {
  const enc = new TextEncoder();
  if (enc.encode(s).length <= maxBytes) return s;
  let out = "";
  for (const ch of s) {
    if (enc.encode(out + ch + "…").length > maxBytes) break;
    out += ch;
  }
  return out + "…";
}
