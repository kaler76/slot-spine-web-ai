// src/lib/sheetAssembly.js — RICOMPOSIZIONE ROBUSTA della tavola esplosa (caso Zeus, 3 ott 2026).
// Il modello di immagini RIDISEGNA i pezzi (colori, dettagli, viso): il confronto dei colori da
// solo non basta né a riconoscere i tratti del viso né a garantire una ricomposizione fedele.
// Qui due passi deterministici:
//  1. GRUPPO DEL VISO (planFaceGroup): i tratti del viso stanno nella tavola raggruppati con la
//     stessa disposizione del viso (sopracciglia sopra gli occhi, bocca sotto, baffi ai lati,
//     sinistra/destra conservate). Si cerca la corrispondenza pezzi -> punti del viso della posa
//     che meglio rispetta questa disposizione (similitudine: scala + traslazione); ogni pezzo poi
//     si cerca SOLO attorno al suo punto. Niente più due occhi sullo stesso occhio o sopracciglia
//     sulla barba (stesso bianco).
//  2. PIXEL VISIBILI DALL'ORIGINALE (transplantOriginal): ogni pixel del personaggio nell'originale
//     appartiene al pezzo più davanti che lo copre (o al più vicino, se nessuno lo copre). In quel
//     pixel il pezzo prende il colore dell'ORIGINALE; il disegno della tavola resta solo dove il
//     pezzo è nascosto da un altro (collo sotto la testa, attacco della spalla, palpebre sotto gli
//     occhi, capelli dietro). La ricomposizione coincide con l'originale per costruzione.
// Puro: nessun DOM.

import { faceFrame } from "./faceRig.js";
import { fillHoles } from "./partExtraction.js";

/** Punti del viso (coordinate dell'originale) con il nome del pezzo. */
export function faceTargets(landmarks) {
  const fr = faceFrame(landmarks);
  if (!fr) return null;
  return {
    fr,
    targets: [
      { name: "occhio_sx", pt: fr.eyeSx },
      { name: "occhio_dx", pt: fr.eyeDx },
      { name: "sopracciglio_sx", pt: fr.browSx },
      { name: "sopracciglio_dx", pt: fr.browDx },
      { name: "bocca", pt: fr.mouth },
      { name: "baffo_sx", pt: fr.mustacheSx },
      { name: "baffo_dx", pt: fr.mustacheDx }
    ]
  };
}

const cOf = (p) => ({ x: p.sheetX + p.width / 2, y: p.sheetY + p.height / 2 });

/** Similitudine (scala k>0 + traslazione) ai minimi quadrati da punti a -> b; residuo RMS. */
function fitSimilarity(a, b) {
  const n = a.length;
  const ax = a.reduce((s, p) => s + p.x, 0) / n, ay = a.reduce((s, p) => s + p.y, 0) / n;
  const bx = b.reduce((s, p) => s + p.x, 0) / n, by = b.reduce((s, p) => s + p.y, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i].x - ax) * (b[i].x - bx) + (a[i].y - ay) * (b[i].y - by);
    den += (a[i].x - ax) ** 2 + (a[i].y - ay) ** 2;
  }
  const k = den ? num / den : 1;
  let r = 0;
  for (let i = 0; i < n; i++) r += (k * (a[i].x - ax) + bx - b[i].x) ** 2 + (k * (a[i].y - ay) + by - b[i].y) ** 2;
  return { k, rms: Math.sqrt(r / n) };
}

/**
 * Riconosce nella tavola il GRUPPO dei tratti del viso e assegna a ogni pezzo il suo punto.
 * Assegnazione = la migliore fra tutte le corrispondenze parziali pezzi -> punti, sommando:
 *  - quanto il pezzo COMBACIA con l'originale cercato attorno a quel punto (costo da placeCost);
 *  - quanto la disposizione nella tavola rispetta quella del viso (similitudine scala+traslazione);
 *  - una penalità per ogni pezzo del gruppo lasciato senza punto (ciocche, dettagli).
 * @param {Array} pieces - pezzi tagliati dalla tavola (sheetX, sheetY, width, height: coordinate tavola)
 * @param {Array} landmarks - posa dell'originale
 * @param {number} scale - scala tavola -> originale
 * @param {(piece, target) => {err:number}|null} placeCost - ricerca locale del pezzo attorno al punto
 * @returns {Map<piece, {name, pt, placed}>} (vuota se il gruppo non c'è o non è affidabile)
 */
