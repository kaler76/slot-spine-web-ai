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
import { labelFacePieces, labelBackHair, isFaceName, facePivot, faceFrame } from "./faceRig.js";
import { checkPieces } from "./pieceCheck.js";
import { applyHandObjects, handObjectRig, checkHandObjects } from "./handObject.js";
import { finishAttachments } from "./attachmentFinishing.js";
import { planFaceGroup, transplantOriginal } from "./sheetAssembly.js";
import { placeByPartMap } from "./partMap.js";

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
export const MAX_PIECES = 16; // corpo (4-6) + viso (occhi, sopracciglia, bocca, ciocche)

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
/**
 * Oltre FIDELITY_MAX ma entro USABLE_MAX: tavola leggermente ridisegnata (luci, dettagli, scala)
 * ma con la stessa posa: va bene per creare il character, non per il dataset (avvocato: 62).
 * Oltre USABLE_MAX la posa è cambiata (braccia distese, sacchetto diverso): folletto
 * ridisegnato 83, cavaliere 100.
 */
export const USABLE_MAX = 75;

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
  // con la finestra si scorre solo il suo riquadro (stessa griglia di passo coarse)
  const ty0 = -Math.round(ph / 2), tx0 = -Math.round(pw / 2);
  const snap = (v, o) => o + Math.max(0, Math.ceil((v - o) / coarse)) * coarse;
  const yA = window ? snap(window.cy - window.r - ph / 2, ty0) : ty0, yB = window ? Math.min(orig.height - ph / 2, window.cy + window.r - ph / 2) : orig.height - ph / 2;
  const xA = window ? snap(window.cx - window.r - pw / 2, tx0) : tx0, xB = window ? Math.min(orig.width - pw / 2, window.cx + window.r - pw / 2) : orig.width - pw / 2;
  for (let ty = yA; ty <= yB; ty += coarse)
    for (let tx = xA; tx <= xB; tx += coarse) {
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

/** Ricomposizione con i pixel dell'originale: sagome sovrapposte almeno così (IoU) e buchi al massimo così. */
// calibrate: zeus 0.861 / 5.3% (stessa posa) contro folletto_ridisegnata 0.815 / 9.3% (posa cambiata)
export const ASSEMBLY_IOU_MIN = 0.84;
export const ASSEMBLY_HOLES_MAX = 0.01;
export const ASSEMBLY_FILL_MAX = 0.07;
/** Errore oltre il quale un pezzo piccolo non combacia (= pieceCheck.PIECE_RULES.smallErrMax). */
const SMALL_ERR_MAX = 65;
/** Scale provate per i pezzi piccoli del viso (relative alla scala comune della tavola). */
const FACE_SCALES = [0.6, 0.7, 0.8, 0.9, 1.1, 1.2, 1.3, 1.45];

/**
 * Pezzo PICCOLO che non combacia alla scala comune: il modello spesso disegna occhi,
 * sopracciglia e bocca più grandi o più piccoli del resto (caso reale: Zeus, occhi ingranditi
 * -> "posizione incerta", occhio chiamato dettaglio_viso, sopracciglia chiamate oggetto e
 * portate vicino alla mano). Si cerca il pezzo a più scale, solo attorno al viso.
 * @returns {{ piece, pos, s } | null} pezzo riscalato e posizione, se migliora davvero
 */
export function alignFacePieceScaled(piece, original, win, current) {
  let best = null;
  for (const s of FACE_SCALES) {
    const sp = scalePiece(piece, s);
    if (sp.width < 4 || sp.height < 4) continue;
    const pos = alignPiece(sp, original, 1, { coarse: 2, nFew: 600, window: win });
    if (!best || pos.err < best.pos.err) best = { piece: sp, pos, s };
  }
  // accettato solo se combacia (sotto la soglia dei pezzi piccoli) e migliora nettamente
  if (!best || !isFinite(best.pos.err) || best.pos.err > SMALL_ERR_MAX || best.pos.err > current - 15) return null;
  return best;
}

/** Tratto del viso cercato solo attorno al suo punto (raggio r), a scala 1 e alle scale del viso. */
function placeAtTarget(piece, original, pt, r, maxErr = 72) {
  let best = null;
  for (const s of [1, ...FACE_SCALES]) {
    const sp = scalePiece(piece, s);
    if (sp.width < 4 || sp.height < 4) continue;
    const pos = alignPiece(sp, original, 1, { coarse: 2, nFew: 300, window: { cx: pt.x, cy: pt.y, r } });
    // a parità (entro 3) si preferisce la scala 1
    if (!best || pos.err < best.pos.err - (s === 1 ? 0 : 0) - (best.s === 1 ? 3 : 0)) best = { piece: sp, pos, s };
  }
  return best && isFinite(best.pos.err) && best.pos.err <= maxErr ? best : null;
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
  // Ogni ruolo ha un punto OBBLIGATORIO (naso, un'anca, il gomito: polso e spalla possono cadere
  // su un oggetto tenuto in mano) e un gruppo di punti per il punteggio = quota coperta.
  // Assegnazione globale dal punteggio più alto: un braccio alzato davanti al viso copre il naso
  // ma copre molto meglio i punti del braccio, quindi resta braccio (caso trovato dai test
  // sintetici: con la vecchia regola "il più grande che copre il naso" diventava testa).
  const ROLES = [
    { name: "testa", must: [LM.nose], pts: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
    { name: "busto", must: [LM.hipSx, LM.hipDx], pts: [LM.hipSx, LM.hipDx, LM.shoulderSx, LM.shoulderDx] },
    { name: "braccio_sx", must: [LM.elbowSx], pts: [LM.shoulderSx, LM.elbowSx, LM.wristSx, LM.pinkySx, LM.indexSx, LM.thumbSx], limb: [LM.shoulderSx, LM.elbowSx, LM.wristSx] },
    { name: "braccio_dx", must: [LM.elbowDx], pts: [LM.shoulderDx, LM.elbowDx, LM.wristDx, LM.pinkyDx, LM.indexDx, LM.thumbDx], limb: [LM.shoulderDx, LM.elbowDx, LM.wristDx] }
  ];
  // punteggio = completezza (quota dei punti del ruolo coperti) × specificità (quota dei punti
  // coperti dal pezzo che appartengono al ruolo): il busto copre anche gomiti e polsi delle
  // braccia abbassate lungo il corpo, ma non è "specifico" di un braccio.
  const all = [...new Set(ROLES.flatMap((r) => r.pts))].filter((i) => P(i));
  const cand = [];
  for (const p of pieces) {
    if (p.faceLocked) continue; // tratto del viso già riconosciuto dal gruppo (sheetAssembly)
    const coveredAll = new Set(all.filter((i) => covers(p, P(i))));
    for (const r of ROLES) {
      if (!r.must.some((i) => covers(p, P(i)))) continue;
      const pts = r.pts.filter((i) => P(i));
      const hit = pts.filter((i) => coveredAll.has(i)).length;
      const recall = hit / Math.max(1, pts.length);
      const precision = hit / Math.max(1, coveredAll.size);
      // braccia: il pezzo deve contenere il percorso spalla -> gomito -> polso, non solo
      // i dintorni della mano (un oggetto impugnato copre polso e gomito, non la spalla)
      let along = 1;
      if (r.limb) {
        const [a, b, c] = r.limb.map(P);
        if (a && b && c) {
          let n = 0, ok = 0;
          for (const [u, v] of [[a, b], [b, c]])
            for (let t = 0; t <= 1.0001; t += 0.1, n++) if (covers(p, { x: u.x + (v.x - u.x) * t, y: u.y + (v.y - u.y) * t }, 4)) ok++;
          along = ok / n;
        }
      }
      // a parità: il pezzo il cui centro è più vicino al centro dei punti del ruolo
      const cx = pts.reduce((a, i) => a + P(i).x, 0) / Math.max(1, pts.length);
      const cy = pts.reduce((a, i) => a + P(i).y, 0) / Math.max(1, pts.length);
      const dist = Math.hypot(p.x + p.width / 2 - cx, p.y + p.height / 2 - cy);
      cand.push({ p, r, score: recall * precision * along, hit, dist });
    }
  }
  cand.sort((a, b) => b.score - a.score || b.hit - a.hit || a.dist - b.dist);
  // nomi già dati dalla mappa delle parti: non si riassegnano
  const taken = new Set(), done = new Set(pieces.filter((p) => p.faceLocked).map((p) => p.name));
  for (const c of cand) {
    if (taken.has(c.p) || done.has(c.r.name)) continue;
    c.p.name = c.r.name;
    taken.add(c.p);
    done.add(c.r.name);
  }
  // pezzi del viso (occhi, sopracciglia, bocca, ciocche) attaccati alla testa: faceRig.js
  let rest = pieces.filter((p) => !taken.has(p) && !p.faceLocked);
  const lockedNames = new Set(pieces.filter((p) => p.faceLocked).map((p) => p.name));
  const face = labelFacePieces(rest, landmarks, pieces.find((p) => (taken.has(p) || p.faceLocked) && p.name === "testa"), lockedNames);
  rest = rest.filter((p) => !face.has(p));
  // capelli posteriori: sempre un pezzo a sé dietro la testa (faceRig.labelBackHair)
  const backHair = labelBackHair(rest, landmarks, pieces.find((p) => (taken.has(p) || p.faceLocked) && p.name === "testa"));
  rest = rest.filter((p) => !backHair.has(p));
  let k = 0;
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

/** Distanza dal punto al pixel opaco più vicino del pezzo (campionato a passo 2). */
function nearestPixel(p, pt) {
  let d = Infinity;
  for (let y = 0; y < p.height; y += 2)
    for (let x = 0; x < p.width; x += 2)
      if (p.rgba[(y * p.width + x) * 4 + 3] >= 128) d = Math.min(d, Math.hypot(p.x + x - pt.x, p.y + y - pt.y));
  return d;
}

/** Pixel opachi di p sovrapposti a q (campionati): conteggio e baricentro. */
function overlapStats(p, q, step = 2) {
  let n = 0, sx = 0, sy = 0;
  if (!q) return { n, c: null };
  for (let y = 0; y < p.height; y += step)
    for (let x = 0; x < p.width; x += step) {
      if (p.rgba[(y * p.width + x) * 4 + 3] < 128) continue;
      if (alphaAt(q, p.x + x, p.y + y) > 128) { n++; sx += p.x + x; sy += p.y + y; }
    }
  return { n, c: n ? { x: sx / n, y: sy / n } : null };
}
/** Pezzo del corpo su cui poggia di più (testa, busto, braccia). */
function hostPiece(p, pieces) {
  let best = null, torso = null;
  for (const q of pieces) {
    if (q === p || !/^(testa|busto|braccio_(sx|dx))$/.test(q.name)) continue;
    const { n } = overlapStats(p, q, 3);
    if (q.name === "busto") torso = { q, n };
    if (n && (!best || n > best.n)) best = { q, n };
  }
  // un lembo di stoffa fra busto e braccio appartiene al busto (non segue la rotazione del braccio)
  if (best && torso?.n && /^braccio/.test(best.q.name) && torso.n >= 0.5 * best.n) return torso.q;
  return best?.q || pieces.find((q) => q.name === "busto") || null;
}

/**
 * COPERTURA DELLA SPALLA (lembo del mantello con fibula, tavola Zeus corretta dall'utente):
 * pezzo non tenuto in mano che poggia SIA sul busto SIA su un braccio vicino alla spalla.
 * Figlio del busto, pivot alla spalla, disegnato davanti a busto e braccio, fermo.
 * @returns {string|null} lato ("sx"/"dx") se è una copertura della spalla
 */
export function shoulderCoverSide(p, pieces, landmarks) {
  const busto = pieces.find((q) => q.name === "busto");
  if (!busto || !landmarks) return null;
  let total = 0;
  for (let y = 0; y < p.height; y += 3) for (let x = 0; x < p.width; x += 3) if (p.rgba[(y * p.width + x) * 4 + 3] >= 128) total++;
  // basta poco busto sotto (Zeus: 7%, il lembo sta quasi tutto sulla spalla del braccio)
  if (!total || overlapStats(p, busto, 3).n < 0.05 * total) return null;
  let best = null;
  for (const side of ["sx", "dx"]) {
    const arm = pieces.find((q) => q.name === `braccio_${side}`);
    const sh = landmarks[side === "sx" ? LM.shoulderSx : LM.shoulderDx];
    if (!arm || !sh) continue;
    const { n, c } = overlapStats(p, arm, 3);
    if (n < 0.1 * total) continue;
    const d = Math.hypot(c.x - sh.x, c.y - sh.y);
    if (!best || d < best.d) best = { side, d };
  }
  // vicino alla spalla: entro la diagonale del pezzo
  return best && best.d <= Math.hypot(p.width, p.height) ? best.side : null;
}
const overlapCenter = (p, q) => overlapStats(p, q).c || { x: p.x + p.width / 2, y: p.y + p.height / 2 };

/** Genitore e pivot per il rig (stesse convenzioni di partExtraction.js). */
function rigInfo(p, joints, landmarks, pieces = []) {
  const L = (i) => landmarks?.[i];
  const mid = (a, b) => (a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null);
  const bottom = { x: p.x + p.width / 2, y: p.y + p.height };
  let parent = null, pivot = null;
  if (p.name === "busto") pivot = mid(L(LM.hipSx), L(LM.hipDx)) || bottom;
  else if (p.name === "testa") { parent = "busto"; pivot = joints?.base_collo || mid(L(LM.shoulderSx), L(LM.shoulderDx)); }
  else if (p.name === "braccio_sx") { parent = "busto"; pivot = L(LM.shoulderSx); }
  else if (p.name === "braccio_dx") { parent = "busto"; pivot = L(LM.shoulderDx); }
  else if (p.handObject && handObjectRig(p, landmarks, joints)) ({ parent, pivot } = handObjectRig(p, landmarks, joints));
  else if (p.attachTo) {
    // accessorio appoggiato su un pezzo del corpo: pivot al baricentro della zona in comune
    parent = p.attachTo;
    pivot = p.coverShoulder
      ? L(p.coverShoulder === "sx" ? LM.shoulderSx : LM.shoulderDx)
      : overlapCenter(p, pieces.find((q) => q.name === p.attachTo));
  }
  else if (isFaceName(p.name)) { parent = "testa"; pivot = facePivot(p, pieces.find((q) => q.name === "testa")); }
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
export function importExplodedSheet({ sheet, original, landmarks, joints, minArea, attachmentRules = [], transplant = true, partComps = null }) {
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
  const { lab, comps } = splitComponents(alpha, sheet.width, sheet.height, minArea ?? Math.round(0.00015 * sheet.width * sheet.height));
  if (!comps.length) throw new Error("Nessun pezzo trovato: lo sfondo della tavola deve essere a tinta unita.");
  if (comps.length > MAX_PIECES)
    throw new Error(
      `Tavola troppo frammentata: ${comps.length} pezzi (massimo ${MAX_PIECES}). Il modello ha diviso il personaggio in troppe parti (es. ogni piastra dell'armatura): rigenera la tavola chiedendo al massimo 6-8 pezzi grandi (più occhi, sopracciglia, bocca e ciocche se usi il prompt con viso).`
    );
  let pieces = comps.map((c) => ({ area: c.area, ...cutPiece(sheet, alpha, lab, c, bg) }));
  const biggest = pieces.reduce((a, b) => (b.area > a.area ? b : a));
  const scale = estimateScale(biggest, original);
  if (Math.abs(scale - 1) > 0.01) warnings.push(`Tavola in scala diversa dall'originale: fattore ${scale.toFixed(2)}.`);
  // finestra del viso per la ricerca a più scale dei pezzi piccoli
  const fr = faceFrame(landmarks);
  const faceWin = fr && { cx: fr.center.x, cy: fr.center.y, r: Math.max(3 * fr.u, 1.6 * fr.radius) };
  // gruppo dei tratti del viso (sheetAssembly.planFaceGroup): ogni tratto cercato solo attorno al
  // suo punto della posa, nell'ordine sinistra/destra e alto/basso della tavola
  // costo = errore della ricerca locale + penalità per la scala lontana da 1 (un pezzo sbagliato
  // si "adatta" più facilmente rimpicciolito)
  const placeCost = (p, t) => {
    const r = placeAtTarget(scalePiece(p, scale), original, t.pt, 0.8 * fr.u);
    return r ? { ...r, err: r.pos.err + 10 * Math.abs(Math.log(r.s)) } : null;
  };
  // MAPPA DELLE PARTI (partMap.placeByPartMap): posizione e nome dalla sovrapposizione delle
  // sagome con le parti della mappa; i pezzi restano quelli della tavola
  const mapPlace = new Map();
  if (partComps?.length) {
    const scaled = pieces.map((p) => scalePiece(p, scale));
    for (const a of placeByPartMap(scaled, partComps, original.width, original.height)) mapPlace.set(scaled.indexOf(a.piece), a);
  }
  const faceGroup = fr && !mapPlace.size ? planFaceGroup(pieces, landmarks, scale, placeCost) : new Map();
  pieces = pieces.map((p, pIdx) => {
    const sp = scalePiece(p, scale);
    const mp = mapPlace.get(pIdx);
    if (mp) {
      const q = Math.abs(mp.s - 1) > 0.01 ? scalePiece(sp, mp.s) : sp;
      return { ...q, x: mp.x, y: mp.y, matchError: +((1 - mp.iou) * 100).toFixed(1), name: mp.name, faceLocked: true, mapIoU: mp.iou };
    }
    const target = faceGroup.get(p);
    if (target) {
      const placed = target.placed;
      if (placed) {
        if (Math.abs(placed.s - 1) > 0.01)
          warnings.push(`${target.name}: disegnato in scala diversa dal viso (×${(1 / placed.s).toFixed(2)}), riportato alla scala dell'originale.`);
        return { ...placed.piece, x: placed.pos.x, y: placed.pos.y, matchError: +placed.pos.err.toFixed(1), name: target.name, faceLocked: true, rescaled: +placed.s.toFixed(2), sheetPiece: sp };
      }
    }
    // pezzi PICCOLI (occhi, sopracciglia, bocca, ciocche): a passo 8 la ricerca grossolana salta
    // la posizione giusta e trova un falso minimo altrove (caso reale: folletto con viso, occhi
    // finiti sul busto). Sotto il 12% del lato dell'originale si cerca a passo 2 con più campioni.
    const small = Math.max(sp.width, sp.height) < 0.12 * Math.max(original.width, original.height);
    const pos = alignPiece(sp, original, 1, small ? { coarse: 2, nFew: 1000 } : undefined);
    if (small && pos.err > SMALL_ERR_MAX && fr) {
      const r = alignFacePieceScaled(sp, original, faceWin, pos.err);
      if (r) {
        warnings.push(`Pezzo ${p.sheetX},${p.sheetY}: disegnato in scala diversa dal viso (×${(1 / r.s).toFixed(2)}), riportato alla scala dell'originale (errore ${pos.err.toFixed(0)} → ${r.pos.err.toFixed(0)}).`);
        return { ...r.piece, x: r.pos.x, y: r.pos.y, matchError: +r.pos.err.toFixed(1), rescaled: +r.s.toFixed(2) };
      }
    }
    if (pos.err > 80) warnings.push(`Pezzo ${p.sheetX},${p.sheetY}: posizione incerta (errore ${pos.err.toFixed(0)}).`);
    return { ...sp, x: pos.x, y: pos.y, matchError: +pos.err.toFixed(1) };
  });
  // baffi del gruppo del viso: devono poggiare sulla testa (il pezzo più grande che copre il
  // naso); altrimenti sono ciocche ai lati del viso (folletto_viso): ricerca normale e regole di faceRig
  const nose = landmarks?.[LM.nose];
  const headGuess = nose && pieces.filter((p) => !p.faceLocked && alphaAt(p, nose.x, nose.y) > 128).sort((a, b) => b.area - a.area)[0];
  pieces = pieces.map((p) => {
    if (!p.faceLocked || !/^baffo/.test(p.name)) return p;
    let n = 0;
    for (let y = 0; y < p.height; y += 2) for (let x = 0; x < p.width; x += 2) if (p.rgba[(y * p.width + x) * 4 + 3] >= 128) n++;
    if (headGuess && overlapStats(p, headGuess, 2).n >= 0.3 * n) return p;
    const wi = warnings.findIndex((w) => w.startsWith(`${p.name}: disegnato`));
    if (wi >= 0) warnings.splice(wi, 1);
    const sp = p.sheetPiece;
    const pos = alignPiece(sp, original, 1, { coarse: 2, nFew: 1000 });
    return { ...sp, x: pos.x, y: pos.y, matchError: +pos.err.toFixed(1) };
  });
  for (const p of pieces) delete p.sheetPiece;
  labelPieces(pieces, landmarks);
  // mano + oggetto lungo in un solo pezzo (handObject.js): nome mano_oggetto_<lato>, pivot al polso
  const handObjects = applyHandObjects(pieces, landmarks, joints);
  // Un oggetto è TENUTO in mano: se è finito lontano da entrambe le mani (tavola ridisegnata,
  // confronto ambiguo), lo si ricerca solo attorno alle mani.
  const hands = [joints?.mano_sx || landmarks?.[LM.wristSx], joints?.mano_dx || landmarks?.[LM.wristDx]].filter(Boolean);
  const sw = landmarks ? Math.hypot(landmarks[LM.shoulderSx].x - landmarks[LM.shoulderDx].x, landmarks[LM.shoulderSx].y - landmarks[LM.shoulderDx].y) : 0;
  let accN = 0;
  if (hands.length && sw) {
    for (const p of pieces) {
      if (!p.name.startsWith("oggetto")) continue;
      const r = 0.5 * sw + Math.max(p.width, p.height) / 2;
      // TENUTO in mano = qualche pixel del pezzo vicino alla mano (entro 1/4 della larghezza delle
      // spalle), non solo il centro "abbastanza vicino" (Zeus: lembo sulla spalla preso per oggetto)
      if (hands.some((h) => nearestPixel(p, h) <= 0.25 * sw)) continue;
      let best = null;
      for (const h of hands) {
        const pos = alignPiece(p, original, 1, { window: { cx: h.x, cy: h.y, r } });
        if (!best || pos.err < best.err) best = pos;
      }
      // spostato vicino alla mano SOLO se lì combacia nettamente meglio: un pezzo che non è un
      // oggetto impugnato (sopracciglio, ciocca, lembo del mantello) non deve finire sulla mano
      // (caso reale Zeus: sopracciglia e ciocche portate accanto alla mano con errore 90-105)
      if (best && isFinite(best.err) && best.err < Math.min(p.matchError - 15, USABLE_MAX)) {
        warnings.push(`${p.name}: lontano dalle mani, riposizionato vicino alla mano (errore ${p.matchError.toFixed(0)} → ${best.err.toFixed(0)}).`);
        Object.assign(p, { x: best.x, y: best.y, matchError: +best.err.toFixed(1) });
      } else {
        // non è tenuto in mano: copertura della spalla, oppure accessorio del pezzo su cui poggia
        const side = shoulderCoverSide(p, pieces, landmarks);
        if (side) {
          p.name = `copertura_spalla_${side}`;
          p.attachTo = "busto";
          p.coverShoulder = side;
          p.motionLocked = true;
          warnings.push(`${p.name}: lembo sopra la spalla, figlio del busto, davanti al braccio (controlla).`);
        } else {
          const host = hostPiece(p, pieces);
          p.name = `accessorio_${++accN}`;
          if (host) p.attachTo = host.name;
          warnings.push(`${p.name}: non è in mano, agganciato a ${host ? host.name : "radice"} come accessorio (controlla il nome).`);
        }
      }
    }
  }
  const front = orderPieces(pieces, original);
  // occhi, sopracciglia, bocca SEMPRE davanti alla testa (sotto c'è la palpebra/pelle ridipinta,
  // diversa dall'originale: il confronto dei pixel lo direbbe giusto, ma non deve dipendere da lui)
  const head = pieces.find((p) => p.name === "testa");
  if (head)
    for (const p of pieces)
      if (/^(occhio|sopracciglio|bocca|baffo)(_|$)/.test(p.name) && p.order < head.order) p.order = head.order + 0.5;
      // capelli posteriori sempre DIETRO testa e busto (pendono dietro le spalle)
      else if (/^capelli_dietro/.test(p.name)) p.order = -1;
  // copertura della spalla sempre davanti a busto e braccio
  for (const p of pieces)
    if (p.coverShoulder) {
      const under = pieces.filter((q) => q.name === "busto" || q.name === `braccio_${p.coverShoulder}`);
      p.order = Math.max(p.order, ...under.map((q) => q.order)) + 0.5;
    }
  [...pieces].sort((a, b) => a.order - b.order).forEach((p, i) => (p.order = i));
  // Fedeltà della tavola: errore medio pesato sull'area. Una tavola che RIDISEGNA il personaggio
  // (proporzioni, dettagli, posa diversi) non si ricompone sull'originale e non va usata come
  // dato di addestramento.
  const totA = pieces.reduce((a, p) => a + p.area, 0) || 1;
  const fidelityError = +(pieces.reduce((a, p) => a + p.matchError * p.area, 0) / totA).toFixed(1);
  const faithful = fidelityError <= FIDELITY_MAX;
  // PIXEL VISIBILI DALL'ORIGINALE (sheetAssembly.transplantOriginal): la tavola resta solo nelle
  // zone nascoste. Una tavola ridisegnata ma con la stessa POSA (sagome che coincidono) diventa
  // così utilizzabile: si giudica la sagoma, non il colore.
  let assembly = null;
  for (const p of pieces) p.aligned = { x: p.x, y: p.y }; // posizione trovata, prima del ritaglio dall'originale
  if (transplant && original) {
    // collo: base del collo riconosciuta, altrimenti un po' sopra la linea delle spalle
    const shs = [LM.shoulderSx, LM.shoulderDx].map((i) => landmarks?.[i]).filter(Boolean);
    const neckY = joints?.base_collo?.y ?? (shs.length === 2 ? (shs[0].y + shs[1].y) / 2 - 0.2 * Math.abs(shs[0].x - shs[1].x) : null);
    const t = transplantOriginal(pieces, original, { neckY });
    pieces = t.pieces;
    if (t.rest.length) {
      pieces.push(...t.rest);
      [...pieces].sort((a, b) => a.order - b.order).forEach((p, i) => (p.order = i));
      warnings.push(`${t.rest.map((p) => `${p.name} (${p.area} px, su ${p.attachTo || "radice"})`).join(", ")}: parti dell'originale assenti dalla tavola (es. scintille, particelle), aggiunte come pezzi fermi con i pixel dell'originale.`);
    }
    // parti del personaggio non spiegate dalla tavola = riempite per vicinanza + pezzi resto
    assembly = { iou: +t.iou.toFixed(3), holeShare: +t.holeShare.toFixed(4), filledShare: +(t.filledShare + t.restShare).toFixed(4) };
    if (t.filledShare > 0.005)
      warnings.push(`${(t.filledShare * 100).toFixed(1)}% del personaggio non era in nessun pezzo della tavola (es. una parte del mantello): assegnato al pezzo più vicino, controlla.`);
  }
  const poseOk = assembly && assembly.iou >= ASSEMBLY_IOU_MIN && assembly.holeShare <= ASSEMBLY_HOLES_MAX && assembly.filledShare <= ASSEMBLY_FILL_MAX;
  const usable = fidelityError <= USABLE_MAX || !!poseOk;
  if (assembly && !poseOk && fidelityError <= USABLE_MAX)
    warnings.push(`Sagoma dei pezzi poco sovrapposta all'originale (IoU ${assembly.iou}, buchi ${(assembly.holeShare * 100).toFixed(1)}%): controlla la ricomposizione.`);
  for (const p of pieces) Object.assign(p, rigInfo(p, joints, landmarks, pieces));
  pieces.sort((a, b) => a.order - b.order);
  if (usable && fidelityError > USABLE_MAX)
    warnings.unshift(
      `Tavola ridisegnata (errore colori ${fidelityError}) ma con la stessa posa (sagome sovrapposte ${Math.round(assembly.iou * 100)}%): i pixel visibili sono presi dall'originale, la tavola resta solo nelle zone nascoste. Ok per il character, non per il dataset.`
    );
  else if (!usable)
    warnings.unshift(
      `Tavola NON fedele all'originale (errore medio ${fidelityError}, limite ${USABLE_MAX}): il modello ha cambiato la posa o le forme. Ricomposizione sbagliata: rigenera la tavola.`
    );
  else if (!faithful)
    warnings.unshift(
      `Tavola leggermente ridisegnata (errore medio ${fidelityError}, fedele fino a ${FIDELITY_MAX}): posa uguale, va bene per il character ma non per il dataset di addestramento.`
    );
  // Controllo PEZZO PER PEZZO (pieceCheck.js): la fedeltà è una media sull'area e non vede un
  // occhio finito sul busto. Su una tavola già da rifare non aggiunge nulla: solo se utilizzabile.
  // Apply a saved, validated mask recipe only after alignment/rigging. Fidelity above
  // intentionally remains the score of the incoming sheet, not the repaired layers.
  if (attachmentRules.length && (!usable || !checkPieces(pieces, original).ok)) {
    throw new Error("Raccordi non applicati: la tavola deve superare fedeltà e controllo dei singoli pezzi prima delle correzioni salvate.");
  }
  const finishing = finishAttachments(pieces, { original, rules: attachmentRules });
  pieces = finishing.pieces;
  front.push(...finishing.front);
  const pc = checkPieces(pieces, original);
  for (const c of pc.checks) pieces.find((p) => p.name === c.name).check = c;
  if (usable) warnings.push(...pc.warnings, ...checkHandObjects(pieces, landmarks, joints));
  return { pieces, scale, front, bg, warnings, fidelityError, faithful, usable, assembly, piecesOk: pc.ok, pieceChecks: pc.checks,
    handObjects: handObjects.map((h) => ({ name: h.piece.name, side: h.side })),
    finishing: { version: finishing.version, rules: structuredClone(attachmentRules), changes: finishing.changes } };
}
