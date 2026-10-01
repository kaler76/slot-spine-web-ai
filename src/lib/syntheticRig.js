// src/lib/syntheticRig.js — personaggi SINTETICI con coordinate perfette, senza grafica vera.
// Servono a collaudare (e in futuro addestrare) le regole geometriche su migliaia di casi:
// pose casuali, braccia alzate o abbassate, oggetto in una mano o nessuno, scale diverse.
// Ogni personaggio porta con sé la "verità": nomi dei pezzi, genitori, pivot, posa (33 punti
// MediaPipe), così un test confronta il risultato delle regole con la risposta esatta.
// Le sagome sono maschere semplici (capsule, cerchi, rettangoli) nel formato dei pezzi di
// explodedSheet.js (rgba con alpha). Pensato per crescere: occhi, bocca, capelli, mesh.
// Puro e deterministico (seme): nessun DOM.

/** Generatore pseudo-casuale con seme (mulberry32): stessi numeri a ogni esecuzione. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const segDist = (px, py, a, b) => {
  const vx = b.x - a.x, vy = b.y - a.y;
  const l2 = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, ((px - a.x) * vx + (py - a.y) * vy) / l2));
  return Math.hypot(px - (a.x + t * vx), py - (a.y + t * vy));
};

/** Pezzo dalla funzione "dentro la sagoma" (coordinate immagine), ritagliato al suo riquadro. */
function pieceFromShape(inside, box) {
  const x0 = Math.floor(box.minX), y0 = Math.floor(box.minY);
  const w = Math.ceil(box.maxX) - x0 + 1, h = Math.ceil(box.maxY) - y0 + 1;
  const rgba = new Uint8ClampedArray(w * h * 4);
  let area = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (inside(x + x0, y + y0)) {
        const i = (y * w + x) * 4;
        rgba[i] = 180; rgba[i + 1] = 120; rgba[i + 2] = 80; rgba[i + 3] = 255;
        area++;
      }
  return { x: x0, y: y0, width: w, height: h, rgba, area };
}

/**
 * Un personaggio sintetico frontale.
 * @param {number} seed
 * @param {Object} [opt] - forza alcune scelte: { raised: 'sx'|'dx'|'both'|'none', object: 'sx'|'dx'|null }
 * @returns {{ width, height, landmarks, pieces, truth }}
 */
