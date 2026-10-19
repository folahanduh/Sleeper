import { createHash } from "node:crypto";

/** Deterministic JSON: sorted keys, bigints as strings. Its sha256 goes on-chain. */
export function canonicalJson(v: unknown): string {
  const norm = (x: unknown): unknown => {
    if (typeof x === "bigint") return x.toString();
    if (Array.isArray(x)) return x.map(norm);
    if (x && typeof x === "object") {
      return Object.fromEntries(
        Object.keys(x as object)
          .sort()
          .map((k) => [k, norm((x as Record<string, unknown>)[k])]),
      );
    }
    return x;
  };
  return JSON.stringify(norm(v));
}

export function sha256(s: string | Buffer): Buffer {
  return createHash("sha256").update(s).digest();
}

/** Canonical on-chain song id: one coin per recording. */
export function songIdFromIsrc(isrc: string): Buffer {
  return sha256(`isrc:${isrc.trim().toUpperCase()}`);
}
