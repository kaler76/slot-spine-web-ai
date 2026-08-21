import { useEffect, useRef, useState } from "react";

/**
 * Scansiona il canale alpha del canvas e trova il rettangolo più stretto che
 * contiene tutti i pixel non trasparenti. Ritorna null se l'immagine è
 * interamente trasparente (o quasi) e non c'è nulla da rilevare.
 */
function detectAlphaBoundingBox(ctx, width, height, alphaThreshold = 10) {
  const { data } = ctx.getImageData(0, 0, width, height);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha > alphaThreshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/**
 * Tool di ritaglio: riceve un file immagine, mostra un canvas su cui trascinare
 * una selezione, e chiama onDone(blob, width, height) al termine (con o senza ritaglio).
 * Al caricamento propone automaticamente un ritaglio stretto attorno al contenuto
 * non trasparente (utile per file con molto spazio vuoto attorno all'elemento reale).
 */
export default function CropTool({ file, onDone }) {
  const canvasRef = useRef(null);
  const imgRef = useRef(null);
  const [scale, setScale] = useState(1);
  const [selection, setSelection] = useState(null);
  const [dragStart, setDragStart] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [info, setInfo] = useState("Trascina sull'immagine per selezionare l'area del simbolo.");
  const [autoDetected, setAutoDetected] = useState(false);

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      const maxW = 560;
      const maxH = 380;
      const s = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1);
      setScale(s);
      const canvas = canvasRef.current;
      canvas.width = Math.round(img.naturalWidth * s);
      canvas.height = Math.round(img.naturalHeight * s);
      drawCanvas(null, s, img);

      // Rilevamento automatico: propone subito un ritaglio stretto attorno al
      // contenuto non trasparente, invece di partire da nessuna selezione.
      const ctx = canvas.getContext("2d");
      const box = detectAlphaBoundingBox(ctx, canvas.width, canvas.height);
      if (box && (box.w < canvas.width * 0.98 || box.h < canvas.height * 0.98)) {
        setSelection(box);
        setAutoDetected(true);
        drawCanvas(box, s, img);
        setInfo(
          `🪄 Rilevato automaticamente: ${Math.round(box.w / s)} × ${Math.round(
            box.h / s
          )} px. Puoi accettarlo con "Applica ritaglio" o ridisegnare la selezione.`
        );
      } else {
        setSelection(null);
        setAutoDetected(false);
        setInfo("Trascina sull'immagine per selezionare l'area del simbolo.");
      }
    };
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function redetect() {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext("2d");
    const box = detectAlphaBoundingBox(ctx, canvas.width, canvas.height);
    if (!box) {
      setInfo("⚠️ Nessun contenuto non trasparente rilevato.");
      return;
    }
    setSelection(box);
    setAutoDetected(true);
    drawCanvas(box, scale, img);
    setInfo(
      `🪄 Rilevato automaticamente: ${Math.round(box.w / scale)} × ${Math.round(
        box.h / scale
      )} px. Premi "Applica ritaglio" per confermare.`
    );
  }

  function drawCanvas(sel, s, img) {
    const canvas = canvasRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    if (sel) {
      ctx.strokeStyle = "#4f7cff";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(sel.x, sel.y, sel.w, sel.h);
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(79,124,255,0.15)";
      ctx.fillRect(sel.x, sel.y, sel.w, sel.h);
    }
  }

  function canvasCoords(evt) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: Math.max(0, Math.min(canvas.width, (evt.clientX - rect.left) * scaleX)),
      y: Math.max(0, Math.min(canvas.height, (evt.clientY - rect.top) * scaleY))
    };
  }

  function handleMouseDown(evt) {
    const start = canvasCoords(evt);
    setIsDragging(true);
    setAutoDetected(false);
    setDragStart(start);
    const sel = { x: start.x, y: start.y, w: 0, h: 0 };
    setSelection(sel);
    drawCanvas(sel, scale, imgRef.current);
  }

  function handleMouseMove(evt) {
    if (!isDragging || !dragStart) return;
    const cur = canvasCoords(evt);
    const sel = {
      x: Math.min(dragStart.x, cur.x),
      y: Math.min(dragStart.y, cur.y),
      w: Math.abs(cur.x - dragStart.x),
      h: Math.abs(cur.y - dragStart.y)
    };
    setSelection(sel);
    drawCanvas(sel, scale, imgRef.current);
  }

  function handleMouseUp() {
    if (!isDragging) return;
    setIsDragging(false);
    if (selection && (selection.w < 4 || selection.h < 4)) {
      setSelection(null);
      drawCanvas(null, scale, imgRef.current);
      setInfo("Selezione troppo piccola, riprova trascinando un'area più ampia.");
    } else if (selection) {
      setInfo(
        `Area selezionata: ${Math.round(selection.w / scale)} × ${Math.round(
          selection.h / scale
        )} px. Premi "Applica ritaglio" per confermare.`
      );
    }
  }

  function applyCrop() {
    if (!selection || selection.w < 4 || selection.h < 4) {
      setInfo("⚠️ Seleziona prima un'area trascinando sull'immagine.");
      return;
    }
    const sx = Math.round(selection.x / scale);
    const sy = Math.round(selection.y / scale);
    const sw = Math.round(selection.w / scale);
    const sh = Math.round(selection.h / scale);

    const outCanvas = document.createElement("canvas");
    outCanvas.width = sw;
    outCanvas.height = sh;
    outCanvas.getContext("2d").drawImage(imgRef.current, sx, sy, sw, sh, 0, 0, sw, sh);
    outCanvas.toBlob((blob) => onDone(blob, sw, sh), "image/png");
  }

  function useWholeImage() {
    const img = imgRef.current;
    const outCanvas = document.createElement("canvas");
    outCanvas.width = img.naturalWidth;
    outCanvas.height = img.naturalHeight;
    outCanvas.getContext("2d").drawImage(img, 0, 0);
    outCanvas.toBlob((blob) => onDone(blob, img.naturalWidth, img.naturalHeight), "image/png");
  }

  if (!file) return null;

  return (
    <div className="crop-section">
      <h3 className="section-subtitle">✂️ Ritaglia l'area del simbolo</h3>
      <div className="crop-canvas-wrap">
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        />
      </div>
      <div className="hint crop-info">{info}</div>
      <div className="btn-row">
        <button type="button" className="btn secondary" onClick={redetect}>
          🪄 Rileva automaticamente
        </button>
        <button type="button" className="btn secondary" onClick={applyCrop}>
          ✂️ Applica ritaglio
        </button>
        <button type="button" className="btn secondary" onClick={useWholeImage}>
          Usa immagine intera
        </button>
      </div>
    </div>
  );
}
