import { Header, Footer } from "@/components/bunker/shell";
import VaultApp from "@/components/bunker/vault-app";
export const metadata = { title: "Your Bunker" };
export default function Page() {
  return (
    <>
      <Header />
      <VaultApp />
      <Footer />
    </>
  );
}