export function planFaceGroup(pieces, landmarks, scale = 1, placeCost = null) {
  const out = new Map();
  const ft = faceTargets(landmarks);
  if (!ft) return out;
  const { fr, targets } = ft;
  const uS = fr.u / scale; // unità del viso in pixel della tavola
  // candidati: pezzi della taglia dei tratti del viso
  const cand = pieces.filter((p) => Math.max(p.width, p.height) * scale <= 2.4 * fr.u && Math.max(p.width, p.height) * scale >= 0.15 * fr.u);
  if (cand.length < 3) return out;
  // gruppi: pezzi vicini fra loro nella tavola (distanza fra riquadri <= 1 u)
  const gap = (a, b) => Math.max(0, Math.max(a.sheetX, b.sheetX) - Math.min(a.sheetX + a.width, b.sheetX + b.width), Math.max(a.sheetY, b.sheetY) - Math.min(a.sheetY + a.height, b.sheetY + b.height));
  const parent = cand.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < cand.length; i++) for (let j = i + 1; j < cand.length; j++) if (gap(cand[i], cand[j]) <= uS) parent[find(i)] = find(j);
  const groups = {};
  cand.forEach((p, i) => (groups[find(i)] ||= []).push(p));
  // pochi candidati: tutti (i tratti possono stare in più gruppetti nella tavola: folletto_viso);
  // altrimenti il gruppo più numeroso
  const group = cand.length <= 9 ? cand : Object.values(groups).sort((a, b) => b.length - a.length)[0];
  if (!group || group.length < 3 || group.length > 9) return out;
  // costo di ogni pezzo su ogni punto (ricerca locale); senza placeCost conta solo la disposizione
  const cost = group.map((p) => targets.map((t) => (placeCost ? placeCost(p, t) : { err: 40 })));
  const centers = group.map(cOf);
  let best = null;
  const assign = new Array(group.length).fill(-1), used = new Array(targets.length).fill(false);
  const evaluate = () => {
    const idx = assign.map((t, i) => [i, t]).filter(([, t]) => t >= 0);
    if (idx.length < 3 || !used[0] || !used[1]) return;
    const { k, rms } = fitSimilarity(idx.map(([i]) => centers[i]), idx.map(([, t]) => targets[t].pt));
    if (!(k > 0.2 && k < 5)) return;
    const fit = idx.reduce((a, [i, t]) => a + Math.max(0, cost[i][t].err - 30) / 40, 0);
    const score = fit + rms / fr.u + FACE_GROUP_UNASSIGNED * (group.length - idx.length);
    if (!best || score < best.score) best = { score, map: [...assign], k, rms };
  };
  const rec = (i) => {
    if (i === group.length) return evaluate();
    assign[i] = -1;
    rec(i + 1);
    for (let t = 0; t < targets.length; t++) {
      if (used[t] || !cost[i][t] || !isFinite(cost[i][t].err)) continue;
      used[t] = true;
      assign[i] = t;
      rec(i + 1);
      used[t] = false;
      assign[i] = -1;
    }
  };
  rec(0);
  if (!best) return out;
  best.map.forEach((t, i) => t >= 0 && out.set(group[i], { ...targets[t], placed: cost[i][t] }));
  out.k = best.k; // scala tavola -> originale del gruppo del viso
  out.rmsU = best.rms / fr.u; // scarto della disposizione, in unità del viso
  return out;
}
/** Penalità per un pezzo del gruppo del viso lasciato senza punto (ciocca, dettaglio). */
export const FACE_GROUP_UNASSIGNED = 1.5;

/**
 * Pixel del personaggio nell'originale: alpha se c'è trasparenza, altrimenti tutto ciò che non è
 * sfondo collegato al bordo (riempimento dal bordo con tolleranza: i contorni scuri interni restano).
 */
export function foregroundMask({ width: W, height: H, rgba }, { tol = 28 } = {}) {
  const fg = new Uint8Array(W * H);
  let transparent = false;
  for (let i = 0; i < W * H; i++) if (rgba[i * 4 + 3] < 250) { transparent = true; break; }
  if (transparent) {
    for (let i = 0; i < W * H; i++) fg[i] = rgba[i * 4 + 3] > 16 ? 1 : 0;
    return fg;
  }
  // colore dello sfondo = mediana del bordo
  const ch = [[], [], []];
  for (let x = 0; x < W; x++) for (const y of [0, H - 1]) for (let k = 0; k < 3; k++) ch[k].push(rgba[(y * W + x) * 4 + k]);
  for (let y = 0; y < H; y++) for (const x of [0, W - 1]) for (let k = 0; k < 3; k++) ch[k].push(rgba[(y * W + x) * 4 + k]);
  const bg = ch.map((c) => c.sort((a, b) => a - b)[c.length >> 1]);
  const isBg = (i) => Math.hypot(rgba[i * 4] - bg[0], rgba[i * 4 + 1] - bg[1], rgba[i * 4 + 2] - bg[2]) < tol;
  const seen = new Uint8Array(W * H);
  const q = [];
  for (let x = 0; x < W; x++) for (const y of [0, H - 1]) q.push(y * W + x);
  for (let y = 0; y < H; y++) for (const x of [0, W - 1]) q.push(y * W + x);
  for (const i of q) seen[i] = 1;
  for (let qi = 0; qi < q.length; qi++) {
    const i = q[qi];
    if (!isBg(i)) continue;
    const x = i % W, y = (i - x) / W;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (!seen[j]) { seen[j] = 1; q.push(j); }
    }
  }
  for (let i = 0; i < W * H; i++) fg[i] = seen[i] && isBg(i) ? 0 : 1;
  return fg;
}

