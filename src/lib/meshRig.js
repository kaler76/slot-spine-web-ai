// src/lib/meshRig.js — PERSONAGGIO IN MESH PESATA con pochi tagli (metodo della Domatrice).
// Riferimento: docs/ANALISI_RIG_DOMATRICE.md. L'immagine ORIGINALE resta il corpo; si staccano solo:
//   - il BRACCIO che tiene un oggetto (pezzo davanti, mesh sulle sue ossa); nel corpo la zona dietro
//     il braccio, vicino al busto, si riempie dai pixel vicini (nessuna AI);
//   - i CAPELLI DIETRO (pezzo sotto il corpo, catena di 2 ossa che ondeggia);
//   - gli OCCHI: buco nel corpo, bianco e pupilla sotto (la pupilla si muove), palpebra CHIUSA
//     davanti (pelle + ciglia sulla forma dell'occhio) che compare e scende nel battito.
// Tutto il resto si piega con la mesh: ossa dai punti della posa, pesi dalla mappa delle parti.
// Versioni (tag git): zeus-mesh-1 tutto mesh; -2 tagli; -3 fulmine rigido + chiavi Bézier;
// -4 testa non più stirata in alto, palpebra chiusa disegnata; -5 palpebra "pelle" come la
// Domatrice (anello sul contorno dell'occhio schiacciato sulla linea di mezzo); -7 braccio lungo il
// fianco tagliato dal GOMITO, isole del corpo che toccano il braccio nel pezzo (questo file).
// Puro: nessun DOM.

import { PART, SEG } from "./partRecognition.js";
import { fillHoles } from "./partExtraction.js";

export const MESH_RIG_VERSION = "2026-10-08.zeus-mesh-9.3";

export const MESH_RIG_RULES = {
  cells: 34, // celle della griglia del corpo sul lato lungo
  pieceCells: 14, // celle della griglia dei pezzi tagliati
  pad: 6,
  loopSeconds: 6,
  fps: 15,
  faceRadius: 0.55, // zona del viso pesata sull'osso "viso" (× larghezza spalle)
  fillBand: 0.14, // zona dietro il braccio tagliato riempita nel corpo (× larghezza spalle dal busto)
  objectMin: 0.002, // quota del personaggio oltre cui un oggetto in mano fa tagliare il braccio
  hairMin: 0.004, // quota minima dei capelli dietro per farne un pezzo
  cuts: { arm: true, hair: true, eyes: true },
  // braccio tagliato: dalla SPALLA se il braccio è staccato dal busto (Zeus, braccio alzato); dal
  // GOMITO se l'omero scende lungo il fianco (Domatrice): l'omero resta nella mesh del corpo, così
  // il pezzo non si porta via risvolto e bottoni della giacca. "auto" sceglie con armDownMaxDeg.
  armFrom: "auto", // "auto" | "spalla" | "gomito"
  armDownMaxDeg: 35, // omero entro questo angolo dalla direzione spalla→anca = lungo il fianco
  elbowOverlap: 0.08, // il pezzo dal gomito prende anche questo tratto d'omero (× larghezza spalle)
  // BOCCA (zeus-mesh-8): "no" | "loop" (sorride una volta nel loop) | "sempre" (sorriso tenuto per tutto il loop).
  // Gli angoli della bocca salgono di smileUp × larghezza bocca e si allargano di smileOut ×; nel setup la
  // bocca resta quella del disegno.
  smile: "no",
  smileUp: 0.16,
  smileOut: 0.06,
  amp: { schiena: 1.2, petto: 2.4, testa: 2.0, omero: 3.0, avambraccio: 2.4, mano: 3.0, visoSlide: 0.004, breath: 0.01, capelli: 3.0, pupille: 0.12 },
  blinkAt: 2.0,
  lid: "pelle" // "pelle" = pelle stirata come la Domatrice; "disegnata" = palpebra chiusa disegnata (zeus-mesh-4)
};

const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const mid = (a, b) => lerp(a, b, 0.5);
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const deg = (r) => (r * 180) / Math.PI;
const luma = (r, g, b) => 0.3 * r + 0.59 * g + 0.11 * b;

/** Ossa principali in coordinate immagine: { name, parent, head, tail }. */
export function bonesFromPose(landmarks, joints) {
  const L = (i) => landmarks[i];
  const shSx = joints?.spalla_sx || L(11), shDx = joints?.spalla_dx || L(12);
  const hipMid = mid(L(23), L(24));
  const neck = joints?.base_collo || mid(shSx, shDx);
  const nose = L(0);
  const chest = lerp(hipMid, neck, 0.5);
  const neckTop = lerp(neck, nose, 0.45);
  const headTop = lerp(neckTop, nose, 2.2);
  const B = [
    { name: "anca", parent: "root", head: hipMid, tail: lerp(hipMid, chest, 0.5) },
    { name: "schiena", parent: "anca", head: hipMid, tail: chest },
    { name: "petto", parent: "schiena", head: chest, tail: neck },
    { name: "collo", parent: "petto", head: neck, tail: neckTop },
    { name: "testa", parent: "collo", head: neckTop, tail: headTop },
    { name: "viso", parent: "testa", head: nose, tail: lerp(nose, headTop, 0.15) }
  ];
  for (const s of ["sx", "dx"]) {
    const sh = s === "sx" ? shSx : shDx;
    const el = joints?.[`gomito_${s}`] || L(s === "sx" ? 13 : 14);
    const wr = joints?.[`polso_${s}`] || L(s === "sx" ? 15 : 16);
    const hd = joints?.[`mano_${s}`] || L(s === "sx" ? 19 : 20);
    B.push(
      { name: `omero_${s}`, parent: "petto", head: sh, tail: el },
      { name: `avambraccio_${s}`, parent: `omero_${s}`, head: el, tail: wr },
      { name: `mano_${s}`, parent: `avambraccio_${s}`, head: wr, tail: hd }
    );
  }
  return B;
}

/** Catene di controllo per etichetta: [[punto, osso], ...] (peso lineare fra punti consecutivi). */
function chainsOf(bones) {
  const by = Object.fromEntries(bones.map((b) => [b.name, b]));
  const c = {
    busto: [[by.anca.head, "anca"], [by.schiena.tail, "schiena"], [by.petto.tail, "petto"]],
    testa: [[by.collo.head, "petto"], [by.collo.tail, "collo"], [by.testa.head, "testa"], [by.viso.head, "testa"]]
  };
  for (const s of ["sx", "dx"]) {
    const sh = by[`omero_${s}`].head, el = by[`avambraccio_${s}`].head, wr = by[`mano_${s}`].head;
    c[`braccio_${s}`] = [[sh, `omero_${s}`], [lerp(sh, el, 0.7), `omero_${s}`], [el, `avambraccio_${s}`], [lerp(el, wr, 0.7), `avambraccio_${s}`], [wr, `mano_${s}`]];
    c[`oggetto_${s}`] = [[wr, `mano_${s}`]];
  }
  if (by.capelli_1) c.capelli = [[by.capelli_1.head, "testa"], [lerp(by.capelli_1.head, by.capelli_1.tail, 0.35), "capelli_1"], [by.capelli_2.head, "capelli_2"], [by.capelli_2.tail, "capelli_2"]];
  return c;
}

function chainWeights(p, chain) {
  if (chain.length === 1) return { [chain[0][1]]: 1 };
  let best = null;
  for (let i = 0; i < chain.length - 1; i++) {
    const a = chain[i][0], b = chain[i + 1][0];
    const vx = b.x - a.x, vy = b.y - a.y, l2 = vx * vx + vy * vy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / l2));
    const d = Math.hypot(p.x - (a.x + vx * t), p.y - (a.y + vy * t));
    if (!best || d < best.d) best = { i, t, d };
  }
  const w = {};
  const add = (n, v) => v > 1e-4 && (w[n] = (w[n] || 0) + v);
  add(chain[best.i][1], 1 - best.t);
  add(chain[best.i + 1][1], best.t);
  return w;
}

const LABELS = ["busto", "testa", "braccio_sx", "braccio_dx", "oggetto_sx", "oggetto_dx", "capelli"];
const L_ = Object.fromEntries(LABELS.map((n, i) => [n, i]));

function labelOf(part, x, midX) {
  switch (part) {
    case PART.testa:
    case PART.cappello:
      return L_.testa;
    case PART.braccio_sx:
    case PART.avambraccio_sx:
      return L_.braccio_sx;
    case PART.braccio_dx:
    case PART.avambraccio_dx:
      return L_.braccio_dx;
    case PART.oggetto_in_mano:
      return x < midX ? L_.oggetto_dx : L_.oggetto_sx;
    default:
      return L_.busto;
  }
}

/**
 * Scelta automatica dei tagli (regole del passo 1):
 *   braccio: tagliato se tiene un oggetto che esce dalla sagoma (≥ objectMin del personaggio);
 *   capelli dietro: pixel "capelli/accessori" ai lati del viso sopra le spalle, se ≥ hairMin;
 *   occhi: buco + bianco + pupilla se entrambi gli occhi sono trovati.
 * @returns {{ arms: string[], hair: boolean, eyes: boolean, reasons: string[] }}
 */
