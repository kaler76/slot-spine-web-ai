// Pagina "Personaggio animato": dalle 3 tavole del kit (posa neutra, corpo esploso, viso) al pacchetto
// Spine 4.1 con le animazioni della libreria biped, viso in mesh ed espressioni deformate.
// Tutto client-side (Web Worker), niente Supabase: per ora si caricano tavole già generate.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import JSZip from "jszip";
import { SpinePlayer } from "@esotericsoftware/spine-player";
import "@esotericsoftware/spine-player/dist/spine-player.css";
import { ANIMATIONS } from "../lib/biped/animationLibrary.js";
import { KIT_IMPORT_VERSION } from "../lib/biped/kitImport.js";
import { BIPED_RULES_VERSION } from "../lib/biped/bipedSpec.js";
import ActionButton from "../components/ui/ActionButton.jsx";
import BusyStage from "../components/ui/BusyStage.jsx";

const STEPS = ["Leggo le tavole", "Ritaglio i pezzi, costruisco ossa e mesh", "Genero le animazioni e l'anteprima"];

const SLOTS = [
  { key: "reference", label: "1 · Posa neutra", hint: "personaggio intero in posa neutra, fondo chroma (es. zeus_neutro.png)" },
  { key: "bodySheet", label: "2 · Tavola corpo", hint: "9 pezzi esplosi: testa, capelli dietro, busto, 3 per braccio (es. zeus_kit_corpo.png)" },
  { key: "faceSheet", label: "3 · Tavola viso", hint: "riga 1: occhi e sopracciglia; riga 2: 5 bocche (es. zeus_kit_viso.png)" }
];

async function fileToImage(file) {
  const bmp = await createImageBitmap(file);
  const c = document.createElement("canvas");
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext("2d");
  ctx.drawImage(bmp, 0, 0);
  const d = ctx.getImageData(0, 0, bmp.width, bmp.height);
  return { width: d.width, height: d.height, rgba: d.data.buffer };
}

async function rgbaToPngBlob({ width, height, rgba }) {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  c.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
  return new Promise((res) => c.toBlob(res, "image/png"));
}

const blobToDataUrl = (b) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(b); });

