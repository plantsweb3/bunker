export type DemoStage =
  | "wallet"
  | "bunkered"
  | "compromised"
  | "rejected"
  | "withdrawn";
export type DemoAction =
  | "deposit"
  | "compromise"
  | "attack"
  | "withdraw"
  | "reset";
export function transition(stage: DemoStage, action: DemoAction): DemoStage {
  if (action === "reset") return "wallet";
  const allowed: Partial<
    Record<DemoStage, Partial<Record<DemoAction, DemoStage>>>
  > = {
    wallet: { deposit: "bunkered" },
    bunkered: { compromise: "compromised" },
    compromised: { attack: "rejected" },
    rejected: { withdraw: "withdrawn" },
  };
  const next = allowed[stage]?.[action];
  if (!next) throw new Error("Complete the current simulation step first");
  return next;
}
