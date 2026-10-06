// src/lib/sheetRegister.js — PEZZI DELLA TAVOLA RIMESSI SULL'ORIGINALE UNO PER UNO (6 ott 2026).
// Obiettivo: originale + tavola (anche ridisegnata da GPT, con pezzi in scale diverse) ->
// pezzi della tavola (nomi e divisione) nella POSIZIONE e MISURA dell'originale, con i pixel
// visibili dell'originale e le zone nascoste disegnate nella tavola.
//   1. ruoli dei pezzi dalla tavola (sheetSource.assembleFromSheet, rolesOnly);
//   2. per ogni pezzo una stima di scala e posizione dalle REGOLE + POSA:
//        testa = palpebre chiuse sugli occhi; occhi/sopracciglia/bocca = punti del viso;
//        guanti = mano sulla mano, lunghezza del braccio; vestito = altezza dalla scollatura ai
//        piedi; capelli = scala della testa, attorno alla testa;
//   3. rifinitura locale (scala ±20%, posizione) confrontando le CLASSI DI COLORE con l'originale
//      (pelle, capelli, viola, rosso...: robuste ai colori ritoccati da GPT);
//   4. pixel visibili dall'originale, zone nascoste dalla tavola (sheetAssembly.transplantOriginal);
//   5. pivot dal rig e sovrapposizione ai raccordi.
// Puro: nessun DOM.

import { assembleFromSheet, findClosedEyes, axisEnds, scaleNearest } from "./sheetSource.js";
import { colorClasses, nearestClass } from "./explodedSheet.js";
import { transplantOriginal, foregroundMask } from "./sheetAssembly.js";
import { snapPivots } from "./originalCut.js";

export const SHEET_REGISTER_VERSION = "2026-10-06.registra.1";

const centerOf = (p) => ({ x: p.x + p.width / 2, y: p.y + p.height / 2 });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Campioni (x, y, classe) dei pixel pieni di un pezzo. */
function samples(p, centers, n) {
  const all = [];
  for (let y = 0; y < p.height; y++)
    for (let x = 0; x < p.width; x++) {
      const i = (y * p.width + x) * 4;
      if (p.rgba[i + 3] >= 240) all.push([x, y, nearestClass(centers, p.rgba[i], p.rgba[i + 1], p.rgba[i + 2]), p.rgba[i], p.rgba[i + 1], p.rgba[i + 2]]);
    }
  if (all.length <= n) return all;
  return Array.from({ length: n }, (_, k) => all[Math.floor((k * all.length) / n)]);
}
// confronto TOLLERANTE: un pixel combacia se la classe è la stessa OPPURE il colore dista poco
// (GPT ritocca i toni: stessa pelle/capelli/rosso, sfumature diverse)
let ORIG = null;
function classErr(cls, W, H, smp, tx, ty) {
  let bad = 0;
  for (const [x, y, c, r, g, b] of smp) {
    const gx = tx + x, gy = ty + y;
    if (gx < 0 || gy < 0 || gx >= W || gy >= H) { bad++; continue; }
    const k = gy * W + gx;
    if (cls[k] === 255) { bad++; continue; } // sfondo
    if (cls[k] === c) continue;
    const o = ORIG.rgba, d = Math.abs(o[k * 4] - r) + Math.abs(o[k * 4 + 1] - g) + Math.abs(o[k * 4 + 2] - b);
    if (d > 110) bad++;
  }
  return (100 * bad) / Math.max(1, smp.length);
}

/**
 * Rifinitura: scale attorno a s0, centro entro r da c0. Ritorna il pezzo scalato e posizionato.
 * @param {Object} o - { s0, c0, r, sRange: [min,max], sStep }
 */
