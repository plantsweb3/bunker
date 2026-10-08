/** Bunker offline recovery tool (DRAFT). The only code that handles the
 * archival master. It makes no network request: the page's Content Security
 * Policy forbids every connection, and everything it produces is a file the
 * user carries to the website. */
import { PublicKey } from "@solana/web3.js";
import { hex, unhex } from "../../sdk/bytes";
import { genesisAuthorities, recoveryPacket } from "../../sdk/v3/authority";
import { epochSeed } from "../../sdk/v3/derive";
import {
  ArchivalKit,
  DayKey,
  decryptArchival,
  descriptorOf,
  download,
  encryptFile,
  fileName,
  validateArchival,
} from "../../sdk/v3/kit";
import { vaultAddress } from "../../sdk/v3/protocol";
import {
  CreationRequest,
  NetworkCard,
  parseNetworkCard,
  RecoveryFile,
} from "../../sdk/v3/requests";
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const value = (id: string) => $<HTMLInputElement>(id).value;
const checked = (id: string) => $<HTMLInputElement>(id).checked;
const file = (id: string) => $<HTMLInputElement>(id).files?.[0] ?? null;
function say(id: string, text: string, tone: "ok" | "bad" | "" = "") {
  const el = $(id);
  el.textContent = text;
  el.className = `status ${tone}`;
}
async function read(f: File | null, what: string) {
  if (!f) throw new Error(`Choose ${what}`);
  if (f.size > 8000) throw new Error("File is too large");
  return f.text();
}
function dayKey(kit: ArchivalKit, epoch: bigint): DayKey {
  return {
    version: 3,
    kind: "day-key",
    network: kit.network,
    genesis: kit.genesis,
    program: kit.program,
    vaultId: kit.vaultId,
    vault: kit.vault,
    epoch: epoch.toString(),
    seed: hex(epochSeed(unhex(kit.master), descriptorOf(kit), epoch)),
  };
}
const publicJson = (o: object) => JSON.stringify(o, null, 2);
function run(statusId: string, fn: () => Promise<void>) {
  return () => {
    say(statusId, "Working…");
    fn().catch((e) => say(statusId, e instanceof Error ? e.message : "Failed", "bad"));
  };
}
function epochOf(id: string): bigint {
  const raw = value(id).trim();
  if (!/^(0|[1-9][0-9]{0,18})$/.test(raw))
    throw new Error("Enter the key generation shown on your Bunker page");
  return BigInt(raw);
}

// ── Build ────────────────────────────────────────────────────────────────
let draft: { kit: ArchivalKit; encrypted: string } | null = null;
$("wait").addEventListener("change", () => {
  $("wait-fields").hidden = !checked("wait");
  $<HTMLInputElement>("wait-ack").checked = false;
});
$("delay").addEventListener("change", () => {
  $<HTMLInputElement>("wait-ack").checked = false;
  $("delay-echo").textContent = $<HTMLSelectElement>("delay").selectedOptions[0].text;
});
$("create").addEventListener(
  "click",
  run("build-status", async () => {
    const card: NetworkCard = parseNetworkCard(await read(file("card"), "the network card"));
    const password = value("password");
    if (password !== value("repeat")) throw new Error("Passwords do not match");
    if (!checked("kit-ack")) throw new Error("Acknowledge what the recovery kit is");
    if (checked("wait") && !checked("wait-ack"))
      throw new Error("Acknowledge the waiting period, or turn it off");
    const program = new PublicKey(card.program);
    const vaultId = crypto.getRandomValues(new Uint8Array(32));
    const master = crypto.getRandomValues(new Uint8Array(32));
    const kit = validateArchival({
      version: 3,
      kind: "archival",
      network: card.network,
      genesis: card.genesis,
      program: card.program,
      vaultId: hex(vaultId),
      vault: vaultAddress(program, vaultId).toBase58(),
      delaySecs: checked("wait") ? Number(value("delay")) : 0,
      master: hex(master),
    });
    master.fill(0);
    draft = { kit, encrypted: await encryptFile(kit, password) };
    download(fileName(kit), draft.encrypted);
    $("verify-step").hidden = false;
    say("build-status", `Saved ${fileName(kit)}. Re-open it below to continue.`, "ok");
  }),
);
$("verify").addEventListener(
  "change",
  run("build-status", async () => {
    if (!draft) throw new Error("Create the recovery kit first");
    const reopened = await decryptArchival(await read(file("verify"), "the saved kit"), value("password"));
    if (JSON.stringify(reopened) !== JSON.stringify(draft.kit))
      throw new Error("That is not the recovery kit that was just saved");
    const { kit } = draft;
    const g = genesisAuthorities(unhex(kit.master), descriptorOf(kit));
    const request: CreationRequest = {
      version: 3,
      kind: "create",
      network: kit.network,
      genesis: kit.genesis,
      program: kit.program,
      vaultId: kit.vaultId,
      vault: kit.vault,
      delaySecs: kit.delaySecs,
      opRoot: hex(g.opRoot),
      recRoot: hex(g.recRoot),
    };
    const day = dayKey(kit, 0n);
    download(fileName(day), await encryptFile(day, value("password")));
    download(`bunker-test-creation-request-${kit.vault.slice(0, 8)}.json`, publicJson(request));
    $("built-address").textContent = kit.vault;
    $("built").hidden = false;
    say(
      "build-status",
      "Verified. Your day key and a creation request were saved. Take the creation request to the website.",
      "ok",
    );
  }),
);

// ── Recover / re-issue ───────────────────────────────────────────────────
async function openKit() {
  return decryptArchival(await read(file("kit"), "your recovery kit"), value("kit-password"));
}
$("recover").addEventListener(
  "click",
  run("recover-status", async () => {
    const kit = await openKit();
    const epoch = epochOf("epoch");
    const packet = recoveryPacket(unhex(kit.master), descriptorOf(kit), epoch);
    const out: RecoveryFile = {
      version: 3,
      kind: "recover",
      network: kit.network,
      genesis: kit.genesis,
      program: kit.program,
      vaultId: kit.vaultId,
      vault: kit.vault,
      epoch: epoch.toString(),
      payload: hex(packet.payload),
      signature: hex(packet.signature),
    };
    const next = dayKey(kit, epoch + 1n);
    download(fileName(next), await encryptFile(next, value("kit-password")));
    download(
      `bunker-test-recovery-packet-${kit.vault.slice(0, 8)}-epoch-${epoch}.json`,
      publicJson(out),
    );
    say(
      "recover-status",
      `Saved a recovery packet for key generation ${epoch} and the day key for generation ${epoch + 1n}. Submit the packet on the website; the new day key works once it lands.`,
      "ok",
    );
  }),
);
$("reissue").addEventListener(
  "click",
  run("recover-status", async () => {
    const kit = await openKit();
    const day = dayKey(kit, epochOf("epoch"));
    download(fileName(day), await encryptFile(day, value("kit-password")));
    say("recover-status", `Saved ${fileName(day)}.`, "ok");
  }),
);
for (const tab of ["build", "recover"] as const)
  $(`tab-${tab}`).addEventListener("click", () => {
    for (const t of ["build", "recover"] as const) {
      $(`panel-${t}`).hidden = t !== tab;
      $(`tab-${t}`).setAttribute("aria-selected", String(t === tab));
    }
  });
$("online").hidden = !navigator.onLine;
window.addEventListener("online", () => ($("online").hidden = false));
window.addEventListener("offline", () => ($("online").hidden = true));
