// src/lib/explodedSheet.js — import di una TAVOLA ESPLOSA: il personaggio già diviso in pezzi
// (testa, busto, braccia, oggetti), staccati tra loro su uno sfondo a tinta unita (es. blu
// chroma), con le zone nascoste già ridisegnate (generata da un modello di immagini a partire
// dall'immagine originale). Qui la parte deterministica della pipeline:
//   1. sfondo -> trasparenza (chroma key con "despill" dei bordi)
//   2. un pezzo = una componente connessa
//   3. ogni pezzo viene RIMESSO al suo posto cercandolo nell'immagine originale
//      (traslazione, scala comune stimata sul pezzo più grande)
//   4. nome del pezzo dalla posa dell'originale (naso -> testa, anche -> busto,
//      gomito -> braccio, il resto -> oggetto)
//   5. ordine di disegno: dove due pezzi si sovrappongono, davanti sta quello che
//      nell'originale si vede (somiglia di più ai pixel originali)
// Tutto puro e testabile: nessun DOM.

import { LM } from "./partRecognition.js";

/** Colori di sfondo "chroma" proponibili per la tavola esplosa. */
export const CHROMA_COLORS = [
  { name: "blue", hex: "#0018FF", rgb: [0, 24, 255] },
  { name: "green", hex: "#00FF00", rgb: [0, 255, 0] },
  { name: "magenta", hex: "#FF00FF", rgb: [255, 0, 255] }
];

/** Quota dei pixel del personaggio "vicini" a un colore (sparirebbero con quel colore di sfondo). */
export function colorShareInCharacter({ width: W, height: H, rgba }, rgb, { near = 140 } = {}) {
  const bg = borderColor({ width: W, height: H, rgba });
  let n = 0, hit = 0;
  const step = Math.max(1, Math.floor((W * H) / 60000));
  for (let i = 0; i < W * H; i += step) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2], a = rgba[i * 4 + 3];
    if (a < 128 || Math.hypot(r - bg[0], g - bg[1], b - bg[2]) < 40) continue; // sfondo dell'originale
    n++;
    if (Math.hypot(r - rgb[0], g - rgb[1], b - rgb[2]) < near) hit++;
  }
  return n ? hit / n : 0;
}

/**
 * Sceglie il colore di sfondo per la tavola esplosa: quello MENO presente nel personaggio
 * (caso reale: cavaliere con tabarro blu su sfondo blu -> il tabarro sparisce allo scontorno).
 * A parità vince l'ordine di CHROMA_COLORS (blu, verificato sul folletto).
 */
export function chooseChromaColor(original) {
  let best = null;
  for (const c of CHROMA_COLORS) {
    const share = colorShareInCharacter(original, c.rgb);
    if (!best || share < best.share - 0.002) best = { ...c, share };
  }
  return best;
}

/** Pezzi massimi in una tavola esplosa: oltre, il modello ha frammentato il personaggio. */
export const MAX_PIECES = 12;

/**
 * Controlli PRIMA di elaborare la tavola, con un messaggio chiaro invece di decine di pezzi
 * sbagliati (caso reale: caricata l'immagine originale al posto della tavola):
 *  - la tavola non deve essere l'immagine originale;
 *  - lo sfondo deve essere un colore "chroma" (saturo, es. blu #0018FF), non nero/bianco/grigio:
 *    con uno sfondo neutro i contorni scuri del disegno sparirebbero insieme allo sfondo.
 */
export function checkSheet(sheet, original) {
  if (original && sheet.width === original.width && sheet.height === original.height) {
    let diff = 0, n = 0;
    const step = Math.max(1, Math.floor((sheet.width * sheet.height) / 50000));
    for (let i = 0; i < sheet.width * sheet.height; i += step, n++)
      for (let k = 0; k < 3; k++) diff += Math.abs(sheet.rgba[i * 4 + k] - original.rgba[i * 4 + k]);
    if (diff / (n * 3) < 6)
      throw new Error("Hai caricato l'immagine ORIGINALE come tavola: serve la tavola esplosa (pezzi staccati su sfondo blu) generata con il prompt.");
  }
  const bg = borderColor(sheet);
  if (Math.max(...bg) - Math.min(...bg) < 80)
    throw new Error(
      `Lo sfondo della tavola non è un colore pieno saturo (rgb ${bg.join(",")}): serve uno sfondo chroma, es. blu #0018FF. Con nero, bianco o grigio i contorni del disegno verrebbero tagliati.`
    );
}

