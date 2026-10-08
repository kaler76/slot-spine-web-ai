import { useEffect, useRef, useState } from "react";
import JSZip from "jszip";
import { SpinePlayer } from "@esotericsoftware/spine-player";
import "@esotericsoftware/spine-player/dist/spine-player.css";
import { buildMeshRig, packAtlas, MESH_RIG_RULES, MESH_RIG_VERSION } from "../lib/meshRig.js";

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
  const [pkg, setPkg] = useState(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const playerBox = useRef(null);
  const playerRef = useRef(null);
  const base = (fileName || "character").replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]+/g, "_").toLowerCase() || "character";

  // a nuova analisi il pacchetto precedente non vale più
  useEffect(() => setPkg(null), [original, parts]);

  async function build() {
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
        amp: Object.fromEntries(Object.entries(MESH_RIG_RULES.amp).map(([k, v]) => [k, v * boost]))
      };
      const { json, images, report } = buildMeshRig({ width: W, height: H, rgba, fg, parts, categories, landmarks, joints }, rules);
      json.skeleton.images = "./images/";
      const page = packAtlas(images, `${base}.png`);
      const pngs = {};
      for (const [n, im] of Object.entries(images)) pngs[n] = await toPng(im);
      const pagePng = await toPng(page);
      setPkg({ json, atlas: page.text, pagePng, pngs, report });
      setStatus(`✅ Rig creato: ${report.bones} ossa, ${report.slots.length} slot, ${report.bodyVertices} vertici sul corpo.`);
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
        [`${base}.json`]: "data:application/json;base64," + btoa(unescape(encodeURIComponent(JSON.stringify(pkg.json)))),
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
        error: (_p, msg) => setStatus(`❌ Anteprima: ${msg}`)
      });
    })();
    return () => {
      cancelled = true;
      try { playerRef.current?.dispose(); } catch { /* già chiuso */ }
      playerRef.current = null;
    };
  }, [pkg, base]);

  async function download() {
    const zip = new JSZip();
    zip.file(`${base}.json`, JSON.stringify(pkg.json, null, 1));
    zip.file(`${base}.atlas`, pkg.atlas);
    zip.file(`${base}.png`, pkg.pagePng);
    for (const [n, b] of Object.entries(pkg.pngs)) zip.file(`images/${n}.png`, b);
    zip.file(
      "LEGGIMI.txt",
      `Pacchetto Spine 4.1 (metodo mesh ${MESH_RIG_VERSION})\n\n` +
        `Runtime/gioco: ${base}.json + ${base}.atlas + ${base}.png\n` +
        `Editor Spine 4.1.x: Spine > Importa dati > ${base}.json (immagini in ./images/)\n` +
        `Nota: Spine Trial gira sempre sull'ultima versione e non apre file 4.1: serve l'editor 4.1 con licenza.\n\n` +
        `Scelte automatiche:\n${pkg.report.decision.map((r) => " - " + r).join("\n")}\n`
    );
    const blob = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${base}_mesh_spine41.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  return (
    <div className="card" style={{ marginTop: 16, padding: 16 }}>
      <h2 style={{ marginTop: 0 }}>🦴 Crea character Spine (metodo mesh)</h2>
      <div className="hint">
        L'originale resta intero e si deforma in mesh pesata sulle ossa della posa. Si tagliano solo: il braccio che tiene
        un oggetto, i capelli lunghi dietro le spalle e gli occhi (bianco, pupilla, palpebra). Animazione "ambient" in loop
        di {MESH_RIG_RULES.loopSeconds} s con battito di ciglia; a scelta il sorriso (gli angoli della bocca salgono, anche
        da una bocca all'ingiù). Esporta Spine 4.1.
      </div>
      <div className="row" style={{ gap: 16, alignItems: "center", flexWrap: "wrap", margin: "8px 0" }}>
        {[["arm", "Taglia braccio con oggetto"], ["hair", "Taglia capelli lunghi"], ["eyes", "Occhi animati"]].map(([k, label]) => (
          <label key={k} className="field-label-inline">
            <input type="checkbox" checked={cuts[k]} disabled={busy} onChange={(e) => setCuts({ ...cuts, [k]: e.target.checked })} /> {label}
          </label>
        ))}
        <label className="field-label-inline">
          😊 Sorriso
          <select value={smile} disabled={busy} onChange={(e) => setSmile(e.target.value)} style={{ marginLeft: 6 }}>
            <option value="no">no (bocca del disegno)</option>
            <option value="loop">nel loop (sorride e torna)</option>
            <option value="sempre">sempre (sorriso fisso)</option>
          </select>
        </label>
        <label className="field-label-inline">
          Intensità
          <select value={boost} disabled={busy} onChange={(e) => setBoost(Number(e.target.value))} style={{ marginLeft: 6 }}>
            <option value={0.5}>bassa</option>
            <option value={1}>normale</option>
            <option value={1.5}>alta</option>
          </select>
        </label>
        <button type="button" className="btn" disabled={busy} onClick={build}>
          {pkg ? "🔄 Ricrea" : "▶️ Crea character"}
        </button>
        {pkg && (
          <button type="button" className="btn secondary" onClick={download}>⬇️ Scarica pacchetto Spine 4.1</button>
        )}
      </div>
      {status && <div className="status">{status}</div>}
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
          <div ref={playerBox} style={{ width: "100%", maxWidth: 640, height: 640, borderRadius: 6, overflow: "hidden" }} />
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
