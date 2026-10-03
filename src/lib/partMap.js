// src/lib/partMap.js — PEZZI DALLA MAPPA DELLE PARTI (caso Jessica, 3 ott 2026).
// Invece di rimettere al loro posto i pezzi RIDISEGNATI di una tavola esplosa (fragile: colori
// cambiati, nomi dalla posa), Gemini ricolora l'ORIGINALE con un colore piatto per parte.
//   1. colori della mappa -> parti (palette fissa, vedi PART_COLORS e il prompt in
//      tests/fixtures/exploded/jessica/partmap_prompt.txt);
//   2. mappa allineata all'originale con UNA similitudine (scala + traslazione) sulla sagoma intera;
//   3. ogni pixel del personaggio prende la parte della mappa (bordi incerti: parte più vicina);
//   4. pezzo = pixel dell'ORIGINALE della sua parte: posizione esatta per costruzione;
//   5. nomi dal colore (+ lato per occhi, sopracciglia, ciocche, baffi), genitori e pivot dai
//      BORDI fra le parti (spalla = contatto braccio/busto, collo = contatto testa/busto...):
//      la posa non serve;
//   6. zone nascoste (sotto la testa, sotto le braccia, sotto gli occhi) riempite per diffusione
//      dei colori vicini, così il pezzo non ha buchi quando si muove.
// Puro: nessun DOM.

/** Palette della mappa: colore -> parte. "sx" = lato sinistro del PERSONAGGIO (a destra per chi guarda). */
export const PART_COLORS = [
  { part: "testa", rgb: [255, 0, 0] },
  { part: "capelli_dietro", rgb: [128, 0, 255] },
  { part: "ciocca", rgb: [0, 128, 0] },
  { part: "occhio", rgb: [0, 255, 255] },
  { part: "sopracciglio", rgb: [255, 0, 255] },
  { part: "bocca", rgb: [128, 128, 128] },
  { part: "baffo", rgb: [128, 64, 0] },
  { part: "busto", rgb: [0, 255, 0] },
  { part: "braccio_dx", rgb: [0, 0, 255] },
  { part: "braccio_sx", rgb: [255, 255, 0] },
  { part: "oggetto", rgb: [255, 128, 0] }
];
/** Ordine di disegno per parte (0 = dietro). */
const ORDER = { capelli_dietro: 0, busto: 1, braccio_sx: 2, braccio_dx: 2, testa: 3, ciocca: 4, baffo: 5, bocca: 5, occhio: 5, sopracciglio: 5, oggetto: 6 };
/** Genitore preferito per parte (se si toccano); altrimenti la parte con più bordo in comune. */
const PARENT = { busto: null, testa: "busto", braccio_sx: "busto", braccio_dx: "busto", capelli_dietro: "testa", ciocca: "testa", occhio: "testa", sopracciglio: "testa", bocca: "testa", baffo: "testa", oggetto: null };
/** Parti a coppia: componenti separate con il lato del personaggio. */
const PAIRED = new Set(["occhio", "sopracciglio", "ciocca", "baffo"]);

const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** Etichetta di ogni pixel della mappa: indice in PART_COLORS, -1 sfondo, -2 incerto. */
export function quantizeMap({ width: W, height: H, rgba }, { maxDist = 110, bgMax = 60 } = {}) {
  const lab = new Int8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
    if (rgba[i * 4 + 3] < 128 || r + g + b < bgMax) { lab[i] = -1; continue; }
    let best = -2, bd = maxDist;
    PART_COLORS.forEach((c, k) => {
      const d = Math.hypot(r - c.rgb[0], g - c.rgb[1], b - c.rgb[2]);
      if (d < bd) { bd = d; best = k; }
    });
    lab[i] = best;
  }
  return lab;
}

