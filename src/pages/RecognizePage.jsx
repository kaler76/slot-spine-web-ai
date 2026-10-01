import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { FilesetResolver, PoseLandmarker, ImageSegmenter, InteractiveSegmenterLegacy } from "@mediapipe/tasks-vision";
import { recognizeParts, refineObjectWithMask, PARTS, SEG_LABELS } from "../lib/partRecognition.js";

// Modelli MediaPipe caricati dal CDN alla prima analisi (nessuna chiave, nessun costo, girano nel browser).
const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const POSE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task";
const OBJECT_MODEL =
  "https://storage.googleapis.com/mediapipe-models/interactive_segmenter/magic_touch/float32/1/magic_touch.tflite";
const SEG_MODEL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite";

const SEG_COLORS = [
  [0, 0, 0],
  [255, 200, 0],
  [255, 120, 160],
  [80, 200, 255],
  [60, 220, 120],
  [200, 80, 255]
];
const PART_COLORS = [
  [0, 0, 0],
  [230, 60, 60],
  [60, 200, 255],
  [255, 230, 0],
  [0, 230, 120],
  [255, 140, 0],
  [0, 140, 255],
  [255, 0, 200],
  [190, 120, 255]
];
const POSE_LINKS = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [15, 17], [15, 19], [15, 21], [16, 18], [16, 20], [16, 22]
];

let modelsPromise = null;
function loadModels() {
  if (!modelsPromise) {
    modelsPromise = (async () => {
      const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
      const pose = await PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: POSE_MODEL },
        runningMode: "IMAGE",
        numPoses: 1
      });
      const segmenter = await ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: SEG_MODEL },
        runningMode: "IMAGE",
        outputCategoryMask: true,
        outputConfidenceMasks: false
      });
      // segmentatore "a punto": serve solo se c'è un oggetto tenuto davanti al corpo
      let objectSegmenter = null;
      try {
        objectSegmenter = await InteractiveSegmenterLegacy.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: OBJECT_MODEL },
          outputConfidenceMasks: true,
          outputCategoryMask: false
        });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("Segmentatore oggetti non disponibile:", e);
      }
      return { pose, segmenter, objectSegmenter };
    })();
    modelsPromise.catch(() => {
      modelsPromise = null;
    });
  }
  return modelsPromise;
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = reject;
    img.src = url;
  });
}

/**
 * Pagina di prova del riconoscimento automatico: carica UN'immagine del personaggio
 * intero e mostra posa (articolazioni), segmentazione per categorie e parti proposte.
 * Solo analisi: niente scritture su database o storage.
 */
