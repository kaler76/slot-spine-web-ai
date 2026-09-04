import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listSymbolsWithAnimations } from "../lib/symbolsRepository.js";
import { listCharactersWithParts } from "../lib/charactersRepository.js";
import { listBackgroundsWithLayers } from "../lib/backgroundsRepository.js";

const CATEGORY_META = {
  symbol: { icon: "🍒", label: "Simbolo", path: (id) => `/symbol/${id}` },
  character: { icon: "🧙", label: "Character", path: (id) => `/character/${id}` },
  background: { icon: "🌆", label: "Background", path: (id) => `/background/${id}` }
};

export default function Home() {
  const [symbols, setSymbols] = useState(null);
  const [characters, setCharacters] = useState(null);
  const [backgrounds, setBackgrounds] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [s, c, b] = await Promise.all([
        listSymbolsWithAnimations(),
        listCharactersWithParts(),
        listBackgroundsWithLayers()
      ]);
      setSymbols(s);
      setCharacters(c);
      setBackgrounds(b);
      setLoading(false);
    })();
  }, []);

  function thumbFor(item, kind) {
    if (kind === "symbol") return item.animations.find((a) => a.image_url)?.image_url || null;
    if (kind === "character") return item.parts[0]?.image_url || null;
    if (kind === "background") return item.layers[0]?.image_url || null;
    return null;
  }

  // Combina le 3 liste in un unico elenco "Recenti", ordinato per data di creazione
  const recentItems = loading
    ? []
    : [
        ...symbols.map((s) => ({ ...s, kind: "symbol" })),
        ...characters.map((c) => ({ ...c, kind: "character" })),
        ...backgrounds.map((b) => ({ ...b, kind: "background" }))
      ]
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, 8);

  return (
    <div className="page">
      <h1>🎰 Slot Spine Generator</h1>
      <div className="subtitle">Pipeline di animazione automatica per grafiche slot machine</div>

      <div className="cards-grid">
        <Link to="/symbols" className="card">
          <div className="card-icon">🍒</div>
          <div className="card-title">Simboli</div>
          <span className="status-badge ready">Pronto</span>
          <div className="card-desc">
            Ritaglio, misure e 4 animazioni per simbolo.
            {symbols && <> — <strong>{symbols.length}</strong> salvati</>}
          </div>
          {symbols && symbols.length > 0 && (
            <div className="card-thumb-row">
              {symbols.slice(0, 3).map((s) => {
                const url = thumbFor(s, "symbol");
                return url ? <img key={s.id} src={url} alt={s.name} /> : null;
              })}
            </div>
          )}
        </Link>
        <Link to="/characters" className="card">
          <div className="card-icon">🧙</div>
          <div className="card-title">Character</div>
          <span className="status-badge ready">Pronto</span>
          <div className="card-desc">
            Rig multi-bone con parti libere e animazioni per parte.
            {characters && <> — <strong>{characters.length}</strong> salvati</>}
          </div>
          {characters && characters.length > 0 && (
            <div className="card-thumb-row">
              {characters.slice(0, 3).map((c) => {
                const url = thumbFor(c, "character");
                return url ? <img key={c.id} src={url} alt={c.name} /> : null;
              })}
            </div>
          )}
        </Link>
        <Link to="/backgrounds" className="card">
          <div className="card-icon">🌆</div>
          <div className="card-title">Background</div>
          <span className="status-badge ready">Pronto</span>
          <div className="card-desc">
            Layer liberi indipendenti: parallax, oscillazione, luci pulsanti.
            {backgrounds && <> — <strong>{backgrounds.length}</strong> salvati</>}
          </div>
          {backgrounds && backgrounds.length > 0 && (
            <div className="card-thumb-row">
              {backgrounds.slice(0, 3).map((b) => {
                const url = thumbFor(b, "background");
                return url ? <img key={b.id} src={url} alt={b.name} /> : null;
              })}
            </div>
          )}
        </Link>
        <Link to="/reels" className="card">
          <div className="card-icon">🎰</div>
          <div className="card-title">Rulli animati</div>
          <span className="status-badge ready">Pronto</span>
          <div className="card-desc">
            Vista a rulli indipendente: compone i simboli già animati (idle/land/win) in uno spin completo.
          </div>
        </Link>
      </div>

      {!loading && recentItems.length > 0 && (
        <>
          <h2 className="section-title">🕒 Recenti</h2>
          <div className="recent-grid">
            {recentItems.map((item) => {
              const meta = CATEGORY_META[item.kind];
              const url = thumbFor(item, item.kind);
              return (
                <Link to={meta.path(item.id)} key={`${item.kind}-${item.id}`} className="recent-card">
                  <div className="recent-card-thumb">
                    {url ? <img src={url} alt={item.name} /> : <span className="symbol-card-empty">{meta.icon}</span>}
                  </div>
                  <div className="recent-card-info">
                    <span className="recent-card-kind">{meta.icon} {meta.label}</span>
                    <span className="recent-card-name">{item.name}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </>
      )}

      {loading && <div className="status">⏳ Carico...</div>}
    </div>
  );
}