function bbox(mask, W, H) {
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let i = 0; i < W * H; i++) if (mask[i]) {
    const x = i % W, y = (i - x) / W;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

/**
 * Similitudine mappa -> originale: prima dai riquadri delle sagome, poi rifinita cercando la
 * massima sovrapposizione (IoU) in un intorno (scala ±4%, traslazione ±12 px).
 * @returns {{ s, tx, ty, iou }}  originale(x) = s * mappa(x) + t
 */
export function alignMap(mapLab, mW, mH, fg, W, H) {
  const mMask = Uint8Array.from(mapLab, (v) => (v !== -1 ? 1 : 0));
  const a = bbox(mMask, mW, mH), b = bbox(fg, W, H);
  if (!a || !b) throw new Error("Mappa o personaggio vuoti.");
  const s0 = ((b.y1 - b.y0 + 1) / (a.y1 - a.y0 + 1) + (b.x1 - b.x0 + 1) / (a.x1 - a.x0 + 1)) / 2;
  const t0x = (b.x0 + b.x1) / 2 - s0 * (a.x0 + a.x1) / 2, t0y = (b.y0 + b.y1) / 2 - s0 * (a.y0 + a.y1) / 2;
  // IoU su griglia rada (passo 3 px dell'originale)
  const iou = (s, tx, ty) => {
    let inter = 0, uni = 0;
    for (let y = b.y0 - 20; y <= b.y1 + 20; y += 3)
      for (let x = b.x0 - 20; x <= b.x1 + 20; x += 3) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const mx = Math.round((x - tx) / s), my = Math.round((y - ty) / s);
        const m = mx >= 0 && my >= 0 && mx < mW && my < mH && mMask[my * mW + mx];
        const o = fg[y * W + x];
        if (m || o) uni++;
        if (m && o) inter++;
      }
    return uni ? inter / uni : 0;
  };
  let best = { s: s0, tx: t0x, ty: t0y, iou: iou(s0, t0x, t0y) };
  for (const [ds, dt] of [[0.02, 8], [0.008, 3], [0.003, 1]]) {
    const c = { ...best };
    for (const s of [c.s - ds, c.s, c.s + ds])
      for (const tx of [c.tx - dt, c.tx, c.tx + dt])
        for (const ty of [c.ty - dt, c.ty, c.ty + dt]) {
          const v = iou(s, tx, ty);
          if (v > best.iou) best = { s, tx, ty, iou: v };
        }
  }
  return best;
}

/** Parte di ogni pixel del personaggio (originale); bordi incerti -> parte più vicina (BFS). */
function labelOriginal(mapLab, mW, mH, fg, W, H, T) {
  const lab = new Int8Array(W * H).fill(-1);
  const q = [];
  for (let i = 0; i < W * H; i++) {
    if (!fg[i]) continue;
    const x = i % W, y = (i - x) / W;
    const mx = Math.round((x - T.tx) / T.s), my = Math.round((y - T.ty) / T.s);
    const v = mx >= 0 && my >= 0 && mx < mW && my < mH ? mapLab[my * mW + mx] : -1;
    if (v >= 0) { lab[i] = v; q.push(i); }
  }
  for (let qi = 0; qi < q.length; qi++) {
    const i = q[qi], x = i % W, y = (i - x) / W;
    for (const [dx, dy] of N4) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (fg[j] && lab[j] === -1) { lab[j] = lab[i]; q.push(j); }
    }
  }
  return lab;
}

/** Componenti connesse di una parte (8-vicinato). */
function components(lab, W, H, k) {
  const seen = new Uint8Array(W * H), out = [];
  for (let s = 0; s < W * H; s++) {
    if (lab[s] !== k || seen[s]) continue;
    const px = [], st = [s];
    seen[s] = 1;
    while (st.length) {
      const i = st.pop(), x = i % W, y = (i - x) / W;
      px.push(i);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const j = ny * W + nx;
          if (!seen[j] && lab[j] === k) { seen[j] = 1; st.push(j); }
        }
    }
    out.push(px);
  }
  return out.sort((a, b) => b.length - a.length);
}

/** Diffusione dei colori noti nei pixel ignoti della maschera (riempimento delle zone nascoste). */
function diffuseFill(rgba, known, fill, w, h, iters = 60) {
  const idx = [];
  for (let i = 0; i < w * h; i++) if (fill[i] && !known[i]) idx.push(i);
  const has = Uint8Array.from(known);
  // prima passata: propagazione per strati (ogni pixel prende la media dei vicini già noti)
  let front = idx;
  for (let it = 0; it < iters && front.length; it++) {
    const next = [], set = [];
    for (const i of front) {
      const x = i % w, y = (i - x) / w;
      let r = 0, g = 0, b = 0, n = 0;
      for (const [dx, dy] of N4) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (!has[j]) continue;
        r += rgba[j * 4]; g += rgba[j * 4 + 1]; b += rgba[j * 4 + 2]; n++;
      }
      if (n) set.push([i, r / n, g / n, b / n]);
      else next.push(i);
    }
    for (const [i, r, g, b] of set) {
      rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = 255;
      has[i] = 1;
    }
    front = next;
  }
}

