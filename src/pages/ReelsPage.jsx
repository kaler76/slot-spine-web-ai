import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { listSymbolsForReels } from "../lib/symbolsRepository.js";
import { listCharactersForReels } from "../lib/charactersRepository.js";
import { getLastAztecProject } from "../lib/appSettingsRepository.js";
import { totalDuration } from "../lib/animationPreview.js";
import { pickRandom } from "../lib/reelEngine.js";
import { playSpinStart, playReelStop, playWin } from "../lib/reelSound.js";
import ReelColumn from "../components/ReelColumn.jsx";

const REEL_COUNT_OPTIONS = [3, 5];
const DEFAULT_VISIBLE_ROWS = 3;
const NO_STAGE_CELL_SIZE = 150;
const WIN_HOLD_MS = 900;

function makeRestingCells(pool, count) {
  return Array.from({ length: count }, () => {
    const item = pickRandom(pool);
    return { item, activeType: item.kind === "character" ? null : "idle", playing: true };
  });
}

/**
 * Durata (ms) dell'animazione `animationType` per la riga appena atterrata: il massimo
 * fra i soli simboli (i character non hanno una fase "land" propria, si ignorano qui
 * — una riga può mescolare simboli e character, dato che ogni cella atterra a caso).
 */
function estimateDurationMs(landedItems, animationType) {
  let max = 0;
  for (const item of landedItems) {
    if (item.kind === "character") continue;
    const record = item.animations.find((a) => a.animation_type === animationType);
    const boneTrack = record?.skeleton_json?.animations?.[animationType]?.bones?.[item.name];
    if (boneTrack) max = Math.max(max, totalDuration(boneTrack) * 1000);
  }
  return max || (animationType === "win" ? 800 : 400);
}

/** Geometria dello stage (sfondo/cornice/rulli) dall'ultimo progetto aztec-preview importato, se presente e completa. */
function stageGeometryFrom(project) {
  const cfg = project?.cfg;
  if (!cfg?.doc?.w || !cfg?.doc?.h || !Array.isArray(cfg.reelX) || !cfg.reelX.length || !cfg.reelY || !cfg.cell || !cfg.rows) {
    return null;
  }
  return {
    docW: cfg.doc.w,
    docH: cfg.doc.h,
    cell: cfg.cell,
    rows: cfg.rows,
    reelX: cfg.reelX,
    reelY: cfg.reelY,
    frame: cfg.frame || null,
    bgUrl: project.assets?.bg || null,
    frameUrl: project.assets?.frame || null
  };
}

/**
 * Vista indipendente: compone in una scena a rulli i simboli e i character già
 * animati nelle sezioni "Simboli"/"Character" (idle in rotazione, land all'atterraggio,
 * win a richiesta). Se è stato importato un progetto aztec-preview, usa il suo sfondo,
 * la sua cornice e le coordinate reali dei rulli; altrimenti usa un riquadro semplice.
 */
