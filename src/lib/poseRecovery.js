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
export async function resolvePose({ detect, recover, width, height }) {
  let points;
  try { points=validatePose((await detect())?.landmarks?.[0]); } catch { /* Recover once, server bounds its own retries. */ }
  let source='mediapipe', heldObjects=[];
  if (!points) {
    const result=validateRecovery(await recover());
    points=result.landmarks; heldObjects=result.heldObjects; source='vision';
  }
  return { source, heldObjects, landmarks:points.map(p=>({x:p.x*width,y:p.y*height,visibility:p.visibility??0})) };
}

// ---------------------------------------------------------------- posa manuale (gratuita)
/** I 9 punti che l'utente clicca quando la posa non si ricava in automatico. sx/dx = lato del PERSONAGGIO. */
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
  for (const p of MANUAL_POINTS) {
    const c = clicks[p.key];
    if (!c || !Number.isFinite(c.x) || !Number.isFinite(c.y)) throw new Error(`Punto mancante: ${p.label}`);
  }
  const P = clicks;
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
