/**
 * The oracle's registry. Every launch needs the oracle's signature, so this is the
 * complete list of songs (pending until seen on-chain). Back up data/ like a wallet:
 * losing it means rebuilding from chain events.
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Components } from "./traction.js";

export type SongRow = {
  songId: string; // hex
  isrc: string;
  deezerId: number;
  title: string;
  artist: string;
  cover: string | null;
  deezerLink: string;
  lastfmArtist: string;
  lastfmTrack: string;
  youtubeId: string | null;
  symbol: string;
  name: string;
  creator: string;
  status: "pending" | "live";
  /** Components the current season is measured from. */
  comps: Components;
  compsSeason: number;
  createdAt: number;
};

export type SnapshotRow = { season: number; songId: string; hash: string; json: string; signature: string | null };

export class Store {
  readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS songs (
        song_id TEXT PRIMARY KEY,
        isrc TEXT NOT NULL,
        deezer_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        artist TEXT NOT NULL,
        cover TEXT,
        deezer_link TEXT NOT NULL,
        lastfm_artist TEXT NOT NULL,
        lastfm_track TEXT NOT NULL,
        youtube_id TEXT,
        symbol TEXT NOT NULL,
        name TEXT NOT NULL,
        creator TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending','live')),
        comps TEXT NOT NULL,
        comps_season INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS snapshots (
        season INTEGER NOT NULL,
        song_id TEXT NOT NULL,
        hash TEXT NOT NULL,
        json TEXT NOT NULL,
        signature TEXT,
        PRIMARY KEY (season, song_id)
      );
    `);
  }

  private row(r: Record<string, unknown>): SongRow {
    return {
      songId: r.song_id as string,
      isrc: r.isrc as string,
      deezerId: Number(r.deezer_id),
      title: r.title as string,
      artist: r.artist as string,
      cover: (r.cover as string | null) ?? null,
      deezerLink: r.deezer_link as string,
      lastfmArtist: r.lastfm_artist as string,
      lastfmTrack: r.lastfm_track as string,
      youtubeId: (r.youtube_id as string | null) ?? null,
      symbol: r.symbol as string,
      name: r.name as string,
      creator: r.creator as string,
      status: r.status as SongRow["status"],
      comps: JSON.parse(r.comps as string) as Components,
      compsSeason: Number(r.comps_season),
      createdAt: Number(r.created_at),
    };
  }

  /** Insert a pending launch. A live song is never overwritten. */
  putPending(s: SongRow): void {
    this.db
      .prepare(
        `INSERT INTO songs VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?,?)
         ON CONFLICT(song_id) DO UPDATE SET
           symbol=excluded.symbol, name=excluded.name, creator=excluded.creator, youtube_id=excluded.youtube_id,
           lastfm_artist=excluded.lastfm_artist, lastfm_track=excluded.lastfm_track,
           comps=excluded.comps, comps_season=excluded.comps_season, created_at=excluded.created_at
         WHERE songs.status = 'pending'`,
      )
      .run(
        s.songId, s.isrc, s.deezerId, s.title, s.artist, s.cover, s.deezerLink, s.lastfmArtist, s.lastfmTrack,
        s.youtubeId, s.symbol, s.name, s.creator, JSON.stringify(s.comps), s.compsSeason, s.createdAt,
      );
  }

  get(songId: string): SongRow | null {
    const r = this.db.prepare("SELECT * FROM songs WHERE song_id = ?").get(songId);
    return r ? this.row(r as Record<string, unknown>) : null;
  }

  list(status?: SongRow["status"]): SongRow[] {
    const rows = status
      ? this.db.prepare("SELECT * FROM songs WHERE status = ? ORDER BY created_at").all(status)
      : this.db.prepare("SELECT * FROM songs ORDER BY created_at").all();
    return rows.map((r) => this.row(r as Record<string, unknown>));
  }

  markLive(songId: string, creator: string): void {
    this.db.prepare("UPDATE songs SET status='live', creator=? WHERE song_id=?").run(creator, songId);
  }

  deletePending(songId: string): void {
    this.db.prepare("DELETE FROM songs WHERE song_id=? AND status='pending'").run(songId);
  }

  setComps(songId: string, comps: Components, season: number): void {
    this.db.prepare("UPDATE songs SET comps=?, comps_season=? WHERE song_id=?").run(JSON.stringify(comps), season, songId);
  }

  getSnapshot(season: number, songId: string): SnapshotRow | null {
    const r = this.db.prepare("SELECT * FROM snapshots WHERE season=? AND song_id=?").get(season, songId) as
      | Record<string, unknown>
      | undefined;
    if (!r) return null;
    return {
      season: Number(r.season),
      songId: r.song_id as string,
      hash: r.hash as string,
      json: r.json as string,
      signature: (r.signature as string | null) ?? null,
    };
  }

  /** First write wins: a posted snapshot is immutable (its hash is on-chain). */
  putSnapshot(s: SnapshotRow): void {
    this.db
      .prepare("INSERT INTO snapshots VALUES (?,?,?,?,?) ON CONFLICT DO NOTHING")
      .run(s.season, s.songId, s.hash, s.json, s.signature);
  }

  setSnapshotSignature(season: number, songId: string, sig: string): void {
    this.db.prepare("UPDATE snapshots SET signature=? WHERE season=? AND song_id=?").run(sig, season, songId);
  }

  close(): void {
    this.db.close();
  }
}
