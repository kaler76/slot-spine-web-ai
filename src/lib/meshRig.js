// src/lib/meshRig.js — PERSONAGGIO INTERO IN MESH PESATA (prototipo "zeus mesh 1", 8 ott 2026).
// Metodo del rig professionale della Domatrice (docs/ANALISI_RIG_DOMATRICE.md): l'immagine
// ORIGINALE resta intera e si deforma con una mesh legata alle ossa; niente tavola esplosa.
//   - ossa dai punti della posa (anca, schiena, petto, collo, testa, viso, braccia);
//   - griglia di vertici sull'ingombro del personaggio;
//   - pesi dalla mappa delle parti (recognizeParts): ogni vertice segue la catena della sua parte,
//     con sfumatura lineare fra i punti di controllo della catena;
//   - loop di 6 s sul modello della Domatrice: ampiezze piccole, fasi sfalsate, viso che scorre.
// Test 1: nessun taglio, nessun occhio bucato (vedi prossimi passi nel documento).
// Puro: nessun DOM.

import { PART } from "./partRecognition.js";

export const MESH_RIG_VERSION = "2026-10-08.zeus-mesh-1";

export const MESH_RIG_RULES = {
  cells: 34, // celle della griglia sul lato lungo dell'ingombro
  pad: 6, // margine attorno al personaggio (px)
  loopSeconds: 6,
  fps: 15,
  faceRadius: 0.55, // raggio della zona del viso (× larghezza spalle): pesata sull'osso "viso"
  // ampiezze (gradi / frazione dell'altezza del personaggio), dal loop della Domatrice
  amp: { schiena: 1.2, petto: 2.4, testa: 2.0, omero: 3.0, avambraccio: 2.4, mano: 3.0, visoSlide: 0.011, testaLift: 0.009, breath: 0.01 }
};

const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const mid = (a, b) => lerp(a, b, 0.5);
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const deg = (r) => (r * 180) / Math.PI;

/** Ossa in coordinate immagine: { name, parent, head: punto, tail: punto } (tail = direzione/lunghezza). */
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

/** Catene di controllo per parte: [[punto, osso], ...] (peso lineare fra punti consecutivi). */
function chains(bones) {
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
  return c;
}

/** Pesi di un punto su una catena: proiezione sul tratto più vicino, interpolazione lineare. */
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

/** Etichetta (catena) di ogni pixel del personaggio dalla mappa delle parti. */
function labelOf(part, x, s) {
  switch (part) {
    case PART.testa:
    case PART.cappello:
      return "testa";
    case PART.braccio_sx:
    case PART.avambraccio_sx:
      return "braccio_sx";
    case PART.braccio_dx:
    case PART.avambraccio_dx:
      return "braccio_dx";
    case PART.oggetto_in_mano:
      return x < s ? "oggetto_dx" : "oggetto_sx";
    default:
      return "busto";
  }
}

/**
 * Rig completo.
 * @param {{ width, height, rgba, fg: Uint8Array, parts: Uint8Array, landmarks, joints }} input
 * @returns {{ json, image: { width, height, rgba }, report }}
 */