export default function ReelsPage() {
  const [symbols, setSymbols] = useState(null);
  const [characters, setCharacters] = useState(null);
  const [stageProject, setStageProject] = useState(null);
  const [error, setError] = useState(null);
  const [reelsCount, setReelsCount] = useState(5);
  const [baseDuration, setBaseDuration] = useState(1600);
  const [stagger, setStagger] = useState(220);
  const [spinning, setSpinning] = useState(false);
  const [spinToken, setSpinToken] = useState(0);
  const [cellStates, setCellStates] = useState([]);
  const [winItemId, setWinItemId] = useState("");
  const [stageWidthPx, setStageWidthPx] = useState(0);

  const timersRef = useRef([]);
  const settledRef = useRef(0);
  const forcedRef = useRef(null);
  const stageRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const [symData, charData, lastProject] = await Promise.all([
          listSymbolsForReels(),
          listCharactersForReels(),
          getLastAztecProject()
        ]);
        setSymbols(symData.filter((s) => s.animations.length > 0).map((s) => ({ ...s, kind: "symbol" })));
        setCharacters(charData.filter((c) => c.parts.length > 0).map((c) => ({ ...c, kind: "character" })));
        setStageProject(lastProject);
      } catch (err) {
        setError(err.message);
      }
    })();
  }, []);

  const pool = [...(symbols || []), ...(characters || [])];
  const stageGeo = stageGeometryFrom(stageProject);
  const effectiveReelsCount = stageGeo ? stageGeo.reelX.length : reelsCount;
  const effectiveVisibleRows = stageGeo ? stageGeo.rows : DEFAULT_VISIBLE_ROWS;
  const stageScale = stageGeo && stageWidthPx ? stageWidthPx / stageGeo.docW : 0;
  const cellSize = stageGeo ? Math.round(stageGeo.cell * stageScale) : NO_STAGE_CELL_SIZE;

  useEffect(() => {
    if (!stageGeo || !stageRef.current) return;
    const el = stageRef.current;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setStageWidthPx(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!stageGeo]);

  useEffect(() => {
    if (pool.length === 0) return;
    setCellStates((prev) => Array.from({ length: effectiveReelsCount }, (_, i) => prev[i] || makeRestingCells(pool, effectiveVisibleRows)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool.length, effectiveReelsCount, effectiveVisibleRows]);

  useEffect(() => {
    return () => {
      timersRef.current.forEach(clearTimeout);
    };
  }, []);

  function clearTimers() {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }

  function startSpin(forceWinItem) {
    if (spinning || pool.length === 0 || (stageGeo && !cellSize)) return;
    clearTimers();
    settledRef.current = 0;
    forcedRef.current = forceWinItem || null;
    setSpinning(true);
    playSpinStart();
    setSpinToken((t) => t + 1);
  }

  function triggerWin() {
    playWin();
    setCellStates((prev) =>
      prev.map((col) =>
        col.map((cell) =>
          cell.item.kind === "symbol" && cell.item.animations.some((a) => a.animation_type === "win")
            ? { ...cell, activeType: "win", playing: true }
            : cell
        )
      )
    );
    const t = setTimeout(() => {
      setCellStates((prev) =>
        prev.map((col) => col.map((cell) => (cell.item.kind === "symbol" ? { ...cell, activeType: "idle", playing: true } : cell)))
      );
    }, WIN_HOLD_MS);
    timersRef.current.push(t);
  }

  function handleReelLanded(reelIndex, landedItems) {
    playReelStop();

    setCellStates((prev) => {
      const next = prev.slice();
      next[reelIndex] = landedItems.map((item) => ({ item, activeType: item.kind === "character" ? null : "land", playing: true }));
      return next;
    });

    const landMs = estimateDurationMs(landedItems, "land");
    const t = setTimeout(() => {
      setCellStates((prev) => {
        const next = prev.slice();
        next[reelIndex] = landedItems.map((item) => ({ item, activeType: item.kind === "character" ? null : "idle", playing: true }));
        return next;
      });
      settledRef.current += 1;
      if (settledRef.current === effectiveReelsCount) {
        setSpinning(false);
        if (forcedRef.current) triggerWin();
      }
    }, landMs);
    timersRef.current.push(t);
  }

  const winItem = pool.find((it) => it.id === winItemId) || null;

  if (error) return <div className="page status error">❌ {error}</div>;
  if (!symbols || !characters) return <div className="page status">⏳ Carico simboli e character...</div>;

  return (
    <div className="page">
      <Link to="/" className="back-link">← Home</Link>
      <h1>🎰 Rulli animati</h1>
      <div className="subtitle">
        Compone in una scena a rulli i simboli e i character già animati — vista indipendente, senza legami con
        l'anteprima statica di Aztec.
        {stageGeo ? (
          <> Sfondo e cornice presi dal progetto <strong>{stageProject.name}</strong> (ultimo importato).</>
        ) : (
          <> Nessun progetto aztec importato ancora: riquadro semplice finché non ne importi uno da <Link to="/import-aztec">Importa da Aztec</Link>.</>
        )}
      </div>

      {pool.length === 0 ? (
        <div className="hint">
          Nessun simbolo o character pronto. Vai su <Link to="/symbols">Simboli</Link> o{" "}
          <Link to="/characters">Character</Link> e prepara almeno un elemento animato.
        </div>
      ) : (
        <>
          <div className="row reels-controls">
            {!stageGeo && (
              <label className="field-label">
                Rulli
                <select value={reelsCount} onChange={(e) => setReelsCount(Number(e.target.value))} disabled={spinning}>
                  {REEL_COUNT_OPTIONS.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </label>
            )}
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

          {stageGeo ? (
            <div className="reel-stage" ref={stageRef} style={{ aspectRatio: `${stageGeo.docW} / ${stageGeo.docH}` }}>
              {stageGeo.bgUrl && <img src={stageGeo.bgUrl} alt="" className="reel-stage-bg" />}
              {stageScale > 0 &&
                stageGeo.reelX.map((x, i) => (
                  <div
                    key={i}
                    className="reel-stage-reel-slot"
                    style={{
                      left: Math.round(x * stageScale),
                      top: Math.round(stageGeo.reelY * stageScale),
                      width: cellSize,
                      height: cellSize * stageGeo.rows
                    }}
                  >
                    <ReelColumn
                      pool={pool}
                      visibleRows={stageGeo.rows}
                      spinToken={spinToken}
                      duration={baseDuration + i * stagger}
                      forcedResult={forcedRef.current ? Array(stageGeo.rows).fill(forcedRef.current) : null}
                      onLanded={(landed) => handleReelLanded(i, landed)}
                      cells={cellStates[i] || []}
                      cellSize={cellSize}
                    />
                  </div>
                ))}
              {stageGeo.frameUrl && <img src={stageGeo.frameUrl} alt="" className="reel-stage-frame" />}
            </div>
          ) : (
            <div className="reel-frame" style={{ height: NO_STAGE_CELL_SIZE * effectiveVisibleRows, width: NO_STAGE_CELL_SIZE * reelsCount }}>
              {Array.from({ length: reelsCount }).map((_, i) => (
                <ReelColumn
                  key={i}
                  pool={pool}
                  visibleRows={DEFAULT_VISIBLE_ROWS}
                  spinToken={spinToken}
                  duration={baseDuration + i * stagger}
                  forcedResult={forcedRef.current ? Array(DEFAULT_VISIBLE_ROWS).fill(forcedRef.current) : null}
                  onLanded={(landed) => handleReelLanded(i, landed)}
                  cells={cellStates[i] || []}
                  cellSize={NO_STAGE_CELL_SIZE}
                />
              ))}
            </div>
          )}

          <div className="btn-row">
            <button type="button" className="btn" onClick={() => startSpin(null)} disabled={spinning}>
              🎰 Gira
            </button>
          </div>

          <div className="row">
            <label className="field-label">
              Test vincita (forza tutti i rulli su un elemento)
              <select value={winItemId} onChange={(e) => setWinItemId(e.target.value)} disabled={spinning}>
                <option value="">— scegli simbolo o character —</option>
                {(symbols || []).length > 0 && (
                  <optgroup label="Simboli">
                    {symbols.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </optgroup>
                )}
                {(characters || []).length > 0 && (
                  <optgroup label="Character">
                    {characters.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>
          </div>
          <div className="btn-row">
            <button type="button" className="btn secondary" onClick={() => winItem && startSpin(winItem)} disabled={spinning || !winItem}>
              🎉 Gira e vinci con "{winItem?.name || "..."}"
            </button>
          </div>

          {spinning && <div className="status">⏳ Girando...</div>}
        </>
      )}
    </div>
  );
}
