/** The Bunker Watch popup: what is watched, what is waiting, a wallet check
 * and the endpoint setting. It reads the same store the background pass
 * writes, and it does nothing to a Bunker: every action that changes one is
 * a link to the website. */
import "@/sdk/polyfill";
import { PublicKey } from "@solana/web3.js";
import { readExposure, TooLarge } from "@/lib/exposure-read";
import { formatAmount } from "@/sdk/bytes";
import { formatDuration } from "@/sdk/v3/chain";
import type { Exposure } from "@/sdk/exposure";
import { mintLabel } from "@/sdk/known-mints";
import { BEST_EFFORT, MAX_WATCHED, NETWORK, NEVER_ASKS, SITE, STATUS_LINE, short } from "../config";
import { assertGenesis, connect, endpoint, endpointOf, refused, WrongNetwork } from "../rpc";
import * as store from "../store";
import { addVault } from "../watch";
import { h, svg } from "./dom";

type Tab = "watch" | "check" | "settings";
const kv = store.chromeStore();
const root = document.getElementById("app")!;
const ui: {
  tab: Tab;
  adding: boolean;
  busy: boolean;
  problem: string;
  check: { address: string; exposure: Exposure } | null;
  /** What is typed in each field, kept across redraws so a refusal does not erase it. */
  typed: { add: string; check: string; rpc: string | null };
} = { tab: "watch", adding: false, busy: false, problem: "", check: null, typed: { add: "", check: "", rpc: null } };

