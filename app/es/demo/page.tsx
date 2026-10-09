import type { Metadata } from "next";
import Link from "next/link";
import { Header, Footer } from "@/components/bunker/shell";
import Practice from "@/components/bunker/practice";
export const metadata: Metadata = { title: "Práctica | Bunker" };
export default function Pagina() {
  return (
    <div lang="es">
      <Header />
      <main className="page-container">
        <div className="demo-wrap">
          <div className="page-heading">
            <div>
              <div className="eyebrow">PRÁCTICA · MONEDAS DE MENTIRA</div>
              <h1>
                Déjate robar a propósito.
                <br />
                <span className="ice">Mira lo que cambia.</span>
              </h1>
              <p>Tres movimientos. Nada aquí es real y nada se conecta a tu billetera.</p>
            </div>
            <Link className="pill" href="/demo" hrefLang="en" lang="en">
              English
            </Link>
          </div>
          <Practice lang="es" />
          <p className="micro" style={{ marginTop: 18 }}>
            <Link href="/es">← Volver</Link>
          </p>
        </div>
      </main>
      <Footer />
    </div>
  );
}
