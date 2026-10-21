"use client";
// The setup guide's steps, each with a tick the visitor sets themselves. The
// ticks are a convenience kept in this browser only: nothing here knows
// whether a Bunker exists, and the page reads correctly with none of them.
import Link from "next/link";
import { type ReactNode, useEffect, useState } from "react";

const KEY = "bunker-setup-guide";
type Step = { id: string; title: string; body: ReactNode; href: string; action: string; newTab?: boolean };
const steps: Step[] = [
  {
    id: "tool",
    title: "Get the offline tool",
    body: (
      <>
        Download two files from the recovery page: the tool, and a network card that tells it which network to build
        for. The tool is one file with nothing to install. It needs a computer or an Android phone.
      </>
    ),
    href: "/recovery",
    action: "Open the recovery page",
  },
  {
    id: "kit",
    title: "Make your files, offline",
    body: (
      <>
        Open the tool from where you saved it and choose “Build a new Bunker”. You decide two things, and both are
        fixed for good: which addresses you trust, which are paid without waiting, and how long a withdrawal to
        anywhere else waits. The tool saves a recovery kit, a day key, a cancel file and a creation request. Keep the
        recovery kit and the cancel file somewhere other than this computer.
      </>
    ),
    href: "/docs",
    action: "How the files work",
  },
  {
    id: "build",
    title: "Build it",
    body: (
      <>
        Bring only the creation request back to the recovery page. It holds nothing secret. Connect any wallet to pay
        the network fee, check that the trusted addresses and the waiting period shown are the ones you chose, and
        build.
      </>
    ),
    href: "/recovery",
    action: "Submit the creation request",
  },
  {
    id: "open",
    title: "Open it and start small",
    body: (
      <>
        Open your Bunker with the day key and its password, then deposit a small amount first. This is a public beta.
      </>
    ),
    href: "/vault",
    action: "Go to my Bunker",
  },
  {
    id: "alerts",
    title: "Turn on alerts",
    body: (
      <>
        Install Bunker Watch, copy your Bunker’s address from the side panel of the open Bunker, and paste it into the
        extension. It tells you when a withdrawal is announced. It holds no keys.
      </>
    ),
    href: "/watch#install",
    action: "Get Bunker Watch",
    newTab: true,
  },
  {
    id: "practice",
    title: "Practice once",
    body: (
      <>
        Announce a small withdrawal to an address that is not on your trusted list. Watch it wait, see the alert
        arrive, and release it when it opens. Find your cancel file while it waits, so you know where it is on the day
        you need it.
      </>
    ),
    href: "/emergency",
    action: "What to do if it was not you",
  },
];

export default function SetupGuide() {
  const [done, setDone] = useState<string[]>([]);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? "[]");
      // Read after the first paint, so the server's page and the browser's agree.
      if (Array.isArray(saved)) queueMicrotask(() => setDone(saved.filter((id) => steps.some((s) => s.id === id))));
    } catch {}
  }, []);
  const toggle = (id: string) => {
    const next = done.includes(id) ? done.filter((d) => d !== id) : [...done, id];
    setDone(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {}
  };
  return (
    <>
      <p className="setup-count" aria-live="polite">
        {done.length} of {steps.length} done. Ticks are kept in this browser only.
      </p>
      <ol className="setup-steps">
        {steps.map((step, i) => (
          <li key={step.id} data-done={done.includes(step.id)}>
            <span className="mono">{String(i + 1).padStart(2, "0")}</span>
            <div>
              <h2>{step.title}</h2>
              <p>{step.body}</p>
              <div className="setup-actions">
                {step.newTab ? (
                  <a className="button ghost compact" href={step.href} target="_blank" rel="noreferrer">
                    {step.action}
                  </a>
                ) : (
                  <Link className="button ghost compact" href={step.href}>
                    {step.action}
                  </Link>
                )}
                <button className="text-button" aria-pressed={done.includes(step.id)} onClick={() => toggle(step.id)}>
                  {done.includes(step.id) ? "Done. Undo" : "Mark as done"}
                </button>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}
