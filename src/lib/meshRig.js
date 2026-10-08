// src/lib/meshRig.js — PERSONAGGIO IN MESH PESATA con pochi tagli (metodo della Domatrice).
// Riferimento: docs/ANALISI_RIG_DOMATRICE.md. L'immagine ORIGINALE resta il corpo; si staccano solo:
//   - il BRACCIO che tiene un oggetto (pezzo davanti, mesh sulle sue ossa); nel corpo la zona dietro
//     il braccio, vicino al busto, si riempie dai pixel vicini (nessuna AI);
//   - i CAPELLI DIETRO (pezzo sotto il corpo, catena di 2 ossa che ondeggia);
//   - gli OCCHI: buco nel corpo, bianco e pupilla sotto (la pupilla si muove), palpebra davanti
//     (copia della fascia sopra l'occhio che si allunga in giù per il battito).
// Tutto il resto si piega con la mesh: ossa dai punti della posa, pesi dalla mappa delle parti.
// Versioni: zeus-mesh-1 (tag git) = tutto mesh, nessun taglio. zeus-mesh-2 = questo file.
// Puro: nessun DOM.

import { PART, SEG } from "./partRecognition.js";
import { fillHoles } from "./partExtraction.js";

export const MESH_RIG_VERSION = "2026-10-08.zeus-mesh-3";

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
  amp: { schiena: 1.2, petto: 2.4, testa: 2.0, omero: 3.0, avambraccio: 2.4, mano: 3.0, visoSlide: 0.011, testaLift: 0.009, breath: 0.01, capelli: 3.0, pupille: 0.12 },
  blinkAt: 2.0
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
    else reasons.push(`braccio_${s}: mesh${n ? ` (oggetto piccolo, ${n} px)` : ""}`);
  }
  const hair = rules.cuts.hair && hairN >= rules.hairMin * fgN;
  reasons.push(hair ? `capelli dietro: TAGLIO, pezzo sotto il corpo (${hairN} px)` : "capelli dietro: nessuno");
  const eyesOk = rules.cuts.eyes && eyes.length === 2;
  reasons.push(eyesOk ? "occhi: buco + bianco + pupilla, palpebra per il battito" : "occhi: nessun taglio (non trovati)");
  return { arms, hair, eyes: eyesOk, reasons };
}

/** Occhio: buco (sclera + iride, pupilla compresa) attorno al punto della posa. */
function findEye(center, ipd, W, H, rgba, fg) {
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
    const sclera = l > 170 && sat < 60;
    const iris = dSkin > 120 && l > 45 && b > r; // iride (blu/verde/scura ma non contorno)
    if (sclera || iris) m[y * w + x] = 1;
  }
  // componente più grande, poi i buchi interni (pupilla, riflesso) chiusi
  const comp = new Int32Array(w * h).fill(-1);
  let best = -1, bestN = 0;
  for (let s = 0; s < w * h; s++) {
    if (!m[s] || comp[s] >= 0) continue;
    const st = [s]; comp[s] = s; let n = 0;
    while (st.length) { const i = st.pop(); n++; const x = i % w, y = (i / w) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue; const j = ny * w + nx; if (m[j] && comp[j] < 0) { comp[j] = s; st.push(j); } } }
    if (n > bestN) { bestN = n; best = s; }
  }
  if (best < 0 || bestN < 20) return null;
  const hole = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) if (comp[i] === best) hole[i] = 1;
  const out = new Uint8Array(w * h), q = [];
  for (let i = 0; i < w * h; i++) { const x = i % w, y = (i / w) | 0; if ((x === 0 || y === 0 || x === w - 1 || y === h - 1) && !hole[i]) { out[i] = 1; q.push(i); } }
  for (let qi = 0; qi < q.length; qi++) { const i = q[qi], x = i % w, y = (i / w) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue; const j = ny * w + nx; if (!out[j] && !hole[j]) { out[j] = 1; q.push(j); } } }
  for (let i = 0; i < w * h; i++) if (!out[i]) hole[i] = 1;
  let sr = 0, sg = 0, sb = 0, sn = 0;
  const iris = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (!hole[i]) continue;
    const g = ((i / w) | 0) + y0, x = (i % w) + x0, k = (g * W + x) * 4;
    const l = luma(rgba[k], rgba[k + 1], rgba[k + 2]), sat = Math.max(rgba[k], rgba[k + 1], rgba[k + 2]) - Math.min(rgba[k], rgba[k + 1], rgba[k + 2]);
    if (l > 170 && sat < 60) { sr += rgba[k]; sg += rgba[k + 1]; sb += rgba[k + 2]; sn++; } else iris[i] = 1;
  }
  let hx0 = w, hx1 = -1, hy0 = h, hy1 = -1;
  for (let i = 0; i < w * h; i++) if (hole[i]) { const x = i % w, y = (i / w) | 0; hx0 = Math.min(hx0, x); hx1 = Math.max(hx1, x); hy0 = Math.min(hy0, y); hy1 = Math.max(hy1, y); }
  return { x0, y0, w, h, hole, iris, white: sn > 10 ? [sr / sn, sg / sn, sb / sn] : [240, 238, 232], box: { x0: x0 + hx0, y0: y0 + hy0, x1: x0 + hx1, y1: y0 + hy1 } };
}