function refine(p, classes, { s0, c0, r, sRange = [0.82, 1.2], sStep = 0.04 }) {
  const { W, H, cls, centers } = classes;
  let best = null;
  for (let f = sRange[0]; f <= sRange[1] + 1e-9; f += sStep) {
    const s = s0 * f;
    const sp = Math.abs(s - 1) < 0.005 ? { width: p.width, height: p.height, rgba: p.rgba } : scaleNearest(p, s);
    const few = samples(sp, centers, 300);
    const cx0 = Math.round(c0.x - sp.width / 2), cy0 = Math.round(c0.y - sp.height / 2);
    for (let dy = -r; dy <= r; dy += 4)
      for (let dx = -r; dx <= r; dx += 4) {
        if (dx * dx + dy * dy > r * r) continue;
        const e = classErr(cls, W, H, few, cx0 + dx, cy0 + dy);
        if (!best || e < best.e) best = { e, s, sp, x: cx0 + dx, y: cy0 + dy };
      }
  }
  // rifinitura fine a 1 px con più campioni
  const many = samples(best.sp, centers, 3000);
  let fine = { e: Infinity };
  for (let dy = -4; dy <= 4; dy++)
    for (let dx = -4; dx <= 4; dx++) {
      const e = classErr(cls, W, H, many, best.x + dx, best.y + dy);
      if (e < fine.e) fine = { e, x: best.x + dx, y: best.y + dy };
    }
  return { ...best.sp, x: fine.x, y: fine.y, scale: +best.s.toFixed(3), classError: +fine.e.toFixed(1) };
}

/**
 * @param {Object} o - { sheet, original, landmarks, joints }
 * @returns {{ pieces, warnings, assembly, scales }} pezzi nel formato di importExplodedSheet
 */
