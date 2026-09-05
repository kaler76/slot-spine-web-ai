import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { listSymbolsForReels } from "../lib/symbolsRepository.js";
import { listCharactersForReels } from "../lib/charactersRepository.js";
import { getLastAztecProject } from "../lib/appSettingsRepository.js";
import { extractAztecSymbols } from "../lib/aztecImport.js";
import { totalDuration } from "../lib/animationPreview.js";
import { pickFinalRows } from "../lib/reelEngine.js";
import { playSpinStart, playReelStop, playWin } from "../lib/reelSound.js";
import ReelColumn from "../components/ReelColumn.jsx";

const WIN_HOLD_MS = 900;

function makeRestingCells(pool, count) {
  return pickFinalRows(pool, count, null).map((item) => ({
    item,
    activeType: item.kind === "character" ? null : "idle",
    playing: true
  }));
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

/** Geometria dello stage (sfondo/cornice/rulli) dell'ultimo progetto aztec-preview importato, se completa. */
function stageGeometryFrom(project) {
  const cfg = project?.cfg;
  if (!cfg?.doc?.w || !cfg?.doc?.h || !Array.isArray(cfg.reelX) || !cfg.reelX.length || !cfg.reelY || !cfg.cell || !cfg.rows) {
    return null;
  }
  // La cornice va posizionata/dimensionata sul suo rettangolo reale (cfg.frame), non
  // stirata su tutto il documento: altrimenti copre i rulli invece di incorniciarli
  // (vedi aztec-preview/rulli.html, dove .frame vive dentro un div "game" ritagliato
  // esattamente su cfg.frame). Senza cfg.frame, meglio l'intero documento come prima.
  const f = cfg.frame;
  const frameRect =
    f && Number.isFinite(f.x) && Number.isFinite(f.y) && f.w && f.h
      ? { x: f.x, y: f.y, w: f.w, h: f.h }
      : { x: 0, y: 0, w: cfg.doc.w, h: cfg.doc.h };
  return {
    docW: cfg.doc.w,
    docH: cfg.doc.h,
    cell: cfg.cell,
    rows: cfg.rows,
    reelX: cfg.reelX,
    reelY: cfg.reelY,
    frameRect,
    bgUrl: project.assets?.bg || null,
    frameUrl: project.assets?.frame || null
  };
}

/** Nomi dei simboli che appartengono al progetto aztec (stessa logica di ImportAztecPage: nome = cfg.names[key] || key). */
function projectSymbolNames(project) {
  return new Set(extractAztecSymbols(project).map((s) => s.name));
}

/**
 * Vista indipendente: compone in una scena a rulli SOLO i simboli/character che
 * appartengono all'ultimo progetto aztec-preview importato (stesso sfondo, cornice e
 * coordinate reali dei rulli) — mai un mix con altri simboli/character presenti nel
 * database ma di altri progetti o test.
 */
export default function ReelsPage() {
  const [loading, setLoading] = useState(true);
  const [symbols, setSymbols] = useState([]);
  const [characters, setCharacters] = useState([]);
  const [stageProject, setStageProject] = useState(null);
  const [error, setError] = useState(null);
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
        const lastProject = await getLastAztecProject();
        if (!lastProject) {
          setStageProject(null);
          setLoading(false);
          return;
        }
        const [symData, charData] = await Promise.all([listSymbolsForReels(), listCharactersForReels()]);
        const validNames = projectSymbolNames(lastProject);
        const tallMap = lastProject.cfg?.tall || {};
        setSymbols(
          symData
            .filter((s) => s.animations.length > 0 && validNames.has(s.name))
            .map((s) => ({ ...s, kind: "symbol", tallSpan: tallMap[s.name] || 1 }))
        );
        setCharacters(
          charData
            .filter((c) => c.parts.length > 0 && validNames.has(c.name))
            .map((c) => ({ ...c, kind: "character", tallSpan: tallMap[c.name] || 1 }))
        );
        setStageProject(lastProject);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const pool = [...symbols, ...characters];
  const stageGeo = stageGeometryFrom(stageProject);
  const stageScale = stageGeo && stageWidthPx ? stageWidthPx / stageGeo.docW : 0;
  const cellSize = stageGeo ? Math.round(stageGeo.cell * stageScale) : 0;

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
    if (!stageGeo || pool.length === 0) return;
    setCellStates((prev) => Array.from({ length: stageGeo.reelX.length }, (_, i) => prev[i] || makeRestingCells(pool, stageGeo.rows)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool.length, stageGeo?.reelX.length, stageGeo?.rows]);

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
    if (spinning || pool.length === 0 || !cellSize) return;
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
      if (settledRef.current === stageGeo.reelX.length) {
        setSpinning(false);
        if (forcedRef.current) triggerWin();
      }
    }, landMs);
    timersRef.current.push(t);
  }

  const winItem = pool.find((it) => it.id === winItemId) || null;

  if (error) return <div className="page status error">❌ {error}</div>;
  if (loading) return <div className="page status">⏳ Carico il progetto...</div>;

  if (!stageGeo) {
    return (
      <div className="page">
        <Link to="/" className="back-link">← Home</Link>
        <h1>🎰 Rulli animati</h1>
        <div className="subtitle">
          Compone in una scena a rulli i simboli e i character del progetto aztec-preview importato, sul suo sfondo e
          la sua cornice reali.
        </div>
        <div className="hint">
          Nessun progetto aztec importato ancora. Vai su <Link to="/import-aztec">Importa da Aztec</Link>, cerca il tuo
          progetto e importa i simboli: questa pagina userà automaticamente quel progetto (sfondo, cornice e rulli
          inclusi).
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <Link to="/" className="back-link">← Home</Link>
      <h1>🎰 Rulli animati</h1>
      <div className="subtitle">
        Sfondo, cornice e simboli/character presi dal progetto <strong>{stageProject.name}</strong> (ultimo importato
        da Aztec) — solo gli elementi di questo progetto, niente altro.
      </div>

      {pool.length === 0 ? (
        <div className="hint">
          Il progetto <strong>{stageProject.name}</strong> non ha ancora nessun simbolo animato (idle/land/win). Vai
          su <Link to="/symbols">Simboli</Link> e crea almeno un'animazione per uno dei simboli importati.
        </div>
      ) : (
        <>
          <div className="row reels-controls">
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

          <div className="reel-stage" ref={stageRef} style={{ aspectRatio: `${stageGeo.docW} / ${stageGeo.docH}` }}>
            {stageGeo.bgUrl && <img src={stageGeo.bgUrl} alt="" className="reel-stage-bg" />}
            {stageScale > 0 && stageGeo.frameUrl && (
              <img
                src={stageGeo.frameUrl}
                alt=""
                className="reel-stage-frame"
                style={{
                  left: Math.round(stageGeo.frameRect.x * stageScale),
                  top: Math.round(stageGeo.frameRect.y * stageScale),
                  width: Math.round(stageGeo.frameRect.w * stageScale),
                  height: Math.round(stageGeo.frameRect.h * stageScale)
                }}
              />
            )}
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
          </div>

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
                {symbols.length > 0 && (
                  <optgroup label="Simboli">
                    {symbols.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </optgroup>
                )}
                {characters.length > 0 && (
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