export function decideCuts({ counts, fgN, eyes, hairN }, rules = MESH_RIG_RULES) {
  const reasons = [];
  const arms = [];
  for (const s of ["sx", "dx"]) {
    const n = counts[`oggetto_${s}`] || 0;
    if (rules.cuts.arm && n >= rules.objectMin * fgN) { arms.push(s); reasons.push(`braccio_${s}: TAGLIO, tiene un oggetto (${n} px)`); }
    else reasons.push(`braccio_${s}: mesh${n ? (rules.cuts.arm ? ` (oggetto piccolo, ${n} px)` : ` (tiene un oggetto di ${n} px ma il taglio del braccio è disattivato: l'oggetto si piega col corpo)`) : ""}`);
  }
  const hair = rules.cuts.hair && hairN >= rules.hairMin * fgN;
  reasons.push(hair ? `capelli dietro: TAGLIO, pezzo sotto il corpo (${hairN} px)` : "capelli dietro: nessuno");
  const eyesOk = rules.cuts.eyes && eyes.length === 2;
  reasons.push(eyesOk ? "occhi: buco + bianco + pupilla, palpebra per il battito" : "occhi: nessun taglio (non trovati)");
  return { arms, hair, eyes: eyesOk, reasons };
}

/** Occhio: buco (sclera + iride, pupilla compresa) attorno al punto della posa. */
/**
 * Occhio: prima ricerca attorno al punto della posa, poi di nuovo CENTRATA sul buco trovato (il punto di MediaPipe
 * può stare di lato all'occhio: Robin Hood, 8 ott, buco solo sul bianco a destra dell'iride). Si tiene il buco più
 * grande delle due ricerche.
 */
export function findEye(center, ipd, W, H, rgba, fg) {
  const a = findEyeOnce(center, ipd, W, H, rgba, fg);
  if (!a) return null;
  const c2 = { x: (a.box.x0 + a.box.x1 + 1) / 2, y: (a.box.y0 + a.box.y1 + 1) / 2 };
  if (Math.hypot(c2.x - center.x, c2.y - center.y) < 1.5) return a;
  // seconda ricerca centrata sul buco: la si tiene solo se CONTIENE quasi tutto il primo buco (stesso occhio,
  // trovato meglio) e non è alta più di 1,5 volte (non è salita sulle sopracciglia o sul trucco)
  const b = findEyeOnce(c2, ipd, W, H, rgba, fg);
  if (!b) return a;
  let n = 0, inB = 0, nb = 0;
  for (let i = 0; i < b.w * b.h; i++) nb += b.hole[i];
  for (let i = 0; i < a.w * a.h; i++) {
    if (!a.hole[i]) continue;
    n++;
    const gx = (i % a.w) + a.x0 - b.x0, gy = ((i / a.w) | 0) + a.y0 - b.y0;
    if (gx >= 0 && gy >= 0 && gx < b.w && gy < b.h && b.hole[gy * b.w + gx]) inB++;
  }
  const ha = a.box.y1 - a.box.y0 + 1, hb = b.box.y1 - b.box.y0 + 1;
  return nb > n && inB >= 0.8 * n && hb <= 1.5 * ha ? b : a;
}

function findEyeOnce(center, ipd, W, H, rgba, fg) {
  const rx = Math.round(0.36 * ipd), ry = Math.round(0.2 * ipd);
  const x0 = Math.max(0, Math.round(center.x - rx)), x1 = Math.min(W - 1, Math.round(center.x + rx));
  const y0 = Math.max(0, Math.round(center.y - ry)), y1 = Math.min(H - 1, Math.round(center.y + ry));
  // pelle: mediana della fascia sotto l'occhio
  const sk = [];
  for (let y = Math.round(center.y + ry); y < Math.min(H, center.y + ry * 1.8); y++)
    for (let x = Math.round(center.x - rx / 2); x < center.x + rx / 2; x++) { const i = (y * W + x) * 4; sk.push([rgba[i], rgba[i + 1], rgba[i + 2]]); }
  const med = (k) => sk.map((p) => p[k]).sort((a, b) => a - b)[sk.length >> 1] ?? 200;
  const skin = [med(0), med(1), med(2)];
  const w = x1 - x0 + 1, h = y1 - y0 + 1, m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (x + x0 - center.x) / rx, dy = (y + y0 - center.y) / ry;
    if (dx * dx + dy * dy > 1) continue;
    const g = (y + y0) * W + x + x0, i = g * 4;
    if (!fg[g]) continue;
    const r = rgba[i], gg = rgba[i + 1], b = rgba[i + 2], l = luma(r, gg, b);
    const dSkin = Math.abs(r - skin[0]) + Math.abs(gg - skin[1]) + Math.abs(b - skin[2]);
    const sat = Math.max(r, gg, b) - Math.min(r, gg, b);
    // bianco: chiaro e poco saturo, anche in ombra (grigio-azzurro: avvocato) purché quasi senza colore
    const sclera = (l > 170 && sat < 60) || (l > 120 && sat < 35);
    // iride: blu (b > r) o VERDE (g > r: Robin Hood); le ciglia castane (r > g) restano fuori
    // (iride castana: niente regola di colore, che prendeva anche ombretto e ciglia della Domatrice; la prende la
    // chiusura per righe fra il bianco a sinistra e quello a destra)
    const iris = dSkin > 120 && ((l > 45 && b > r) || (l > 25 && gg > r + 20));
    if (sclera || iris) m[y * w + x] = 1;
  }
  // componente più grande, poi i buchi interni (pupilla, riflesso) chiusi
  const comp = new Int32Array(w * h).fill(-1);
  let best = -1, bestN = 0;
  const comps = new Map();
  for (let s = 0; s < w * h; s++) {
    if (!m[s] || comp[s] >= 0) continue;
    const st = [s]; comp[s] = s; let n = 0, ya = h, yb = -1;
    while (st.length) { const i = st.pop(); n++; const x = i % w, y = (i / w) | 0; ya = Math.min(ya, y); yb = Math.max(yb, y); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue; const j = ny * w + nx; if (m[j] && comp[j] < 0) { comp[j] = s; st.push(j); } } }
    comps.set(s, { n, ya, yb });
    if (n > bestN) { bestN = n; best = s; }
  }
  if (best < 0 || bestN < 20) return null;
  // oltre alla componente più grande, le altre non piccole (≥ 10%) alla STESSA altezza: il bianco dall'altra parte
  // di un'iride scura non riconosciuta (avvocato, occhi castani: pupilla rimasta visibile a occhio chiuso).
  // Le sopracciglia stanno più in alto e non si sovrappongono in altezza.
  const B = comps.get(best), keep = new Set([best]);
  for (const [k, c] of comps) {
    if (k === best || c.n < 0.1 * bestN) continue;
    const ov = Math.min(c.yb, B.yb) - Math.max(c.ya, B.ya) + 1;
    if (ov >= 0.5 * (c.yb - c.ya + 1)) keep.add(k);
  }
  const hole = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) if (keep.has(comp[i])) hole[i] = 1;
  const out = new Uint8Array(w * h), q = [];
  for (let i = 0; i < w * h; i++) { const x = i % w, y = (i / w) | 0; if ((x === 0 || y === 0 || x === w - 1 || y === h - 1) && !hole[i]) { out[i] = 1; q.push(i); } }
  for (let qi = 0; qi < q.length; qi++) { const i = q[qi], x = i % w, y = (i / w) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue; const j = ny * w + nx; if (!out[j] && !hole[j]) { out[j] = 1; q.push(j); } } }
  for (let i = 0; i < w * h; i++) if (!out[i]) hole[i] = 1;
  // chiusura per righe: fra due pixel del buco sulla stessa riga (distanza ≤ metà della larghezza del buco)
  // tutto è occhio. Pupilla e parte scura dell'iride toccano il contorno in alto e la chiusura dall'esterno non
  // le prende (Robin Hood: pupilla rimasta nel corpo)
  {
    let hx0 = w, hx1 = -1;
    for (let i = 0; i < w * h; i++) if (hole[i]) { hx0 = Math.min(hx0, i % w); hx1 = Math.max(hx1, i % w); }
    const maxGap = 0.6 * (hx1 - hx0 + 1);
    for (let y = 0; y < h; y++) {
      let last = -1;
      for (let x = 0; x < w; x++) {
        if (!hole[y * w + x]) continue;
        if (last >= 0 && x - last > 1 && x - last <= maxGap) for (let k = last + 1; k < x; k++) hole[y * w + k] = 1;
        last = x;
      }
    }
  }
  let sr = 0, sg = 0, sb = 0, sn = 0;
  const iris = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (!hole[i]) continue;
    const g = ((i / w) | 0) + y0, x = (i % w) + x0, k = (g * W + x) * 4;
    const l = luma(rgba[k], rgba[k + 1], rgba[k + 2]), sat = Math.max(rgba[k], rgba[k + 1], rgba[k + 2]) - Math.min(rgba[k], rgba[k + 1], rgba[k + 2]);
    if (l > 170 && sat < 60) { sr += rgba[k]; sg += rgba[k + 1]; sb += rgba[k + 2]; sn++; } else iris[i] = 1;
  }
  // riflessi bianchi DENTRO l'iride (fra due pixel d'iride sulla stessa riga e sulla stessa colonna) sono iride:
  // si muovono con la pupilla invece di restare fermi sul bianco (righe bianche sulla pupilla che guarda di lato)
  {
    const inRow = new Uint8Array(w * h), inCol = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) { let a = -1, b = -1; for (let x = 0; x < w; x++) if (iris[y * w + x]) { if (a < 0) a = x; b = x; } for (let x = a + 1; x < b; x++) inRow[y * w + x] = 1; }
    for (let x = 0; x < w; x++) { let a = -1, b = -1; for (let y = 0; y < h; y++) if (iris[y * w + x]) { if (a < 0) a = y; b = y; } for (let y = a + 1; y < b; y++) inCol[y * w + x] = 1; }
    for (let i = 0; i < w * h; i++) if (hole[i] && !iris[i] && inRow[i] && inCol[i]) iris[i] = 1;
  }
  let hx0 = w, hx1 = -1, hy0 = h, hy1 = -1;
  for (let i = 0; i < w * h; i++) if (hole[i]) { const x = i % w, y = (i / w) | 0; hx0 = Math.min(hx0, x); hx1 = Math.max(hx1, x); hy0 = Math.min(hy0, y); hy1 = Math.max(hy1, y); }
  return { x0, y0, w, h, hole, iris, skin, white: sn > 10 ? [sr / sn, sg / sn, sb / sn] : [240, 238, 232], box: { x0: x0 + hx0, y0: y0 + hy0, x1: x0 + hx1, y1: y0 + hy1 } };
}