/** Errore medio massimo perché una tavola sia considerata fedele (pixel dell'originale conservati). */
export const FIDELITY_MAX = 50;

const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];

/** Colore di sfondo = mediana dei pixel del bordo dell'immagine. */
export function borderColor({ width: W, height: H, rgba }) {
  const ch = [[], [], []];
  const push = (x, y) => {
    const i = (y * W + x) * 4;
    ch[0].push(rgba[i]); ch[1].push(rgba[i + 1]); ch[2].push(rgba[i + 2]);
  };
  for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1); }
  for (let y = 0; y < H; y++) { push(0, y); push(W - 1, y); }
  return ch.map((c) => c.sort((a, b) => a - b)[c.length >> 1]);
}

/**
 * Chroma key: alpha morbido dalla distanza dal colore di sfondo (0 sotto `lo`, 1 sopra `hi`).
 * @returns {{ alpha: Float32Array, bg: number[] }}
 */
export function keyBackground(img, { lo = 60, hi = 140 } = {}) {
  const { width: W, height: H, rgba } = img;
  const bg = borderColor(img);
  const alpha = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const d = Math.hypot(rgba[i * 4] - bg[0], rgba[i * 4 + 1] - bg[1], rgba[i * 4 + 2] - bg[2]);
    alpha[i] = Math.min(1, Math.max(0, (d - lo) / (hi - lo)));
  }
  return { alpha, bg };
}

/** Componenti connesse (8-vicinato) dei pixel con alpha > 0.5, scartando le briciole. */
export function splitComponents(alpha, W, H, minArea = 500) {
  const lab = new Int32Array(W * H);
  const comps = [];
  for (let s = 0; s < W * H; s++) {
    if (alpha[s] <= 0.5 || lab[s]) continue;
    const id = comps.length + 1;
    const stack = [s];
    lab[s] = id;
    let n = 0, minX = W, minY = H, maxX = 0, maxY = 0;
    while (stack.length) {
      const i = stack.pop();
      n++;
      const x = i % W, y = (i - x) / W;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      for (const [dx, dy] of N8) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (!lab[j] && alpha[j] > 0.5) {
          lab[j] = id;
          stack.push(j);
        }
      }
    }
    comps.push({ id, area: n, minX, minY, maxX, maxY });
  }
  return { lab, comps: comps.filter((c) => c.area >= minArea) };
}

/** Ritaglio RGBA di una componente (bordo morbido incluso) con il blu dello sfondo tolto dai bordi. */
function cutPiece(img, alpha, lab, comp, bg, pad = 3) {
  const { width: W, height: H, rgba } = img;
  const x0 = Math.max(0, comp.minX - pad), y0 = Math.max(0, comp.minY - pad);
  const x1 = Math.min(W - 1, comp.maxX + pad), y1 = Math.min(H - 1, comp.maxY + pad);
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const gi = (y + y0) * W + (x + x0);
      if (lab[gi] && lab[gi] !== comp.id) continue; // pixel di un altro pezzo
      const a = lab[gi] === comp.id ? Math.max(alpha[gi], 0.5) : alpha[gi];
      if (a <= 0) continue;
      const li = (y * w + x) * 4;
      for (let k = 0; k < 3; k++) out[li + k] = (rgba[gi * 4 + k] - (1 - a) * bg[k]) / a; // despill
      out[li + 3] = Math.round(a * 255);
    }
  suppressSpill(out, w, h, bg);
  return { sheetX: x0, sheetY: y0, width: w, height: h, rgba: out };
}

/**
 * Alone di sfondo sui bordi (filo blu/violaceo attorno ai pezzi): nella fascia di SPILL_BAND
 * pixel dal bordo trasparente il canale dominante dello sfondo (es. il blu) non può superare
 * il massimo degli altri due; il primo pixel del bordo viene anche reso più trasparente.
 */
