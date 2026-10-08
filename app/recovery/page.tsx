import { Header, Footer } from "@/components/bunker/shell";
import RecoveryTool from "@/components/bunker/v3/recovery-tool";
export const metadata = {
  title: "Recovery",
  description: "Build a Bunker, cancel a withdrawal, or replace a day key with your recovery kit. Draft protocol, test networks only.",
};
export default function Page() {
  return (
    <>
      <Header />
      <RecoveryTool />
      <Footer />
    </>
  );
}
