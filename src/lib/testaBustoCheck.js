// src/lib/testaBustoCheck.js — controlli del profilo TESTA-BUSTO (regole P7, correzioni Jessica).
// Solo AVVISI: non cambiano i pezzi né le soglie esistenti. Puro: nessun DOM.
//  - NASO INTEGRO (P7.2): sulla testa il naso non è cancellato né appiattito;
//  - CONTINUITÀ (P7.1): dove nell'originale la superficie è continua (pelle su pelle) i pezzi
//    ricomposti non mostrano scalini di colore o bordi netti;
//  - MOVIMENTO (P7.1, P6.4): ruotando braccia, testa e capelli come nell'animazione non si
//    aprono buchi ai raccordi (sovrapposizioni insufficienti).

const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
const pxAt = (p, gx, gy) => {
  const x = Math.round(gx - p.x), y = Math.round(gy - p.y);
  if (x < 0 || y < 0 || x >= p.width || y >= p.height) return null;
  const i = (y * p.width + x) * 4;
  return p.rgba[i + 3] >= 128 ? i : null;
};

export const NOSE_FLAT_RATIO = 0.4; // contrasto del naso sotto il 40% dell'originale = appiattito
export const NOSE_HOLE_MAX = 0.2; // oltre il 20% di trasparenza attorno al naso = cancellato
export const SEAM_ORIG_MAX = 30; // nell'originale: differenza sotto cui la superficie è continua
export const SEAM_STEP_MIN = 60; // ricomposto: differenza sopra cui c'è uno scalino
export const SEAM_SHARE_MAX = 0.25; // quota del raccordo con scalini oltre cui si avvisa
export const MOTION_HOLE_MAX = 0.004; // buchi in movimento oltre lo 0,4% dell'area del pezzo
export const MOTION_ANGLES = { braccio: 6, testa: 4, capelli: 3.5 };

/** P7.2 — naso sulla testa: presente e con il contrasto (punta, narici, ombre) dell'originale. */
export function noseCheck(pieces, original, nose) {
  const head = pieces.find((p) => p.name === "testa");
  if (!head || !nose) return [];
  const r = Math.max(4, Math.round(0.06 * head.width));
  let n = 0, holes = 0;
  const a = [], b = [];
  for (let y = nose.y - r; y <= nose.y + r; y++)
    for (let x = nose.x - r; x <= nose.x + r; x++) {
      if (x < 0 || y < 0 || x >= original.width || y >= original.height) continue;
      const g = (Math.round(y) * original.width + Math.round(x)) * 4;
      if (original.rgba[g + 3] < 128) continue;
      n++;
      const i = pxAt(head, x, y);
      if (i === null) { holes++; continue; }
      a.push(lum(head.rgba[i], head.rgba[i + 1], head.rgba[i + 2]));
      b.push(lum(original.rgba[g], original.rgba[g + 1], original.rgba[g + 2]));
    }
  if (!n) return [];
  const sd = (v) => {
    const m = v.reduce((s, x) => s + x, 0) / (v.length || 1);
    return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length || 1));
  };
  const out = [];
  if (holes / n > NOSE_HOLE_MAX) out.push(`Naso: ${Math.round((100 * holes) / n)}% trasparente sulla testa — il naso deve restare sulla testa (P7.2).`);
  else if (b.length > 8 && sd(a) < NOSE_FLAT_RATIO * sd(b))
    out.push(`Naso appiattito sulla testa: contrasto ${sd(a).toFixed(0)} contro ${sd(b).toFixed(0)} dell'originale — punta, narici, ombre e luce vanno conservate (P7.2).`);
  return out;
}

/** Pezzo più davanti per ogni pixel (indice in "pieces") e colore ricomposto. */
function compose(pieces, W, H, override) {
  const top = new Int16Array(W * H).fill(-1);
  const order = pieces.map((p, k) => k).sort((a, b) => pieces[a].order - pieces[b].order);
  for (const k of order) {
    const p = pieces[k];
    const ov = override?.get(p);
    const sample = ov?.sample;
    const bb = ov?.box || { x0: p.x, y0: p.y, x1: p.x + p.width, y1: p.y + p.height };
    for (let y = Math.max(0, Math.floor(bb.y0)); y < Math.min(H, Math.ceil(bb.y1) + 1); y++) {
      for (let x = Math.max(0, Math.floor(bb.x0)); x < Math.min(W, Math.ceil(bb.x1) + 1); x++) {
        if (sample ? !sample(x, y) : pxAt(p, x, y) === null) continue;
        top[y * W + x] = k;
      }
    }
  }
  return top;
}

const BODY = /^(testa|busto|braccio_(dx|sx))$/;

/** P7.1 — scalini di colore ai raccordi fra testa-busto, vestito e braccia. */
export function seamCheck(pieces, original) {
  return seamStats(pieces, original)
    .filter((s) => s.n >= 20 && s.share > SEAM_SHARE_MAX)
    .map((s) => `Raccordo ${s.key}: scalino di colore o bordo netto sul ${Math.round(100 * s.share)}% del bordo dove l'originale è continuo — servono sovrapposizione e sfumatura coerenti (P7.1).`);
}