const SPILL_BAND = 3;
function suppressSpill(out, w, h, bg) {
  const k = bg.indexOf(Math.max(...bg)); // canale dominante dello sfondo
  if (bg[k] - Math.max(...bg.filter((_, i) => i !== k)) < 80) return; // sfondo non "chroma"
  const dist = new Int32Array(w * h).fill(SPILL_BAND + 1);
  const q = [];
  for (let i = 0; i < w * h; i++)
    if (out[i * 4 + 3] === 0) {
      dist[i] = 0;
      q.push(i);
    }
  for (let qi = 0; qi < q.length; qi++) {
    const i = q[qi];
    if (dist[i] >= SPILL_BAND) continue;
    const x = i % w, y = (i - x) / w;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (dist[j] > dist[i] + 1) {
        dist[j] = dist[i] + 1;
        q.push(j);
      }
    }
  }
  for (let i = 0; i < w * h; i++) {
    if (!out[i * 4 + 3] || dist[i] > SPILL_BAND) continue;
    const o = [out[i * 4], out[i * 4 + 1], out[i * 4 + 2]];
    const cap = Math.max(...o.filter((_, j) => j !== k));
    if (o[k] > cap) out[i * 4 + k] = cap;
    if (dist[i] === 1) out[i * 4 + 3] = Math.round(out[i * 4 + 3] * 0.6);
  }
}

/** Campioni (pixel opachi) del pezzo per il confronto con l'originale. */
function samplesOf(piece, max) {
  const all = [];
  for (let y = 0; y < piece.height; y++)
    for (let x = 0; x < piece.width; x++) if (piece.rgba[(y * piece.width + x) * 4 + 3] >= 240) all.push(y * piece.width + x);
  if (all.length <= max) return all;
  const step = all.length / max;
  const out = [];
  for (let k = 0; k < max; k++) out.push(all[Math.floor(k * step)]);
  return out;
}

/**
 * Errore medio (troncato) tra il pezzo, scalato di `s` e posto in (tx,ty), e l'originale.
 * Troncato: le zone RIDISEGNATE (nascoste nell'originale) non devono pesare troppo.
 */
function matchError(piece, samples, orig, tx, ty, s, T = 120) {
  const { width: W, height: H, rgba } = orig;
  let e = 0, n = 0;
  for (const li of samples) {
    const lx = li % piece.width, ly = (li - lx) / piece.width;
    const x = Math.round(tx + lx * s), y = Math.round(ty + ly * s);
    if (x < 0 || y < 0 || x >= W || y >= H) { e += T; n++; continue; }
    const gi = (y * W + x) * 4, pi = li * 4;
    const d = Math.abs(rgba[gi] - piece.rgba[pi]) + Math.abs(rgba[gi + 1] - piece.rgba[pi + 1]) + Math.abs(rgba[gi + 2] - piece.rgba[pi + 2]);
    e += Math.min(d, T);
    n++;
  }
  return e / Math.max(1, n);
}

/**
 * Posizione del pezzo nell'originale: ricerca grossolana a passo `coarse` px su tutta
 * l'immagine con pochi campioni, poi rifinitura a 1 px con più campioni.
 */
export function alignPiece(piece, orig, s = 1, { coarse = 8, nFew = 200, window = null } = {}) {
  const few = samplesOf(piece, nFew);
  const mid = samplesOf(piece, 1000);
  const many = samplesOf(piece, 4000);
  const pw = piece.width * s, ph = piece.height * s;
  let best = { x: 0, y: 0, err: Infinity };
  for (let ty = -Math.round(ph / 2); ty <= orig.height - ph / 2; ty += coarse)
    for (let tx = -Math.round(pw / 2); tx <= orig.width - pw / 2; tx += coarse) {
      // finestra opzionale: il CENTRO del pezzo deve cadere entro r da (cx,cy)
      if (window && Math.hypot(tx + pw / 2 - window.cx, ty + ph / 2 - window.cy) > window.r) continue;
      const e = matchError(piece, few, orig, tx, ty, s);
      if (e < best.err) best = { x: tx, y: ty, err: e };
    }
  // rifinitura in due passi: ±coarse a passo 2, poi ±2 a passo 1
  for (const [range, step, smp] of [[coarse, 2, mid], [2, 1, many]]) {
    let b = { ...best, err: Infinity };
    for (let ty = best.y - range; ty <= best.y + range; ty += step)
      for (let tx = best.x - range; tx <= best.x + range; tx += step) {
        const e = matchError(piece, smp, orig, tx, ty, s);
        if (e < b.err) b = { x: tx, y: ty, err: e };
      }
    best = b;
  }
  return best;
}

