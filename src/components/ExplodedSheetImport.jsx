import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import JSZip from "jszip";
import { importExplodedSheet, chooseChromaColor } from "../lib/explodedSheet.js";
import { piecesFromPartMap, headCrop, mapComponents, PARTMAP_PROMPT, FACE_PARTMAP_PROMPT } from "../lib/partMap.js";
import { foregroundMask } from "../lib/sheetAssembly.js";
import { checkPieces } from "../lib/pieceCheck.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../lib/supabaseClient.js";
import { composePieces } from "../lib/partExtraction.js";
import { preserveSharedGrip } from "../lib/sharedGrip.js";
import { piecesToCharacterParts } from "../lib/characterFromPieces.js";
import { createCharacter, saveCharacterPart } from "../lib/charactersRepository.js";

// Prompt per far generare la tavola esplosa a un modello di immagini (Gemini / ChatGPT),
// allegando l'immagine originale del personaggio.
/**
 * Prompt per la tavola esplosa. Lo sfondo è scelto sul personaggio (chooseChromaColor): il colore
 * meno presente nel disegno, così nessuna parte (es. un tabarro blu) sparisce allo scontorno.
 */
export function buildExplodedPrompt(chroma = { name: "blue", hex: "#0018FF" }, { face = false } = {}) {
  return `Using the attached character image, create an EXPLODED VIEW sheet of the same character for 2D skeletal animation (Spine).
- Same character, same art style, same scale and same proportions as the original. Do not redesign anything.
- Split it into AT MOST 6-8 large separate pieces: HEAD (including hat/helmet/crown, front hair and beard), BACK HAIR (if any), TORSO WITH LEGS, LEFT ARM WITH HAND, RIGHT ARM WITH HAND, and every other held object as its own piece. EXCEPTION — a hand gripping a LONG object (staff, spear, sword, lightning bolt): that hand and the whole object are ONE single piece, cut from the arm at the wrist. Do NOT split armor, clothing or accessories into small plates or fragments.
- Do NOT change the pose: every piece keeps EXACTLY the same angle and shape it has in the original (bent or crossed arms stay bent or crossed, a raised arm stays raised). Only move pieces apart, never rotate, straighten or re-pose them.
- Keep every piece as close as possible to its original position, just moved apart so that no piece touches or overlaps another (clear gap between pieces).
- The HEAD piece includes the neck and the BARE skin of shoulders, collarbones and chest above the clothing (one bust-like piece, like a statue bust); the TORSO piece is the clothing with the legs. The arm pieces start at the shoulder, with the shoulder top painted where the head piece covered it.
- Redraw the parts that were hidden: the neck/collar under the head, the shoulders where the arms attach (extend them a little under the joint), and the hand where it was holding a small separate object.
- Internal shoulder cut surfaces must continue the skin or clothing shading, without a new black outline across the joint. Preserve the character's existing exterior outlines.
- BACK HAIR: hair that falls BEHIND the head (back of the head, behind the neck or shoulders) is ALWAYS its own separate piece, never fused with the head or the torso. Extend it a little where the head hid it, so it can sway behind the head. The head piece keeps only the hair in front of the face, the crown/wreath and the beard, with a clean outline.
- Clothing that passes IN FRONT of a shoulder (cape flap, drape with brooch/fibula): ONE separate piece, keeping its original shape and overlap; the shoulder under it must be complete (no exposed hole).
- HAND + LONG OBJECT piece: keep the ORIGINAL pixels of the grip — hand silhouette, finger positions and the object's angle. Do not separate the fingers from the object, do not cut a hand-shaped hole, do not redraw the part of the object hidden inside the fist (it stays hidden). The arm piece ends at the wrist: redraw only the hidden wrist joint with a small overlap and no new black line across it; the hand must not appear also on the arm. Move this block as a whole, never rotate or rescale it. A free (open) hand stays with its own arm.
- Other small held objects: keep them complete, including the section hidden inside the grip.
- Background: flat solid pure ${chroma.name} ${chroma.hex}, no gradient, no shadows, no glow, no particles, no text. The character must not contain this background color.${face ? FACE_PROMPT : ""}`;
}

