import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import CropTool from "../components/CropTool.jsx";
import { useBackgroundAnimationLoop } from "../hooks/useBackgroundAnimationLoop.js";
import { buildBackgroundSkeleton } from "../lib/backgroundSkeleton.js";
import { buildMultiPartAtlas } from "../lib/atlasBuilder.js";
import { AVAILABLE_LAYER_ANIMATION_TYPES } from "../lib/backgroundAnimationTemplates.js";
import {
  getBackgroundWithDetails,
  saveBackgroundLayer,
  deleteBackgroundLayer,
  updateBackgroundLayerMetadata,
  updateBackgroundCanvas,
  saveBackgroundExport
} from "../lib/backgroundsRepository.js";
import { downloadBackgroundPackage } from "../lib/exportZip.js";

const ANIM_LABELS = {
  static: "⏸️ Fermo",
  parallaxLoop: "↔️ Parallax",
  sway: "🎐 Oscillazione",
  pulse: "💡 Pulsante"
};

const CANVAS_PRESETS = [
  { label: "1024×768 (4:3)", w: 1024, h: 768 },
  { label: "1920×1080 (16:9 Full HD)", w: 1920, h: 1080 },
  { label: "1280×720 (16:9 HD)", w: 1280, h: 720 }
];

function sanitizeKey(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export default function BackgroundPage() {
  const { id } = useParams();
  const [background, setBackground] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [layerName, setLayerName] = useState("");
  const [file, setFile] = useState(null);
  const [workingBlob, setWorkingBlob] = useState(null);
  const [workingUrl, setWorkingUrl] = useState(null);
  const [zIndex, setZIndex] = useState(0);
  const [animationType, setAnimationType] = useState("static");
  const [layerSpeed, setLayerSpeed] = useState(1);
  const [savingLayer, setSavingLayer] = useState(false);
  const [status, setStatus] = useState("");

  const [playing, setPlaying] = useState(false);
  const [savingExport, setSavingExport] = useState(false);

  const [editingCanvas, setEditingCanvas] = useState(false);
  const [canvasW, setCanvasW] = useState(1920);
  const [canvasH, setCanvasH] = useState(1080);
  const [savingCanvas, setSavingCanvas] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getBackgroundWithDetails(id);
      setBackground(data);
      setCanvasW(data.canvas_width);
      setCanvasH(data.canvas_height);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleSaveCanvas() {
    setSavingCanvas(true);
    setStatus("⏳ Aggiornamento risoluzione canvas...");
    try {
      await updateBackgroundCanvas(background.id, { canvasWidth: Number(canvasW), canvasHeight: Number(canvasH) });
      setStatus(`✅ Risoluzione canvas impostata a ${canvasW}×${canvasH}px.`);
      setEditingCanvas(false);
      await refresh();
    } catch (err) {
      setStatus(`❌ Errore aggiornamento canvas: ${err.message}`);
    } finally {
      setSavingCanvas(false);
    }
  }

  function handleCropped(blob) {
    setWorkingBlob(blob);
    setWorkingUrl(URL.createObjectURL(blob));
    setFile(null);
  }

  function resetLayerForm() {
    setLayerName("");
    setFile(null);
    setWorkingBlob(null);
    setWorkingUrl(null);
    setZIndex((background?.layers.length || 0) * 10);
    setAnimationType("static");
    setLayerSpeed(1);
  }

  async function handleSaveLayer() {
    const key = sanitizeKey(layerName);
    if (!key) {
      setStatus("⚠️ Dai un nome al layer (es. sky, clouds, glow_sign).");
      return;
    }
    if (!workingBlob) {
      setStatus("⚠️ Carica e ritaglia un'immagine per questo layer.");
      return;
    }
    setSavingLayer(true);
    setStatus("⏳ Salvataggio layer in corso...");
    try {
      // Il layer viene sempre salvato con le dimensioni del canvas del background:
      // ogni layer copre l'intero frame, indipendentemente dalla risoluzione originale del file caricato.
      await saveBackgroundLayer({
        backgroundId: background.id,
        layerKey: key,
        imageBlob: workingBlob,
        width: background.canvas_width,
        height: background.canvas_height,
        zIndex: Number(zIndex) || 0,
        animationType,
        speed: Number(layerSpeed) || 1
      });
      setStatus(`✅ Layer "${key}" salvato (adattato a ${background.canvas_width}×${background.canvas_height}px).`);
      resetLayerForm();
      await refresh();
    } catch (err) {
      setStatus(`❌ Errore salvataggio layer: ${err.message}`);
    } finally {
      setSavingLayer(false);
    }
  }

  async function handleDeleteLayer(layerId) {
    if (!confirm("Eliminare questo layer?")) return;
    try {
      await deleteBackgroundLayer(layerId);
      await refresh();
    } catch (err) {
      setStatus(`❌ Errore eliminazione layer: ${err.message}`);
    }
  }

  // --- Editing inline dei layer esistenti ---
  const [editingLayerId, setEditingLayerId] = useState(null);
  const [editLayerValues, setEditLayerValues] = useState({ zIndex: 0, animationType: "static", speed: 1 });
  const [savingLayerEdit, setSavingLayerEdit] = useState(false);

  function startEditingLayer(l) {
    setEditingLayerId(l.id);
    setEditLayerValues({ zIndex: l.z_index ?? 0, animationType: l.animation_type, speed: l.speed });
  }

  function cancelEditingLayer() {
    setEditingLayerId(null);
  }

  async function saveEditingLayer(layerId, layerKey) {
    setSavingLayerEdit(true);
    setStatus(`⏳ Aggiornamento layer "${layerKey}"...`);
    try {
      await updateBackgroundLayerMetadata(layerId, {
        width: background.canvas_width,
        height: background.canvas_height,
        zIndex: Number(editLayerValues.zIndex),
        animationType: editLayerValues.animationType,
        speed: Number(editLayerValues.speed) || 1
      });
      setStatus(`✅ Layer "${layerKey}" aggiornato.`);
      setEditingLayerId(null);
      await refresh();
    } catch (err) {
      setStatus(`❌ Errore aggiornamento layer: ${err.message}`);
    } finally {
      setSavingLayerEdit(false);
    }
  }

  const hasLayers = background?.layers?.length > 0;

  const skeletonData = useMemo(() => {
    if (!hasLayers) return null;
    return buildBackgroundSkeleton({
      layers: background.layers.map((l) => ({
        layerKey: l.layer_key,
        zIndex: l.z_index,
        animationType: l.animation_type,
        speed: l.speed
      })),
      canvasWidth: background.canvas_width,
      canvasHeight: background.canvas_height
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasLayers, background?.layers, background?.canvas_width, background?.canvas_height]);

  const layerRefsMap = useRef({});
  if (background) {
    for (const l of background.layers) {
      if (!layerRefsMap.current[l.layer_key]) layerRefsMap.current[l.layer_key] = { current: null };
    }
  }

  const { duration: previewDuration } = useBackgroundAnimationLoop({
    layerRefs: layerRefsMap.current,
    animationsObj: skeletonData?.animations,
    playing: playing && !!skeletonData
  });

  async function handleGenerateExport() {
    if (!skeletonData) return;
    setSavingExport(true);
    setStatus("⏳ Generazione ed export in corso...");
    try {
      const atlasText = buildMultiPartAtlas(
        background.layers.map((l) => ({
          imageFileName: `${l.layer_key}.png`,
          regionName: l.layer_key,
          width: background.canvas_width,
          height: background.canvas_height
        }))
      );
      await saveBackgroundExport({ backgroundId: background.id, skeletonJson: skeletonData, atlasText });
      setStatus("✅ Export generato e salvato.");
      await refresh();
    } catch (err) {
      setStatus(`❌ Errore export: ${err.message}`);
    } finally {
      setSavingExport(false);
    }
  }

  async function handleDownload() {
    if (!background?.export) {
      setStatus('⚠️ Premi prima "Genera export" per creare il pacchetto scaricabile.');
      return;
    }
    setStatus("⏳ Preparo il pacchetto...");
    try {
      await downloadBackgroundPackage({
        backgroundName: background.name,
        skeletonJson: background.export.skeleton_json,
        atlasText: background.export.atlas_text,
        layers: background.layers
      });
      setStatus("✅ Download avviato.");
    } catch (err) {
      setStatus(`❌ Errore download: ${err.message}`);
    }
  }

  if (loading) return <div className="page status">⏳ Carico background...</div>;
  if (error) return <div className="page status error">❌ {error}</div>;
  if (!background) return null;

  // Lo stage dell'anteprima è sempre proporzionato alla risoluzione canvas del
  // background (non più alla dimensione della singola immagine più grande):
  // ogni layer viene quindi mostrato esattamente alla stessa scala, riempiendo il frame.
  const stageScale = Math.min(640 / background.canvas_width, 380 / background.canvas_height, 1);
  const stageW = Math.round(background.canvas_width * stageScale);
  const stageH = Math.round(background.canvas_height * stageScale);

  return (
    <div className="page">
      <Link to="/backgrounds" className="back-link">← Tutti i background</Link>
      <h1>🌆 {background.name}</h1>

      <h2 className="section-title">🖥️ Risoluzione canvas</h2>
      <div className="hint">
        Tutti i layer vengono adattati esattamente a questa risoluzione, indipendentemente dalle dimensioni del file
        caricato — così ogni layer copre perfettamente l'intero frame.
      </div>
      {!editingCanvas ? (
        <div className="btn-row">
          <div className="status" style={{ margin: 0 }}>
            Attuale: <strong>{background.canvas_width}×{background.canvas_height}px</strong>
          </div>
          <button type="button" className="btn secondary tiny" onClick={() => setEditingCanvas(true)}>
            ✏️ Cambia risoluzione
          </button>
        </div>
      ) : (
        <div className="layer-edit-form" style={{ maxWidth: 420 }}>
          <label className="field-label tiny-label">
            Preset rapido
            <select
              onChange={(e) => {
                const preset = CANVAS_PRESETS[e.target.value];
                if (preset) {
                  setCanvasW(preset.w);
                  setCanvasH(preset.h);
                }
              }}
              defaultValue=""
            >
              <option value="" disabled>Scegli un preset...</option>
              {CANVAS_PRESETS.map((p, i) => (
                <option key={p.label} value={i}>{p.label}</option>
              ))}
            </select>
          </label>
          <div className="row">
            <label className="field-label tiny-label">
              Larghezza
              <input type="number" value={canvasW} onChange={(e) => setCanvasW(e.target.value)} />
            </label>
            <label className="field-label tiny-label">
              Altezza
              <input type="number" value={canvasH} onChange={(e) => setCanvasH(e.target.value)} />
            </label>
          </div>
          <div className="btn-row">
            <button type="button" className="btn tiny" disabled={savingCanvas} onClick={handleSaveCanvas}>
              ✓ Salva risoluzione
            </button>
            <button type="button" className="btn secondary tiny" onClick={() => setEditingCanvas(false)}>
              ✕ Annulla
            </button>
          </div>
          {hasLayers && (
            <div className="hint">
              ⚠️ Cambiare la risoluzione riadatta tutti i layer esistenti alla nuova dimensione (le immagini restano
              quelle caricate, solo l'inquadratura cambia).
            </div>
          )}
        </div>
      )}

      {hasLayers && (
        <>
          <h2 className="section-title">📋 Dettagli tecnici</h2>
          <div className="hint">Clicca su una riga per modificare z-index, animazione o velocità.</div>
          <div className="tech-details-table">
            <div className="tech-details-row tech-details-header tech-details-row-bg">
              <span>Layer</span>
              <span>Z-index</span>
              <span>Animazione</span>
              <span>Velocità</span>
              <span></span>
            </div>
            {[...background.layers].sort((a, b) => a.z_index - b.z_index).map((l) => {
              const isEditing = editingLayerId === l.id;
              if (isEditing) {
                return (
                  <div className="tech-details-row tech-details-row-bg tech-details-row-editing" key={l.id}>
                    <span>{l.layer_key}</span>
                    <input type="number" value={editLayerValues.zIndex} onChange={(e) => setEditLayerValues((v) => ({ ...v, zIndex: e.target.value }))} />
                    <select value={editLayerValues.animationType} onChange={(e) => setEditLayerValues((v) => ({ ...v, animationType: e.target.value }))}>
                      {AVAILABLE_LAYER_ANIMATION_TYPES.map((t) => (
                        <option key={t} value={t}>{ANIM_LABELS[t]}</option>
                      ))}
                    </select>
                    <input type="number" step="0.1" min="0.1" value={editLayerValues.speed} onChange={(e) => setEditLayerValues((v) => ({ ...v, speed: e.target.value }))} />
                    <span className="tech-edit-actions">
                      <button type="button" className="btn tiny" disabled={savingLayerEdit} onClick={() => saveEditingLayer(l.id, l.layer_key)}>✓</button>
                      <button type="button" className="btn secondary tiny" onClick={cancelEditingLayer}>✕</button>
                    </span>
                  </div>
                );
              }
              return (
                <div
                  className="tech-details-row tech-details-row-bg tech-details-row-editable"
                  key={l.id}
                  onClick={() => startEditingLayer(l)}
                  title="Clicca per modificare"
                >
                  <span>{l.layer_key}</span>
                  <span>{l.z_index}</span>
                  <span>{ANIM_LABELS[l.animation_type]}</span>
                  <span>{l.speed}</span>
                  <span className="tech-edit-hint">✏️</span>
                </div>
              );
            })}
          </div>
        </>
      )}

      <h2 className="section-title">Layer esistenti</h2>
      {!hasLayers && <div className="hint">Nessun layer ancora. Aggiungine uno qui sotto.</div>}
      <div className="symbol-cards-grid">
        {background.layers.map((l) => (
          <div key={l.id} className="symbol-card" style={{ cursor: "default" }}>
            <button type="button" className="symbol-card-delete" onClick={() => handleDeleteLayer(l.id)} title="Elimina layer">
              ✕
            </button>
            <div className="symbol-card-thumb">
              <img src={l.image_url} alt={l.layer_key} />
            </div>
            <div className="symbol-card-name">{l.layer_key}</div>
          </div>
        ))}
      </div>

      <h2 className="section-title">➕ Aggiungi layer</h2>

      <label className="field-label">
        Nome layer (es. sky, clouds, foreground, glow_sign)
        <input type="text" value={layerName} onChange={(e) => setLayerName(e.target.value)} />
      </label>

      <label className="field-label">
        Immagine layer (PNG) — verrà adattata a {background.canvas_width}×{background.canvas_height}px
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
          <div className="preview-stage" style={{ height: 200 }}>
            <img src={workingUrl} alt="anteprima layer" className="preview-img" />
          </div>

          <div className="row">
            <label className="field-label">
              Z-index (ordine: più alto = più in primo piano)
              <input type="number" value={zIndex} onChange={(e) => setZIndex(e.target.value)} />
            </label>
            <label className="field-label">
              Tipo animazione
              <select value={animationType} onChange={(e) => setAnimationType(e.target.value)}>
                {AVAILABLE_LAYER_ANIMATION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {ANIM_LABELS[t]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="field-label">
            Velocità (1 = normale)
            <input type="number" step="0.1" min="0.1" value={layerSpeed} onChange={(e) => setLayerSpeed(e.target.value)} />
          </label>

          <button type="button" className="btn" onClick={handleSaveLayer} disabled={savingLayer}>
            💾 Salva layer
          </button>
        </>
      )}

      {hasLayers && (
        <>
          <h2 className="section-title">Anteprima composita (loop ambientale)</h2>
          <div className="character-stage" style={{ width: stageW, height: stageH, maxWidth: "100%" }}>
            {[...background.layers].sort((a, b) => a.z_index - b.z_index).map((l) => (
              <img
                key={l.id}
                ref={(el) => {
                  layerRefsMap.current[l.layer_key] = { current: el };
                }}
                src={l.image_url}
                alt={l.layer_key}
                className="character-part-img"
                style={{
                  left: 0,
                  top: 0,
                  width: stageW,
                  height: stageH,
                  objectFit: "cover",
                  zIndex: l.z_index
                }}
              />
            ))}
          </div>

          <div className="btn-row">
            <button type="button" className="btn secondary" onClick={() => setPlaying((p) => !p)}>
              {playing ? `⏸ Pausa (${previewDuration.toFixed(2)}s)` : "▶ Anteprima loop ambientale"}
            </button>
            <button type="button" className="btn" onClick={handleGenerateExport} disabled={savingExport}>
              ⚙️ Genera export
            </button>
          </div>
          <div className="btn-row">
            <button type="button" className="btn secondary" onClick={handleDownload}>
              ⬇ Scarica pacchetto
            </button>
          </div>
        </>
      )}

      {status && <div className="status">{status}</div>}
    </div>
  );
}