/**
 * Bocca: angoli dai pixel, non solo dalla posa (i punti 9-10 di MediaPipe stanno spesso sopra la bocca:
 * avvocato). Nel riquadro attorno ai punti della posa si cercano i pixel della bocca, più scuri della pelle
 * o rossi come le labbra; la componente più larga vicino al centro dà gli angoli (estremi sinistro e destro).
 * Senza bocca riconoscibile si usano i punti della posa.
 */
export function findMouth(landmarks, ipd, W, H, rgba, fg) {
  const a = landmarks[9], b = landmarks[10]; // 9 = bocca sinistra del personaggio, 10 = destra
  const mw0 = Math.max(Math.hypot(a.x - b.x, a.y - b.y), 0.45 * ipd);
  const c0 = mid(a, b);
  const x0 = Math.max(0, Math.round(c0.x - 0.95 * mw0)), x1 = Math.min(W - 1, Math.round(c0.x + 0.95 * mw0));
  const y0 = Math.max(0, Math.round(c0.y - 0.25 * mw0)), y1 = Math.min(H - 1, Math.round(c0.y + 0.85 * mw0));
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const fromPose = () => ({ sx: { x: a.x, y: a.y }, dx: { x: b.x, y: b.y }, center: c0, width: Math.hypot(a.x - b.x, a.y - b.y) || mw0, fromPose: true });
  if (w < 6 || h < 6) return fromPose();
  const ls = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = (y * W + x) * 4; if (fg[y * W + x]) ls.push([luma(rgba[i], rgba[i + 1], rgba[i + 2]), rgba[i] - rgba[i + 1]]); }
  if (ls.length < 20) return fromPose();
  const med = (k) => ls.map((v) => v[k]).sort((p, q) => p - q)[ls.length >> 1];
  const skinL = med(0), skinRG = med(1);
  const m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const g = (y + y0) * W + x + x0, i = g * 4;
    if (!fg[g]) continue;
    const l = luma(rgba[i], rgba[i + 1], rgba[i + 2]), rg = rgba[i] - rgba[i + 1];
    if (l < 0.6 * skinL || (rg > skinRG + 45 && l < 0.95 * skinL)) m[y * w + x] = 1;
  }
  const comp = new Int32Array(w * h).fill(-1);
  let best = null;
  for (let s0 = 0; s0 < w * h; s0++) {
    if (!m[s0] || comp[s0] >= 0) continue;
    const st = [s0], px = []; comp[s0] = s0;
    // vicini entro 2 px: la linea della bocca disegnata è spesso spezzata (labbro sopra, piega sotto)
    while (st.length) { const i = st.pop(); px.push(i); const x = i % w, y = (i / w) | 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue; const j = ny * w + nx; if (m[j] && comp[j] < 0) { comp[j] = s0; st.push(j); } } }
    let mnx = w, mxx = -1, sy = 0;
    for (const i of px) { const x = i % w; mnx = Math.min(mnx, x); mxx = Math.max(mxx, x); sy += (i / w) | 0; }
    const span = mxx - mnx + 1, cx = (mnx + mxx) / 2 + x0, cy = sy / px.length + y0;
    // bocca: larga (≥ 45% della distanza dei punti della posa), non tocca i bordi del riquadro, vicina al centro
    if (span < 0.45 * mw0 || mnx === 0 || mxx === w - 1) continue;
    const score = span - 1.5 * Math.abs(cx - c0.x) - 0.5 * Math.abs(cy - (c0.y + 0.2 * mw0));
    if (!best || score > best.score) best = { score, px, mnx, mxx };
  }
  if (!best) return fromPose();
  const side = (xx) => { let s = 0, n = 0; for (const i of best.px) if (Math.abs((i % w) - xx) <= 1) { s += (i / w) | 0; n++; } return { x: xx + x0 + 0.5, y: s / n + y0 + 0.5 }; };
  const L = side(best.mnx), R = side(best.mxx);
  // sx (personaggio) è dalla parte del punto 9
  const [sx, dx] = Math.abs(L.x - a.x) < Math.abs(R.x - a.x) ? [L, R] : [R, L];
  // bocca all'ingiù (broncio, avvocato): gli angoli stanno sotto la linea delle labbra al centro di "frown" px
  const midX = (best.mnx + best.mxx) / 2, band = 0.15 * (best.mxx - best.mnx);
  // altezza delle labbra al centro = MEDIA dei pixel della bocca nella fascia centrale (labbra piene come la
  // Domatrice: il bordo alto del labbro sta sopra gli angoli ma la linea fra le labbra no)
  let sumC = 0, nC = 0;
  for (const i of best.px) if (Math.abs((i % w) - midX) <= band) { sumC += ((i / w) | 0) + y0 + 0.5; nC++; }
  const frown = nC ? Math.max(0, (sx.y + dx.y) / 2 - sumC / nC) : 0;
  return { sx, dx, center: mid(sx, dx), width: Math.hypot(sx.x - dx.x, sx.y - dx.y), frown, fromPose: false };
}

/**
 * Rig completo.
 * @param {{ width, height, rgba, fg: Uint8Array, parts: Uint8Array, categories?: Uint8Array, landmarks, joints }} input
 * @returns {{ json, images: { [nome]: {width,height,rgba} }, report }}
 */