/**
 * Rig completo.
 * @param {{ width, height, rgba, fg: Uint8Array, parts: Uint8Array, categories?: Uint8Array, landmarks, joints }} input
 * @returns {{ json, images: { [nome]: {width,height,rgba} }, report }}
 */
export function buildMeshRig({ width: W, height: H, rgba, fg, parts, categories, landmarks, joints }, rules = MESH_RIG_RULES) {
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
  for (let i = 0; i < W * H; i++) if (fg[i]) { lab[i] = labelOf(parts[i], i % W, midX); counts[LABELS[lab[i]]] = (counts[LABELS[lab[i]]] || 0) + 1; }

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
    const b = e.box, cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, eh = b.y1 - b.y0 + 1;
    e.lidH = Math.max(4, Math.round(0.6 * eh));
    // ossa orizzontali: gli allegati restano dritti senza rotazione propria
    bones.push({ name: `occhio_${e.side}`, parent: "viso", head: { x: cx, y: cy }, tail: { x: cx + 10, y: cy } });
    bones.push({ name: `pupilla_${e.side}`, parent: `occhio_${e.side}`, head: { x: cx, y: cy }, tail: { x: cx + 10, y: cy } });
    bones.push({ name: `palpebra_${e.side}`, parent: `occhio_${e.side}`, head: { x: cx, y: b.y0 - e.lidH }, tail: { x: cx + 10, y: b.y0 - e.lidH } });
    e.blinkScale = +((e.lidH + 0.85 * eh) / e.lidH).toFixed(3);
  }

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
  for (const s of decision.arms) for (let i = 0; i < W * H; i++) if (lab[i] === L_[`braccio_${s}`] || lab[i] === L_[`oggetto_${s}`]) armMask[i] = 1;
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
  for (let i = 0; i < W * H; i++) if (known[i] && lab[i] === L_.busto) { dist[i] = 0; dq.push(i); }
  for (let qi = 0; qi < dq.length; qi++) { const i = dq[qi], x = i % W, y = (i / W) | 0; if (dist[i] >= fillR) continue; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const j = ny * W + nx; if (!armMask[j] || dist[j] !== Infinity) continue; dist[j] = dist[i] + 1; dq.push(j); } }
  // solo dietro la parte alta del braccio (sopra il gomito): è quella che scopre il busto quando
  // ruota; dietro avambraccio e pugno il riempimento usciva dalla sagoma (macchie vicino al fianco)
  const elbowY = Object.fromEntries(decision.arms.map((s) => [s, by[`avambraccio_${s}`].head.y]));
  const holes = [];
  for (let i = 0; i < W * H; i++) {
    if (!armMask[i] || dist[i] > fillR) continue;
    const y = (i / W) | 0, s = decision.arms.find((a) => lab[i] === L_[`braccio_${a}`] || lab[i] === L_[`oggetto_${a}`]);
    if (s && y <= elbowY[s]) holes.push(i);
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
      const px = bx0 + (c / cols) * (bw - 1), py = by0 + (r / rows) * (bh - 1);
      uvs.push(+(c / cols).toFixed(5), +(r / rows).toFixed(5));
      const label = labelAt(px, py, step);
      let w = chainWeights({ x: px, y: py }, C[label]);
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
  const nearLabel = (px, py) => LABELS[near[Math.round(py) * W + Math.round(px)]];

  // corpo: le parti tagliate contano come busto/testa (nel corpo resta solo il riempimento dietro)
  const bodyMap = (n) => (n === "capelli" ? "testa" : decision.arms.some((s) => n === `braccio_${s}` || n === `oggetto_${s}`) ? "busto" : n);
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
    const bx0 = e.box.x0 - 2, bx1 = e.box.x1 + 2, top = e.box.y0 - e.lidH, bw = bx1 - bx0 + 1, bh = e.lidH;
    const lpx = new Uint8ClampedArray(bw * bh * 4);
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) { const g = (top + y) * W + bx0 + x; if (fg[g] && !holeMask[g]) lpx.set(rgba.subarray(g * 4, g * 4 + 4), (y * bw + x) * 4); }
    region(`palpebra_${e.side}`, `palpebra_${e.side}`, bx0, top, bw, bh, lpx);
  }

  // slot: ordine di disegno (dietro → davanti)
  const slotFor = (name, bone) => ({ name, bone, attachment: name });
  const slots = [];
  if (attachments.capelli_dietro) slots.push(slotFor("capelli_dietro", "root"));
  for (const e of decision.eyes ? eyes : []) slots.push(slotFor(`bianco_${e.side}`, `occhio_${e.side}`));
  for (const e of decision.eyes ? eyes : []) slots.push(slotFor(`pupilla_${e.side}`, `pupilla_${e.side}`));
  slots.push(slotFor("corpo", "root"));
  for (const e of decision.eyes ? eyes : []) slots.push(slotFor(`palpebra_${e.side}`, `palpebra_${e.side}`));
  for (const s of decision.arms) slots.push(slotFor(`braccio_${s}`, "root"));
  const skinAtt = Object.fromEntries(slots.map((s) => [s.name, { [s.name]: attachments[s.name] }]));

  const json = {
    skeleton: { spine: "4.1.24", x: -cw / 2, y: 0, width: cw, height: ch, images: "./" },
    bones: jsonBones,
    slots,
    skins: [{ name: "default", attachments: skinAtt }],
    animations: { ambient: loopAnimation(rules, ch, decision, eyes, ipd) }
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
function loopAnimation(rules, height, decision, eyes, ipd) {
  const T = rules.loopSeconds, A = rules.amp;
  const wave = (k, ph = 0) => (t) => Math.sin(2 * Math.PI * (k * t / T + ph));
  const bump = (ph = 0) => (t) => 0.5 * (1 - Math.cos(2 * Math.PI * (t / T + ph)));
  const rot = (amp, f) => smoothKeys(T, [(t) => amp * f(t)], ["value"]);
  const xy = (fx, fy) => smoothKeys(T, [fx, fy], ["x", "y"]);
  const one = () => 1, zero = () => 0;
  const bones = {
    schiena: { rotate: rot(A.schiena, wave(2)) },
    petto: { rotate: rot(-A.petto, bump()), scale: xy((t) => 1 + A.breath * bump(0.25)(t), one) },
    testa: { rotate: rot(A.testa, wave(1, 0.15)), translate: xy((t) => A.testaLift * height * bump(0.1)(t), zero) },
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
  if (decision.eyes) {
    // pupille: due sguardi (di lato e un po' in basso), come la Domatrice
    const look = (t) => { const p = t / T; const g = (c) => Math.exp(-((p - c) ** 2) / 0.006); return g(0.22) + g(0.72); };
    for (const e of eyes) {
      bones[`pupilla_${e.side}`] = { translate: xy((t) => -A.pupille * ipd * 0.5 * look(t), (t) => -A.pupille * ipd * 0.25 * look(t)) };
      // battito: 0,13 s chiusura, 0,2 s apertura (chiavi lineari, è uno scatto voluto)
      const t0 = rules.blinkAt;
      bones[`palpebra_${e.side}`] = { scale: [{ time: 0, x: 1, y: 1 }, { time: t0, x: 1, y: 1 }, { time: +(t0 + 0.133).toFixed(3), x: 1, y: e.blinkScale }, { time: +(t0 + 0.333).toFixed(3), x: 1, y: 1 }, { time: T, x: 1, y: 1 }] };
    }
  }
  return { bones };
}

/** Atlas: una pagina per immagine (file <nome>.png accanto al json). */
export function atlasFor(images) {
  return Object.entries(images).map(([n, im]) => `${n}.png\nsize: ${im.width},${im.height}\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\n${n}\n  rotate: false\n  xy: 0, 0\n  size: ${im.width}, ${im.height}\n  orig: ${im.width}, ${im.height}\n  offset: 0, 0\n  index: -1\n`).join("\n");
}
