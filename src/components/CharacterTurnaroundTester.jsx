import { useState } from "react";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../lib/supabaseClient.js";
import SpriteSheetImporter from "./SpriteSheetImporter.jsx";

/**
 * Tester minimale per il percorso PARALLELO generate-character-turnaround
 * (Identity + Decomposition/Skin con MODE, sfondo magenta, giunti per arto —
 * vedi src/lib/spineRules.js, promptIdentity.js, promptDecompose.js,
 * partsList.js per la stessa logica lato client). Non tocca in alcun modo
 * AiCharacterGenerator/generate-sprite-sheet (v35, in produzione): serve solo
 * a verificare che il nuovo sistema produca immagini utilizzabili e che
 * l'importer riconosca correttamente lo sfondo magenta (vedi
 * spriteSheetDetector.js) prima di decidere se sostituire il flusso attuale.
 *
 * Flusso: 1) genera l'identity (turnaround su una riga) UNA VOLTA per
 * personaggio, 2) scompone una vista dell'identity in una parts sheet,
 * 3) opzionale: genera una skin variant della parts sheet a parità di
 * layout. Ogni passo può anche solo mostrare il prompt (previewOnly) senza
 * generare immagini, per ispezionarlo prima di spendere una chiamata Gemini.
 */

const VIEWS = [
  { value: "front", label: "Fronte (0°)" },
  { value: "three_quarter", label: "Tre quarti (45°)" },
  { value: "side", label: "Profilo (90°)" },
  { value: "back", label: "Retro (180°)" }
];

function base64ToBlob(base64, mimeType = "image/png") {
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mimeType });
}

