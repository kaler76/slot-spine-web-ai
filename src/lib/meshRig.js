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
// fianco tagliato dal GOMITO, isole del corpo che toccano il braccio nel pezzo; -13 mesh sulla sagoma
// (silhouetteMesh.js) e pesi morbidi (questo file).
// Puro: nessun DOM.

import { PART, SEG } from "./partRecognition.js";
import { fillHoles } from "./partExtraction.js";
import { silhouetteMesh } from "./silhouetteMesh.js";

export const MESH_RIG_VERSION = "2026-10-10.zeus-mesh-13.9";

export const MESH_RIG_RULES = {
  cells: 26, // passo dei vertici del corpo: lato lungo / cells (34 fino al 13.1; meno vertici = meno calcolo per fotogramma)
  pieceCells: 14, // celle della griglia dei pezzi tagliati
  meshShape: "sagoma", // "sagoma": contorno sulla sagoma, vertici solo dentro (R16); "griglia": riquadro intero (prima del 13)
  denseStep: 0.55, // passo dei vertici vicino ad articolazioni e viso (× passo base)
  weightSmooth: 4, // passate di media dei pesi coi vertici vicini (R17); 0 = pesi a gradini di prima
  pad: 6,
  loopSeconds: 6,
  fps: 15,
  faceRadius: 0.55, // zona del viso pesata sull'osso "viso" (× larghezza spalle)
  fillBand: 0.14, // zona dietro il braccio tagliato riempita nel corpo (× larghezza spalle dal busto)
  objectMin: 0.002, // quota del personaggio oltre cui un oggetto in mano fa tagliare il braccio
  hairMin: 0.004, // quota minima dei capelli dietro per farne un pezzo
  cuts: { arm: true, hair: true, eyes: true, earrings: true },
  // braccio tagliato: dalla SPALLA se il braccio è staccato dal busto (Zeus, braccio alzato); dal
  // GOMITO se l'omero scende lungo il fianco (Domatrice): l'omero resta nella mesh del corpo, così
  // il pezzo non si porta via risvolto e bottoni della giacca. "auto" sceglie con armDownMaxDeg.
  armFrom: "auto", // "auto" | "spalla" | "gomito"
  armDownMaxDeg: 35, // omero entro questo angolo dalla direzione spalla→anca = lungo il fianco
  elbowOverlap: 0.08, // il pezzo dal gomito prende anche questo tratto d'omero (× larghezza spalle)
  // OGGETTO COMPLETATO (zeus-mesh-10): il riconoscimento nel browser prende spesso solo il tratto d'oggetto vicino
  // alla mano (arco di Robin Hood: 13709 px); si cresce per colore e si tiene solo ciò che prosegue lungo l'asse
  objectGrow: true,
  // OGGETTO FERMO (zeus-mesh-11, Robin Hood: "piuttosto non muoverlo, fai una maschera block e muovi il resto"):
  // braccio tagliato + oggetto fermi (pesati sulla radice), maschera attorno a loro nel corpo che sfuma verso il
  // movimento normale; le parti dell'oggetto rimaste nel corpo (stesso colore, collegate) sono ferme anche loro
  lockObject: false,
  lockGrow: 0.08, // crescita per colore della maschera al massimo a questa distanza dal pezzo (× spalle)
  lockBand: 0.14, // larghezza della sfumatura della maschera (× larghezza spalle)
  objectGrowMax: 6, // al massimo 6 volte i pixel riconosciuti
  // BOCCA (zeus-mesh-8): "no" | "loop" (sorride una volta nel loop) | "sempre" (sorriso tenuto per tutto il loop).
  // Gli angoli della bocca salgono di smileUp × larghezza bocca e si allargano di smileOut ×; nel setup la
  // bocca resta quella del disegno.
  smile: "no",
  smileUp: 0.16,
  smileOut: 0.06,
  amp: { schiena: 1.2, petto: 2.4, testa: 2.0, omero: 3.0, avambraccio: 2.4, mano: 3.0, visoSlide: 0.004, breath: 0.01, capelli: 3.0, pupille: 0.12, orecchini: 7 },
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
export function decideCuts({ counts, fgN, eyes, hairN, free = {} }, rules = MESH_RIG_RULES) {
  const reasons = [];
  const arms = [];
  for (const s of ["sx", "dx"]) {
    const n = counts[`oggetto_${s}`] || 0;
    if (rules.cuts.arm && n >= rules.objectMin * fgN) { arms.push(s); reasons.push(`braccio_${s}: TAGLIO, tiene un oggetto (${n} px)`); }
    // BRACCIO LIBERO (zeus-mesh-13.7, Jessica: "se c'è un braccio così dovrebbe essere tagliato bene e animato
    // indipendente"): staccato dal busto per quasi tutta la lunghezza → pezzo anche senza oggetto
    else if (rules.cuts.arm && free[s]?.free) { arms.push(s); reasons.push(`braccio_${s}: TAGLIO, braccio libero (staccato dal busto per il ${Math.round(100 * free[s].frac)}%)`); }
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

/**
 * ORECCHINI PENDENTI (zeus-mesh-13.6, Rita 10 ott: "questi orecchini non si possono far muovere?"). Per ogni lato,
 * sotto l'occhio e verso l'esterno (fino alle spalle), si cercano gruppi di pixel SATURI che non sono pelle (oro,
 * pietre colorate) o della categoria "accessori": il gruppo più grande più alto che largo è l'orecchino. Il contorno
 * scuro attaccato (2 px) va con lui. Le labbra (larghe) e il vestito (sotto le spalle) restano fuori.
 * @returns {Array<{side, idx:number[], top:{x,y}, bot:{x,y}}>}
 */
export function findEarrings({ eyesC, W, H, rgba, fg, categories, skin, shoulderY }) {
  const out = [];
  let catInfo = false; if (categories) for (let i = 0; i < W * H; i += 7) if (categories[i] === SEG.hair) { catInfo = true; break; }
  // senza categorie che distinguono i capelli (solo primo piano) niente orecchini: le ciocche ramate sembrano oro
  if (!catInfo) return out;
  const [es, ed] = eyesC; // lato sx e dx del personaggio
  const ipd = Math.hypot(es.x - ed.x, es.y - ed.y) || 1, ux = (es.x - ed.x) / ipd, uy = (es.y - ed.y) / ipd;
  for (const [side, e, sg] of [["sx", es, 1], ["dx", ed, -1]]) {
    // riquadro: da 0,4 ipd verso il centro a 1,6 ipd verso l'esterno; da 0,5 a 2,6 ipd sotto l'occhio
    const xs = [e.x - sg * ux * 0.4 * ipd, e.x + sg * ux * 1.6 * ipd];
    const x0 = Math.max(0, Math.round(Math.min(...xs))), x1 = Math.min(W - 1, Math.round(Math.max(...xs)));
    const y0 = Math.max(0, Math.round(e.y + 0.5 * ipd)), y1 = Math.min(H - 1, Math.round(Math.min(e.y + 2.6 * ipd, shoulderY - 0.05 * ipd)));
    if (x1 <= x0 || y1 <= y0) continue;
    const w = x1 - x0 + 1, h = y1 - y0 + 1, m = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const g = (y + y0) * W + x + x0, i = g * 4; if (!fg[g]) continue;
      const r = rgba[i], gg = rgba[i + 1], b = rgba[i + 2], mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), d = mx - mn;
      // tinta: pelle, labbra e capelli castani stanno fra il rosso e l'arancio (−15°…32°); oro (35–60°), verde, azzurro
      // e viola delle pietre fuori. Saturi e non troppo scuri. Oppure categoria "accessori" del segmentatore.
      let hue = 0; if (d) { hue = mx === r ? ((gg - b) / d) % 6 : mx === gg ? (b - r) / d + 2 : (r - gg) / d + 4; hue = (hue * 60 + 360) % 360; }
      // oro ramato (Rita: tinta 22–31° come la pelle, ma saturazione ≥ 0,8 e chiaro; pelle ≤ 0,6, capelli più scuri)
      const sat = d / (mx || 1), metal = (sat > 0.35 && mx > 70 && hue > 33 && hue < 345) || (sat >= 0.8 && mx >= 100 && hue >= 12 && hue <= 60);
      // con le categorie del segmentatore (se distinguono i capelli): mai capelli né pelle (ciocche ramate di Domatrice e
      // Robin, capelli grigio-azzurri dell'avvocato erano presi per orecchini)
      const cat = catInfo ? categories[g] : -1;
      if (cat === SEG.hair || cat === SEG.faceSkin || cat === SEG.bodySkin) continue;
      if (metal || cat === SEG.others) m[y * w + x] = 1;
    }
    const seen = new Uint8Array(w * h), comps = [];
    let best = null;
    for (let s0 = 0; s0 < w * h; s0++) {
      if (!m[s0] || seen[s0]) continue;
      const st = [s0], px = []; seen[s0] = 1; let ax = w, bx = -1, ay = h, by = -1;
      while (st.length) { const i = st.pop(); px.push(i); const x = i % w, y = (i / w) | 0; ax = Math.min(ax, x); bx = Math.max(bx, x); ay = Math.min(ay, y); by = Math.max(by, y); for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue; const j = Y * w + X; if (m[j] && !seen[j]) { seen[j] = 1; st.push(j); } } }
      const bw = bx - ax + 1, bh = by - ay + 1;
      comps.push({ px, ax, bx, ay, by });
      // firma del gioiello: pezzo pieno (pietra, montatura: riempie il riquadro) e quasi tutto colore vivo; le ciocche
      // di capelli sono sottili e curve (riempimento basso), i capelli grigi poco saturi
      let vivid = 0;
      for (const i of px) { const g = ((i / w) | 0) * W + (i % w) + x0 + y0 * W, c = g * 4, mx2 = Math.max(rgba[c], rgba[c + 1], rgba[c + 2]), mn2 = Math.min(rgba[c], rgba[c + 1], rgba[c + 2]); if (mx2 >= 90 && (mx2 - mn2) / mx2 >= 0.6) vivid++; }
      // riempimento contando i buchi interni (sfaccettature scure della pietra)
      let enclosed = 0;
      {
        const bw2 = bw + 2, bh2 = bh + 2, mm = new Uint8Array(bw2 * bh2), oo = new Uint8Array(bw2 * bh2), q2 = [0];
        for (const i of px) mm[((((i / w) | 0) - ay) + 1) * bw2 + (i % w) - ax + 1] = 1;
        oo[0] = 1;
        for (let k = 0; k < q2.length; k++) { const i = q2[k], x = i % bw2, y = (i / bw2) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= bw2 || Y >= bh2) continue; const j = Y * bw2 + X; if (!oo[j] && !mm[j]) { oo[j] = 1; q2.push(j); } } }
        for (let i = 0; i < bw2 * bh2; i++) if (!oo[i] && !mm[i]) enclosed++;
      }
      const fill = (px.length + enclosed) / (bw * bh);
      if (fill < 0.38 || vivid < 0.5 * px.length) continue;
      if (px.length < 0.04 * ipd * ipd || px.length > 0.8 * ipd * ipd || bh < 1.2 * bw || ax === 0 || bx === w - 1) continue;
      if (!best || px.length > best.px.length) best = { px, ax, bx, ay, by };
    }
    if (!best) continue;
    const inE = new Uint8Array(w * h); for (const i of best.px) inE[i] = 1;
    // pezzi SOPRA il pendente (perla, gancio, montatura: Rita) nella stessa colonna, fino a 0,45 ipd: stesso orecchino
    let top = best.ay;
    for (const c of comps.sort((p, q) => q.by - p.by)) {
      if (c === best || c.px.length < 10 || c.by >= top || c.by < top - 0.45 * ipd) continue;
      if (c.bx < best.ax - 0.1 * ipd || c.ax > best.bx + 0.1 * ipd) continue;
      for (const i of c.px) inE[i] = 1; top = Math.min(top, c.ay);
    }
    // colore dei capelli lì attorno (mediana dei pixel "capelli" del riquadro)
    const hairRef = (() => { const v = [[], [], []]; for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) { const g = (y + y0) * W + x + x0; if (categories[g] !== SEG.hair) continue; for (let k = 0; k < 3; k++) v[k].push(rgba[g * 4 + k]); } return v.map((a) => (a.length ? a.sort((p, q) => p - q)[a.length >> 1] : 40)); })();
    // contorno scuro attaccato (4 px) e anello/gancio sopra (pixel non pelle a contatto)
    for (let k = 0; k < 4; k++) {
      const add = [];
      for (let i = 0; i < w * h; i++) {
        if (inE[i]) continue; const x = i % w, y = (i / w) | 0;
        let near = false; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < w && Y < h && inE[Y * w + X]) { near = true; break; } }
        if (!near) continue;
        const g = (y + y0) * W + x + x0, c = g * 4; if (!fg[g]) continue;
        const l = luma(rgba[c], rgba[c + 1], rgba[c + 2]), dSkin = Math.abs(rgba[c] - skin[0]) + Math.abs(rgba[c + 1] - skin[1]) + Math.abs(rgba[c + 2] - skin[2]);
        const mx3 = Math.max(rgba[c], rgba[c + 1], rgba[c + 2]), sat3 = mx3 ? (mx3 - Math.min(rgba[c], rgba[c + 1], rgba[c + 2])) / mx3 : 0;
        if (catInfo && categories[g] === SEG.faceSkin) continue;
        // bordi sfumati della montatura: tutto ciò che non somiglia ai capelli lì attorno (né alla pelle)
        const dHair = Math.abs(rgba[c] - hairRef[0]) + Math.abs(rgba[c + 1] - hairRef[1]) + Math.abs(rgba[c + 2] - hairRef[2]);
        if (l < 60 || (dHair > 60 && dSkin > 60) || (sat3 >= 0.6 && dSkin > 60)) add.push(i);
      }
      for (const i of add) inE[i] = 1;
    }
    // buchi interni (sfaccettature scure della pietra): dentro l'orecchino
    {
      const outE = new Uint8Array(w * h), q = [];
      for (let i = 0; i < w * h; i++) { const x = i % w, y = (i / w) | 0; if ((x === 0 || y === 0 || x === w - 1 || y === h - 1) && !inE[i]) { outE[i] = 1; q.push(i); } }
      for (let k = 0; k < q.length; k++) { const i = q[k], x = i % w, y = (i / w) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue; const j = Y * w + X; if (!outE[j] && !inE[j]) { outE[j] = 1; q.push(j); } } }
      // solo buchi piccoli (sfaccettature), non un'ansa di pelle o di capelli chiusa dal pezzo
      let nE = 0; for (let i = 0; i < w * h; i++) nE += inE[i];
      const seenH = new Uint8Array(w * h);
      for (let s1 = 0; s1 < w * h; s1++) {
        if (outE[s1] || inE[s1] || seenH[s1]) continue;
        const st = [s1], px2 = []; seenH[s1] = 1;
        while (st.length) { const i = st.pop(); px2.push(i); const x = i % w, y = (i / w) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue; const j = Y * w + X; if (!outE[j] && !inE[j] && !seenH[j]) { seenH[j] = 1; st.push(j); } } }
        if (px2.length < 0.3 * nE) for (const i of px2) if (fg[((i / w) | 0) * W + (i % w) + x0 + y0 * W]) inE[i] = 1;
      }
    }
    const idx = []; let tx = 0, tn = 0, bxs = 0, bn = 0, ty = h, byy = -1;
    for (let i = 0; i < w * h; i++) if (inE[i]) { const y = (i / w) | 0; ty = Math.min(ty, y); byy = Math.max(byy, y); }
    for (let i = 0; i < w * h; i++) if (inE[i]) {
      const x = i % w, y = (i / w) | 0; idx.push((y + y0) * W + x + x0);
      if (y <= ty + 2) { tx += x; tn++; } if (y >= byy - 2) { bxs += x; bn++; }
    }
    out.push({ side, idx, top: { x: tx / tn + x0, y: ty + y0 }, bot: { x: bxs / bn + x0, y: byy + y0 + 1 } });
  }
  return out;
}

