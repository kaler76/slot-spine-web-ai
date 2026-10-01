// src/lib/partExtraction.js — dalla mappa delle parti riconosciute (partRecognition.js) ai
// PEZZI veri: un'immagine ritagliata (RGBA, trasparente fuori dalla parte) per ogni parte e
// per ogni oggetto, con posizione, pivot, genitore e ordine di disegno. È il passo
// "dividere ed estrarre" della pipeline automatica:
//   immagine -> riconoscimento -> ESTRAZIONE -> rig -> animazione -> export Spine.
// Fa anche una prima ricostruzione (bozza) delle zone nascoste: dove un pezzo davanti
// (testa, avambraccio, oggetto) copriva il genitore, il genitore viene riempito propagando
// i colori dai bordi, così muovendo il pezzo davanti non compare un buco.
// Tutto puro e testabile: nessun DOM.

import { PART, PARTS } from "./partRecognition.js";

/**
 * Gerarchia e ordine di disegno (dal fondo al primo piano). Le braccia stanno DIETRO al
 * busto (l'attacco della spalla resta coperto quando ruotano), avambracci e oggetti DAVANTI.
 */
export const PIECE_RULES = {
  braccio_sx: { parent: "busto", order: 0, pivot: "spalla_sx" },
  braccio_dx: { parent: "busto", order: 1, pivot: "spalla_dx" },
  busto: { parent: null, order: 2, pivot: "fondo" },
  testa: { parent: "busto", order: 3, pivot: "base_collo" },
  cappello: { parent: "testa", order: 4, pivot: "fondo" },
  oggetto_in_mano: { parent: null, order: 5, pivot: "mano" },
  avambraccio_sx: { parent: "braccio_sx", order: 6, pivot: "gomito_sx" },
  avambraccio_dx: { parent: "braccio_dx", order: 7, pivot: "gomito_dx" }
};

/** Pezzi DAVANTI al genitore: sotto di loro il genitore va ricostruito. */
const OCCLUDERS = {
  busto: ["testa", "oggetto_in_mano", "avambraccio_sx", "avambraccio_dx"],
  testa: ["cappello"],
  braccio_sx: ["avambraccio_sx"],
  braccio_dx: ["avambraccio_dx"]
};

const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * Pulizia: le isole piccole di un'etichetta (pochi pixel staccati dal pezzo principale)
 * passano all'etichetta più frequente attorno. Evita pezzi con "briciole" sparse.
 * @returns {number} pixel riassegnati
 */
export function cleanIslands(parts, W, H, { minShare = 0.02, minPx = 40 } = {}) {
  const comp = new Int32Array(W * H).fill(-1);
  const comps = [];
  for (let s = 0; s < W * H; s++) {
    if (!parts[s] || comp[s] >= 0) continue;
    const label = parts[s];
    const id = comps.length;
    const pix = [];
    const stack = [s];
    comp[s] = id;
    while (stack.length) {
      const i = stack.pop();
      pix.push(i);
      const x = i % W, y = (i - x) / W;
      for (const [dx, dy] of N4) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (comp[j] < 0 && parts[j] === label) {
          comp[j] = id;
          stack.push(j);
        }
      }
    }
    comps.push({ label, pix });
  }
  const biggest = {};
  for (const c of comps) biggest[c.label] = Math.max(biggest[c.label] || 0, c.pix.length);
  let moved = 0;
  // dalle isole più piccole: così un'isola dentro un'altra isola si risolve prima
  for (const c of [...comps].sort((a, b) => a.pix.length - b.pix.length)) {
    if (c.pix.length >= biggest[c.label]) continue;
    if (c.pix.length >= minPx && c.pix.length >= minShare * biggest[c.label]) continue;
    const votes = {};
    for (const i of c.pix) {
      const x = i % W, y = (i - x) / W;
      for (const [dx, dy] of N4) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const l = parts[ny * W + nx];
        if (l && l !== c.label) votes[l] = (votes[l] || 0) + 1;
      }
    }
    const best = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
    if (!best) continue; // isola staccata da tutto: resta (es. moneta che vola) e diventa un pezzo a sé
    for (const i of c.pix) parts[i] = +best[0];
    moved += c.pix.length;
  }
  return moved;
}

/** Componenti connesse (4-vicinato) dei pixel con etichetta `label`, dalla più grande. */
function components(parts, W, H, label) {
  const seen = new Uint8Array(W * H);
  const out = [];
  for (let s = 0; s < W * H; s++) {
    if (parts[s] !== label || seen[s]) continue;
    const pix = [];
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const i = stack.pop();
      pix.push(i);
      const x = i % W, y = (i - x) / W;
      for (const [dx, dy] of N4) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (!seen[j] && parts[j] === label) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    out.push(pix);
  }
  return out.sort((a, b) => b.length - a.length);
}

/**
 * Pixel nascosti del genitore: pixel di un pezzo davanti che sono "racchiusi" dal genitore
 * (genitore presente a sinistra E a destra sulla riga, entro `reach` pixel). Non si
 * ricostruisce tutto ciò che c'è sotto un braccio teso fuori dal corpo, solo l'interno.
 */
