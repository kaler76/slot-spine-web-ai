// src/lib/partRecognition.js — riconoscimento automatico delle parti da UNA immagine
// del personaggio intero (niente parti già separate, niente contorni disegnati a mano).
// Combina due segnali prodotti da modelli MediaPipe (vedi pages/RecognizePage.jsx):
//  - la POSA: punti 2D di spalle, gomiti, polsi, mani, naso, orecchie, anche;
//  - la SEGMENTAZIONE per categorie (selfie multiclass): sfondo, capelli, pelle del
//    corpo, pelle del viso, vestiti, accessori.
// Da questi ricava, con regole geometriche esplicite, una proposta di parti per il rig
// (testa, cappello, busto, braccio/avambraccio per lato, oggetto tenuto in mano) e i
// punti delle articolazioni da usare come pivot. Tutto puro e testabile: nessun DOM.

/** Categorie del modello selfie_multiclass_256x256 (MediaPipe). */
export const SEG = { background: 0, hair: 1, bodySkin: 2, faceSkin: 3, clothes: 4, others: 5 };
export const SEG_LABELS = ["sfondo", "capelli", "pelle corpo", "pelle viso", "vestiti", "accessori"];

/** Etichette delle parti proposte (indice nella maschera delle parti). */
export const PARTS = ["—", "busto", "testa", "cappello", "braccio_sx", "avambraccio_sx", "braccio_dx", "avambraccio_dx", "oggetto_in_mano"];
export const PART = Object.fromEntries(PARTS.map((p, i) => [p, i]));

/** Indici dei landmark di MediaPipe Pose (33 punti). "sx/dx" = lato del PERSONAGGIO. */
export const LM = {
  nose: 0, earSx: 7, earDx: 8,
  shoulderSx: 11, shoulderDx: 12, elbowSx: 13, elbowDx: 14, wristSx: 15, wristDx: 16,
  pinkySx: 17, pinkyDx: 18, indexSx: 19, indexDx: 20, thumbSx: 21, thumbDx: 22,
  hipSx: 23, hipDx: 24
};

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Distanza con segno dalla linea spalla→anca: positiva verso l'esterno del corpo (lato del braccio). */
function outerSide(x, y, a) {
  const vx = a.hip.x - a.s.x, vy = a.hip.y - a.s.y;
  const len = Math.hypot(vx, vy) || 1;
  let nx = -vy / len, ny = vx / len;            // normale alla linea
  if (nx * a.outward.x + ny * a.outward.y < 0) { nx = -nx; ny = -ny; } // orientata verso l'esterno
  return (x - a.s.x) * nx + (y - a.s.y) * ny;
}
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Distanza del punto p dal segmento ab. */
function segDist(px, py, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y;
  const len2 = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, ((px - a.x) * vx + (py - a.y) * vy) / len2));
  return Math.hypot(px - (a.x + t * vx), py - (a.y + t * vy));
}

/**
 * @param {Object} input
 * @param {number} input.width
 * @param {number} input.height
 * @param {Array<{x:number,y:number,visibility?:number}>} input.landmarks - 33 punti in PIXEL dell'immagine
 * @param {Uint8Array} input.categories - categoria per pixel (SEG), width*height
 * @param {Uint8Array} [input.alpha] - se l'immagine ha trasparenza: primo piano = alpha>=128 (più affidabile della segmentazione)
 * @param {Uint8ClampedArray} [input.rgba] - pixel RGBA: usati per estendere la mano alle dita (colore del guanto/pelle)
 * @returns {{ parts: Uint8Array, joints: Object, stats: Object, warnings: string[] }}
 */
