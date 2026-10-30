// Vetrina per i clienti: cosa fa lo strumento, con i rulli come protagonisti e una prova dell'attesa.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import SlotReels from "../components/ui/SlotReels.jsx";
import BusyStage from "../components/ui/BusyStage.jsx";
import ActionButton from "../components/ui/ActionButton.jsx";

const TOOLS = [
  { to: "/personaggio-animato", name: "Personaggio animato", text: "Respira, ride, si stupisce, lancia la sua magia. Tre tavole e il tuo eroe si sveglia con otto animazioni e un viso che recita." },
  { to: "/symbols", name: "Simboli", text: "Ogni simbolo pulsa nell'attesa, atterra con un colpo secco ed esplode di luce quando paga. Il giocatore lo sente." },
  { to: "/characters", name: "Character", text: "Descrivi il personaggio, l'AI disegna i pezzi e lo vedi muoversi subito. Dall'idea al rig in un caffè." },
  { to: "/backgrounds", name: "Fondali", text: "Nuvole che scorrono, torce che tremano, luci che respirano: il mondo dietro i rulli non sta mai fermo." },
  { to: "/reels", name: "Rulli animati", text: "Il giro, la frenata, il tris che si accende. Provi la tua slot come la vivrà il giocatore, prima ancora di consegnarla." }
];

const DEMO_STEPS = ["Studio il tuo personaggio", "Lo ricompongo pezzo per pezzo", "Gli do ossa e muscoli", "Gli insegno a muoversi", "Lo impacchetto per Spine 4.1"];
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
          <h1 className="vt-title">Diamo vita alla tua slot.</h1>
          <p className="vt-lead">
            Carichi la grafica e in pochi secondi simboli, eroi e fondali iniziano a respirare, saltare e brillare.
            Animazioni Spine 4.1 pronte per il gioco, fatte nel browser, con il ritmo di una vincita vera.
          </p>
          <div className="vt-cta">
            <Link to="/personaggio-animato" className="btn">Sveglia il tuo personaggio</Link>
            <Link to="/reels" className="btn secondary">Fai girare i rulli</Link>
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
          <h2>Qui anche l'attesa ti fa battere il cuore</h2>
          <p className="subtitle">
            Mentre lavoriamo vedi ogni passo, i secondi che corrono e i rulli che girano. Quando è pronto, si fermano sul tris.
          </p>
          <ActionButton busy={!!busy} busyLabel="Ci siamo quasi…" doneLabel="Tris! È pronto" onClick={runDemo}>
            Prova l'emozione
          </ActionButton>
        </div>
        <div className="vt-demo-stage">
          {demo ? (
            <BusyStage key={demo.done ? "fatto" : "corso"} title="Il tuo personaggio si sta svegliando" doneTitle="Eccolo, è vivo!" steps={DEMO_STEPS} step={demo.step} progress={demo.step / DEMO_STEPS.length} done={demo.done} result={["crown", "crown", "crown"]} />
          ) : (
            <div className="vt-demo-empty">Premi "Prova l'emozione" e guarda come aspetta chi crea con noi.</div>
          )}
        </div>
      </section>
    </div>
  );
}
