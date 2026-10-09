// The picture-first explanation of Bunker, in Spanish. The rest of the site
// (the app itself, the manual, the legal pages) is in English for now, and
// this page says so where it links to them.
import type { Metadata } from "next";
import Link from "next/link";
import { Check, X } from "lucide-react";
import { Header, Footer } from "@/components/bunker/shell";
import { BIcon } from "@/components/bunker/icon";
import Story from "@/components/bunker/story";

export const metadata: Metadata = {
  title: "Bunker en español — Prepárate. No entres en pánico.",
  description:
    "Bunker es una caja fuerte para tus criptomonedas. Tu billetera no puede abrirla. Versión preliminar: todavía no acepta fondos reales.",
};
const stops: [string, string][] = [
  ["Un mal clic.", "Engañar a tu billetera no abre tu Búnker."],
  ["Una frase semilla robada.", "Tu frase semilla no crea la llave del Búnker."],
  ["Usar una llave dos veces.", "Cada llave sirve una sola vez. Cada retiro crea una nueva."],
  ["Una llave del día robada, mientras hay espera.", "Solo puede pagar a las billeteras que tú anotaste como tuyas. Todo lo demás espera un día, y tú aprietas alto."],
];
const limits: [string, string][] = [
  ["Un virus en tu dispositivo.", "Puede copiar tu archivo de llave y ver cómo escribes la contraseña."],
  ["Una llave del día robada, si quitas la espera.", "Entonces un ladrón puede enviar todo a cualquier lugar, de inmediato."],
  ["Una billetera de confianza que no es segura.", "Un ladrón con tu llave del día puede pagarle al instante. Que sea una billetera que él no pueda alcanzar."],
  ["Un kit de recuperación perdido.", "Nadie puede restablecerlo. Ni siquiera nosotros."],
];
export default function Inicio() {
  return (
    <div lang="es">
      <Header />
      <main className="page-container">
        <div className="page-heading">
          <div>
            <div className="eyebrow">PREPÁRATE. NO ENTRES EN PÁNICO.</div>
            <h1>
              Un mal clic no debería
              <br />
              <span className="ice">costarte todo.</span>
            </h1>
            <p>
              Bunker es una caja fuerte para tus criptomonedas. Tu billetera no puede abrirla. Así,
              un ladrón que engaña a tu billetera no puede vaciarla.
            </p>
          </div>
          <Link className="pill" href="/" hrefLang="en" lang="en">
            English
          </Link>
        </div>
        <div className="notice">
          Versión preliminar. Todavía no acepta fondos reales y aún no ha sido revisada por expertos externos.
        </div>
        <section className="intro section" id="como" style={{ paddingLeft: 0, paddingRight: 0, paddingTop: 40 }}>
          <div className="split-title">
            <h2>
              El mismo error.
              <br />
              Dos finales.
            </h2>
            <p>Todos hacemos clic donde no debíamos algún día. Mira lo que pasa después, con un Búnker y sin él.</p>
          </div>
          <Story lang="es" />
          <div className="way-in">
            <h3>Tu entrada. Tres pasos pequeños.</h3>
            <ol>
              <li>
                <Link href="/check">
                  <span className="way-num">1</span>
                  <BIcon name="everyday-wallet" size={34} />
                  <b>Mira</b>
                  <span>Ve lo que un mal clic podría quitarle a tu billetera. No conectas nada. (En inglés.)</span>
                  <em>Revisar mi billetera</em>
                </Link>
              </li>
              <li>
                <Link href="/es/demo">
                  <span className="way-num">2</span>
                  <BIcon name="simulation" size={34} />
                  <b>Practica</b>
                  <span>Déjate robar a propósito, con dinero de mentira. Ve lo que cambia un Búnker.</span>
                  <em>Hacer la práctica</em>
                </Link>
              </li>
              <li>
                <Link href="/recovery">
                  <span className="way-num">3</span>
                  <BIcon name="vault" size={34} />
                  <b>Construye</b>
                  <span>Crea tu propio Búnker. Hoy funciona solo con dinero de prueba. (En inglés.)</span>
                  <em>Construir mi Búnker</em>
                </Link>
              </li>
            </ol>
          </div>
        </section>
        <section className="section role" style={{ paddingLeft: 0, paddingRight: 0 }}>
          <div className="split-title">
            <h2>
              Cuatro cosas.
              <br />
              Todas las guardas tú.
            </h2>
            <p>Nadie en Bunker tiene una copia y no hay botón de reinicio. Eso es lo que deja fuera al ladrón.</p>
          </div>
          <ol className="hold-grid">
            <li>
              <div className="hold-pic wallet" aria-hidden="true">
                <span className="p-wallet" />
                <span className="p-coin a" />
                <span className="p-coin b" />
                <span className="p-reach" />
              </div>
              <h3>Tu billetera</h3>
              <strong>Para gastar.</strong>
              <p>Deja poco aquí. Un ladrón puede alcanzarla.</p>
            </li>
            <li>
              <div className="hold-pic key" aria-hidden="true">
                <span className="p-door" />
                <span className="p-key" />
                <span className="p-coin out" />
              </div>
              <h3>Tu llave del día</h3>
              <strong>Abre la puerta.</strong>
              <p>A tus propias billeteras: al instante. A cualquier otra: después de un día.</p>
            </li>
            <li>
              <div className="hold-pic stop" aria-hidden="true">
                <span className="p-ring" />
                <span className="p-stop">ALTO</span>
              </div>
              <h3>Tu botón de alto</h3>
              <strong>Detiene al ladrón.</strong>
              <p>Un archivo. Tenlo a la mano. Cancela un retiro que tú no hiciste.</p>
            </li>
            <li>
              <div className="hold-pic kit" aria-hidden="true">
                <span className="p-drawer" />
                <span className="p-box" />
              </div>
              <h3>Tu kit de recuperación</h3>
              <strong>Crea llaves nuevas.</strong>
              <p>Escóndelo. Nunca en internet. Nunca se lo muestres a un sitio web, ni a este.</p>
            </li>
          </ol>
        </section>
        <section className="section limits" style={{ paddingLeft: 0, paddingRight: 0 }}>
          <h2>
            Lo que detiene.
            <br />
            Lo que no puede.
          </h2>
          <div className="limits-grid">
            <div>
              <h3>Hecho para detener</h3>
              <ul>
                {stops.map(([lead, rest]) => (
                  <li key={lead}>
                    <Check size={16} className="ice" />
                    <span>
                      <b>{lead}</b> {rest}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3>No detiene</h3>
              <ul>
                {limits.map(([lead, rest]) => (
                  <li key={lead}>
                    <X size={16} />
                    <span>
                      <b>{lead}</b> {rest}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <p className="limits-note">
            Esto es lo que está hecho para hacer. Expertos externos todavía no lo han revisado.{" "}
            <Link href="/security">Lee todos los límites (en inglés).</Link>
          </p>
        </section>
      </main>
      <Footer />
    </div>
  );
}