export default function RecognizePage() {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [view, setView] = useState("parts");
  const [showPose, setShowPose] = useState(true);
  const canvasRef = useRef(null);
  const sourceRef = useRef(null);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setResult(null);
    try {
      setStatus("⏳ Carico i modelli (solo la prima volta, ~30 MB)...");
      const { pose, segmenter, objectSegmenter } = await loadModels();
      const { img } = await loadImage(file);
      const W = img.naturalWidth;
      const H = img.naturalHeight;
      const c = document.createElement("canvas");
      c.width = W;
      c.height = H;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const rgba = ctx.getImageData(0, 0, W, H).data;
      let hasAlpha = false;
      for (let i = 3; i < rgba.length; i += 4) if (rgba[i] < 250) { hasAlpha = true; break; }
      const alpha = hasAlpha ? Uint8Array.from({ length: W * H }, (_, i) => rgba[i * 4 + 3]) : undefined;

      setStatus("⏳ Riconosco posa e categorie...");
      const poseRes = pose.detect(c);
      if (!poseRes.landmarks?.length) throw new Error("Nessuna posa riconosciuta nell'immagine.");
      const landmarks = poseRes.landmarks[0].map((p) => ({ x: p.x * W, y: p.y * H, visibility: p.visibility ?? 1 }));

      const segRes = segmenter.segment(c);
      const mask = segRes.categoryMask;
      let categories = mask.getAsUint8Array();
      if (mask.width !== W || mask.height !== H) {
        // ridimensiona (nearest) alla risoluzione dell'immagine
        const out = new Uint8Array(W * H);
        for (let y = 0; y < H; y++)
          for (let x = 0; x < W; x++)
            out[y * W + x] = categories[Math.floor((y * mask.height) / H) * mask.width + Math.floor((x * mask.width) / W)];
        categories = out;
      } else {
        categories = Uint8Array.from(categories);
      }
      mask.close?.();

      const rec = recognizeParts({ width: W, height: H, landmarks, categories, alpha, rgba });
      if (objectSegmenter && rec.objectSeeds.length) {
        setStatus("⏳ Rifinisco l'oggetto tenuto in mano...");
        for (const seed of rec.objectSeeds) {
          const res = objectSegmenter.segment(c, { keypoint: { x: seed.x / W, y: seed.y / H } });
          const m = res.confidenceMasks?.[0];
          if (!m) continue;
          let probs = m.getAsFloat32Array();
          if (m.width !== W || m.height !== H) {
            const out = new Float32Array(W * H);
            for (let y = 0; y < H; y++)
              for (let x = 0; x < W; x++)
                out[y * W + x] = probs[Math.floor((y * m.height) / H) * m.width + Math.floor((x * m.width) / W)];
            probs = out;
          } else {
            probs = Float32Array.from(probs);
          }
          res.close?.();
          const { stats } = refineObjectWithMask({ parts: rec.parts, width: W, height: H, mask: probs, handDisks: rec.handDisks });
          rec.stats = stats;
        }
      }
      sourceRef.current = { img, W, H };
      setResult({ W, H, landmarks, categories, hasAlpha, ...rec, fileName: file.name });
      setStatus(`✅ Analisi completata${hasAlpha ? " (primo piano dalla trasparenza del PNG)" : ""}.`);
    } catch (err) {
      setStatus(`❌ ${err.message || err}`);
    } finally {
      setBusy(false);
      if (e.target) e.target.value = "";
    }
  }

  useEffect(() => {
    if (!result || !canvasRef.current || !sourceRef.current) return;
    const { img, W, H } = sourceRef.current;
    const canvas = canvasRef.current;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    if (view !== "image") {
      const data = ctx.getImageData(0, 0, W, H);
      const src = view === "parts" ? result.parts : result.categories;
      const colors = view === "parts" ? PART_COLORS : SEG_COLORS;
      for (let i = 0; i < W * H; i++) {
        const v = src[i];
        if (!v) {
          data.data[i * 4] *= 0.35;
          data.data[i * 4 + 1] *= 0.35;
          data.data[i * 4 + 2] *= 0.35;
          continue;
        }
        const col = colors[v];
        data.data[i * 4] = data.data[i * 4] * 0.45 + col[0] * 0.55;
        data.data[i * 4 + 1] = data.data[i * 4 + 1] * 0.45 + col[1] * 0.55;
        data.data[i * 4 + 2] = data.data[i * 4 + 2] * 0.45 + col[2] * 0.55;
      }
      ctx.putImageData(data, 0, 0);
    }
    if (showPose) {
      const r = Math.max(3, W / 160);
      ctx.lineWidth = Math.max(2, W / 400);
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      for (const [a, b] of POSE_LINKS) {
        const pa = result.landmarks[a], pb = result.landmarks[b];
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.stroke();
      }
      ctx.font = `${Math.max(11, W / 60)}px sans-serif`;
      for (const [name, p] of Object.entries(result.joints)) {
        ctx.fillStyle = "#00ffff";
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.fillText(name, p.x + r + 2, p.y - r);
      }
    }
  }, [result, view, showPose]);

  function downloadReport() {
    if (!result) return;
    const report = {
      file: result.fileName,
      size: [result.W, result.H],
      primoPianoDaTrasparenza: result.hasAlpha,
      landmarks: result.landmarks.map((p) => [+p.x.toFixed(2), +p.y.toFixed(2), +(p.visibility ?? 1).toFixed(3)]),
      joints: Object.fromEntries(Object.entries(result.joints).map(([k, p]) => [k, [Math.round(p.x), Math.round(p.y)]])),
      partiPixel: result.stats,
      avvisi: result.warnings
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(result.fileName || "immagine").replace(/\.[^.]+$/, "")}_riconoscimento.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    const png = document.createElement("a");
    png.href = canvasRef.current.toDataURL("image/png");
    png.download = `${(result.fileName || "immagine").replace(/\.[^.]+$/, "")}_riconoscimento_${view}.png`;
    png.click();
    // maschera delle categorie (valore = indice categoria * 40, scala di grigi): serve a
    // trasformare questo caso in un test automatico (tests/fixtures/recognition/...)
    const mc = document.createElement("canvas");
    mc.width = result.W;
    mc.height = result.H;
    const mctx = mc.getContext("2d");
    const md = mctx.createImageData(result.W, result.H);
    for (let i = 0; i < result.W * result.H; i++) {
      const v = result.categories[i] * 40;
      md.data[i * 4] = v;
      md.data[i * 4 + 1] = v;
      md.data[i * 4 + 2] = v;
      md.data[i * 4 + 3] = 255;
    }
    mctx.putImageData(md, 0, 0);
    const cat = document.createElement("a");
    cat.href = mc.toDataURL("image/png");
    cat.download = `${(result.fileName || "immagine").replace(/\.[^.]+$/, "")}_categorie.png`;
    cat.click();
  }

  const legend = view === "parts" ? PARTS.slice(1).map((p, i) => [p, PART_COLORS[i + 1]]) : SEG_LABELS.slice(1).map((p, i) => [p, SEG_COLORS[i + 1]]);

  return (
    <div className="page">
      <Link to="/" className="back-link">← Home</Link>
      <h1>🔍 Riconosci parti (prova)</h1>
      <div className="hint">
        Carica UN'immagine del personaggio intero (anche con lo sfondo). L'app riconosce da sola articolazioni (posa) e
        categorie di pixel (capelli, viso, pelle, vestiti, accessori) e propone le parti per il rig. Solo analisi: non
        salva nulla. Con "Scarica risultato" ottieni un JSON + l'immagine da condividere per la verifica.
      </div>
      <div className="row" style={{ gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <input type="file" accept="image/*" disabled={busy} onChange={handleFile} />
        {result && (
          <>
            <select value={view} onChange={(e) => setView(e.target.value)}>
              <option value="parts">Parti proposte</option>
              <option value="categories">Categorie (segmentazione)</option>
              <option value="image">Solo immagine</option>
            </select>
            <label className="field-label-inline">
              <input type="checkbox" checked={showPose} onChange={(e) => setShowPose(e.target.checked)} /> Articolazioni
            </label>
            <button type="button" className="btn secondary" onClick={downloadReport}>⬇️ Scarica risultato</button>
          </>
        )}
      </div>
      {status && <div className="status">{status}</div>}
      {result && (
        <>
          <div className="row" style={{ gap: 12, flexWrap: "wrap", margin: "8px 0" }}>
            {legend.map(([name, col]) => (
              <span key={name} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 14, height: 14, background: `rgb(${col.join(",")})`, display: "inline-block", borderRadius: 3 }} />
                {name}
              </span>
            ))}
          </div>
          {result.warnings.length > 0 && (
            <div className="hint" style={{ color: "#ffb347" }}>
              {result.warnings.map((w) => (
                <div key={w}>⚠️ {w}</div>
              ))}
            </div>
          )}
          <canvas ref={canvasRef} style={{ maxWidth: "100%", height: "auto", border: "1px solid #333", borderRadius: 6 }} />
          <div className="hint">
            Pixel per parte: {Object.entries(result.stats).map(([k, v]) => `${k} ${v}`).join(" · ")}
          </div>
        </>
      )}
    </div>
  );
}
