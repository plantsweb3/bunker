/** Bunker offline recovery tool (DRAFT). The only code that handles the
 * archival master. It makes no network request: the page's Content Security
 * Policy forbids every connection, and everything it produces is a file the
 * user carries to the website. */
import { PublicKey } from "@solana/web3.js";
import { hex, unhex } from "../../sdk/bytes";
import { genesisVault, recoveryPacket } from "../../sdk/v3/authority";
import { epochSeed, recoveryKey } from "../../sdk/v3/derive";
import { rootFromSecret, verify } from "../../sdk/winternitz";
import {
  ArchivalKit,
  DayKey,
  decryptArchival,
  descriptorOf,
  download,
  encryptFile,
  fileName,
  passwordProblem,
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
    salt: kit.salt,
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

/** The day key is typed into a website; the recovery kit never is. They must
 * not share a password, or the site learns the one that opens the kit. */
function dayPassword(id: string, repeatId: string, kitPassword: string) {
  const password = value(id);
  if (password !== value(repeatId)) throw new Error("Day key passwords do not match");
  const problem = passwordProblem(password);
  if (problem) throw new Error(`Day key password: ${problem}`);
  if (password === kitPassword)
    throw new Error("The day key needs a different password from the recovery kit");
  return password;
}
const describe = (k: { network: string; genesis: string; program: string }) =>
  `Network: ${k.network}\nGenesis: ${k.genesis}\nProgram: ${k.program}`;
$("card").addEventListener("change", () => {
  read(file("card"), "the network card")
    .then((raw) => {
      $("card-echo").textContent = describe(parseNetworkCard(raw));
      $("card-box").hidden = false;
    })
    .catch(() => ($("card-box").hidden = true));
});

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
    dayPassword("day-password", "day-repeat", password);
    if (!checked("card-ack"))
      throw new Error("Confirm the network and program match the website");
    if (!checked("kit-ack")) throw new Error("Acknowledge what the recovery kit is");
    if (checked("wait") && !checked("wait-ack"))
      throw new Error("Acknowledge the waiting period, or turn it off");
    const program = new PublicKey(card.program);
    const salt = crypto.getRandomValues(new Uint8Array(32));
    const master = crypto.getRandomValues(new Uint8Array(32));
    const delaySecs = checked("wait") ? Number(value("delay")) : 0;
    // The address is a hash of the keys and the waiting period, so nobody
    // else can create this Bunker with different ones.
    const { d } = genesisVault(
      master,
      { chainTag: new PublicKey(card.genesis).toBytes(), programId: program.toBytes(), salt },
      delaySecs,
    );
    const kit = validateArchival({
      version: 3,
      kind: "archival",
      network: card.network,
      genesis: card.genesis,
      program: card.program,
      salt: hex(salt),
      vaultId: hex(d.vaultId),
      vault: vaultAddress(program, d.vaultId).toBase58(),
      delaySecs,
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
    const g = genesisVault(unhex(kit.master), descriptorOf(kit), kit.delaySecs);
    const request: CreationRequest = {
      version: 3,
      kind: "create",
      network: kit.network,
      genesis: kit.genesis,
      program: kit.program,
      salt: kit.salt,
      vaultId: kit.vaultId,
      vault: kit.vault,
      delaySecs: kit.delaySecs,
      opRoot: hex(g.opRoot),
      recRoot: hex(g.recRoot),
    };
    const day = dayKey(kit, 0n);
    download(
      fileName(day),
      await encryptFile(day, dayPassword("day-password", "day-repeat", value("password"))),
    );
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
  const kit = await decryptArchival(
    await read(file("kit"), "your recovery kit"),
    value("kit-password"),
  );
  $("kit-echo").textContent = `${describe(kit)}\nBunker: ${kit.vault}`;
  $("kit-box").hidden = false;
  return kit;
}
const newDayPassword = () =>
  dayPassword("new-day-password", "new-day-repeat", value("kit-password"));
$("recover").addEventListener(
  "click",
  run("recover-status", async () => {
    const kit = await openKit();
    const epoch = epochOf("epoch");
    const password = newDayPassword();
    const d = descriptorOf(kit);
    const packet = recoveryPacket(unhex(kit.master), d, epoch);
    // Never hand out a packet this tool cannot itself verify.
    const root = rootFromSecret(recoveryKey(unhex(kit.master), d, epoch));
    if (!verify(packet.signature, packet.message, root))
      throw new Error("Internal check failed. Nothing was saved.");
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
    download(fileName(next), await encryptFile(next, password));
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
    download(fileName(day), await encryptFile(day, newDayPassword()));
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
// Served from a website this page could be swapped or observed. It only runs
// as a file the user saved and opened.
if (location.protocol !== "file:") {
  $("served").hidden = false;
  $("tool").hidden = true;
}
$("online").hidden = !navigator.onLine;
window.addEventListener("online", () => ($("online").hidden = false));
window.addEventListener("offline", () => ($("online").hidden = true));