export function buildMeshRig({ width: W, height: H, rgba, fg, parts, categories, landmarks, joints, smilePatch = null }, rules = MESH_RIG_RULES) {
  let x0 = W, y0 = H, x1 = -1, y1 = -1, fgN = 0;
  for (let i = 0; i < W * H; i++) if (fg[i]) { fgN++; const x = i % W, y = (i / W) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  x0 = Math.max(0, x0 - rules.pad); y0 = Math.max(0, y0 - rules.pad); x1 = Math.min(W - 1, x1 + rules.pad); y1 = Math.min(H - 1, y1 + rules.pad);
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  const rootX = x0 + cw / 2, rootY = y1 + 1;
  const toS = (p) => ({ x: p.x - rootX, y: rootY - p.y });

  const bones = bonesFromPose(landmarks, joints);
  const by = Object.fromEntries(bones.map((b) => [b.name, b]));
  const shoulderW = Math.hypot(by.omero_sx.head.x - by.omero_dx.head.x, by.omero_sx.head.y - by.omero_dx.head.y);
  const midX = mid(landmarks[11], landmarks[12]).x;
  const nose = landmarks[0];

  // etichette dei pixel
  const lab = new Int8Array(W * H).fill(-1);
  const counts = {};
  for (let i = 0; i < W * H; i++) if (fg[i]) lab[i] = labelOf(parts[i], i % W, midX);
  // un oggetto che attraversa la linea di mezzo (freccia tenuta con due mani, arco: Robin Hood) è UN pezzo:
  // tutto al lato che ne ha di più, invece di spezzarlo in due sulla verticale del collo
  {
    const isObj = (k) => k === L_.oggetto_sx || k === L_.oggetto_dx, seen = new Uint8Array(W * H);
    for (let s0 = 0; s0 < W * H; s0++) {
      if (seen[s0] || !isObj(lab[s0])) continue;
      const st = [s0], px = []; seen[s0] = 1; let nsx = 0;
      while (st.length) { const i = st.pop(); px.push(i); if (lab[i] === L_.oggetto_sx) nsx++; const x = i % W, y = (i / W) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const j = ny * W + nx; if (!seen[j] && isObj(lab[j])) { seen[j] = 1; st.push(j); } } }
      if (nsx && nsx < px.length) { const k = nsx * 2 >= px.length ? L_.oggetto_sx : L_.oggetto_dx; for (const i of px) lab[i] = k; }
    }
  }
  for (let i = 0; i < W * H; i++) if (lab[i] >= 0) counts[LABELS[lab[i]]] = (counts[LABELS[lab[i]]] || 0) + 1;

  // capelli dietro: "capelli/accessori" ai lati del viso, sopra le spalle, vicino alla testa
  const hair = new Uint8Array(W * H);
  let hairN = 0;
  if (categories) {
    let fx0 = W, fx1 = -1;
    for (let i = 0; i < W * H; i++) if (categories[i] === SEG.faceSkin && Math.abs(((i / W) | 0) - nose.y) < 0.5 * shoulderW) { const x = i % W; fx0 = Math.min(fx0, x); fx1 = Math.max(fx1, x); }
    // CAPELLI LUNGHI: solo se scendono sotto la linea delle spalle ai lati del viso (Jessica).
    // Capelli corti attorno alla testa (Zeus) restano nella mesh della testa: tagliarli con un
    // bordo dritto lascia un taglio visibile quando si muovono.
    const shY = Math.max(by.omero_sx.head.y, by.omero_dx.head.y);
    const margin = 0.04 * shoulderW;
    const side = (x) => x <= fx0 - margin || x >= fx1 + margin;
    // solo la categoria "capelli" del modello (barba e capelli bianchi di Zeus sono "accessori": restano nella mesh)
    const isHair = (i) => fg[i] && (lab[i] === L_.testa || lab[i] === L_.busto) && categories[i] === SEG.hair;
    let below = 0;
    for (let i = 0; i < W * H; i++) if (isHair(i) && side(i % W) && (i / W | 0) > shY + 0.1 * shoulderW && Math.abs(i % W - nose.x) < 1.2 * shoulderW) below++;
    if (below >= rules.hairMin * fgN)
      for (let i = 0; i < W * H; i++) {
        if (!isHair(i)) continue;
        const x = i % W, y = (i / W) | 0;
        if (!side(x) || Math.abs(x - nose.x) > 1.2 * shoulderW || y < nose.y) continue;
        hair[i] = 1; hairN++;
      }
  }

  // occhi
  const ipd = Math.hypot(landmarks[2].x - landmarks[5].x, landmarks[2].y - landmarks[5].y);
  const eyes = rules.cuts.eyes ? [["sx", landmarks[2]], ["dx", landmarks[5]]].map(([s, c]) => { const e = findEye(c, ipd, W, H, rgba, fg); return e && { side: s, ...e }; }).filter(Boolean) : [];

  const decision = decideCuts({ counts, fgN, eyes, hairN }, rules);

  // capelli: catena di 2 ossa dal punto più alto al più basso del gruppo
  if (decision.hair) {
    let top = null, bot = null;
    for (let i = 0; i < W * H; i++) if (hair[i]) { const y = (i / W) | 0; if (!top || y < top.y) top = { x: i % W, y }; if (!bot || y > bot.y) bot = { x: i % W, y }; }
    const m1 = lerp(top, bot, 0.5);
    bones.push({ name: "capelli_1", parent: "testa", head: top, tail: m1 }, { name: "capelli_2", parent: "capelli_1", head: m1, tail: bot });
    for (let i = 0; i < W * H; i++) if (hair[i]) lab[i] = L_.capelli;
  } else hair.fill(0);
  // occhi: ossa pupilla e palpebra
  for (const e of decision.eyes ? eyes : []) {
    const b = e.box, cx = (b.x0 + b.x1 + 1) / 2, cy = (b.y0 + b.y1 + 1) / 2;
    // bordo alto e basso del buco per colonna (coordinate immagine)
    e.top = [];
    e.bot = [];
    for (let x = 0; x < e.w; x++) { let t = -1, bt = -1; for (let y = 0; y < e.h; y++) if (e.hole[y * e.w + x]) { if (t < 0) t = y; bt = y; } e.top.push(t < 0 ? null : t + e.y0); e.bot.push(bt < 0 ? null : bt + e.y0); }
    // bordo alto LISCIO: inviluppo superiore (minimo su ±6 colonne) poi media su ±3: il bordo grezzo
    // ha rientri dove le ciglia scendono sull'iride, e la palpebra chiusa usciva con una tacca
    const env = (arr, pick, r) => arr.map((v, x) => { if (v == null) return null; let m = v; for (let d = -r; d <= r; d++) { const u = arr[x + d]; if (u != null) m = pick(m, u); } return m; });
    const avg = (arr, r) => arr.map((v, x) => { if (v == null) return null; let sum = 0, k = 0; for (let d = -r; d <= r; d++) { const u = arr[x + d]; if (u != null) { sum += u; k++; } } return sum / k; });
    e.top = avg(env(e.top, Math.min, 6), 3);
    e.bot = avg(env(e.bot, Math.max, 6), 3);
    // ossa orizzontali: gli allegati restano dritti senza rotazione propria
    bones.push({ name: `occhio_${e.side}`, parent: "viso", head: { x: cx, y: cy }, tail: { x: cx + 10, y: cy } });
    bones.push({ name: `pupilla_${e.side}`, parent: `occhio_${e.side}`, head: { x: cx, y: cy }, tail: { x: cx + 10, y: cy } });
    // palpebra: origine sulla linea della palpebra INFERIORE; il battito schiaccia in Y verso di lei
    // i vertici del bordo ciglia (scala Y 0,08 come la scala 0,2 della Domatrice)
    // palpebra CHIUSA: pelle + ciglia disegnate sulla forma dell'occhio, appesa al bordo alto;
    // nel battito compare e scende (scala Y 0 → 1 → 0). Il metodo "pelle stirata" della Domatrice
    // con la nostra griglia dava palpebre strappate (Zeus: occhi di 25 px, celle di 34 px).
    e.lidTop = Math.min(...e.top.filter((v) => v != null));
    // metodo "pelle" (Domatrice): osso al centro dell'occhio, il battito schiaccia in Y l'anello del
    // contorno verso la linea di mezzo (palpebra sopra giù, sotto su). Metodo "disegnata": osso sul bordo alto.
    const lidY = rules.lid === "pelle" ? cy : e.lidTop;
    bones.push({ name: `palpebra_${e.side}`, parent: `occhio_${e.side}`, head: { x: cx, y: lidY }, tail: { x: cx + 10, y: lidY } });
  }

  // bocca: ossa agli angoli (figlie di "viso"), solo se richiesto il sorriso
  // con la bocca ridisegnata da Gemini (smilePatch, R10) niente deformazione: il pezzo compare in dissolvenza
  const mouth = rules.smile && rules.smile !== "no" && !smilePatch ? findMouth(landmarks, ipd, W, H, rgba, fg) : null;
  if (smilePatch) decision.reasons.push(`bocca: sorriso RIDISEGNATO (Gemini) ${rules.smile === "sempre" ? "tenuto per tutto il loop" : "nel loop (3–5,2 s)"}, pezzo ${smilePatch.width}×${smilePatch.height} px`);
  if (mouth) {
    for (const [s, c] of [["sx", mouth.sx], ["dx", mouth.dx]]) bones.push({ name: `bocca_${s}`, parent: "viso", head: c, tail: { x: c.x + 10, y: c.y } });
    decision.reasons.push(`bocca: sorriso ${rules.smile === "sempre" ? "tenuto per tutto il loop" : "nel loop (3–5,3 s)"} (bocca ${Math.round(mouth.width)} px${mouth.frown > 1 ? `, all'ingiù di ${Math.round(mouth.frown)} px` : ""}${mouth.fromPose ? ", angoli dalla posa" : ""})`);
  } else if (rules.smile && rules.smile !== "no" && !smilePatch) decision.reasons.push("bocca: non trovata, niente sorriso");

  // ossa in formato Spine
  const world = { root: { x: 0, y: 0, a: 0 } };
  const jsonBones = [{ name: "root" }];
  for (const b of bones) {
    const h = toS(b.head), t = toS(b.tail);
    const a = Math.atan2(t.y - h.y, t.x - h.x);
    const p = world[b.parent];
    const dx = h.x - p.x, dy = h.y - p.y, c = Math.cos(-p.a), s = Math.sin(-p.a);
    jsonBones.push({ name: b.name, parent: b.parent, length: +Math.hypot(t.x - h.x, t.y - h.y).toFixed(2), x: +(dx * c - dy * s).toFixed(2), y: +(dx * s + dy * c).toFixed(2), rotation: +deg(a - p.a).toFixed(2) });
    world[b.name] = { x: h.x, y: h.y, a };
  }
  const boneIndex = Object.fromEntries(jsonBones.map((b, i) => [b.name, i]));
  const C = chainsOf(bones);
  const face = by.viso.head, faceR = rules.faceRadius * shoulderW;

  // ---- immagini ----
  const armMask = new Uint8Array(W * H);
  const armFrom = {};
  for (const s of decision.arms) {
    const sh = by[`omero_${s}`].head, el = by[`avambraccio_${s}`].head, hip = landmarks[s === "sx" ? 23 : 24];
    const ang = Math.abs(deg(Math.atan2(el.y - sh.y, el.x - sh.x) - Math.atan2(hip.y - sh.y, hip.x - sh.x)));
    const down = Math.min(ang, 360 - ang);
    armFrom[s] = rules.armFrom === "auto" || !rules.armFrom ? (down <= rules.armDownMaxDeg ? "gomito" : "spalla") : rules.armFrom;
    decision.reasons.push(`braccio_${s} tagliato dal${armFrom[s] === "gomito" ? " GOMITO (omero lungo il fianco" : "la SPALLA (braccio staccato dal busto"}, ${down.toFixed(0)}°)`);
    const fore = PART[`avambraccio_${s}`], wr = by[`mano_${s}`].head;
    const dx = wr.x - el.x, dy = wr.y - el.y, len = Math.hypot(dx, dy) || 1, ov = (rules.elbowOverlap ?? 0.08) * shoulderW;
    for (let i = 0; i < W * H; i++) {
      if (lab[i] === L_[`oggetto_${s}`]) { armMask[i] = 1; continue; }
      if (lab[i] !== L_[`braccio_${s}`]) continue;
      if (armFrom[s] === "spalla") { armMask[i] = 1; continue; }
      // dal gomito: avambraccio e mano, oltre il gomito lungo gomito→polso (meno la sovrapposizione)
      const x = i % W, y = (i / W) | 0, t = ((x - el.x) * dx + (y - el.y) * dy) / len;
      if (t >= -ov && (parts[i] === fore || Math.hypot(x - el.x, y - el.y) <= ov)) armMask[i] = 1;
    }
  }
  // isole del corpo staccate dal resto che toccano il braccio tagliato (pezzi d'oggetto non
  // riconosciuti, es. il cerchio vicino alla mano): vanno nel pezzo, non restano sospese nel corpo
  if (decision.arms.length) {
    const comp = new Int32Array(W * H).fill(-1), sizes = [];
    for (let s0 = 0; s0 < W * H; s0++) {
      if (!fg[s0] || armMask[s0] || comp[s0] >= 0) continue;
      const id = sizes.length, st = [s0]; comp[s0] = id; let n = 0, touch = false;
      while (st.length) { const i = st.pop(); n++; const x = i % W, y = (i / W) | 0; for (const [ddx, ddy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + ddx, ny = y + ddy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const j = ny * W + nx; if (armMask[j]) touch = true; else if (fg[j] && comp[j] < 0) { comp[j] = id; st.push(j); } } }
      sizes.push({ n, touch });
    }
    const main = sizes.reduce((b, c, k) => (c.n > sizes[b].n ? k : b), 0);
    for (let i = 0; i < W * H; i++) { const c = comp[i]; if (c >= 0 && c !== main && sizes[c].touch && sizes[c].n < 0.02 * fgN) { armMask[i] = 1; const s = decision.arms[0]; if (lab[i] !== L_[`braccio_${s}`]) lab[i] = L_[`oggetto_${s}`]; } }
  }
  const holeMask = new Uint8Array(W * H);
  for (const e of decision.eyes ? eyes : []) for (let i = 0; i < e.w * e.h; i++) if (e.hole[i]) holeMask[(Math.floor(i / e.w) + e.y0) * W + (i % e.w) + e.x0] = 1;
  // corpo: originale meno braccio tagliato, capelli dietro e buchi degli occhi; dietro il braccio,
  // vicino al busto, riempimento dai pixel vicini (zona nascosta a riposo)
  const body = new Uint8ClampedArray(W * H * 4);
  const known = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (!fg[i] || armMask[i] || hair[i] || holeMask[i]) continue;
    body.set(rgba.subarray(i * 4, i * 4 + 4), i * 4); known[i] = 1;
  }
  const fillR = rules.fillBand * shoulderW;
  const dist = new Float32Array(W * H).fill(Infinity), dq = [];
  for (let i = 0; i < W * H; i++) if (known[i] && (lab[i] === L_.busto || decision.arms.some((s) => armFrom[s] === "gomito" && lab[i] === L_[`braccio_${s}`]))) { dist[i] = 0; dq.push(i); }
  for (let qi = 0; qi < dq.length; qi++) { const i = dq[qi], x = i % W, y = (i / W) | 0; if (dist[i] >= fillR) continue; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const j = ny * W + nx; if (!armMask[j] || dist[j] !== Infinity) continue; dist[j] = dist[i] + 1; dq.push(j); } }
  // solo dietro la parte alta del braccio (sopra il gomito): è quella che scopre il busto quando
  // ruota; dietro avambraccio e pugno il riempimento usciva dalla sagoma (macchie vicino al fianco)
  const elbowY = Object.fromEntries(decision.arms.map((s) => [s, by[`avambraccio_${s}`].head.y]));
  const holes = [];
  for (let i = 0; i < W * H; i++) {
    if (!armMask[i] || dist[i] > fillR) continue;
    const y = (i / W) | 0, s = decision.arms.find((a) => lab[i] === L_[`braccio_${a}`] || lab[i] === L_[`oggetto_${a}`]);
    if (s && (armFrom[s] === "gomito" || y <= elbowY[s])) holes.push(i);
  }
  fillHoles(body, known, W, H, holes);
  const crop = (src, bx0, by0, bw, bh) => { const out = new Uint8ClampedArray(bw * bh * 4); for (let y = 0; y < bh; y++) out.set(src.subarray(((y + by0) * W + bx0) * 4, ((y + by0) * W + bx0 + bw) * 4), y * bw * 4); return out; };
  const images = { corpo: { width: cw, height: ch, rgba: crop(body, x0, y0, cw, ch) } };

  // ---- mesh generica su un riquadro ----
  function gridMesh(name, bx0, by0, bw, bh, cells, labelAt) {
    const step = Math.max(bw, bh) / cells;
    const cols = Math.max(2, Math.round(bw / step)), rows = Math.max(2, Math.round(bh / step));
    const order = [];
    for (let c = 0; c <= cols; c++) order.push([c, 0]);
    for (let r = 1; r <= rows; r++) order.push([cols, r]);
    for (let c = cols - 1; c >= 0; c--) order.push([c, rows]);
    for (let r = rows - 1; r >= 1; r--) order.push([0, r]);
    const hull = order.length;
    for (let r = 1; r < rows; r++) for (let c = 1; c < cols; c++) order.push([c, r]);
    const idx = new Map(order.map(([c, r], i) => [`${c},${r}`, i]));
    const uvs = [], vertices = [];
    for (const [c, r] of order) {
      // coordinate sui BORDI dei pixel, come le UV di Spine (u = 0 bordo sinistro, u = 1 bordo destro)
      const px = bx0 + (c / cols) * bw, py = by0 + (r / rows) * bh;
      uvs.push(+(c / cols).toFixed(5), +(r / rows).toFixed(5));
      const label = labelAt(px, py, step);
      let w = chainWeights({ x: px, y: py }, C[label] || C.busto);
      if (label === "testa") {
        const f = smooth(1 - Math.hypot(px - face.x, py - face.y) / faceR);
        if (f > 0) { for (const k in w) w[k] *= 1 - f; w.viso = (w.viso || 0) + f; }
      }
      const ws = Object.entries(w).filter(([, v]) => v > 0.01).sort((a, b) => b[1] - a[1]).slice(0, 4);
      const tot = ws.reduce((a, [, v]) => a + v, 0);
      const sp = toS({ x: px, y: py });
      vertices.push(ws.length);
      for (const [bn, v] of ws) {
        const b = world[bn], dx = sp.x - b.x, dy = sp.y - b.y, co = Math.cos(-b.a), si = Math.sin(-b.a);
        vertices.push(boneIndex[bn], +(dx * co - dy * si).toFixed(2), +(dx * si + dy * co).toFixed(2), +(v / tot).toFixed(4));
      }
    }
    const triangles = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const a = idx.get(`${c},${r}`), b = idx.get(`${c + 1},${r}`), d = idx.get(`${c},${r + 1}`), e = idx.get(`${c + 1},${r + 1}`);
      triangles.push(a, b, e, a, e, d);
    }
    return { type: "mesh", path: name, uvs, triangles, vertices, hull, width: bw, height: bh };
  }
  // etichetta di un vertice: maggioranza nella cella (pixel del personaggio); oggetto se ≥ 15%
  const majority = (allowed, fallback) => (px, py, step) => {
    const cnt = new Map();
    const rad = Math.max(2, Math.round(step / 2));
    for (let dy = -rad; dy <= rad; dy += 2) for (let dx = -rad; dx <= rad; dx += 2) {
      const X = Math.round(px + dx), Y = Math.round(py + dy);
      if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
      const k = lab[Y * W + X];
      if (k >= 0 && allowed(k)) cnt.set(k, (cnt.get(k) || 0) + 1);
    }
    if (!cnt.size) return fallback(px, py);
    let L = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const tot = [...cnt.values()].reduce((a, v) => a + v, 0);
    for (const k of [L_.oggetto_sx, L_.oggetto_dx]) if ((cnt.get(k) || 0) >= 0.15 * tot) L = k;
    return LABELS[L];
  };
  // vertici fuori sagoma: etichetta del pixel del personaggio più vicino (propagazione)
  const near = new Int8Array(W * H).fill(-1), nq = [];
  for (let i = 0; i < W * H; i++) if (lab[i] >= 0) { near[i] = lab[i]; nq.push(i); }
  for (let qi = 0; qi < nq.length; qi++) { const i = nq[qi], x = i % W, y = (i / W) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const j = ny * W + nx; if (near[j] < 0) { near[j] = near[i]; nq.push(j); } } }
  // coordinate dentro l'immagine: i vertici del bordo della griglia stanno sul bordo DESTRO/BASSO dell'ultimo
  // pixel (x = W, y = H) quando il personaggio esce dall'immagine (Robin Hood, 8 ott: errore "reading 'length'")
  const nearLabel = (px, py) => LABELS[near[Math.min(H - 1, Math.max(0, Math.round(py))) * W + Math.min(W - 1, Math.max(0, Math.round(px)))]];

  // corpo: le parti tagliate contano come busto/testa (nel corpo resta solo il riempimento dietro)
  // (dal gomito: l'omero resta nel corpo e segue la catena del braccio)
  const bodyMap = (n) => (n === "capelli" ? "testa" : decision.arms.some((s) => (n === `braccio_${s}` && armFrom[s] === "spalla") || n === `oggetto_${s}`) ? "busto" : n);
  const attachments = {};
  attachments.corpo = gridMesh("corpo", x0, y0, cw, ch, rules.cells, (px, py, step) => bodyMap(majority(() => true, nearLabel)(px, py, step)));

  // pezzi tagliati
  const pieceOf = (mask, name, map, cells) => {
    let a = W, b = H, c = -1, d = -1;
    for (let i = 0; i < W * H; i++) if (mask[i]) { const x = i % W, y = (i / W) | 0; a = Math.min(a, x); c = Math.max(c, x); b = Math.min(b, y); d = Math.max(d, y); }
    a = Math.max(0, a - 2); b = Math.max(0, b - 2); c = Math.min(W - 1, c + 2); d = Math.min(H - 1, d + 2);
    const bw = c - a + 1, bh = d - b + 1, px = new Uint8ClampedArray(bw * bh * 4);
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) { const g = (y + b) * W + x + a; if (mask[g]) px.set(rgba.subarray(g * 4, g * 4 + 4), (y * bw + x) * 4); }
    images[name] = { width: bw, height: bh, rgba: px };
    attachments[name] = gridMesh(name, a, b, bw, bh, cells, map);
  };
  // vertici del pezzo fuori dalla sua sagoma: etichetta del pixel DEL PEZZO più vicino (prima il
  // ripiego era "braccio": la punta del fulmine si stirava tra mano e omero)
  const nearIn = (mask) => {
    const m = new Int8Array(W * H).fill(-1), q = [];
    for (let i = 0; i < W * H; i++) if (mask[i]) { m[i] = lab[i]; q.push(i); }
    for (let qi = 0; qi < q.length; qi++) { const i = q[qi], x = i % W, y = (i / W) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const j = ny * W + nx; if (m[j] < 0) { m[j] = m[i]; q.push(j); } } }
    return (px, py) => LABELS[m[Math.min(H - 1, Math.max(0, Math.round(py))) * W + Math.min(W - 1, Math.max(0, Math.round(px)))]];
  };
  for (const s of decision.arms) {
    const own = (k) => k === L_[`braccio_${s}`] || k === L_[`oggetto_${s}`];
    const fallback = nearIn(armMask);
    pieceOf(armMask, `braccio_${s}`, (px, py, step) => majority(own, fallback)(px, py, step), rules.pieceCells);
  }
  if (decision.hair) pieceOf(hair, "capelli_dietro", () => "capelli", 8);

  // occhi: bianco (sotto), pupilla (sotto, si muove), palpebra (davanti, battito)
  const region = (name, boneName, bx0, by0, bw, bh, px) => {
    images[name] = { width: bw, height: bh, rgba: px };
    const b = world[boneName], cxy = toS({ x: bx0 + bw / 2, y: by0 + bh / 2 }), dx = cxy.x - b.x, dy = cxy.y - b.y, co = Math.cos(-b.a), si = Math.sin(-b.a);
    attachments[name] = { x: +(dx * co - dy * si).toFixed(2), y: +(dx * si + dy * co).toFixed(2), rotation: +deg(-b.a).toFixed(2), width: bw, height: bh };
  };
  // PALPEBRA CHIUSA: forma del buco allargata di 2 px, colore della pelle sopra l'occhio (righe
  // senza ciglia), leggera ombra verso il basso, ciglia (colore più scuro sopra l'occhio) sul bordo basso.
  // PALPEBRA "PELLE" come la Domatrice (analisi 8 ott): un anello di vertici sul contorno dell'occhio
  // (ciglia sopra e sotto) pesato al 100% sull'osso palpebra, al centro dell'occhio; un anello esterno
  // fermo sull'osso occhio; in mezzo un anello al 50%. Il battito schiaccia l'anello interno sulla
  // linea di mezzo: la pelle sopra scende, quella sotto sale, le ciglia si incontrano.
  // È un pezzo a parte (copia dei pixel del corpo attorno all'occhio, buco escluso) davanti al corpo:
  // a riposo coincide col corpo, quindi non si vede; nel battito la pelle stirata copre il buco.
  const lidSkin = (e) => {
    const b = e.box, cx = (b.x0 + b.x1 + 1) / 2, cy = (b.y0 + b.y1 + 1) / 2, ew = b.x1 - b.x0 + 1, eh = b.y1 - b.y0 + 1; // centro sui bordi dei pixel
    const N = 24;
    // raggio del buco per settore angolare (massimo dei pixel del buco nel settore): l'anello interno
    // racchiude TUTTO il buco, anche gli angoli fra un raggio e l'altro (a occhio chiuso non resta nulla)
    const rs = new Array(N).fill(0);
    for (let i = 0; i < e.w * e.h; i++) {
      if (!e.hole[i]) continue;
      const x = (i % e.w) + e.x0 + 0.5 - cx, y = ((i / e.w) | 0) + e.y0 + 0.5 - cy;
      const a = (Math.atan2(y, x) + 2 * Math.PI) % (2 * Math.PI), d = Math.hypot(x, y) + 0.8;
      for (const k of [Math.floor((a / (2 * Math.PI)) * N - 0.5), Math.floor((a / (2 * Math.PI)) * N + 0.5)]) { const j = (k + N) % N; rs[j] = Math.max(rs[j], d); }
    }
    const inner = [], outer = [], midR = [];
    const orx = ew / 2 + 0.55 * eh, ory = eh / 2 + 0.9 * eh;
    for (let i = 0; i < N; i++) {
      const a = (2 * Math.PI * i) / N, dx = Math.cos(a), dy = Math.sin(a);
      const r = rs[i] / Math.cos(Math.PI / N); // il lato del poligono non taglia gli angoli del settore
      const pi = { x: cx + dx * (r + 1), y: cy + dy * (r + 1) };
      // esterno: ellisse ampia attorno all'occhio, mai dentro l'anello interno
      const ro = 1 / Math.sqrt((dx / orx) ** 2 + (dy / ory) ** 2);
      const po = { x: cx + dx * Math.max(ro, r + 4), y: cy + dy * Math.max(ro, r + 4) };
      inner.push(pi); outer.push(po); midR.push(lerp(pi, po, 0.5));
    }
    const all = [...outer, ...inner, ...midR];
    const bx0 = Math.floor(Math.min(...all.map((p) => p.x))) - 1, bx1 = Math.ceil(Math.max(...all.map((p) => p.x))) + 1;
    const by0 = Math.floor(Math.min(...all.map((p) => p.y))) - 1, by1 = Math.ceil(Math.max(...all.map((p) => p.y))) + 1;
    const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1, px = new Uint8ClampedArray(bw * bh * 4);
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) { const g = (y + by0) * W + x + bx0; if (body[g * 4 + 3] && !holeMask[g]) px.set(body.subarray(g * 4, g * 4 + 4), (y * bw + x) * 4); }
    const name = `palpebra_${e.side}`;
    images[name] = { width: bw, height: bh, rgba: px };
    // vertici: contorno = anello esterno (hull), poi interno, poi mezzo
    const occ = world[`occhio_${e.side}`], pal = world[name];
    const local = (bb, sp) => { const dx = sp.x - bb.x, dy = sp.y - bb.y, co = Math.cos(-bb.a), si = Math.sin(-bb.a); return [+(dx * co - dy * si).toFixed(2), +(dx * si + dy * co).toFixed(2)]; };
    const uvs = [], vertices = [];
    const push = (p, ws) => {
      uvs.push(+((p.x - bx0) / bw).toFixed(5), +((p.y - by0) / bh).toFixed(5));
      const sp = toS(p);
      vertices.push(ws.length);
      for (const [bn, w] of ws) vertices.push(boneIndex[bn], ...local(bn === name ? pal : occ, sp), w);
    };
    outer.forEach((p) => push(p, [[`occhio_${e.side}`, 1]]));
    inner.forEach((p) => push(p, [[name, 1]]));
    midR.forEach((p) => push(p, [[`occhio_${e.side}`, 0.5], [name, 0.5]]));
    const O = (i) => i % N, I = (i) => N + (i % N), M = (i) => 2 * N + (i % N);
    const triangles = [];
    for (let i = 0; i < N; i++) triangles.push(O(i), O(i + 1), M(i + 1), O(i), M(i + 1), M(i), M(i), M(i + 1), I(i + 1), M(i), I(i + 1), I(i));
    attachments[name] = { type: "mesh", path: name, uvs, triangles, vertices, hull: N, width: bw, height: bh };
  };
  const lidClosed = (e) => {
    const pad = 2, w = e.w + 2 * pad, h = e.h + 2 * pad;
    const inside = (x, y) => { for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const X = x - pad + dx, Y = y - pad + dy; if (X >= 0 && Y >= 0 && X < e.w && Y < e.h && e.hole[Y * e.w + X]) return true; } return false; };
    const skin = [0, 0, 0], lash = [255, 255, 255];
    let n = 0, lashL = 999;
    for (let x = 0; x < e.w; x++) {
      if (e.top[x] == null) continue;
      for (let dy = 2; dy <= 8; dy++) {
        const gy = e.top[x] - dy, gx = x + e.x0, k = (gy * W + gx) * 4;
        const l = luma(rgba[k], rgba[k + 1], rgba[k + 2]);
        if (l < lashL) { lashL = l; lash[0] = rgba[k]; lash[1] = rgba[k + 1]; lash[2] = rgba[k + 2]; }
        if (dy >= 5 && l > 90) { skin[0] += rgba[k]; skin[1] += rgba[k + 1]; skin[2] += rgba[k + 2]; n++; }
      }
    }
    if (n) for (let k = 0; k < 3; k++) skin[k] /= n;
    // pelle: quella della guancia sotto l'occhio (sopra ci sono ciglia, ombretto, sopracciglia)
    if (e.skin) for (let k = 0; k < 3; k++) skin[k] = e.skin[k];
    const px = new Uint8ClampedArray(w * h * 4), mask = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (inside(x, y)) mask[y * w + x] = 1;
    // forma a mandorla: ellisse sul riquadro del buco (+2 px) unita al buco allargato. Bordo liscio,
    // copre anche i rientri del buco dove le ciglia scendono sull'iride (tacca scura a occhio chiuso)
    {
      const bx0 = e.box.x0 - e.x0 + pad, bx1 = e.box.x1 - e.x0 + pad, by0 = e.box.y0 - e.y0 + pad, by1 = e.box.y1 - e.y0 + pad;
      const ecx = (bx0 + bx1) / 2, ecy = (by0 + by1) / 2, erx = (bx1 - bx0) / 2 + 2, ery = (by1 - by0) / 2 + 2;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (((x - ecx) / erx) ** 2 + ((y - ecy) / ery) ** 2 <= 1) mask[y * w + x] = 1;
    }
    for (let x = 0; x < w; x++) {
      let y0 = -1, y1 = -1;
      for (let y = 0; y < h; y++) if (mask[y * w + x]) { if (y0 < 0) y0 = y; y1 = y; }
      if (y0 < 0) continue;
      for (let y = y0; y <= y1; y++) {
        // palpebra: più scura in alto (piega) e appena sopra le ciglia, chiara al centro
        const f = (y - y0) / Math.max(1, y1 - y0), sh = 0.86 + 0.14 * Math.sin(Math.PI * Math.min(1, f * 1.1));
        const lashLine = y >= y1 - 2;
        const c = lashLine ? lash : skin.map((v) => v * sh);
        px.set([c[0], c[1], c[2], 255], (y * w + x) * 4);
      }
    }
    const name = `palpebra_${e.side}`;
    region(name, name, e.x0 - pad, e.y0 - pad, w, h, px);
  };
  for (const e of decision.eyes ? eyes : []) {
    const { x0: ex, y0: ey, w, h } = e;
    const wpx = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let inside = false;
      for (let dy = -2; dy <= 2 && !inside; dy++) for (let dx = -2; dx <= 2; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < w && Y < h && e.hole[Y * w + X]) { inside = true; break; } }
      if (!inside) continue;
      const shade = 1 - 0.18 * Math.max(0, 1 - (y - (e.box.y0 - ey)) / Math.max(1, (e.box.y1 - e.box.y0) * 0.5));
      wpx.set([e.white[0] * shade, e.white[1] * shade, e.white[2] * shade, 255], (y * w + x) * 4);
    }
    region(`bianco_${e.side}`, `occhio_${e.side}`, ex, ey, w, h, wpx);
    const ppx = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) if (e.iris[i]) { const g = (Math.floor(i / w) + ey) * W + (i % w) + ex; ppx.set(rgba.subarray(g * 4, g * 4 + 4), i * 4); }
    region(`pupilla_${e.side}`, `pupilla_${e.side}`, ex, ey, w, h, ppx);
    if (rules.lid === "pelle") lidSkin(e);
    else lidClosed(e);
  }

  // BOCCA: pezzo ad anelli come la palpebra "pelle" (copia dei pixel del corpo attorno alla bocca, davanti
  // al corpo). Anello esterno fermo sul viso: a riposo coincide col corpo e non si vede; verso l'interno i
  // vertici seguono sempre di più gli angoli della bocca, così il sorriso piega labbra e guance senza strappi.
  if (mouth) {
    const N = 28, F = [1, 0.84, 0.7, 0.58, 0.47, 0.36, 0.25, 0.13];
    const c = mouth.center, rx = mouth.width * 1.1, ry = mouth.width * 0.8, reach = mouth.width * 0.6;
    const ring = (f) => Array.from({ length: N }, (_, i) => { const a = (2 * Math.PI * i) / N; return { x: c.x + Math.cos(a) * rx * f, y: c.y + Math.sin(a) * ry * f }; });
    const rings = F.map(ring);
    const all = rings.flat();
    const bx0 = Math.max(0, Math.floor(Math.min(...all.map((q) => q.x))) - 1), bx1 = Math.min(W - 1, Math.ceil(Math.max(...all.map((q) => q.x))) + 1);
    const by0 = Math.max(0, Math.floor(Math.min(...all.map((q) => q.y))) - 1), by1 = Math.min(H - 1, Math.ceil(Math.max(...all.map((q) => q.y))) + 1);
    const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1, px = new Uint8ClampedArray(bw * bh * 4);
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) { const g = (y + by0) * W + x + bx0; if (body[g * 4 + 3] && !holeMask[g]) px.set(body.subarray(g * 4, g * 4 + 4), (y * bw + x) * 4); }
    images.bocca = { width: bw, height: bh, rgba: px };
    const local = (bb, sp) => { const dx = sp.x - bb.x, dy = sp.y - bb.y, co = Math.cos(-bb.a), si = Math.sin(-bb.a); return [+(dx * co - dy * si).toFixed(2), +(dx * si + dy * co).toFixed(2)]; };
    const uvs = [], vertices = [];
    const push = (q, f) => {
      uvs.push(+((q.x - bx0) / bw).toFixed(5), +((q.y - by0) / bh).toFixed(5));
      const g = smooth((1 - f) / 0.45); // 0 sull'anello esterno, 1 da metà raggio in giù
      const ws = [];
      for (const s of ["sx", "dx"]) { const k = g * smooth(1 - Math.hypot(q.x - mouth[s].x, q.y - mouth[s].y) / reach); if (k > 0.01) ws.push([`bocca_${s}`, k]); }
      const tot = ws.reduce((a, [, v]) => a + v, 0);
      if (tot > 1) for (const w of ws) w[1] /= tot;
      const rest = 1 - Math.min(1, tot);
      if (rest > 0.001) ws.push(["viso", rest]);
      const sp = toS(q);
      vertices.push(ws.length);
      for (const [bn, w] of ws) vertices.push(boneIndex[bn], ...local(world[bn], sp), +w.toFixed(4));
    };
    rings.forEach((r, k) => r.forEach((q) => push(q, F[k])));
    push(c, 0);
    const V = (k, i) => k * N + (i % N), C = F.length * N, triangles = [];
    for (let k = 0; k < F.length - 1; k++) for (let i = 0; i < N; i++) triangles.push(V(k, i), V(k, i + 1), V(k + 1, i + 1), V(k, i), V(k + 1, i + 1), V(k + 1, i));
    for (let i = 0; i < N; i++) triangles.push(V(F.length - 1, i), V(F.length - 1, i + 1), C);
    attachments.bocca = { type: "mesh", path: "bocca", uvs, triangles, vertices, hull: N, width: bw, height: bh };
  }

  // slot: ordine di disegno (dietro → davanti)
  const slotFor = (name, bone) => ({ name, bone, attachment: name });
  const slots = [];
  if (attachments.capelli_dietro) slots.push(slotFor("capelli_dietro", "root"));
  for (const e of decision.eyes ? eyes : []) slots.push(slotFor(`bianco_${e.side}`, `occhio_${e.side}`));
  for (const e of decision.eyes ? eyes : []) slots.push(slotFor(`pupilla_${e.side}`, `pupilla_${e.side}`));
  slots.push(slotFor("corpo", "root"));
  if (attachments.bocca) slots.push(slotFor("bocca", "viso"));
  if (smilePatch) {
    region("bocca_sorriso", "viso", smilePatch.x0, smilePatch.y0, smilePatch.width, smilePatch.height, smilePatch.rgba);
    // nel setup è invisibile (la bocca resta quella del disegno): compare con l'animazione
    slots.push({ ...slotFor("bocca_sorriso", "viso"), color: "ffffff00" });
  }
  for (const e of decision.eyes ? eyes : []) slots.push(rules.lid === "pelle" ? slotFor(`palpebra_${e.side}`, `occhio_${e.side}`) : { ...slotFor(`palpebra_${e.side}`, `palpebra_${e.side}`), color: "ffffff00" });
  for (const s of decision.arms) slots.push(slotFor(`braccio_${s}`, "root"));
  const skinAtt = Object.fromEntries(slots.map((s) => [s.name, { [s.name]: attachments[s.name] }]));

  const json = {
    skeleton: { spine: "4.1.24", x: -cw / 2, y: 0, width: cw, height: ch, images: "./" },
    bones: jsonBones,
    slots,
    skins: [{ name: "default", attachments: skinAtt }],
    animations: { ambient: loopAnimation(rules, ch, decision, eyes, ipd, mouth && { ...mouth, visoA: world.viso.a }, !!smilePatch) }
  };
  return {
    json,
    images,
    report: { version: MESH_RIG_VERSION, decision: decision.reasons, bones: jsonBones.length, slots: slots.map((s) => s.name), bodyVertices: attachments.corpo.uvs.length / 2, filledBehindArm: holes.length }
  };
}

