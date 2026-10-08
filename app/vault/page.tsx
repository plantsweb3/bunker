import { Header, Footer } from "@/components/bunker/shell";
import VaultRouter from "@/components/bunker/vault-router";
export const metadata = { title: "Your Bunker" };
export default function Page() {
  return (
    <>
      <Header />
      {/* Plays once per load, never intercepts input, and is hidden under reduced motion. */}
      <div className="bunker-door" aria-hidden="true">
        <span />
        <i />
        <span />
        <b>ENTERING BUNKER</b>
      </div>
      <div className="vault-room" aria-hidden="true" />
      <VaultRouter />
      <Footer />
    </>
  );
}
