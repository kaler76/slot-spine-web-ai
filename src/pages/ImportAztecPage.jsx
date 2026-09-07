import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  extractAztecSlug,
  fetchAztecProject,
  extractAztecSymbols,
  listAztecProjects,
  aztecAdminUrl,
  aztecPublicUrl,
  aztecGraphicsUrl
} from "../lib/aztecImport.js";
import { listSymbolsWithAnimations, createSymbol } from "../lib/symbolsRepository.js";
import { saveLastAztecProject } from "../lib/appSettingsRepository.js";

/**
 * Importa in slot-spine-web-ai i simboli già ritagliati in un progetto aztec-preview
 * (stesso Supabase, letto in sola lettura tramite la funzione pubblica slot_get).
 * Crea solo i simboli (nome + immagine collegata): ritaglio, misure e animazioni
 * restano un passo manuale e successivo, esattamente come per un simbolo creato a mano.
 */
export default function ImportAztecPage() {
  const [input, setInput] = useState("");
  const [projects, setProjects] = useState(null);
  const [projectsError, setProjectsError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [project, setProject] = useState(null);
  const [projectSlug, setProjectSlug] = useState("");
  const [candidates, setCandidates] = useState([]);
  const [selected, setSelected] = useState({});
  const [existingNames, setExistingNames] = useState(new Set());
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        setProjects(await listAztecProjects());
      } catch (err) {
        setProjectsError(err.message);
      }
    })();
  }, []);

  async function handleSearch(e, slugOverride) {
    e?.preventDefault();
    const foundSlug = slugOverride || extractAztecSlug(input);
    if (!foundSlug) return;
    setLoading(true);
    setError(null);
    setProject(null);
    setResult(null);
    try {
      const [proj, existing] = await Promise.all([fetchAztecProject(foundSlug), listSymbolsWithAnimations()]);
      const syms = extractAztecSymbols(proj);
      if (syms.length === 0) throw new Error("Il progetto non ha ancora simboli ritagliati (importa prima il PSD in aztec-preview).");

      const existingSet = new Set(existing.map((s) => s.name));
      const initialSelected = {};
      for (const s of syms) initialSelected[s.key] = !existingSet.has(s.name);

      setProject(proj);
      setProjectSlug(foundSlug);
      setCandidates(syms);
      setExistingNames(existingSet);
      setSelected(initialSelected);

      // Attiva subito questo progetto per "Rulli animati" (sfondo/cornice/rulli reali),
      // anche se poi non importi nessun simbolo nuovo in questa visita.
      try {
        await saveLastAztecProject({
          id: proj.id,
          slug: foundSlug,
          name: proj.name,
          client_name: proj.client_name,
          cfg: proj.cfg,
          assets: proj.assets
        });
      } catch {
        // Non blocca la ricerca se il salvataggio delle impostazioni fallisce.
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function toggle(key) {
    setSelected((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function handleImport() {
    const toImport = candidates.filter((s) => selected[s.key]);
    if (toImport.length === 0) return;
    setImporting(true);
    setResult(null);
    setError(null);

    let ok = 0;
    const failed = [];
    for (const s of toImport) {
      try {
        await createSymbol(s.name, s.url);
        ok++;
      } catch (err) {
        failed.push(`${s.name}: ${err.message}`);
      }
    }

    setImporting(false);
    setResult({ ok, failed });
    if (ok > 0) {
      const existing = await listSymbolsWithAnimations();
      setExistingNames(new Set(existing.map((sym) => sym.name)));
    }
  }

  const selectedCount = candidates.filter((s) => selected[s.key]).length;

  return (
    <div className="page">
      <Link to="/symbols" className="back-link">← Simboli</Link>
      <h1>📥 Importa da Aztec</h1>
      <div className="subtitle">
        Registra i simboli già ritagliati in un progetto aztec-preview. La ricerca attiva subito quel progetto anche
        per "Rulli animati" (sfondo, cornice e coordinate rulli reali); l'importazione dei simboli veri e propri resta
        un passo a parte, che crea solo i simboli (nome + immagine collegata) — ritaglio, misure e animazioni restano
        un lavoro manuale successivo, come oggi.
      </div>

      {projects && projects.length > 0 && (
        <label className="field-label">
          Oppure scegli un progetto già esistente
          <select
            value=""
            disabled={loading}
            onChange={(e) => {
              const slug = e.target.value;
              if (!slug) return;
              setInput(slug);
              handleSearch(null, slug);
            }}
          >
            <option value="">— seleziona un progetto —</option>
            {projects.map((p) => (
              <option key={p.slug} value={p.slug}>{p.name}</option>
            ))}
          </select>
        </label>
      )}
      {projectsError && <div className="hint">Impossibile caricare l'elenco progetti ({projectsError}): incolla il link/slug qui sotto.</div>}

      <form onSubmit={handleSearch} className="new-symbol-form">
        <input
          type="text"
          placeholder="Link cliente aztec-preview (…/index.html?k=…) oppure solo lo slug"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button type="submit" className="btn" disabled={loading || !input.trim()}>
          {loading ? "⏳ Cerco..." : "🔍 Cerca progetto"}
        </button>
      </form>

      {error && <div className="status error">❌ {error}</div>}

      {project && (
        <>
          <div className="hint">
            Progetto <strong>{project.name}</strong>
            {project.client_name ? ` — ${project.client_name}` : ""} · {candidates.length} simboli trovati
          </div>
          <div className="row aztec-links">
            {aztecAdminUrl(project.id) && (
              <a href={aztecAdminUrl(project.id)} target="_blank" rel="noreferrer" className="import-aztec-link">
                🛠️ Apri il pannello Aztec
              </a>
            )}
            {aztecGraphicsUrl(project.id) && (
              <a href={aztecGraphicsUrl(project.id)} target="_blank" rel="noreferrer" className="import-aztec-link">
                🖼️ Apri Grafiche
              </a>
            )}
            {aztecPublicUrl(projectSlug) && (
              <a href={aztecPublicUrl(projectSlug)} target="_blank" rel="noreferrer" className="import-aztec-link">
                🔗 Apri l'anteprima cliente
              </a>
            )}
          </div>

          <div className="symbol-cards-grid">
            {candidates.map((s) => {
              const already = existingNames.has(s.name);
              return (
                <label key={s.key} className={`symbol-card import-card ${selected[s.key] ? "import-card-selected" : ""}`}>
                  <input type="checkbox" className="import-card-checkbox" checked={!!selected[s.key]} onChange={() => toggle(s.key)} />
                  <div className="symbol-card-thumb">
                    <img src={s.url} alt={s.name} />
                  </div>
                  <div className="symbol-card-name">{s.name}</div>
                  {already && <div className="hint">già presente — verrà duplicato se selezionato</div>}
                </label>
              );
            })}
          </div>

          <div className="btn-row">
            <button type="button" className="btn" onClick={handleImport} disabled={importing || selectedCount === 0}>
              {importing ? "⏳ Importo..." : `📥 Importa ${selectedCount} simboli`}
            </button>
          </div>

          {result && (
            <div className={`status ${result.failed.length ? "error" : ""}`}>
              {result.ok > 0 && `✅ ${result.ok} simboli importati.`}
              {result.failed.length > 0 && (
                <>
                  <br />❌ Errori: {result.failed.join("; ")}
                </>
              )}
              {result.ok > 0 && (
                <>
                  {" "}
                  <Link to="/symbols">Vai a Simboli →</Link>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