/** Misure numeriche dei raccordi (per autoSelect.js): [{ key, n, steps, share }]. */
export function seamStats(pieces, original) {
  const W = original.width, H = original.height, o = original.rgba;
  const top = compose(pieces, W, H);
  const stats = new Map();
  const colorAt = (k, i) => {
    const p = pieces[k], x = i % W, y = (i - x) / W, j = pxAt(p, x, y);
    return [p.rgba[j], p.rgba[j + 1], p.rgba[j + 2]];
  };
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W - 1; x++)
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        if (y + dy >= H) continue;
        const i = y * W + x, j = (y + dy) * W + x + dx;
        const a = top[i], b = top[j];
        if (a < 0 || b < 0 || a === b) continue;
        if (!BODY.test(pieces[a].name) || !BODY.test(pieces[b].name)) continue;
        if (o[i * 4 + 3] < 128 || o[j * 4 + 3] < 128) continue;
        const oi = [o[i * 4], o[i * 4 + 1], o[i * 4 + 2]], oj = [o[j * 4], o[j * 4 + 1], o[j * 4 + 2]];
        if (d(oi, oj) > SEAM_ORIG_MAX) continue; // nell'originale c'è già un bordo (es. vestito su pelle)
        const key = [pieces[a].name, pieces[b].name].sort().join(" / ");
        const s = stats.get(key) || { n: 0, steps: 0 };
        s.n++;
        if (d(colorAt(a, i), colorAt(b, j)) > SEAM_STEP_MIN) s.steps++;
        stats.set(key, s);
      }
  return [...stats].map(([key, s]) => ({ key, n: s.n, steps: s.steps, share: s.n ? s.steps / s.n : 0 }));
}

/** Discendenti di un pezzo nel rig (genitore = nome). */
function subtree(pieces, root) {
  const out = [root];
  for (let i = 0; i < out.length; i++) for (const q of pieces) if (q.parent === out[i].name && !out.includes(q)) out.push(q);
  return out;
}

/** P7.1 — buchi ai raccordi ruotando braccia, testa e capelli attorno al pivot. */
export function motionCheck(pieces, original) {
  return motionStats(pieces, original)
    .filter((m) => m.share > MOTION_HOLE_MAX)
    .map((m) => `${m.name}: in movimento (±${MOTION_ANGLES[m.kind]}°) si apre un buco al raccordo di ${m.worst} px (${(m.share * 100).toFixed(1)}% del pezzo) — serve più sovrapposizione sotto il genitore (P7.1).`);
}

/** Misure numeriche del movimento (per autoSelect.js): [{ name, kind, worst, share }]. */
export function motionStats(pieces, original) {
  const W = original.width, H = original.height;
  const rest = compose(pieces, W, H);
  const out = [];
  for (const p of pieces) {
    if (!p.parent || !p.pivot) continue;
    const kind = /^braccio_/.test(p.name) ? "braccio" : p.name === "testa" ? "testa" : /^(ciocca|ciuffo|capelli_dietro)/.test(p.name) ? "capelli" : null;
    if (!kind) continue;
    const moved = subtree(pieces, p);
    let worst = 0;
    for (const sgn of [1, -1]) {
      const t = (sgn * MOTION_ANGLES[kind] * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
      const { x: px, y: py } = p.pivot;
      // campionamento inverso: il pixel (x, y) è coperto se il punto ruotato all'indietro lo era
      const rot = (x, y) => ({ x: px + c * (x - px) - s * (y - py), y: py + s * (x - px) + c * (y - py) });
      const override = new Map(
        moved.map((q) => {
          const cs = [rot(q.x, q.y), rot(q.x + q.width, q.y), rot(q.x, q.y + q.height), rot(q.x + q.width, q.y + q.height)];
          const box = { x0: Math.min(...cs.map((k) => k.x)), y0: Math.min(...cs.map((k) => k.y)), x1: Math.max(...cs.map((k) => k.x)), y1: Math.max(...cs.map((k) => k.y)) };
          return [q, { box, sample: (x, y) => pxAt(q, px + c * (x - px) + s * (y - py), py - s * (x - px) + c * (y - py)) !== null }];
        })
      );
      const now = compose(pieces, W, H, override);
      let holes = 0;
      for (let i = 0; i < W * H; i++) if (rest[i] >= 0 && now[i] < 0 && moved.includes(pieces[rest[i]]) === false) holes++;
      for (let i = 0; i < W * H; i++) if (rest[i] >= 0 && now[i] < 0 && moved.includes(pieces[rest[i]])) {
        // pixel lasciato libero dal pezzo che si muove: buco solo se vicino al raccordo
        const x = i % W, y = (i - x) / W;
        if (Math.hypot(x - px, y - py) < 0.25 * Math.max((p.jointBase || p).width, (p.jointBase || p).height)) holes++;
      }
      worst = Math.max(worst, holes);
    }
    out.push({ name: p.name, kind, worst, share: worst / (p.area || p.width * p.height) });
  }
  return out;
}
