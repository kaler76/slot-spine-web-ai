import { useState } from "react";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../lib/supabaseClient.js";
import SpriteSheetImporter from "./SpriteSheetImporter.jsx";

function base64ToBlob(base64, mimeType = "image/png") {
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mimeType });
}

function loadImageFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("immagine non decodificabile"));
    img.src = URL.createObjectURL(blob);
  });
}

/** Unisce più sprite sheet (ciascuno già su sfondo bianco pieno, generato separatamente) impilandoli verticalmente in un solo foglio, così l'importatore lato client — che rileva le parti dai pixel dell'immagine, non da metadati del server — le tratta come un'unica sprite sheet da cui estrarre tutte le parti. Usata per "Tutto insieme": chiedere a Gemini tutti gli elementi in una sola immagine complessa saturava spesso il budget di output e produceva PNG troncati/corrotti; generare viso/capelli/corpo separatamente (come già più affidabile per l'uso manuale) e ricomporli qui evita il problema senza perdere la comodità di un solo foglio da importare. */
async function stitchBlobsVertically(blobs) {
  const images = await Promise.all(blobs.map(loadImageFromBlob));
  const width = Math.max(...images.map((img) => img.width));
  const height = images.reduce((sum, img) => sum + img.height, 0);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  let y = 0;
  for (const img of images) {
    ctx.drawImage(img, 0, y);
    y += img.height;
  }
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
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

const MAX_ATTEMPTS = 4;
const RETRY_DELAY_MS = 4000;

/** Errori transitori lato Gemini (sovraccarico momentaneo, rate limit, filtro di sicurezza scattato per errore) per cui ha senso riprovare automaticamente — a differenza di un tetto di spesa superato o di un errore di validazione, che non si risolvono riprovando. PROHIBITED_CONTENT/SAFETY sono inclusi perché il filtro di Gemini è noto per dare falsi positivi non deterministici sullo stesso identico prompt. */
function isRetryableApiError(message) {
  const m = String(message || "").toLowerCase();
  if (m.includes("spending cap") || m.includes("resource_exhausted")) return false;
  return (
    m.includes("503") || m.includes("unavailable") || m.includes("high demand") ||
    m.includes("429") || m.includes("overload") ||
    m.includes("prohibited_content") || m.includes("safety")
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Chiedere a Gemini 23 elementi in una sola immagine satura spesso il budget di output e produce PNG troncati/corrotti (vedi runAttemptsForGroup) — molto più affidabile generare un gruppo alla volta. "Tutto insieme" resta un'unica opzione comoda per l'utente, ma internamente genera viso/capelli/corpo separatamente e li ricompone in un solo foglio (vedi handleGenerate). */
const GROUP_OPTIONS = [
  { value: "all", label: "🧩 Tutto insieme (viso + capelli + corpo, generati separatamente e uniti)" },
  { value: "face", label: "😊 Solo viso (11 elementi: occhi, pupille, sopracciglia, bocche, testa)" },
  { value: "hair", label: "💇 Solo capelli (7 elementi)" },
  { value: "body", label: "🧍 Solo corpo (5 elementi: torso, braccio sx/dx intero, oggetti)" }
];

const ALL_SUBGROUPS = ["face", "hair", "body"];

/** Etichette brevi solo per il menu di scelta — devono rispecchiare l'ordine esatto degli elementi lato server (GROUP_TEMPLATES nell'edge function), il testo completo di ogni elemento resta lì. */
const ELEMENT_LABELS = {
  face: [
    "Testa (viso + frangia)",
    "Occhio sx aperto",
    "Occhio dx aperto",
    "Pupilla sx",
    "Pupilla dx",
    "Occhio sx chiuso",
    "Occhio dx chiuso",
    "Sopracciglia",
    "Bocca neutra",
    "Bocca sorridente",
    "Bocca aperta"
  ],
  hair: [
    "Capelli retro",
    "Ornamento centrale",
    "Forcine laterali",
    "Nastri laterali",
    "Orecchino sx",
    "Orecchino dx",
    "Perlina decorativa"
  ],
  body: [
    "Corpo/torso",
    "Braccio sinistro (intero)",
    "Braccio destro (intero)",
    "Coppa/contenitore",
    "Piccoli oggetti decorativi"
  ]
};
const SINGLE_ELEMENT_GROUPS = ["face", "hair", "body"];

export default function AiCharacterGenerator({ characterId, existingParts, onImported }) {
  const [characterDescription, setCharacterDescription] = useState("");
  const hasExistingParts = existingParts && existingParts.length > 0;
  const [useReference, setUseReference] = useState(hasExistingParts);
  const [referenceKey, setReferenceKey] = useState(existingParts?.[0]?.part_key || "");
  const [group, setGroup] = useState("all");
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState(null); // { passed, attempts, imageBase64, blob }
  const [status, setStatus] = useState("");
  const [importingBlob, setImportingBlob] = useState(null);
  const [importingKey, setImportingKey] = useState(0);
  const [promptText, setPromptText] = useState("");
  const [loadingPrompt, setLoadingPrompt] = useState(false);

  // --- Rigenerazione di un singolo elemento (invece dell'intero gruppo) ---
  const [singleMode, setSingleMode] = useState(false);
  const [singleGroup, setSingleGroup] = useState("body");
  const [singleElementIndex, setSingleElementIndex] = useState(0);
  const [singlePromptText, setSinglePromptText] = useState("");
  const [loadingSinglePrompt, setLoadingSinglePrompt] = useState(false);
  const [generatingSingle, setGeneratingSingle] = useState(false);
  const [singleVariants, setSingleVariants] = useState(null); // [{ blob }, { blob }]
  const [singleImportingBlob, setSingleImportingBlob] = useState(null);
  const [singleImportingKey, setSingleImportingKey] = useState(0);

  /** Il prompt mostrato/modificato è specifico per gruppo: se l'utente cambia gruppo dopo averlo generato, va ricostruito, altrimenti si rischia di generare "tutto insieme" con un prompt scritto per "solo viso" (o viceversa). */
  function handleGroupChange(next) {
    setGroup(next);
    setPromptText("");
  }

  function handleSingleGroupChange(next) {
    setSingleGroup(next);
    setSingleElementIndex(0);
    setSinglePromptText("");
  }

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
        body: JSON.stringify({ characterDescription, group, referenceImagesBase64, previewOnly: true })
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

  /** Una singola chiamata (breve) alla funzione edge: genera un tentativo per il gruppo indicato, passando indietro lo stato del tentativo precedente per evitare di ripetere l'analisi del riferimento e restare così sotto il timeout della piattaforma (vedi commento in cima all'edge function). */
  async function generateOnce({ group: groupForCall, promptOverride, referenceImagesBase64, correction, referenceAnalysis, referenceAnalysisError }) {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/generate-sprite-sheet`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        apikey: SUPABASE_ANON_KEY
      },
      body: JSON.stringify({
        characterDescription,
        group: groupForCall,
        referenceImagesBase64,
        promptOverride,
        correction,
        referenceAnalysis,
        referenceAnalysisError
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
    return data;
  }

  /** Ciclo di tentativi (fino a MAX_ATTEMPTS) per UN gruppo. Estratto da handleGenerate così può essere richiamato tre volte in sequenza (viso/capelli/corpo) per "Tutto insieme" invece di chiedere tutti e 23 gli elementi in una sola immagine. */
  async function runAttemptsForGroup(groupForCall, { referenceImagesBase64, promptOverride, initialReferenceAnalysis, initialReferenceAnalysisError, statusPrefix = "" }) {
    const attempts = [];
    let correction;
    let referenceAnalysis = initialReferenceAnalysis;
    let referenceAnalysisError = initialReferenceAnalysisError;
    let lastData = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      setStatus(`⏳ ${statusPrefix}Tentativo ${attempt}/${MAX_ATTEMPTS} in corso...`);
      let data;
      try {
        data = await generateOnce({ group: groupForCall, promptOverride, referenceImagesBase64, correction, referenceAnalysis, referenceAnalysisError });
      } catch (err) {
        // Un sovraccarico momentaneo di Gemini (503/429) o un blocco del filtro di
        // sicurezza (spesso un falso positivo non deterministico) meritano un altro
        // tentativo automatico invece di arrendersi subito — a differenza di un errore
        // definitivo (es. tetto di spesa superato), che non si risolve riprovando.
        if (isRetryableApiError(err.message) && attempt < MAX_ATTEMPTS) {
          attempts.push({ attempt, pass: false, issues: [`${err.message} — nuovo tentativo automatico tra qualche secondo...`] });
          setStatus(`⏳ ${statusPrefix}${err.message.toLowerCase().includes("prohibited_content") || err.message.toLowerCase().includes("safety") ? "Il filtro di sicurezza di Gemini ha bloccato questo tentativo" : "Gemini temporaneamente sovraccarico"}, nuovo tentativo tra ${RETRY_DELAY_MS / 1000}s...`);
          await sleep(RETRY_DELAY_MS);
          continue;
        }
        throw err;
      }
      lastData = data;
      referenceAnalysis = data.referenceAnalysis;
      referenceAnalysisError = data.referenceAnalysisError;
      correction = data.correction;
      attempts.push({ attempt, pass: data.passed, unverified: data.unverified, issues: data.issues || [] });
      if (data.passed) break;
    }

    if (!lastData) {
      throw new Error("Gemini è rimasto sovraccarico per tutti i tentativi disponibili — riprova tra qualche minuto.");
    }
    return { lastData, attempts, referenceAnalysis, referenceAnalysisError };
  }

  async function handleGenerate() {
    const withReference = useReference && hasExistingParts;
    if (!withReference && !characterDescription.trim() && !promptText.trim()) {
      setStatus("⚠️ Descrivi il personaggio, spunta \"parti da un'immagine già caricata\", oppure scrivi un prompt personalizzato.");
      return;
    }
    setGenerating(true);
    try {
      const referenceImagesBase64 = await resolveReferenceImagesBase64();

      if (group === "all") {
        // Un'unica immagine con tutti e 23 gli elementi satura spesso il budget di
        // output di Gemini e produce PNG troncati/corrotti (persino il controllo
        // rilassato hasValidPngHeader lato server fallisce, segno di corruzione
        // vera, non solo di byte di troppo in coda) — l'immagine con meno elementi
        // è quella che riesce sempre. Si genera quindi viso/capelli/corpo
        // separatamente (ognuno un prompt semplice ed efficace, non i 23 insieme)
        // e si ricompongono in un solo foglio lato client, senza perdere la
        // comodità di un solo pulsante per l'utente.
        let referenceAnalysis;
        let referenceAnalysisError;
        const subResults = [];
        const allAttempts = [];
        const subLabels = { face: "viso", hair: "capelli", body: "corpo" };

        for (const subGroup of ALL_SUBGROUPS) {
          const { lastData, attempts, referenceAnalysis: ra, referenceAnalysisError: rae } = await runAttemptsForGroup(subGroup, {
            referenceImagesBase64,
            initialReferenceAnalysis: referenceAnalysis,
            initialReferenceAnalysisError: referenceAnalysisError,
            statusPrefix: `${subLabels[subGroup]}: `
          });
          referenceAnalysis = ra;
          referenceAnalysisError = rae;
          subResults.push({ subGroup, lastData });
          allAttempts.push(...attempts.map((a) => ({ ...a, subGroup })));
        }

        const combinedBlob = await stitchBlobsVertically(subResults.map((r) => base64ToBlob(r.lastData.imageBase64)));
        const allPassed = subResults.every((r) => r.lastData.passed);
        const anyUnverified = subResults.some((r) => r.lastData.unverified);
        setResult({ passed: allPassed, attempts: allAttempts, imageBase64: null, blob: combinedBlob });
        setStatus(
          allPassed
            ? `✅ Viso, capelli e corpo generati separatamente (più affidabile di tutto insieme) e uniti in un solo foglio.${anyUnverified ? " Controllo geometrico non eseguibile su almeno un pezzo — dai un'occhiata prima di importare." : ""}`
            : "⚠️ Non tutti i gruppi hanno superato il controllo qualità. Il foglio combinato è comunque disponibile qui sotto: puoi scaricarlo, provare a importarlo, o rigenerare."
        );
        return;
      }

      const { lastData, attempts } = await runAttemptsForGroup(group, {
        referenceImagesBase64,
        promptOverride: promptText.trim() || undefined,
        statusPrefix: withReference ? "Ricostruzione dall'immagine di riferimento — " : ""
      });

      const blob = base64ToBlob(lastData.imageBase64);
      setResult({ passed: lastData.passed, attempts, imageBase64: lastData.imageBase64, blob });
      setStatus(
        lastData.unverified
          ? `✅ Sprite sheet generata in ${attempts.length} tentativo/i. Controllo geometrico automatico non eseguibile su questa immagine (limite del nostro parser, non un problema dell'immagine) — dai un'occhiata tu prima di importare.`
          : lastData.passed
            ? `✅ Sprite sheet generata e passato il controllo qualità in ${attempts.length} tentativo/i.`
            : `⚠️ Non ha superato del tutto il controllo qualità dopo ${attempts.length} tentativi. L'immagine è comunque disponibile qui sotto: puoi scaricarla per controllarla, provare comunque a importarla, o rigenerare.`
      );
    } catch (err) {
      setStatus(`❌ Errore generazione: ${err.message}`);
    } finally {
      setGenerating(false);
    }
  }

  /** Come handleShowPrompt, ma per il prompt del singolo elemento selezionato (nessuna immagine di riferimento gestita qui: la rigenerazione di un pezzo isolato riusa la stessa immagine di riferimento del personaggio già impostata sopra, se presente). */
  async function handleShowSinglePrompt() {
    setLoadingSinglePrompt(true);
    setStatus("⏳ Costruzione del prompt per il singolo elemento...");
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
          group: singleGroup,
          elementIndex: singleElementIndex,
          referenceImagesBase64,
          previewOnly: true
        })
      });
      const data = await res.json();
      if (!res.ok || data?.error) throw new Error(data?.error || `Errore HTTP ${res.status}`);
      setSinglePromptText(data.prompt);
      setStatus("✅ Prompt pronto qui sotto: modificalo pure prima di generare, se vuoi.");
    } catch (err) {
      setStatus(`❌ Errore nel costruire il prompt: ${err.message}`);
    } finally {
      setLoadingSinglePrompt(false);
    }
  }

  /** Genera lo stesso singolo elemento due volte in parallelo (chiamate indipendenti, senza il retry-su-fallimento della sheet intera: qui basta scegliere la variante migliore) così l'utente può scegliere quale delle due usare, invece di dover rigenerare tutta la sheet per un solo pezzo difettoso. */
  async function handleGenerateSingle() {
    if (!characterDescription.trim() && !(useReference && hasExistingParts) && !singlePromptText.trim()) {
      setStatus("⚠️ Descrivi il personaggio, spunta \"parti da un'immagine già caricata\", oppure scrivi un prompt personalizzato.");
      return;
    }
    setGeneratingSingle(true);
    setSingleVariants(null);
    setStatus("⏳ Generazione di 2 varianti del singolo elemento...");
    try {
      const referenceImagesBase64 = await resolveReferenceImagesBase64();
      const callOnce = async () => {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/generate-sprite-sheet`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            apikey: SUPABASE_ANON_KEY
          },
          body: JSON.stringify({
            characterDescription,
            group: singleGroup,
            elementIndex: singleElementIndex,
            referenceImagesBase64,
            promptOverride: singlePromptText.trim() || undefined
          })
        });
        const rawText = await res.text();
        let data;
        try {
          data = JSON.parse(rawText);
        } catch {
          throw new Error(`Risposta non valida (status ${res.status}): ${rawText.slice(0, 500)}`);
        }
        if (!res.ok || data?.error) throw new Error(data?.error || `Errore HTTP ${res.status}`);
        return data;
      };

      const [a, b] = await Promise.all([callOnce(), callOnce()]);
      setSingleVariants([
        { blob: base64ToBlob(a.imageBase64), passed: a.passed },
        { blob: base64ToBlob(b.imageBase64), passed: b.passed }
      ]);
      setStatus("✅ Due varianti pronte qui sotto: scegli quella da importare.");
    } catch (err) {
      setStatus(`❌ Errore generazione: ${err.message}`);
    } finally {
      setGeneratingSingle(false);
    }
  }

  function handleUseSingleVariant(blob) {
    setSingleImportingBlob(blob);
    setSingleImportingKey((k) => k + 1);
  }

  function handleDownloadSingleVariant(blob, idx) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `elemento_variante_${idx + 1}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
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
      <label className="field-label">
        Cosa generare
        <select value={group} onChange={(e) => handleGroupChange(e.target.value)}>
          {GROUP_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>
      <div className="hint" style={{ marginTop: 8 }}>
        {group === "all"
          ? "Chiedere tutti e 23 gli elementi in un'unica immagine saturava spesso Gemini e produceva immagini troncate/corrotte: ora vengono generati viso, capelli e corpo separatamente (ognuno con un prompt semplice, senza troppi elementi insieme) e uniti automaticamente in un solo foglio da importare — un solo pulsante, tre generazioni più affidabili."
          : "Generare un gruppo alla volta è più preciso di chiedere tutto in un'unica immagine (meno elementi da posizionare = meno errori) — ripeti la generazione per ogni gruppo che ti serve e importali tutti sullo stesso personaggio."}
      </div>

      {group === "all" ? (
        <div className="hint" style={{ marginTop: 4 }}>
          Il prompt non è modificabile qui perché "tutto insieme" usa automaticamente i tre prompt standard di viso/capelli/corpo — passa a un gruppo singolo qui sopra per vedere o modificare un prompt.
        </div>
      ) : (
        <>
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
        </>
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
              {result.attempts.map((a, i) => (
                <div key={`${a.subGroup || "g"}-${a.attempt}-${i}`} className={a.pass ? "ai-attempt-pass" : "ai-attempt-fail"}>
                  {a.subGroup ? `${a.subGroup} — ` : ""}Tentativo {a.attempt}:{" "}
                  {a.unverified
                    ? "🟡 non verificato (controllo geometrico saltato, immagine probabilmente valida)"
                    : a.pass
                      ? "✅ passato"
                      : `❌ ${a.issues.join(" ")}`}
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

      <h3 className="section-subtitle">🔧 Un pezzo solo è venuto male?</h3>
      <label className="field-label field-label-inline">
        <input type="checkbox" checked={singleMode} onChange={(e) => setSingleMode(e.target.checked)} />
        Rigenera un singolo elemento (invece di tutto il gruppo)
      </label>

      {singleMode && (
        <>
          <div className="hint" style={{ marginTop: 4 }}>
            Utile quando in una sheet già importata solo un pezzo è difettoso: scegli quale elemento rigenerare,
            guarda/modifica il suo prompt, e ottieni 2 varianti tra cui scegliere — senza dover rifare tutto il gruppo.
          </div>
          <div className="row">
            <label className="field-label">
              Gruppo
              <select value={singleGroup} onChange={(e) => handleSingleGroupChange(e.target.value)}>
                {SINGLE_ELEMENT_GROUPS.map((g) => (
                  <option key={g} value={g}>{GROUP_OPTIONS.find((o) => o.value === g)?.label || g}</option>
                ))}
              </select>
            </label>
            <label className="field-label">
              Elemento
              <select
                value={singleElementIndex}
                onChange={(e) => {
                  setSingleElementIndex(Number(e.target.value));
                  setSinglePromptText("");
                }}
              >
                {ELEMENT_LABELS[singleGroup].map((label, idx) => (
                  <option key={idx} value={idx}>{label}</option>
                ))}
              </select>
            </label>
          </div>

          <button type="button" className="btn secondary" onClick={handleShowSinglePrompt} disabled={loadingSinglePrompt || generatingSingle}>
            {loadingSinglePrompt ? "⏳ Costruzione prompt..." : "👁️ Mostra il prompt di questo elemento"}
          </button>

          {singlePromptText && (
            <label className="field-label">
              Prompt per Gemini (solo per questo elemento — modificabile)
              <textarea
                value={singlePromptText}
                onChange={(e) => setSinglePromptText(e.target.value)}
                rows={8}
                style={{ fontFamily: "monospace", fontSize: "0.85rem" }}
              />
            </label>
          )}

          <button type="button" className="btn" onClick={handleGenerateSingle} disabled={generatingSingle}>
            {generatingSingle ? "⏳ Generazione 2 varianti..." : "🎨 Genera 2 varianti di questo elemento"}
          </button>

          {singleVariants && (
            <div className="ai-single-variants-grid">
              {singleVariants.map((v, idx) => (
                <div key={idx} className="ai-single-variant-card">
                  <img src={URL.createObjectURL(v.blob)} alt={`Variante ${idx + 1}`} className="ai-single-variant-img" />
                  <div className="btn-row">
                    <button type="button" className="btn tiny" onClick={() => handleUseSingleVariant(v.blob)}>
                      📥 Usa questa
                    </button>
                    <button type="button" className="btn secondary tiny" onClick={() => handleDownloadSingleVariant(v.blob, idx)}>
                      ⬇ Scarica
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {singleImportingBlob && (
            <>
              <h3 className="section-subtitle">Revisione ed importazione del singolo elemento</h3>
              <SpriteSheetImporter
                characterId={characterId}
                existingParts={existingParts}
                onImported={onImported}
                externalBlob={singleImportingBlob}
                externalBlobKey={singleImportingKey}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}
