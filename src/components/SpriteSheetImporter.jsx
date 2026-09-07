import { useEffect, useRef, useState } from "react";
import { detectSpriteRegions } from "../lib/spriteSheetDetector.js";
import { AVAILABLE_PART_ANIMATION_TYPES } from "../lib/characterAnimationTemplates.js";
import { saveCharacterPart } from "../lib/charactersRepository.js";

const ANIM_LABELS = {
  static: "⏸️ Fermo",
  sway: "🎐 Oscillazione",
  bounce: "⬆️ Rimbalzo",
  blink: "✨ Lampeggio"
};

function sanitizeKey(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const url = source instanceof Blob ? URL.createObjectURL(source) : source;
    const img = new Image();
    img.onload = () => {
      resolve(img);
      if (source instanceof Blob) URL.revokeObjectURL(url);
    };
    img.onerror = reject;
    img.src = url;
  });
}

/**
 * Ritaglia un componente rilevato mascherando i pixel che non gli appartengono
 * (evita che elementi vicini o etichette "sanguinino" nel ritaglio), restituendo
 * un canvas con solo i pixel di quel componente, sfondo trasparente altrove.
 */
function cropComponentToCanvas({ srcCanvas, region, labels, erodedMask, width, pad = 4 }) {
  const cx0 = Math.max(0, region.x - pad);
  const cy0 = Math.max(0, region.y - pad);
  const cx1 = Math.min(srcCanvas.width, region.x + region.w + pad);
  const cy1 = Math.min(srcCanvas.height, region.y + region.h + pad);
  const cw = cx1 - cx0;
  const ch = cy1 - cy0;

  const srcCtx = srcCanvas.getContext("2d");
  const srcData = srcCtx.getImageData(cx0, cy0, cw, ch);
  const out = new ImageData(cw, ch);

  for (let yy = 0; yy < ch; yy++) {
    for (let xx = 0; xx < cw; xx++) {
      const globalX = cx0 + xx;
      const globalY = cy0 + yy;
      const globalIdx = globalY * width + globalX;
      const belongs = erodedMask[globalIdx] && labels[globalIdx] === region.label;
      const srcIdx = (yy * cw + xx) * 4;
      if (belongs) {
        out.data[srcIdx] = srcData.data[srcIdx];
        out.data[srcIdx + 1] = srcData.data[srcIdx + 1];
        out.data[srcIdx + 2] = srcData.data[srcIdx + 2];
        out.data[srcIdx + 3] = srcData.data[srcIdx + 3];
      }
    }
  }

  const outCanvas = document.createElement("canvas");
  outCanvas.width = cw;
  outCanvas.height = ch;
  outCanvas.getContext("2d").putImageData(out, 0, 0);
  return outCanvas;
}

/**
 * Elabora un'immagine (file caricato manualmente O immagine generata dall'AI,
 * entrambi come Blob) rilevando ed estraendo tutte le tessere. Funzione
 * condivisa tra i due punti di ingresso (upload manuale / generazione AI).
 */
export async function processSpriteSheetBlob(blob) {
  const img = await loadImage(blob);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

  const { regions, labels, erodedMask } = detectSpriteRegions({
    width: canvas.width,
    height: canvas.height,
    rgba: imageData.data
  });

  const artRegions = regions.filter((r) => !r.isProbablyLabel);

  const parts = artRegions.map((region, idx) => {
    const cropped = cropComponentToCanvas({ srcCanvas: canvas, region, labels, erodedMask, width: canvas.width });
    return {
      id: `detected_${Date.now()}_${idx}`,
      canvas: cropped,
      dataUrl: cropped.toDataURL("image/png"),
      width: cropped.width,
      height: cropped.height,
      sheetCenterX: region.x + region.w / 2,
      sheetCenterY: region.y + region.h / 2,
      name: `parte_${idx + 1}`,
      parentKey: "root",
      animationType: "static",
      anchorX: "center",
      anchorY: "center",
      zIndex: idx * 10,
      speed: 1,
      include: true
    };
  });

  return { parts, labelCount: regions.length - artRegions.length };
}

/**
 * @param {Object} props
 * @param {string} props.characterId
 * @param {Array} props.existingParts
 * @param {Function} props.onImported
 * @param {Blob|null} [props.externalBlob] - se fornito (es. immagine generata
 *        dall'AI), viene elaborato automaticamente al posto dell'upload manuale.
 * @param {number} [props.externalBlobKey] - cambia questo valore per far
 *        rielaborare un nuovo externalBlob (es. incrementa un contatore).
 */
