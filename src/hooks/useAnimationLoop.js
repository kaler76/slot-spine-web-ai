import { useEffect, useRef } from "react";
import { computeFrameStyle, totalDuration } from "../lib/animationPreview.js";

/**
 * Anima in loop l'animazione "animationType" contenuta in animationsObj,
 * scrivendo transform/filter direttamente sull'elemento DOM referenziato da
 * elementRef ad ogni frame (nessun re-render React nel loop: più robusto e
 * performante rispetto a un ciclo che passa per lo stato).
 *
 * Uso: const imgRef = useRef(null);
 *      const { duration } = useAnimationLoop({ elementRef: imgRef, ... });
 *      <img ref={imgRef} ... />
 */
export function useAnimationLoop({ elementRef, animationsObj, animationType, boneName, slotName, playing }) {
  const frameRef = useRef(null);
  const startRef = useRef(null);

  const entry = animationsObj?.[animationType];
  const boneTrack = entry?.bones?.[boneName] || {};
  const duration = totalDuration(boneTrack);

  useEffect(() => {
    // Ferma sempre un eventuale loop precedente prima di (ri)decidere se avviarne uno nuovo
    if (frameRef.current) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }

    if (!playing || !entry || !elementRef.current) {
      if (elementRef.current) {
        elementRef.current.style.transform = "";
        elementRef.current.style.filter = "";
      }
      return;
    }

    startRef.current = performance.now();

    function frame(now) {
      const el = elementRef.current;
      if (!el) return; // elemento smontato: interrompe silenziosamente
      const elapsed = ((now - startRef.current) / 1000) % duration;
      const { transform, filter } = computeFrameStyle(entry, boneName, slotName, elapsed);
      el.style.transform = transform;
      el.style.filter = filter;
      frameRef.current = requestAnimationFrame(frame);
    }
    frameRef.current = requestAnimationFrame(frame);

    return () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, entry, boneName, slotName, duration, elementRef]);

  return { duration };
}
