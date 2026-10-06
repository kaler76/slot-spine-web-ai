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
export function transplantOriginal(pieces, original, { maxFill = 48, ownerByColor = false, colorTol = 140, colorMargin = 60, cleanHidden = true } = {}) {
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
    if (cleanHidden && kept) {
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
