import { Header, Footer } from "@/components/bunker/shell";
import Demo from "@/components/bunker/demo";
export const metadata = { title: "Interactive demo" };
export default function Page() {
  return (
    <>
      <Header />
      <main className="page-container">
        <Demo />
      </main>
      <Footer />
    </>
  );
}
