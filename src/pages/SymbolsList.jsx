import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { listSymbolsWithAnimations, createSymbol, deleteSymbol } from "../lib/symbolsRepository.js";

const ANIMATION_ICONS = { idle: "💤", win: "✨", land: "📍", spinBlur: "🌀" };

export default function SymbolsList() {
  const [symbols, setSymbols] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    refresh();
  }, []);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const data = await listSymbolsWithAnimations();
      setSymbols(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateSymbol(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const symbol = await createSymbol(newName.trim());
      navigate(`/symbol/${symbol.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  async function handleDeleteSymbol(e, symbolId, symbolName) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Eliminare definitivamente il simbolo "${symbolName}" e tutte le sue animazioni?`)) return;
    try {
      await deleteSymbol(symbolId);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="page">
      <Link to="/" className="back-link">← Home</Link>
      <h1>🍒 Simboli</h1>
      <div className="subtitle">Ritaglio, misure e 4 animazioni (idle/win/land/spinBlur) per simbolo</div>

      <form className="new-symbol-form" onSubmit={handleCreateSymbol}>
        <input
          type="text"
          placeholder="Nome nuovo simbolo (es. cherry_gold)"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <button type="submit" className="btn" disabled={creating || !newName.trim()}>
          + Nuovo simbolo
        </button>
      </form>

      <Link to="/import-aztec" className="hint import-aztec-link">📥 Importa simboli già ritagliati da un progetto aztec-preview →</Link>

      {error && <div className="status error">❌ {error}</div>}
      {loading && <div className="status">⏳ Carico simboli...</div>}

      <div className="symbol-cards-grid">
        {symbols.map((s) => (
          <Link to={`/symbol/${s.id}`} key={s.id} className="symbol-card">
            <button
              type="button"
              className="symbol-card-delete"
              onClick={(e) => handleDeleteSymbol(e, s.id, s.name)}
              title="Elimina simbolo"
            >
              ✕
            </button>
            <div className="symbol-card-thumb">
              {(() => {
                const thumb = s.animations.find((a) => a.image_url)?.image_url || s.source_image_url;
                return thumb ? <img src={thumb} alt={s.name} /> : <span className="symbol-card-empty">vuoto</span>;
              })()}
            </div>
            <div className="symbol-card-name">{s.name}</div>
            <div className="symbol-card-anims">
              {["idle", "win", "land", "spinBlur"].map((type) => {
                const has = s.animations.some((a) => a.animation_type === type);
                return (
                  <span key={type} className={has ? "anim-dot filled" : "anim-dot"} title={type}>
                    {ANIMATION_ICONS[type]}
                  </span>
                );
              })}
            </div>
          </Link>
        ))}
        {!loading && symbols.length === 0 && (
          <div className="hint">Nessun simbolo ancora. Creane uno con il modulo qui sopra.</div>
        )}
      </div>
    </div>
  );
}