async function callTurnaround(body) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/generate-character-turnaround`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      apikey: SUPABASE_ANON_KEY
    },
    body: JSON.stringify(body)
  });
  const rawText = await res.text();
  let data;
  try {
    data = JSON.parse(rawText);
  } catch {
    throw new Error(`Risposta non valida (status ${res.status}): ${rawText.slice(0, 500)}`);
  }
  if (!res.ok || data?.error) {
    throw new Error(data?.error || `Errore HTTP ${res.status}`);
  }
  return data;
}

export default function CharacterTurnaroundTester({ characterId, existingParts, onImported }) {
  const [characterDescription, setCharacterDescription] = useState("");
  const [scope, setScope] = useState("bust");

  const [identity, setIdentity] = useState(null); // { blob, imageBase64, prompt, unverified }
  const [identityStatus, setIdentityStatus] = useState("");
  const [generatingIdentity, setGeneratingIdentity] = useState(false);

  const [view, setView] = useState("front");
  const [decompose, setDecompose] = useState(null); // { blob, imageBase64, prompt, unverified }
  const [decomposeStatus, setDecomposeStatus] = useState("");
  const [generatingDecompose, setGeneratingDecompose] = useState(false);

  const [skinVariant, setSkinVariant] = useState("");
  const [skin, setSkin] = useState(null); // { blob, imageBase64, prompt, unverified }
  const [skinStatus, setSkinStatus] = useState("");
  const [generatingSkin, setGeneratingSkin] = useState(false);

  const [importingBlob, setImportingBlob] = useState(null);
  const [importingKey, setImportingKey] = useState(0);

  function describeUnverified(data) {
    return data.unverified
      ? " 🟡 controllo PNG rigoroso fallito ma header valido (probabilmente ok comunque, vedi hasValidPngHeader)."
      : "";
  }

  async function handlePreview(mode) {
    try {
      const body =
        mode === "identity"
          ? { mode: "identity", characterDescription, scope, previewOnly: true }
          : mode === "view"
            ? { mode: "view", view, scope, anchorImageBase64: identity?.imageBase64 || "x", previewOnly: true }
            : { mode: "skin", view, scope, variant: skinVariant || "(nome variante)", anchorImageBase64: decompose?.imageBase64 || "x", previewOnly: true };
      const data = await callTurnaround(body);
      window.alert(data.prompt);
    } catch (err) {
      window.alert(`Errore nel costruire il prompt: ${err.message}`);
    }
  }

  async function handleGenerateIdentity() {
    if (!characterDescription.trim()) {
      setIdentityStatus("⚠️ Descrivi il personaggio prima di generare l'identity.");
      return;
    }
    setGeneratingIdentity(true);
    setIdentityStatus("⏳ Generazione identity (turnaround) in corso...");
    try {
      const data = await callTurnaround({ mode: "identity", characterDescription, scope });
      const blob = base64ToBlob(data.imageBase64);
      setIdentity({ blob, imageBase64: data.imageBase64, prompt: data.prompt, unverified: data.unverified });
      setDecompose(null);
      setSkin(null);
      setIdentityStatus(`✅ Identity generata (scope: ${scope}).${describeUnverified(data)}`);
    } catch (err) {
      setIdentityStatus(`❌ Errore: ${err.message}`);
    } finally {
      setGeneratingIdentity(false);
    }
  }

  async function handleGenerateDecompose() {
    if (!identity) {
      setDecomposeStatus("⚠️ Genera prima l'identity: la scomposizione parte da quella immagine.");
      return;
    }
    setGeneratingDecompose(true);
    setDecomposeStatus(`⏳ Decomposizione vista "${view}" in corso...`);
    try {
      const data = await callTurnaround({
        mode: "view",
        view,
        scope,
        anchorImageBase64: identity.imageBase64
      });
      const blob = base64ToBlob(data.imageBase64);
      setDecompose({ blob, imageBase64: data.imageBase64, prompt: data.prompt, unverified: data.unverified });
      setSkin(null);
      setDecomposeStatus(`✅ Parts sheet generata per la vista "${view}".${describeUnverified(data)}`);
    } catch (err) {
      setDecomposeStatus(`❌ Errore: ${err.message}`);
    } finally {
      setGeneratingDecompose(false);
    }
  }

  async function handleGenerateSkin() {
    if (!decompose) {
      setSkinStatus("⚠️ Genera prima la parts sheet: la skin variant riparte da quella.");
      return;
    }
    if (!skinVariant.trim()) {
      setSkinStatus("⚠️ Dai un nome alla skin variant (es. \"winter\", \"gold\").");
      return;
    }
    setGeneratingSkin(true);
    setSkinStatus(`⏳ Generazione skin "${skinVariant}" in corso...`);
    try {
      const data = await callTurnaround({
        mode: "skin",
        view,
        scope,
        variant: skinVariant.trim(),
        anchorImageBase64: decompose.imageBase64
      });
      const blob = base64ToBlob(data.imageBase64);
      setSkin({ blob, imageBase64: data.imageBase64, prompt: data.prompt, unverified: data.unverified });
      setSkinStatus(`✅ Skin "${skinVariant}" generata, stesso layout della parts sheet.${describeUnverified(data)}`);
    } catch (err) {
      setSkinStatus(`❌ Errore: ${err.message}`);
    } finally {
      setGeneratingSkin(false);
    }
  }

  function handleImport(blob) {
    setImportingBlob(blob);
    setImportingKey((k) => k + 1);
  }

  return (
    <div className="ai-character-generator">
      <div className="hint">
        Percorso sperimentale, separato da "Genera con AI" qui sopra: usa una nuova edge function
        (generate-character-turnaround) con sfondo magenta #FF00FF e giunti per arto invece di un
        arto intero. Serve solo a verificare che il nuovo sistema funzioni prima di eventualmente
        sostituire il flusso attuale — non tocca i personaggi esistenti finché non importi tu stesso
        il risultato.
      </div>

      <label className="field-label">
        Descrizione personaggio (in inglese, per risultati migliori)
        <input
          type="text"
          value={characterDescription}
          onChange={(e) => setCharacterDescription(e.target.value)}
          placeholder="e.g. aztec warrior queen, feathered headdress, teal and gold armor"
        />
      </label>

      <label className="field-label">
        Scope
        <select value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="bust">Busto (default, niente gambe — coerente col formato simbolo attuale)</option>
          <option value="full_body">Corpo intero (con gambe, su richiesta)</option>
        </select>
      </label>

      <h3 className="section-title" style={{ fontSize: "1rem" }}>1. Identity (turnaround, una volta per personaggio)</h3>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="btn secondary" onClick={() => handlePreview("identity")}>
          👁️ Mostra prompt
        </button>
        <button type="button" className="btn" onClick={handleGenerateIdentity} disabled={generatingIdentity}>
          {generatingIdentity ? "⏳ Generazione..." : "🎨 Genera identity"}
        </button>
      </div>
      {identityStatus && <div className="status">{identityStatus}</div>}
      {identity?.blob && (
        <img src={URL.createObjectURL(identity.blob)} alt="Identity turnaround" className="ai-full-sheet-preview" />
      )}

      <h3 className="section-title" style={{ fontSize: "1rem" }}>2. Decomposizione (parts sheet di una vista)</h3>
      <label className="field-label">
        Vista da scomporre
        <select value={view} onChange={(e) => setView(e.target.value)}>
          {VIEWS.map((v) => (
            <option key={v.value} value={v.value}>{v.label}</option>
          ))}
        </select>
      </label>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="btn secondary" onClick={() => handlePreview("view")} disabled={!identity}>
          👁️ Mostra prompt
        </button>
        <button type="button" className="btn" onClick={handleGenerateDecompose} disabled={generatingDecompose || !identity}>
          {generatingDecompose ? "⏳ Generazione..." : "🧩 Genera parts sheet"}
        </button>
      </div>
      {decomposeStatus && <div className="status">{decomposeStatus}</div>}
      {decompose?.blob && (
        <>
          <img src={URL.createObjectURL(decompose.blob)} alt="Parts sheet" className="ai-full-sheet-preview" />
          <button type="button" className="btn" onClick={() => handleImport(decompose.blob)}>
            📥 Importa questa parts sheet (test rilevamento sfondo magenta)
          </button>
        </>
      )}

      <h3 className="section-title" style={{ fontSize: "1rem" }}>3. Skin variant (opzionale, stesso layout)</h3>
      <label className="field-label">
        Nome variante
        <input
          type="text"
          value={skinVariant}
          onChange={(e) => setSkinVariant(e.target.value)}
          placeholder="es. winter, gold, night"
        />
      </label>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="btn secondary" onClick={() => handlePreview("skin")} disabled={!decompose}>
          👁️ Mostra prompt
        </button>
        <button type="button" className="btn" onClick={handleGenerateSkin} disabled={generatingSkin || !decompose}>
          {generatingSkin ? "⏳ Generazione..." : "🎭 Genera skin variant"}
        </button>
      </div>
      {skinStatus && <div className="status">{skinStatus}</div>}
      {skin?.blob && (
        <>
          <img src={URL.createObjectURL(skin.blob)} alt="Skin variant" className="ai-full-sheet-preview" />
          <button type="button" className="btn" onClick={() => handleImport(skin.blob)}>
            📥 Importa questa skin variant
          </button>
        </>
      )}

      {importingBlob && (
        <>
          <h3 className="section-title" style={{ fontSize: "1rem" }}>Importazione</h3>
          <SpriteSheetImporter
            characterId={characterId}
            existingParts={existingParts}
            onImported={onImported}
            externalBlob={importingBlob}
            externalBlobKey={importingKey}
          />
        </>
      )}
    </div>
  );
}
