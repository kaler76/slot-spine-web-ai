import { useEffect, useRef, useState } from "react";
import JSZip from "jszip";
import { SpinePlayer } from "@esotericsoftware/spine-player";
import "@esotericsoftware/spine-player/dist/spine-player.css";
import { buildMeshRig, packAtlas, findMouth, applyFrameClip, MESH_RIG_RULES, MESH_RIG_VERSION } from "../lib/meshRig.js";
import { SMILE_PROMPTS, isGeminiRefusal, mouthCropBox, cropRgba, smilePatchFromGemini } from "../lib/mouthGemini.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../lib/supabaseClient.js";
import { poseAt } from "../lib/animationSim.js";

// Gemini (gemini-3-pro-image-preview) tramite la funzione edge già in produzione: prompt personalizzato +
// immagine di riferimento; nessuna nuova funzione da pubblicare. Formato di uscita della funzione: 16:9, 1K.
const GEMINI_SIDE = 1376;
async function geminiEditMouth(cropCanvas, prompt) {
  const big = document.createElement("canvas");
  big.width = GEMINI_SIDE;
  big.height = Math.round((GEMINI_SIDE * 9) / 16);
  const g = big.getContext("2d");
  g.imageSmoothingQuality = "high";
  g.drawImage(cropCanvas, 0, 0, big.width, big.height);
  const b64 = big.toDataURL("image/png").split(",")[1];
  const res = await fetch(`${SUPABASE_URL}/functions/v1/generate-sprite-sheet`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SUPABASE_ANON_KEY}`, apikey: SUPABASE_ANON_KEY },
    // referenceAnalysisError valorizzato: la funzione salta l'analisi del riferimento (una chiamata in meno)
    body: JSON.stringify({ group: "face", promptOverride: prompt, referenceImagesBase64: [b64], referenceAnalysisError: "non richiesta: ritocco della bocca" })
  });
  const raw = await res.text();
  let data;
  try { data = JSON.parse(raw); } catch { throw new Error(`Risposta non valida (HTTP ${res.status}): ${raw.slice(0, 200)}`); }
  if (!res.ok || data?.error || !data?.imageBase64) throw new Error(data?.error || `Errore HTTP ${res.status}`);
  return data.imageBase64;
}
function loadB64(b64) {
  return new Promise((ok, ko) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => ko(new Error("immagine di Gemini non leggibile")); im.src = `data:image/png;base64,${b64}`; });
}
function canvasOf(rgba, w, h) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  c.getContext("2d").putImageData(new ImageData(rgba instanceof Uint8ClampedArray ? rgba : new Uint8ClampedArray(rgba), w, h), 0, 0);
  return c;
}

/**
 * Metodo MESH (docs/REGOLE_MESH.md): dall'originale analizzato in "Riconosci parti" crea il
 * pacchetto Spine 4.1 (json + atlas a pagina unica + png + images/ per Import Data),
 * con la scelta automatica di cosa tagliare (braccio con oggetto, capelli lunghi, occhi) e
 * cosa animare in mesh. Anteprima col player ufficiale Spine 4.1.56. Niente database.
 */
export default function MeshRigExport({ original, landmarks, joints, parts, categories, alpha, fileName }) {
  const [boost, setBoost] = useState(1);
  const [cuts, setCuts] = useState({ ...MESH_RIG_RULES.cuts });
  const [smile, setSmile] = useState("no");
  const [lockObject, setLockObject] = useState(true); // oggetto in mano fermo (maschera block), il resto si muove
  const [smileHow, setSmileHow] = useState("gemini"); // "gemini" = bocca ridisegnata, "mesh" = deformazione
  const [smileKind, setSmileKind] = useState("chiusa");
  const [gem, setGem] = useState(null); // { kind, patch, previews: { orig, gen, result } }
  const [pkg, setPkg] = useState(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const playerBox = useRef(null);
  // INQUADRATURA dell'anteprima: solo la porzione d'interesse (coordinate dello skeleton, y in alto); null = tutto
  const [frame, setFrame] = useState(null);
  const [clipPkg, setClipPkg] = useState(true); // inquadratura anche nel pacchetto (maschera di ritaglio Spine)
  const outJson = () => (frame && clipPkg ? applyFrameClip(pkg.json, frame) : pkg.json);
  const playerRef = useRef(null);
  const base = (fileName || "character").replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]+/g, "_").toLowerCase() || "character";

  // a nuova analisi il pacchetto precedente non vale più
  useEffect(() => { setPkg(null); setGem(null); setFrame(null); }, [original, parts]);

  /** Bocca ridisegnata da Gemini: ritaglio del viso → Gemini → riallineamento → pezzo con bordo sfumato. */
  async function makeGeminiSmile(fg) {
    const { width: W, height: H, rgba } = original;
    const ipd = Math.hypot(landmarks[2].x - landmarks[5].x, landmarks[2].y - landmarks[5].y);
    const mouth = findMouth(landmarks, ipd, W, H, rgba, fg);
    const box = mouthCropBox(mouth);
    const orig = cropRgba(rgba, W, H, box);
    // sfondo grigio medio sotto il trasparente: Gemini lavora meglio su un'immagine piena
    const flat = new Uint8ClampedArray(orig);
    for (let i = 0; i < flat.length; i += 4) { const a = flat[i + 3] / 255; for (let k = 0; k < 3; k++) flat[i + k] = flat[i + k] * a + 128 * (1 - a); flat[i + 3] = 255; }
    // varianti del prompt in ordine: se Gemini rifiuta (IMAGE_OTHER...) si passa alla successiva
    const prompts = SMILE_PROMPTS[smileKind];
    let b64 = null, lastErr = null;
    for (let k = 0; k < prompts.length && !b64; k++) {
      setStatus(`⏳ Gemini ridisegna la bocca (20-60 s)${k ? ` — tentativo ${k + 1} di ${prompts.length}, Gemini aveva rifiutato` : ""}...`);
      try { b64 = await geminiEditMouth(canvasOf(flat, box.width, box.height), prompts[k]); }
      catch (e) { lastErr = e; if (!isGeminiRefusal(e.message)) throw e; }
    }
    if (!b64) throw Object.assign(new Error(`Gemini ha rifiutato ${prompts.length} volte (${lastErr?.message || "nessuna immagine"})`), { refused: true });
    const im = await loadB64(b64);
    const small = document.createElement("canvas");
    small.width = box.width; small.height = box.height;
    const sg = small.getContext("2d");
    sg.imageSmoothingQuality = "high";
    sg.drawImage(im, 0, 0, box.width, box.height);
    const gen = sg.getImageData(0, 0, box.width, box.height).data;
    const patch = smilePatchFromGemini({ orig, gen, box, mouth });
    if (patch.error) throw new Error(patch.error);
    // anteprime: originale, risposta di Gemini, risultato (pezzo sopra l'originale)
    const result = new Uint8ClampedArray(flat);
    for (let y = 0; y < patch.height; y++) for (let x = 0; x < patch.width; x++) {
      const cx = x + patch.x0 - box.x0, cy = y + patch.y0 - box.y0, i = (y * patch.width + x) * 4, o = (cy * box.width + cx) * 4, a = patch.rgba[i + 3] / 255;
      if (cx < 0 || cy < 0 || cx >= box.width || cy >= box.height) continue;
      for (let k = 0; k < 3; k++) result[o + k] = result[o + k] * (1 - a) + patch.rgba[i + k] * a;
    }
    const url = (c) => c.toDataURL("image/png");
    const g = { kind: smileKind, patch, previews: { orig: url(canvasOf(flat, box.width, box.height)), gen: url(small), result: url(canvasOf(result, box.width, box.height)) } };
    setGem(g);
    return g;
  }

  async function build(forceGemini = false) {
    setBusy(true);
    setStatus("⏳ Creo il rig mesh...");
    try {
      await new Promise((r) => setTimeout(r, 30)); // lascia disegnare lo stato
      const { width: W, height: H, rgba } = original;
      const fg = new Uint8Array(W * H);
      for (let i = 0; i < W * H; i++) fg[i] = alpha ? (alpha[i] >= 128 ? 1 : 0) : categories[i] ? 1 : 0;
      const rules = {
        ...MESH_RIG_RULES,
        cuts,
        smile,
        lockObject,
        amp: Object.fromEntries(Object.entries(MESH_RIG_RULES.amp).map(([k, v]) => [k, v * boost]))
      };
      let smilePatch = null, fallbackNote = "";
      if (smile !== "no" && smileHow === "gemini") {
        try {
          const g = gem && gem.kind === smileKind && !forceGemini ? gem : await makeGeminiSmile(fg);
          smilePatch = g.patch;
        } catch (e) {
          if (!e.refused) throw e;
          // Gemini non disegna questo viso (filtro: spesso volti che sembrano persone reali): si usa la deformazione
          rules.smile = smile;
          fallbackNote = ` ⚠️ ${e.message}: usata la deformazione (senza AI). Per riprovare con Gemini premi di nuovo "Ricrea".`;
        }
        setStatus("⏳ Creo il rig mesh...");
      }
      const { json, images, report } = buildMeshRig({ width: W, height: H, rgba, fg, parts, categories, landmarks, joints, smilePatch }, rules);
      json.skeleton.images = "./images/";
      const page = packAtlas(images, `${base}.png`);
      const pngs = {};
      for (const [n, im] of Object.entries(images)) pngs[n] = await toPng(im);
      const pagePng = await toPng(page);
      setPkg({ json, atlas: page.text, pagePng, pngs, report });
      setStatus(`✅ Rig creato: ${report.bones} ossa, ${report.slots.length} slot, ${report.bodyVertices} vertici sul corpo.${fallbackNote}`);
    } catch (err) {
      setStatus(`❌ ${err.message || err}`);
    } finally {
      setBusy(false);
    }
  }

  // anteprima: runtime ufficiale 4.1 sugli stessi file del pacchetto
  useEffect(() => {
    if (!pkg || !playerBox.current) return;
    let cancelled = false;
    (async () => {
      const uris = {
        [`${base}.json`]: "data:application/json;base64," + btoa(unescape(encodeURIComponent(JSON.stringify(outJson())))),
        [`${base}.atlas`]: "data:text/plain;base64," + btoa(pkg.atlas),
        [`${base}.png`]: await blobToDataUrl(pkg.pagePng)
      };
      if (cancelled) return;
      playerBox.current.innerHTML = "";
      playerRef.current = new SpinePlayer(playerBox.current, {
        jsonUrl: `${base}.json`,
        atlasUrl: `${base}.atlas`,
        rawDataURIs: uris,
        animation: "ambient",
        premultipliedAlpha: false,
        backgroundColor: "#2a2b31",
        showControls: true,
        ...(frame ? { viewport: { ...frame, padLeft: "2%", padRight: "2%", padTop: "2%", padBottom: "2%", transitionTime: 0 } } : {}),
        error: (_p, msg) => setStatus(`❌ Anteprima: ${msg}`)
      });
    })();
    return () => {
      cancelled = true;
      try { playerRef.current?.dispose(); } catch { /* già chiuso */ }
      playerRef.current = null;
    };
  }, [pkg, base, frame, clipPkg]);

  async function download() {
    const zip = new JSZip();
    zip.file(`${base}.json`, JSON.stringify(outJson(), null, 1));
    zip.file(`${base}.atlas`, pkg.atlas);
    zip.file(`${base}.png`, pkg.pagePng);
    for (const [n, b] of Object.entries(pkg.pngs)) zip.file(`images/${n}.png`, b);
    zip.file(
      "LEGGIMI.txt",
      `Pacchetto Spine 4.1 (metodo mesh ${MESH_RIG_VERSION})\n\n` +
        `Runtime/gioco: ${base}.json + ${base}.atlas + ${base}.png\n` +
        `Editor Spine 4.1.x: Spine > Importa dati > ${base}.json (immagini in ./images/)\n` +
        `Nota: Spine Trial gira sempre sull'ultima versione e non apre file 4.1: serve l'editor 4.1 con licenza.\n\n` +
        `Scelte automatiche:\n${pkg.report.decision.map((r) => " - " + r).join("\n")}\n` +
        (frame && clipPkg ? `\nInquadratura: maschera di ritaglio "inquadratura" (x ${Math.round(frame.x)}, y ${Math.round(frame.y)}, ${Math.round(frame.width)}×${Math.round(frame.height)}); per il personaggio intero nascondi o elimina lo slot "inquadratura".\n` : "")
    );
    const blob = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${base}_mesh_spine41${frame && clipPkg ? "_inquadrato" : ""}.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  return (
    <div className="card" style={{ marginTop: 16, padding: 16 }}>
      <h2 style={{ marginTop: 0 }}>🦴 Crea character Spine (metodo mesh) <span style={{ fontSize: 13, fontWeight: 400, opacity: 0.75 }}>· {MESH_RIG_VERSION}</span></h2>
      <div className="hint">
        L'originale resta intero e si deforma in mesh pesata sulle ossa della posa. Si tagliano solo: il braccio che tiene
        un oggetto, i capelli lunghi dietro le spalle e gli occhi (bianco, pupilla, palpebra). Animazione "ambient" in loop
        di {MESH_RIG_RULES.loopSeconds} s con battito di ciglia; a scelta il sorriso (gli angoli della bocca salgono, anche
        da una bocca all'ingiù). Esporta Spine 4.1.
      </div>
      <div className="row" style={{ gap: 16, alignItems: "center", flexWrap: "wrap", margin: "8px 0" }}>
        {[["arm", "Taglia braccio con oggetto"], ["hair", "Taglia capelli lunghi"], ["eyes", "Occhi animati"], ["earrings", "Orecchini pendenti"]].map(([k, label]) => (
          <label key={k} className="field-label-inline">
            <input type="checkbox" checked={cuts[k]} disabled={busy} onChange={(e) => setCuts({ ...cuts, [k]: e.target.checked })} /> {label}
          </label>
        ))}
        <label className="field-label-inline" title="Braccio e oggetto (arco, spada...) restano fermi; il resto del personaggio si muove">
          <input type="checkbox" checked={lockObject} disabled={busy || !cuts.arm} onChange={(e) => setLockObject(e.target.checked)} /> 🔒 Oggetto fermo
        </label>
        <label className="field-label-inline">
          😊 Sorriso
          <select value={smile} disabled={busy} onChange={(e) => setSmile(e.target.value)} style={{ marginLeft: 6 }}>
            <option value="no">no (bocca del disegno)</option>
            <option value="loop">nel loop (sorride e torna)</option>
            <option value="sempre">sempre (sorriso fisso)</option>
          </select>
          {smile !== "no" && (
            <>
              <select value={smileHow} disabled={busy} onChange={(e) => setSmileHow(e.target.value)} style={{ marginLeft: 6 }}>
                <option value="gemini">bocca ridisegnata (Gemini)</option>
                <option value="mesh">deformazione (senza AI)</option>
              </select>
              {smileHow === "gemini" && (
                <select value={smileKind} disabled={busy} onChange={(e) => setSmileKind(e.target.value)} style={{ marginLeft: 6 }}>
                  <option value="chiusa">bocca chiusa</option>
                  <option value="aperta">con i denti</option>
                </select>
              )}
            </>
          )}
        </label>
        <label className="field-label-inline">
          Intensità
          <select value={boost} disabled={busy} onChange={(e) => setBoost(Number(e.target.value))} style={{ marginLeft: 6 }}>
            <option value={0.5}>bassa</option>
            <option value={1}>normale</option>
            <option value={1.5}>alta</option>
          </select>
        </label>
        <button type="button" className="btn" disabled={busy} onClick={() => build(false)}>
          {pkg ? "🔄 Ricrea" : "▶️ Crea character"}
        </button>
        {pkg && (
          <button type="button" className="btn secondary" onClick={download}>⬇️ Scarica pacchetto Spine 4.1</button>
        )}
      </div>
      {status && <div className="status">{status}</div>}
      {gem && smile !== "no" && smileHow === "gemini" && (
        <div className="row" style={{ gap: 10, alignItems: "flex-end", flexWrap: "wrap", margin: "8px 0" }}>
          {[["Originale", gem.previews.orig], ["Gemini", gem.previews.gen], ["Risultato", gem.previews.result]].map(([t, u]) => (
            <figure key={t} style={{ margin: 0, textAlign: "center", fontSize: 12 }}>
              <img src={u} alt={t} style={{ width: 220, borderRadius: 4, border: "1px solid #333" }} />
              <figcaption>{t}</figcaption>
            </figure>
          ))}
          <div style={{ fontSize: 12, opacity: 0.8 }}>
            Riallineamento: {gem.patch.shift.dx.toFixed(1)}, {gem.patch.shift.dy.toFixed(1)} px, scala {gem.patch.shift.s.toFixed(3)}
            {gem.patch.mismatch > 22 && <div style={{ color: "#ffb347" }}>⚠️ Gemini ha cambiato anche il resto del viso: meglio ridisegnare.</div>}
            <div>
              <button type="button" className="btn secondary" disabled={busy} onClick={() => build(true)} style={{ marginTop: 6 }}>🔄 Ridisegna bocca (Gemini)</button>
            </div>
          </div>
        </div>
      )}
      {pkg && (
        <>
          <table style={{ borderCollapse: "collapse", margin: "8px 0", fontSize: 13 }}>
            <tbody>
              {pkg.report.decision.map((r) => {
                const [what, how] = r.split(/:\s(.+)/);
                return (
                  <tr key={r}>
                    <td style={{ padding: "2px 12px 2px 0", opacity: 0.8 }}>{what}</td>
                    <td style={{ padding: "2px 0", color: /TAGLIO|buco/.test(how || "") ? "#ffb347" : "#7fd18b" }}>{how}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="row" style={{ gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
            <div ref={playerBox} style={{ flex: "1 1 420px", maxWidth: 640, height: 640, borderRadius: 6, overflow: "hidden" }} />
            <FrameTool pkg={pkg} frame={frame} onChange={setFrame} clipPkg={clipPkg} onClipPkg={setClipPkg} />
          </div>
        </>
      )}
    </div>
  );
}

function toPng(im) {
  const c = document.createElement("canvas");
  c.width = im.width;
  c.height = im.height;
  const data = im.rgba instanceof Uint8ClampedArray ? im.rgba : new Uint8ClampedArray(im.rgba.buffer, im.rgba.byteOffset, im.rgba.length);
  c.getContext("2d").putImageData(new ImageData(data, im.width, im.height), 0, 0);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("PNG non creato"))), "image/png"));
}

function blobToDataUrl(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}

/**
 * Strumento INQUADRATURA: miniatura del personaggio su cui si trascina un rettangolo; l'anteprima mostra solo quella
 * porzione (viewport del player Spine). Preimpostati: Tutto, Viso, Busto. Non cambia il pacchetto scaricato.
 */
function FrameTool({ pkg, frame, onChange, clipPkg, onClipPkg }) {
  const sk = pkg.json.skeleton, cw = sk.width, ch = sk.height;
  const TW = 200, sc = TW / cw, TH = Math.round(ch * sc);
  const [url, setUrl] = useState(null);
  const [drag, setDrag] = useState(null); // { x0, y0, x1, y1 } in pixel della miniatura
  useEffect(() => {
    const u = URL.createObjectURL(pkg.pngs.corpo);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [pkg]);
  // pixel miniatura <-> skeleton (la miniatura è l'immagine del corpo = riquadro dello skeleton)
  const toSk = (px, py) => ({ x: px / sc + sk.x, y: sk.y + ch - py / sc });
  const fromSk = (f) => ({ left: (f.x - sk.x) * sc, top: (sk.y + ch - (f.y + f.height)) * sc, width: f.width * sc, height: f.height * sc });
  const preset = (kind) => {
    if (kind === "tutto") return onChange(null);
    const w = poseAt(pkg.json, 0, "ambient"), v = w.viso, n = w.collo, a = w.anca;
    const sw = Math.hypot(w.omero_sx.tx - w.omero_dx.tx, w.omero_sx.ty - w.omero_dx.ty);
    if (kind === "viso") { const r = 0.75 * sw; return onChange({ x: v.tx - r, y: v.ty - r * 0.9, width: 2 * r, height: 2 * r }); }
    // busto: dalla vita a sopra la testa, larghezza 2,2 spalle; si allarga per comprendere le braccia TAGLIATE sopra
    // la vita (braccio alzato col bocchino e il fumo di Jessica: tagliati fuori dal riquadro) + 8% per il movimento
    let x0 = n.tx - 1.1 * sw, x1 = n.tx + 1.1 * sw, top = v.ty + 0.9 * sw;
    const bot = a.ty + 0.1 * sw;
    for (const [name, b] of Object.entries(pkg.report?.pieceBoxes || {})) {
      if (!name.startsWith("braccio_") || b.y + b.height < bot) continue;
      const m = 0.08 * Math.max(b.width, b.height);
      x0 = Math.min(x0, b.x - m); x1 = Math.max(x1, b.x + b.width + m); top = Math.max(top, b.y + b.height + m);
    }
    return onChange({ x: x0, y: bot, width: x1 - x0, height: top - bot });
  };
  const pos = (e) => { const r = e.currentTarget.getBoundingClientRect(); return { x: Math.max(0, Math.min(TW, e.clientX - r.left)), y: Math.max(0, Math.min(TH, e.clientY - r.top)) }; };
  const onDown = (e) => { const p = pos(e); setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y }); };
  const onMove = (e) => { if (drag) { const p = pos(e); setDrag({ ...drag, x1: p.x, y1: p.y }); } };
  const onUp = () => {
    if (!drag) return;
    const l = Math.min(drag.x0, drag.x1), r = Math.max(drag.x0, drag.x1), t = Math.min(drag.y0, drag.y1), b = Math.max(drag.y0, drag.y1);
    setDrag(null);
    if (r - l < 6 || b - t < 6) return; // clic senza trascinare: nessun cambio
    const a = toSk(l, b), c = toSk(r, t);
    onChange({ x: a.x, y: a.y, width: c.x - a.x, height: c.y - a.y });
  };
  const box = drag
    ? { left: Math.min(drag.x0, drag.x1), top: Math.min(drag.y0, drag.y1), width: Math.abs(drag.x1 - drag.x0), height: Math.abs(drag.y1 - drag.y0) }
    : frame ? fromSk(frame) : null;
  return (
    <div style={{ width: TW, fontSize: 12 }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>🔍 Inquadratura</div>
      <div style={{ opacity: 0.75, marginBottom: 6 }}>Trascina un rettangolo per mostrare solo quella porzione.</div>
      <div
        onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}
        style={{ position: "relative", width: TW, height: TH, cursor: "crosshair", userSelect: "none", background: "#2a2b31", borderRadius: 4, overflow: "hidden" }}
      >
        {url && <img src={url} alt="" draggable={false} style={{ width: TW, height: TH, display: "block", pointerEvents: "none" }} />}
        {box && <div style={{ position: "absolute", ...box, border: "2px solid #ffb347", background: "rgba(255,179,71,0.12)", pointerEvents: "none" }} />}
      </div>
      <div className="row" style={{ gap: 4, marginTop: 6, flexWrap: "wrap" }}>
        {[["tutto", "Tutto"], ["viso", "Viso"], ["busto", "Busto"]].map(([k, l]) => (
          <button key={k} type="button" className="btn secondary" style={{ padding: "2px 8px", fontSize: 12 }} onClick={() => preset(k)}>{l}</button>
        ))}
      </div>
      <label className="field-label-inline" style={{ display: "block", marginTop: 8 }}>
        <input type="checkbox" checked={clipPkg} disabled={!frame} onChange={(e) => onClipPkg(e.target.checked)} /> ✂️ Ritaglia anche il pacchetto Spine
      </label>
      <div style={{ opacity: 0.6, marginTop: 4 }}>
        {frame && clipPkg ? "Lo zip avrà una maschera di ritaglio (slot \"inquadratura\"): si vede solo questa porzione." : "Lo zip resta con il personaggio intero."}
      </div>
    </div>
  );
}