/**
 * Aggiunta per la tavola CON IL VISO separato (faceRig.js): occhi, sopracciglia, bocca e ciocche
 * laterali come pezzi a sé; sulla testa, sotto gli occhi, palpebre CHIUSE dipinte (il battito
 * schiaccia l'occhio aperto e scopre la palpebra: senza, si vede un buco — mutazione nei test).
 */
const FACE_PROMPT = `
- FACE PARTS as separate small pieces, placed just outside the head with a clear gap and arranged like on the face (eyebrows above the eyes, mouth below, mustache halves at its sides, left stays left and right stays right), EXACTLY the same size and same shape as in the original (do not enlarge them): LEFT EYE, RIGHT EYE (each eye open, with its upper lash line), LEFT EYEBROW, RIGHT EYEBROW, MOUTH, the MUSTACHE split into LEFT and RIGHT halves (if any), and each side HAIR LOCK that hangs beside the face (if any). Do not draw the face parts twice.
- On the HEAD piece, where the eyes were, paint CLOSED EYELIDS (skin with a curved lash line); where the eyebrows and the mouth were, paint plain skin. The head piece must have no holes.
- At most 16 pieces in total.`;
export const EXPLODED_PROMPT = buildExplodedPrompt();

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function pieceCanvas(p) {
  const c = document.createElement("canvas");
  c.width = p.width;
  c.height = p.height;
  c.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(p.rgba), p.width, p.height), 0, 0);
  return c;
}

const toBlob = (canvas) => new Promise((res) => canvas.toBlob(res, "image/png"));

/**
 * Import di una tavola esplosa: pezzi separati su sfondo a tinta unita -> pezzi RGBA rimessi
 * al loro posto sull'originale, con nome, ordine di disegno, genitore e pivot.
 */