/**
 * OCCHI CERCATI NEL VISO (zeus-mesh-13.3, Rita 9 ott: posa data a mano coi 9 click, occhi STIMATI dal naso e dalle
 * spalle, lontani da quelli veri → "occhi: non trovati"). Si cercano i bianchi degli occhi sopra il naso: pixel
 * chiari e poco saturi vicino a pixel molto scuri (ciglia, pupilla; i riflessi della pelle non ne hanno), raggruppati
 * per occhio; si sceglie la coppia più grande, una per lato del naso, quasi alla stessa altezza.
 * @returns {[{x,y},{x,y}] | null}  [lato sx del personaggio (a destra per chi guarda), lato dx]
 */
export function findEyePair(nose, ipd0, W, H, rgba, fg) {
  const x0 = Math.max(0, Math.round(nose.x - 1.8 * ipd0)), x1 = Math.min(W - 1, Math.round(nose.x + 1.8 * ipd0));
  const y0 = Math.max(0, Math.round(nose.y - 1.6 * ipd0)), y1 = Math.min(H - 1, Math.round(nose.y + 0.2 * ipd0));
  const w = x1 - x0 + 1, h = y1 - y0 + 1, dark = new Uint8Array(w * h), m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const g = (y + y0) * W + x + x0, i = g * 4; if (fg[g] && luma(rgba[i], rgba[i + 1], rgba[i + 2]) < 45) dark[y * w + x] = 1; }
  const R = Math.max(2, Math.round(0.12 * ipd0));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const g = (y + y0) * W + x + x0, i = g * 4; if (!fg[g]) continue;
    const r = rgba[i], gg = rgba[i + 1], b = rgba[i + 2], l = luma(r, gg, b), sat = Math.max(r, gg, b) - Math.min(r, gg, b);
    if (!((l > 170 && sat < 60) || (l > 120 && sat < 35))) continue;
    let near = false;
    for (let dy = -R; dy <= R && !near; dy += 2) for (let dx = -R; dx <= R; dx += 2) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < w && Y < h && dark[Y * w + X]) { near = true; break; } }
    if (near) m[y * w + x] = 1;
  }
  const seen = new Uint8Array(w * h), comps = [];
  for (let s = 0; s < w * h; s++) {
    if (!m[s] || seen[s]) continue;
    const st = [s]; seen[s] = 1; let n = 0, sx = 0, sy = 0, ax = w, bx = -1, ay = h, by = -1;
    while (st.length) { const i = st.pop(), x = i % w, y = (i / w) | 0; n++; sx += x; sy += y; ax = Math.min(ax, x); bx = Math.max(bx, x); ay = Math.min(ay, y); by = Math.max(by, y); for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue; const j = Y * w + X; if (m[j] && !seen[j]) { seen[j] = 1; st.push(j); } } }
    if (n >= 8 && by - ay <= 0.5 * ipd0) comps.push({ n, cx: sx / n + x0, cy: sy / n + y0, ax: ax + x0, bx: bx + x0, ay: ay + y0, by: by + y0 });
  }
  // gruppi = un occhio (bianco a sinistra e a destra dell'iride)
  const groups = [];
  for (const c of comps.sort((a, b) => b.n - a.n)) {
    const gp = groups.find((q) => Math.abs(q.cy - c.cy) < 0.2 * ipd0 && c.ax < q.bx + 0.45 * ipd0 && c.bx > q.ax - 0.45 * ipd0);
    if (gp) { gp.cy = (gp.cy * gp.n + c.cy * c.n) / (gp.n + c.n); gp.n += c.n; gp.ax = Math.min(gp.ax, c.ax); gp.bx = Math.max(gp.bx, c.bx); gp.ay = Math.min(gp.ay, c.ay); gp.by = Math.max(gp.by, c.by); }
    else groups.push({ ...c });
  }
  let best = null;
  for (const a of groups) for (const b of groups) {
    if (a === b) continue;
    const ca = { x: (a.ax + a.bx + 1) / 2, y: (a.ay + a.by + 1) / 2 }, cb = { x: (b.ax + b.bx + 1) / 2, y: (b.ay + b.by + 1) / 2 };
    if (!(ca.x < nose.x && cb.x > nose.x)) continue; // a: a sinistra per chi guarda (lato dx del personaggio)
    const dx = cb.x - ca.x, dy = Math.abs(cb.y - ca.y);
    if (dx < 0.5 * ipd0 || dx > 2.4 * ipd0 || dy > 0.45 * dx) continue;
    const sc = Math.min(a.n, b.n) * 2 + Math.max(a.n, b.n);
    if (!best || sc > best.sc) best = { sc, pair: [cb, ca] };
  }
  return best ? best.pair : null;
}

