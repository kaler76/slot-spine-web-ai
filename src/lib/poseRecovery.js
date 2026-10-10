// Coordinates normalized to image dimensions; anatomical left/right (not viewer).
export const REQUIRED_POINTS = [0, 7, 8, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24];
export function validatePose(points) {
  if (!Array.isArray(points) || points.length !== 33) throw new Error('pose_shape');
  for (const i of REQUIRED_POINTS) {
    const p = points[i];
    if (!p || ![p.x, p.y, p.visibility].every(Number.isFinite) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1 || p.visibility < 0.5 || p.visibility > 1) throw new Error('pose_point');
  }
  const d = (a,b) => Math.hypot(points[a].x-points[b].x,points[a].y-points[b].y);
  if (d(11,12)<0.035 || d(23,24)<0.015 || d(11,23)<0.05 || d(12,24)<0.05) throw new Error('pose_collapsed');
  for (const [a,b] of [[11,13],[13,15],[12,14],[14,16]]) if(d(a,b)<0.01 || d(a,b)>0.7) throw new Error('pose_limb');
  return points;
}
export function validateRecovery(data) {
  validatePose(data?.landmarks);
  if (!Number.isFinite(data.confidence) || data.confidence < 0.7 || data.confidence > 1) throw new Error('pose_confidence');
  if (!Array.isArray(data.heldObjects) || data.heldObjects.length>4) throw new Error('pose_objects');
  for (const o of data.heldObjects) {
    if (typeof o.label!=='string' || o.label.length>100 || !Array.isArray(o.hands) || !o.hands.length || new Set(o.hands).size!==o.hands.length || o.hands.some(h=>!['left','right'].includes(h))) throw new Error('pose_grip');
  }
  return data;
}
/**
 * Posa di MediaPipe su un'ILLUSTRAZIONE (caso reale: donna in abito lungo, figura nitida, posa
 * rifiutata -> 9 click a mano). validatePose è pensato per il server e scarta tutto se un dito o
 * un'anca ha visibilità < 0.5: sotto un abito o un guanto succede sempre. Qui, solo per MediaPipe:
 *  - obbligatori: naso, spalle, gomiti, polsi (visibilità >= 0.3) e anche (>= 0.05: coperte dalla
 *    gonna, la posizione stimata resta buona);
 *  - dita poco visibili o mancanti: ricostruite oltre il polso lungo l'avambraccio;
 *  - stessi controlli geometrici di validatePose (spalle, busto, braccia non collassati).
 * Coordinate normalizzate 0..1 (tolleranza 5% fuori dall'immagine).
 */
export const POSE_CORE = [0, 11, 12, 13, 14, 15, 16];
export function acceptDetectedPose(points) {
  if (!Array.isArray(points) || points.length !== 33) throw new Error('pose_shape');
  const ok = (p, v) => p && [p.x, p.y].every(Number.isFinite) && p.x > -0.05 && p.x < 1.05 && p.y > -0.05 && p.y < 1.05 && (p.visibility ?? 1) >= v;
  // MEZZO BUSTO (10 ott, Rita: ritratto tagliato al petto, braccio sotto la pelliccia): anche SOTTO l'immagine
  // (stimate da MediaPipe fuori quadro). Allora gomiti e polsi nascosti o fuori quadro non fanno scartare la posa:
  // si usano se plausibili, altrimenti si stimano in giù dalla spalla. Con le anche dentro l'immagine nulla cambia.
  const fin = (p) => p && [p.x, p.y].every(Number.isFinite);
  const bust = [11, 12].every((i) => ok(points[i], 0.3)) && ok(points[0], 0.3) &&
    [23, 24].every((i) => !fin(points[i]) || points[i].y > 0.97);
  if (bust) points = bustPose(points);
  // a mezzo busto gomiti e polsi possono stare sotto il bordo (stimati o fuori quadro)
  for (const i of POSE_CORE) if (!(bust && i >= 13 ? fin(points[i]) && points[i].visibility >= 0.3 : ok(points[i], 0.3))) throw new Error('pose_point');
  for (const i of [23, 24]) if (!(bust ? fin(points[i]) : ok(points[i], 0.05))) throw new Error('pose_point');
  const P = points.map((p) => (p ? { ...p, visibility: p.visibility ?? 1 } : p));
  const d = (a, b) => Math.hypot(P[a].x - P[b].x, P[a].y - P[b].y);
  if (d(11, 12) < 0.035 || d(23, 24) < 0.015 || d(11, 23) < 0.05 || d(12, 24) < 0.05) throw new Error('pose_collapsed');
  for (const [a, b] of [[11, 13], [13, 15], [12, 14], [14, 16]]) if (d(a, b) < 0.01 || d(a, b) > 0.7) throw new Error('pose_limb');
  const sw = d(11, 12);
  for (const [w, e, fingers] of [[15, 13, [17, 19, 21]], [16, 14, [18, 20, 22]]]) {
    const len = d(w, e) || 1, dx = (P[w].x - P[e].x) / len, dy = (P[w].y - P[e].y) / len;
    fingers.forEach((f, k) => {
      if (ok(P[f], 0.3)) return;
      const off = [0.05, 0, -0.06][k], ahead = [0.14, 0.16, 0.1][k];
      P[f] = { x: P[w].x + dx * ahead * sw - dy * off * sw, y: P[w].y + dy * ahead * sw + dx * off * sw, visibility: 0.3 };
    });
  }
  return P;
}

