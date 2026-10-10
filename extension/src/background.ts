/** The part of Bunker Watch that runs when the popup is closed.
 *
 * The browser wakes it once a minute. It runs one pass, shows a notification
 * for anything that changed, sets the toolbar badge, and goes back to sleep.
 * It keeps nothing in memory between wakes. */
import "@/sdk/polyfill";
import { SITE } from "./config";
import { INK, type Notice } from "./notify";
import { connect, endpointOf } from "./rpc";
import * as store from "./store";
import { runPass } from "./watch";

const ALARM = "bunker-watch";
const kv = store.chromeStore();

async function schedule() {
  if (!(await chrome.alarms.get(ALARM))) await chrome.alarms.create(ALARM, { periodInMinutes: 1, delayInMinutes: 1 });
}
function show(n: Notice, at: number) {
  // The id says which Bunker and which kind, so a click can go to the right page.
  return chrome.notifications.create(`${n.kind}:${n.vault}:${at}`, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/128.png"),
    title: n.title,
    message: n.message,
    priority: n.urgent ? 2 : 0,
    requireInteraction: n.urgent,
  });
}
async function tick() {
  // Two wakes can overlap; the second one has nothing to add.
  await navigator.locks.request("bunker-watch-pass", { ifAvailable: true }, async (held) => {
    if (!held) return;
    const result = await runPass(kv, connect(endpointOf(await store.settings(kv))));
    const at = Date.now();
    // A notification the browser will not show must not stop the badge and
    // the popup from saying what happened.
    for (const [i, notice] of result.notices.entries()) await Promise.resolve(show(notice, at + i)).catch(() => undefined);
    await chrome.action.setBadgeBackgroundColor({ color: result.badge.color });
    await chrome.action.setBadgeTextColor({ color: INK });
    await chrome.action.setBadgeText({ text: result.badge.text });
  });
}
chrome.runtime.onInstalled.addListener(() => void schedule().then(tick));
chrome.runtime.onStartup.addListener(() => void schedule().then(tick));
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) void tick().catch(() => {});
});
// The popup asks for a pass after the list or the endpoint changes.
chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if ((message as { type?: string })?.type !== "pass") return;
  void schedule()
    .then(tick)
    .then(
      () => reply({ ok: true }),
      () => reply({ ok: false }),
    );
  return true;
});
chrome.notifications.onClicked.addListener((id) => {
  const [kind] = id.split(":");
  // What to do is on the website. The extension itself does nothing to a Bunker.
  void chrome.tabs.create({ url: `${SITE}/${kind === "announced" || kind === "left" || kind === "recovered" ? "emergency" : "vault"}` });
  void chrome.notifications.clear(id);
});
