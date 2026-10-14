"use client";
// Revoking the open approvals "Check a wallet" found, when the wallet that
// owns them is the one connected. Nothing else is signed here.
import type { TokenHolding } from "@/sdk/exposure";
import { REVOKES_PER_TRANSACTION, revokeIx } from "@/lib/revoke";
import { Messages, useBunker } from "./v3/shared";
import { WalletButton } from "./wallet";

export default function RevokeApprovals({
  owner,
  approvals,
  onDone,
}: {
  owner: string;
  approvals: TokenHolding[];
  /** Called after each transaction lands, to read the wallet again. */
  onDone: () => void;
}) {
  const b = useBunker();
  const connected = b.wallet.address?.toBase58() ?? null;
  async function revoke(rows: TokenHolding[]) {
    const signer = b.wallet.address;
    if (!signer || signer.toBase58() !== owner) throw new Error("Connect the wallet that owns these approvals");
    for (let i = 0; i < rows.length; i += REVOKES_PER_TRANSACTION) {
      const batch = rows.slice(i, i + REVOKES_PER_TRANSACTION);
      const left = rows.length - i - batch.length;
      await b.transmit(
        rows.length > REVOKES_PER_TRANSACTION ? `Revoking, ${left} left after this one` : "Revoking",
        batch.map((t) => revokeIx(t.account, signer, t.program)),
      );
      onDone();
    }
    b.setNotice(`${rows.length === 1 ? "Approval" : `${rows.length} approvals`} revoked.`);
  }
  return (
    <div className="revoke">
      {connected === owner ? (
        <>
          <button
            className="button light"
            disabled={!!b.busy || !b.enabled}
            onClick={() => b.task("Revoking", () => revoke(approvals))}
          >
            {approvals.length === 1 ? "Revoke this approval" : `Revoke all ${approvals.length}`}
          </button>
          <p className="micro">
            One signature in your wallet per {REVOKES_PER_TRANSACTION} approvals. It only takes back the
            approvals: no tokens move, and Bunker is not involved.
          </p>
        </>
      ) : (
        <>
          <WalletButton />
          <p className="micro">
            {connected
              ? "The connected wallet is not the one checked here. Connect the wallet that owns these approvals to revoke them."
              : "Connect this wallet to revoke them here. Only its owner can."}
          </p>
        </>
      )}
      <Messages busy={b.busy} error={b.error} notice={b.notice} />
    </div>
  );
}