/**
 * Chiavi POCHE e MORBIDE come nel rig della Domatrice: una chiave sui massimi, sui minimi e sui
 * flessi della curva (più inizio e fine), con curve di Bézier che seguono la tangente (Hermite).
 * In Spine si vedono fluide e si possono ritoccare a mano. fns: una funzione per canale (x[, y]).
 */
export function smoothKeys(T, fns, fields) {
  const N = 600, dt = T / N;
  const times = new Set([0, T]);
  for (const f of fns) {
    const v = Array.from({ length: N + 1 }, (_, i) => f(i * dt));
    for (let i = 1; i < N; i++) {
      const d1 = v[i] - v[i - 1], d2 = v[i + 1] - v[i];
      const c1 = v[i + 1] - 2 * v[i] + v[i - 1], c0 = i > 1 ? v[i] - 2 * v[i - 1] + v[i - 2] : c1;
      if (d1 * d2 < 0 || (d1 === 0) !== (d2 === 0) || c0 * c1 < 0) times.add(+(i * dt).toFixed(3));
    }
  }
  const ts = [...times].sort((p, q) => p - q).filter((t, i, arr) => i === 0 || t - arr[i - 1] > 0.05 || t === T);
  const r = (x) => +x.toFixed(3);
  const der = (f, t) => (f(Math.min(T, t + 1e-3)) - f(Math.max(0, t - 1e-3))) / (Math.min(T, t + 1e-3) - Math.max(0, t - 1e-3));
  return ts.map((t, i) => {
    const k = { time: r(t) };
    fns.forEach((f, j) => (k[fields[j]] = r(f(t))));
    if (i < ts.length - 1) {
      const t1 = ts[i + 1], h = (t1 - t) / 3, curve = [];
      for (const f of fns) curve.push(r(t + h), r(f(t) + der(f, t) * h), r(t1 - h), r(f(t1) - der(f, t1) * h));
      k.curve = curve;
    }
    return k;
  });
}