/**
 * Sostituisce i pixel VISIBILI di ogni pezzo con quelli dell'originale (vedi intestazione).
 * I pezzi devono avere x, y (coordinate dell'originale) e order (0 = dietro).
 * @returns {{ pieces, holeShare, filledShare, iou }} holeShare = quota del personaggio rimasta scoperta;
 *   iou = sovrapposizione fra sagoma dei pezzi (prima) e sagoma dell'originale
 */
export function transplantOriginal(pieces, original, { maxFill = 48, ownerByColor = false, colorTol = 140, colorMargin = 60, cleanHidden = true, peelForeign = true, peelColor = 60, peelMax = 30, peelShare = 0.08, peelLine = 4 } = {}) {
  const { width: W, height: H, rgba } = original;
  const fg = foregroundMask(original);
  const owner = new Int16Array(W * H).fill(-1);
  const sorted = [...pieces].sort((a, b) => a.order - b.order);
  const idx = new Map(sorted.map((p, i) => [p, i]));
  let union = 0, inter = 0, fgN = 0;
  const cover = new Uint8Array(W * H);
  // ownerByColor (tavole ridisegnate, sheetRegister.js): se il pezzo più davanti ha un colore
  // lontano dall'originale e un altro pezzo che copre lo stesso pixel è nettamente più vicino,
  // il pixel va a quest'ultimo (es. bordo del corsetto coperto per sbaglio dai capelli dietro)
  const dFront = ownerByColor ? new Uint16Array(W * H) : null;
  const bestD = ownerByColor ? new Uint16Array(W * H).fill(65535) : null;
  const bestK = ownerByColor ? new Int16Array(W * H).fill(-1) : null;
  for (const p of sorted) {
    const k = idx.get(p);
    for (let y = 0; y < p.height; y++)
      for (let x = 0; x < p.width; x++) {
        if (p.rgba[(y * p.width + x) * 4 + 3] < 128) continue;
        const gx = p.x + x, gy = p.y + y;
        if (gx < 0 || gy < 0 || gx >= W || gy >= H) continue;
        const g = gy * W + gx;
        cover[g] = 1;
        if (fg[g]) {
          owner[g] = k; // il più davanti vince (ordine crescente)
          if (ownerByColor) {
            const pi = (y * p.width + x) * 4;
            const d = Math.abs(p.rgba[pi] - rgba[g * 4]) + Math.abs(p.rgba[pi + 1] - rgba[g * 4 + 1]) + Math.abs(p.rgba[pi + 2] - rgba[g * 4 + 2]);
            dFront[g] = d;
            if (d < bestD[g]) { bestD[g] = d; bestK[g] = k; }
          }
        }
      }
  }
  if (ownerByColor)
    for (let i = 0; i < W * H; i++)
      if (owner[i] >= 0 && dFront[i] > colorTol && bestD[i] + colorMargin < dFront[i]) owner[i] = bestK[i];
  for (let i = 0; i < W * H; i++) {
    if (fg[i]) fgN++;
    if (fg[i] || cover[i]) union++;
    if (fg[i] && cover[i]) inter++;
  }
  // pixel del personaggio non coperti da nessun pezzo: al pezzo più vicino (entro maxFill px)
  const dist = new Int16Array(W * H).fill(-1);
  const q = [];
  for (let i = 0; i < W * H; i++) if (owner[i] >= 0) { dist[i] = 0; q.push(i); }
  for (let qi = 0; qi < q.length; qi++) {
    const i = q[qi];
    if (dist[i] >= maxFill) continue;
    const x = i % W, y = (i - x) / W;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (!fg[j] || dist[j] >= 0) continue;
      dist[j] = dist[i] + 1;
      owner[j] = owner[i];
      q.push(j);
    }
  }
  // BORDO D'ALTRO SUL PEZZO CHE SI MUOVE (Zeus, 6 ott): la tavola ridisegnata mette nel braccio il
  // bordo dorato + la linea nera del drappo che scende sulla spalla; in movimento il bordo ruota col
  // braccio (linea nera sul bicipite). Regola: una zona di colore uniforme dell'originale (contorni
  // neri esclusi) divisa fra un pezzo fermo e uno che si muove, che nel pezzo che si muove è una
  // striscia sottile (poca parte del pezzo, entro peelMax px dal confine) e nel pezzo fermo è
  // almeno altrettanto grande, appartiene al pezzo fermo. Poi la linea nera che la contorna dal
  // lato del pezzo che si muove (contorno del pezzo davanti). Sotto, nel pezzo che si muove, la
  // zona diventa nascosta (tavola + pulizia cleanHidden).
  let peeled = 0;
  if (peelForeign) {
    const moving = new Set(sorted.map((p, k) => (/^(braccio|avambraccio|mano)/.test(p.name || "") ? k : -1)).filter((k) => k >= 0));
    const still = (k) => k >= 0 && !moving.has(k) && !/^(occhio|sopracciglio|bocca|baffo|ciocca)/.test(sorted[k].name || "");
    const luma = (i) => 0.3 * rgba[i * 4] + 0.59 * rgba[i * 4 + 1] + 0.11 * rgba[i * 4 + 2];
    const dark = (i) => luma(i) < 70;
    const near = (i, j) => Math.abs(rgba[i * 4] - rgba[j * 4]) + Math.abs(rgba[i * 4 + 1] - rgba[j * 4 + 1]) + Math.abs(rgba[i * 4 + 2] - rgba[j * 4 + 2]) < peelColor;
    const ok = (i) => fg[i] && owner[i] >= 0 && (moving.has(owner[i]) || still(owner[i])) && !dark(i);
    // zone di colore (union-find a 4 vicini)
    const par = new Int32Array(W * H).fill(-1);
    const find = (i) => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
    for (let i = 0; i < W * H; i++) if (ok(i)) par[i] = i;
    for (let i = 0; i < W * H; i++) {
      if (par[i] < 0) continue;
      const x = i % W;
      for (const j of [x + 1 < W ? i + 1 : -1, i + W < W * H ? i + W : -1]) {
        if (j < 0 || par[j] < 0 || !near(i, j)) continue;
        const a = find(i), b = find(j);
        if (a !== b) par[a] = b;
      }
    }
    // distanza dal confine fermo/mobile, dentro i pixel del pezzo che si muove
    const depth = new Int16Array(W * H).fill(-1);
    const dq = [];
    for (let i = 0; i < W * H; i++) {
      if (!moving.has(owner[i])) continue;
      const x = i % W, y = (i - x) / W;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < W && ny < H && still(owner[ny * W + nx])) { depth[i] = 0; dq.push(i); break; }
      }
    }
    for (let qi = 0; qi < dq.length; qi++) {
      const i = dq[qi];
      if (depth[i] >= peelMax) continue;
      const x = i % W, y = (i - x) / W;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (depth[j] >= 0 || owner[j] !== owner[i]) continue;
        depth[j] = depth[i] + 1;
        dq.push(j);
      }
    }
    // conteggi per zona: pixel nel pezzo che si muove (tutti / entro peelMax) e nel pezzo fermo
    const area = new Map(sorted.map((p, k) => [k, 0]));
    for (let i = 0; i < W * H; i++) if (owner[i] >= 0) area.set(owner[i], area.get(owner[i]) + 1);
    const st = new Map();
    for (let i = 0; i < W * H; i++) {
      if (par[i] < 0) continue;
      const r = find(i);
      let e = st.get(r);
      if (!e) st.set(r, (e = { m: 0, mFar: 0, s: new Map(), k: -1 }));
      const o = owner[i];
      if (moving.has(o)) { e.m++; e.k = o; if (depth[i] < 0) e.mFar++; }
      else e.s.set(o, (e.s.get(o) || 0) + 1);
    }
    const target = new Map();
    for (const [r, e] of st) {
      if (!e.m || e.mFar || !e.s.size) continue;
      let to = -1, sMax = 0;
      for (const [o, n] of e.s) if (n > sMax) { sMax = n; to = o; }
      if (sMax >= e.m && e.m <= peelShare * area.get(e.k)) target.set(r, to);
    }
    const moved = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) {
      if (par[i] < 0 || !moving.has(owner[i])) continue;
      const to = target.get(find(i));
      if (to === undefined) continue;
      owner[i] = to;
      moved[i] = 1;
      peeled++;
    }
    // la linea nera che contorna la zona spostata, dal lato del pezzo che si muove
    if (peeled)
      for (let pass = 0; pass < peelLine; pass++) {
        const add = [];
        for (let i = 0; i < W * H; i++) {
          if (!fg[i] || !moving.has(owner[i]) || !dark(i)) continue;
          const x = i % W, y = (i - x) / W;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            const j = ny * W + nx;
            if (moved[j]) { add.push([i, owner[j]]); break; }
          }
        }
        for (const [i, to] of add) { owner[i] = to; moved[i] = 1; peeled++; }
      }
  }
  let holes = 0, filled = 0;
  for (let i = 0; i < W * H; i++) {
    if (fg[i] && owner[i] < 0) holes++;
    if (dist[i] > 0) filled++;
  }
  // nuovo ritaglio di ogni pezzo: riquadro = vecchio ∪ pixel posseduti
  const box = sorted.map((p) => ({ x0: p.x, y0: p.y, x1: p.x + p.width - 1, y1: p.y + p.height - 1 }));
  for (let i = 0; i < W * H; i++) {
    const k = owner[i];
    if (k < 0) continue;
    const x = i % W, y = (i - x) / W, b = box[k];
    if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x; if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y;
  }
  const out = sorted.map((p, k) => {
    const b = box[k], w = b.x1 - b.x0 + 1, h = b.y1 - b.y0 + 1;
    const px = new Uint8ClampedArray(w * h * 4);
    let own = 0, kept = 0;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const gx = b.x0 + x, gy = b.y0 + y, li = (y * w + x) * 4;
        const inImg = gx >= 0 && gy >= 0 && gx < W && gy < H;
        const g = inImg ? gy * W + gx : -1;
        if (inImg && owner[g] === k) {
          px[li] = rgba[g * 4]; px[li + 1] = rgba[g * 4 + 1]; px[li + 2] = rgba[g * 4 + 2];
          px[li + 3] = rgba[g * 4 + 3];
          own++;
          continue;
        }
        const lx = gx - p.x, ly = gy - p.y;
        if (lx < 0 || ly < 0 || lx >= p.width || ly >= p.height) continue;
        const pi = (ly * p.width + lx) * 4;
        if (!p.rgba[pi + 3]) continue;
        // pixel della tavola: resta solo se NASCOSTO da un pezzo davanti (zona ridisegnata)
        if (inImg && fg[g] && owner[g] > k) {
          px.set(p.rgba.subarray(pi, pi + 4), li);
          kept++;
        }
      }
    // ZONE NASCOSTE PULITE (Zeus, 6 ott): la tavola a volte disegna nella zona nascosta un pezzo
    // d'ALTRO (bordo dorato e linea nera del drappo sulla spalla del braccio): in movimento si
    // vede. Un pixel della tavola nascosto deve somigliare ai pixel VISIBILI del pezzo vicini
    // (entro 24 px); se no si scarta e si ricostruisce dai vicini. Esclusi i pixel sotto i tratti
    // del viso (palpebre chiuse disegnate apposta).
    let cleaned = 0;
    if (cleanHidden && kept && /^(braccio|avambraccio|mano)/.test(p.name || "")) {
      const isOwn = (gx, gy) => gx >= 0 && gy >= 0 && gx < W && gy < H && owner[gy * W + gx] === k;
      const known = new Uint8Array(w * h), holes = [];
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const li = y * w + x;
          if (!px[li * 4 + 3]) continue;
          const gx = b.x0 + x, gy = b.y0 + y;
          if (isOwn(gx, gy)) { known[li] = 1; continue; }
          const fo = gx >= 0 && gy >= 0 && gx < W && gy < H ? owner[gy * W + gx] : -1;
          if (fo >= 0 && /^(occhio|sopracciglio|bocca|baffo)/.test(sorted[fo].name || "")) { known[li] = 1; continue; }
          let best = Infinity, any = false;
          for (let dy = -24; dy <= 24 && best > 100; dy += 3)
            for (let dx = -24; dx <= 24; dx += 3) {
              const X = gx + dx, Y = gy + dy;
              if (!isOwn(X, Y)) continue;
              any = true;
              const g = (Y * W + X) * 4;
              const d = Math.abs(rgba[g] - px[li * 4]) + Math.abs(rgba[g + 1] - px[li * 4 + 1]) + Math.abs(rgba[g + 2] - px[li * 4 + 2]);
              if (d < best) best = d;
              if (best <= 100) break;
            }
          if (any && best > 100) holes.push(li);
          else known[li] = 1;
        }
      if (holes.length) {
        fillHoles(px, known, w, h, holes);
        cleaned = holes.length;
      }
    }
    return { ...p, x: b.x0, y: b.y0, width: w, height: h, rgba: px, area: own + kept, ownPixels: own, hiddenPixels: kept, cleanedHidden: cleaned };
  });
  // stesso ordine dell'array in ingresso
  const back = new Map(sorted.map((p, k) => [p, out[k]]));
  // NESSUN PIXEL PERSO: ciò che resta scoperto (scintille, monete, particelle che il modello non
  // ha disegnato nella tavola) diventa uno o più pezzi "resto_N" con i pixel dell'originale,
  // agganciati al pezzo più vicino. Gruppi = componenti vicine fra loro (entro restGap px).
  const rest = restPieces(fg, owner, original, sorted, out, { minArea: Math.max(30, Math.round(0.001 * fgN)) });
  // filledShare = parti del personaggio che nessun pezzo della tavola copriva (es. mantello dietro
  // il braccio dimenticato dal modello): assegnate al pezzo più vicino
  const restPx = rest.reduce((a, p) => a + p.area, 0);
  return {
    pieces: pieces.map((p) => back.get(p)),
    rest,
    holeShare: fgN ? (holes - restPx) / fgN : 0,
    filledShare: fgN ? filled / fgN : 0,
    peeled,
    iou: union ? inter / union : 0
  };
}

