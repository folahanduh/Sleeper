import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SYSVAR_CLOCK_PUBKEY } from "@solana/web3.js";
import { expect, test } from "vitest";
import { SleeperClient } from "../src/chain.js";
import { SvmChain } from "./svm.js";

test("oracle's IDL copy matches the built program", () => {
  const root = resolve(import.meta.dirname, "../..");
  const built = readFileSync(resolve(root, "target/idl/sleeper.json"), "utf8");
  const copy = readFileSync(resolve(root, "oracle/src/idl/sleeper.json"), "utf8");
  expect(JSON.parse(copy)).toEqual(JSON.parse(built));
});

test("LiteSVM exposes the clock sysvar the client reads", async () => {
  const chain = new SvmChain();
  const [clock] = await chain.getAccountsData([SYSVAR_CLOCK_PUBKEY]);
  expect(clock).not.toBeNull();
  chain.warpTo(1_900_000_000n);
  expect(await new SleeperClient(chain).now()).toBe(1_900_000_000n);
});
