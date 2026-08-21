import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { listCharactersWithParts, createCharacter, deleteCharacter } from "../lib/charactersRepository.js";

const ANIM_ICONS = { static: "⏸️", sway: "🎐", bounce: "⬆️", blink: "✨" };

function buildCharacterDetailsTooltip(character) {
  if (character.parts.length === 0) return "Nessuna parte salvata";
  return character.parts
    .map((p) => `z${p.z_index ?? 0} · ${p.part_key} (${p.animation_type})`)
    .join("\n");
}

export default function CharactersList() {
  const [characters, setCharacters] = useState([]);
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
      const data = await listCharactersWithParts();
      setCharacters(data);
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
      const character = await createCharacter(newName.trim());
      navigate(`/character/${character.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  async function handleDeleteCharacter(e, characterId, characterName) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Eliminare definitivamente il character "${characterName}" con tutte le sue parti?`)) return;
    try {
      await deleteCharacter(characterId);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="page">
      <Link to="/" className="back-link">← Home</Link>
      <h1>🧙 Character</h1>
      <div className="subtitle">Rig multi-bone con parti libere: nome, genitore e animazione a tua scelta</div>

      <form className="new-symbol-form" onSubmit={handleCreate}>
        <input
          type="text"
          placeholder="Nome nuovo character (es. wizard_mascot)"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <button type="submit" className="btn" disabled={creating || !newName.trim()}>
          + Nuovo character
        </button>
      </form>

      {error && <div className="status error">❌ {error}</div>}
      {loading && <div className="status">⏳ Carico character...</div>}

      <div className="symbol-cards-grid">
        {characters.map((c) => (
          <Link to={`/character/${c.id}`} key={c.id} className="symbol-card">
            <button
              type="button"
              className="symbol-card-delete"
              onClick={(e) => handleDeleteCharacter(e, c.id, c.name)}
              title="Elimina character"
            >
              ✕
            </button>
            <div className="symbol-card-thumb">
              {c.parts.length > 0 ? (
                <img src={c.parts[0].image_url} alt={c.name} />
              ) : (
                <span className="symbol-card-empty">vuoto</span>
              )}
            </div>
            <div className="symbol-card-name">{c.name}</div>
            <div className="symbol-card-anims" title={buildCharacterDetailsTooltip(c)}>
              {c.parts.map((p) => (
                <span key={p.id} className="anim-dot filled" title={`z${p.z_index ?? 0} · ${p.part_key} (${p.animation_type})`}>
                  {ANIM_ICONS[p.animation_type] || "🧩"}
                </span>
              ))}
              {c.parts.length === 0 && <span className="anim-dot">nessuna parte</span>}
              {c.parts.length > 0 && <span className="details-info-icon" title={buildCharacterDetailsTooltip(c)}>ℹ️</span>}
            </div>
          </Link>
        ))}
        {!loading && characters.length === 0 && (
          <div className="hint">Nessun character ancora. Creane uno con il modulo qui sopra.</div>
        )}
      </div>
    </div>
  );
}