/** Pezzi "resto_N" dai pixel del personaggio rimasti senza pezzo (vedi transplantOriginal). */
function restPieces(fg, owner, original, sorted, out, { restGap = 60, minArea = 30 } = {}) {
  // gruppi sotto minArea (0,1% del personaggio) si lasciano scoperti: briciole
  const { width: W, height: H, rgba } = original;
  const lab = new Int32Array(W * H);
  const comps = [];
  for (let s = 0; s < W * H; s++) {
    if (!fg[s] || owner[s] >= 0 || lab[s]) continue;
    const id = comps.length + 1, st = [s];
    lab[s] = id;
    const c = { id, px: [], x0: W, y0: H, x1: 0, y1: 0 };
    while (st.length) {
      const i = st.pop(), x = i % W, y = (i - x) / W;
      c.px.push(i);
      if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const j = ny * W + nx;
          if (fg[j] && owner[j] < 0 && !lab[j]) { lab[j] = id; st.push(j); }
        }
    }
    comps.push(c);
  }
  // gruppi di componenti vicine
  const par = comps.map((_, i) => i);
  const find = (i) => (par[i] === i ? i : (par[i] = find(par[i])));
  const gap = (a, b) => Math.max(0, Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1), Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1));
  for (let i = 0; i < comps.length; i++) for (let j = i + 1; j < comps.length; j++) if (gap(comps[i], comps[j]) <= restGap) par[find(i)] = find(j);
  const groups = {};
  comps.forEach((c, i) => (groups[find(i)] ||= []).push(c));
  const res = [];
  for (const g of Object.values(groups)) {
    const px = g.flatMap((c) => c.px);
    if (px.length < minArea) continue;
    const x0 = Math.min(...g.map((c) => c.x0)), y0 = Math.min(...g.map((c) => c.y0));
    const x1 = Math.max(...g.map((c) => c.x1)), y1 = Math.max(...g.map((c) => c.y1));
    const w = x1 - x0 + 1, h = y1 - y0 + 1, data = new Uint8ClampedArray(w * h * 4);
    for (const i of px) {
      const x = i % W, y = (i - x) / W, li = ((y - y0) * w + (x - x0)) * 4;
      data[li] = rgba[i * 4]; data[li + 1] = rgba[i * 4 + 1]; data[li + 2] = rgba[i * 4 + 2]; data[li + 3] = rgba[i * 4 + 3];
    }
    // genitore: il pezzo con più pixel posseduti nel riquadro allargato del gruppo
    const cnt = new Map();
    const m = restGap;
    for (let y = Math.max(0, y0 - m); y <= Math.min(H - 1, y1 + m); y += 2)
      for (let x = Math.max(0, x0 - m); x <= Math.min(W - 1, x1 + m); x += 2) {
        const k = owner[y * W + x];
        if (k >= 0) cnt.set(k, (cnt.get(k) || 0) + 1);
      }
    const best = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0];
    const host = best ? out[best[0]] : null;
    res.push({ name: `resto_${res.length + 1}`, x: x0, y: y0, width: w, height: h, rgba: data, area: px.length, matchError: 0, attachTo: host?.name || null, restOf: host?.name || null, order: host ? host.order + 0.5 : sorted.length, motionLocked: true });
  }
  return res;
}

