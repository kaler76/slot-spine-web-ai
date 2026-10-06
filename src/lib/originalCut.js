// src/lib/originalCut.js — PEZZI TAGLIATI DALL'ORIGINALE (6 ott 2026).
// Metodo preferito: le parti VISIBILI vengono sempre dall'immagine originale (posizione e misura
// esatte per costruzione, nessun ridisegno che deforma il personaggio). Solo le zone NASCOSTE
// (sotto la testa, sotto gli avambracci, sotto gli occhi chiusi...) vanno ricostruite:
//   1. riconoscimento (partRecognition) -> pezzi (partExtraction.extractPieces, con bozza delle
//      zone nascoste per propagazione dei colori dal bordo);
//   2. VISO dai punti della posa: occhi, sopracciglia e bocca ritagliati dalla testa; sotto, la
//      pelle propagata dal bordo e, al posto dell'occhio, una palpebra chiusa (linea delle ciglia
//      con il colore più scuro dell'occhio);
//   3. sovrapposizione automatica ai raccordi (jointUnderlay).
// Le zone nascoste sono ancora una BOZZA (propagazione): il passo successivo è farle ridipingere
// all'AI solo dentro la loro maschera. Puro: nessun DOM.

import { extractPieces, fillHoles } from "./partExtraction.js";
import { underlayJoints } from "./jointUnderlay.js";

export const ORIGINAL_CUT_VERSION = "2026-10-06.taglio.1";

const LMK = { eyeSx: 2, eyeDx: 5, mouthSx: 9, mouthDx: 10 };
const ok = (p) => p && (p.visibility ?? 1) > 0.3 && (p.x || p.y);

/**
 * Maschera ADATTIVA di un tratto del viso (coordinate locali della testa): nella finestra
 * ellittica attorno al punto, i pixel che si staccano dal colore della pelle (mediana di un anello
 * attorno), collegati al centro; poi allargata di "grow" px per prendere anche il bordo.
 */
function featureMask(head, c, rx, ry, { minDiff = 45, grow = 2 } = {}) {
  const W = head.width, Hh = head.height;
  const at = (x, y) => (x >= 0 && y >= 0 && x < W && y < Hh && head.rgba[(y * W + x) * 4 + 3] >= 128 ? (y * W + x) * 4 : -1);
  const cx = c.x - head.x, cy = c.y - head.y;
  const ring = [];
  for (let y = Math.floor(cy - 1.4 * ry); y <= cy + 1.4 * ry; y++)
    for (let x = Math.floor(cx - 1.4 * rx); x <= cx + 1.4 * rx; x++) {
      const e = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
      if (e < 1.2 || e > 1.96) continue;
      const i = at(x, y);
      if (i >= 0) ring.push([head.rgba[i], head.rgba[i + 1], head.rgba[i + 2]]);
    }
  if (ring.length < 10) return [];
  const med = [0, 1, 2].map((k) => ring.map((v) => v[k]).sort((a, b) => a - b)[ring.length >> 1]);
  const inWin = (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
  const diff = (x, y) => {
    const i = at(x, y);
    return i < 0 ? 0 : Math.abs(head.rgba[i] - med[0]) + Math.abs(head.rgba[i + 1] - med[1]) + Math.abs(head.rgba[i + 2] - med[2]);
  };
  // seme: il pixel più "diverso" vicino al centro
  let seed = null;
  for (let y = Math.round(cy - ry / 2); y <= cy + ry / 2; y++)
    for (let x = Math.round(cx - rx / 2); x <= cx + rx / 2; x++) {
      const d = diff(x, y);
      if (d >= minDiff && (!seed || d > seed.d)) seed = { x, y, d };
    }
  if (!seed) return [];
  const sel = new Set([seed.y * W + seed.x]), st = [[seed.x, seed.y]];
  while (st.length) {
    const [x, y] = st.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      const X = x + dx, Y = y + dy, k = Y * W + X;
      if (sel.has(k) || !inWin(X, Y) || diff(X, Y) < minDiff) continue;
      sel.add(k); st.push([X, Y]);
    }
  }
  for (let g = 0; g < grow; g++)
    for (const k of [...sel]) {
      const x = k % W, y = (k - x) / W;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy; if (at(X, Y) >= 0) sel.add(Y * W + X); }
    }
  return [...sel].map((k) => [k % W, Math.floor(k / W)]);
}

