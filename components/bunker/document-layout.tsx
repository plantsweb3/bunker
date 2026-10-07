import { Header, Footer } from "./shell";
import Link from "next/link";
import { ReactNode } from "react";
export function DocumentLayout({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <>
      <Header />
      <main className="page-container document-page">
        <div className="page-heading">
          <div>
            <div className="eyebrow">{eyebrow}</div>
            <h1>{title}</h1>
            <p>{description}</p>
          </div>
        </div>
        <div className="document-grid">
          <aside className="document-nav">
            <Link href="/security">Security & limitations</Link>
            <Link href="/verify">Verification & review</Link>
            <Link href="/docs">How Bunker works</Link>
            <Link href="/emergency">My wallet was drained</Link>
            <Link href="/terms">Terms & risks</Link>
            <Link href="/privacy">Privacy</Link>
            <a href="/source/bunker-source.tar.gz" download>
              Download the source
            </a>
          </aside>
          <article className="document-content">{children}</article>
        </div>
      </main>
      <Footer />
    </>
  );
}
