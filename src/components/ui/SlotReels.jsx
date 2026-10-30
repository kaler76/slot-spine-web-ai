// Rulli di slot animati: il segno distintivo dell'interfaccia (attese, vetrina).
// state: "spin" (girano), "stop" (si fermano uno dopo l'altro), "win" (fermi + linea di vincita).
import { useEffect, useState } from "react";

const SYMBOLS = {
  seven: (
    <svg viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="g7" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ff6b8f" /><stop offset="1" stopColor="#c8104a" /></linearGradient></defs><path d="M14 12h36v8L32 54h-10l17-32H14z" fill="url(#g7)" stroke="#5a0620" strokeWidth="3" strokeLinejoin="round" /></svg>
  ),
  gem: (
    <svg viewBox="0 0 64 64" aria-hidden="true"><path d="M18 14h28l10 14-24 26L8 28z" fill="#33c7e6" stroke="#0b4f63" strokeWidth="3" strokeLinejoin="round" /><path d="M8 28h48M24 14l8 40 8-40M18 14l6 14M46 14l-6 14" fill="none" stroke="#0b4f63" strokeWidth="2" opacity=".55" /></svg>
  ),
  bell: (
    <svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 10c-11 0-17 9-17 20v8l-5 8h44l-5-8v-8c0-11-6-20-17-20z" fill="#f2b544" stroke="#6b3e05" strokeWidth="3" strokeLinejoin="round" /><circle cx="32" cy="51" r="5" fill="#f2b544" stroke="#6b3e05" strokeWidth="3" /></svg>
  ),
  cherry: (
    <svg viewBox="0 0 64 64" aria-hidden="true"><path d="M22 40c4-14 10-24 22-30M42 40c-2-10 0-20 2-30" fill="none" stroke="#2f6b1c" strokeWidth="3" strokeLinecap="round" /><circle cx="21" cy="44" r="10" fill="#e8264d" stroke="#5a0620" strokeWidth="3" /><circle cx="43" cy="44" r="10" fill="#e8264d" stroke="#5a0620" strokeWidth="3" /></svg>
  ),
  star: (
    <svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 8l7 15 16 2-12 11 3 16-14-8-14 8 3-16L9 25l16-2z" fill="#ffd98a" stroke="#7a4b06" strokeWidth="3" strokeLinejoin="round" /></svg>
  ),
  crown: (
    <svg viewBox="0 0 64 64" aria-hidden="true"><path d="M10 46l-2-26 13 11 11-17 11 17 13-11-2 26z" fill="#b48cff" stroke="#3a1a78" strokeWidth="3" strokeLinejoin="round" /><rect x="10" y="46" width="44" height="7" rx="2" fill="#b48cff" stroke="#3a1a78" strokeWidth="3" /></svg>
  )
};
const ORDER = ["seven", "gem", "bell", "cherry", "star", "crown"];

/** @param {{state?: "spin"|"stop"|"win", result?: string[], size?: number, label?: string}} props */
export default function SlotReels({ state = "spin", result = ["seven", "seven", "seven"], size, label = "Caricamento" }) {
  // i rulli si fermano in sequenza (sinistra → destra) come in una slot vera
  const [stopped, setStopped] = useState(state === "spin" ? 0 : 3);
  useEffect(() => {
    if (state === "spin") { setStopped(0); return; }
    setStopped(0);
    const t = [0, 1, 2].map((i) => setTimeout(() => setStopped(i + 1), 160 + i * 230));
    return () => t.forEach(clearTimeout);
  }, [state]);
  const allStopped = stopped >= 3;
  const shown = state === "spin" ? "spin" : allStopped && state === "win" ? "win" : "stop";
  return (
    <div className="reels" data-state={shown} role="img" aria-label={label} style={size ? { "--cella": `${size}px` } : undefined}>
      {[0, 1, 2].map((i) => {
        const isStopped = state !== "spin" && i < stopped;
        const strip = isStopped
          ? [ORDER[(i + 2) % 6], result[i] || "seven", ORDER[(i + 4) % 6]]
          : [...ORDER.slice(i), ...ORDER.slice(0, i), ...ORDER.slice(i), ...ORDER.slice(0, i)];
        return (
          <div className="reel" key={i}>
            <div className={`reel-strip${isStopped ? " ferma" : ""}`} style={!isStopped && state !== "spin" ? { animation: "rullo 300ms linear infinite", filter: "blur(1.2px)" } : undefined}>
              {strip.map((k, j) => <span key={j}>{SYMBOLS[k]}</span>)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
