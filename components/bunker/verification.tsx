"use client";
import { useEffect, useState } from "react";
import { RefreshCw, ExternalLink } from "lucide-react";
type Verification = {
  network: string;
  program: string | null;
  audit: string;
  sourceVerified: boolean;
  deployment: string;
  upgradeAuthority: string;
};
export default function Verification() {
  const [data, setData] = useState<Verification | null>(null),
    [error, setError] = useState("");
  async function refresh() {
    setError("");
    try {
      const r = await fetch("/api/verify");
      if (!r.ok) throw new Error("Verification service unavailable");
      setData((await r.json()) as Verification);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verification unavailable");
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/verify", { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error("Verification service unavailable");
        setData(await r.json() as Verification);
      })
      .catch((e) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Verification unavailable"); });
    return () => controller.abort();
  }, []);
  return (
    <div className="panel live-verification">
      <div className="panel-head">
        <h2>Deployment facts</h2>
        <button className="text-button" onClick={refresh}>
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {data ? (
        <>
          <div className="metric">
            <span>Configured network</span>
            <b>{data.network}</b>
          </div>
          <div className="metric">
            <span>Program deployment</span>
            <b>{data.deployment}</b>
          </div>
          <div className="metric">
            <span>Upgrade authority</span>
            <b className="address">{data.upgradeAuthority}</b>
          </div>
          <div className="metric">
            <span>Independent audits</span>
            <b>{data.audit}</b>
          </div>
          <div className="metric">
            <span>Source ↔ deployed binary</span>
            <b>
              {data.sourceVerified ? "Verified" : "Not independently verified"}
            </b>
          </div>
          {data.program && (
            <div className="verification-address">
              <span>Configured test program</span>
              <code>{data.program}</code>
              {data.network !== "localnet" && (
                <a
                  href={`https://explorer.solana.com/address/${data.program}?cluster=devnet`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Inspect on Explorer
                  <ExternalLink size={12} />
                </a>
              )}
            </div>
          )}
        </>
      ) : (
        <p>Reading configured deployment status…</p>
      )}
      <p className="micro">
        Executable status is an RPC observation. It is not an audit or proof
        that source matches a deployed binary.
      </p>
    </div>
  );
}
