import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import CropTool from "../components/CropTool.jsx";
import { useAnimationLoop } from "../hooks/useAnimationLoop.js";
import { buildSpineSkeleton } from "../lib/spineSkeleton.js";
import { buildAtlas } from "../lib/atlasBuilder.js";
import { getSymbolWithAnimations, saveSymbolAnimation, deleteSymbolAnimation } from "../lib/symbolsRepository.js";
import { downloadSpinePackage, downloadAllAnimationsPackage } from "../lib/exportZip.js";

const ANIMATION_TYPES = [
  { key: "idle", label: "Idle", icon: "💤" },
  { key: "win", label: "Win", icon: "✨" },
  { key: "land", label: "Land", icon: "📍" },
  { key: "spinBlur", label: "SpinBlur", icon: "🌀" }
];

const SIZE_PRESETS = [
  [150, 150],
  [250, 250],
  [400, 400],
  [512, 512]
];

export default function SymbolPage() {
  const { id } = useParams();
  const [symbol, setSymbol] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [activeType, setActiveType] = useState("win");
  const [file, setFile] = useState(null);
  const [workingBlob, setWorkingBlob] = useState(null);
  const [workingUrl, setWorkingUrl] = useState(null);
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [naturalSize, setNaturalSize] = useState(null);
  const [speed, setSpeed] = useState(1);
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [playing, setPlaying] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getSymbolWithAnimations(id);
      setSymbol(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function handleCropped(blob, w, h) {
    setWorkingBlob(blob);
    setWorkingUrl(URL.createObjectURL(blob));
    setWidth(w);
    setHeight(h);
    setNaturalSize({ w, h });
    setFile(null); // chiude il crop tool
    setPlaying(false);
  }

  // Dati di animazione calcolati localmente (nessuna chiamata di rete: pure funzioni JS).
  // Memoizzato: senza useMemo l'oggetto cambierebbe identità a ogni render (anche solo
  // per l'aggiornamento dello style dell'anteprima), facendo ripartire il loop da zero
  // ad ogni fotogramma e bloccando visivamente l'animazione sulla posa iniziale.
  const previewData = useMemo(() => {
    if (!workingBlob || !width || !height) return null;
    return buildSpineSkeleton({
      symbolName: symbol?.name || "symbol",
      width: Number(width),
      height: Number(height),
      animationType: activeType,
      speed: Number(speed) || 1
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workingBlob, width, height, activeType, speed, symbol?.name]);

  const previewImgRef = useRef(null);
  const widthInputRef = useRef(null);

  const { duration: previewDuration } = useAnimationLoop({
    elementRef: previewImgRef,
    animationsObj: previewData?.animations,
    animationType: activeType,
    boneName: symbol?.name || "symbol",
    slotName: symbol?.name || "symbol",
    playing: playing && !!previewData
  });

  async function handleSave() {
    if (!workingBlob || !symbol) return;
    setSaving(true);
    setStatus("⏳ Salvataggio su Supabase in corso...");
    try {
      const w = Number(width);
      const h = Number(height);
      const skeletonJson = buildSpineSkeleton({
        symbolName: symbol.name,
        width: w,
        height: h,
        animationType: activeType,
        speed: Number(speed) || 1
      });
      const atlasText = buildAtlas({
        imageFileName: `${symbol.name}.png`,
        regionName: symbol.name,
        width: w,
        height: h
      });

      await saveSymbolAnimation({
        symbolId: symbol.id,
        animationType: activeType,
        imageBlob: workingBlob,
        width: w,
        height: h,
        speed: Number(speed) || 1,
        skeletonJson,
        atlasText
      });

      setStatus(`✅ Animazione "${activeType}" salvata.`);
      await refresh();
    } catch (err) {
      setStatus(`❌ Errore salvataggio: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleDownloadThis() {
    const existing = symbol?.animations.find((a) => a.animation_type === activeType);
    if (!existing) {
      setStatus("⚠️ Salva prima questa animazione per poterla scaricare.");
      return;
    }
    setStatus("⏳ Preparo il pacchetto...");
    try {
      await downloadSpinePackage({
        symbolName: symbol.name,
        animationType: activeType,
        imageUrl: existing.image_url,
        skeletonJson: existing.skeleton_json,
        atlasText: existing.atlas_text
      });
      setStatus("✅ Download avviato.");
    } catch (err) {
      setStatus(`❌ Errore download: ${err.message}`);
    }
  }

  async function handleDownloadAll() {
    if (!symbol?.animations?.length) {
      setStatus("⚠️ Nessuna animazione salvata da scaricare.");
      return;
    }
    setStatus("⏳ Preparo il pacchetto completo...");
    try {
      await downloadAllAnimationsPackage({ symbolName: symbol.name, animations: symbol.animations });
      setStatus("✅ Download avviato.");
    } catch (err) {
      setStatus(`❌ Errore download: ${err.message}`);
    }
  }

  async function handleDeleteAnimation(animationId) {
    if (!confirm("Eliminare questa variante di animazione?")) return;
    try {
      await deleteSymbolAnimation(animationId);
      await refresh();
    } catch (err) {
      setStatus(`❌ Errore eliminazione: ${err.message}`);
    }
  }

  function resetToNaturalSize() {
    if (naturalSize) {
      setWidth(naturalSize.w);
      setHeight(naturalSize.h);
    }
  }

  if (loading) return <div className="page status">⏳ Carico simbolo...</div>;
  if (error) return <div className="page status error">❌ {error}</div>;
  if (!symbol) return null;

  const savedForActiveType = symbol.animations.find((a) => a.animation_type === activeType);

  const isCustomSize = !SIZE_PRESETS.some(([pw, ph]) => Number(width) === pw && Number(height) === ph);

  return (
    <div className="page">
      <Link to="/symbols" className="back-link">← Tutti i simboli</Link>
      <h1>🍒 {symbol.name}</h1>

      <div className="anim-tabs">
        {ANIMATION_TYPES.map(({ key, label, icon }) => {
          const saved = symbol.animations.some((a) => a.animation_type === key);
          return (
            <div
              key={key}
              className={`anim-tab ${activeType === key ? "active-tab" : ""}`}
              onClick={() => {
                setActiveType(key);
                setPlaying(false);
              }}
            >
              {icon} {label}
              <span className="tab-status">{saved ? "salvata" : "—"}</span>
            </div>
          );
        })}
      </div>

      {savedForActiveType && !workingBlob && (
        <div className="saved-preview-box">
          <img src={savedForActiveType.image_url} alt={activeType} className="saved-preview-img" />
          <div className="hint">
            Animazione "{activeType}" già salvata ({savedForActiveType.width}×{savedForActiveType.height}px,
            velocità {savedForActiveType.speed}). Carica una nuova immagine per sostituirla, oppure scaricala qui sotto.
          </div>
          <div className="btn-row">
            <button className="btn secondary" onClick={handleDownloadThis}>
              ⬇ Scarica questa animazione
            </button>
            <button className="btn secondary danger" onClick={() => handleDeleteAnimation(savedForActiveType.id)}>
              🗑 Elimina
            </button>
          </div>
        </div>
      )}

      <label className="field-label">
        Immagine simbolo per "{activeType}" (PNG)
        <input
          type="file"
          accept="image/png"
          onChange={(e) => {
            setFile(e.target.files[0]);
            setWorkingBlob(null);
            setWorkingUrl(null);
          }}
        />
      </label>

      {file && <CropTool file={file} onDone={handleCropped} />}

      {workingBlob && (
        <>
          <div className="preview-stage">
            <span className="preview-badge">
              {playing ? `${activeType} · loop ${previewDuration.toFixed(2)}s` : "in pausa"}
            </span>
            <img ref={previewImgRef} src={workingUrl} alt="anteprima" className="preview-img" />
          </div>

          <div className="btn-row">
            <button type="button" className="btn secondary" onClick={() => setFile(null)}>
              ✂️ Rifai il ritaglio
            </button>
          </div>

          <div className="row">
            <label className="field-label">
              Larghezza (px)
              <input ref={widthInputRef} type="number" value={width} onChange={(e) => setWidth(e.target.value)} />
            </label>
            <label className="field-label">
              Altezza (px)
              <input type="number" value={height} onChange={(e) => setHeight(e.target.value)} />
            </label>
          </div>

          <div className="preset-row">
            {SIZE_PRESETS.map(([pw, ph]) => {
              const active = Number(width) === pw && Number(height) === ph;
              return (
                <button
                  key={`${pw}x${ph}`}
                  type="button"
                  className={`preset-chip ${active ? "preset-chip-active" : ""}`}
                  onClick={() => {
                    setWidth(pw);
                    setHeight(ph);
                  }}
                >
                  {pw}×{ph}
                </button>
              );
            })}
            <button
              type="button"
              className={`preset-chip ${isCustomSize ? "preset-chip-active" : ""}`}
              onClick={() => {
                // "Personalizzato": non forza nessun valore, permette di scrivere a mano
                // nei campi qui sopra. Serve solo a segnalare visivamente la modalità attiva
                // e a spostare il focus sul campo larghezza per iniziare subito a digitare.
                widthInputRef.current?.focus();
                widthInputRef.current?.select();
              }}
            >
              ✏️ Personalizzato
            </button>
          </div>

          <button type="button" className="btn secondary tiny" onClick={resetToNaturalSize}>
            ↺ Ripristina misure ritaglio
          </button>

          <label className="field-label">
            Velocità (1 = normale, 2 = doppia, 0.5 = metà)
            <input type="number" step="0.1" min="0.1" value={speed} onChange={(e) => setSpeed(e.target.value)} />
          </label>

          <div className="btn-row">
            <button type="button" className="btn secondary" onClick={() => setPlaying((p) => !p)}>
              {playing ? "⏸ Pausa anteprima" : "▶ Anteprima animazione"}
            </button>
            <button type="button" className="btn" onClick={handleSave} disabled={saving}>
              💾 Salva animazione "{activeType}"
            </button>
          </div>
        </>
      )}

      {status && <div className="status">{status}</div>}

      {symbol.animations.length > 0 && (
        <div className="download-all-row">
          <button type="button" className="btn secondary" onClick={handleDownloadAll}>
            ⬇ Scarica pacchetto completo ({symbol.animations.length}/4 animazioni)
          </button>
        </div>
      )}
    </div>
  );
}