/** Loop di 6 s sul modello della Domatrice. */
function loopAnimation(rules, height, decision, eyes, ipd, mouth, smileRedrawn = false) {
  const T = rules.loopSeconds, A = rules.amp;
  const wave = (k, ph = 0) => (t) => Math.sin(2 * Math.PI * (k * t / T + ph));
  const bump = (ph = 0) => (t) => 0.5 * (1 - Math.cos(2 * Math.PI * (t / T + ph)));
  const rot = (amp, f) => smoothKeys(T, [(t) => amp * f(t)], ["value"]);
  const xy = (fx, fy) => smoothKeys(T, [fx, fy], ["x", "y"]);
  const one = () => 1, zero = () => 0;
  const bones = {
    schiena: { rotate: rot(A.schiena, wave(2)) },
    petto: { rotate: rot(-A.petto, bump()), scale: xy((t) => 1 + A.breath * bump(0.25)(t), one) },
    testa: { rotate: rot(A.testa, wave(1, 0.15)) },
    viso: { translate: xy((t) => -A.visoSlide * height * bump(0.1)(t), zero) }
  };
  for (const [s, ph] of [["sx", 0], ["dx", 0.3]]) {
    bones[`omero_${s}`] = { rotate: rot(A.omero, wave(1, ph)) };
    bones[`avambraccio_${s}`] = { rotate: rot(A.avambraccio, wave(1, ph + 0.12)) };
    bones[`mano_${s}`] = { rotate: rot(A.mano, wave(2, ph + 0.2)) };
  }
  if (decision.hair) {
    bones.capelli_1 = { rotate: rot(A.capelli, wave(1, 0.35)) };
    bones.capelli_2 = { rotate: rot(A.capelli * 1.3, wave(1, 0.45)) };
  }
  if (mouth) {
    // sorriso: angoli su (y Spine verso l'alto) e in fuori; lo spostamento è nel sistema dell'osso "viso"
    // bocca all'ingiù: prima si riportano gli angoli all'altezza delle labbra (frown), poi il sorriso vero
    const up = rules.smileUp * mouth.width + (mouth.frown || 0), out = rules.smileOut * mouth.width;
    const on = (a, b, t) => smooth((t - a) / (b - a));
    const amount = rules.smile === "sempre" ? () => 1 : (t) => on(3.0, 3.5, t) * (1 - on(4.8, 5.3, t));
    for (const [s, sign] of [["sx", 1], ["dx", -1]]) {
      // sx = lato sinistro del PERSONAGGIO = a destra nell'immagine
      const wx = sign * out * (mouth.sx.x > mouth.dx.x ? 1 : -1), wy = up;
      const co = Math.cos(-mouth.visoA), si = Math.sin(-mouth.visoA);
      const lx = wx * co - wy * si, ly = wx * si + wy * co;
      bones[`bocca_${s}`] = { translate: rules.smile === "sempre" ? [{ time: 0, x: +lx.toFixed(2), y: +ly.toFixed(2) }, { time: T, x: +lx.toFixed(2), y: +ly.toFixed(2) }] : xy((t) => lx * amount(t), (t) => ly * amount(t)) };
    }
  }
  const slotsAnim = {};
  if (smileRedrawn) {
    // dissolvenza del sorriso ridisegnato: compare 3,0→3,35 s, resta, sparisce 4,85→5,2 s
    slotsAnim.bocca_sorriso = { rgba: rules.smile === "sempre"
      ? [{ time: 0, color: "ffffffff" }]
      : [{ time: 0, color: "ffffff00" }, { time: 3, color: "ffffff00" }, { time: 3.35, color: "ffffffff" }, { time: 4.85, color: "ffffffff" }, { time: 5.2, color: "ffffff00" }, { time: T, color: "ffffff00" }] };
  }
  if (decision.eyes) {
    // pupille: due sguardi (di lato e un po' in basso), come la Domatrice
    // distanza periodica: il loop si chiude sullo stesso valore
    const look = (t) => { const p = t / T; const g = (c) => { const d = Math.min(Math.abs(p - c), 1 - Math.abs(p - c)); return Math.exp(-(d ** 2) / 0.006); }; return g(0.22) + g(0.72); };
    for (const e of eyes) {
      bones[`pupilla_${e.side}`] = { translate: xy((t) => -A.pupille * ipd * 0.5 * look(t), (t) => -A.pupille * ipd * 0.25 * look(t)) };
      // battito: 0,13 s chiusura, 0,2 s apertura (chiavi lineari, è uno scatto voluto)
      const t0 = rules.blinkAt;
      const r3 = (v) => +v.toFixed(3);
      if (rules.lid === "pelle") {
        // come la Domatrice (1 → 0,2): qui 1 → -0,04 in 0,13 s (le due palpebre si sovrappongono appena: nessuna fessura), ritorno in 0,2 s
        bones[`palpebra_${e.side}`] = { scale: [{ time: 0, x: 1, y: 1 }, { time: t0, x: 1, y: 1 }, { time: r3(t0 + 0.133), x: 1, y: -0.04 }, { time: r3(t0 + 0.333), x: 1, y: 1 }, { time: T, x: 1, y: 1 }] };
        continue;
      }
      bones[`palpebra_${e.side}`] = { scale: [{ time: 0, x: 1, y: 0.05 }, { time: t0, x: 1, y: 0.05 }, { time: r3(t0 + 0.1), x: 1, y: 1 }, { time: r3(t0 + 0.167), x: 1, y: 1 }, { time: r3(t0 + 0.333), x: 1, y: 0.05 }, { time: T, x: 1, y: 0.05 }] };
      slotsAnim[`palpebra_${e.side}`] = { rgba: [{ time: 0, color: "ffffff00" }, { time: r3(t0 - 0.001), color: "ffffff00" }, { time: t0, color: "ffffffff" }, { time: r3(t0 + 0.333), color: "ffffffff" }, { time: r3(t0 + 0.334), color: "ffffff00" }] };
    }
  }
  return { bones, slots: slotsAnim };
}