export function registerSheetOnOriginal({ sheet, original, landmarks, joints }) {
  const warnings = [];
  const named = assembleFromSheet(sheet, { rolesOnly: true });
  warnings.push(...named.warnings);
  const classes = colorClasses(original, 12);
  ORIG = original;
  const L = (i) => (landmarks?.[i] && (landmarks[i].visibility ?? 1) > 0.3 && (landmarks[i].x || landmarks[i].y) ? landmarks[i] : null);
  const P = (n) => named.pieces.find((p) => p.name === n);
  const placed = new Map();
  const u = L(2) && L(5) ? dist(L(2), L(5)) : null;
  const eyeMid = u ? { x: (L(2).x + L(5).x) / 2, y: (L(2).y + L(5).y) / 2 } : null;

  // sagoma dell'originale (altezza, fondo)
  const fg = foregroundMask(original);
  let yTop = Infinity, yBot = -1;
  for (let i = 0; i < fg.length; i++) if (fg[i]) { const y = (i / original.width) | 0; yTop = Math.min(yTop, y); yBot = Math.max(yBot, y); }

  // TESTA: palpebre chiuse sugli occhi dell'originale
  const head = P("testa");
  let headScale = 1;
  if (head && u) {
    const lids = findClosedEyes(head);
    if (lids) {
      headScale = u / dist(lids.dx, lids.sx);
      const lm = { x: (lids.dx.x + lids.sx.x) / 2 - head.x, y: (lids.dx.y + lids.sx.y) / 2 - head.y }; // locale
      const c0 = { x: eyeMid.x - lm.x * headScale + (head.width * headScale) / 2, y: eyeMid.y - lm.y * headScale + (head.height * headScale) / 2 };
      placed.set(head, refine(head, classes, { s0: headScale, c0, r: Math.round(0.4 * u), sRange: [0.9, 1.1], sStep: 0.02 }));
      headScale = placed.get(head).scale;
    } else warnings.push("Registrazione: palpebre non trovate sulla testa, testa cercata per colori attorno al viso.");
  }
  if (head && !placed.has(head) && eyeMid) placed.set(head, refine(head, classes, { s0: 1, c0: { x: eyeMid.x, y: eyeMid.y + 0.8 * (u || 50) }, r: Math.round(2 * (u || 50)), sRange: [0.6, 1.6], sStep: 0.05 }));
  // VISO: scala dalla distanza fra gli occhi nella tavola
  const eD = P("occhio_dx"), eS = P("occhio_sx");
  const faceScale = u && eD && eS ? u / dist(centerOf(eD), centerOf(eS)) : headScale;
  const faceTargets = {
    occhio_dx: L(5), occhio_sx: L(2),
    sopracciglio_dx: L(5) && u ? { x: L(5).x, y: L(5).y - 0.45 * u } : null,
    sopracciglio_sx: L(2) && u ? { x: L(2).x, y: L(2).y - 0.45 * u } : null,
    bocca: L(9) && L(10) ? { x: (L(9).x + L(10).x) / 2, y: (L(9).y + L(10).y) / 2 } : null
  };
  for (const [name, t] of Object.entries(faceTargets)) {
    const p = P(name);
    if (p && t) placed.set(p, refine(p, classes, { s0: faceScale, c0: t, r: Math.round(0.3 * u), sRange: [0.85, 1.15], sStep: 0.05 }));
  }
  // GUANTI/BRACCIA: mano sulla mano dell'originale, lunghezza del braccio
  for (const [side, [S, E, Wr], hand] of [["dx", [12, 14, 16], joints?.mano_dx], ["sx", [11, 13, 15], joints?.mano_sx]]) {
    const p = P(`braccio_${side}`);
    if (!p) continue;
    const ax = axisEnds(p);
    const handPt = hand || L(Wr);
    if (!handPt || !L(E)) { warnings.push(`Registrazione: braccio_${side} senza punti della posa, cercato per colori.`); continue; }
    const want = (L(S) ? 0.5 * dist(L(S), L(E)) : 0) + 1.35 * dist(L(E), L(Wr) || handPt);
    const s0 = want / ax.length;
    // estremo della mano = quello più lontano dal corpo (dal centro della tavola del pezzo testa)
    const bodyX = head ? head.x + head.width / 2 : sheet.width / 2;
    const handEnd = Math.abs(ax.a.x - bodyX) > Math.abs(ax.b.x - bodyX) ? ax.a : ax.b;
    const local = { x: handEnd.x - p.x, y: handEnd.y - p.y };
    const c0 = { x: handPt.x - local.x * s0 + (p.width * s0) / 2, y: handPt.y - local.y * s0 + (p.height * s0) / 2 };
    placed.set(p, refine(p, classes, { s0, c0, r: Math.round(0.25 * want), sRange: [0.85, 1.2] }));
  }
  // VESTITO: aggancio alla scollatura della testa-busto GIÀ registrata (il vestito parte dove
  // finisce il petto) e fondo sul fondo della sagoma dell'originale -> scala e posizione
  const busto = P("busto");
  const hpl = placed.get(head);
  if (busto && hpl && yBot > 0) {
    const colBottom = (q, x) => { for (let y = q.height - 1; y >= 0; y--) if (q.rgba[(y * q.width + x) * 4 + 3] >= 128) return y; return null; };
    const colTop = (q, x) => { for (let y = 0; y < q.height; y++) if (q.rgba[(y * q.width + x) * 4 + 3] >= 128) return y; return null; };
    // scollatura: fondo della testa-busto sulle colonne centrali (mediana)
    const hb = [];
    for (let x = Math.round(0.35 * hpl.width); x < 0.65 * hpl.width; x++) { const v = colBottom(hpl, x); if (v !== null) hb.push(hpl.y + v); }
    hb.sort((a, b) => a - b);
    const neckY = hb[hb.length >> 1];
    const bt = [];
    for (let x = Math.round(0.35 * busto.width); x < 0.65 * busto.width; x++) { const v = colTop(busto, x); if (v !== null) bt.push(v); }
    bt.sort((a, b) => a - b);
    const topLocal = bt[bt.length >> 1];
    const OVER = Math.round(0.06 * hpl.height); // il vestito copre il bordo del petto (corsetto sopra la pelle)
    const s0 = (yBot - (neckY - OVER)) / (busto.height - topLocal);
    const cx = hpl.x + hpl.width / 2;
    const c0 = { x: cx, y: neckY - OVER - topLocal * s0 + (busto.height * s0) / 2 };
    const q = refine(busto, classes, { s0, c0, r: 12, sRange: [0.97, 1.03], sStep: 0.03 });
    placed.set(busto, q);
  } else if (busto && L(11) && L(12) && yBot > 0) {
    const top = Math.min(L(11).y, L(12).y);
    placed.set(busto, refine(busto, classes, { s0: (yBot - top) / busto.height, c0: { x: (L(11).x + L(12).x) / 2, y: (top + yBot) / 2 }, r: Math.round(0.08 * (yBot - top)), sRange: [0.85, 1.2] }));
  }
  // CAPELLI: scala della testa, attorno alla testa
  const hp = placed.get(head);
  for (const p of named.pieces.filter((q) => /^(capelli_dietro|ciocca|ciuffo)/.test(q.name))) {
    if (!hp) continue;
    const hc = centerOf(hp);
    const c0 = p.name === "capelli_dietro" ? { x: hc.x, y: hp.y + (p.height * headScale) / 2 } : /^ciocca_dx/.test(p.name) ? { x: hp.x + 0.15 * hp.width, y: hp.y + 0.55 * hp.height } : /^ciocca_sx/.test(p.name) ? { x: hp.x + 0.85 * hp.width, y: hp.y + 0.55 * hp.height } : { x: hp.x + 0.3 * hp.width, y: hp.y + 0.25 * hp.height };
    placed.set(p, refine(p, classes, { s0: headScale, c0, r: Math.round(0.35 * Math.max(hp.width, hp.height)), sRange: [0.85, 1.2] }));
  }
  // pezzi senza stima: ricerca ampia per colori
  for (const p of named.pieces) if (!placed.has(p)) {
    placed.set(p, refine(p, classes, { s0: 1, c0: { x: original.width / 2, y: original.height / 2 }, r: Math.round(0.5 * Math.max(original.width, original.height)), sRange: [0.7, 1.4], sStep: 0.1 }));
    warnings.push(`Registrazione: ${p.name} senza regola di posizione, cercato su tutta l'immagine (controlla).`);
  }

  let pieces = named.pieces.map((p) => {
    const q = placed.get(p);
    return { name: p.name, order: p.order, x: q.x, y: q.y, width: q.width, height: q.height, rgba: q.rgba, area: p.area, scale: q.scale, classError: q.classError, matchError: q.classError };
  });
  const scales = Object.fromEntries(pieces.map((p) => [p.name, p.scale]));
  for (const p of pieces) if (p.classError > 45) warnings.push(`${p.name}: combacia poco con l'originale (classi diverse ${p.classError}%): forma ridisegnata, controlla.`);

  // pixel visibili dall'originale, zone nascoste dalla tavola
  const t = transplantOriginal(pieces, original);
  pieces = t.pieces;
  if (t.rest.length) pieces.push(...t.rest);
  // rig: genitori e pivot
  const byName = (n) => pieces.find((p) => p.name === n);
  for (const p of pieces) {
    if (p.attachTo && !p.parent) p.parent = p.attachTo;
    if (p.name === "busto") { p.parent = null; p.pivot = { x: Math.round(p.x + p.width / 2), y: p.y + p.height }; continue; }
    if (p.name === "testa") { p.parent = "busto"; const n = joints?.base_collo; p.pivot = n ? { x: Math.round(n.x), y: Math.round(n.y) } : { x: Math.round(p.x + p.width / 2), y: p.y + p.height }; continue; }
    if (/^braccio_/.test(p.name)) {
      p.parent = "busto";
      const side = p.name.slice(-2), ax = axisEnds(p), hand = joints?.[`mano_${side}`] || L(side === "dx" ? 16 : 15);
      const att = hand && dist(ax.a, hand) > dist(ax.b, hand) ? ax.a : ax.b;
      p.pivot = { x: Math.round(att.x), y: Math.round(att.y) };
      continue;
    }
    if (/^(capelli_dietro|ciocca|ciuffo|occhio|sopracciglio|bocca)/.test(p.name)) p.parent = "testa";
    if (!p.parent) p.parent = byName("busto") ? "busto" : null;
    if (!p.pivot) p.pivot = /^(capelli_dietro|ciocca|ciuffo)/.test(p.name) ? { x: Math.round(p.x + p.width / 2), y: p.y + Math.round(0.04 * p.height) } : { x: Math.round(p.x + p.width / 2), y: Math.round(p.y + p.height / 2) };
  }
  [...pieces].sort((a, b) => a.order - b.order).forEach((p, i) => (p.order = i));
  snapPivots(pieces, warnings);
  return { pieces, warnings, scales, assembly: { iou: +t.iou.toFixed(3), holeShare: +t.holeShare.toFixed(4), filledShare: +t.filledShare.toFixed(4) } };
}
