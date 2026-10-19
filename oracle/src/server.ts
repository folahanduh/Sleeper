/**
 * Public HTTP API for the website:
 *   GET  /api/health
 *   GET  /api/search?q=            Deezer search for the launch picker
 *   POST /api/launch/prepare       {deezer, creator, symbol?, youtube?} -> oracle-signed tx
 *   POST /api/launch/confirm       {songId} -> promotes to live once on-chain
 *   GET  /api/songs                registry of live songs (metadata only; prices come from chain)
 *   GET  /meta/<songId>.json       token metadata (the coin's uri)
 *   GET  /snapshots/<season>/<songId>.json   the exact bytes whose sha256 is on-chain
 *
 * The oracle key only ever signs transactions this server built itself, and it is
 * never the fee payer of a launch.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Keypair } from "@solana/web3.js";
import type { SleeperClient } from "./chain.js";
import { LaunchError, metadataJson, prepareLaunch } from "./launch.js";
import { SourceError } from "./sources/http.js";
import type { Stats } from "./stats.js";
import type { Store } from "./store.js";

export type ServerDeps = {
  client: SleeperClient;
  stats: Stats;
  store: Store;
  oracle: Keypair;
  publicUrl: string;
  webOrigin: string;
  priority?: number;
};

const MAX_BODY = 4_096;
const HEX64 = /^[0-9a-f]{64}$/;

/** Sliding-window limiter per client IP. Not shared across processes. */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}
  allow(key: string, now = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 50_000) this.hits.clear(); // bound memory under abuse
    return true;
  }
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!(req.headers["content-type"] ?? "").includes("application/json")) {
    throw new HttpError(415, "bad_input", "send application/json");
  }
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, "bad_input", "body too large");
    chunks.push(c as Buffer);
  }
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
    return v as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "bad_input", "invalid JSON");
  }
}

const str = (v: unknown, max = 200): string | undefined =>
  typeof v === "string" && v.length <= max ? v : typeof v === "number" ? String(v) : undefined;

export function createOracleServer(deps: ServerDeps): Server {
  const prepareLimit = new RateLimiter(6, 60_000);
  const searchLimit = new RateLimiter(30, 60_000);

  const send = (res: ServerResponse, status: number, body: unknown, raw?: string) => {
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": deps.webOrigin,
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "x-content-type-options": "nosniff",
      "cache-control": status === 200 && raw !== undefined ? "public, max-age=300" : "no-store",
    });
    res.end(raw ?? JSON.stringify(body));
  };

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://x");
    const ip = req.socket.remoteAddress ?? "?";
    const path = url.pathname;

    if (req.method === "OPTIONS") return send(res, 204, null, "");

    if (req.method === "GET" && path === "/api/health") {
      const config = await deps.client.config().catch(() => null);
      return send(res, 200, {
        ok: true,
        program: deps.client.programId.toBase58(),
        oracle: deps.oracle.publicKey.toBase58(),
        season: config?.currentSeason ?? null,
        oracleMatchesChain: config ? config.oracle.equals(deps.oracle.publicKey) : null,
      });
    }

    if (req.method === "GET" && path === "/api/search") {
      if (!searchLimit.allow(ip)) throw new HttpError(429, "rate_limited", "slow down");
      const q = url.searchParams.get("q") ?? "";
      return send(res, 200, { results: await deps.stats.deezerSearch(q) });
    }

    if (req.method === "POST" && path === "/api/launch/prepare") {
      if (!prepareLimit.allow(ip)) throw new HttpError(429, "rate_limited", "slow down");
      const b = await readJson(req);
      const deezer = str(b.deezer);
      const creator = str(b.creator, 64);
      if (!deezer || !creator) throw new HttpError(400, "bad_input", "deezer and creator are required");
      const prepared = await prepareLaunch(deps, {
        deezer,
        creator,
        symbol: str(b.symbol, 16),
        youtube: str(b.youtube),
      });
      return send(res, 200, prepared);
    }

    if (req.method === "POST" && path === "/api/launch/confirm") {
      const b = await readJson(req);
      const songId = str(b.songId, 64);
      if (!songId || !HEX64.test(songId)) throw new HttpError(400, "bad_input", "songId must be 64 hex chars");
      const row = deps.store.get(songId);
      if (!row) throw new HttpError(404, "not_found", "unknown song");
      const [onChain] = await deps.client.songs([Buffer.from(songId, "hex")]);
      if (!onChain) return send(res, 200, { live: false });
      deps.store.markLive(songId, onChain.creator.toBase58());
      return send(res, 200, { live: true, mint: onChain.mint.toBase58() });
    }

    if (req.method === "GET" && path === "/api/songs") {
      const songs = deps.store.list("live").map((r) => ({
        songId: r.songId,
        song: deps.client.songPda(Buffer.from(r.songId, "hex")).toBase58(),
        title: r.title,
        artist: r.artist,
        symbol: r.symbol,
        cover: r.cover,
        isrc: r.isrc,
        deezer: r.deezerLink,
        youtubeId: r.youtubeId,
        createdAt: r.createdAt,
      }));
      return send(res, 200, { songs });
    }

    const meta = path.match(/^\/meta\/([0-9a-f]{64})\.json$/);
    if (req.method === "GET" && meta) {
      const row = deps.store.get(meta[1]!);
      if (!row) throw new HttpError(404, "not_found", "unknown song");
      return send(res, 200, null, JSON.stringify(metadataJson(row, deps.publicUrl)));
    }

    const snap = path.match(/^\/snapshots\/(\d{1,6})\/([0-9a-f]{64})\.json$/);
    if (req.method === "GET" && snap) {
      const s = deps.store.getSnapshot(Number(snap[1]), snap[2]!);
      if (!s) throw new HttpError(404, "not_found", "no snapshot");
      return send(res, 200, null, s.json);
    }

    throw new HttpError(404, "not_found", "no such route");
  };

  return createServer((req, res) => {
    handle(req, res).catch((e: unknown) => {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message, code: e.code, ...e.extra });
      if (e instanceof LaunchError) {
        const status = e.code === "exists" ? 409 : e.code === "closed" ? 503 : e.code === "not_found" ? 404 : 422;
        return send(res, status, { error: e.message, code: e.code, ...e.extra });
      }
      if (e instanceof SourceError) return send(res, 502, { error: "a music data source is unavailable, try again", code: "upstream" });
      console.error("[oracle] unhandled", e);
      return send(res, 500, { error: "internal error", code: "internal" });
    });
  });
}