const sol = (lamports: bigint) => formatAmount(lamports, 9);
const clock = (seconds: bigint) => {
  const s = seconds < 0n ? 0n : seconds;
  const two = (n: bigint) => n.toString().padStart(2, "0");
  return `${two(s / 3600n)}:${two((s % 3600n) / 60n)}:${two(s % 60n)}`;
};
const timeOfDay = (chainSeconds: string) =>
  new Date(Number(chainSeconds) * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
const amountOf = (p: NonNullable<store.View["pending"]>) =>
  p.kind === 0 ? `${sol(BigInt(p.amount))} SOL` : `${p.amount} base units of ${mintLabel(p.mint) ?? short(p.mint)}`;
/** Refusals written for a person to read, by this extension or by the code
 * it shares with the site. Anything else is the network's and is not shown raw. */
const OURS = [
  "That is not",
  "No Bunker found",
  "Vault address does not match",
  "Unrecognized Bunker account",
  "You are already",
  "You can watch",
  "Use an https",
  "Put the key",
  "The browser did not",
];
function explain(e: unknown): string {
  if (e instanceof WrongNetwork) return e.message;
  if (e instanceof TooLarge) return "This wallet has more token accounts than this check can read.";
  if (refused(e)) return "The RPC endpoint is busy. Wait a few seconds and try again.";
  const said = e instanceof Error ? e.message : "";
  if (OURS.some((start) => said.startsWith(start))) return /[.!?]$/.test(said) ? said : `${said}.`;
  return "The network could not be read. Try again in a moment.";
}
const connection = async () => connect(endpointOf(await store.settings(kv)));
const pass = () => chrome.runtime.sendMessage({ type: "pass" }).catch(() => undefined);

const MARK =
  "M64 16 L20 43 C14 47 12 53 12 62 V102 H30 V66 C30 60 33 56 38 53 L64 37 L90 53 C95 56 98 60 98 66 V102 H116 V62 C116 53 113 48 107 44 Z";
const MARK_INNER = "M64 55 L49 64 C44 67 42 72 42 79 V102 H49 L55 88 L64 82 L73 88 L79 102 H86 V79 C86 72 84 67 79 64 Z";
const head = () =>
  h(
    "div",
    { className: "head" },
    h("div", { className: "brand" }, svg("svg", { viewBox: "0 0 128 128", "aria-hidden": "true" }, svg("g", { fill: "#F0F3F2" }, svg("path", { d: MARK }), svg("path", { d: MARK_INNER }))), "BUNKER · WATCH"),
    h("div", { className: "net" }, NETWORK.label),
  );
const big = (first: string, second: string) => h("h1", { className: "big" }, first, h("span", {}, second));
const kvRow = (key: string, value: string) => h("div", { className: "kv" }, h("span", { className: "k" }, key), h("span", {}, value));
const out = (path: string, label: string, className = "link") =>
  h("a", { className, href: `${SITE}${path}`, target: "_blank", rel: "noreferrer" }, label);
/** A picture from the watch kit, if this build has it. The build lists the
 * pictures it packed; one that is not there is not asked for. */
declare const __BUNKER_WATCH_KIT__: string[] | undefined;
const packed = typeof __BUNKER_WATCH_KIT__ === "undefined" ? [] : __BUNKER_WATCH_KIT__;
const kit = (name: string) => (packed.includes(`${name}.jpg`) ? h("img", { className: "kit", src: `kit/${name}.jpg`, alt: "" }) : null);

function ring(fraction: number) {
  const around = 2 * Math.PI * 38;
  return svg(
    "svg",
    { class: "ring", viewBox: "0 0 92 92", "aria-hidden": "true" },
    svg("circle", { cx: "46", cy: "46", r: "38", fill: "none", stroke: "rgba(14,16,18,.12)", "stroke-width": "9" }),
    svg("circle", {
      cx: "46",
      cy: "46",
      r: "38",
      fill: "none",
      stroke: "#3A8CC8",
      "stroke-width": "9",
      "stroke-dasharray": around.toFixed(1),
      "stroke-dashoffset": (around * (1 - Math.min(1, Math.max(0, fraction)))).toFixed(1),
      transform: "rotate(-90 46 46)",
    }),
  );
}
/** When a Bunker was last read. An old reading says how old, because a card
 * that looks current and is hours stale is worse than no card. */
function readAt(view: store.View, now: bigint) {
  const age = now - BigInt(view.checkedAt);
  return age > 180n ? `read ${formatDuration(age)} ago` : `checked ${timeOfDay(view.checkedAt)}`;
}
/** The cream card for a withdrawal that is waiting. */
function waitingCard(view: store.View, now: bigint) {
  const p = view.pending!;
  const left = BigInt(p.opensAt) - now;
  const open = left <= 0n;
  return h(
    "div",
    { className: "panel cream", "data-waiting": view.address },
    h("div", { className: "ph" }, h("span", {}, `Bunker ${short(view.address)}`), h("span", {}, readAt(view, now))),
    h(
      "div",
      { className: "pb" },
      h(
        "div",
        { className: "ringwrap" },
        ring(view.delaySecs > 0 ? Number(left) / view.delaySecs : 0),
        h("div", { className: "ringtxt", "data-countdown": p.opensAt, "data-open": String(open) }, open ? "00:00:00" : clock(left), h("small", {}, open ? "it can leave now" : "until it opens")),
      ),
      kvRow("Amount", amountOf(p)),
      // The whole address. A thief can make one that starts and ends like yours.
      h("div", { className: "to" }, h("span", { className: "k" }, "To"), h("span", { className: "whole" }, p.destination)),
      h("div", {}, h("span", { className: "chip" }, p.trusted ? "A trusted address · no wait" : "Not a trusted address · it waits")),
      view.problem ? h("p", { className: "note problem" }, view.problem) : null,
    ),
  );
}
function quietCard(view: store.View, now: bigint) {
  return h(
    "div",
    { className: "panel", "data-bunker": view.address },
    h("div", { className: "ph" }, h("span", {}, `Bunker ${short(view.address)}`), h("span", {}, readAt(view, now))),
    h(
      "div",
      { className: "pb" },
      kvRow("SOL", sol(BigInt(view.lamports))),
      kvRow("Key", `epoch ${view.epoch} · next ${view.opIndex}`),
      view.problem ? h("p", { className: "note problem" }, view.problem) : null,
      h(
        "div",
        { className: "row" },
        h("span", { className: "chip line" }, h("span", { className: "dot" }), "No withdrawal waiting"),
        h("button", { className: "link", onclick: () => void run(async () => store.unwatch(kv, view.address).then(pass)) }, "Stop watching"),
      ),
    ),
  );
}
function addForm() {
  const input = h("input", { placeholder: "Bunker address", "aria-label": "Bunker address", autocomplete: "off", spellcheck: "false", value: ui.typed.add });
  input.addEventListener("input", () => (ui.typed.add = input.value));
  const submit = () =>
    void run(async () => {
      await addVault(kv, await connection(), input.value);
      ui.adding = false;
      ui.typed.add = "";
      void pass();
    });
  input.addEventListener("keydown", (e) => (e as KeyboardEvent).key === "Enter" && submit());
  queueMicrotask(() => input.focus());
  return h("div", { className: "field" }, input, h("button", { onclick: submit, disabled: ui.busy }, ui.busy ? "Checking" : "Watch"));
}

async function watchTab(): Promise<Node[]> {
  const [shown, status, acknowledged, recent] = await Promise.all([store.views(kv), store.status(kv), store.acknowledged(kv), store.log(kv)]);
  const now = store.chainNow(status);
  const alerts = shown.filter((v) => v.pending && !acknowledged.includes(v.pending.digest));
  // What it cannot see matters most when something is waiting, so it is said on every screen.
  const problem =
    ui.problem ||
    (store.blind(status)
      ? "Bunker Watch has not been able to read the network for several minutes. What is shown here may be out of date."
      : status.problem);
  if (alerts.length) {
    return [
      big(alerts.length === 1 ? "Withdrawal" : `${alerts.length} withdrawals`, "announced."),
      problem ? h("p", { className: "note problem", role: "alert" }, problem) : null,
      h("p", { className: "note" }, "If this was not you, ", h("em", {}, "cancel it before it opens."), " Use your cancel file, or your recovery kit in the offline tool."),
      out("/emergency", "What to do now →", "btn fill"),
      // Every one that is waiting, each with its own answer.
      ...alerts.flatMap((v) => [
        waitingCard(v, now),
        h("button", { className: "btn ghost", onclick: () => void run(() => store.acknowledge(kv, v.pending!.digest)) }, alerts.length === 1 ? "It was me" : `It was me (${short(v.address)})`),
      ]),
      h("p", { className: "note small" }, NEVER_ASKS),
    ].filter((n) => n !== null);
  }
  const waiting = shown.filter((v) => v.pending);
  const count = `${shown.length} Bunker${shown.length === 1 ? "" : "s"} watched.`;
  return [
    shown.length === 0 ? big("Nothing watched.", "Add your Bunker.") : waiting.length ? big("Withdrawal waiting.", count) : big("All quiet.", count),
    shown.length === 0 ? kit("watch-empty") : null,
    problem ? h("p", { className: "note problem", role: "alert" }, problem) : null,
    ...shown.map((v) => (v.pending ? waitingCard(v, now) : quietCard(v, now))),
    ui.adding
      ? addForm()
      : shown.length < MAX_WATCHED
        ? h("button", { className: "btn out", onclick: () => ((ui.adding = true), (ui.problem = ""), void render()) }, "+ Watch a Bunker")
        : null,
    shown.length === 0
      ? h("p", { className: "note" }, "Paste a Bunker's address. Bunker Watch reads it once a minute and tells you when a withdrawal is announced. It holds no keys and cannot move anything.")
      : null,
    h("p", { className: "note" }, "Alerts are best effort. ", h("em", {}, "Silence is not proof"), " nothing happened."),
    recent.length
      ? h(
          "div",
          { className: "panel" },
          h("div", { className: "ph" }, h("span", {}, "Recent alerts"), h("span", {}, String(recent.length))),
          h("div", { className: "pb log" }, ...recent.slice(0, 5).map((e) => h("p", {}, h("b", {}, `${timeOfDay(e.at)} · ${e.title}`), e.text))),
        )
      : null,
  ].filter((n) => n !== null);
}

function checkTab(): Node[] {
  const input = h("input", { placeholder: "Wallet address", "aria-label": "Wallet address", autocomplete: "off", spellcheck: "false", value: ui.typed.check });
  input.addEventListener("input", () => (ui.typed.check = input.value));
  const submit = () =>
    void run(async () => {
      ui.check = null;
      let owner: PublicKey;
      try {
        owner = new PublicKey(input.value.trim());
      } catch {
        throw new Error("That is not a Solana address. Paste the full address.");
      }
      const c = await connection();
      await assertGenesis(c);
      ui.check = { address: owner.toBase58(), exposure: await readExposure(c, owner) };
    });
  input.addEventListener("keydown", (e) => (e as KeyboardEvent).key === "Enter" && submit());
  const e = ui.check?.exposure;
  const newer = e ? e.movable.filter((t) => t.program === "token-2022").length : 0;
  return [
    big("Check", "a wallet."),
    h("div", { className: "field" }, input, h("button", { onclick: submit, disabled: ui.busy }, ui.busy ? "Reading" : "Check")),
    ui.problem ? h("p", { className: "note problem", role: "alert" }, ui.problem) : null,
    e
      ? h(
          "div",
          { className: "panel", "data-exposure": ui.check!.address },
          h("div", { className: "ph" }, h("span", {}, "One signature can move"), h("span", {}, short(ui.check!.address))),
          h(
            "div",
            { className: "pb" },
            kvRow("SOL", sol(e.lamports)),
            kvRow("Token accounts", String(e.movable.length)),
            kvRow("Token-2022", String(newer)),
            h("div", {}, h("span", { className: e.approvals.length ? "chip cream" : "chip line" }, `${e.approvals.length} open delegation${e.approvals.length === 1 ? "" : "s"}`)),
          ),
        )
      : null,
    e && e.approvals.length
      ? h(
          "div",
          { className: "panel" },
          h("div", { className: "ph" }, h("span", {}, "Delegations"), h("span", {}, "who can move it")),
          h("div", { className: "pb" }, ...e.approvals.slice(0, 6).map((t) => kvRow(mintLabel(t.mint) ?? `Mint ${short(t.mint)}`, t.delegate ? short(t.delegate) : "unknown"))),
        )
      : null,
    h("p", { className: "note" }, "Revoke delegations in your wallet. This check ", h("em", {}, "connects no wallet"), " and stores nothing."),
    out("/check", "The full check on bunkermode.io"),
  ].filter((n) => n !== null);
}

async function settingsTab(): Promise<Node[]> {
  const current = await store.settings(kv);
  const input = h("input", { placeholder: NETWORK.defaultRpc, "aria-label": "RPC endpoint", autocomplete: "off", spellcheck: "false", value: ui.typed.rpc ?? current.rpc ?? "" });
  input.addEventListener("input", () => (ui.typed.rpc = input.value));
  const save = () =>
    void run(async () => {
      if (!input.value.trim()) {
        await store.setSettings(kv, { rpc: null });
        if (current.rpc && new URL(current.rpc).origin !== new URL(NETWORK.defaultRpc).origin)
          await chrome.permissions.remove({ origins: [`${new URL(current.rpc).origin}/*`] }).catch(() => false);
        ui.typed.rpc = null;
        return pass();
      }
      const url = endpoint(input.value);
      const origin = (u: string) => `${new URL(u).origin}/*`;
      const standard = origin(NETWORK.defaultRpc);
      // The browser asks the user to allow this one origin. Nothing else is allowed.
      if (!(await chrome.permissions.request({ origins: [origin(url.href)] })))
        throw new Error("The browser did not allow that address, so the setting was not changed.");
      try {
        await assertGenesis(connect(url));
      } catch (e) {
        // An endpoint that is refused does not keep the permission it was just given.
        if (origin(url.href) !== standard && origin(url.href) !== (current.rpc && origin(current.rpc)))
          await chrome.permissions.remove({ origins: [origin(url.href)] }).catch(() => false);
        throw e;
      }
      await store.setSettings(kv, { rpc: url.href });
      // Nor does the endpoint that is no longer used.
      if (current.rpc && origin(current.rpc) !== origin(url.href) && origin(current.rpc) !== standard)
        await chrome.permissions.remove({ origins: [origin(current.rpc)] }).catch(() => false);
      ui.typed.rpc = null;
      void pass();
    });
  return [
    big("Read-only.", "Holds no keys."),
    h(
      "div",
      { className: "panel" },
      h("div", { className: "ph" }, h("span", {}, "RPC endpoint"), h("span", {}, current.rpc ? "yours" : "default")),
      h(
        "div",
        { className: "pb" },
        h("div", { className: "field" }, input, h("button", { onclick: save, disabled: ui.busy }, ui.busy ? "Checking" : "Save")),
        h("p", { className: "note small" }, `Leave empty to use ${new URL(NETWORK.defaultRpc).host}. An endpoint is refused unless it is ${NETWORK.test ? "the test network" : "Solana mainnet"}.`),
      ),
    ),
    ui.problem ? h("p", { className: "note problem", role: "alert" }, ui.problem) : null,
    h(
      "div",
      { className: "panel" },
      h("div", { className: "ph" }, h("span", {}, "This extension"), h("span", {}, `v${chrome.runtime.getManifest().version}`)),
      h(
        "div",
        { className: "pb" },
        kvRow("Keys held", "none"),
        kvRow("Talks to", "your RPC endpoint only"),
        kvRow("Checks", "once a minute"),
        kvRow("Status", STATUS_LINE),
      ),
    ),
    h("p", { className: "note" }, BEST_EFFORT, " ", NEVER_ASKS),
    h("div", { className: "row" }, out("/verify", "Verify this build"), out("/recovery", "Recovery"), out("/emergency", "Emergency")),
  ].filter((n) => n !== null);
}

/** Runs something the user asked for, showing that it is busy and any refusal. */
async function run(job: () => Promise<unknown>) {
  ui.busy = true;
  ui.problem = "";
  await render();
  try {
    await job();
  } catch (e) {
    ui.problem = explain(e);
  }
  ui.busy = false;
  await render();
}
const TICKER = [STATUS_LINE, "READ-ONLY: HOLDS NO KEYS", "ALERTS ARE BEST EFFORT", "BUNKER NEVER ASKS FOR A RECOVERY KIT"];
const tickerRun = () => TICKER.flatMap((line) => [line, h("i", {}, "✦")]);
async function render() {
  const body = ui.tab === "watch" ? await watchTab() : ui.tab === "check" ? checkTab() : await settingsTab();
  const tab = (id: Tab, label: string) =>
    h("button", { role: "tab", "aria-selected": String(ui.tab === id), onclick: () => ((ui.tab = id), (ui.problem = ""), (ui.adding = false), void render()) }, label);
  root.replaceChildren(
    ...["c1", "c2", "c3", "c4"].map((c) => h("i", { className: `crop ${c}` })),
    head(),
    h("main", { className: "body", "data-tab": ui.tab }, ...body),
    h("nav", { className: "tabs", role: "tablist" }, tab("watch", "Watch"), tab("check", "Check a wallet"), tab("settings", "Settings")),
    h("div", { className: "ticker", "aria-hidden": "true" }, h("span", {}, ...tickerRun(), ...tickerRun())),
  );
}
// The countdown moves every second without redrawing the rest.
setInterval(async () => {
  const now = store.chainNow(await store.status(kv));
  for (const el of document.querySelectorAll<HTMLElement>("[data-countdown]")) {
    const left = BigInt(el.dataset.countdown!) - now;
    // The moment it opens, the card is redrawn to say so.
    if (left <= 0n && el.dataset.open === "false" && !ui.busy) return void render();
    if (el.firstChild) el.firstChild.textContent = clock(left);
  }
}, 1000);
// A pass that finishes while the popup is open shows up at once.
chrome.storage.onChanged.addListener(() => {
  if (!ui.busy && !ui.adding && ui.tab === "watch") void render();
});
void render().then(pass);
