import { useState } from "react";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../lib/supabaseClient.js";
import SpriteSheetImporter from "./SpriteSheetImporter.jsx";

function base64ToBlob(base64, mimeType = "image/png") {
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mimeType });
}

export default function AiCharacterGenerator({ characterId, existingParts, onImported }) {
  const [characterDescription, setCharacterDescription] = useState("");
  const [artStyle, setArtStyle] = useState("flat vector game illustration, clean lineart, cel-shaded");
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState(null); // { passed, attempts, imageBase64, blob }
  const [status, setStatus] = useState("");
  const [importingBlob, setImportingBlob] = useState(null);
  const [importingKey, setImportingKey] = useState(0);

  async function handleGenerate() {
    if (!characterDescription.trim()) {
      setStatus("⚠️ Descrivi il personaggio prima di generare.");
      return;
    }
    setGenerating(true);
    setStatus("⏳ Generazione della sprite sheet completa in corso (può richiedere fino a un minuto o due, contiene molti elementi)...");
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/generate-sprite-sheet`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          apikey: SUPABASE_ANON_KEY
        },
        body: JSON.stringify({
          characterDescription,
          artStyle,
          group: "all"
        })
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

      const blob = base64ToBlob(data.imageBase64);
      setResult({ passed: data.passed, attempts: data.attempts, imageBase64: data.imageBase64, blob });
      setStatus(
        data.passed
          ? `✅ Sprite sheet generata e passato il controllo qualità in ${data.totalAttempts} tentativo/i.`
          : `⚠️ Non ha superato del tutto il controllo qualità dopo ${data.totalAttempts} tentativi. L'immagine è comunque disponibile qui sotto: puoi scaricarla per controllarla, provare comunque a importarla, o rigenerare.`
      );
    } catch (err) {
      setStatus(`❌ Errore generazione: ${err.message}`);
    } finally {
      setGenerating(false);
    }
  }

  function handleUseForImport() {
    if (!result) return;
    setImportingBlob(result.blob);
    setImportingKey((k) => k + 1);
  }

  function handleDownloadImage() {
    if (!result) return;
    const url = URL.createObjectURL(result.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sprite_sheet_completa.png";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="ai-generator">
      <label className="field-label">
        Descrizione personaggio (in inglese, per risultati migliori)
        <input
          type="text"
          value={characterDescription}
          onChange={(e) => setCharacterDescription(e.target.value)}
          placeholder="e.g. elegant Chinese empress in red and gold traditional dress"
        />
      </label>
      <label className="field-label">
        Stile artistico
        <input type="text" value={artStyle} onChange={(e) => setArtStyle(e.target.value)} />
      </label>

      <div className="hint" style={{ marginTop: 8 }}>
        Genera tutti e 19 gli elementi (viso, capelli, accessori, corpo, oggetti) in un'unica immagine, con ampi
        margini di sicurezza tra ciascuno per evitare che si tocchino.
      </div>

      <button type="button" className="btn" onClick={handleGenerate} disabled={generating}>
        {generating ? "⏳ Generazione..." : result ? "🔄 Rigenera sprite sheet completa" : "🎨 Genera sprite sheet completa"}
      </button>

      {status && <div className="status">{status}</div>}

      {result?.blob && (
        <>
          <img
            src={URL.createObjectURL(result.blob)}
            alt="Sprite sheet generata"
            className="ai-full-sheet-preview"
          />

          {result.attempts && (
            <div className="ai-attempts-log">
              {result.attempts.map((a) => (
                <div key={a.attempt} className={a.pass ? "ai-attempt-pass" : "ai-attempt-fail"}>
                  Tentativo {a.attempt}: {a.pass ? "✅ passato" : `❌ ${a.issues.join(" ")}`}
                </div>
              ))}
            </div>
          )}

          <div className="btn-row">
            <button type="button" className="btn tiny" onClick={handleUseForImport}>
              📥 Usa per importare
            </button>
            <button type="button" className="btn secondary tiny" onClick={handleDownloadImage}>
              ⬇ Scarica immagine (sempre disponibile, anche se il controllo qualità fallisce)
            </button>
          </div>
        </>
      )}

      {importingBlob && (
        <>
          <h3 className="section-subtitle">Revisione ed importazione</h3>
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
