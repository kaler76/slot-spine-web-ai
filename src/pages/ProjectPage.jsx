import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getLastAztecProject } from "../lib/appSettingsRepository.js";
import { extractAztecSymbols, aztecAdminUrl, aztecPublicUrl, aztecGraphicsUrl } from "../lib/aztecImport.js";
import { listSymbolsWithAnimations, createSymbol } from "../lib/symbolsRepository.js";
import { listCharactersWithParts, createCharacter, saveCharacterPart } from "../lib/charactersRepository.js";
import { listBackgroundsWithLayers, createBackground, updateBackgroundCanvas, saveBackgroundLayer } from "../lib/backgroundsRepository.js";

/** Nome (e chiave di collegamento) del background auto-creato per un progetto Aztec. */
function projectBackgroundName(project) {
  return `Aztec: ${project.name}`;
}

function loadImageSize(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Immagine non valida"));
    };
    img.src = url;
  });
}

/**
 * Hub del progetto Aztec attivo: il passo successivo a "Importa da Aztec" + un primo
 * giro di test in Rulli. Da qui, per QUESTO progetto, si carica/anima ogni simbolo, si
 * converte in Character quando serve (come già in Simbolo), e si anima lo sfondo reale
 * (bg + cornice) invece di dover creare un Background scollegato a mano.
 */