export default function SpriteSheetImporter({ characterId, existingParts, onImported, externalBlob, externalBlobKey }) {
  const [status, setStatus] = useState("");
  const [processing, setProcessing] = useState(false);
  const [detectedParts, setDetectedParts] = useState(null);
  const fileInputRef = useRef(null);

  async function processBlob(blob) {
    setProcessing(true);
    setStatus("⏳ Analisi dello sprite sheet in corso...");
    setDetectedParts(null);
    try {
      const { parts, labelCount } = await processSpriteSheetBlob(blob);
      setDetectedParts(parts);
      setStatus(
        `✅ Rilevate ${parts.length} illustrazioni (${labelCount} etichette di testo escluse automaticamente). Rivedi nome/genitore/animazione qui sotto prima di importare.`
      );
    } catch (err) {
      setStatus(`❌ Errore analisi: ${err.message}`);
    } finally {
      setProcessing(false);
    }
  }

  useEffect(() => {
    if (externalBlob) processBlob(externalBlob);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalBlobKey]);

  async function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    await processBlob(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function updatePart(id, patch) {
    setDetectedParts((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  async function handleImportAll() {
    const toImport = detectedParts.filter((p) => p.include);
    if (toImport.length === 0) {
      setStatus("⚠️ Nessuna parte selezionata da importare.");
      return;
    }

    const existingKeys = new Set(existingParts.map((p) => p.part_key));
    const seen = new Set();
    for (const p of toImport) {
      const key = sanitizeKey(p.name);
      if (!key) {
        setStatus(`⚠️ Una parte non ha un nome valido (era "${p.name}").`);
        return;
      }
      if (seen.has(key) || existingKeys.has(key)) {
        setStatus(`⚠️ Nome duplicato: "${key}". Ogni parte deve avere un nome univoco.`);
        return;
      }
      seen.add(key);
    }

    setProcessing(true);
    setStatus(`⏳ Importazione di ${toImport.length} parti in corso...`);
    let done = 0;
    let autoPositioned = 0;
    try {
      const byName = {};
      for (const p of toImport) byName[sanitizeKey(p.name)] = p;

      for (const p of toImport) {
        const blob = await new Promise((resolve) => p.canvas.toBlob(resolve, "image/png"));

        let offsetX = 0;
        let offsetY = 0;
        const parentPart = byName[p.parentKey];
        if (parentPart) {
          offsetX = Math.round(p.sheetCenterX - parentPart.sheetCenterX);
          offsetY = Math.round(-(p.sheetCenterY - parentPart.sheetCenterY));
          autoPositioned++;
        }

        await saveCharacterPart({
          characterId,
          partKey: sanitizeKey(p.name),
          parentKey: p.parentKey,
          imageBlob: blob,
          width: p.width,
          height: p.height,
          offsetX,
          offsetY,
          zIndex: Number(p.zIndex) || 0,
          animationType: p.animationType,
          speed: Number(p.speed) || 1,
          anchorX: p.anchorX,
          anchorY: p.anchorY
        });
        done++;
        setStatus(`⏳ Importate ${done}/${toImport.length}...`);
      }
      setStatus(
        `✅ Importate ${done} parti (${autoPositioned} posizionate automaticamente in base alla distanza reale nel foglio originale). Controlla comunque l'anteprima: potrebbe servire qualche ritocco manuale.`
      );
      setDetectedParts(null);
      onImported?.();
    } catch (err) {
      setStatus(`❌ Errore durante l'importazione (${done} completate prima dell'errore): ${err.message}`);
    } finally {
      setProcessing(false);
    }
  }

  const parentOptions = [
    "root",
    ...existingParts.map((p) => p.part_key),
    ...(detectedParts || []).map((p) => sanitizeKey(p.name)).filter(Boolean)
  ];

  return (
    <div className="sprite-importer">
      {!externalBlob && (
        <>
          <label className="field-label">
            Carica sprite sheet intero (PNG con più tessere)
            <input ref={fileInputRef} type="file" accept="image/png" onChange={handleFile} disabled={processing} />
          </label>
          <div className="hint">
            Rileva automaticamente ogni tessera separata, esclude le etichette di testo ed evita che elementi vicini
            si contaminino a vicenda — rivedi comunque nome/genitore prima di confermare.
          </div>
        </>
      )}

      {status && <div className="status">{status}</div>}

      {detectedParts && detectedParts.length > 0 && (
        <>
          <div className="sprite-detected-grid">
            {detectedParts.map((p) => (
              <div key={p.id} className={`sprite-detected-card ${p.include ? "" : "sprite-detected-excluded"}`}>
                <label className="sprite-detected-toggle">
                  <input
                    type="checkbox"
                    checked={p.include}
                    onChange={(e) => updatePart(p.id, { include: e.target.checked })}
                  />
                  incluso
                </label>
                <img src={p.dataUrl} alt={p.name} className="sprite-detected-thumb" />
                <input
                  type="text"
                  className="sprite-detected-name"
                  value={p.name}
                  onChange={(e) => updatePart(p.id, { name: e.target.value })}
                  placeholder="nome parte"
                />
                <select value={p.parentKey} onChange={(e) => updatePart(p.id, { parentKey: e.target.value })}>
                  <option value="root">— (radice)</option>
                  {parentOptions
                    .filter((k) => k !== "root" && k !== sanitizeKey(p.name))
                    .map((k) => (
                      <option key={k} value={k}>{k}</option>
                    ))}
                </select>
                <select value={p.animationType} onChange={(e) => updatePart(p.id, { animationType: e.target.value })}>
                  {AVAILABLE_PART_ANIMATION_TYPES.map((t) => (
                    <option key={t} value={t}>{ANIM_LABELS[t]}</option>
                  ))}
                </select>
                <div className="sprite-detected-anchor-row">
                  <select value={p.anchorX} onChange={(e) => updatePart(p.id, { anchorX: e.target.value })}>
                    <option value="left">⬅️</option>
                    <option value="center">◯</option>
                    <option value="right">➡️</option>
                  </select>
                  <select value={p.anchorY} onChange={(e) => updatePart(p.id, { anchorY: e.target.value })}>
                    <option value="top">⬆️</option>
                    <option value="center">◯</option>
                    <option value="bottom">⬇️</option>
                  </select>
                </div>
                <span className="hint" style={{ margin: 0 }}>{p.width}×{p.height}px</span>
              </div>
            ))}
          </div>

          <button type="button" className="btn" onClick={handleImportAll} disabled={processing}>
            💾 Importa {detectedParts.filter((p) => p.include).length} parti selezionate
          </button>
        </>
      )}
    </div>
  );
}