/** Scala comune tavola -> originale, stimata sul pezzo più grande. */
export function estimateScale(piece, orig, scales = [0.8, 0.85, 0.9, 0.95, 1.05, 1.1, 1.15, 1.2, 1.25]) {
  // quasi sempre il modello mantiene la scala: se a scala 1 il pezzo combacia, basta così
  const at1 = alignPiece(piece, orig, 1);
  if (at1.err < 35) return 1;
  let best = { s: 1, err: at1.err };
  for (const s of scales) {
    const r = alignPiece(piece, orig, s, { coarse: 12, nFew: 150 });
    if (r.err < best.err) best = { s, err: r.err };
  }
  for (const s of [best.s - 0.02, best.s - 0.01, best.s + 0.01, best.s + 0.02]) {
    const r = alignPiece(piece, orig, s, { coarse: 12, nFew: 150 });
    if (r.err < best.err) best = { s, err: r.err };
  }
  return best.s;
}

/** Pezzo scalato (nearest) per lavorare tutto in coordinate dell'originale. */
function scalePiece(p, s) {
  if (Math.abs(s - 1) < 1e-6) return p;
  const w = Math.max(1, Math.round(p.width * s)), h = Math.max(1, Math.round(p.height * s));
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sx = Math.min(p.width - 1, Math.floor(x / s)), sy = Math.min(p.height - 1, Math.floor(y / s));
      out.set(p.rgba.subarray((sy * p.width + sx) * 4, (sy * p.width + sx) * 4 + 4), (y * w + x) * 4);
    }
  return { ...p, width: w, height: h, rgba: out };
}

const alphaAt = (p, x, y) => {
  const lx = Math.round(x - p.x), ly = Math.round(y - p.y);
  if (lx < 0 || ly < 0 || lx >= p.width || ly >= p.height) return 0;
  return p.rgba[(ly * p.width + lx) * 4 + 3];
};
/** Il pezzo copre il punto (entro un piccolo raggio)? */
function covers(p, pt, r = 12) {
  if (!pt) return false;
  for (let dy = -r; dy <= r; dy += 3) for (let dx = -r; dx <= r; dx += 3) if (alphaAt(p, pt.x + dx, pt.y + dy) > 128) return true;
  return false;
}

/**
 * Nomi dalla posa dell'originale. Il gomito decide il braccio (polso e spalla possono cadere
 * su un oggetto tenuto in mano); tutto ciò che non è testa/busto/braccio è un oggetto.
 */
export function labelPieces(pieces, landmarks) {
  const P = (i) => landmarks?.[i];
  const taken = new Set();
  const pick = (name, pts) => {
    const cand = pieces.filter((p) => !taken.has(p) && pts.some((pt) => covers(p, pt)));
    if (!cand.length) return;
    const p = cand.sort((a, b) => b.area - a.area)[0];
    p.name = name;
    taken.add(p);
  };
  pick("testa", [P(LM.nose)]);
  pick("busto", [P(LM.hipSx), P(LM.hipDx)]);
  pick("braccio_sx", [P(LM.elbowSx)]);
  pick("braccio_dx", [P(LM.elbowDx)]);
  let k = 0;
  const rest = pieces.filter((p) => !taken.has(p));
  for (const p of rest) p.name = rest.length > 1 ? `oggetto_${++k}` : "oggetto";
}

/**
 * Ordine di disegno: per ogni coppia sovrapposta, davanti il pezzo i cui pixel nella
 * sovrapposizione somigliano di più all'originale; poi ordinamento topologico.
 */
