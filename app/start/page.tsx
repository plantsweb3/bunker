import type { Metadata } from "next";
import { DocumentLayout } from "@/components/bunker/document-layout";
import SetupGuide from "@/components/bunker/setup-guide";

export const metadata: Metadata = {
  title: "Set up a Bunker",
  description: "Six steps from nothing to a Bunker that is built, funded with a small amount, watched and rehearsed. Public beta.",
};
export default function Start() {
  return (
    <DocumentLayout
      eyebrow="SETUP GUIDE · PUBLIC BETA"
      title="Set up a Bunker."
      description="Six steps, in order. Your keys are made offline and never touch this website."
    >
      <div className="document-callout">
        <h2>Before you start</h2>
        <p>
          You need a computer or an Android phone, any Solana wallet with a little SOL for fees, and somewhere safe
          that is not this device for two files. Bunker never asks for your recovery kit or its password, here or
          anywhere else.
        </p>
      </div>
      <SetupGuide />
    </DocumentLayout>
  );
}