export function recognizeParts({ width: W, height: H, landmarks, categories, alpha, rgba }) {
  const warnings = [];
  const P = (i) => landmarks[i];
  const sSx = P(LM.shoulderSx), sDx = P(LM.shoulderDx);
  const shoulderW = Math.max(1, dist(sSx, sDx));
  const shoulderMid = mid(sSx, sDx);
  // base del collo: punto più basso della pelle (collo) sopra le spalle, al centro;
  // se la segmentazione non la trova, stima dalla larghezza delle spalle
  let neckY = -1;
  const band = Math.max(2, Math.round(0.08 * shoulderW));
  for (let y = Math.min(H - 1, Math.round(shoulderMid.y)); y >= 0 && neckY < 0; y--)
    for (let x = Math.max(0, Math.round(shoulderMid.x - band)); x <= Math.min(W - 1, Math.round(shoulderMid.x + band)); x++) {
      const c = categories[y * W + x];
      if (c === SEG.bodySkin || c === SEG.faceSkin) {
        neckY = y;
        break;
      }
    }
  const neckBase = { x: shoulderMid.x, y: neckY > shoulderMid.y - 0.6 * shoulderW ? neckY : shoulderMid.y - 0.12 * shoulderW };

  const fg = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) fg[i] = alpha ? (alpha[i] >= 128 ? 1 : 0) : categories[i] !== SEG.background ? 1 : 0;

  // --- testa: pixel di viso/capelli (e pelle sopra la base del collo), cappello = vestiti/accessori sopra il viso
  let faceTop = H, faceBottom = 0, faceMinX = W, faceMaxX = 0, faceCount = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (fg[i] && categories[i] === SEG.faceSkin && y < shoulderMid.y) {
        faceCount++;
        if (y < faceTop) faceTop = y;
        if (y > faceBottom) faceBottom = y;
        if (x < faceMinX) faceMinX = x;
        if (x > faceMaxX) faceMaxX = x;
      }
    }
  if (!faceCount) {
    warnings.push("Viso non trovato dalla segmentazione: testa stimata solo dalla posa.");
    const head = P(LM.nose);
    faceTop = head.y - 0.45 * shoulderW;
    faceBottom = head.y + 0.25 * shoulderW;
    faceMinX = head.x - 0.35 * shoulderW;
    faceMaxX = head.x + 0.35 * shoulderW;
  }
  const faceW = Math.max(1, faceMaxX - faceMinX);
  const headMinX = faceMinX - 0.6 * faceW;
  const headMaxX = faceMaxX + 0.6 * faceW;

  // --- capsule degli arti (raggi proporzionali alla larghezza delle spalle)
  const R_UPPER = 0.2 * shoulderW;
  const R_FORE = 0.18 * shoulderW;
  const arms = ["Sx", "Dx"].map((side) => {
    const s = P(LM[`shoulder${side}`]), e = P(LM[`elbow${side}`]), w = P(LM[`wrist${side}`]);
    const handPts = [w, P(LM[`pinky${side}`]), P(LM[`index${side}`]), P(LM[`thumb${side}`])];
    const hand = { x: handPts.reduce((a, p) => a + p.x, 0) / 4, y: handPts.reduce((a, p) => a + p.y, 0) / 4 };
    // raggio "sicuro" dai punti della posa (nocche) + raggio esteso per le dita, valido solo per pixel
    // del colore della mano (guanto/pelle) e fuori dal busto: così non si mangia il busto né l'oggetto impugnato
    const handR = Math.max(0.18 * shoulderW, ...handPts.map((p) => dist(p, hand) * 1.6));
    const handRExt = 0.42 * shoulderW;
    let handColor = null;
    if (rgba) {
      let r = 0, g = 0, b = 0, n = 0;
      const rr = Math.max(4, handR * 0.6);
      for (let y = Math.max(0, Math.floor(hand.y - rr)); y <= Math.min(H - 1, hand.y + rr); y++)
        for (let x = Math.max(0, Math.floor(hand.x - rr)); x <= Math.min(W - 1, hand.x + rr); x++) {
          const i = y * W + x;
          if (Math.hypot(x - hand.x, y - hand.y) > rr || !(alpha ? alpha[i] >= 128 : categories[i] !== SEG.background)) continue;
          r += rgba[i * 4]; g += rgba[i * 4 + 1]; b += rgba[i * 4 + 2]; n++;
        }
      if (n) handColor = [r / n, g / n, b / n];
    }
    const vis = Math.min(s.visibility ?? 1, e.visibility ?? 1, w.visibility ?? 1);
    const hip = P(LM[`hip${side}`]);
    // verso "esterno" del corpo: dalla spalla opposta a questa spalla
    const other = P(LM[side === "Sx" ? "shoulderDx" : "shoulderSx"]);
    const outward = { x: s.x - other.x, y: s.y - other.y };
    return { side: side.toLowerCase(), s, e, w, hand, handR, handRExt, handColor, vis, hip, outward };
  });
  for (const a of arms) if (a.vis < 0.5) warnings.push(`Braccio ${a.side}: posa poco affidabile (visibilità ${a.vis.toFixed(2)}).`);

  // --- busto "nucleo": quadrilatero spalle-anche, serve a distinguere oggetti lontani dal corpo
  const hSx = P(LM.hipSx), hDx = P(LM.hipDx);
  const torsoMinX = Math.min(sSx.x, sDx.x, hSx.x, hDx.x) - 0.1 * shoulderW;
  const torsoMaxX = Math.max(sSx.x, sDx.x, hSx.x, hDx.x) + 0.1 * shoulderW;

  const parts = new Uint8Array(W * H);
  const outside = new Uint8Array(W * H);
  const counts = new Array(PARTS.length).fill(0);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!fg[i]) continue;
      const c = categories[i];
      let label = PART.busto;

      const inHeadBand = x >= headMinX && x <= headMaxX && y < neckBase.y;
      if (inHeadBand) {
        const hatLimitY = Math.max(P(LM.nose).y, Math.min(P(LM.earSx).y, P(LM.earDx).y));
        if ((c === SEG.others && y < hatLimitY) || (c === SEG.clothes && y < faceTop + 0.15 * faceW)) label = PART.cappello;
        else if (y > faceBottom && c !== SEG.bodySkin && c !== SEG.faceSkin && c !== SEG.hair) label = PART.busto; // colletto/giacca sotto il mento
        else label = PART.testa;
      } else {
        // arti: mano/avambraccio prima del braccio (sono davanti)
        let best = null;
        for (const a of arms) {
          if (a.vis < 0.3) continue;
          const dHand = Math.hypot(x - a.hand.x, y - a.hand.y);
          const dFore = segDist(x, y, a.e, a.w);
          const dUp = segDist(x, y, a.s, a.e);
          const inTorso = x >= torsoMinX && x <= torsoMaxX && y > neckBase.y;
          const sameColor =
            a.handColor && rgba
              ? Math.hypot(rgba[i * 4] - a.handColor[0], rgba[i * 4 + 1] - a.handColor[1], rgba[i * 4 + 2] - a.handColor[2]) < 70
              : false;
          if (dHand <= a.handR || dFore <= R_FORE || (!inTorso && sameColor && dHand <= a.handRExt)) {
            const d = Math.min(dHand / a.handR, dFore / R_FORE);
            if (!best || d < best.d) best = { d, label: PART[`avambraccio_${a.side}`] };
          } else if (dUp <= R_UPPER && y > a.s.y - 0.1 * shoulderW && outerSide(x, y, a) > -0.04 * shoulderW) {
            const d = dUp / R_UPPER + 1; // priorità più bassa della mano/avambraccio
            if (!best || d < best.d) best = { d, label: PART[`braccio_${a.side}`] };
          }
        }
        if (best) label = best.label;
        else if (x < torsoMinX || x > torsoMaxX || y < neckBase.y) outside[i] = 1; // candidato "oggetto", deciso dopo
      }
      parts[i] = label;
    }

  // Oggetto tenuto in mano = componente connessa dei pixel "fuori dal corpo" che tocca una mano.
  // (Non una distanza fissa dalla mano: un cerchio da giocoliere o un bastone lungo si allontanano molto.)
  const queue = [];
  for (const a of arms) {
    if (a.vis < 0.3) continue;
    const r = a.handR * 1.3;
    for (let y = Math.max(0, Math.floor(a.hand.y - r)); y <= Math.min(H - 1, Math.ceil(a.hand.y + r)); y++)
      for (let x = Math.max(0, Math.floor(a.hand.x - r)); x <= Math.min(W - 1, Math.ceil(a.hand.x + r)); x++) {
        const i = y * W + x;
        if (outside[i] && Math.hypot(x - a.hand.x, y - a.hand.y) <= r) {
          outside[i] = 2;
          queue.push(i);
        }
      }
  }
  while (queue.length) {
    const i = queue.pop();
    parts[i] = PART.oggetto_in_mano;
    const x = i % W, y = (i - x) / W;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (outside[j] === 1) {
        outside[j] = 2;
        queue.push(j);
      }
    }
  }
  for (let i = 0; i < W * H; i++) if (fg[i]) counts[parts[i]]++;

  const joints = {
    base_collo: neckBase,
    spalla_sx: sSx, gomito_sx: arms[0].e, polso_sx: arms[0].w,
    spalla_dx: sDx, gomito_dx: arms[1].e, polso_dx: arms[1].w,
    mano_sx: arms[0].hand, mano_dx: arms[1].hand
  };
  const stats = Object.fromEntries(PARTS.map((p, i) => [p, counts[i]]).filter(([p, n]) => p !== "—" && n > 0));
  return { parts, joints, stats, warnings };
}