/**
 * @param {Object} o
 * @param {{width,height,rgba}} o.map - mappa delle parti (Gemini)
 * @param {{width,height,rgba}} o.original - personaggio originale
 * @param {Uint8Array} o.fg - sagoma del personaggio nell'originale (sheetAssembly.foregroundMask)
 * @param {number} [o.hiddenPad] - quanto ogni pezzo si estende sotto i pezzi davanti (px)
 * @returns {{ pieces, transform, coverage, warnings }}
 */
export function piecesFromPartMap({ map, original, fg, hiddenPad = null }) {
  const warnings = [];
  const { width: W, height: H, rgba } = original;
  const mapLab = quantizeMap(map);
  const T = alignMap(mapLab, map.width, map.height, fg, W, H);
  if (T.iou < 0.85) warnings.push(`Mappa delle parti poco sovrapposta alla sagoma (IoU ${T.iou.toFixed(2)}): Gemini ha spostato o ridisegnato il personaggio.`);
  const lab = labelOriginal(mapLab, map.width, map.height, fg, W, H, T);
  let fgN = 0, labeled = 0;
  for (let i = 0; i < W * H; i++) if (fg[i]) { fgN++; if (lab[i] >= 0) labeled++; }
  const minArea = Math.max(40, Math.round(0.0008 * fgN));
  // briciole di una parte (isole sotto minArea) -> parte con più bordo in comune
  for (let k = 0; k < PART_COLORS.length; k++)
    for (const px of components(lab, W, H, k).slice(0)) {
      if (px.length >= minArea) continue;
      const cnt = new Map();
      for (const i of px) {
        const x = i % W, y = (i - x) / W;
        for (const [dx, dy] of N4) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const v = lab[ny * W + nx];
          if (v >= 0 && v !== k) cnt.set(v, (cnt.get(v) || 0) + 1);
        }
      }
      const to = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      if (to != null) for (const i of px) lab[i] = to;
    }
  // pezzi: componenti di ogni parte
  const raw = [];
  PART_COLORS.forEach((c, k) => {
    const comps = components(lab, W, H, k).filter((px) => px.length >= minArea);
    const single = !PAIRED.has(c.part) && c.part !== "oggetto";
    // parti uniche (testa, busto, braccia...): componenti staccate unite al pezzo principale
    const groups = single && comps.length > 1 ? [comps.flat()] : comps;
    groups.forEach((px) => raw.push({ part: c.part, k, px }));
  });
  // nomi: lato del personaggio per le parti a coppia (sx = a destra per chi guarda)
  const cx = (px) => px.reduce((a, i) => a + (i % W), 0) / px.length;
  const cyOf = (px) => px.reduce((a, i) => a + Math.floor(i / W), 0) / px.length;
  const named = [];
  for (const part of new Set(raw.map((r) => r.part))) {
    const list = raw.filter((r) => r.part === part).sort((a, b) => cx(a.px) - cx(b.px));
    if (PAIRED.has(part)) {
      if (list.length === 2) { list[0].name = `${part}_dx`; list[1].name = `${part}_sx`; }
      else list.forEach((r, i) => (r.name = list.length === 1 ? part : `${part}_${i + 1}`));
    } else if (part === "oggetto") list.forEach((r, i) => (r.name = list.length === 1 ? "oggetto" : `oggetto_${i + 1}`));
    else list.forEach((r) => (r.name = part));
    named.push(...list);
  }
  // mappa pixel -> pezzo
  const owner = new Int16Array(W * H).fill(-1);
  named.forEach((r, n) => { for (const i of r.px) owner[i] = n; });
  // contatti fra pezzi (bordo in comune) e baricentro del contatto
  const contact = named.map(() => new Map());
  for (let i = 0; i < W * H; i++) {
    const a = owner[i];
    if (a < 0) continue;
    const x = i % W, y = (i - x) / W;
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx >= W || ny >= H) continue;
      const b = owner[ny * W + nx];
      if (b < 0 || b === a) continue;
      for (const [p, q] of [[a, b], [b, a]]) {
        const c = contact[p].get(q) || { n: 0, sx: 0, sy: 0 };
        c.n++; c.sx += x; c.sy += y;
        contact[p].set(q, c);
      }
    }
  }
  const byName = (n) => named.findIndex((r) => r.name === n);
  // genitori: preferito se si toccano, altrimenti il più a contatto (oggetto: il braccio che lo tiene)
  named.forEach((r, n) => {
    const pref = PARENT[r.part];
    const pi = pref ? byName(pref) : -1;
    if (r.part === "busto") { r.parent = null; return; }
    if (pi >= 0 && (contact[n].has(pi) || r.part !== "oggetto")) { r.parentIdx = pi; return; }
    const best = [...contact[n].entries()].filter(([q]) => named[q].part !== r.part).sort((a, b) => b[1].n - a[1].n)[0];
    r.parentIdx = best ? best[0] : byName("busto");
  });
  named.forEach((r) => (r.parent = r.parentIdx >= 0 ? named[r.parentIdx].name : null));
  // pivot: baricentro del contatto con il genitore (spalla, collo, polso...); viso: centro;
  // capelli e ciocche: punto di contatto più alto con la testa
  named.forEach((r, n) => {
    const c = r.parentIdx >= 0 ? contact[n].get(r.parentIdx) : null;
    if (["occhio", "sopracciglio", "bocca"].includes(r.part) || !c) r.pivot = { x: cx(r.px), y: cyOf(r.px) };
    else r.pivot = { x: c.sx / c.n, y: c.sy / c.n };
    if (r.part === "busto") {
      // radice: centro della parte bassa del busto (fianchi), come nei character esistenti
      r.pivot = { x: cx(r.px), y: cyOf(r.px) };
    }
  });
  // ritaglio dall'originale + zone nascoste: ogni pezzo si estende di hiddenPad px sotto i pezzi
  // che gli stanno DAVANTI e con cui confina (collo sotto la testa, spalla sotto il braccio,
  // palpebra sotto l'occhio), riempite per diffusione dei suoi colori
  const pad = hiddenPad ?? Math.max(10, Math.round(0.05 * Math.max(W, H)));
  const pieces = named.map((r, n) => {
    let x0 = W, y0 = H, x1 = 0, y1 = 0;
    for (const i of r.px) {
      const x = i % W, y = (i - x) / W;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const out = new Uint8ClampedArray(w * h * 4), known = new Uint8Array(w * h), fill = new Uint8Array(w * h);
    for (const i of r.px) {
      const x = i % W, y = (i - x) / W, li = (y - y0) * w + (x - x0);
      out.set(rgba.subarray(i * 4, i * 4 + 4), li * 4);
      out[li * 4 + 3] = 255;
      known[li] = 1;
    }
    // zona nascosta: pixel dei pezzi davanti entro pad px dal pezzo
    const myOrder = ORDER[r.part] ?? 3;
    const dist = new Int16Array(w * h).fill(-1), q = [];
    for (let li = 0; li < w * h; li++) if (known[li]) { dist[li] = 0; q.push(li); }
    for (let qi = 0; qi < q.length; qi++) {
      const li = q[qi];
      if (dist[li] >= pad) continue;
      const x = li % w, y = (li - x) / w;
      for (const [dx, dy] of N4) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const lj = ny * w + nx;
        if (dist[lj] >= 0) continue;
        const o = owner[(ny + y0) * W + (nx + x0)];
        if (o < 0 || (ORDER[named[o].part] ?? 3) <= myOrder) continue; // solo sotto pezzi davanti
        dist[lj] = dist[li] + 1;
        fill[lj] = 1;
        q.push(lj);
      }
    }
    diffuseFill(out, known, fill, w, h, pad + 2);
    return {
      name: r.name, part: r.part, x: x0, y: y0, width: w, height: h, rgba: out, area: r.px.length,
      parent: r.parent, pivot: { x: Math.round(r.pivot.x), y: Math.round(r.pivot.y) }, order: ORDER[r.part] ?? 3, matchError: 0
    };
  });
  // ordine finale: per parte, poi area (a parità, il più grande dietro)
  [...pieces].sort((a, b) => a.order - b.order || b.area - a.area).forEach((p, i) => (p.order = i));
  const coverage = fgN ? labeled / fgN : 0;
  return { pieces, transform: T, coverage, warnings };
}