function hiddenPixels(parts, W, H, parentLabel, occluderLabels, reach) {
  const occ = new Uint8Array(PARTS.length);
  for (const l of occluderLabels) occ[l] = 1;
  const out = [];
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      if (!occ[parts[row + x]]) continue;
      let left = false, right = false;
      for (let d = 1; d <= reach && x - d >= 0; d++) {
        const l = parts[row + x - d];
        if (l === parentLabel) { left = true; break; }
        if (!l) break; // sfondo: siamo sul bordo esterno
      }
      if (!left) continue;
      for (let d = 1; d <= reach && x + d < W; d++) {
        const l = parts[row + x + d];
        if (l === parentLabel) { right = true; break; }
        if (!l) break;
      }
      if (right) out.push(row + x);
    }
  }
  return out;
}

/**
 * Riempie i pixel `holes` del ritaglio propagando i colori dai pixel noti (a "buccia di
 * cipolla": ogni giro riempie il bordo del buco con la media dei vicini già noti).
 * Bozza: niente dettagli, ma nessun buco trasparente quando il pezzo davanti si muove.
 */
function fillHoles(rgba, known, W, H, holes) {
  let todo = holes.filter((i) => !known[i]);
  let guard = 0;
  while (todo.length && guard++ < 4000) {
    const next = [];
    const done = [];
    for (const i of todo) {
      const x = i % W, y = (i - x) / W;
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const j = ny * W + nx;
          if (!known[j]) continue;
          r += rgba[j * 4]; g += rgba[j * 4 + 1]; b += rgba[j * 4 + 2]; n++;
        }
      if (n) done.push([i, r / n, g / n, b / n]);
      else next.push(i);
    }
    if (!done.length) break;
    for (const [i, r, g, b] of done) {
      rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = 255;
      known[i] = 1;
    }
    todo = next;
  }
}

/**
 * @param {Object} o
 * @param {number} o.width
 * @param {number} o.height
 * @param {Uint8ClampedArray|Uint8Array} o.rgba - immagine originale
 * @param {Uint8Array} o.parts - etichette di recognizeParts (NON modificate: si lavora su una copia)
 * @param {Object} o.joints - articolazioni di recognizeParts
 * @param {Array} [o.objectSeeds] - per sapere quale mano tiene l'oggetto
 * @param {number} [o.overlap=2] - pixel di sovrapposizione dei pezzi figli sul genitore (raccordo)
 * @param {boolean} [o.reconstruct=true] - ricostruisce (bozza) le zone nascoste del genitore
 * @returns {{ pieces: Array, labels: Uint8Array, warnings: string[] }}
 */