function findEyeOnce(center, ipd, W, H, rgba, fg, rules_irisGrow = true) {
  const rx = Math.round(0.36 * ipd), ry = Math.round(0.2 * ipd);
  const x0 = Math.max(0, Math.round(center.x - rx)), x1 = Math.min(W - 1, Math.round(center.x + rx));
  const y0 = Math.max(0, Math.round(center.y - ry)), y1 = Math.min(H - 1, Math.round(center.y + ry));
  // pelle: mediana della fascia sotto l'occhio
  const sk = [];
  for (let y = Math.round(center.y + ry); y < Math.min(H, center.y + ry * 1.8); y++)
    for (let x = Math.round(center.x - rx / 2); x < center.x + rx / 2; x++) { const i = (y * W + x) * 4; sk.push([rgba[i], rgba[i + 1], rgba[i + 2]]); }
  const med = (k) => sk.map((p) => p[k]).sort((a, b) => a - b)[sk.length >> 1] ?? 200;
  const skin = [med(0), med(1), med(2)];
  const w = x1 - x0 + 1, h = y1 - y0 + 1, m = new Uint8Array(w * h), irisCol = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (x + x0 - center.x) / rx, dy = (y + y0 - center.y) / ry;
    if (dx * dx + dy * dy > 1) continue;
    const g = (y + y0) * W + x + x0, i = g * 4;
    if (!fg[g]) continue;
    const r = rgba[i], gg = rgba[i + 1], b = rgba[i + 2], l = luma(r, gg, b);
    const dSkin = Math.abs(r - skin[0]) + Math.abs(gg - skin[1]) + Math.abs(b - skin[2]);
    const sat = Math.max(r, gg, b) - Math.min(r, gg, b);
    // bianco: chiaro e poco saturo, anche in ombra (grigio-azzurro: avvocato) purché quasi senza colore
    // (+ bianco in ombra rosata: Rita, 9 ott — l > 110, poco saturo, blu ≥ 0,65 rosso: la pelle ha meno blu)
    const sclera = (l > 170 && sat < 60) || (l > 120 && sat < 35) || (l > 110 && sat < 70 && b > 0.65 * r && dSkin > 60);
    // iride: blu (b > r) o VERDE (g > r: Robin Hood); le ciglia castane (r > g) restano fuori
    // (iride castana: niente regola di colore, che prendeva anche ombretto e ciglia della Domatrice; la prende la
    // chiusura per righe fra il bianco a sinistra e quello a destra)
    const iris = dSkin > 120 && ((l > 45 && b > r) || (l > 25 && gg > r + 20));
    if (sclera || iris) m[y * w + x] = 1;
    if (iris && !sclera) irisCol[y * w + x] = 1;
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
    if (k === best || c.n < Math.min(0.1 * bestN, 12)) continue;
    const ov = Math.min(c.yb, B.yb) - Math.max(c.ya, B.ya) + 1;
    if (ov >= 0.5 * (c.yb - c.ya + 1)) keep.add(k);
  }
  const hole = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) if (keep.has(comp[i])) hole[i] = 1;
  const base = hole.slice();
  let nBase = 0, nCol = 0; for (let i = 0; i < w * h; i++) if (base[i]) { nBase++; if (irisCol[i]) nCol++; }
  // buchi interni chiusi (pixel non raggiungibili dal bordo del riquadro)
  const closeInside = () => {
    const out = new Uint8Array(w * h), q = [];
    for (let i = 0; i < w * h; i++) { const x = i % w, y = (i / w) | 0; if ((x === 0 || y === 0 || x === w - 1 || y === h - 1) && !hole[i]) { out[i] = 1; q.push(i); } }
    for (let qi = 0; qi < q.length; qi++) { const i = q[qi], x = i % w, y = (i / w) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue; const j = ny * w + nx; if (!out[j] && !hole[j]) { out[j] = 1; q.push(j); } } }
    for (let i = 0; i < w * h; i++) if (!out[i]) hole[i] = 1;
  };
  closeInside();
  const gapPx = []; // pixel chiusi fra due pixel del buco (fascia centrale dell'iride)
  let circle = false; // iride trovata come cerchio (colore non blu né verde)
  // chiusura per righe: fra due pixel del buco sulla stessa riga (distanza ≤ metà della larghezza del buco)
  // tutto è occhio. Pupilla e parte scura dell'iride toccano il contorno in alto e la chiusura dall'esterno non
  // le prende (Robin Hood: pupilla rimasta nel corpo)
  {
    let hx0 = w, hx1 = -1;
    for (let i = 0; i < w * h; i++) if (hole[i]) { hx0 = Math.min(hx0, i % w); hx1 = Math.max(hx1, i % w); }
    const maxGap = Math.max(0.6 * (hx1 - hx0 + 1), 0.35 * ipd); // iride larga (Rita): bianco piccolo ai due lati
    for (let y = 0; y < h; y++) {
      let last = -1;
      for (let x = 0; x < w; x++) {
        if (!hole[y * w + x]) continue;
        if (last >= 0 && x - last > 1 && x - last <= maxGap) for (let k = last + 1; k < x; k++) { hole[y * w + k] = 1; gapPx.push(y * w + k); }
        last = x;
      }
    }
  }
  // IRIDE DI QUALSIASI COLORE (zeus-mesh-13.3, Rita: iride oliva, solo blu e verde erano riconosciute): l'iride è
  // un CERCHIO. Dai pixel chiusi fra i bianchi (fascia centrale dell'iride) si stimano centro e raggio (metà della
  // fascia più larga); dentro il cerchio vanno nel buco i pixel che non sono pelle. Le ciglia e la riga di eyeliner
  // fuori dal cerchio restano nel corpo (prima, crescendo per colore, il buco prendeva anche loro: righe bianche).
  // solo se l'iride non è stata riconosciuta per colore (blu, verde): con quelle il buco resta com'era
  if (rules_irisGrow && gapPx.length > 4 && nCol < 0.15 * nBase) {
    const rowW = new Map();
    for (const i of gapPx) { const y = (i / w) | 0, x = i % w; const r = rowW.get(y) || [x, x]; r[0] = Math.min(r[0], x); r[1] = Math.max(r[1], x); rowW.set(y, r); }
    let bestY = -1, bw0 = 0, bx = 0;
    for (const [y, [a0, a1]] of rowW) if (a1 - a0 + 1 > bw0) { bw0 = a1 - a0 + 1; bestY = y; bx = (a0 + a1) / 2; }
    let sy = 0, sn = 0; for (const [y, [a0, a1]] of rowW) if (a1 - a0 + 1 >= 0.7 * bw0) { sy += y; sn++; }
    const ccx = bx, ccy = sn ? sy / sn : bestY, rr = Math.min(0.18 * ipd, (bw0 + 2) / 2);
    if (rr >= 3) {
      circle = true;
      // in altezza il cerchio non va oltre l'apertura dell'occhio (bianco e chiusure fra i bianchi, + 2 px): sotto c'è
      // la rima della palpebra inferiore, che non è pelle ma nemmeno occhio (Rita: buco alto, palpebra che stirava
      // la pelle fin sotto l'occhio nel battito)
      let oy0 = h, oy1 = -1;
      for (let i = 0; i < w * h; i++) if (base[i]) { const y = (i / w) | 0; oy0 = Math.min(oy0, y); oy1 = Math.max(oy1, y); }
      for (const i of gapPx) { const y = (i / w) | 0; oy0 = Math.min(oy0, y); oy1 = Math.max(oy1, y); }
      const yLo = oy0 - 0.35 * rr, yHi = oy1 + 2;
      // buco = bianco riconosciuto + cerchio dell'iride (senza pelle) + chiusure fra i bianchi vicine al cerchio;
      // il resto delle chiusure (ciglia, eyeliner sopra l'iride: righe bianche a occhio aperto) torna al corpo
      hole.set(base);
      for (let y = Math.max(0, Math.floor(ccy - rr)); y <= Math.min(h - 1, Math.ceil(ccy + rr)); y++) for (let x = Math.max(0, Math.floor(ccx - rr)); x <= Math.min(w - 1, Math.ceil(ccx + rr)); x++) {
        if ((x - ccx) ** 2 + (y - ccy) ** 2 > rr * rr || y < yLo || y > yHi) continue;
        const g = (y + y0) * W + x + x0, c = g * 4; if (!fg[g]) continue;
        if (Math.abs(rgba[c] - skin[0]) + Math.abs(rgba[c + 1] - skin[1]) + Math.abs(rgba[c + 2] - skin[2]) <= 80) continue;
        // metà alta del cerchio: le ciglia (quasi nere) coprono l'iride sotto la palpebra e restano al corpo
        if (y < ccy - 0.45 * rr && luma(rgba[c], rgba[c + 1], rgba[c + 2]) < 40) continue;
        hole[y * w + x] = 1;
      }
      for (const i of gapPx) if (((i % w) - ccx) ** 2 + (((i / w) | 0) - ccy) ** 2 <= (1.1 * rr) ** 2) hole[i] = 1;
      closeInside();
      // ciglia sopra l'iride (scure, nella parte alta, fuori dalla pupilla) tolte DOPO la chiusura: se restano nel
      // pezzo della pupilla si spostano con lo sguardo e scoprono il bianco (righe bianche fra le ciglia)
      for (let i = 0; i < w * h; i++) {
        if (!hole[i] || base[i]) continue;
        const x = i % w, y = (i / w) | 0; if (y >= ccy - 0.3 * rr || Math.hypot(x - ccx, y - ccy) < 0.45 * rr) continue;
        const c = ((y + y0) * W + x + x0) * 4; if (luma(rgba[c], rgba[c + 1], rgba[c + 2]) < 80) hole[i] = 0;
      }
    }
  }
  let sr = 0, sg = 0, sb = 0, sn = 0;
  const iris = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (!hole[i]) continue;
    const g = ((i / w) | 0) + y0, x = (i % w) + x0, k = (g * W + x) * 4;
    const l = luma(rgba[k], rgba[k + 1], rgba[k + 2]), sat = Math.max(rgba[k], rgba[k + 1], rgba[k + 2]) - Math.min(rgba[k], rgba[k + 1], rgba[k + 2]);
    // bianco solo dove il bianco è stato riconosciuto (componenti iniziali): pixel chiari aggiunti dalle chiusure
    // (luci dell'ombretto fra le ciglia: Rita, righe bianche a occhio aperto) restano col disegno originale
    if (l > 170 && sat < 60 && base[i]) { sr += rgba[k]; sg += rgba[k + 1]; sb += rgba[k + 2]; sn++; } else iris[i] = 1;
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
  return { x0, y0, w, h, hole, iris, skin, circle, white: sn > 10 ? [sr / sn, sg / sn, sb / sn] : [240, 238, 232], box: { x0: x0 + hx0, y0: y0 + hy0, x1: x0 + hx1, y1: y0 + hy1 } };
}