/** Posa a mezzo busto: anche sotto le spalle se mancano; gomiti e polsi non attendibili stimati lungo il fianco. */
export function bustPose(points) {
  const P = points.map((p) => (p ? { ...p } : p));
  const fin = (p) => p && [p.x, p.y].every(Number.isFinite);
  const sx = P[11], dx = P[12], sw = Math.hypot(sx.x - dx.x, sx.y - dx.y) || 0.1;
  // "giù" = perpendicolare alla linea delle spalle, verso il basso dell'immagine
  let ux = -(sx.y - dx.y) / sw, uy = (sx.x - dx.x) / sw;
  if (uy < 0) { ux = -ux; uy = -uy; }
  const inX = (sx.x - dx.x) / sw, inY = (sx.y - dx.y) / sw; // verso la spalla sinistra del personaggio
  for (const [h, sh, k] of [[23, sx, -0.1], [24, dx, 0.1]]) {
    if (fin(P[h]) && P[h].y > sh.y + 0.5 * sw * uy && P[h].y < 3) continue;
    P[h] = { x: sh.x + ux * 1.5 * sw + inX * k * sw, y: sh.y + uy * 1.5 * sw + inY * k * sw, visibility: 0.05 };
  }
  for (const [sh, e, w] of [[11, 13, 15], [12, 14, 16]]) {
    const S = P[sh], good = (p, v) => fin(p) && (p.visibility ?? 1) >= v && p.x > -0.5 && p.x < 1.5 && p.y > -0.5 && p.y < 2.5;
    // visibile (≥ 0,3) e a una distanza da braccio: si tiene; nascosto o fuori misura: stimato in giù
    const ok = (i, from) => good(P[i], 0.3) && Math.hypot(P[i].x - from.x, P[i].y - from.y) / sw > 0.3 && Math.hypot(P[i].x - from.x, P[i].y - from.y) / sw < 2;
    if (!ok(e, S)) P[e] = { x: S.x + ux * 0.9 * sw, y: S.y + uy * 0.9 * sw, visibility: 0.3 };
    if (!ok(w, P[e])) P[w] = { x: P[e].x + ux * 0.8 * sw, y: P[e].y + uy * 0.8 * sw, visibility: 0.3 };
  }
  return P;
}

export async function resolvePose({ detect, recover, width, height }) {
  let points;
  try { points=acceptDetectedPose((await detect())?.landmarks?.[0]); } catch { /* Recover once, server bounds its own retries. */ }
  let source='mediapipe', heldObjects=[];
  if (!points) {
    const result=validateRecovery(await recover());
    points=result.landmarks; heldObjects=result.heldObjects; source='vision';
  }
  return { source, heldObjects, landmarks:points.map(p=>({x:p.x*width,y:p.y*height,visibility:p.visibility??0})) };
}

// ---------------------------------------------------------------- posa manuale (gratuita)
/** I 9 punti che l'utente clicca quando la posa non si ricava in automatico. sx/dx = lato del PERSONAGGIO. */
/** Punti che si possono dichiarare "fuori dall'immagine / nascosti" nella posa manuale. */
export const OUTSIDE_OK = new Set(["elbowSx", "elbowDx", "wristSx", "wristDx", "hipSx", "hipDx"]);
export const MANUAL_POINTS = [
  { key: "nose", index: 0, label: "Centro del viso (naso, o centro della visiera)" },
  { key: "shoulderSx", index: 11, label: "Spalla SINISTRA del personaggio (a destra per chi guarda)" },
  { key: "shoulderDx", index: 12, label: "Spalla DESTRA del personaggio (a sinistra per chi guarda)" },
  { key: "elbowSx", index: 13, label: "Gomito SINISTRO del personaggio" },
  { key: "elbowDx", index: 14, label: "Gomito DESTRO del personaggio" },
  { key: "wristSx", index: 15, label: "Polso SINISTRO del personaggio" },
  { key: "wristDx", index: 16, label: "Polso DESTRO del personaggio" },
  { key: "hipSx", index: 23, label: "Anca SINISTRA del personaggio" },
  { key: "hipDx", index: 24, label: "Anca DESTRA del personaggio" }
];

/**
 * Dai 9 punti cliccati (pixel) ai 33 landmark nel formato MediaPipe (pixel). I punti cliccati
 * hanno visibilità 0.95; quelli ricavati (orecchie, occhi, bocca, dita, gambe) 0.4: servono solo
 * come stima per le regole, non come misura.
 */
