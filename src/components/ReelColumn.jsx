import { useEffect, useMemo, useRef, useState } from "react";
import { useAnimationLoop } from "../hooks/useAnimationLoop.js";
import { buildStrip, easeOutQuart } from "../lib/reelEngine.js";

export const SYMBOL_SIZE = 150;
const STRIP_LEN = 22;

/** Immagine da mostrare per un simbolo fermo: preferisce "idle", altrimenti la prima animazione salvata. */
function restingImage(symbol) {
  return symbol.animations.find((a) => a.animation_type === "idle")?.image_url || symbol.animations[0]?.image_url;
}

/**
 * Una cella di simbolo ferma (a riposo, in atterraggio o in vincita): riusa lo stesso
 * motore di anteprima della pagina Simbolo (useAnimationLoop + skeleton salvato).
 */
function ReelCell({ symbol, activeType, playing }) {
  const imgRef = useRef(null);

  const animationsObj = useMemo(() => {
    const obj = {};
    for (const a of symbol.animations) {
      const anim = a.skeleton_json?.animations?.[a.animation_type];
      if (anim) obj[a.animation_type] = anim;
    }
    return obj;
  }, [symbol.animations]);

  const record =
    symbol.animations.find((a) => a.animation_type === activeType) ||
    symbol.animations.find((a) => a.animation_type === "idle") ||
    symbol.animations[0];

  useAnimationLoop({
    elementRef: imgRef,
    animationsObj,
    animationType: activeType,
    boneName: symbol.name,
    slotName: symbol.name,
    playing: playing && !!animationsObj[activeType]
  });

  return (
    <div className="reel-cell" style={{ height: SYMBOL_SIZE }}>
      <img ref={imgRef} src={record?.image_url} alt={symbol.name} className="reel-symbol-img" />
    </div>
  );
}

/**
 * Un singolo rullo: mostra `cells` a riposo (o in land/win, controllato dal genitore)
 * finché `spinToken` non cambia, poi fa scorrere uno striscione casuale di simboli
 * e si ferma esattamente sul risultato scelto, notificando il genitore con `onLanded`.
 */
export default function ReelColumn({ pool, visibleRows, spinToken, duration, forcedResult, onLanded, cells }) {
  const trackRef = useRef(null);
  const [spinningNow, setSpinningNow] = useState(false);
  const [renderStrip, setRenderStrip] = useState([]);
  const isFirstRender = useRef(true);

  useEffect(() => {
    // Al montaggio spinToken è già valorizzato: non deve far partire uno spin da solo.
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    const strip = buildStrip(pool, visibleRows, STRIP_LEN, forcedResult);
    setRenderStrip(strip);
    setSpinningNow(true);

    const totalDistance = (STRIP_LEN - visibleRows) * SYMBOL_SIZE;
    const start = performance.now();
    let raf;

    function frame(now) {
      const t = Math.min(1, (now - start) / duration);
      const offset = easeOutQuart(t) * totalDistance;
      if (trackRef.current) trackRef.current.style.transform = `translateY(-${offset}px)`;
      if (t < 1) {
        raf = requestAnimationFrame(frame);
      } else {
        setSpinningNow(false);
        onLanded(strip.slice(STRIP_LEN - visibleRows));
      }
    }
    raf = requestAnimationFrame(frame);

    return () => raf && cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spinToken]);

  return (
    <div className="reel-col" style={{ height: SYMBOL_SIZE * visibleRows }}>
      {spinningNow ? (
        <div key="spinning" ref={trackRef} className="reel-track">
          {renderStrip.map((symbol, i) => (
            <div key={i} className="reel-cell" style={{ height: SYMBOL_SIZE }}>
              <img src={restingImage(symbol)} alt={symbol.name} className="reel-symbol-img" />
            </div>
          ))}
        </div>
      ) : (
        <div key="resting" className="reel-track reel-track-resting">
          {cells.map((cell, i) => (
            <ReelCell key={i} symbol={cell.symbol} activeType={cell.activeType} playing={cell.playing} />
          ))}
        </div>
      )}
    </div>
  );
}