export default function AnimatedCharacterPage() {
  const [files, setFiles] = useState({});
  const [previews, setPreviews] = useState({});
  const [name, setName] = useState("personaggio");
  const [layout, setLayout] = useState("zeus");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(-1); // fase in corso (palco dell'attesa); STEPS.length = finito
  const [pkg, setPkg] = useState(null);
  const [anim, setAnim] = useState("intro");
  const playerBox = useRef(null);
  const playerRef = useRef(null);

  function pick(key, file) {
    if (!file) return;
    setFiles((f) => ({ ...f, [key]: file }));
    setPreviews((p) => {
      if (p[key]) URL.revokeObjectURL(p[key]);
      return { ...p, [key]: URL.createObjectURL(file) };
    });
    if (key === "reference") {
      const base = file.name.replace(/\.[^.]+$/, "").replace(/_?(neutr[oa]|posa|reference)$/i, "");
      if (base) setName(base.replace(/[^a-z0-9_-]/gi, "_").toLowerCase());
    }
  }

  async function run() {
    setBusy(true);
    setPkg(null);
    setStatus("");
    setStep(0);
    try {
      const [reference, bodySheet, faceSheet] = await Promise.all(SLOTS.map((s) => fileToImage(files[s.key])));
      setStep(1);
      const worker = new Worker(new URL("../lib/biped/bipedWorker.js", import.meta.url), { type: "module" });
      const res = await new Promise((resolve) => {
        worker.onmessage = (e) => resolve(e.data);
        worker.onerror = (e) => resolve({ ok: false, error: e.message });
        worker.postMessage({ reference, bodySheet, faceSheet, name, options: layout === "grid" ? { layout: "grid" } : {} }, [reference.rgba, bodySheet.rgba, faceSheet.rgba]);
      });
      worker.terminate();
      if (!res.ok) throw new Error(res.error);
      setStep(2);
      const pagePng = await rgbaToPngBlob(res.page);
      setPkg({ ...res, pagePng });
      const w = res.report.warnings || [];
      setStep(STEPS.length);
      setTimeout(() => setStep(-1), 2200);
      setStatus(`Pronto in ${res.seconds.toFixed(1)} s: ${res.json.bones.length} ossa, ${Object.keys(res.json.animations).length} animazioni.` + (w.length ? ` Attenzione: ${w.join("; ")}` : ""));
    } catch (err) {
      setStep(-1);
      setStatus(`Non riesco a creare il personaggio: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  // anteprima con il runtime ufficiale 4.1 sugli stessi file del pacchetto
  useEffect(() => {
    if (!pkg || !playerBox.current) return;
    let cancelled = false;
    (async () => {
      const uris = {
        [`${name}.json`]: "data:application/json;base64," + btoa(unescape(encodeURIComponent(JSON.stringify(pkg.json)))),
        [`${name}.atlas`]: "data:text/plain;base64," + btoa(pkg.atlas),
        [`${name}.png`]: await blobToDataUrl(pkg.pagePng)
      };
      if (cancelled) return;
      playerBox.current.innerHTML = "";
      playerRef.current = new SpinePlayer(playerBox.current, {
        jsonUrl: `${name}.json`,
        atlasUrl: `${name}.atlas`,
        rawDataURIs: uris,
        animation: anim,
        premultipliedAlpha: false,
        backgroundColor: "#2a2b31",
        showControls: true,
        error: (_p, msg) => setStatus(`❌ Anteprima: ${msg}`)
      });
    })();
    return () => {
      cancelled = true;
      try { playerRef.current?.dispose(); } catch { /* già chiuso */ }
      playerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pkg]);

  function play(a) {
    setAnim(a);
    try { playerRef.current?.setAnimation(a, true); } catch { /* player non pronto */ }
  }

  async function download() {
    const zip = new JSZip();
    zip.file(`${name}/${name}.json`, JSON.stringify(pkg.json, null, 1));
    zip.file(`${name}/${name}.atlas`, pkg.atlas);
    zip.file(`${name}/${name}.png`, pkg.pagePng);
    for (const s of SLOTS) zip.file(`tavole/${files[s.key].name}`, files[s.key]);
    zip.file(
      "LEGGIMI.txt",
      `Personaggio animato Spine 4.1 (${BIPED_RULES_VERSION}, ${KIT_IMPORT_VERSION})\n\n` +
        `Runtime/gioco: ${name}/${name}.json + .atlas + .png\n` +
        `Animazioni: ${Object.keys(pkg.json.animations).join(", ")}\n` +
        `Viso in mesh: le espressioni sono chiavi di deformazione; bocca aperta e a O sovrapposte con trasparenza.\n` +
        (pkg.clamped.length ? `\nLimiti anatomici applicati: ${pkg.clamped.join("; ")}\n` : "") +
        `\nRapporto importazione:\n${JSON.stringify(pkg.report, null, 1)}\n`
    );
    const blob = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${name}_spine41.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  const ready = SLOTS.every((s) => files[s.key]);

  return (
    <div className="page page-wide">
      <p><Link to="/">← Home</Link></p>
      <h1>🎭 Personaggio animato <span className="ver">{BIPED_RULES_VERSION}</span></h1>
      <div className="hint">
        Carica le 3 tavole del kit (fondo chroma). L'app ritaglia i pezzi, li rimette sulla posa, costruisce ossa e IK
        entro i limiti anatomici, incorpora il viso originale in una mesh e genera {ANIMATIONS.length} animazioni: {ANIMATIONS.join(", ")}.
        Esporta Spine 4.1. Per Zeus: le tavole sono nella cartella <code>tavole/</code> dello zip di prova.
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginTop: 16 }}>
        {SLOTS.map((s) => (
          <label key={s.key} className="card" style={{ padding: 12, cursor: "pointer" }}>
            <strong>{s.label}</strong>
            <div className="hint" style={{ fontSize: 12 }}>{s.hint}</div>
            <input type="file" accept="image/png,image/webp,image/jpeg" style={{ marginTop: 8 }} onChange={(e) => pick(s.key, e.target.files?.[0])} />
            {previews[s.key] && <img src={previews[s.key]} alt={s.label} style={{ width: "100%", maxHeight: 180, objectFit: "contain", marginTop: 8, background: "#111" }} />}
          </label>
        ))}
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 16, flexWrap: "wrap" }}>
        <label>
          Tavola corpo{" "}
          <select value={layout} onChange={(e) => setLayout(e.target.value)}>
            <option value="zeus">esploso 9 pezzi (testa, capelli, busto, 3 per braccio)</option>
            <option value="grid">griglia 10 pezzi, mesh pesate (testa, capelli, mantello, ciocche, busto, braccia intere, mani)</option>
          </select>
        </label>
        <label>Nome <input value={name} onChange={(e) => setName(e.target.value.replace(/[^a-z0-9_-]/gi, "_"))} /></label>
        <ActionButton busy={busy} busyLabel="Creo il personaggio…" doneLabel="Personaggio pronto" disabled={!ready} onClick={run}>Crea personaggio animato</ActionButton>
        {pkg && <ActionButton className="btn secondary" onClick={download}>Scarica lo zip Spine 4.1</ActionButton>}
      </div>
      {step >= 0 && (
        <BusyStage title="Creo il personaggio animato" doneTitle="Eccolo, è vivo!" steps={STEPS} step={Math.min(step, STEPS.length - 1)} done={step >= STEPS.length} result={["crown", "crown", "crown"]} />
      )}
      {status && step < 0 && <p className={`status${status.startsWith("Non riesco") ? " error" : ""}`}>{status}</p>}

      {pkg && (
        <div className="card" style={{ marginTop: 16, padding: 16 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            {Object.keys(pkg.json.animations).map((a) => (
              <button key={a} className={a === anim ? "btn tiny" : "btn tiny secondary"} aria-pressed={a === anim} onClick={() => play(a)}>{a}</button>
            ))}
          </div>
          <div ref={playerBox} style={{ width: "100%", height: 620 }} />
          {pkg.clamped.length > 0 && <div className="hint" style={{ marginTop: 8 }}>Limiti anatomici applicati: {pkg.clamped.join("; ")}</div>}
        </div>
      )}
    </div>
  );
}
