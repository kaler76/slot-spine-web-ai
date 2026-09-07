import { useEffect, useRef } from "react";
import { computeFrameStyle, totalDuration } from "../lib/animationPreview.js";

/**
 * Anima in loop il set di layer di un background o le parti di un character
 * ("ambient" animation). layerRefs: { [layerKey]: ref }. `restRotations`
 * (opzionale, gradi in convenzione Spine) è la posa di riposo per bone — usata
 * sia mentre il loop gira (sommata all'angolo animato) sia quando è fermo o
 * non c'è animazione (altrimenti il layer tornerebbe alla rotazione zero
 * invece di restare nella sua posa base).
 */
export function useBackgroundAnimationLoop({ layerRefs, animationsObj, playing, restRotations }) {
  const frameRef = useRef(null);
  const startRef = useRef(null);

  const entry = animationsObj?.ambient;
  const duration =
    Math.max(
      ...Object.values(entry?.bones || {}).map((track) => totalDuration(track)),
      ...Object.values(entry?.slots || {}).map((track) => {
        const rgba = track?.rgba;
        return rgba && rgba.length ? rgba[rgba.length - 1].time : 0;
      }),
      0.001
    ) || 1;

  useEffect(() => {
    if (frameRef.current) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }

    if (!playing || !entry) {
      Object.entries(layerRefs).forEach(([layerKey, ref]) => {
        if (!ref.current) return;
        const rest = restRotations?.[layerKey] || 0;
        ref.current.style.transform = rest ? `rotate(${-rest}deg)` : "";
        ref.current.style.filter = "";
      });
      return;
    }

    startRef.current = performance.now();

    function frame(now) {
      const elapsed = ((now - startRef.current) / 1000) % duration;
      for (const [layerKey, ref] of Object.entries(layerRefs)) {
        const el = ref.current;
        if (!el) continue;
        const { transform, filter } = computeFrameStyle(entry, layerKey, layerKey, elapsed, restRotations?.[layerKey] || 0);
        el.style.transform = transform;
        el.style.filter = filter;
      }
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
  }, [playing, entry, duration, restRotations]);

  return { duration };
}