export function landmarksFromClicks(clicks) {
  // punti "fuori dall'immagine" (mezzo busto: anche sotto il bordo, braccio sotto la pelliccia): { outside: true },
  // stimati in giù dalla spalla come bustPose
  const P = { ...clicks };
  for (const p of MANUAL_POINTS) {
    const c = P[p.key];
    if (c?.outside && OUTSIDE_OK.has(p.key)) continue;
    if (!c || !Number.isFinite(c.x) || !Number.isFinite(c.y)) throw new Error(`Punto mancante: ${p.label}`);
  }
  {
    const sx = P.shoulderSx, dx = P.shoulderDx, sw0 = Math.hypot(sx.x - dx.x, sx.y - dx.y) || 1;
    let ux = -(sx.y - dx.y) / sw0, uy = (sx.x - dx.x) / sw0;
    if (uy < 0) { ux = -ux; uy = -uy; }
    const inX = (sx.x - dx.x) / sw0, inY = (sx.y - dx.y) / sw0;
    const down = (q, f, k = 0) => ({ x: q.x + ux * f * sw0 + inX * k * sw0, y: q.y + uy * f * sw0 + inY * k * sw0 });
    for (const s of ["Sx", "Dx"]) {
      if (P[`elbow${s}`]?.outside) P[`elbow${s}`] = down(P[`shoulder${s}`], 0.9);
      if (P[`wrist${s}`]?.outside) P[`wrist${s}`] = down(P[`elbow${s}`], 0.8);
      if (P[`hip${s}`]?.outside) P[`hip${s}`] = down(P[`shoulder${s}`], 1.5, s === "Sx" ? -0.1 : 0.1);
    }
  }
  const sw = Math.hypot(P.shoulderSx.x - P.shoulderDx.x, P.shoulderSx.y - P.shoulderDx.y) || 1;
  const L = Array.from({ length: 33 }, () => null);
  const set = (i, x, y, v) => (L[i] = { x, y, visibility: v });
  for (const p of MANUAL_POINTS) set(p.index, P[p.key].x, P[p.key].y, 0.95);
  // verso "sinistra del personaggio" (dalla spalla dx alla sx), per orecchie e occhi
  const ux = (P.shoulderSx.x - P.shoulderDx.x) / sw, uy = (P.shoulderSx.y - P.shoulderDx.y) / sw;
  const n = P.nose;
  const side = (k, up) => ({ x: n.x + ux * k * sw - uy * up * sw, y: n.y + uy * k * sw + ux * up * sw });
  const e = side(0.12, 0.08), ed = side(-0.12, 0.08);
  set(1, (n.x + e.x) / 2, e.y, 0.4); set(2, e.x, e.y, 0.4); set(3, e.x + ux * 0.04 * sw, e.y, 0.4);
  set(4, (n.x + ed.x) / 2, ed.y, 0.4); set(5, ed.x, ed.y, 0.4); set(6, ed.x - ux * 0.04 * sw, ed.y, 0.4);
  const ear = side(0.28, 0.05), eard = side(-0.28, 0.05);
  set(7, ear.x, ear.y, 0.4); set(8, eard.x, eard.y, 0.4);
  const m = side(0.06, -0.12), md = side(-0.06, -0.12);
  set(9, m.x, m.y, 0.4); set(10, md.x, md.y, 0.4);
  // dita: oltre il polso, nella direzione dell'avambraccio
  for (const [s, pinky, index, thumb] of [["Sx", 17, 19, 21], ["Dx", 18, 20, 22]]) {
    const W = P[`wrist${s}`], E = P[`elbow${s}`];
    const len = Math.hypot(W.x - E.x, W.y - E.y) || 1;
    const dx = (W.x - E.x) / len, dy = (W.y - E.y) / len;
    const at = (f, off) => ({ x: W.x + dx * f * sw - dy * off * sw, y: W.y + dy * f * sw + dx * off * sw });
    const a = at(0.14, 0.05), b = at(0.16, 0), c = at(0.1, -0.06);
    set(pinky, a.x, a.y, 0.4); set(index, b.x, b.y, 0.4); set(thumb, c.x, c.y, 0.4);
  }
  // gambe: in giù dalle anche, proporzioni medie (ginocchio 0.9, caviglia 1.8 spalle)
  for (const [h, k, a, heel, foot] of [[23, 25, 27, 29, 31], [24, 26, 28, 30, 32]]) {
    const H = L[h];
    set(k, H.x, H.y + 0.9 * sw, 0.4);
    set(a, H.x, H.y + 1.8 * sw, 0.4);
    set(heel, H.x, H.y + 1.9 * sw, 0.4);
    set(foot, H.x, H.y + 1.95 * sw, 0.4);
  }
  return L;
}
