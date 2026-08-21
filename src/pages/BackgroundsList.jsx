import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { listBackgroundsWithLayers, createBackground, deleteBackground } from "../lib/backgroundsRepository.js";

const LAYER_ANIM_ICONS = { static: "⏸️", parallaxLoop: "↔️", sway: "🎐", pulse: "💡" };

function buildBackgroundDetailsTooltip(background) {
  if (background.layers.length === 0) return "Nessun layer salvato";
  return background.layers
    .map((l) => `z${l.z_index ?? 0} · ${l.layer_key} (${l.width}×${l.height}px, ${l.animation_type})`)
    .join("\n");
}

export default function BackgroundsList() {
  const [backgrounds, setBackgrounds] = useState([]);
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
      const data = await listBackgroundsWithLayers();
      setBackgrounds(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const bg = await createBackground(newName.trim());
      navigate(`/background/${bg.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(e, id, name) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Eliminare definitivamente il background "${name}" con tutti i suoi layer?`)) return;
    try {
      await deleteBackground(id);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="page">
      <Link to="/" className="back-link">← Home</Link>
      <h1>🌆 Background</h1>
      <div className="subtitle">Layer multipli indipendenti: parallax, luci, particelle</div>

      <form className="new-symbol-form" onSubmit={handleCreate}>
        <input
          type="text"
          placeholder="Nome nuovo background (es. jungle_scene)"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <button type="submit" className="btn" disabled={creating || !newName.trim()}>
          + Nuovo background
        </button>
      </form>

      {error && <div className="status error">❌ {error}</div>}
      {loading && <div className="status">⏳ Carico background...</div>}

      <div className="symbol-cards-grid">
        {backgrounds.map((b) => (
          <Link to={`/background/${b.id}`} key={b.id} className="symbol-card">
            <button type="button" className="symbol-card-delete" onClick={(e) => handleDelete(e, b.id, b.name)} title="Elimina background">
              ✕
            </button>
            <div className="symbol-card-thumb">
              {b.layers.length > 0 ? (
                <img src={b.layers[0].image_url} alt={b.name} />
              ) : (
                <span className="symbol-card-empty">vuoto</span>
              )}
            </div>
            <div className="symbol-card-name">{b.name}</div>
            <div className="symbol-card-anims" title={buildBackgroundDetailsTooltip(b)}>
              {b.layers.map((l) => (
                <span
                  key={l.id}
                  className="anim-dot filled"
                  title={`z${l.z_index ?? 0} · ${l.layer_key} (${l.animation_type})`}
                >
                  {LAYER_ANIM_ICONS[l.animation_type] || "🖼️"}
                </span>
              ))}
              {b.layers.length === 0 && <span className="anim-dot">nessun layer</span>}
              {b.layers.length > 0 && <span className="details-info-icon" title={buildBackgroundDetailsTooltip(b)}>ℹ️</span>}
            </div>
          </Link>
        ))}
        {!loading && backgrounds.length === 0 && (
          <div className="hint">Nessun background ancora. Creane uno con il modulo qui sopra.</div>
        )}
      </div>
    </div>
  );
}