/** Ritaglia dalla testa i pixel della maschera in un pezzo nuovo; nella testa li segna come buchi. */
function liftFeature(head, mask, name) {
  if (mask.length < 12) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (const [x, y] of mask) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const w = x1 - x0 + 1, h = y1 - y0 + 1, rgba = new Uint8ClampedArray(w * h * 4);
  for (const [x, y] of mask) rgba.set(head.rgba.subarray((y * head.width + x) * 4, (y * head.width + x) * 4 + 4), ((y - y0) * w + (x - x0)) * 4);
  return { name, parent: "testa", x: head.x + x0, y: head.y + y0, width: w, height: h, rgba, pivot: { x: Math.round(head.x + x0 + w / 2), y: Math.round(head.y + y0 + h / 2) } };
}

/** Pezzi del viso staccati dalla testa (occhi, sopracciglia, bocca) + palpebre chiuse disegnate. */
export function liftFace(pieces, landmarks, warnings = []) {
  const head = pieces.find((p) => p.name === "testa");
  const L = (i) => (ok(landmarks?.[i]) ? landmarks[i] : null);
  if (!head || !L(LMK.eyeSx) || !L(LMK.eyeDx)) {
    warnings.push("Viso: punti degli occhi assenti, occhi e bocca restano sulla testa (niente battito).");
    return pieces;
  }
  const u = Math.hypot(L(LMK.eyeSx).x - L(LMK.eyeDx).x, L(LMK.eyeSx).y - L(LMK.eyeDx).y);
  const masks = [];
  for (const [side, i] of [["sx", LMK.eyeSx], ["dx", LMK.eyeDx]]) {
    const e = L(i);
    masks.push([`occhio_${side}`, featureMask(head, e, 0.42 * u, 0.26 * u), e]);
    masks.push([`sopracciglio_${side}`, featureMask(head, { x: e.x, y: e.y - 0.45 * u }, 0.45 * u, 0.2 * u, { minDiff: 35 }), null]);
  }
  if (L(LMK.mouthSx) && L(LMK.mouthDx)) {
    const a = L(LMK.mouthSx), b = L(LMK.mouthDx);
    const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    masks.push(["bocca", featureMask(head, c, 0.5 * Math.hypot(a.x - b.x, a.y - b.y) + 0.2 * u, 0.3 * u), null]);
  }
  const out = [], holes = new Set();
  const lids = [];
  for (const [name, mask, eye] of masks) {
    const f = liftFeature(head, mask, name);
    if (!f) continue;
    out.push(f);
    for (const [x, y] of mask) holes.add(y * head.width + x);
    if (eye) {
      // colore della linea delle ciglia: il pixel più scuro dell'occhio
      let best = null;
      for (let i = 0; i < f.rgba.length; i += 4) {
        if (f.rgba[i + 3] < 200) continue;
        const l = f.rgba[i] + f.rgba[i + 1] + f.rgba[i + 2];
        if (!best || l < best.l) best = { l, c: [f.rgba[i], f.rgba[i + 1], f.rgba[i + 2]] };
      }
      lids.push({ eye, mask, color: best?.c || [40, 25, 20] });
    }
  }
  // pelle sotto i tratti: propagazione dal bordo
  const known = new Uint8Array(head.width * head.height);
  for (let i = 0; i < known.length; i++) known[i] = head.rgba[i * 4 + 3] >= 128 && !holes.has(i) ? 1 : 0;
  fillHoles(head.rgba, known, head.width, head.height, [...holes]);
  // ammorbidisce la propagazione (strisce e losanghe): 4 passate di media 5x5 solo nei buchi
  const W = head.width, Hh = head.height, list = [...holes];
  for (let pass = 0; pass < 4; pass++) {
    const tmp = Uint8ClampedArray.from(head.rgba);
    for (const k of list) {
      const x = k % W, y = (k - x) / W;
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const X = x + dx, Y = y + dy;
          if (X < 0 || Y < 0 || X >= W || Y >= Hh) continue;
          const j = (Y * W + X) * 4;
          if (tmp[j + 3] < 128) continue;
          r += tmp[j]; g += tmp[j + 1]; b += tmp[j + 2]; n++;
        }
      if (n) head.rgba.set([r / n, g / n, b / n], k * 4);
    }
  }
  // palpebra chiusa: per ogni colonna della maschera dell'occhio, la linea delle ciglia al 60%
  // fra cima e fondo (segue la forma dell'occhio), spessa ~u/30, nel colore più scuro dell'occhio
  const t = Math.max(1.5, u / 30);
  for (const { mask, color } of lids) {
    const cols = new Map();
    for (const [x, y] of mask) { const c = cols.get(x) || [Infinity, -1]; cols.set(x, [Math.min(c[0], y), Math.max(c[1], y)]); }
    const xs = [...cols.keys()].sort((a, b) => a - b);
    const trim = Math.round(0.08 * xs.length);
    for (const x of xs.slice(trim, xs.length - trim)) {
      const [y0, y1] = cols.get(x);
      const yy = y0 + 0.6 * (y1 - y0);
      for (let dy = -t / 2; dy <= t / 2; dy += 0.5) {
        const y = Math.round(yy + dy);
        if (y < 0 || y >= head.height) continue;
        const i = (y * head.width + x) * 4;
        if (head.rgba[i + 3] >= 128) head.rgba.set(color, i);
      }
    }
  }
  const ord = head.order;
  out.forEach((f, k) => (f.order = ord + 0.1 + k * 0.01));
  return [...pieces, ...out];
}

