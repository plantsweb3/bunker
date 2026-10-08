import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { PublicKey } from "@solana/web3.js";
import { hex, unhex } from "../sdk/bytes";
import { genesisAuthorities, recoveryPacket } from "../sdk/v3/authority";
import { descriptorOf } from "../sdk/v3/kit";
import { vaultAddress, VaultState } from "../sdk/v3/protocol";
import {
  parseCreationRequest,
  parseNetworkCard,
  parseRecoveryFile,
  recoveryFileStatus,
} from "../sdk/v3/requests";
const program = new PublicKey(new Uint8Array(32).fill(11));
const vaultId = new Uint8Array(32).fill(7);
const master = new Uint8Array(32).fill(0x42);
const identity = {
  version: 3 as const,
  network: "localnet" as const,
  genesis: new PublicKey(new Uint8Array(32).fill(9)).toBase58(),
  program: program.toBase58(),
  vaultId: hex(vaultId),
  vault: vaultAddress(program, vaultId).toBase58(),
};
const d = descriptorOf(identity);
const g = genesisAuthorities(master, d);
const packet = (epoch: bigint) => {
  const p = recoveryPacket(master, d, epoch);
  return JSON.stringify({ ...identity, kind: "recover", epoch: epoch.toString(), payload: hex(p.payload), signature: hex(p.signature) });
};
const chain = (over: Partial<VaultState> = {}): VaultState => ({
  vaultId, chainTag: d.chainTag, opRoot: g.opRoot, opIndex: 0n, epoch: 0n, recRoot: g.recRoot, delaySecs: 0, pending: null, bump: 255, ...over,
});
describe("Public files between the offline tool and the site", () => {
  it("accepts a network card and rejects other files", () => {
    const card = { version: 3, kind: "network", network: "localnet", genesis: identity.genesis, program: identity.program };
    expect(parseNetworkCard(JSON.stringify(card))).toEqual(card);
    expect(() => parseNetworkCard(JSON.stringify({ ...card, master: "00" }))).toThrow("not a Bunker network card");
    expect(() => parseNetworkCard(packet(0n))).toThrow();
    expect(() => parseNetworkCard("x".repeat(9000))).toThrow("too large");
  });
  it("validates a creation request and carries no secret", () => {
    const request = { ...identity, kind: "create", delaySecs: 0, opRoot: hex(g.opRoot), recRoot: hex(g.recRoot) };
    expect(parseCreationRequest(JSON.stringify(request))).toEqual(request);
    expect(JSON.stringify(request)).not.toContain(hex(master));
    expect(JSON.stringify(request)).not.toContain(hex(g.seed));
    const bad = (over: object) => () => parseCreationRequest(JSON.stringify({ ...request, ...over }));
    expect(bad({ recRoot: hex(g.opRoot) })).toThrow("invalid commitments");
    expect(bad({ opRoot: "0".repeat(64) })).toThrow("invalid commitments");
    expect(bad({ delaySecs: 604_801 })).toThrow();
    expect(bad({ vault: vaultAddress(program, new Uint8Array(32).fill(8)).toBase58() })).toThrow("does not match");
    expect(bad({ master: hex(master) })).toThrow("not a Bunker creation request");
  });
  it("checks a recovery packet against itself and against the chain", () => {
    const f = parseRecoveryFile(packet(0n));
    expect(recoveryFileStatus(f, chain())).toBe("ready");
    expect(recoveryFileStatus(f, chain({ epoch: 1n }))).toBe("already-applied");
    expect(recoveryFileStatus(parseRecoveryFile(packet(1n)), chain())).toBe("wrong-epoch");
    // A packet from a different master does not verify against this vault.
    const other = recoveryPacket(new Uint8Array(32).fill(0x43), d, 0n);
    const forged = JSON.stringify({ ...identity, kind: "recover", epoch: "0", payload: hex(other.payload), signature: hex(other.signature) });
    expect(recoveryFileStatus(parseRecoveryFile(forged), chain())).toBe("bad-signature");
    // Its stated epoch must be the one inside the signed payload.
    const lying = JSON.parse(packet(0n));
    lying.epoch = "1";
    expect(() => parseRecoveryFile(JSON.stringify(lying))).toThrow("does not match its own description");
    const altered = JSON.parse(packet(0n));
    const bytes = unhex(altered.signature);
    bytes[0] ^= 1;
    altered.signature = hex(bytes);
    expect(recoveryFileStatus(parseRecoveryFile(JSON.stringify(altered)), chain())).toBe("bad-signature");
  });
});
describe("Offline recovery tool page", () => {
  const template = readFileSync("tools/recovery/template.html", "utf8");
  it("forbids every connection and pins its script", () => {
    const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(template)![1];
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("script-src '__SCRIPT_HASH__'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
  });
  it("loads nothing from anywhere", () => {
    expect(template).not.toMatch(/<(link|img|iframe|script)[^>]+(src|href)=/i);
    expect(template).not.toMatch(/https?:\/\//);
  });
});