export default function ExplodedSheetImport({ original, landmarks, joints, fileName, heldObjects = [], attachmentRules = [] }) {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const [view, setView] = useState("compare");
  // parti della mappa (posizione e nome dei pezzi della tavola): restano finché si cambia personaggio
  const [partComps, setPartComps] = useState(null);
  useEffect(() => setPartComps(null), [original?.img]); // nuovo personaggio: nuova mappa
  const canvasRef = useRef(null);
  const navigate = useNavigate();
  // sfondo della tavola scelto sul personaggio (colore assente dal disegno)
  const chroma = useMemo(() => (original?.rgba ? chooseChromaColor(original) : null), [original]);

  /** Crea un character (Supabase) con un osso per pezzo e apre la sua pagina per animarlo. */
  async function createCharacterFromPieces() {
    if (!res) return;
    if (!res.usable && !window.confirm("La tavola NON è fedele all'originale (posa o forme cambiate): creare comunque il character?")) return;
    const wrong = res.pieces.filter((p) => p.check?.level === "bad").map((p) => p.name);
    if (res.usable && !res.piecesOk && !window.confirm(`Pezzi fuori posto o viso incompleto${wrong.length ? ` (${wrong.join(", ")})` : ""}: creare comunque il character?`)) return;
    const base = (fileName || "personaggio").replace(/\.[^.]+$/, "");
    const name = window.prompt("Nome del nuovo character:", base);
    if (!name) return;
    setBusy(true);
    try {
      const generated = piecesToCharacterParts(res.pieces);
      const parts = preserveSharedGrip(generated.parts, heldObjects);
      setStatus("⏳ Creo il character...");
      const character = await createCharacter(name);
      for (const [k, part] of parts.entries()) {
        setStatus(`⏳ Carico ${part.partKey} (${k + 1}/${parts.length})...`);
        const piece = res.pieces.find((p) => p.name === part.partKey);
        const imageBlob = await toBlob(pieceCanvas(piece));
        await saveCharacterPart({ characterId: character.id, ...part, imageBlob });
      }
      navigate(`/character/${character.id}`);
    } catch (err) {
      setStatus(`❌ Creazione character: ${err.message || err}`);
    } finally {
      setBusy(false);
    }
  }

  /**
   * MAPPA DELLE PARTI (partMap.js): Gemini ricolora l'originale con un colore per parte, l'app
   * ritaglia i pezzi dall'originale seguendo la mappa. Niente tavola ridisegnata da rimettere al
   * suo posto, niente posa necessaria per i nomi.
   */
  /** silent: usata dall'import della tavola, restituisce solo le parti della mappa. */
  async function handlePartMap(fileFromDisk, { silent = false } = {}) {
    setBusy(true);
    if (!silent) setRes(null);
    try {
      const imageToRgba = (img) => {
        const c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0);
        return { width: c.width, height: c.height, rgba: ctx.getImageData(0, 0, c.width, c.height).data };
      };
      /** Una chiamata a Gemini (Edge Function) con un'immagine e un prompt: torna la mappa in RGBA. */
      const askGemini = async (canvas, prompt) => {
        const b64 = canvas.toDataURL("image/png").split(",")[1];
        const r = await fetch(`${SUPABASE_URL}/functions/v1/generate-sprite-sheet`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SUPABASE_ANON_KEY}`, apikey: SUPABASE_ANON_KEY },
          body: JSON.stringify({ group: "body", promptOverride: prompt, referenceImagesBase64: [b64], referenceAnalysisError: "skip" })
        });
        const data = await r.json();
        if (!r.ok || !data.imageBase64) throw new Error(data?.error || `Errore HTTP ${r.status}`);
        const img = await new Promise((ok, ko) => {
          const im = new Image();
          im.onload = () => ok(im);
          im.onerror = ko;
          im.src = `data:image/png;base64,${data.imageBase64}`; // anche se è JPEG, il browser lo legge
        });
        return imageToRgba(img);
      };
      const oc = document.createElement("canvas");
      oc.width = original.width;
      oc.height = original.height;
      oc.getContext("2d").drawImage(original.img, 0, 0);
      let map;
      if (fileFromDisk) {
        setStatus("⏳ Leggo la mappa delle parti...");
        map = imageToRgba(await loadImage(fileFromDisk));
      } else {
        setStatus("⏳ 1/2 Gemini ricolora il personaggio per parti (1–2 minuti)...");
        map = await askGemini(oc, PARTMAP_PROMPT);
      }
      const fg = foregroundMask(original);
      // 2° passaggio: solo la testa, ingrandita, per occhi, sopracciglia, bocca, baffi
      let faceMap = null;
      const crop = headCrop({ map, original, fg });
      if (crop) {
        setStatus("⏳ 2/2 Gemini ricolora il viso ingrandito (1–2 minuti)...");
        const k = Math.min(4, 1024 / Math.max(crop.w, crop.h));
        const cc = document.createElement("canvas");
        cc.width = Math.round(crop.w * k);
        cc.height = Math.round(crop.h * k);
        const cctx = cc.getContext("2d");
        cctx.imageSmoothingQuality = "high";
        cctx.drawImage(oc, crop.x, crop.y, crop.w, crop.h, 0, 0, cc.width, cc.height);
        try {
          faceMap = await askGemini(cc, FACE_PARTMAP_PROMPT);
        } catch (err) {
          faceMap = null; // senza mappa del viso: tratti presi dalla mappa intera
        }
      }
      setStatus("⏳ Ritaglio i pezzi dall'originale seguendo la mappa...");
      await new Promise((r) => setTimeout(r, 30));
      const comps = mapComponents({ map, original, fg, faceMap, faceCrop: crop }).comps;
      setPartComps(comps);
      if (silent) return comps;
      const out = piecesFromPartMap({ map, original, fg, faceMap, faceCrop: crop });
      if (crop && !faceMap) out.warnings.push("Mappa del viso non disponibile: occhi e bocca presi dalla mappa intera (meno precisi).");
      const pc = checkPieces(out.pieces, original);
      for (const c of pc.checks) out.pieces.find((p) => p.name === c.name).check = c;
      const usable = out.transform.iou >= 0.85;
      setRes({
        pieces: out.pieces, scale: out.transform.s, front: [], warnings: out.warnings, fidelityError: 0, faithful: usable, usable,
        piecesOk: pc.ok, sheetName: fileFromDisk ? fileFromDisk.name : "mappa delle parti (Gemini)"
      });
      setStatus(
        usable
          ? `✅ ${out.pieces.length} pezzi dalla mappa delle parti (sagoma ${Math.round(out.transform.iou * 100)}%${faceMap ? ", viso dalla mappa ingrandita" : ""}).`
          : `⚠️ La mappa non combacia con la sagoma (IoU ${out.transform.iou.toFixed(2)}): rigenerala.`
      );
      return comps;
    } catch (err) {
      setStatus(`❌ Mappa delle parti: ${err.message || err}`);
      return null;
    } finally {
      if (!silent) setBusy(false);
    }
  }

  async function handleSheet(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setRes(null);
    try {
      // AUTOMATICO: senza mappa delle parti la si genera prima (posizione e nome dei pezzi);
      // se Gemini non risponde si prosegue con il metodo precedente
      let comps = partComps;
      if (!comps && original?.img) comps = await handlePartMap(null, { silent: true });
      setBusy(true);
      setStatus("⏳ Separo i pezzi e li rimetto al loro posto...");
      const img = await loadImage(file);
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const sheet = { width: c.width, height: c.height, rgba: ctx.getImageData(0, 0, c.width, c.height).data };
      await new Promise((r) => setTimeout(r, 30)); // lascia aggiornare lo stato prima del calcolo
      const out = importExplodedSheet({ sheet, original, landmarks, joints, attachmentRules, partComps: comps });
      if (comps) out.warnings.unshift(`Posizione e nome dei pezzi dalla mappa delle parti (${comps.length} parti).`);
      else out.warnings.unshift("Mappa delle parti non disponibile: pezzi posizionati con il metodo precedente (meno affidabile).");
      setRes({ ...out, sheetName: file.name });
      const wrong = out.pieces.filter((p) => p.check?.level === "bad").map((p) => p.name);
      setStatus(
        out.usable && !out.piecesOk
          ? `⚠️ ${out.pieces.length} pezzi separati (errore globale ${out.fidelityError}), ma il controllo pezzo per pezzo non è superato${wrong.length ? `: fuori posto ${wrong.join(", ")}` : ""}. Vedi gli avvisi.`
          : out.faithful
          ? `✅ ${out.pieces.length} pezzi separati e rimessi al loro posto${out.scale !== 1 ? ` (scala ${out.scale.toFixed(2)})` : ""}. Tavola fedele (errore ${out.fidelityError}).`
          : out.usable
            ? `✅ ${out.pieces.length} pezzi separati e rimessi al loro posto. Tavola leggermente ridisegnata (errore ${out.fidelityError}): ok per il character, non per il dataset.`
            : `⚠️ ${out.pieces.length} pezzi separati, ma la tavola NON è fedele all'originale (errore ${out.fidelityError}): posa o forme cambiate, rigenerala.`
      );
    } catch (err) {
      setStatus(`❌ ${err.message || err}`);
    } finally {
      setBusy(false);
      if (e.target) e.target.value = "";
    }
  }

  useEffect(() => {
    if (!res || !canvasRef.current) return;
    const { width: W, height: H } = original;
    const canvas = canvasRef.current;
    const composed = new ImageData(composePieces(res.pieces, W, H), W, H);
    const tmp = document.createElement("canvas");
    tmp.width = W;
    tmp.height = H;
    tmp.getContext("2d").putImageData(composed, 0, 0);
    const ctx = canvas.getContext("2d");
    if (view === "compare") {
      canvas.width = W * 2;
      canvas.height = H;
      ctx.drawImage(original.img, 0, 0);
      ctx.fillStyle = "#222";
      ctx.fillRect(W, 0, W, H);
      ctx.drawImage(tmp, W, 0);
    } else {
      canvas.width = W;
      canvas.height = H;
      ctx.fillStyle = "#222";
      ctx.fillRect(0, 0, W, H);
      if (view === "boxes") ctx.globalAlpha = 0.6;
      ctx.drawImage(tmp, 0, 0);
      ctx.globalAlpha = 1;
      if (view === "boxes") {
        ctx.lineWidth = Math.max(2, W / 400);
        ctx.font = `${Math.max(12, W / 50)}px sans-serif`;
        for (const p of res.pieces) {
          ctx.strokeStyle = "#00ffff";
          ctx.strokeRect(p.x, p.y, p.width, p.height);
          ctx.fillStyle = "#ffffff";
          ctx.fillText(`${p.order} ${p.name}`, p.x + 4, p.y + Math.max(14, W / 45));
          ctx.fillStyle = "#ff3366";
          ctx.beginPath();
          ctx.arc(p.pivot.x, p.pivot.y, Math.max(4, W / 150), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }, [res, view, original]);

  async function downloadZip() {
    if (!res) return;
    const zip = new JSZip();
    const base = (fileName || "personaggio").replace(/\.[^.]+$/, "");
    const folder = zip.folder(`${base}_pezzi`);
    for (const p of res.pieces) folder.file(`${p.name}.png`, await toBlob(pieceCanvas(p)));
    const layout = {
      source: fileName,
      sheet: res.sheetName,
      size: [original.width, original.height],
      scale: res.scale,
      fedele: res.faithful,
      utilizzabile: res.usable,
      erroreFedelta: res.fidelityError,
      pezziOk: res.piecesOk,
      manoOggetto: res.handObjects || [],
      raccordi: res.finishing,
      note: "x,y = angolo in alto a sinistra del pezzo nell'immagine originale; pivot in coordinate dell'immagine originale; order = ordine di disegno (0 = dietro).",
      pieces: res.pieces.map((p) => ({
        name: p.name,
        file: `${p.name}.png`,
        order: p.order,
        parent: p.parent,
        x: p.x,
        y: p.y,
        width: p.width,
        height: p.height,
        pivot: p.pivot,
        matchError: p.matchError,
        motionLocked: p.motionLocked || false,
        controllo: p.check && { livello: p.check.level, sagoma: p.check.fgShare, errore: p.check.localError, suTesta: p.check.onHead, problemi: p.check.issues }
      })),
      davantiDietro: res.front,
      avvisi: res.warnings
    };
    folder.file("layout.json", JSON.stringify(layout, null, 2));
    const W = original.width, H = original.height;
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    c.getContext("2d").putImageData(new ImageData(composePieces(res.pieces, W, H), W, H), 0, 0);
    folder.file("ricomposto.png", await toBlob(c));
    const blob = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${base}_pezzi.zip`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div style={{ marginTop: 24, paddingTop: 12, borderTop: "1px solid #333" }}>
      <h2>🧩 Tavola esplosa → pezzi</h2>
      <div className="hint">
        Carica la tavola con il personaggio già diviso in pezzi staccati (testa, busto, braccia, oggetti) su sfondo a
        tinta unita. L'app scontorna ogni pezzo, lo rimette al suo posto sull'immagine qui sopra, gli dà il nome dalla
        posa e decide chi sta davanti. Per generarla: allega l'immagine originale a Gemini/ChatGPT con questo prompt{" "}
        <button type="button" className="btn secondary" onClick={() => navigator.clipboard?.writeText(buildExplodedPrompt(chroma || undefined))}>
          📋 Copia prompt
        </button>{" "}
        <button type="button" className="btn secondary" title="Occhi, sopracciglia, bocca e ciocche come pezzi separati (battito degli occhi, capelli al vento)" onClick={() => navigator.clipboard?.writeText(buildExplodedPrompt(chroma || undefined, { face: true }))}>
          📋 Copia prompt con viso
        </button>
        {chroma && (
          <span style={{ marginLeft: 8 }}>
            sfondo consigliato per questo personaggio:{" "}
            <span style={{ display: "inline-block", width: 12, height: 12, background: chroma.hex, verticalAlign: "middle", borderRadius: 2 }} />{" "}
            <b>{chroma.hex}</b>
          </span>
        )}
      </div>
      <div className="row" style={{ gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <input type="file" accept="image/*" disabled={busy} onChange={handleSheet} />
        <button type="button" className="btn" disabled={busy || !original?.img} onClick={() => handlePartMap(null)} title="Gemini ricolora l'originale per parti; i pezzi si ritagliano dall'originale: niente tavola da ricomporre">
          🎨 Pezzi dalla mappa delle parti
        </button>
        {partComps && <span className="hint" style={{ margin: 0, color: "#3c3" }}>🎨 mappa pronta: ora carica la tavola, i pezzi verranno messi al loro posto con la mappa</span>}
        <label className="btn secondary" style={{ cursor: "pointer" }} title="Carica una mappa delle parti già generata (partmap.png)">
          📂 Carica mappa
          <input type="file" accept="image/*" style={{ display: "none" }} disabled={busy} onChange={(e) => e.target.files?.[0] && handlePartMap(e.target.files[0])} />
        </label>
        {res && (
          <>
            <select value={view} onChange={(e) => setView(e.target.value)}>
              <option value="compare">Originale | ricomposto</option>
              <option value="composed">Solo ricomposto</option>
              <option value="boxes">Pezzi, ordine e pivot</option>
            </select>
            <button type="button" className="btn secondary" onClick={downloadZip}>⬇️ Scarica pezzi (ZIP)</button>
            <button type="button" className="btn" disabled={busy} onClick={createCharacterFromPieces}>🦴 Crea character</button>
          </>
        )}
      </div>
      {status && <div className="status">{status}</div>}
      {res && (
        <>
          {res.warnings.length > 0 && (
            <div className="hint" style={{ color: "#ffb347" }}>
              {res.warnings.map((w) => (
                <div key={w}>⚠️ {w}</div>
              ))}
            </div>
          )}
          <canvas ref={canvasRef} style={{ maxWidth: "100%", height: "auto", border: "1px solid #333", borderRadius: 6 }} />
          <div className="row" style={{ gap: 12, flexWrap: "wrap", marginTop: 8 }}>
            {res.pieces.map((p) => (
              <PieceCard key={p.name} p={p} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const CHECK_COLOR = { ok: "#3c3", warn: "#ffb347", bad: "#ff3366" };

function PieceCard({ p }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    const src = pieceCanvas(p);
    const c = ref.current;
    const s = Math.min(1, 160 / Math.max(p.width, p.height));
    c.width = Math.round(p.width * s);
    c.height = Math.round(p.height * s);
    c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
  }, [p]);
  return (
    <div
      style={{ textAlign: "center", fontSize: 12, maxWidth: 200, padding: 4, borderRadius: 6, border: `2px solid ${CHECK_COLOR[p.check?.level] || "transparent"}` }}
      title={p.check?.issues.join("\n") || "controllo superato"}
    >
      <canvas
        ref={ref}
        style={{
          background: "repeating-conic-gradient(#555 0% 25%, #333 0% 50%) 50% / 16px 16px",
          borderRadius: 4,
          display: "block",
          margin: "0 auto 4px"
        }}
      />
      <b>{p.order}. {p.name}</b>
      <div>genitore: {p.parent || "—"}</div>
      <div>scarto: {p.matchError}</div>
      {p.check && (
        <div style={{ color: CHECK_COLOR[p.check.level] }}>
          {p.check.level === "ok" ? "✓ al suo posto" : p.check.level === "bad" ? "✗ fuori posto" : "⚠ da controllare"}
          {p.check.onHead != null && ` · su testa ${Math.round(p.check.onHead * 100)}%`}
        </div>
      )}
    </div>
  );
}