/** Atlas: una pagina per immagine (file <nome>.png accanto al json). */
export function atlasFor(images) {
  return Object.entries(images).map(([n, im]) => `${n}.png\nsize: ${im.width},${im.height}\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\n${n}\n  rotate: false\n  xy: 0, 0\n  size: ${im.width}, ${im.height}\n  orig: ${im.width}, ${im.height}\n  offset: 0, 0\n  index: -1\n`).join("\n");
}

/**
 * Atlas a PAGINA UNICA (come l'export di Spine): pezzi impilati su ripiani, 2 px di margine.
 * @returns {{ width, height, rgba, text }} immagine della pagina e testo dell'atlas (formato 4.x)
 */
export function packAtlas(images, pageName, { pad = 2, maxWidth = 2048 } = {}) {
  const items = Object.entries(images).map(([name, im]) => ({ name, im })).sort((a, b) => b.im.height - a.im.height);
  const width = Math.min(maxWidth, Math.max(...items.map((it) => it.im.width + 2 * pad)));
  let x = 0, y = 0, shelf = 0;
  for (const it of items) {
    if (x + it.im.width + 2 * pad > width) { x = 0; y += shelf; shelf = 0; }
    it.x = x + pad; it.y = y + pad;
    x += it.im.width + 2 * pad; shelf = Math.max(shelf, it.im.height + 2 * pad);
  }
  const height = y + shelf;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (const { im, x: px, y: py } of items) for (let r = 0; r < im.height; r++) rgba.set(im.rgba.subarray(r * im.width * 4, (r + 1) * im.width * 4), ((py + r) * width + px) * 4);
  const text = `${pageName}\nsize: ${width},${height}\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\n` +
    items.map(({ name, im, x: px, y: py }) => `${name}\n  rotate: false\n  xy: ${px}, ${py}\n  size: ${im.width}, ${im.height}\n  orig: ${im.width}, ${im.height}\n  offset: 0, 0\n  index: -1\n`).join("");
  return { width, height, rgba, text };
}