export function orderPieces(pieces, orig) {
  const { width: W, rgba } = orig;
  const front = [];
  for (let a = 0; a < pieces.length; a++)
    for (let b = a + 1; b < pieces.length; b++) {
      const A = pieces[a], B = pieces[b];
      const x0 = Math.max(A.x, B.x), y0 = Math.max(A.y, B.y);
      const x1 = Math.min(A.x + A.width, B.x + B.width), y1 = Math.min(A.y + A.height, B.y + B.height);
      let ea = 0, eb = 0, n = 0;
      for (let y = Math.max(0, y0); y < Math.min(orig.height, y1); y++)
        for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) {
          const ia = ((y - A.y) * A.width + (x - A.x)) * 4, ib = ((y - B.y) * B.width + (x - B.x)) * 4;
          if (A.rgba[ia + 3] < 230 || B.rgba[ib + 3] < 230) continue;
          const g = (y * W + x) * 4;
          for (let k = 0; k < 3; k++) {
            ea += Math.abs(A.rgba[ia + k] - rgba[g + k]);
            eb += Math.abs(B.rgba[ib + k] - rgba[g + k]);
          }
          n++;
        }
      if (n < 30) continue;
      front.push(ea <= eb ? [B, A] : [A, B]); // [dietro, davanti]
    }
  const indeg = new Map(pieces.map((p) => [p, 0]));
  const next = new Map(pieces.map((p) => [p, []]));
  for (const [back, fr] of front) {
    next.get(back).push(fr);
    indeg.set(fr, indeg.get(fr) + 1);
  }
  const ready = pieces.filter((p) => !indeg.get(p)).sort((a, b) => b.area - a.area);
  const out = [];
  while (ready.length) {
    const p = ready.shift();
    out.push(p);
    for (const f of next.get(p)) {
      indeg.set(f, indeg.get(f) - 1);
      if (!indeg.get(f)) ready.push(f);
    }
  }
  for (const p of pieces) if (!out.includes(p)) out.push(p); // ciclo (raro): in coda
  out.forEach((p, i) => (p.order = i));
  return front.map(([b, f]) => [b.name, f.name]);
}

/** Genitore e pivot per il rig (stesse convenzioni di partExtraction.js). */
function rigInfo(p, joints, landmarks) {
  const L = (i) => landmarks?.[i];
  const mid = (a, b) => (a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null);
  const bottom = { x: p.x + p.width / 2, y: p.y + p.height };
  let parent = null, pivot = null;
  if (p.name === "busto") pivot = mid(L(LM.hipSx), L(LM.hipDx)) || bottom;
  else if (p.name === "testa") { parent = "busto"; pivot = joints?.base_collo || mid(L(LM.shoulderSx), L(LM.shoulderDx)); }
  else if (p.name === "braccio_sx") { parent = "busto"; pivot = L(LM.shoulderSx); }
  else if (p.name === "braccio_dx") { parent = "busto"; pivot = L(LM.shoulderDx); }
  else {
    // oggetto: lo tiene la mano più vicina al suo centro
    const c = { x: p.x + p.width / 2, y: p.y + p.height / 2 };
    const hands = [["sx", joints?.mano_sx || L(LM.wristSx)], ["dx", joints?.mano_dx || L(LM.wristDx)]].filter(([, h]) => h);
    hands.sort((a, b) => Math.hypot(a[1].x - c.x, a[1].y - c.y) - Math.hypot(b[1].x - c.x, b[1].y - c.y));
    if (hands.length) { parent = `braccio_${hands[0][0]}`; pivot = hands[0][1]; }
  }
  pivot = pivot || bottom;
  return { parent, pivot: { x: Math.round(pivot.x), y: Math.round(pivot.y) } };
}

/**
 * @param {Object} o
 * @param {{width,height,rgba}} o.sheet - tavola esplosa
 * @param {{width,height,rgba}} o.original - immagine originale del personaggio intero
 * @param {Array<{x,y}>} [o.landmarks] - posa MediaPipe dell'originale, in pixel
 * @param {Object} [o.joints] - articolazioni di recognizeParts (base collo, mani)
 * @returns {{ pieces: Array, scale: number, front: Array, warnings: string[] }}
 */