/**
 * SAGOMA DALLA TAVOLA, COLORI DALL'ORIGINALE (8 ott 2026, Zeus): sintesi delle due varianti.
 * - pixel dalla tavola (6 ott): taglio pulito in movimento, ma a riposo il disegno è quello
 *   ridisegnato dal modello (viso, dettagli diversi dall'originale);
 * - pixel dall'originale (3 ott): a riposo identico, ma il taglio si sporca (linea del drappo sul braccio).
 * Qui la SAGOMA di ogni pezzo resta quella della tavola (nessun pixel cambia proprietario); solo il
 * COLORE dei pixel visibili a riposo viene dall'originale:
 *   - pezzi fermi o quasi (busto, testa, viso, capelli, coperture): sempre;
 *   - pezzi che si muovono (braccio, avambraccio, mano): sempre, TRANNE nella fascia di `band` px
 *     lungo il confine con un pezzo fermo: lì solo se il colore della tavola è vicino a quello
 *     dell'originale. Dove differisce (bordo del drappo, linea nera del pezzo fermo) resta la
 *     tavola, così in movimento non ruota un pezzo d'altro.
 * Bordo e parti mancanti dalla tavola (entro `fill` px): al pezzo più vicino (vedi sotto).
 * Ciò che resta scoperto (scintille, monete non disegnate nella tavola) diventa resto_N, come in
 * transplantOriginal.
 * @returns {{ pieces, rest, recolored, keptSheet, grown, holeShare }}
 */