/**
 * Il pivot di un figlio deve stare SUL genitore (raccordo): se cade fuori (es. spalla oltre il
 * bordo del busto), si sposta sul pixel più vicino pieno in entrambi (o almeno nel genitore).
 */
export function snapPivots(pieces, warnings = []) {
  const full = (p, x, y) => {
    const lx = Math.round(x - p.x), ly = Math.round(y - p.y);
    return lx >= 0 && ly >= 0 && lx < p.width && ly < p.height && p.rgba[(ly * p.width + lx) * 4 + 3] >= 128;
  };
  for (const c of pieces) {
    const par = pieces.find((q) => q.name === c.parent);
    if (!par || !c.pivot || full(par, c.pivot.x, c.pivot.y)) continue;
    let best = null;
    // anelli crescenti fino al lato del pezzo (un "resto" come fumo+bocchino ha il centro lontano
    // dalla mano che lo regge): il primo pixel del genitore trovato, preferendo quelli in comune
    const R = Math.round(Math.max(c.width, c.height));
    for (let r = 1; r <= R && !best; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = c.pivot.x + dx, y = c.pivot.y + dy;
          if (!full(par, x, y)) continue;
          const both = full(c, x, y);
          const d = Math.hypot(dx, dy) - (both ? 0.5 : 0);
          if (!best || d < best.d) best = { x, y, d };
        }
    if (best) {
      warnings.push(`${c.name}: pivot spostato di ${best.d.toFixed(0)} px sul bordo di ${par.name} (raccordo).`);
      c.pivot = { x: best.x, y: best.y };
    }
  }
}

/**
 * @param {Object} o - { width, height, rgba, parts (mappa di recognizeParts), joints, landmarks }
 * @returns risultato nel formato di importExplodedSheet (pieces, warnings, usable...) + mode
 */
export function cutFromOriginal({ width, height, rgba, parts, joints, landmarks, reach = 0.25 }) {
  const ex = extractPieces({ width, height, rgba, parts, joints });
  const warnings = [...ex.warnings];
  let pieces = ex.pieces.map((p) => ({ ...p, area: p.pixels, matchError: 0 }));
  pieces = liftFace(pieces, landmarks, warnings);
  [...pieces].sort((a, b) => a.order - b.order).forEach((p, i) => (p.order = i));
  snapPivots(pieces, warnings);
  const u = underlayJoints(pieces, { reach });
  pieces = u.pieces.sort((a, b) => a.order - b.order);
  const rec = pieces.reduce((a, p) => a + (p.reconstructedPixels || 0), 0);
  return {
    pieces,
    mode: "original-cut",
    scale: 1,
    front: [],
    bg: null,
    warnings: [
      `Pezzi tagliati dall'originale (${ORIGINAL_CUT_VERSION}): parti visibili identiche all'originale; ${rec} pixel nascosti ricostruiti in bozza (propagazione dei colori), da far ridipingere all'AI nelle zone che si vedono in movimento.`,
      ...warnings
    ],
    fidelityError: 0,
    faithful: true,
    usable: true,
    assembly: null,
    piecesOk: true,
    pieceChecks: [],
    profileChecks: [],
    handObjects: [],
    finishing: { version: null, rules: [], changes: [] },
    selection: {
      version: ORIGINAL_CUT_VERSION,
      chosen: { mode: "original-cut", reach },
      reasons: [
        "Pezzi tagliati dall'ORIGINALE: posizione e misura esatte, nessun ridisegno.",
        u.changes.length ? `Sovrapposizione ai raccordi: ${u.changes.map((c) => `${c.into} sotto ${c.joint}`).join(", ")}.` : "Sovrapposizione ai raccordi: non necessaria."
      ],
      table: []
    }
  };
}