export function importExplodedSheet({ sheet, original, landmarks, joints, minArea }) {
  const warnings = [];
  checkSheet(sheet, original);
  const { alpha, bg } = keyBackground(sheet);
  if (original) {
    const share = colorShareInCharacter(original, bg);
    if (share > 0.005)
      warnings.push(
        `Il colore dello sfondo della tavola (rgb ${bg.join(",")}) è presente nel personaggio (${Math.round(share * 100)}% dei pixel): quelle zone possono sparire allo scontorno. Rigenera la tavola con lo sfondo consigliato da "Copia prompt".`
      );
  }
  const { lab, comps } = splitComponents(alpha, sheet.width, sheet.height, minArea ?? Math.round(0.0004 * sheet.width * sheet.height));
  if (!comps.length) throw new Error("Nessun pezzo trovato: lo sfondo della tavola deve essere a tinta unita.");
  if (comps.length > MAX_PIECES)
    throw new Error(
      `Tavola troppo frammentata: ${comps.length} pezzi (massimo ${MAX_PIECES}). Il modello ha diviso il personaggio in troppe parti (es. ogni piastra dell'armatura): rigenera la tavola chiedendo al massimo 6-8 pezzi grandi.`
    );
  let pieces = comps.map((c) => ({ area: c.area, ...cutPiece(sheet, alpha, lab, c, bg) }));
  const biggest = pieces.reduce((a, b) => (b.area > a.area ? b : a));
  const scale = estimateScale(biggest, original);
  if (Math.abs(scale - 1) > 0.01) warnings.push(`Tavola in scala diversa dall'originale: fattore ${scale.toFixed(2)}.`);
  pieces = pieces.map((p) => {
    const sp = scalePiece(p, scale);
    const pos = alignPiece(sp, original, 1);
    if (pos.err > 80) warnings.push(`Pezzo ${p.sheetX},${p.sheetY}: posizione incerta (errore ${pos.err.toFixed(0)}).`);
    return { ...sp, x: pos.x, y: pos.y, matchError: +pos.err.toFixed(1) };
  });
  labelPieces(pieces, landmarks);
  // Un oggetto è TENUTO in mano: se è finito lontano da entrambe le mani (tavola ridisegnata,
  // confronto ambiguo), lo si ricerca solo attorno alle mani.
  const hands = [joints?.mano_sx || landmarks?.[LM.wristSx], joints?.mano_dx || landmarks?.[LM.wristDx]].filter(Boolean);
  const sw = landmarks ? Math.hypot(landmarks[LM.shoulderSx].x - landmarks[LM.shoulderDx].x, landmarks[LM.shoulderSx].y - landmarks[LM.shoulderDx].y) : 0;
  if (hands.length && sw) {
    for (const p of pieces) {
      if (!p.name.startsWith("oggetto")) continue;
      const c = { x: p.x + p.width / 2, y: p.y + p.height / 2 };
      const r = 0.5 * sw + Math.max(p.width, p.height) / 2;
      if (hands.some((h) => Math.hypot(c.x - h.x, c.y - h.y) <= r)) continue;
      let best = null;
      for (const h of hands) {
        const pos = alignPiece(p, original, 1, { window: { cx: h.x, cy: h.y, r } });
        if (!best || pos.err < best.err) best = pos;
      }
      if (best && isFinite(best.err)) {
        warnings.push(`${p.name}: lontano dalle mani, riposizionato vicino alla mano (errore ${best.err.toFixed(0)}).`);
        Object.assign(p, { x: best.x, y: best.y, matchError: +best.err.toFixed(1) });
      }
    }
  }
  const front = orderPieces(pieces, original);
  for (const p of pieces) Object.assign(p, rigInfo(p, joints, landmarks));
  pieces.sort((a, b) => a.order - b.order);
  // Fedeltà della tavola: errore medio pesato sull'area. Una tavola che RIDISEGNA il personaggio
  // (proporzioni, dettagli, posa diversi) non si ricompone sull'originale e non va usata come
  // dato di addestramento.
  const totA = pieces.reduce((a, p) => a + p.area, 0) || 1;
  const fidelityError = +(pieces.reduce((a, p) => a + p.matchError * p.area, 0) / totA).toFixed(1);
  const faithful = fidelityError <= FIDELITY_MAX;
  if (!faithful)
    warnings.unshift(
      `Tavola NON fedele all'originale (errore medio ${fidelityError}, limite ${FIDELITY_MAX}): il modello ha ridisegnato il personaggio. Ricomposizione approssimata, da non usare per il dataset.`
    );
  return { pieces, scale, front, bg, warnings, fidelityError, faithful };
}
