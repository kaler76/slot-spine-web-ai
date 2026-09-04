import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { listSymbolsForReels } from "../lib/symbolsRepository.js";
import { totalDuration } from "../lib/animationPreview.js";
import { pickRandom } from "../lib/reelEngine.js";
import { playSpinStart, playReelStop, playWin } from "../lib/reelSound.js";
import ReelColumn, { SYMBOL_SIZE } from "../components/ReelColumn.jsx";

const REEL_COUNT_OPTIONS = [3, 5];
const VISIBLE_ROWS = 3;
const WIN_HOLD_MS = 900;

function makeRestingCells(pool, count) {
  return Array.from({ length: count }, () => ({ symbol: pickRandom(pool), activeType: "idle", playing: true }));
}

/** Durata (ms) dell'animazione `animationType` per la riga appena atterrata: il massimo fra i 3 simboli. */
function estimateDurationMs(landedSymbols, animationType) {
  let max = 0;
  for (const symbol of landedSymbols) {
    const record = symbol.animations.find((a) => a.animation_type === animationType);
    const boneTrack = record?.skeleton_json?.animations?.[animationType]?.bones?.[symbol.name];
    if (boneTrack) max = Math.max(max, totalDuration(boneTrack) * 1000);
  }
  return max || (animationType === "win" ? 800 : 400);
}

/**
 * Vista indipendente: compone in una scena a rulli i simboli già animati nella
 * sezione "Simboli" (idle in rotazione, land all'atterraggio, win a richiesta).
 * Non ha alcun legame con l'anteprima statica di Aztec — è una pipeline propria
 * che riusa solo il motore di animazione (skeleton + useAnimationLoop) già esistente.
 */
export default function ReelsPage() {
  const [symbols, setSymbols] = useState(null);
  const [error, setError] = useState(null);
  const [reelsCount, setReelsCount] = useState(5);
  const [baseDuration, setBaseDuration] = useState(1600);
  const [stagger, setStagger] = useState(220);
  const [spinning, setSpinning] = useState(false);
  const [spinToken, setSpinToken] = useState(0);
  const [cellStates, setCellStates] = useState([]);
  const [winSymbolId, setWinSymbolId] = useState("");

  const timersRef = useRef([]);
  const settledRef = useRef(0);
  const forcedRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await listSymbolsForReels();
        setSymbols(data.filter((s) => s.animations.length > 0));
      } catch (err) {
        setError(err.message);
      }
    })();
  }, []);

  const pool = symbols || [];

  useEffect(() => {
    if (pool.length === 0) return;
    setCellStates((prev) => Array.from({ length: reelsCount }, (_, i) => prev[i] || makeRestingCells(pool, VISIBLE_ROWS)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool.length, reelsCount]);

  useEffect(() => {
    return () => {
      timersRef.current.forEach(clearTimeout);
    };
  }, []);

  function clearTimers() {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }

  function startSpin(forceWinSymbol) {
    if (spinning || pool.length === 0) return;
    clearTimers();
    settledRef.current = 0;
    forcedRef.current = forceWinSymbol || null;
    setSpinning(true);
    playSpinStart();
    setSpinToken((t) => t + 1);
  }

  function triggerWin() {
    playWin();
    setCellStates((prev) =>
      prev.map((col) =>
        col.map((cell) => (cell.symbol.animations.some((a) => a.animation_type === "win") ? { ...cell, activeType: "win", playing: true } : cell))
      )
    );
    const t = setTimeout(() => {
      setCellStates((prev) => prev.map((col) => col.map((cell) => ({ ...cell, activeType: "idle", playing: true }))));
    }, WIN_HOLD_MS);
    timersRef.current.push(t);
  }

  function handleReelLanded(reelIndex, landedSymbols) {
    playReelStop();
    setCellStates((prev) => {
      const next = prev.slice();
      next[reelIndex] = landedSymbols.map((symbol) => ({ symbol, activeType: "land", playing: true }));
      return next;
    });

    const landMs = estimateDurationMs(landedSymbols, "land");
    const t = setTimeout(() => {
      setCellStates((prev) => {
        const next = prev.slice();
        next[reelIndex] = landedSymbols.map((symbol) => ({ symbol, activeType: "idle", playing: true }));
        return next;
      });
      settledRef.current += 1;
      if (settledRef.current === reelsCount) {
        setSpinning(false);
        if (forcedRef.current) triggerWin();
      }
    }, landMs);
    timersRef.current.push(t);
  }

  const winSymbol = pool.find((s) => s.id === winSymbolId) || null;

  if (error) return <div className="page status error">❌ {error}</div>;
  if (!symbols) return <div className="page status">⏳ Carico simboli...</div>;

  return (
    <div className="page">
      <Link to="/" className="back-link">← Home</Link>
      <h1>🎰 Rulli animati</h1>
      <div className="subtitle">
        Compone in una scena a rulli i simboli già ritagliati e animati nella sezione Simboli — vista indipendente,
        senza legami con l'anteprima statica di Aztec.
      </div>

      {pool.length === 0 ? (
        <div className="hint">
          Nessun simbolo con animazioni salvate. Vai su <Link to="/symbols">Simboli</Link> e creane almeno uno
          (idle + land consigliati, win opzionale per il test vincita).
        </div>
      ) : (
        <>
          <div className="row reels-controls">
            <label className="field-label">
              Rulli
              <select value={reelsCount} onChange={(e) => setReelsCount(Number(e.target.value))} disabled={spinning}>
                {REEL_COUNT_OPTIONS.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
            <label className="field-label">
              Velocità base
              <input
                type="range"
                min="700"
                max="3000"
                step="50"
                value={baseDuration}
                onChange={(e) => setBaseDuration(Number(e.target.value))}
                disabled={spinning}
              />
              <span className="range-value">{baseDuration}ms</span>
            </label>
            <label className="field-label">
              Sfasamento fra rulli
              <input
                type="range"
                min="0"
                max="500"
                step="10"
                value={stagger}
                onChange={(e) => setStagger(Number(e.target.value))}
                disabled={spinning}
              />
              <span className="range-value">{stagger}ms</span>
            </label>
          </div>

          <div className="reel-frame" style={{ height: SYMBOL_SIZE * VISIBLE_ROWS, width: SYMBOL_SIZE * reelsCount }}>
            {Array.from({ length: reelsCount }).map((_, i) => (
              <ReelColumn
                key={i}
                pool={pool}
                visibleRows={VISIBLE_ROWS}
                spinToken={spinToken}
                duration={baseDuration + i * stagger}
                forcedResult={forcedRef.current ? Array(VISIBLE_ROWS).fill(forcedRef.current) : null}
                onLanded={(landed) => handleReelLanded(i, landed)}
                cells={cellStates[i] || []}
              />
            ))}
          </div>

          <div className="btn-row">
            <button type="button" className="btn" onClick={() => startSpin(null)} disabled={spinning}>
              🎰 Gira
            </button>
          </div>

          <div className="row">
            <label className="field-label">
              Test vincita (forza tutti i rulli su un simbolo)
              <select value={winSymbolId} onChange={(e) => setWinSymbolId(e.target.value)} disabled={spinning}>
                <option value="">— scegli un simbolo —</option>
                {pool.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="btn-row">
            <button type="button" className="btn secondary" onClick={() => winSymbol && startSpin(winSymbol)} disabled={spinning || !winSymbol}>
              🎉 Gira e vinci con "{winSymbol?.name || "..."}"
            </button>
          </div>

          {spinning && <div className="status">⏳ Girando...</div>}
        </>
      )}
    </div>
  );
}
