/** The part of Bunker Watch that runs when the popup is closed.
 *
 * The browser wakes it once a minute. It runs one pass, shows a notification
 * for anything that changed, sets the toolbar badge, and goes back to sleep.
 * It keeps nothing in memory between wakes. */
import "@/sdk/polyfill";
import { SITE } from "./config";
import { INK } from "./notify";
import { connect, endpointOf } from "./rpc";
import * as store from "./store";
import { runPass } from "./watch";

const ALARM = "bunker-watch";
const kv = store.chromeStore();

async function schedule() {
  if (!(await chrome.alarms.get(ALARM))) await chrome.alarms.create(ALARM, { periodInMinutes: 1, delayInMinutes: 1 });
}
/** Shows what is in the outbox, oldest first, and takes each out once it has
 * been handed to the browser. If the extension is stopped in between, the
 * alert is still there on the next wake; shown twice, it replaces itself. */
async function deliver() {
  for (const notice of await store.outbox(kv)) {
    await Promise.resolve(
      chrome.notifications.create(notice.id, {
        type: "basic",
        iconUrl: chrome.runtime.getURL("icons/128.png"),
        title: notice.title,
        message: notice.message,
        priority: notice.urgent ? 2 : 0,
        requireInteraction: notice.urgent,
      }),
    ).catch(() => undefined);
    await store.shown(kv, notice.id);
  }
}
async function tick() {
  // Two wakes can overlap; the second one has nothing to add.
  await navigator.locks.request("bunker-watch-pass", { ifAvailable: true }, async (held) => {
    if (!held) return;
    // Anything decided on an earlier wake and not shown yet comes first.
    await deliver();
    const result = await runPass(kv, connect(endpointOf(await store.settings(kv))));
    await deliver();
    await chrome.action.setBadgeBackgroundColor({ color: result.badge.color });
    await chrome.action.setBadgeTextColor({ color: INK });
    await chrome.action.setBadgeText({ text: result.badge.text });
  });
}
const wake = () => void schedule().then(tick).catch(() => undefined);
// Every time the browser starts this worker, for whatever reason, the alarm is
// made sure of: after an install, a restart, an update, or being switched off and on.
void schedule().catch(() => undefined);
chrome.runtime.onInstalled.addListener(wake);
chrome.runtime.onStartup.addListener(wake);
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) void tick().catch(() => undefined);
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
  void chrome.tabs.create({ url: `${SITE}/${["announced", "left", "recovered"].includes(kind) ? "emergency" : "vault"}` });
  void chrome.notifications.clear(id);
});
