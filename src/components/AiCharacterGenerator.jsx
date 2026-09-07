import { useState } from "react";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../lib/supabaseClient.js";
import SpriteSheetImporter from "./SpriteSheetImporter.jsx";

function base64ToBlob(base64, mimeType = "image/png") {
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mimeType });
}

/** Scarica un'immagine già caricata (es. quella importata da Aztec) e la converte in base64 pura (senza prefisso data:), come si aspetta l'API Gemini. */
async function urlToBase64(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`immagine di riferimento non raggiungibile (HTTP ${res.status})`);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error("lettura immagine di riferimento fallita"));
    reader.readAsDataURL(blob);
  });
}

export default function AiCharacterGenerator({ characterId, existingParts, onImported }) {
  const [characterDescription, setCharacterDescription] = useState("");
  const hasExistingParts = existingParts && existingParts.length > 0;
  const [useReference, setUseReference] = useState(hasExistingParts);
  const [referenceKey, setReferenceKey] = useState(existingParts?.[0]?.part_key || "");
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState(null); // { passed, attempts, imageBase64, blob }
  const [status, setStatus] = useState("");
  const [importingBlob, setImportingBlob] = useState(null);
  const [importingKey, setImportingKey] = useState(0);
  const [promptText, setPromptText] = useState("");
  const [loadingPrompt, setLoadingPrompt] = useState(false);

  async function resolveReferenceImagesBase64() {
    const withReference = useReference && hasExistingParts;
    if (!withReference) return undefined;
    const part = existingParts.find((p) => p.part_key === referenceKey) || existingParts[0];
    return [await urlToBase64(part.image_url)];
  }

  /** Chiede alla funzione edge il prompt esatto che userebbe (con l'analisi del riferimento, se presente), senza generare alcuna immagine: l'utente può poi modificarlo liberamente prima di generare. */
  async function handleShowPrompt() {
    const withReference = useReference && hasExistingParts;
    if (!withReference && !characterDescription.trim()) {
      setStatus("⚠️ Descrivi il personaggio, oppure spunta \"parti da un'immagine già caricata\".");
      return;
    }
    setLoadingPrompt(true);
    setStatus(withReference ? "⏳ Analisi del riferimento e costruzione del prompt in corso..." : "⏳ Costruzione del prompt in corso...");
    try {
      const referenceImagesBase64 = await resolveReferenceImagesBase64();
      const res = await fetch(`${SUPABASE_URL}/functions/v1/generate-sprite-sheet`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          apikey: SUPABASE_ANON_KEY
        },
        body: JSON.stringify({ characterDescription, group: "all", referenceImagesBase64, previewOnly: true })
      });
      const data = await res.json();
      if (!res.ok || data?.error) throw new Error(data?.error || `Errore HTTP ${res.status}`);
      setPromptText(data.prompt);
      setStatus("✅ Prompt pronto qui sotto: modificalo pure prima di generare, se vuoi.");
    } catch (err) {
      setStatus(`❌ Errore nel costruire il prompt: ${err.message}`);
    } finally {
      setLoadingPrompt(false);
    }
  }

  async function handleGenerate() {
    const withReference = useReference && hasExistingParts;
    if (!withReference && !characterDescription.trim() && !promptText.trim()) {
      setStatus("⚠️ Descrivi il personaggio, spunta \"parti da un'immagine già caricata\", oppure scrivi un prompt personalizzato.");
      return;
    }
    setGenerating(true);
    setStatus(
      withReference
        ? "⏳ Ricostruzione della sprite sheet dall'immagine di riferimento in corso (può richiedere fino a un minuto o due, contiene molti elementi)..."
        : "⏳ Generazione della sprite sheet completa in corso (può richiedere fino a un minuto o due, contiene molti elementi)..."
    );
    try {
      const referenceImagesBase64 = await resolveReferenceImagesBase64();

      const res = await fetch(`${SUPABASE_URL}/functions/v1/generate-sprite-sheet`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          apikey: SUPABASE_ANON_KEY
        },
        body: JSON.stringify({
          characterDescription,
          group: "all",
          referenceImagesBase64,
          promptOverride: promptText.trim() || undefined
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
      {hasExistingParts && (
        <>
          <label className="field-label field-label-inline">
            <input type="checkbox" checked={useReference} onChange={(e) => setUseReference(e.target.checked)} />
            Parti da un'immagine già caricata (invece di generare un personaggio nuovo da zero)
          </label>
          {useReference && (
            <label className="field-label">
              Immagine di riferimento
              <select value={referenceKey} onChange={(e) => setReferenceKey(e.target.value)}>
                {existingParts.map((p) => (
                  <option key={p.part_key} value={p.part_key}>{p.part_key}</option>
                ))}
              </select>
            </label>
          )}
          {useReference && (
            <div className="hint" style={{ marginTop: 4 }}>
              Gemini userà questa immagine come il personaggio esatto da riprodurre (stessi colori, costume, viso e
              stile artistico), ricostruendola nei pezzi separati e pronti per il rig invece di inventarne uno
              nuovo o di ridisegnarlo in uno stile diverso.
            </div>
          )}
        </>
      )}
      <label className="field-label">
        Descrizione personaggio (in inglese, per risultati migliori){useReference && hasExistingParts ? " — opzionale con un'immagine di riferimento" : ""}
        <input
          type="text"
          value={characterDescription}
          onChange={(e) => setCharacterDescription(e.target.value)}
          placeholder="e.g. elegant Chinese empress in red and gold traditional dress"
        />
      </label>
      <div className="hint" style={{ marginTop: 8 }}>
        Genera tutti gli elementi (viso, capelli, accessori, corpo, braccia, oggetti) in un'unica immagine, con
        ampi margini di sicurezza tra ciascuno per evitare che si tocchino. Il torso viene generato completo sotto le
        spalle/ascelle (come se le braccia non ci fossero) e le braccia sono pezzi separati (braccio + avambraccio con
        mano): così, quando le animi in Character, non restano buchi quando si muovono rispetto al corpo.
      </div>

      <button type="button" className="btn secondary" onClick={handleShowPrompt} disabled={loadingPrompt || generating}>
        {loadingPrompt ? "⏳ Costruzione prompt..." : "👁️ Mostra il prompt (e modificalo se vuoi)"}
      </button>

      {promptText && (
        <label className="field-label">
          Prompt per Gemini (modificabile — verrà usato così com'è al posto di quello generato automaticamente)
          <textarea
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            rows={12}
            style={{ fontFamily: "monospace", fontSize: "0.85rem" }}
          />
        </label>
      )}

      <button type="button" className="btn" onClick={handleGenerate} disabled={generating}>
        {generating
          ? "⏳ Generazione..."
          : result
            ? "🔄 Rigenera sprite sheet"
            : useReference && hasExistingParts
              ? "🎨 Ricostruisci sprite sheet dall'immagine"
              : "🎨 Genera sprite sheet completa"}
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
