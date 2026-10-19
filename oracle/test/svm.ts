/** ChainIO backed by LiteSVM, running the real compiled program. */
import { resolve } from "node:path";
import { address, getTransactionDecoder, lamports } from "@solana/kit";
import { LiteSVM, FailedTransactionMetadata } from "litesvm";
import { PublicKey, type Transaction } from "@solana/web3.js";
import { PROGRAM_ID, type ChainIO } from "../src/chain.js";

export const SO = resolve(import.meta.dirname, "../../target/deploy/sleeper.so");
export const SOL = 1_000_000_000n;

export class SvmChain implements ChainIO {
  readonly svm = new LiteSVM();
  constructor() {
    this.svm.addProgramFromFile(address(PROGRAM_ID.toBase58()), SO);
  }
  async getAccountsData(keys: PublicKey[]) {
    return keys.map((k) => {
      const a = this.svm.getAccount(address(k.toBase58()));
      return a.exists ? Buffer.from(a.data) : null;
    });
  }
  async latestBlockhash() {
    return { blockhash: this.svm.latestBlockhash() as string, lastValidBlockHeight: 1_000_000 };
  }
  async sendAndConfirm(tx: Transaction) {
    const decoded = getTransactionDecoder().decode(tx.serialize());
    const res = this.svm.sendTransaction(decoded);
    this.svm.expireBlockhash();
    if (res instanceof FailedTransactionMetadata) {
      throw new Error(`${res.toString()}\n${res.meta().logs().join("\n")}`);
    }
    return Buffer.from(res.signature()).toString("hex");
  }
  airdrop(pk: PublicKey, amount: bigint) {
    this.svm.airdrop(address(pk.toBase58()), lamports(amount));
  }
  lamports(pk: PublicKey): bigint {
    const a = this.svm.getAccount(address(pk.toBase58()));
    return a.exists ? BigInt(a.lamports) : 0n;
  }
  now(): bigint {
    return this.svm.getClock().unixTimestamp;
  }
  warpTo(ts: bigint) {
    const c = this.svm.getClock();
    c.unixTimestamp = ts;
    c.slot = c.slot + 1000n;
    this.svm.setClock(c);
  }
}