export function buildMeshRig({ width: W, height: H, rgba, fg, parts, landmarks, joints }, rules = MESH_RIG_RULES) {
  // ingombro del personaggio
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let i = 0; i < W * H; i++) if (fg[i]) { const x = i % W, y = (i / W) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  x0 = Math.max(0, x0 - rules.pad); y0 = Math.max(0, y0 - rules.pad); x1 = Math.min(W - 1, x1 + rules.pad); y1 = Math.min(H - 1, y1 + rules.pad);
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  // immagine: ritaglio dell'originale, sfondo trasparente
  const img = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const g = (y + y0) * W + x + x0, o = (y * cw + x) * 4;
    if (!fg[g]) continue;
    img[o] = rgba[g * 4]; img[o + 1] = rgba[g * 4 + 1]; img[o + 2] = rgba[g * 4 + 2]; img[o + 3] = rgba[g * 4 + 3];
  }
  // coordinate Spine: radice al centro in basso dell'ingombro, y verso l'alto
  const rootX = x0 + cw / 2, rootY = y1 + 1;
  const toS = (p) => ({ x: p.x - rootX, y: rootY - p.y });

  // ossa
  const bones = bonesFromPose(landmarks, joints);
  const shoulderW = Math.hypot(bones.find((b) => b.name === "omero_sx").head.x - bones.find((b) => b.name === "omero_dx").head.x, bones.find((b) => b.name === "omero_sx").head.y - bones.find((b) => b.name === "omero_dx").head.y);
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

  // etichetta di ogni pixel del personaggio, poi propagata allo sfondo (vertici fuori sagoma)
  const midX = mid(landmarks[11], landmarks[12]).x;
  const lab = new Int8Array(W * H).fill(-1);
  const names = ["busto", "testa", "braccio_sx", "braccio_dx", "oggetto_sx", "oggetto_dx"];
  const q = [];
  for (let i = 0; i < W * H; i++) if (fg[i]) { lab[i] = names.indexOf(labelOf(parts[i], i % W, midX)); q.push(i); }
  for (let qi = 0; qi < q.length; qi++) {
    const i = q[qi], x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < x0 || ny < y0 || nx > x1 || ny > y1) continue;
      const j = ny * W + nx;
      if (lab[j] < 0) { lab[j] = lab[i]; q.push(j); }
    }
  }

  // griglia: contorno rettangolare prima (hull), poi interni
  const step = Math.max(cw, ch) / rules.cells;
  const cols = Math.max(2, Math.round(cw / step)), rows = Math.max(2, Math.round(ch / step));
  const order = [];
  for (let c = 0; c <= cols; c++) order.push([c, 0]);
  for (let r = 1; r <= rows; r++) order.push([cols, r]);
  for (let c = cols - 1; c >= 0; c--) order.push([c, rows]);
  for (let r = rows - 1; r >= 1; r--) order.push([0, r]);
  const hull = order.length;
  for (let r = 1; r < rows; r++) for (let c = 1; c < cols; c++) order.push([c, r]);
  const idx = new Map(order.map(([c, r], i) => [`${c},${r}`, i]));
  const C = chains(bones);
  const face = bones.find((b) => b.name === "viso").head, faceR = rules.faceRadius * shoulderW;
  const uvs = [], vertices = [], labelCount = {};
  for (const [c, r] of order) {
    const px = x0 + (c / cols) * (cw - 1), py = y0 + (r / rows) * (ch - 1);
    uvs.push(+(c / cols).toFixed(5), +(r / rows).toFixed(5));
    // etichetta: maggioranza nella cella attorno al vertice (pixel del personaggio), se no la propagata
    const cnt = new Map();
    const rad = Math.max(2, Math.round(step / 2));
    for (let dy = -rad; dy <= rad; dy += 2) for (let dx = -rad; dx <= rad; dx += 2) {
      const X = Math.round(px + dx), Y = Math.round(py + dy);
      if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
      const g = Y * W + X;
      if (fg[g]) cnt.set(lab[g], (cnt.get(lab[g]) || 0) + 1);
    }
    let L = lab[Math.round(py) * W + Math.round(px)];
    if (cnt.size) {
      L = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0][0];
      // oggetto tenuto in mano (rigido, sottile): basta il 15% della cella perché il vertice lo segua,
      // altrimenti la punta del fulmine accanto alla gamba si piega col busto
      const tot = [...cnt.values()].reduce((a, v) => a + v, 0);
      for (const k of [4, 5]) if ((cnt.get(k) || 0) >= 0.15 * tot) L = k;
    }
    const label = names[Math.max(0, L)];
    labelCount[label] = (labelCount[label] || 0) + 1;
    let w = chainWeights({ x: px, y: py }, C[label]);
    // viso: sfumatura radiale attorno al naso (il viso scorre dentro la testa)
    if (label === "testa") {
      const f = smooth(1 - Math.hypot(px - face.x, py - face.y) / faceR);
      if (f > 0) { for (const k in w) w[k] *= 1 - f; w.viso = (w.viso || 0) + f; }
    }
    // al massimo 4 ossa, normalizzate
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

  // allegato: mesh pesata sull'intero personaggio, slot sulla radice
  const att = { type: "mesh", path: "personaggio", uvs, triangles, vertices, hull, width: cw, height: ch };
  const json = {
    skeleton: { spine: "4.1.24", x: -cw / 2, y: 0, width: cw, height: ch, images: "./" },
    bones: jsonBones,
    slots: [{ name: "personaggio", bone: "root", attachment: "personaggio" }],
    skins: [{ name: "default", attachments: { personaggio: { personaggio: att } } }],
    animations: { ambient: loopAnimation(rules, ch) }
  };
  return {
    json,
    image: { width: cw, height: ch, rgba: img },
    report: { version: MESH_RIG_VERSION, vertices: order.length, triangles: triangles.length / 3, bones: jsonBones.length, labels: labelCount, crop: { x0, y0, width: cw, height: ch } }
  };
}

/** Loop di 6 s sul modello della Domatrice: piccole oscillazioni sfalsate, viso che scorre, respiro. */
function loopAnimation(rules, height) {
  const T = rules.loopSeconds, n = Math.round(T * rules.fps), A = rules.amp;
  const keys = (f) => Array.from({ length: n + 1 }, (_, i) => f((i / n) * T, i / n));
  const r = (v) => +v.toFixed(3);
  const wave = (k, ph = 0) => (t) => Math.sin(2 * Math.PI * (k * t / T + ph));
  const bump = (ph = 0) => (t) => 0.5 * (1 - Math.cos(2 * Math.PI * (t / T + ph))); // 0 → 1 → 0
  const rot = (amp, f) => keys((t) => ({ time: r(t), value: r(amp * f(t)) }));
  const bones = {
    schiena: { rotate: rot(A.schiena, wave(2)) },
    petto: { rotate: rot(-A.petto, bump()), scale: keys((t) => ({ time: r(t), x: r(1 + A.breath * bump(0.25)(t)), y: 1 })) },
    testa: { rotate: rot(A.testa, wave(1, 0.15)), translate: keys((t) => ({ time: r(t), x: r(A.testaLift * height * bump(0.1)(t)), y: 0 })) },
    viso: { translate: keys((t) => ({ time: r(t), x: r(-A.visoSlide * height * bump(0.1)(t)), y: 0 })) }
  };
  for (const [s, ph] of [["sx", 0], ["dx", 0.3]]) {
    bones[`omero_${s}`] = { rotate: rot(A.omero, wave(1, ph)) };
    bones[`avambraccio_${s}`] = { rotate: rot(A.avambraccio, wave(1, ph + 0.12)) };
    bones[`mano_${s}`] = { rotate: rot(A.mano, wave(2, ph + 0.2)) };
  }
  return { bones };
}

/** Testo dell'atlas per un'unica immagine. */
export function atlasFor(pngName, width, height, region = "personaggio") {
  return `${pngName}\nsize: ${width},${height}\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\n${region}\n  rotate: false\n  xy: 0, 0\n  size: ${width}, ${height}\n  orig: ${width}, ${height}\n  offset: 0, 0\n  index: -1\n`;
}
