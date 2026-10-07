// Disposable, public-test-only recovery harness. Never imported by the application.
import { PublicKey } from "@solana/web3.js";
import { hex } from "../sdk/bytes";
import { generateKey } from "../sdk/winternitz";
import { encodeIntent, vaultAddress } from "../sdk/protocol";
import type { RecoveryKit, ChainState } from "../sdk/recovery";
export const password = "public testing recovery password";
export function memoryBrowser() {
  const storage = new Map<string, string>();
  let queue = Promise.resolve();
  return {
    storage,
    localStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => {
        storage.set(k, v);
      },
    },
    navigator: {
      locks: {
        request: (
          _key: string,
          _options: unknown,
          fn: () => Promise<unknown>,
        ) => {
          const result = queue.then(fn);
          queue = result.then(
            () => undefined,
            () => undefined,
          );
          return result;
        },
      },
    },
  };
}
export function recoveryFixture(
  program = new PublicKey(new Uint8Array(32).fill(1)),
  genesis = "isolated-test",
) {
  const key = generateKey(),
    next = generateKey(),
    id = crypto.getRandomValues(new Uint8Array(32));
  const vault = vaultAddress(program, id),
    recipient = new PublicKey(new Uint8Array(32).fill(3));
  const kit: RecoveryKit = {
    version: 2,
    currentIndex: "0",
    nextUnusedIndex: "1",
    network: "localnet",
    genesis,
    program: program.toBase58(),
    vaultId: hex(id),
    vault: vault.toBase58(),
    nonce: "0",
    root: hex(key.root),
    secret: hex(key.secret),
  };
  const chain: ChainState = { nonce: 0n, root: key.root, slot: 10n };
  const intent = {
    vaultId: id,
    nonce: 0n,
    kind: 0 as const,
    mint: PublicKey.default,
    destination: recipient,
    amount: 1_000_000n,
    expirySlot: 1000000n,
    nextRoot: next.root,
  };
  return {
    key,
    next,
    id,
    vault,
    recipient,
    kit,
    chain,
    intent,
    payload: encodeIntent(intent),
  };
}
