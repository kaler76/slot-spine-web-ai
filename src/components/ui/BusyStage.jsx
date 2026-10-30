// Palco dell'attesa: rulli che girano, fasi del lavoro, tempo trascorso, barra. Quando l'azione finisce
// (done) i rulli si fermano su tre simboli uguali e compare la linea di vincita.
import { useEffect, useState } from "react";
import SlotReels from "./SlotReels.jsx";

/**
 * @param {{title: string, steps?: string[], step?: number, progress?: number, done?: boolean, doneTitle?: string, result?: string[]}} props
 *   step: indice della fase in corso; progress: 0..1 se noto (altrimenti barra indeterminata).
 */
export default function BusyStage({ title, steps = [], step = 0, progress, done = false, doneTitle, result = ["seven", "seven", "seven"] }) {
  const [t0] = useState(() => performance.now());
  const [now, setNow] = useState(t0);
  useEffect(() => {
    if (done) return;
    const id = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(id);
  }, [done]);
  const secs = ((now - t0) / 1000).toFixed(1);
  return (
    <div className="busy-stage" data-state={done ? "win" : "spin"} role="status" aria-live="polite">
      <SlotReels state={done ? "win" : "spin"} result={result} label={done ? doneTitle || title : title} />
      <div>
        <p className="busy-title">{done ? doneTitle || title : title}</p>
        {steps.length > 0 && (
          <ol className="busy-steps">
            {steps.map((s, i) => (
              <li key={s} data-s={done || i < step ? "done" : i === step ? "now" : "next"}>{s}</li>
            ))}
          </ol>
        )}
        {!done && (
          <>
            <div className="busy-bar" {...(progress != null ? { "data-p": "" } : {})}>
              <span style={progress != null ? { width: `${Math.round(progress * 100)}%` } : undefined} />
            </div>
            <div className="busy-meta">{secs} s</div>
          </>
        )}
      </div>
    </div>
  );
}