export function makeSyntheticCharacter(seed, opt = {}) {
  const R = rng(seed);
  const between = (a, b) => a + (b - a) * R();
  const W = 400, H = 620;
  const cx = between(180, 220);
  const tw = between(80, 120); // larghezza spalle
  const th = between(140, 180); // altezza busto (spalle -> anche)
  const hipY = between(360, 400);
  const shY = hipY - th;
  const neck = { x: cx, y: shY - 6 };
  const hr = between(32, 48); // raggio testa
  const head = { x: cx + between(-6, 6), y: neck.y - hr * 0.9 };
  const nose = { x: head.x, y: head.y + hr * 0.1 };

  // sx = lato SINISTRO del personaggio = destra per chi guarda (x maggiore)
  const shoulder = { sx: { x: cx + tw / 2, y: shY }, dx: { x: cx - tw / 2, y: shY } };
  const hip = { sx: { x: cx + tw * 0.25, y: hipY }, dx: { x: cx - tw * 0.25, y: hipY } };
  const raisedMode = opt.raised ?? ["none", "sx", "dx", "both"][Math.floor(R() * 4)];
  const arms = {};
  for (const side of ["sx", "dx"]) {
    const out = side === "sx" ? 1 : -1; // verso l'esterno
    const raised = raisedMode === "both" || raisedMode === side;
    // angolo del braccio dall'orizzontale verso l'esterno: giù 50..110°, su -110..-30°
    const a1 = ((raised ? between(-110, -30) : between(50, 110)) * Math.PI) / 180;
    const a2 = a1 + ((raised ? between(-50, 10) : between(-20, 50)) * Math.PI) / 180;
    const ua = between(55, 70), fa = between(50, 65);
    const s = shoulder[side];
    const e = { x: s.x + out * Math.cos(a1) * ua, y: s.y + Math.sin(a1) * ua };
    const w = { x: e.x + out * Math.cos(a2) * fa, y: e.y + Math.sin(a2) * fa };
    arms[side] = { s, e, w, raised, rUp: 13, rFore: 11, rHand: 13 };
  }
  const objectSide = opt.object !== undefined ? opt.object : R() < 0.5 ? (R() < 0.5 ? "sx" : "dx") : null;

  // pose MediaPipe (33 punti, pixel)
  const L = Array.from({ length: 33 }, () => ({ x: cx, y: hipY + 200, visibility: 0.3 }));
  const set = (i, p, v = 0.95) => (L[i] = { x: p.x, y: p.y, visibility: v });
  set(0, nose);
  for (const i of [1, 2, 3]) set(i, { x: head.x + hr * 0.3, y: head.y - hr * 0.15 }, 0.8);
  for (const i of [4, 5, 6]) set(i, { x: head.x - hr * 0.3, y: head.y - hr * 0.15 }, 0.8);
  set(7, { x: head.x + hr, y: head.y }, 0.8);
  set(8, { x: head.x - hr, y: head.y }, 0.8);
  set(9, { x: head.x + hr * 0.2, y: head.y + hr * 0.45 }, 0.8);
  set(10, { x: head.x - hr * 0.2, y: head.y + hr * 0.45 }, 0.8);
  set(11, arms.sx.s); set(12, arms.dx.s);
  set(13, arms.sx.e); set(14, arms.dx.e);
  set(15, arms.sx.w); set(16, arms.dx.w);
  for (const i of [17, 19, 21]) set(i, arms.sx.w, 0.8);
  for (const i of [18, 20, 22]) set(i, arms.dx.w, 0.8);
  set(23, hip.sx); set(24, hip.dx);
  set(25, { x: hip.sx.x, y: hipY + 90 }, 0.6); set(26, { x: hip.dx.x, y: hipY + 90 }, 0.6);
  set(27, { x: hip.sx.x, y: hipY + 180 }, 0.6); set(28, { x: hip.dx.x, y: hipY + 180 }, 0.6);

  // sagome
  const torsoBox = { minX: cx - tw / 2 - 4, maxX: cx + tw / 2 + 4, minY: shY - 4, maxY: hipY + 190 };
  const busto = pieceFromShape((x, y) => x >= torsoBox.minX && x <= torsoBox.maxX && y >= torsoBox.minY && y <= torsoBox.maxY, torsoBox);
  const testa = pieceFromShape(
    (x, y) => Math.hypot(x - head.x, y - head.y) <= hr || (Math.abs(x - neck.x) <= hr * 0.3 && y >= head.y && y <= neck.y + 6),
    { minX: head.x - hr, maxX: head.x + hr, minY: head.y - hr, maxY: neck.y + 6 }
  );
  const armPiece = (a) => {
    const pad = 16;
    const box = {
      minX: Math.min(a.s.x, a.e.x, a.w.x) - pad, maxX: Math.max(a.s.x, a.e.x, a.w.x) + pad,
      minY: Math.min(a.s.y, a.e.y, a.w.y) - pad, maxY: Math.max(a.s.y, a.e.y, a.w.y) + pad
    };
    return pieceFromShape(
      (x, y) => segDist(x, y, a.s, a.e) <= a.rUp || segDist(x, y, a.e, a.w) <= a.rFore || Math.hypot(x - a.w.x, y - a.w.y) <= a.rHand,
      box
    );
  };
  const pieces = [
    { truth: "braccio_dx", parent: "busto", pivot: arms.dx.s, ...armPiece(arms.dx) },
    { truth: "braccio_sx", parent: "busto", pivot: arms.sx.s, ...armPiece(arms.sx) },
    { truth: "busto", parent: null, pivot: { x: cx, y: hipY }, ...busto },
    { truth: "testa", parent: "busto", pivot: neck, ...testa }
  ];
  if (objectSide) {
    // oggetto oltre la mano, nella direzione dell'avambraccio (es. sacchetto, bacchetta)
    const a = arms[objectSide];
    const len = Math.hypot(a.w.x - a.e.x, a.w.y - a.e.y) || 1;
    // 1/3 dei casi: oggetto stretto al corpo sopra l'avambraccio (come il sacchetto del folletto),
    // che copre polso e gomito ma non la spalla; altrimenti oltre la mano
    const hug = R() < 0.33;
    const c = hug
      ? { x: (a.w.x + a.e.x) / 2 + (cx - (a.w.x + a.e.x) / 2) * 0.3, y: (a.w.y + a.e.y) / 2 }
      : { x: a.w.x + ((a.w.x - a.e.x) / len) * 26, y: a.w.y + ((a.w.y - a.e.y) / len) * 26 };
    const ow = hug ? 34 : 22, oh = hug ? 40 : 28;
    const box = { minX: c.x - ow, maxX: c.x + ow, minY: c.y - oh, maxY: c.y + oh };
    pieces.push({ truth: "oggetto", parent: `braccio_${objectSide}`, pivot: a.w, ...pieceFromShape((x, y) => x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY, box) });
  }
  pieces.forEach((p, i) => (p.order = i));
  return {
    width: W,
    height: H,
    landmarks: L,
    pieces,
    truth: { raised: { sx: arms.sx.raised, dx: arms.dx.raised }, objectSide, joints: { base_collo: neck, mano_sx: arms.sx.w, mano_dx: arms.dx.w } }
  };
}

/** Pezzi con i nomi "veri" nel formato di importExplodedSheet (per characterFromPieces). */
export function truthPieces(ch) {
  return ch.pieces.map((p) => ({
    name: p.truth,
    parent: p.parent,
    order: p.order,
    x: p.x,
    y: p.y,
    width: p.width,
    height: p.height,
    area: p.area,
    rgba: p.rgba,
    pivot: { x: Math.round(p.pivot.x), y: Math.round(p.pivot.y) }
  }));
}
