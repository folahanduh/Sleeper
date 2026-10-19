import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Keypair } from "@solana/web3.js";
import { z } from "zod";

const ROOT = resolve(import.meta.dirname, "../..");

const Env = z.object({
  SLEEPER_RPC_URL: z.string().url().default("https://api.mainnet-beta.solana.com"),
  SLEEPER_ORACLE_KEYPAIR: z.string().default(resolve(ROOT, "keys/oracle-keypair.json")),
  SLEEPER_DATA_DIR: z.string().default(resolve(ROOT, "data")),
  SLEEPER_PUBLIC_URL: z.string().url().default("http://localhost:8787"),
  SLEEPER_WEB_ORIGIN: z.string().default("*"),
  SLEEPER_PORT: z.coerce.number().int().default(8787),
  SLEEPER_PRIORITY_MICROLAMPORTS: z.coerce.number().int().nonnegative().default(5_000),
  SLEEPER_SETTLE_EVERY_MIN: z.coerce.number().positive().default(10),
  LASTFM_API_KEY: z.string().default(""),
  YOUTUBE_API_KEY: z.string().default(""),
});

export type OracleConfig = z.infer<typeof Env>;

export function loadConfig(): OracleConfig {
  const envFile = resolve(ROOT, ".env");
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  return Env.parse(process.env);
}

export function loadKeypair(path: string): Keypair {
  if (!existsSync(path)) throw new Error(`keypair not found: ${path} (create with solana-keygen new -o ${path})`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8")) as number[]));
}
