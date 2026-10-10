import { useEffect, useRef, useState } from "react";
import { MANUAL_POINTS, OUTSIDE_OK, landmarksFromClicks } from "../lib/poseRecovery.js";

/**
 * Posa manuale (gratuita): quando la posa non si ricava in automatico (es. cavaliere con
 * elmo chiuso) l'utente clicca 9 punti sull'immagine. I click diventano i 33 landmark
 * MediaPipe (landmarksFromClicks) e l'analisi prosegue come con la posa automatica.
 */
export default function ManualPosePicker({ img, width: W, height: H, onDone, onCancel }) {
  const [clicks, setClicks] = useState({});
  const [twoHands, setTwoHands] = useState(false);
  const canvasRef = useRef(null);
  const next = MANUAL_POINTS.find((p) => !clicks[p.key]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const r = Math.max(5, W / 120);
    ctx.font = `bold ${Math.max(14, W / 50)}px sans-serif`;
    MANUAL_POINTS.forEach((p, i) => {
      const q = clicks[p.key];
      if (!q || q.outside) return;
      ctx.fillStyle = p.key.endsWith("Sx") ? "#00e5ff" : p.key.endsWith("Dx") ? "#ff4fa0" : "#ffe14f";
      ctx.beginPath();
      ctx.arc(q.x, q.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillText(String(i + 1), q.x + r + 2, q.y - r);
    });
  }, [img, W, H, clicks]);

  function handleClick(e) {
    if (!next) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const y = ((e.clientY - rect.top) / rect.height) * H;
    setClicks((c) => ({ ...c, [next.key]: { x, y } }));
  }

  function undo() {
    const placed = MANUAL_POINTS.filter((p) => clicks[p.key]);
    if (!placed.length) return;
    const last = placed[placed.length - 1].key;
    setClicks((c) => {
      const n = { ...c };
      delete n[last];
      return n;
    });
  }

  function done() {
    const landmarks = landmarksFromClicks(clicks);
    onDone({ landmarks, heldObjects: twoHands ? [{ label: "oggetto", hands: ["left", "right"] }] : [] });
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div className="status">
        ✋ Posa non riconosciuta in automatico: indicala tu con 9 click (gratis).{" "}
        {next ? (
          <b>
            Punto {MANUAL_POINTS.indexOf(next) + 1}/9: {next.label}
          </b>
        ) : (
          <b>Tutti i punti indicati.</b>
        )}
      </div>
      <div className="row" style={{ gap: 12, alignItems: "center", flexWrap: "wrap", margin: "8px 0" }}>
        <button type="button" className="btn secondary" onClick={undo} disabled={!Object.keys(clicks).length}>
          ↶ Annulla ultimo
        </button>
        <label className="field-label-inline">
          <input type="checkbox" checked={twoHands} onChange={(e) => setTwoHands(e.target.checked)} /> Tiene un oggetto con
          tutte e due le mani
        </label>
        {next && OUTSIDE_OK.has(next.key) && (
          <button
            type="button"
            className="btn secondary"
            title="Mezzo busto o braccio nascosto: il punto viene stimato in giù dalla spalla"
            onClick={() => setClicks((c) => ({ ...c, [next.key]: { outside: true } }))}
          >
            ⤓ Fuori dall'immagine / nascosto
          </button>
        )}
        <button type="button" className="btn" onClick={done} disabled={!!next}>
          ✅ Continua l'analisi
        </button>
        <button type="button" className="btn secondary" onClick={onCancel}>
          Annulla
        </button>
      </div>
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        style={{ maxWidth: "100%", maxHeight: "75vh", height: "auto", border: "1px solid #333", borderRadius: 6, cursor: next ? "crosshair" : "default" }}
      />
    </div>
  );
}