export function recolorVisible(pieces, original, { tolMoving = 90, band = 16, grow = 4, fill = 48 } = {}) {
  const { width: W, height: H, rgba } = original;
  const fg = foregroundMask(original);
  const owner = new Int16Array(W * H).fill(-1);
  const sorted = [...pieces].sort((a, b) => a.order - b.order);
  sorted.forEach((p, k) => {
    for (let y = 0; y < p.height; y++)
      for (let x = 0; x < p.width; x++) {
        if (p.rgba[(y * p.width + x) * 4 + 3] < 128) continue;
        const gx = p.x + x, gy = p.y + y;
        if (gx >= 0 && gy >= 0 && gx < W && gy < H) owner[gy * W + gx] = k;
      }
  });
  // BORDO E PARTI MANCANTI DALLA TAVOLA: pixel del personaggio scoperti entro `fill` px da un
  // pezzo -> a un pezzo vicino, coi colori dell'originale. Entro `grow` px il più vicino; oltre,
  // fra il pezzo fermo e quello che si muove più vicini vince quello col COLORE più simile
  // (media dell'originale attorno al punto di contatto): la parte di braccio che la tavola ha
  // disegnato più corta torna al braccio (pelle), il drappo dimenticato sotto il braccio va al
  // busto (viola). A parità, il pezzo fermo.
  const isMov = sorted.map((p) => /^(braccio|avambraccio|mano)/.test(p.name || ""));
  const bfs = (pick) => {
    const dist = new Int16Array(W * H).fill(-1), who = new Int16Array(W * H).fill(-1), src = new Int32Array(W * H).fill(-1), bq = [];
    for (let i = 0; i < W * H; i++) if (fg[i] && owner[i] >= 0 && pick(owner[i])) { dist[i] = 0; who[i] = owner[i]; src[i] = i; bq.push(i); }
    for (let qi = 0; qi < bq.length; qi++) {
      const i = bq[qi];
      if (dist[i] >= fill) continue;
      const x = i % W, y = (i - x) / W;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (!fg[j] || owner[j] >= 0 || dist[j] >= 0) continue;
        dist[j] = dist[i] + 1;
        who[j] = who[i];
        src[j] = src[i];
        bq.push(j);
      }
    }
    return { dist, who, src };
  };
  const S = bfs((k) => !isMov[k]), M = bfs((k) => isMov[k]);
  // distanza di colore fra il pixel i e la media dell'originale del pezzo k attorno al contatto c
  const avgCache = new Map();
  const colorGap = (i, c, k) => {
    let a = avgCache.get(c);
    if (!a) {
      const cx = c % W, cy = (c - cx) / W;
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = Math.max(0, cy - 6); y <= Math.min(H - 1, cy + 6); y++)
        for (let x = Math.max(0, cx - 6); x <= Math.min(W - 1, cx + 6); x++) {
          const j = y * W + x;
          if (owner[j] !== k || !fg[j]) continue;
          const l = 0.3 * rgba[j * 4] + 0.59 * rgba[j * 4 + 1] + 0.11 * rgba[j * 4 + 2];
          if (l < 60) continue; // contorni neri: non dicono il materiale
          r += rgba[j * 4]; g += rgba[j * 4 + 1]; b += rgba[j * 4 + 2]; n++;
        }
      a = n ? [r / n, g / n, b / n] : [rgba[c * 4], rgba[c * 4 + 1], rgba[c * 4 + 2]];
      avgCache.set(c, a);
    }
    return Math.abs(rgba[i * 4] - a[0]) + Math.abs(rgba[i * 4 + 1] - a[1]) + Math.abs(rgba[i * 4 + 2] - a[2]);
  };
  const grownOwner = new Int16Array(W * H).fill(-1);
  let grown = 0;
  for (let i = 0; i < W * H; i++) {
    if (!fg[i] || owner[i] >= 0) continue;
    const ds = S.dist[i] >= 0 ? S.dist[i] : Infinity, dm = M.dist[i] >= 0 ? M.dist[i] : Infinity;
    if (ds === Infinity && dm === Infinity) continue;
    const near = Math.min(ds, dm);
    if (near <= grow || dm === Infinity || ds === Infinity) grownOwner[i] = ds <= dm ? S.who[i] : M.who[i];
    else grownOwner[i] = colorGap(i, S.src[i], S.who[i]) <= colorGap(i, M.src[i], M.who[i]) + 20 ? S.who[i] : M.who[i];
    grown++;
  }
  // distanza (in px, 4 vicini) dal confine con un pezzo FERMO, dentro i pezzi che si muovono
  const isMoving = isMov;
  const depth = new Int16Array(W * H).fill(-1);
  const q = [];
  for (let i = 0; i < W * H; i++) {
    const o = owner[i];
    if (o < 0 || !isMoving[o]) continue;
    const x = i % W, y = (i - x) / W;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const oj = owner[ny * W + nx];
      if (oj >= 0 && !isMoving[oj]) { depth[i] = 0; q.push(i); break; }
    }
  }
  for (let qi = 0; qi < q.length; qi++) {
    const i = q[qi];
    if (depth[i] >= band) continue;
    const x = i % W, y = (i - x) / W;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (depth[j] >= 0 || owner[j] !== owner[i]) continue;
      depth[j] = depth[i] + 1;
      q.push(j);
    }
  }
  let recolored = 0, keptSheet = 0, trimmed = 0, toned = 0;
  const faceRe = /^(occhio|sopracciglio|bocca|baffo)/;
  const out = sorted.map((p, k) => {
    const banded = isMov[k];
    const px = new Uint8ClampedArray(p.rgba);
    // differenza originale - tavola sui pixel visibili ricolorati (per il tono delle zone nascoste)
    const pw = p.width, ph = p.height;
    const dR = new Float64Array((pw + 1) * (ph + 1)), dG = new Float64Array((pw + 1) * (ph + 1)), dB = new Float64Array((pw + 1) * (ph + 1)), dN = new Float64Array((pw + 1) * (ph + 1));
    const hidden = [];
    for (let y = 0; y < p.height; y++)
      for (let x = 0; x < p.width; x++) {
        const li = (y * p.width + x) * 4;
        if (px[li + 3] < 128) continue;
        const gx = p.x + x, gy = p.y + y;
        if (gx < 0 || gy < 0 || gx >= W || gy >= H) continue;
        const g = gy * W + gx;
        // sagoma della tavola che sporge oltre quella dell'originale (fulmine ridisegnato spostato:
        // doppio contorno a riposo): via, su TUTTI i pezzi. A riposo si vede solo l'originale.
        if (!fg[g]) { px[li + 3] = 0; trimmed++; continue; }
        if (owner[g] !== k) { hidden.push(li); continue; }
        if (banded && depth[g] >= 0) {
          const d = Math.abs(px[li] - rgba[g * 4]) + Math.abs(px[li + 1] - rgba[g * 4 + 1]) + Math.abs(px[li + 2] - rgba[g * 4 + 2]);
          if (d > tolMoving) { keptSheet++; continue; }
        }
        const ii = (y + 1) * (pw + 1) + x + 1;
        dR[ii] = rgba[g * 4] - px[li]; dG[ii] = rgba[g * 4 + 1] - px[li + 1]; dB[ii] = rgba[g * 4 + 2] - px[li + 2]; dN[ii] = 1;
        px[li] = rgba[g * 4]; px[li + 1] = rgba[g * 4 + 1]; px[li + 2] = rgba[g * 4 + 2];
        recolored++;
      }
    // TONO DELLE ZONE NASCOSTE (Jessica, 8 ott): la tavola ridisegnata ha un'altra tinta; ricolorato
    // il visibile, la pelle nascosta sotto il braccio restava una macchia più chiara in movimento.
    // Ogni pixel nascosto riceve la differenza media originale - tavola dei pixel visibili del pezzo
    // vicini (entro 24 px, poi 64, poi tutto il pezzo).
    if (hidden.length && !faceRe.test(p.name || "")) {
      for (const A of [dR, dG, dB, dN])
        for (let y = 1; y <= ph; y++) for (let x = 1; x <= pw; x++) { const i = y * (pw + 1) + x; A[i] += A[i - 1] + A[i - pw - 1] - A[i - pw - 2]; }
      const box = (A, x0, y0, x1, y1) => A[y1 * (pw + 1) + x1] - A[y0 * (pw + 1) + x1] - A[y1 * (pw + 1) + x0] + A[y0 * (pw + 1) + x0];
      for (const li of hidden) {
        const x = (li / 4) % pw, y = ((li / 4) - x) / pw;
        for (const r of [24, 64, 100000]) {
          const x0 = Math.max(0, x - r), y0 = Math.max(0, y - r), x1 = Math.min(pw, x + r + 1), y1 = Math.min(ph, y + r + 1);
          const n = box(dN, x0, y0, x1, y1);
          if (n < 20) continue;
          px[li] += box(dR, x0, y0, x1, y1) / n; px[li + 1] += box(dG, x0, y0, x1, y1) / n; px[li + 2] += box(dB, x0, y0, x1, y1) / n;
          toned++;
          break;
        }
      }
    }
    // riquadro allargato ai pixel di bordo
    let x0 = p.x, y0 = p.y, x1 = p.x + p.width - 1, y1 = p.y + p.height - 1;
    const mine = [];
    for (let i = 0; i < W * H; i++) if (grownOwner[i] === k) { mine.push(i); const x = i % W, y = (i - x) / W; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (!mine.length) return { ...p, rgba: px };
    const w = x1 - x0 + 1, h = y1 - y0 + 1, big = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < p.height; y++) big.set(px.subarray(y * p.width * 4, (y + 1) * p.width * 4), ((y + p.y - y0) * w + (p.x - x0)) * 4);
    for (const i of mine) {
      const x = i % W, y = (i - x) / W, li = ((y - y0) * w + (x - x0)) * 4;
      big[li] = rgba[i * 4]; big[li + 1] = rgba[i * 4 + 1]; big[li + 2] = rgba[i * 4 + 2]; big[li + 3] = rgba[i * 4 + 3];
    }
    return { ...p, x: x0, y: y0, width: w, height: h, rgba: big };
  });
  const back = new Map(sorted.map((p, k) => [p, out[k]]));
  // scoperto oltre il bordo: resto_N con i pixel dell'originale
  const own2 = new Int16Array(W * H);
  let fgN = 0, holes = 0;
  for (let i = 0; i < W * H; i++) {
    own2[i] = owner[i] >= 0 && fg[i] ? owner[i] : grownOwner[i];
    if (fg[i]) { fgN++; if (own2[i] < 0) holes++; }
  }
  const rest = restPieces(fg, own2, original, sorted, out, { minArea: Math.max(30, Math.round(0.001 * fgN)) });
  const restPx = rest.reduce((a, r) => a + r.area, 0);
  return { pieces: pieces.map((p) => back.get(p)), rest, recolored, keptSheet, grown, trimmed, toned, holeShare: fgN ? (holes - restPx) / fgN : 0 };
}