export function extractPieces({ width: W, height: H, rgba, parts: srcParts, joints, objectSeeds = [], overlap = 2, reconstruct = true }) {
  const warnings = [];
  const parts = Uint8Array.from(srcParts);
  const moved = cleanIslands(parts, W, H);
  if (moved) warnings.push(`Pulizia: ${moved} pixel di isole sparse riassegnati alla parte vicina.`);

  // scala del personaggio (per raggi e distanze)
  const sw = joints?.spalla_sx && joints?.spalla_dx ? Math.hypot(joints.spalla_sx.x - joints.spalla_dx.x, joints.spalla_sx.y - joints.spalla_dx.y) : Math.min(W, H) / 4;

  // oggetti: i frammenti troppo piccoli per essere un pezzo animabile tornano alla parte vicina
  const objComps = components(parts, W, H, PART.oggetto_in_mano);
  const minObj = 0.01 * sw * sw;
  for (const pix of objComps.filter((c) => c.length < minObj)) {
    const votes = {};
    for (const i of pix) {
      const x = i % W, y = (i - x) / W;
      for (const [dx, dy] of N4) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const l = parts[ny * W + nx];
        if (l && l !== PART.oggetto_in_mano) votes[l] = (votes[l] || 0) + 1;
      }
    }
    const best = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
    const to = best ? +best[0] : PART.busto;
    for (const i of pix) parts[i] = to;
  }

  // pezzi: una parte = un pezzo; gli oggetti si dividono per componente connessa
  // (un oggetto per mano, o una moneta staccata = pezzo a sé)
  const specs = [];
  for (const name of Object.keys(PIECE_RULES)) {
    const label = PART[name];
    if (name === "oggetto_in_mano") {
      const comps = components(parts, W, H, label);
      comps.forEach((pix, k) => {
        let sx = 0, sy = 0;
        for (const i of pix) { sx += i % W; sy += Math.floor(i / W); }
        const c = { x: sx / pix.length, y: sy / pix.length };
        // mano più vicina = mano che lo tiene
        const hands = ["sx", "dx"].filter((s) => joints?.[`mano_${s}`]);
        const side = hands.sort((a, b) => Math.hypot(joints[`mano_${a}`].x - c.x, joints[`mano_${a}`].y - c.y) - Math.hypot(joints[`mano_${b}`].x - c.x, joints[`mano_${b}`].y - c.y))[0]
          || objectSeeds[0]?.side || "dx";
        specs.push({ name: comps.length > 1 ? `oggetto_${k + 1}` : "oggetto", label, pix, side, rule: PIECE_RULES[name] });
      });
    } else {
      const pix = [];
      for (let i = 0; i < W * H; i++) if (parts[i] === label) pix.push(i);
      if (pix.length) specs.push({ name, label, pix, rule: PIECE_RULES[name] });
    }
  }

  const present = new Set(specs.map((s) => s.name));
  const pieces = [];
  for (const s of specs) {
    // genitore: per gli oggetti l'avambraccio della mano che li tiene
    let parent = s.rule.parent;
    if (s.label === PART.oggetto_in_mano) parent = present.has(`avambraccio_${s.side}`) ? `avambraccio_${s.side}` : "busto";
    if (parent && !present.has(parent)) parent = present.has("busto") ? (s.name === "busto" ? null : "busto") : null;

    // maschera del pezzo + raccordo (dilatazione sui pixel del genitore)
    const mask = new Uint8Array(W * H);
    for (const i of s.pix) mask[i] = 1;
    const parentLabel = parent ? PART[parent] ?? PART.busto : 0;
    if (overlap > 0 && parentLabel) {
      let frontier = s.pix;
      for (let k = 0; k < overlap; k++) {
        const next = [];
        for (const i of frontier) {
          const x = i % W, y = (i - x) / W;
          for (const [dx, dy] of N4) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            const j = ny * W + nx;
            if (!mask[j] && parts[j] === parentLabel) {
              mask[j] = 1;
              next.push(j);
            }
          }
        }
        frontier = next;
      }
    }
    // zone nascoste sotto i pezzi davanti
    let hidden = [];
    if (reconstruct && OCCLUDERS[s.name]) {
      const occ = OCCLUDERS[s.name].map((n) => PART[n]);
      hidden = hiddenPixels(parts, W, H, s.label, occ, Math.round(1.2 * sw));
      for (const i of hidden) mask[i] = 2;
    }

    let minX = W, minY = H, maxX = -1, maxY = -1;
    for (let i = 0; i < W * H; i++)
      if (mask[i]) {
        const x = i % W, y = (i - x) / W;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    if (maxX < 0) continue;
    const w = maxX - minX + 1, h = maxY - minY + 1;
    const out = new Uint8ClampedArray(w * h * 4);
    const known = new Uint8Array(w * h);
    const holes = [];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const gi = (y + minY) * W + (x + minX);
        const li = y * w + x;
        if (mask[gi] === 1) {
          out[li * 4] = rgba[gi * 4];
          out[li * 4 + 1] = rgba[gi * 4 + 1];
          out[li * 4 + 2] = rgba[gi * 4 + 2];
          out[li * 4 + 3] = rgba[gi * 4 + 3] ?? 255;
          known[li] = 1;
        } else if (mask[gi] === 2) holes.push(li);
      }
    if (holes.length) fillHoles(out, known, w, h, holes);

    pieces.push({
      name: s.name,
      part: PARTS[s.label],
      parent,
      order: s.rule.order,
      x: minX,
      y: minY,
      width: w,
      height: h,
      pixels: s.pix.length,
      reconstructedPixels: holes.length,
      pivot: pivotFor(s, { minX, minY, maxX, maxY }, joints),
      rgba: out
    });
  }
  pieces.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  return { pieces, labels: parts, warnings };
}

function pivotFor(s, box, joints) {
  const key = s.rule.pivot;
  const bottom = { x: (box.minX + box.maxX) / 2, y: box.maxY };
  let p;
  if (key === "fondo") p = bottom;
  else if (key === "mano") p = joints?.[`mano_${s.side}`];
  else p = joints?.[key];
  p = p || bottom;
  return { x: Math.round(p.x), y: Math.round(p.y) };
}

/** Ricompone i pezzi (in ordine di disegno) in un'immagine W×H: serve per verifica e anteprima. */
export function composePieces(pieces, W, H) {
  const out = new Uint8ClampedArray(W * H * 4);
  for (const p of [...pieces].sort((a, b) => a.order - b.order)) {
    for (let y = 0; y < p.height; y++)
      for (let x = 0; x < p.width; x++) {
        const li = (y * p.width + x) * 4;
        const a = p.rgba[li + 3] / 255;
        if (!a) continue;
        const gi = ((y + p.y) * W + (x + p.x)) * 4;
        for (let k = 0; k < 3; k++) out[gi + k] = p.rgba[li + k] * a + out[gi + k] * (1 - a);
        out[gi + 3] = Math.max(out[gi + 3], p.rgba[li + 3]);
      }
  }
  return out;
}

/** Descrizione dei pezzi senza i pixel (per layout.json). */
export function piecesLayout(pieces, W, H, source) {
  return {
    source,
    size: [W, H],
    note: "x,y = angolo in alto a sinistra del pezzo nell'immagine originale; pivot in coordinate dell'immagine; order = ordine di disegno (0 = dietro).",
    pieces: pieces.map(({ rgba: _rgba, ...p }) => ({ ...p, file: `${p.name}.png` }))
  };
}
