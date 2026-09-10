import { useEffect, useMemo, useRef, useState } from "react";
import { useAnimationLoop } from "../hooks/useAnimationLoop.js";
import { buildStrip, easeOutQuart } from "../lib/reelEngine.js";
import CharacterSprite from "./CharacterSprite.jsx";

const STRIP_LEN = 22;

/** Immagine da mostrare per un simbolo fermo durante lo scorrimento veloce (blur): niente animazione, solo un'anteprima statica. */
function restingImage(item) {
  return item.animations.find((a) => a.animation_type === "idle")?.image_url || item.animations[0]?.image_url;
}

/**
 * Una cella ferma (a riposo, in atterraggio o in vincita): per un simbolo riusa lo
 * stesso motore di anteprima della pagina Simbolo (useAnimationLoop + skeleton
 * salvato); per un character compone tutte le sue parti con CharacterSprite.
 */
function ReelCell({ item, activeType, playing, size, tallSpan = 1 }) {
  const imgRef = useRef(null);
  const cellHeight = size * tallSpan;

  const animationsObj = useMemo(() => {
    if (item.kind === "character") return null;
    const obj = {};
    for (const a of item.animations) {
      const anim = a.skeleton_json?.animations?.[a.animation_type];
      if (anim) obj[a.animation_type] = anim;
    }
    return obj;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.kind, item.animations]);

  const record =
    item.kind === "symbol"
      ? item.animations.find((a) => a.animation_type === activeType) ||
        item.animations.find((a) => a.animation_type === "idle") ||
        item.animations[0]
      : null;

  useAnimationLoop({
    elementRef: imgRef,
    animationsObj: animationsObj || {},
    animationType: activeType,
    boneName: item.name,
    slotName: item.name,
    playing: item.kind === "symbol" && playing && !!animationsObj?.[activeType]
  });

  if (item.kind === "character") {
    return (
      <div className="reel-cell" style={{ height: cellHeight }}>
        <CharacterSprite
          character={item}
          boxWidth={Math.round(size * 0.86)}
          boxHeight={Math.round(cellHeight * 0.9)}
          playing={playing}
        />
      </div>
    );
  }

  return (
    <div className="reel-cell" style={{ height: cellHeight }}>
      <img ref={imgRef} src={record?.image_url} alt={item.name} className="reel-symbol-img" />
    </div>
  );
}

/**
 * Vero quando tutte le celle a riposo/atterrate sono lo stesso elemento "tall" che
 * copre l'intera altezza visibile: in quel caso va disegnato una volta sola, grande,
 * invece che come N copie identiche schiacciate una sopra l'altra.
 */
function isUniformTallLanding(cells) {
  if (!cells.length) return false;
  const first = cells[0].item;
  if ((first.tallSpan || 1) < cells.length) return false;
  return cells.every((c) => c.item === first);
}

/**
 * Un singolo rullo: mostra `cells` a riposo (o in land/win, controllato dal genitore)
 * finché `spinToken` non cambia, poi fa scorrere uno striscione casuale di simboli/
 * character e si ferma esattamente sul risultato scelto, notificando il genitore con
 * `onLanded`. `cellSize` è la dimensione in px di una cella, misurata dal genitore.
 */
export default function ReelColumn({ pool, visibleRows, spinToken, duration, forcedResult, onLanded, cells, cellSize }) {
  const trackRef = useRef(null);
  const [spinningNow, setSpinningNow] = useState(false);
  const [renderStrip, setRenderStrip] = useState([]);
  // Valore di spinToken all'ultimo spin effettivamente avviato, non solo "primo render sì/no":
  // così la guardia resta corretta anche se l'effetto viene invocato due volte allo stesso
  // render (es. React StrictMode in sviluppo), invece di un semplice flag consumato al volo.
  const lastSpinTokenRef = useRef(spinToken);

  useEffect(() => {
    if (lastSpinTokenRef.current === spinToken) return; // spinToken invariato: nessuno spin da avviare
    lastSpinTokenRef.current = spinToken;

    const strip = buildStrip(pool, visibleRows, STRIP_LEN, forcedResult);
    setRenderStrip(strip);
    setSpinningNow(true);

    // Il rullo scorre verso il basso (come uno vero: i simboli entrano dall'alto e
    // scendono), quindi si parte mostrando il fondo dello striscione (riempimento,
    // translateY molto negativo) e si arriva a translateY 0 — cioè l'inizio dello
    // striscione, dove buildStrip mette le righe finali.
    const totalDistance = (STRIP_LEN - visibleRows) * cellSize;
    const start = performance.now();
    let raf;

    function frame(now) {
      const t = Math.min(1, (now - start) / duration);
      const offset = totalDistance * (1 - easeOutQuart(t));
      if (trackRef.current) trackRef.current.style.transform = `translateY(-${offset}px)`;
      if (t < 1) {
        raf = requestAnimationFrame(frame);
      } else {
        setSpinningNow(false);
        onLanded(strip.slice(0, visibleRows));
      }
    }
    raf = requestAnimationFrame(frame);

    return () => raf && cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spinToken]);

  return (
    <div className="reel-col" style={{ height: cellSize * visibleRows }}>
      {spinningNow ? (
        <div
          key="spinning"
          ref={trackRef}
          className="reel-track"
          style={{ transform: `translateY(-${(STRIP_LEN - visibleRows) * cellSize}px)` }}
        >
          {/* Posizione iniziale coerente con t=0 nel loop (frame di riempimento in fondo
              allo striscione): senza questo il primo frame disegnato dal browser, prima
              che parta requestAnimationFrame, mostrerebbe per un istante translateY 0
              (le righe finali, in cima allo striscione) invece del riempimento. */}
          {renderStrip.map((item, i) => (
            <div key={i} className="reel-cell" style={{ height: cellSize }}>
              {item.kind === "character" ? (
                // Un character non ha un'unica immagine "di riposo": va composto per intero
                // (in posa statica, senza animazione) invece di mostrare una sua singola
                // parte isolata (es. i soli capelli), che apparirebbe fuori scala e senza senso.
                <CharacterSprite
                  character={item}
                  boxWidth={Math.round(cellSize * 0.86)}
                  boxHeight={Math.round(cellSize * 0.9)}
                  playing={false}
                />
              ) : (
                <img src={restingImage(item)} alt={item.name} className="reel-symbol-img" />
              )}
            </div>
          ))}
        </div>
      ) : (
        <div key="resting" className="reel-track reel-track-resting">
          {isUniformTallLanding(cells) ? (
            <ReelCell item={cells[0].item} activeType={cells[0].activeType} playing={cells[0].playing} size={cellSize} tallSpan={cells.length} />
          ) : (
            cells.map((cell, i) => <ReelCell key={i} item={cell.item} activeType={cell.activeType} playing={cell.playing} size={cellSize} />)
          )}
        </div>
      )}
    </div>
  );
}
