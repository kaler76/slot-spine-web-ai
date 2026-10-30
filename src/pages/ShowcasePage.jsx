// Vetrina per i clienti: cosa fa lo strumento, con i rulli come protagonisti e una prova dell'attesa.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import SlotReels from "../components/ui/SlotReels.jsx";
import BusyStage from "../components/ui/BusyStage.jsx";
import ActionButton from "../components/ui/ActionButton.jsx";

const TOOLS = [
  { to: "/personaggio-animato", name: "Personaggio animato", text: "Da tre tavole del personaggio a uno scheletro Spine con ossa, mesh pesate, viso espressivo e otto animazioni pronte." },
  { to: "/symbols", name: "Simboli", text: "Ogni simbolo della slot con le sue animazioni di attesa, atterraggio e vincita, esportate in Spine 4.1." },
  { to: "/characters", name: "Character", text: "Personaggi a pezzi con rig libero, generazione dei pezzi con l'AI e anteprima immediata." },
  { to: "/backgrounds", name: "Fondali", text: "Livelli indipendenti con parallasse, luci che pulsano e movimenti lenti per lo sfondo della slot." },
  { to: "/reels", name: "Rulli animati", text: "Tutti i simboli animati dentro i rulli: giro completo, atterraggio e vincite come nel gioco." }
];

const DEMO_STEPS = ["Leggo le tavole", "Ritaglio e ricompongo i pezzi", "Costruisco ossa e mesh", "Genero le animazioni", "Preparo il pacchetto Spine"];
const WINS = [["seven", "seven", "seven"], ["gem", "gem", "gem"], ["crown", "crown", "crown"], ["bell", "bell", "bell"]];

export default function ShowcasePage() {
  // rulli dell'apertura: girano, si fermano su un tris, ripartono
  const [hero, setHero] = useState("spin");
  const [win, setWin] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      setHero((h) => {
        if (h === "spin") return "win";
        setWin((w) => (w + 1) % WINS.length);
        return "spin";
      });
    }, 1900);
    return () => clearInterval(id);
  }, []);

  // prova dell'attesa
  const [demo, setDemo] = useState(null); // null | { step, done }
  function runDemo() {
    setDemo({ step: 0, done: false });
    DEMO_STEPS.forEach((_, i) => setTimeout(() => setDemo({ step: i + 1, done: i + 1 === DEMO_STEPS.length }), 900 * (i + 1)));
  }
  const busy = demo && !demo.done;

  return (
    <div className="page page-wide vetrina">
      <section className="vt-hero">
        <div className="vt-hero-copy">
          <p className="vt-brand">Slot Spine Generator di Eventic</p>
          <h1 className="vt-title">Dalla grafica alla slot animata.</h1>
          <p className="vt-lead">
            Simboli, personaggi e fondali diventano animazioni Spine 4.1 pronte per il gioco, direttamente nel browser.
            Si carica la grafica, si sceglie lo stile, si scarica il pacchetto.
          </p>
          <div className="vt-cta">
            <Link to="/personaggio-animato" className="btn">Crea un personaggio animato</Link>
            <Link to="/reels" className="btn secondary">Guarda i rulli</Link>
          </div>
        </div>
        <div className="vt-hero-reels">
          <SlotReels state={hero} result={WINS[win]} size={104} label="Rulli di esempio" />
        </div>
      </section>

      <section className="vt-tools" aria-label="Strumenti">
        {TOOLS.map((t) => (
          <Link key={t.to} to={t.to} className="vt-tool">
            <span className="vt-tool-name">{t.name}</span>
            <span className="vt-tool-text">{t.text}</span>
          </Link>
        ))}
      </section>

      <section className="vt-demo">
        <div>
          <h2>Anche l'attesa fa parte dello spettacolo</h2>
          <p className="subtitle">
            Ogni lavoro lungo mostra a che punto è: le fasi, il tempo trascorso e i rulli che si fermano sul tris quando il pacchetto è pronto.
          </p>
          <ActionButton busy={!!busy} busyLabel="Creo il pacchetto…" doneLabel="Pacchetto pronto" onClick={runDemo}>
            Prova una creazione
          </ActionButton>
        </div>
        <div className="vt-demo-stage">
          {demo ? (
            <BusyStage key={demo.done ? "fatto" : "corso"} title="Creo il personaggio animato" doneTitle="Pacchetto Spine pronto" steps={DEMO_STEPS} step={demo.step} progress={demo.step / DEMO_STEPS.length} done={demo.done} result={["crown", "crown", "crown"]} />
          ) : (
            <div className="vt-demo-empty">Premi "Prova una creazione" per vedere l'attesa di un lavoro vero.</div>
          )}
        </div>
      </section>
    </div>
  );
}
