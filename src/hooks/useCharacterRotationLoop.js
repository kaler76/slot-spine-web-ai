import { useEffect, useRef, useState } from "react";

// Durata di permanenza di ogni frame a "velocità" (speed) = 1, in secondi —
// abbastanza rapida da leggersi come un giro dinamico "a scatti" (coerente
// col metodo dei frame intermedi: rotazioni rapide, non lente e morbide).
const BASE_HOLD_SECONDS = 0.35;

/**
 * Avanza tra i frame di un ciclo di rotazione a intervalli regolari (flipbook),
 * a differenza di useCharacterAnimationLoop che campiona una traccia continua:
 * qui non c'è interpolazione, solo lo scatto discreto da un frame al successivo.
 * pulseKey cambia ad ogni scatto per permettere al chiamante di ri-innescare
 * un'animazione CSS (motion blur + piccolo scale pulse) che maschera il cambio
 * frame, esattamente come il motion blur applicato in Photoshop nel metodo
 * originale.
 */
export function useCharacterRotationLoop({ sequenceLength, speed, playing }) {
  const [index, setIndex] = useState(0);
  const [pulseKey, setPulseKey] = useState(0);
  const timerRef = useRef(null);

  useEffect(() => {
    setIndex(0);
    setPulseKey((k) => k + 1);
  }, [sequenceLength]);

  useEffect(() => {
    if (!playing || sequenceLength < 2) return;
    const responsiveness = speed && speed > 0 ? speed : 1;
    const holdMs = (BASE_HOLD_SECONDS / responsiveness) * 1000;
    timerRef.current = setInterval(() => {
      setIndex((i) => (i + 1) % sequenceLength);
      setPulseKey((k) => k + 1);
    }, holdMs);
    return () => clearInterval(timerRef.current);
  }, [playing, sequenceLength, speed]);

  return { index, pulseKey };
}
