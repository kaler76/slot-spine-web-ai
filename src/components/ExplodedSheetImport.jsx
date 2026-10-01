import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import JSZip from "jszip";
import { importExplodedSheet } from "../lib/explodedSheet.js";
import { composePieces } from "../lib/partExtraction.js";
import { preserveSharedGrip } from "../lib/sharedGrip.js";
import { piecesToCharacterParts } from "../lib/characterFromPieces.js";
import { createCharacter, saveCharacterPart } from "../lib/charactersRepository.js";

// Prompt per far generare la tavola esplosa a un modello di immagini (Gemini / ChatGPT),
// allegando l'immagine originale del personaggio.
export const EXPLODED_PROMPT = `Using the attached character image, create an EXPLODED VIEW sheet of the same character for 2D skeletal animation (Spine).
- Same character, same art style, same scale and same proportions as the original. Do not redesign anything.
- Split it into separate pieces: HEAD (including hat/hair/beard), TORSO WITH LEGS, LEFT ARM WITH HAND, RIGHT ARM WITH HAND, and EVERY HELD OBJECT as its own piece.
- Keep every piece as close as possible to its original position, just moved apart so that no piece touches or overlaps another (clear gap between pieces).
- Redraw the parts that were hidden: the neck/collar under the head, the shoulders where the arms attach (extend them a little under the joint), and the hand where it was holding an object.
- Background: flat solid pure blue #0018FF, no gradient, no shadows, no glow, no particles, no text.`;

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
export default function ExplodedSheetImport({ original, landmarks, joints, fileName, heldObjects = [] }) {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const [view, setView] = useState("compare");
  const canvasRef = useRef(null);
  const navigate = useNavigate();

  /** Crea un character (Supabase) con un osso per pezzo e apre la sua pagina per animarlo. */
  async function createCharacterFromPieces() {
    if (!res) return;
    if (!res.faithful && !window.confirm("La tavola NON è fedele all'originale: creare comunque il character?")) return;
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

  async function handleSheet(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setRes(null);
    setStatus("⏳ Separo i pezzi e li rimetto al loro posto...");
    try {
      const img = await loadImage(file);
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const sheet = { width: c.width, height: c.height, rgba: ctx.getImageData(0, 0, c.width, c.height).data };
      await new Promise((r) => setTimeout(r, 30)); // lascia aggiornare lo stato prima del calcolo
      const out = importExplodedSheet({ sheet, original, landmarks, joints });
      setRes({ ...out, sheetName: file.name });
      setStatus(
        out.faithful
          ? `✅ ${out.pieces.length} pezzi separati e rimessi al loro posto${out.scale !== 1 ? ` (scala ${out.scale.toFixed(2)})` : ""}. Tavola fedele (errore ${out.fidelityError}).`
          : `⚠️ ${out.pieces.length} pezzi separati, ma la tavola NON è fedele all'originale (errore ${out.fidelityError}): ricomposizione approssimata.`
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
      erroreFedelta: res.fidelityError,
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
        matchError: p.matchError
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
        <button type="button" className="btn secondary" onClick={() => navigator.clipboard?.writeText(EXPLODED_PROMPT)}>
          📋 Copia prompt
        </button>
      </div>
      <div className="row" style={{ gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <input type="file" accept="image/*" disabled={busy} onChange={handleSheet} />
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
    <div style={{ textAlign: "center", fontSize: 12 }}>
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
    </div>
  );
}
