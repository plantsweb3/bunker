"use client";
import { useEffect, useState } from "react";
import type { BunkerConfig } from "@/lib/bunker-config";
import VaultApp from "./vault-app";
import Vault3App from "./v3/vault-app";
/** The protocol 2 app runs only when a test configuration asks for it. The
 * read-only public site and protocol 3 test configurations get the new app. */
export default function VaultRouter() {
  const [legacy, setLegacy] = useState<boolean | null>(null);
  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json() as Promise<BunkerConfig>)
      .then((c) => setLegacy(c.custodyEnabled && c.protocolVersion !== 3))
      .catch(() => setLegacy(false));
  }, []);
  if (legacy === null) return <main className="vault-page" aria-busy="true" />;
  return legacy ? <VaultApp /> : <Vault3App />;
}