/** Filtro "a binario" dell'oggetto completato (zeus-mesh-10, arco di Robin Hood). */
function trackAlongAxis(seedIdx, addIdx, W, maxWidth = Infinity) {
  // asse principale (PCA) dei pixel; t = lungo l'asse, u = di traverso
  const all = seedIdx.concat(addIdx);
  let mx = 0, my = 0; for (const i of all) { mx += i % W; my += (i / W) | 0; } mx /= all.length; my /= all.length;
  let sxx = 0, syy = 0, sxy = 0; for (const i of all) { const dx = (i % W) - mx, dy = ((i / W) | 0) - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy), ax = Math.cos(ang), ay = Math.sin(ang);
  const T = (i) => Math.round(((i % W) - mx) * ax + (((i / W) | 0) - my) * ay), U = (i) => Math.round(-((i % W) - mx) * ay + (((i / W) | 0) - my) * ax);
  const sb = new Map(); for (const i of seedIdx) { const t = T(i), u = U(i); const b = sb.get(t) || [Infinity, -Infinity]; b[0] = Math.min(b[0], u); b[1] = Math.max(b[1], u); sb.set(t, b); }
  const tMin = Math.min(...sb.keys()), tMax = Math.max(...sb.keys());
  const widths = [...sb.values()].map(([a, b]) => b - a + 1).sort((p, q) => p - q), wMed = Math.min(widths[widths.length >> 1] || 4, maxWidth);
  const ab = new Map(); for (const i of addIdx) { const t = T(i); (ab.get(t) || ab.set(t, []).get(t)).push(i); }
  const keep = new Set();
  // dentro il tratto del seme: solo vicino alla larghezza del seme
  for (let t = tMin; t <= tMax; t++) { const b = sb.get(t); for (const i of ab.get(t) || []) { const u = U(i); if (b && u >= b[0] - wMed && u <= b[1] + wMed) keep.add(i); } }
  // oltre il seme: si segue l'oggetto tratto per tratto in un CORRIDOIO previsto (centro che prosegue con la sua
  // direzione, larghezza media degli ultimi tratti + 4 px). Così si seguono le curve (arco) ma non si entra in una
  // parte toccata di lato (bordo dello stivale), che sta fuori dal corridoio.
  for (const dir of [1, -1]) {
    const t0 = dir > 0 ? tMax : tMin, s0 = sb.get(t0);
    if (!s0) continue;
    const hist = [[(s0[0] + s0[1]) / 2, Math.min(s0[1] - s0[0] + 1, maxWidth)]];
    let miss = 0;
    for (let t = t0 + dir; miss < 3; t += dir) {
      const px = ab.get(t);
      if (!px || !px.length) { miss++; continue; }
      const n = hist.length, last = hist[n - 1], back = hist[Math.max(0, n - 6)];
      const slope = n > 1 ? (last[0] - back[0]) / (n - 1 - Math.max(0, n - 6)) : 0;
      const wAvg = hist.slice(-6).reduce((a, h) => a + h[1], 0) / Math.min(6, n);
      const c = last[0] + slope, half = wAvg / 2 + 4;
      let lo = Infinity, hi = -Infinity;
      const inside = px.filter((i) => { const u = U(i); return u >= c - half && u <= c + half; });
      if (!inside.length) { miss++; continue; }
      miss = 0;
      for (const i of inside) { const u = U(i); lo = Math.min(lo, u); hi = Math.max(hi, u); keep.add(i); }
      hist.push([(lo + hi) / 2, Math.min(hi - lo + 1, maxWidth)]);
    }
  }
  return keep;
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
  // MANO STIMATA (posa a mano "fuori dall'immagine" o braccio nascosto: visibilità del polso 0,3): niente oggetto in
  // quella mano. Rita (10 ott): braccio sotto la pelliccia, un pezzo di pelliccia preso per "oggetto" (5609 px) e
  // pesato rigido sulla mano stimata → strappo nero nella pelliccia quando si muove
  const handGuessed = { sx: (landmarks[15]?.visibility ?? 1) < 0.31, dx: (landmarks[16]?.visibility ?? 1) < 0.31 }; // 0,3 = punto stimato (bustPose, "fuori dall'immagine")
  for (const s of ["sx", "dx"]) if (handGuessed[s]) for (let i = 0; i < W * H; i++) if (lab[i] === L_[`oggetto_${s}`]) lab[i] = L_.busto;
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
  let eyes = rules.cuts.eyes ? [["sx", landmarks[2]], ["dx", landmarks[5]]].map(([s, c]) => { const e = findEye(c, ipd, W, H, rgba, fg); return e && { side: s, ...e }; }).filter(Boolean) : [];
  // occhi STIMATI (posa a mano: visibilità < 0,5) o non trovati: si cercano nel viso (findEyePair)
  if (rules.cuts.eyes && (eyes.length < 2 || (landmarks[2].visibility ?? 1) < 0.5 || (landmarks[5].visibility ?? 1) < 0.5)) {
    const pair = findEyePair(nose, ipd, W, H, rgba, fg);
    if (pair) {
      const ipd2 = Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y);
      // il centro del gruppo di bianco può stare da un lato dell'iride (Rita: solo il bianco verso il naso): si prova
      // anche spostati di lato e si tiene l'occhio più grande che resta della forma di un occhio
      const best = (c) => {
        let b = null;
        for (const k of [0, -1, 1, -2, 2]) {
          const e = findEye({ x: c.x + k * 0.18 * ipd2, y: c.y }, ipd2, W, H, rgba, fg);
          if (!e) continue;
          const bw = e.box.x1 - e.box.x0 + 1, bh = e.box.y1 - e.box.y0 + 1;
          if (bw > 0.9 * ipd2 || bh > 0.5 * ipd2) continue;
          let n = 0; for (let i = 0; i < e.w * e.h; i++) n += e.hole[i];
          if (!b || n > b.n) b = { e, n };
        }
        return b && b.e;
      };
      const found = [["sx", pair[0]], ["dx", pair[1]]].map(([s, c]) => { const e = best(c); return e && { side: s, ...e }; }).filter(Boolean);
      if (found.length === 2) eyes = found;
    }
  }

  // braccio LIBERO: campioni lungo omero (dal 35%) e avambraccio; "a contatto" se entro 0,12 spalle c'è il busto
  // (vestito, giacca). Libero = alzato e ≥ 70% dei campioni senza contatto; omero libero = taglio dalla spalla
  const free = {};
  for (const s of ["sx", "dx"]) {
    const sh = by[`omero_${s}`].head, el = by[`avambraccio_${s}`].head, wr = by[`mano_${s}`].head;
    if ((landmarks[s === "sx" ? 15 : 16]?.visibility ?? 1) < 0.31) continue; // mano stimata
    const r = Math.round(0.12 * shoulderW);
    const touch = (p) => { for (let dy = -r; dy <= r; dy += 2) for (let dx = -r; dx <= r; dx += 2) { if (dx * dx + dy * dy > r * r) continue; const X = Math.round(p.x + dx), Y = Math.round(p.y + dy); if (X < 0 || Y < 0 || X >= W || Y >= H) continue; if (lab[Y * W + X] === L_.busto) return true; } return false; };
    let nu = 0, cu = 0, nf = 0, cf = 0;
    for (let t = 0.35; t <= 1.0001; t += 0.05) { nu++; if (touch(lerp(sh, el, t))) cu++; }
    for (let t = 0; t <= 1.0001; t += 0.05) { nf++; if (touch(lerp(el, wr, t))) cf++; }
    const frac = 1 - (cu + cf) / (nu + nf);
    // solo braccio ALZATO (polso sopra il gomito di almeno mezza spalla: Jessica col bocchino). Le braccia lungo il
    // fianco, sui fianchi (Domatrice) o tese (Zeus, Robin) restano alle regole di prima
    const raised = wr.y <= el.y - 0.5 * shoulderW;
    free[s] = { free: raised && frac >= 0.7, raised, frac, upperFree: raised && cu / nu < 0.3 };
  }
  const decision = decideCuts({ counts, fgN, eyes, hairN, free }, rules);

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

  // orecchini pendenti: pezzo sull'osso orecchino (figlio della testa), perno sul gancio in alto
  const earrings = rules.cuts.earrings ? findEarrings({
    eyesC: decision.eyes && eyes.length === 2 ? ["sx", "dx"].map((sd) => { const b = eyes.find((e) => e.side === sd).box; return { x: (b.x0 + b.x1 + 1) / 2, y: (b.y0 + b.y1 + 1) / 2 }; }) : [landmarks[2], landmarks[5]],
    W, H, rgba, fg, categories, skin: eyes[0]?.skin || [200, 150, 120], shoulderY: Math.min(by.omero_sx.head.y, by.omero_dx.head.y)
  }) : [];
  for (const er of earrings) {
    bones.push({ name: `orecchino_${er.side}`, parent: "testa", head: er.top, tail: er.bot });
    decision.reasons.push(`orecchino_${er.side}: PENDENTE, pezzo che oscilla (${er.idx.length} px)`);
  }
  if (rules.cuts.earrings && !earrings.length) decision.reasons.push("orecchini: nessuno pendente");
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

  // oggetto in mano COMPLETATO: crescita per colore (tavolozza dei pixel riconosciuti) sui pixel del personaggio
  // collegati, poi filtro "a binario" lungo l'asse dell'oggetto (si ferma dove si allarga: bordo dello stivale)
  if (rules.objectGrow) for (const s of decision.arms) {
    const L = L_[`oggetto_${s}`], seedIdx = [];
    for (let i = 0; i < W * H; i++) if (lab[i] === L) seedIdx.push(i);
    if (seedIdx.length < 50) continue;
    const key = (i) => ((rgba[i * 4] >> 5) << 6) | ((rgba[i * 4 + 1] >> 5) << 3) | (rgba[i * 4 + 2] >> 5);
    // tavolozza dai pixel dell'oggetto lontani dalla mano (vicino alla mano il riconoscimento prende anche dita e polsino)
    const hd = by[`mano_${s}`].tail, hr = 0.25 * shoulderW;
    const pal = seedIdx.filter((i) => Math.hypot((i % W) - hd.x, ((i / W) | 0) - hd.y) > hr);
    const src = pal.length >= 0.3 * seedIdx.length ? pal : seedIdx;
    const hist = new Uint32Array(512);
    for (const i of src) hist[key(i)]++;
    const okBin = new Uint8Array(512);
    for (let k = 0; k < 512; k++) if (hist[k] >= 0.01 * src.length) okBin[k] = 1;
    // categoria del segmentatore: se l'oggetto è quasi tutto di una categoria che non è "vestiti" (es. accessori),
    // si cresce solo dentro quella categoria (lo stivale e la cintura sono "vestiti")
    let catOnly = -1;
    if (categories) {
      const cc = new Map(); for (const i of seedIdx) cc.set(categories[i], (cc.get(categories[i]) || 0) + 1);
      const [c0, n0] = [...cc.entries()].sort((a, b) => b[1] - a[1])[0];
      if (n0 >= 0.6 * seedIdx.length && c0 !== SEG.clothes && c0 !== SEG.background) catOnly = c0;
    }
    const seen = new Uint8Array(W * H), q = seedIdx.slice(), addIdx = [];
    for (const i of seedIdx) seen[i] = 1;
    const cap = (rules.objectGrowMax ?? 6) * seedIdx.length;
    for (let k = 0; k < q.length && addIdx.length < cap; k++) {
      const i = q[k], x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (seen[j] || !fg[j] || lab[j] === L_.testa || lab[j] === L || !okBin[key(j)] || (catOnly >= 0 && categories[j] !== catOnly)) continue;
        seen[j] = 1; q.push(j); addIdx.push(j);
      }
    }
    // larghezza massima di un oggetto tenuto in mano (arco, spada, freccia): 0,3 × larghezza spalle
    const keep = addIdx.length ? trackAlongAxis(seedIdx, addIdx, W, 0.3 * shoulderW) : new Set();
    for (const i of keep) if (lab[i] !== L_[`braccio_${s}`]) lab[i] = L;
    // contorno e ombre dell'oggetto (pixel scuri fino a 4 px attorno): fanno parte dell'oggetto
    if (keep.size) {
      let ring = [...keep];
      for (let pass = 0; pass < 4; pass++) {
        const next = [];
        for (const i of ring) { const x = i % W, y = (i / W) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const j = ny * W + nx; if (fg[j] && lab[j] !== L && lab[j] !== L_.testa && lab[j] !== L_[`braccio_${s}`] && luma(rgba[j * 4], rgba[j * 4 + 1], rgba[j * 4 + 2]) < 90) { lab[j] = L; next.push(j); keep.add(j); } } }
        ring = next;
      }
    }
    if (keep.size) decision.reasons.push(`oggetto_${s}: completato per colore lungo l'asse (+${keep.size} px ai ${seedIdx.length} riconosciuti)`);
  }

  // ---- immagini ----
  const armMask = new Uint8Array(W * H);
  const armFrom = {};
  for (const s of decision.arms) {
    const hairOut = [];
    const sh = by[`omero_${s}`].head, el = by[`avambraccio_${s}`].head, hip = landmarks[s === "sx" ? 23 : 24];
    const ang = Math.abs(deg(Math.atan2(el.y - sh.y, el.x - sh.x) - Math.atan2(hip.y - sh.y, hip.x - sh.x)));
    const down = Math.min(ang, 360 - ang);
    // omero lungo il fianco MA staccato dal busto (Jessica: braccio sollevato, omero davanti ai capelli): dalla spalla
    armFrom[s] = rules.armFrom === "auto" || !rules.armFrom ? (down <= rules.armDownMaxDeg && !free[s]?.upperFree ? "gomito" : "spalla") : rules.armFrom;
    decision.reasons.push(`braccio_${s} tagliato dal${armFrom[s] === "gomito" ? " GOMITO (omero lungo il fianco" : "la SPALLA (braccio staccato dal busto"}, ${down.toFixed(0)}°)`);
    const fore = PART[`avambraccio_${s}`], wr = by[`mano_${s}`].head;
    const dx = wr.x - el.x, dy = wr.y - el.y, len = Math.hypot(dx, dy) || 1, ov = (rules.elbowOverlap ?? 0.08) * shoulderW;
    for (let i = 0; i < W * H; i++) {
      if (lab[i] === L_[`oggetto_${s}`]) { armMask[i] = 1; continue; }
      if (lab[i] !== L_[`braccio_${s}`]) continue;
      // i CAPELLI non vanno nel pezzo del braccio (Jessica: le ciocche accanto al braccio alzato erano "braccio" per
      // geometria; il pezzo se le portava via e nel corpo restava un buco): restano al corpo
      if (categories && categories[i] === SEG.hair) { hairOut.push(i); continue; }
      if (armFrom[s] === "spalla") { armMask[i] = 1; continue; }
      // dal gomito: avambraccio e mano, oltre il gomito lungo gomito→polso (meno la sovrapposizione)
      const x = i % W, y = (i / W) | 0, t = ((x - el.x) * dx + (y - el.y) * dy) / len;
      if (t >= -ov && (parts[i] === fore || Math.hypot(x - el.x, y - el.y) <= ov)) armMask[i] = 1;
    }
    // capelli esclusi: restano al corpo solo se collegati ai capelli fuori dal braccio; le "isole" chiuse nel braccio
    // (ombre della pelle prese per capelli) vanno nel pezzo, altrimenti nel corpo restano frammenti scoperti
    if (hairOut.length) {
      const ex = new Uint8Array(W * H); for (const i of hairOut) ex[i] = 1;
      const keep = new Uint8Array(W * H), q = [];
      for (const i of hairOut) { const x = i % W, y = (i / W) | 0; for (const [ddx, ddy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + ddx, ny = y + ddy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const j = ny * W + nx; if (!ex[j] && !armMask[j] && fg[j] && lab[j] !== L_[`braccio_${s}`] && lab[j] !== L_[`oggetto_${s}`]) { keep[i] = 1; q.push(i); break; } } }
      for (let k = 0; k < q.length; k++) { const i = q[k], x = i % W, y = (i / W) | 0; for (const [ddx, ddy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + ddx, ny = y + ddy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const j = ny * W + nx; if (ex[j] && !keep[j]) { keep[j] = 1; q.push(j); } } }
      for (const i of hairOut) { if (keep[i]) lab[i] = L_.testa; else armMask[i] = 1; }
    }
  }
  // isole del corpo staccate dal resto che toccano il braccio tagliato (pezzi d'oggetto non
  // riconosciuti, es. il cerchio vicino alla mano): vanno nel pezzo, non restano sospese nel corpo
  if (decision.arms.length) {
    // distanza dal pezzo (braccio + oggetto) fino a 0,45 spalle: il fumo staccato dalla punta della sigaretta (Jessica,
    // 10 ott: fumo rimasto fermo mentre il bocchino si sposta) è lontano dalla mano ma vicino all'oggetto
    const reach = Math.ceil(0.45 * shoulderW), dArm = new Int32Array(W * H).fill(-1), dq2 = [];
    for (let i = 0; i < W * H; i++) if (armMask[i]) { dArm[i] = 0; dq2.push(i); }
    for (let k = 0; k < dq2.length; k++) { const i = dq2[k]; if (dArm[i] >= reach) continue; const x = i % W, y = (i / W) | 0; for (const [ddx, ddy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + ddx, ny = y + ddy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const j = ny * W + nx; if (dArm[j] < 0) { dArm[j] = dArm[i] + 1; dq2.push(j); } } }
    const comp = new Int32Array(W * H).fill(-1), sizes = [];
    for (let s0 = 0; s0 < W * H; s0++) {
      if (!fg[s0] || armMask[s0] || comp[s0] >= 0) continue;
      const id = sizes.length, st = [s0]; comp[s0] = id; let n = 0, touch = false, near = null, nd = Infinity, nearPiece = Infinity;
      while (st.length) {
        const i = st.pop(); n++; const x = i % W, y = (i / W) | 0;
        // isole vicine a una mano tagliata (fumo della sigaretta di Jessica, staccato dal bocchino): con quella mano
        for (const a of decision.arms) { const hp = by[`mano_${a}`].tail, d = Math.hypot(x - hp.x, y - hp.y); if (d < nd) { nd = d; near = a; } }
        if (dArm[i] >= 0 && dArm[i] < nearPiece) nearPiece = dArm[i];
        for (const [ddx, ddy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + ddx, ny = y + ddy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const j = ny * W + nx; if (armMask[j]) touch = true; else if (fg[j] && comp[j] < 0) { comp[j] = id; st.push(j); } }
      }
      sizes.push({ n, touch, near, nd, nearPiece });
    }
    const main = sizes.reduce((b, c, k) => (c.n > sizes[b].n ? k : b), 0);
    for (let i = 0; i < W * H; i++) {
      const c = comp[i]; if (c < 0 || c === main || sizes[c].n >= 0.02 * fgN) continue;
      const z = sizes[c];
      // (briciole di pochi pixel no: attaccate al pezzo allargavano la maschera "oggetto fermo" di Zeus)
      if (!(z.touch || z.nd < 0.9 * shoulderW || (z.nearPiece <= reach && z.n >= 30))) continue;
      armMask[i] = 1; const s = z.touch ? decision.arms[0] : z.near; if (lab[i] !== L_[`braccio_${s}`]) lab[i] = L_[`oggetto_${s}`];
    }
    // contorno scuro del braccio (riga nera del disegno, 3 px): va col pezzo, altrimenti resta nel corpo e quando il
    // braccio si muove si vede un alone scuro (Jessica)
    for (let k = 0; k < 3; k++) {
      const add = [];
      for (let i = 0; i < W * H; i++) {
        if (armMask[i] || !fg[i] || lab[i] === L_.testa || (categories && categories[i] === SEG.hair)) continue;
        const c = i * 4; if (luma(rgba[c], rgba[c + 1], rgba[c + 2]) >= 100) continue;
        const x = i % W, y = (i / W) | 0;
        for (const [ddx, ddy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + ddx, ny = y + ddy; if (nx >= 0 && ny >= 0 && nx < W && ny < H && armMask[ny * W + nx]) { add.push(i); break; } }
      }
      for (const i of add) armMask[i] = 1;
    }
    // frammenti del pezzo staccati dal braccio (righe d'ombra fra le ciocche: Jessica) tornano al corpo, altrimenti
    // restano scoperti (né nel pezzo, dove la mesh li salta, né nel corpo). Restano: il braccio, i pezzi grandi e quelli
    // con pixel d'oggetto (fumo, bocchino)
    {
      const comp = new Int32Array(W * H).fill(-1), info = [];
      for (let s0 = 0; s0 < W * H; s0++) {
        if (!armMask[s0] || comp[s0] >= 0) continue;
        const id = info.length, st = [s0], px = []; comp[s0] = id; let obj = false;
        while (st.length) { const i = st.pop(); px.push(i); if (decision.arms.some((a) => lab[i] === L_[`oggetto_${a}`])) obj = true; const x = i % W, y = (i / W) | 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const j = ny * W + nx; if (armMask[j] && comp[j] < 0) { comp[j] = id; st.push(j); } } }
        info.push({ px, obj });
      }
      const big = Math.max(...info.map((c) => c.px.length));
      for (const c of info) if (!c.obj && c.px.length < 0.02 * big) for (const i of c.px) { armMask[i] = 0; if (decision.arms.some((a) => lab[i] === L_[`braccio_${a}`])) lab[i] = L_.busto; }
    }
  }
  const earMask = new Uint8Array(W * H);
  for (const er of earrings) for (const i of er.idx) earMask[i] = 1;
  const holeMask = new Uint8Array(W * H);
  for (const e of decision.eyes ? eyes : []) for (let i = 0; i < e.w * e.h; i++) if (e.hole[i]) holeMask[(Math.floor(i / e.w) + e.y0) * W + (i % e.w) + e.x0] = 1;
  // corpo: originale meno braccio tagliato, capelli dietro e buchi degli occhi; dietro il braccio,
  // vicino al busto, riempimento dai pixel vicini (zona nascosta a riposo)
  const body = new Uint8ClampedArray(W * H * 4);
  const known = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (!fg[i] || armMask[i] || hair[i] || holeMask[i] || earMask[i]) continue;
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
    if (!s || !(armFrom[s] === "gomito" || y <= elbowY[s])) continue;
    if (free[s]?.raised) continue; // braccio alzato: dietro si riempie per righe (fillRows)
    // pixel dell'OGGETTO: si riempie solo se sta DENTRO la sagoma del corpo (corpo da due lati opposti entro la
    // fascia), non accanto a una parte sottile (corda dell'arco di Robin Hood: macchia di riempimento vicino alla
    // punta che si vedeva quando l'arco si muove)
    if (lab[i] === L_[`oggetto_${s}`]) {
      const x = i % W, R = Math.ceil(fillR);
      const side = (dx, dy) => { for (let k = 1; k <= R; k++) { const nx = x + dx * k, ny = y + dy * k; if (nx < 0 || ny < 0 || nx >= W || ny >= H) return false; if (known[ny * W + nx]) return true; } return false; };
      if (!((side(1, 0) && side(-1, 0)) || (side(0, 1) && side(0, -1)))) continue;
    }
    holes.push(i);
  }
  // dietro l'orecchino (e il braccio ALZATO): riga per riga, sfumatura fra il pixel del corpo a sinistra e quello a
  // destra (capelli, collo). Il riempimento "dai vicini" portava la pelle sopra i capelli (macchia che si vedeva quando
  // il pezzo si muove: orecchini di Rita, braccio di Jessica). Contro lo sfondo da un lato: resta vuoto.
  const fillRows = (idx, mask, R, oneSide = 0) => {
    const rows = new Map();
    for (const i of idx) { const y = (i / W) | 0, x = i % W; const r = rows.get(y) || [x, x]; r[0] = Math.min(r[0], x); r[1] = Math.max(r[1], x); rows.set(y, r); }
    for (const [y, [xa, xb]] of rows) {
      let L = -1, Rr = -1;
      for (let x = xa - 1; x >= Math.max(0, xa - R); x--) { const j = y * W + x; if (known[j]) { L = x; break; } if (!fg[j]) break; }
      for (let x = xb + 1; x <= Math.min(W - 1, xb + R); x++) { const j = y * W + x; if (known[j]) { Rr = x; break; } if (!fg[j]) break; }
      if (L < 0 || Rr < 0) {
        // un lato solo, ed è CAPELLI (braccio alzato davanti alle ciocche): i capelli continuano dietro per un tratto
        const side = L >= 0 ? L : Rr; if (side < 0 || !categories || categories[y * W + side] !== SEG.hair || !oneSide) continue;
        const c0 = rgba.subarray((y * W + side) * 4, (y * W + side) * 4 + 4), dir = L >= 0 ? 1 : -1;
        for (let k = 1; k <= oneSide; k++) { const x = side + dir * k; if (x < 0 || x >= W) break; const j = y * W + x; if (known[j]) continue; if (!mask[j]) break; for (let q = 0; q < 3; q++) body[j * 4 + q] = c0[q]; body[j * 4 + 3] = 255; }
        continue;
      }
      let cl = rgba.subarray((y * W + L) * 4, (y * W + L) * 4 + 4), cr = rgba.subarray((y * W + Rr) * 4, (y * W + Rr) * 4 + 4);
      // capelli da un lato e pelle dall'altro: dietro ci sono i capelli, non una sfumatura
      if (categories) { const hl = categories[y * W + L] === SEG.hair, hr = categories[y * W + Rr] === SEG.hair; if (hl && !hr) cr = cl; else if (hr && !hl) cl = cr; }
      for (let x = L + 1; x < Rr; x++) {
        const j = y * W + x; if (known[j] || !mask[j]) continue;
        const t = (x - L) / (Rr - L);
        for (let k = 0; k < 3; k++) body[j * 4 + k] = cl[k] * (1 - t) + cr[k] * t;
        body[j * 4 + 3] = 255;
      }
    }
  };
  for (const er of earrings) fillRows(er.idx, earMask, Math.ceil(0.2 * shoulderW));
  for (const s of decision.arms) if (free[s]?.raised) {
    const idx = []; for (let i = 0; i < W * H; i++) if (armMask[i] && (lab[i] === L_[`braccio_${s}`] || lab[i] === L_[`oggetto_${s}`])) idx.push(i);
    fillRows(idx, armMask, Math.ceil(0.5 * shoulderW), Math.ceil(0.3 * shoulderW));
  }
  fillHoles(body, known, W, H, holes);
  const crop = (src, bx0, by0, bw, bh) => { const out = new Uint8ClampedArray(bw * bh * 4); for (let y = 0; y < bh; y++) out.set(src.subarray(((y + by0) * W + bx0) * 4, ((y + by0) * W + bx0 + bw) * 4), y * bw * 4); return out; };
  const images = { corpo: { width: cw, height: ch, rgba: crop(body, x0, y0, cw, ch) } };

  // maschera BLOCCO: pixel fermi (pezzo del braccio + oggetto rimasto nel corpo) e sfumatura attorno
  let lockAt = null;
  if (rules.lockObject && decision.arms.length) {
    const seed = new Uint8Array(W * H), q = [];
    for (let i = 0; i < W * H; i++) if (armMask[i]) { seed[i] = 1; q.push(i); }
    // parti dell'oggetto rimaste nel corpo: stessi colori dell'oggetto, collegate al pezzo
    const key = (i) => ((rgba[i * 4] >> 5) << 6) | ((rgba[i * 4 + 1] >> 5) << 3) | (rgba[i * 4 + 2] >> 5);
    const hist = new Uint32Array(512); let no = 0;
    for (let i = 0; i < W * H; i++) if (armMask[i] && decision.arms.some((s) => lab[i] === L_[`oggetto_${s}`])) { hist[key(i)]++; no++; }
    const okBin = new Uint8Array(512);
    for (let k = 0; k < 512; k++) if (no && hist[k] >= 0.004 * no) okBin[k] = 1;
    // con l'oggetto già completato (R13) al massimo 0,08 spalle dal pezzo (Zeus, 9 ott: i colori del fulmine — oro e bianco — sono anche su tunica e
    // cintura, la crescita senza limite di distanza bloccava tutto il busto sulla radice)
    const cap = 10 * no, maxD = rules.objectGrow ? Math.max(3, Math.round(rules.lockGrow * shoulderW)) : 65535, depth = new Uint16Array(W * H);
    let added = 0;
    for (let k = 0; k < q.length && added < cap; k++) {
      const i = q[k], x = i % W, y = (i / W) | 0;
      if (depth[i] >= maxD) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (seed[j] || !fg[j] || lab[j] === L_.testa || !okBin[key(j)]) continue;
        seed[j] = 1; depth[j] = depth[i] + 1; q.push(j); added++;
      }
    }
    // tutto ciò che sta DENTRO il contorno convesso dell'oggetto è fermo anche lui (corda dell'arco tesa fra le punte)
    {
      const pts = [];
      for (let i = 0; i < W * H; i++) if (armMask[i] && decision.arms.some((s) => lab[i] === L_[`oggetto_${s}`])) pts.push([i % W, (i / W) | 0]);
      if (pts.length > 2) {
        pts.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
        const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
        const lower = [], upper = [];
        for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
        for (let k = pts.length - 1; k >= 0; k--) { const p = pts[k]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
        const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
        let hy0 = H, hy1 = -1; for (const [, y] of hull) { hy0 = Math.min(hy0, y); hy1 = Math.max(hy1, y); }
        let inHull = 0;
        for (let y = hy0; y <= hy1; y++) {
          const xs = [];
          for (let k = 0; k < hull.length; k++) { const [ax, ay] = hull[k], [bx, by] = hull[(k + 1) % hull.length]; if ((ay <= y && by > y) || (by <= y && ay > y)) xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax)); }
          if (xs.length < 2) continue;
          const mg = Math.round(0.03 * shoulderW); // margine: la corda sta sul bordo del contorno
          const xa = Math.ceil(Math.min(...xs)) - mg, xb = Math.floor(Math.max(...xs)) + mg;
          for (let x = Math.max(0, xa); x <= Math.min(W - 1, xb); x++) { const j = y * W + x; if (fg[j] && !seed[j] && (lab[j] !== L_.testa || Math.hypot(x - face.x, y - face.y) > faceR)) { seed[j] = 1; inHull++; } }
        }
        added += inHull;
      }
    }
    // nucleo fermo largo una cella della griglia (i vertici distano fino a mezza cella dai pixel bloccati), poi sfumatura
    const core = Math.max(cw, ch) / rules.cells, R = rules.lockBand * shoulderW, dist = new Float32Array(W * H).fill(Infinity), dq = [];
    for (let i = 0; i < W * H; i++) if (seed[i]) { dist[i] = 0; dq.push(i); }
    for (let k = 0; k < dq.length; k++) { const i = dq[k]; if (dist[i] >= R + core) continue; const x = i % W, y = (i / W) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const j = ny * W + nx; if (dist[j] !== Infinity) continue; dist[j] = dist[i] + 1; dq.push(j); } }
    lockAt = (px, py) => { const d = dist[Math.min(H - 1, Math.max(0, Math.round(py))) * W + Math.min(W - 1, Math.max(0, Math.round(px)))]; return d === Infinity ? 0 : d <= core ? 1 : smooth(1 - (d - core) / R); };
    decision.reasons.push(`oggetto FERMO: braccio e oggetto bloccati, maschera di ${Math.round(R)} px attorno (+${added} px d'oggetto rimasti nel corpo)`);
  }

  // ---- mesh generica su un riquadro ----
  // zone fitte (R16): articolazioni e viso, dove la mesh si piega di più
  const denseAt = [face, by.collo.head, by.testa.head, ...["sx", "dx"].flatMap((s) => [by[`omero_${s}`].head, by[`avambraccio_${s}`].head, by[`mano_${s}`].head])];
  const denseR = [faceR, ...denseAt.slice(1).map(() => 0.2 * shoulderW)];
  // attorno a ogni OCCHIO il corpo è viso al 100% (palpebra, bianco e pupilla stanno sulle ossa dell'occhio, figlie
  // di viso): nucleo fino all'anello esterno della palpebra, poi sfuma in 1,5 passi verso il peso normale (R18)
  const eyeRing = (decision.eyes ? eyes : []).map((e) => { const b = e.box, ew = b.x1 - b.x0 + 1, eh = b.y1 - b.y0 + 1; return { x: (b.x0 + b.x1 + 1) / 2, y: (b.y0 + b.y1 + 1) / 2, r: Math.max(ew / 2 + 0.55 * eh, eh / 2 + 0.9 * eh) }; });
  const faceF = (px, py, step = 0) => {
    let f = smooth(1 - Math.hypot(px - face.x, py - face.y) / faceR);
    for (const e of eyeRing) { const d = Math.hypot(px - e.x, py - e.y) - e.r; f = Math.max(f, d <= 0 ? 1 : smooth(1 - d / Math.max(1, 1.5 * step))); }
    return f;
  };
  const meshW = {}; // pesi finali per mesh (per saldare le palpebre al corpo)
  function gridMesh(name, bx0, by0, bw, bh, cells, labelAt, lockF = null) {
    const step = Math.max(bw, bh) / cells;
    let order, hull, triangles = null, U, V, edges = null;
    const img = rules.meshShape !== "griglia" && images[name];
    const sil = img && img.width === bw && img.height === bh
      ? silhouetteMesh(Uint8Array.from({ length: bw * bh }, (_, i) => img.rgba[i * 4 + 3]), bw, bh, step,
          (x, y) => (denseAt.some((p, k) => Math.hypot(bx0 + x - p.x, by0 + y - p.y) < denseR[k]) ? rules.denseStep * step : step))
      : null;
    if (sil) {
      // MESH SULLA SAGOMA: contorno sui pixel visibili, vertici solo dentro
      order = sil.points; hull = sil.hull; triangles = sil.triangles; edges = sil.edges;
      U = (p) => p[0] / bw; V = (p) => p[1] / bh;
    } else {
      const cols = Math.max(2, Math.round(bw / step)), rows = Math.max(2, Math.round(bh / step));
      order = [];
      for (let c = 0; c <= cols; c++) order.push([c, 0]);
      for (let r = 1; r <= rows; r++) order.push([cols, r]);
      for (let c = cols - 1; c >= 0; c--) order.push([c, rows]);
      for (let r = rows - 1; r >= 1; r--) order.push([0, r]);
      hull = order.length;
      for (let r = 1; r < rows; r++) for (let c = 1; c < cols; c++) order.push([c, r]);
      const idx = new Map(order.map(([c, r], i) => [`${c},${r}`, i]));
      triangles = [];
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const a = idx.get(`${c},${r}`), b = idx.get(`${c + 1},${r}`), d = idx.get(`${c},${r + 1}`), e = idx.get(`${c + 1},${r + 1}`);
        triangles.push(a, b, e, a, e, d);
      }
      U = (p) => p[0] / cols; V = (p) => p[1] / rows;
    }
    const uvs = [], vertices = [], WS = [], pin = [], XY = [], LB = [], PX = [];
    for (const p of order) {
      // coordinate sui BORDI dei pixel, come le UV di Spine (u = 0 bordo sinistro, u = 1 bordo destro)
      const px = bx0 + U(p) * bw, py = by0 + V(p) * bh;
      uvs.push(+U(p).toFixed(5), +V(p).toFixed(5));
      const label = labelAt(px, py, step);
      const w = chainWeights({ x: px, y: py }, C[label] || C.busto);
      LB.push(label);
      if (label === "testa") {
        const f = faceF(px, py, step);
        if (f > 0) { for (const k in w) w[k] *= 1 - f; w.viso = (w.viso || 0) + f; }
      }
      let fixed = String(label).startsWith("oggetto_") || (label === "testa" && w.viso >= 0.999); // oggetto rigido (M4); pelle attorno agli occhi
      if (lockF && lockF(px, py) >= 0.999) fixed = true;
      WS.push(w); pin.push(fixed); XY.push(toS({ x: px, y: py })); PX.push({ x: px, y: py });
    }
    const nb = order.map(() => new Set());
    for (let t = 0; t < triangles.length; t += 3) for (let e = 0; e < 3; e++) { const a = triangles[t + e], b = triangles[t + ((e + 1) % 3)]; nb[a].add(b); nb[b].add(a); }
    // oggetto rigido e blocco
    for (let i = 0; i < WS.length; i++) {
      const { x: px, y: py } = PX[i];
      if (String(LB[i]).startsWith("oggetto_")) { const s = String(LB[i]).slice(8); WS[i] = { [`mano_${s}`]: 1 }; }
      if (lockF) {
        const f = lockF(px, py), v = WS[i];
        if (f > 0) { for (const k in v) v[k] *= 1 - f; v.root = (v.root || 0) + f; }
      }
    }
    // PESI MORBIDI (R17): media coi vicini lungo i lati dei triangoli (solo DENTRO la mesh: due parti vicine ma
    // staccate non si scambiano pesi), più passate; oggetto rigido e zona bloccata restano come sono
    for (let it = 0; it < (rules.weightSmooth ?? 0); it++) {
      const next = WS.map((w, i) => {
        if (pin[i] || !nb[i].size) return w;
        const acc = {};
        for (const k in w) acc[k] = 0.5 * w[k];
        const share = 0.5 / nb[i].size;
        for (const j of nb[i]) for (const k in WS[j]) acc[k] = (acc[k] || 0) + share * WS[j][k];
        return acc;
      });
      for (let i = 0; i < WS.length; i++) WS[i] = next[i];
    }
    const FW = [];
    for (let i = 0; i < order.length; i++) {
      // al massimo 4 ossa, pesi < 2% tolti, somma esattamente 1
      const ws = Object.entries(WS[i]).filter(([, v]) => v > 0.02).sort((a, b) => b[1] - a[1]).slice(0, 4);
      const tot = ws.reduce((a, [, v]) => a + v, 0);
      const r = ws.map(([, v]) => +(v / tot).toFixed(4));
      r[0] = +(1 - r.slice(1).reduce((a, v) => a + v, 0)).toFixed(4);
      FW.push(Object.fromEntries(ws.map(([bn], k) => [bn, r[k]])));
      const sp = XY[i];
      vertices.push(ws.length);
      ws.forEach(([bn], k) => {
        const b = world[bn], dx = sp.x - b.x, dy = sp.y - b.y, co = Math.cos(-b.a), si = Math.sin(-b.a);
        vertices.push(boneIndex[bn], +(dx * co - dy * si).toFixed(2), +(dx * si + dy * co).toFixed(2), r[k]);
      });
    }
    meshW[name] = { P: PX, W: FW, T: triangles };
    return { type: "mesh", path: name, uvs, triangles, vertices, hull, ...(edges ? { edges } : {}), width: bw, height: bh };
  }
  // pesi del corpo in un punto qualsiasi (triangolo che lo contiene, coordinate baricentriche)
  const weightsAt = (name, p) => {
    const m = meshW[name]; if (!m) return null;
    let best = null, bd = Infinity;
    for (let t = 0; t < m.T.length; t += 3) {
      const A = m.P[m.T[t]], B = m.P[m.T[t + 1]], Cc = m.P[m.T[t + 2]];
      const d = (B.y - Cc.y) * (A.x - Cc.x) + (Cc.x - B.x) * (A.y - Cc.y); if (!d) continue;
      const u = ((B.y - Cc.y) * (p.x - Cc.x) + (Cc.x - B.x) * (p.y - Cc.y)) / d, v = ((Cc.y - A.y) * (p.x - Cc.x) + (A.x - Cc.x) * (p.y - Cc.y)) / d, w = 1 - u - v;
      const out = -Math.min(0, u, v, w);
      if (out < bd) { bd = out; best = [[m.T[t], u], [m.T[t + 1], v], [m.T[t + 2], w]]; if (!out) break; }
    }
    const acc = {};
    for (const [i, c] of best) { const cc = Math.max(0, c); for (const k in m.W[i]) acc[k] = (acc[k] || 0) + cc * m.W[i][k]; }
    const ws = Object.entries(acc).filter(([, v]) => v > 0.02).sort((a, b) => b[1] - a[1]).slice(0, 3), tot = ws.reduce((a, [, v]) => a + v, 0);
    return ws.map(([k, v]) => [k, +(v / tot).toFixed(4)]);
  };
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
  attachments.corpo = gridMesh("corpo", x0, y0, cw, ch, rules.cells, (px, py, step) => bodyMap(majority(() => true, nearLabel)(px, py, step)), lockAt);

  // pezzi tagliati
  const pieceBoxes = {};
  const pieceOf = (mask, name, map, cells, lockF = null) => {
    let a = W, b = H, c = -1, d = -1;
    for (let i = 0; i < W * H; i++) if (mask[i]) { const x = i % W, y = (i / W) | 0; a = Math.min(a, x); c = Math.max(c, x); b = Math.min(b, y); d = Math.max(d, y); }
    a = Math.max(0, a - 2); b = Math.max(0, b - 2); c = Math.min(W - 1, c + 2); d = Math.min(H - 1, d + 2);
    const bw = c - a + 1, bh = d - b + 1, px = new Uint8ClampedArray(bw * bh * 4);
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) { const g = (y + b) * W + x + a; if (mask[g]) px.set(rgba.subarray(g * 4, g * 4 + 4), (y * bw + x) * 4); }
    images[name] = { width: bw, height: bh, rgba: px };
    attachments[name] = gridMesh(name, a, b, bw, bh, cells, map, lockF);
    { const p0 = toS({ x: a, y: b + bh }); pieceBoxes[name] = { x: +p0.x.toFixed(1), y: +p0.y.toFixed(1), width: bw, height: bh }; } // riquadro nello skeleton (per l'inquadratura)
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
    pieceOf(armMask, `braccio_${s}`, (px, py, step) => majority(own, fallback)(px, py, step), rules.pieceCells, lockAt ? () => 1 : null);
  }
  if (decision.hair) pieceOf(hair, "capelli_dietro", () => "capelli", 8);

  // occhi: bianco (sotto), pupilla (sotto, si muove), palpebra (davanti, battito)
  const region = (name, boneName, bx0, by0, bw, bh, px) => {
    images[name] = { width: bw, height: bh, rgba: px };
    const b = world[boneName], cxy = toS({ x: bx0 + bw / 2, y: by0 + bh / 2 }), dx = cxy.x - b.x, dy = cxy.y - b.y, co = Math.cos(-b.a), si = Math.sin(-b.a);
    attachments[name] = { x: +(dx * co - dy * si).toFixed(2), y: +(dx * si + dy * co).toFixed(2), rotation: +deg(-b.a).toFixed(2), width: bw, height: bh };
  };
  for (const er of earrings) {
    let a = W, b = H, c = -1, d = -1;
    for (const i of er.idx) { const x = i % W, y = (i / W) | 0; a = Math.min(a, x); c = Math.max(c, x); b = Math.min(b, y); d = Math.max(d, y); }
    const bw = c - a + 1, bh = d - b + 1, px = new Uint8ClampedArray(bw * bh * 4);
    for (const i of er.idx) { const x = (i % W) - a, y = ((i / W) | 0) - b; px.set(rgba.subarray(i * 4, i * 4 + 4), (y * bw + x) * 4); }
    region(`orecchino_${er.side}`, `orecchino_${er.side}`, a, b, bw, bh, px);
  }
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
    const local = (bb, sp) => { const dx = sp.x - bb.x, dy = sp.y - bb.y, co = Math.cos(-bb.a), si = Math.sin(-bb.a); return [+(dx * co - dy * si).toFixed(2), +(dx * si + dy * co).toFixed(2)]; };
    const uvs = [], vertices = [];
    const push = (p, ws) => {
      uvs.push(+((p.x - bx0) / bw).toFixed(5), +((p.y - by0) / bh).toFixed(5));
      const sp = toS(p);
      vertices.push(ws.length);
      for (const [bn, w] of ws) vertices.push(boneIndex[bn], ...local(world[bn], sp), w);
    };
    // SALDATURA (R18, come "Weld" di Spine): l'anello esterno ha i pesi del CORPO in quel punto (prima: osso
    // dell'occhio al 100%; la pelle del corpo attorno all'occhio è viso solo in parte e la palpebra, sempre
    // disegnata sopra, scivolava di 1–2 px quando la testa ruota: Zeus fino a 1445 pixel diversi)
    const bodyW = (p) => weightsAt("corpo", p) || [[`occhio_${e.side}`, 1]];
    outer.forEach((p) => push(p, bodyW(p)));
    inner.forEach((p) => push(p, [[name, 1]]));
    midR.forEach((p) => { const h = bodyW(p).map(([k, v]) => [k, +(v * 0.5).toFixed(4)]); h[0][1] = +(0.5 - h.slice(1).reduce((a, [, v]) => a + v, 0)).toFixed(4); push(p, [...h, [name, 0.5]]); });
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
  for (const er of earrings) slots.push(slotFor(`orecchino_${er.side}`, `orecchino_${er.side}`));
  for (const s of decision.arms) slots.push(slotFor(`braccio_${s}`, "root"));
  const skinAtt = Object.fromEntries(slots.map((s) => [s.name, { [s.name]: attachments[s.name] }]));

  const json = {
    skeleton: { spine: "4.1.24", x: -cw / 2, y: 0, width: cw, height: ch, images: "./" },
    bones: jsonBones,
    slots,
    skins: [{ name: "default", attachments: skinAtt }],
    animations: { ambient: loopAnimation(rules, ch, decision, eyes, ipd, mouth && { ...mouth, visoA: world.viso.a }, !!smilePatch, earrings) }
  };
  return {
    json,
    images,
    report: { version: MESH_RIG_VERSION, decision: decision.reasons, bones: jsonBones.length, slots: slots.map((s) => s.name), bodyVertices: attachments.corpo.uvs.length / 2, filledBehindArm: holes.length, pieceBoxes }
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
function loopAnimation(rules, height, decision, eyes, ipd, mouth, smileRedrawn = false, earrings = []) {
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
    if (rules.lockObject && decision.arms.includes(s)) continue; // braccio con oggetto FERMO: niente rotazioni
    bones[`omero_${s}`] = { rotate: rot(A.omero, wave(1, ph)) };
    bones[`avambraccio_${s}`] = { rotate: rot(A.avambraccio, wave(1, ph + 0.12)) };
    bones[`mano_${s}`] = { rotate: rot(A.mano, wave(2, ph + 0.2)) };
  }
  // orecchini: pendolo in ritardo sulla testa (follow-through), i due lati sfasati
  for (const er of earrings) bones[`orecchino_${er.side}`] = { rotate: rot(A.orecchini ?? 7, wave(1, er.side === "sx" ? 0.3 : 0.38)) };
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
      // iride a cerchio (colore qualsiasi: il buco segue solo in parte l'iride e le ciglia): sguardo FERMO. Muovendola
      // scopriva il bianco dove il buco taglia l'iride o la rima di sotto (Rita, 10 ott: "righe negli occhi")
      const kx = e.circle ? 0 : 1, ky = e.circle ? 0 : 1;
      bones[`pupilla_${e.side}`] = { translate: xy((t) => -A.pupille * ipd * 0.5 * kx * look(t), (t) => -A.pupille * ipd * 0.25 * ky * look(t)) };
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

/**
 * INQUADRATURA nel pacchetto (zeus-mesh-12): maschera di ritaglio Spine (clipping attachment) rettangolare sul
 * riquadro `frame` (coordinate dello skeleton, y in alto): primo slot dell'ordine di disegno, osso radice, ritaglia
 * tutti gli slot fino all'ultimo. Il riquadro dello skeleton diventa il riquadro dell'inquadratura.
 * Nel gioco il ritaglio costa un po' di CPU (una sola maschera rettangolare: poco).
 * @returns nuovo json (l'originale non cambia)
 */
export function applyFrameClip(json, frame) {
  if (!frame) return json;
  const out = JSON.parse(JSON.stringify(json));
  const { x, y, width: w, height: h } = frame;
  const name = "inquadratura";
  out.slots = [{ name, bone: "root", attachment: name }, ...out.slots.filter((s) => s.name !== name)];
  const last = out.slots[out.slots.length - 1].name;
  out.skins[0].attachments[name] = {
    [name]: { type: "clipping", end: last, vertexCount: 4, vertices: [x, y, x + w, y, x + w, y + h, x, y + h].map((v) => +v.toFixed(2)), color: "ce3a3aff" }
  };
  out.skeleton = { ...out.skeleton, x: +x.toFixed(2), y: +y.toFixed(2), width: +w.toFixed(2), height: +h.toFixed(2) };
  return out;
}