export default function ProjectPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [project, setProject] = useState(null);
  const [symbols, setSymbols] = useState([]);
  const [characters, setCharacters] = useState([]);
  const [background, setBackground] = useState(null);
  const [busyKey, setBusyKey] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const proj = await getLastAztecProject();
      setProject(proj);
      if (proj) {
        const [syms, chars, backgrounds] = await Promise.all([
          listSymbolsWithAnimations(),
          listCharactersWithParts(),
          listBackgroundsWithLayers()
        ]);
        setSymbols(syms);
        setCharacters(chars);
        setBackground(backgrounds.find((b) => b.name === projectBackgroundName(proj)) || null);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleImportSymbol(entry) {
    setBusyKey(`import-${entry.key}`);
    setError(null);
    try {
      await createSymbol(entry.name, entry.url);
      await refresh();
    } catch (err) {
      setError(`Errore importando "${entry.name}": ${err.message}`);
    } finally {
      setBusyKey(null);
    }
  }

  async function handleConvertToCharacter(symbolRow) {
    setBusyKey(`char-${symbolRow.id}`);
    setError(null);
    try {
      const sourceUrl = symbolRow.animations.find((a) => a.image_url)?.image_url || symbolRow.source_image_url;
      if (!sourceUrl) throw new Error("nessuna immagine disponibile per questo simbolo");
      const res = await fetch(sourceUrl);
      if (!res.ok) throw new Error(`immagine non raggiungibile (HTTP ${res.status})`);
      const blob = await res.blob();
      const { width, height } = await loadImageSize(blob);

      const character = await createCharacter(symbolRow.name);
      await saveCharacterPart({
        characterId: character.id,
        partKey: "body",
        parentKey: "root",
        imageBlob: blob,
        width,
        height,
        offsetX: 0,
        offsetY: 0,
        zIndex: 0,
        animationType: "static",
        speed: 1,
        anchorX: "center",
        anchorY: "center"
      });
      navigate(`/character/${character.id}`);
    } catch (err) {
      setError(`Errore conversione "${symbolRow.name}" in Character: ${err.message}`);
      setBusyKey(null);
    }
  }

  async function handleCreateProjectBackground() {
    setBusyKey("background");
    setError(null);
    try {
      const name = projectBackgroundName(project);
      const bg = await createBackground(name);
      const docW = project.cfg?.doc?.w || 1920;
      const docH = project.cfg?.doc?.h || 1080;
      await updateBackgroundCanvas(bg.id, { canvasWidth: docW, canvasHeight: docH });

      // "davanti" (overlay) è il layer di loghi/decori disegnato sopra i simboli nel
      // pannello Aztec (scheda Grafiche): va sopra anche qui, con z-index più alto di frame.
      const layers = [];
      if (project.assets?.bg) layers.push(["bg", project.assets.bg, 0]);
      if (project.assets?.frame) layers.push(["frame", project.assets.frame, 10]);
      if (project.assets?.overlay) layers.push(["overlay", project.assets.overlay, 20]);
      for (const [layerKey, url, zIndex] of layers) {
        const res = await fetch(url);
        if (!res.ok) continue;
        const blob = await res.blob();
        await saveBackgroundLayer({
          backgroundId: bg.id,
          layerKey,
          imageBlob: blob,
          width: docW,
          height: docH,
          zIndex,
          animationType: "static",
          speed: 1
        });
      }
      navigate(`/background/${bg.id}`);
    } catch (err) {
      setError(`Errore creazione background: ${err.message}`);
      setBusyKey(null);
    }
  }

  if (loading) return <div className="page status">⏳ Carico il progetto...</div>;
  if (error && !project) return <div className="page status error">❌ {error}</div>;

  if (!project) {
    return (
      <div className="page">
        <Link to="/" className="back-link">← Home</Link>
        <h1>🗂️ Il mio progetto</h1>
        <div className="subtitle">
          Da qui gestisci simboli, character e background del progetto Aztec attivo — dopo averlo importato e testato
          in Rulli animati.
        </div>
        <div className="hint">
          Nessun progetto aztec attivo ancora. Vai su <Link to="/import-aztec">Importa da Aztec</Link>, cerca (o scegli
          dal menu) il tuo progetto: questa pagina si popolerà automaticamente.
        </div>
      </div>
    );
  }

  const symbolEntries = extractAztecSymbols(project);
  const symbolsByName = new Map(symbols.map((s) => [s.name, s]));
  const charactersByName = new Map(characters.map((c) => [c.name, c]));

  return (
    <div className="page">
      <Link to="/" className="back-link">← Home</Link>
      <h1>🗂️ Il mio progetto</h1>
      <div className="subtitle">
        Progetto <strong>{project.name}</strong> — carica/anima i simboli, converti in Character quando serve, e anima
        lo sfondo reale. Quando è tutto pronto, testalo in <Link to="/reels">Rulli animati</Link>.
      </div>
      <div className="row aztec-links">
        {aztecAdminUrl(project.id) && (
          <a href={aztecAdminUrl(project.id)} target="_blank" rel="noreferrer" className="import-aztec-link">
            🛠️ Apri il pannello Aztec
          </a>
        )}
        {aztecGraphicsUrl(project.id) && (
          <a href={aztecGraphicsUrl(project.id)} target="_blank" rel="noreferrer" className="import-aztec-link">
            🖼️ Apri Grafiche (fondale/cornice/davanti)
          </a>
        )}
        {aztecPublicUrl(project.slug) && (
          <a href={aztecPublicUrl(project.slug)} target="_blank" rel="noreferrer" className="import-aztec-link">
            🔗 Apri l'anteprima cliente
          </a>
        )}
        <Link to="/import-aztec" className="import-aztec-link">🔄 Cambia progetto</Link>
      </div>

      {error && <div className="status error">❌ {error}</div>}

      <h2 className="section-title">🌆 Background</h2>
      {background ? (
        <div className="hint">
          Sfondo "{background.name}" collegato — {background.layers.length} layer.{" "}
          <Link to={`/background/${background.id}`}>Apri per animarlo →</Link>
        </div>
      ) : (
        <div className="hint">
          Nessuno sfondo ancora per questo progetto.
          <div className="btn-row">
            <button type="button" className="btn" onClick={handleCreateProjectBackground} disabled={busyKey === "background"}>
              {busyKey === "background" ? "⏳ Creo..." : "🌆 Crea sfondo da bg + cornice del progetto"}
            </button>
          </div>
        </div>
      )}

      <h2 className="section-title">🍒 Simboli ({symbolEntries.length})</h2>
      <div className="symbol-cards-grid">
        {symbolEntries.map((entry) => {
          const symbolRow = symbolsByName.get(entry.name);
          const characterRow = charactersByName.get(entry.name);
          const animCount = symbolRow?.animations.length || 0;
          const importing = busyKey === `import-${entry.key}`;
          const converting = busyKey === `char-${symbolRow?.id}`;

          return (
            <div key={entry.key} className="symbol-card" style={{ cursor: "default" }}>
              <div className="symbol-card-thumb">
                <img src={entry.url} alt={entry.name} />
              </div>
              <div className="symbol-card-name">{entry.name}</div>
              {!symbolRow && (
                <div className="btn-row">
                  <button type="button" className="btn tiny" onClick={() => handleImportSymbol(entry)} disabled={importing}>
                    {importing ? "⏳..." : "📥 Importa"}
                  </button>
                </div>
              )}
              {symbolRow && (
                <>
                  <div className="hint" style={{ margin: "4px 0" }}>
                    {animCount > 0 ? `✅ ${animCount} animazion${animCount === 1 ? "e" : "i"}` : "importato, nessuna animazione"}
                  </div>
                  <div className="btn-row">
                    <Link to={`/symbol/${symbolRow.id}`} className="btn secondary tiny">✏️ Apri</Link>
                    {characterRow ? (
                      <Link to={`/character/${characterRow.id}`} className="btn secondary tiny">🧙 Apri Character</Link>
                    ) : (
                      <button type="button" className="btn secondary tiny" onClick={() => handleConvertToCharacter(symbolRow)} disabled={converting}>
                        {converting ? "⏳..." : "🧙 Converti in Character"}
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
