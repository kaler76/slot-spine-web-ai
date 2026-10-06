// src/lib/sheetSource.js — TAVOLA COME SORGENTE (6 ott 2026).
// Quando la tavola NON combacia con l'originale (personaggio ridisegnato: Jessica di GPT con abito
// lungo e gamba scoperta), i pezzi non si possono rimettere sull'originale. Qui si usano i pezzi
// della tavola COSÌ COME SONO e si montano fra loro con agganci geometrici:
//   ruoli  : dal pezzo stesso (area, colore medio, forma, posizione nella tavola);
//   montaggio: scollatura della testa-busto sul bordo alto del vestito; guanti sui moncherini
//            delle spalle; capelli dietro centrati sulla testa; ciocche ai lati; ciuffo sulla
//            fronte; viso (sopracciglia, occhi, bocca) sulle palpebre chiuse trovate sulla testa.
// Il risultato è il personaggio della TAVOLA, non quello dell'originale. Puro: nessun DOM.
// "sx/dx" = lato del personaggio: dx = a SINISTRA per chi guarda.

import { keyBackground, splitComponents, cutPiece } from "./explodedSheet.js";

/** Ordine di disegno del profilo testa-busto (dal fondo al primo piano). */
const SHEET_ORDER = ["capelli_dietro", "testa", "busto", "braccio_dx", "braccio_sx", "ciocca_dx", "ciocca_sx", "occhio_dx", "occhio_sx", "sopracciglio_dx", "sopracciglio_sx", "bocca"];
export const sheetRank = (n) => { const i = SHEET_ORDER.indexOf(n); return i >= 0 ? i : /^ciuffo/.test(n) ? 20 : 15; };

export const SHEET_SOURCE_VERSION = "2026-10-06.sorgente.1";

const opaque = (p, x, y) => x >= 0 && y >= 0 && x < p.width && y < p.height && p.rgba[(y * p.width + x) * 4 + 3] >= 128;

function stats(p) {
  let n = 0, r = 0, g = 0, b = 0, sx = 0, sy = 0;
  for (let y = 0; y < p.height; y++)
    for (let x = 0; x < p.width; x++) {
      if (!opaque(p, x, y)) continue;
      const i = (y * p.width + x) * 4;
      r += p.rgba[i]; g += p.rgba[i + 1]; b += p.rgba[i + 2]; sx += x; sy += y; n++;
    }
  return { n, color: [r / n, g / n, b / n], cx: p.x + sx / n, cy: p.y + sy / n };
}
const cdist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Asse principale (PCA) e i due estremi del pezzo lungo di esso, in coordinate globali. */
export function axisEnds(p) {
  const pts = [];
  for (let y = 0; y < p.height; y += 2) for (let x = 0; x < p.width; x += 2) if (opaque(p, x, y)) pts.push([p.x + x, p.y + y]);
  const mx = pts.reduce((a, q) => a + q[0], 0) / pts.length, my = pts.reduce((a, q) => a + q[1], 0) / pts.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const [x, y] of pts) { sxx += (x - mx) ** 2; syy += (y - my) ** 2; sxy += (x - mx) * (y - my); }
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy), ux = Math.cos(th), uy = Math.sin(th);
  let lo = Infinity, hi = -Infinity;
  for (const [x, y] of pts) { const t = (x - mx) * ux + (y - my) * uy; lo = Math.min(lo, t); hi = Math.max(hi, t); }
  // estremo = baricentro dei punti nel 6% finale dell'asse
  const end = (sgn) => {
    const lim = sgn > 0 ? hi - 0.06 * (hi - lo) : lo + 0.06 * (hi - lo);
    const sel = pts.filter(([x, y]) => { const t = (x - mx) * ux + (y - my) * uy; return sgn > 0 ? t >= lim : t <= lim; });
    return { x: sel.reduce((a, q) => a + q[0], 0) / sel.length, y: sel.reduce((a, q) => a + q[1], 0) / sel.length };
  };
  return { a: end(-1), b: end(1), length: hi - lo };
}

/** Profilo verticale per colonna: primo/ultimo pixel pieno (coordinate globali), null se vuota. */
function columnProfile(p, which) {
  const out = new Map();
  for (let x = 0; x < p.width; x++) {
    let v = null;
    if (which === "top") { for (let y = 0; y < p.height; y++) if (opaque(p, x, y)) { v = y; break; } }
    else for (let y = p.height - 1; y >= 0; y--) if (opaque(p, x, y)) { v = y; break; }
    if (v !== null) out.set(p.x + x, p.y + v);
  }
  return out;
}

/** Palpebre chiuse sulla testa: due gruppi di pixel scuri (linea delle ciglia) nella metà alta. */
export function findClosedEyes(head) {
  // linee delle ciglia = macchie SCURE e poco sature (nero, non i capelli rossi in ombra),
  // allungate in orizzontale, a coppie alla stessa altezza, nella fascia 15-55% dell'altezza
  const W = head.width, y0 = Math.round(0.15 * head.height), y1 = Math.round(0.55 * head.height);
  const dark = new Uint8Array(W * head.height);
  for (let y = y0; y < y1; y++)
    for (let x = 0; x < W; x++) {
      if (!opaque(head, x, y)) continue;
      const i = (y * W + x) * 4, r = head.rgba[i], g = head.rgba[i + 1], b = head.rgba[i + 2];
      if (0.299 * r + 0.587 * g + 0.114 * b < 70 && Math.max(r, g, b) - Math.min(r, g, b) < 70) dark[y * W + x] = 1;
    }
  const seen = new Uint8Array(W * head.height), blobs = [];
  for (let i = 0; i < dark.length; i++) {
    if (!dark[i] || seen[i]) continue;
    const st = [i]; seen[i] = 1;
    let n = 0, sx = 0, sy = 0, x0 = Infinity, x1 = -1, yA = Infinity, yB = -1;
    while (st.length) {
      const j = st.pop(), x = j % W, y = (j - x) / W;
      n++; sx += x; sy += y; x0 = Math.min(x0, x); x1 = Math.max(x1, x); yA = Math.min(yA, y); yB = Math.max(yB, y);
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const X = x + dx, Y = y + dy, k = Y * W + X;
        if (X < 0 || Y < 0 || X >= W || Y >= head.height || seen[k] || !dark[k]) continue;
        seen[k] = 1; st.push(k);
      }
    }
    const w = x1 - x0 + 1, h = yB - yA + 1;
    if (n >= 8 && w >= 1.8 * h) blobs.push({ x: head.x + sx / n, y: head.y + sy / n, n, w });
  }
  let best = null;
  for (let i = 0; i < blobs.length; i++)
    for (let j = i + 1; j < blobs.length; j++) {
      const A = blobs[i], B = blobs[j];
      const gap = Math.abs(A.x - B.x);
      if (Math.abs(A.y - B.y) > 0.05 * head.height || gap < 1.2 * Math.max(A.w, B.w) || gap > 0.5 * W) continue;
      const score = Math.min(A.n, B.n);
      if (!best || score > best.score) best = { score, pair: A.x < B.x ? [A, B] : [B, A] };
    }
  return best ? { dx: best.pair[0], sx: best.pair[1] } : null; // dx = sinistra per chi guarda
}

/**
 * @param {{width,height,rgba}} sheet - tavola esplosa
 * @returns {{ pieces, width, height, warnings, roles }} pezzi nel formato di importExplodedSheet
 *   (name, x, y, width, height, rgba, area, order, parent, pivot) montati fra loro
 */
export function assembleFromSheet(sheet, { minArea, ref = null, rolesOnly = false } = {}) {
  const warnings = [];
  const { alpha, bg } = keyBackground(sheet);
  const { lab, comps } = splitComponents(alpha, sheet.width, sheet.height, minArea ?? Math.round(0.00015 * sheet.width * sheet.height));
  let pieces = comps.map((c) => {
    const p = cutPiece(sheet, alpha, lab, c, bg);
    return { ...p, x: p.sheetX, y: p.sheetY, area: c.area };
  });
  for (const p of pieces) Object.assign(p, { st: stats(p) });

  // ---- RUOLI
  const busto = pieces.reduce((a, b) => (b.area > a.area ? b : a));
  busto.name = "busto";
  const big = busto.area;
  const small = pieces.filter((p) => p !== busto && p.area < 0.012 * big);
  const mid = pieces.filter((p) => p !== busto && !small.includes(p));
  // viso: righe dei pezzi piccoli dall'alto (sopracciglia, occhi, bocca)
  const rows = [];
  for (const p of [...small].sort((a, b) => a.st.cy - b.st.cy)) {
    const r = rows.find((row) => Math.abs(row[0].st.cy - p.st.cy) < 0.6 * Math.max(row[0].height, p.height));
    if (r) r.push(p);
    else rows.push([p]);
  }
  const pairRows = rows.filter((r) => r.length === 2), singles = rows.filter((r) => r.length === 1);
  const nameRow = (row, base) => {
    row.sort((a, b) => a.st.cx - b.st.cx);
    row[0].name = `${base}_dx`;
    row[1].name = `${base}_sx`;
  };
  if (pairRows[0]) nameRow(pairRows[0], pairRows.length > 1 ? "sopracciglio" : "occhio");
  if (pairRows[1]) nameRow(pairRows[1], "occhio");
  const lastPairY = pairRows.length ? Math.max(...pairRows.at(-1).map((p) => p.st.cy)) : -1;
  const mouth = singles.map((r) => r[0]).find((p) => p.st.cy > lastPairY);
  if (mouth) mouth.name = "bocca";
  // pezzi medi: gruppi per colore medio
  const groups = [];
  for (const p of mid) {
    const g = groups.find((gr) => cdist(gr[0].st.color, p.st.color) < 45);
    if (g) g.push(p);
    else groups.push([p]);
  }
  // braccia: gruppo di 2 pezzi allungati di area simile
  const elong = (p) => { const e = axisEnds(p); p.axis = e; return e.length / Math.sqrt(p.area); };
  const arms = groups.find((g) => g.length === 2 && g.every((p) => elong(p) > 2.2) && Math.min(g[0].area, g[1].area) > 0.6 * Math.max(g[0].area, g[1].area));
  if (arms) {
    arms.sort((a, b) => a.st.cx - b.st.cx);
    arms[0].name = "braccio_dx";
    arms[1].name = "braccio_sx";
  }
  // capelli: il gruppo più numeroso fra i restanti
  const hair = groups.filter((g) => g !== arms).sort((a, b) => b.length - a.length)[0] || [];
  const rest = mid.filter((p) => !p.name && !hair.includes(p));
  // testa: il pezzo medio più grande non-capelli (o, se i capelli sono un solo gruppo con la
  // testa, quello con più pixel scuri a coppie = palpebre)
  let testa = rest.sort((a, b) => b.area - a.area)[0];
  if (!testa) {
    testa = hair.find((p) => findClosedEyes(p)) || null;
    if (testa) hair.splice(hair.indexOf(testa), 1);
  }
  if (testa) testa.name = "testa";
  if (hair.length) {
    hair.sort((a, b) => b.area - a.area);
    hair[0].name = "capelli_dietro";
    const others = hair.slice(1);
    const locks = others.filter((p) => p.height > 1.8 * p.width).sort((a, b) => a.st.cx - b.st.cx);
    if (locks.length >= 2) { locks[0].name = "ciocca_dx"; locks[locks.length - 1].name = "ciocca_sx"; }
    else if (locks.length === 1) locks[0].name = locks[0].st.cx < sheet.width / 2 ? "ciocca_dx" : "ciocca_sx";
    for (const p of others) if (!p.name) p.name = others.filter((q) => !q.name).length > 1 ? `ciuffo_${others.indexOf(p)}` : "ciuffo";
  }
  let k = 0;
  for (const p of pieces) if (!p.name) { p.name = `pezzo_${++k}`; warnings.push(`${p.name}: ruolo non riconosciuto, agganciato al busto (controlla).`); }
  for (const need of ["testa", "braccio_dx", "braccio_sx", "occhio_dx", "occhio_sx", "bocca"])
    if (!pieces.some((p) => p.name === need)) warnings.push(`Ruolo mancante nella tavola: ${need}.`);
  const P = (n) => pieces.find((p) => p.name === n);

  if (rolesOnly) {
    for (const p of pieces) { p.x = p.sheetX; p.y = p.sheetY; }
    pieces.sort((a, b) => sheetRank(a.name) - sheetRank(b.name)).forEach((p, i) => (p.order = i));
    return { pieces, warnings, roles: pieces.map((p) => p.name) };
  }
  // ---- MISURE DALL'ORIGINALE (ref): i pixel sono della tavola, le PROPORZIONI dell'originale.
  // GPT disegna i pezzi in scale diverse fra loro (Jessica: testa e capelli grandi, vestito
  // piccolo, tratti del viso ingranditi). Ogni pezzo si riporta alla misura dell'originale:
  //   testa + capelli: distanza fra le palpebre = distanza fra gli occhi dell'originale (u);
  //   guanti/braccia: lunghezza = metà braccio + avambraccio + mano dell'originale, del suo lato;
  //   tratti del viso: distanza fra gli occhi nella tavola = u;
  //   vestito: altezza del personaggio montato = altezza della sagoma dell'originale.
  const L = ref?.landmarks;
  const lm = (i) => (L?.[i] && (L[i].visibility ?? 1) > 0.3 && (L[i].x || L[i].y) ? L[i] : null);
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const u = lm(2) && lm(5) ? dist(lm(2), lm(5)) : null;
  const scales = {};
  const rescale = (p, k) => {
    if (!p || !isFinite(k) || Math.abs(k - 1) < 0.02) return;
    k = Math.min(2.5, Math.max(0.4, k));
    const c = { x: p.x + p.width / 2, y: p.y + p.height / 2 };
    Object.assign(p, scaleNearest(p, k));
    p.x = Math.round(c.x - p.width / 2); p.y = Math.round(c.y - p.height / 2);
    p.st = stats(p); delete p.axis;
    scales[p.name] = +k.toFixed(3);
  };
  const head0 = P("testa");
  if (u && head0) {
    const lids0 = findClosedEyes(head0);
    if (lids0) {
      const k = u / dist(lids0.dx, lids0.sx);
      for (const p of pieces.filter((q) => q.name === "testa" || /^(capelli_dietro|ciocca|ciuffo)/.test(q.name))) rescale(p, k);
    } else warnings.push("Misure: palpebre non trovate sulla testa, testa lasciata alla scala della tavola.");
  }
  for (const [side, [S, E, W]] of [["dx", [12, 14, 16]], ["sx", [11, 13, 15]]]) {
    const arm = P(`braccio_${side}`);
    if (!arm || !lm(S) || !lm(E) || !lm(W)) continue;
    const want = 0.5 * dist(lm(S), lm(E)) + 1.35 * dist(lm(E), lm(W));
    rescale(arm, want / axisEnds(arm).length);
  }
  const eD = P("occhio_dx"), eS = P("occhio_sx");
  if (u && eD && eS) {
    const k = u / Math.hypot(eS.st.cx - eD.st.cx, eS.st.cy - eD.st.cy);
    const m0 = { x: (eD.st.cx + eS.st.cx) / 2, y: (eD.st.cy + eS.st.cy) / 2 };
    for (const p of pieces.filter((q) => /^(occhio|sopracciglio|bocca)/.test(q.name))) {
      // la disposizione nella tavola si scala insieme ai pezzi
      const c = { x: m0.x + (p.st.cx - m0.x) * k, y: m0.y + (p.st.cy - m0.y) * k };
      rescale(p, k);
      p.x = Math.round(c.x - p.width / 2); p.y = Math.round(c.y - p.height / 2); p.st = stats(p);
    }
  }
  const faceRef = u && lm(2) && lm(5) && lm(9) && lm(10)
    ? { eyes: { x: (lm(2).x + lm(5).x) / 2, y: (lm(2).y + lm(5).y) / 2 }, mouth: { x: (lm(9).x + lm(10).x) / 2, y: (lm(9).y + lm(10).y) / 2 } }
    : null;
  mount(pieces, busto, P, warnings, faceRef, !!u);
  if (ref?.silhouetteHeight) {
    const tops = pieces.filter((p) => p.name !== "busto").map((p) => p.y);
    const top = Math.min(busto.y, ...tops);
    const above = busto.y - top;
    const k = (ref.silhouetteHeight - above) / busto.height;
    const topCenter = { x: busto.x + busto.width / 2, y: busto.y };
    if (isFinite(k) && Math.abs(k - 1) >= 0.02) {
      rescale(busto, k);
      busto.x = Math.round(topCenter.x - busto.width / 2); busto.y = topCenter.y;
      busto.st = stats(busto);
      mount(pieces, busto, P, warnings, faceRef, !!u);
    }
  }
  if (Object.keys(scales).length)
    warnings.push(`Proporzioni dall'originale: ${Object.entries(scales).map(([n, k]) => `${n} ×${k}`).join(", ")}.`);

  // ---- RIG: genitori, pivot, ordine di disegno
  const PARENT = { testa: "busto", braccio_dx: "busto", braccio_sx: "busto", capelli_dietro: "testa" };
  for (const p of pieces) {
    p.parent = p.name === "busto" ? null : PARENT[p.name] || (/^(ciocca|ciuffo|occhio|sopracciglio|bocca)/.test(p.name) ? "testa" : "busto");
    if (p.pivot) continue;
    if (p.name === "busto") p.pivot = { x: Math.round(p.x + p.width / 2), y: p.y + p.height };
    else if (p.name === "testa") {
      const yt = columnProfile(busto, "top").get(Math.round(stats(p).cx));
      p.pivot = { x: Math.round(stats(p).cx), y: yt ?? p.y + p.height };
    } else if (/^(capelli_dietro|ciocca|ciuffo)/.test(p.name)) p.pivot = { x: Math.round(p.x + p.width / 2), y: p.y + Math.round(0.04 * p.height) };
    else p.pivot = { x: Math.round(p.x + p.width / 2), y: Math.round(p.y + p.height / 2) };
  }
  pieces.sort((a, b) => sheetRank(a.name) - sheetRank(b.name)).forEach((p, i) => (p.order = i));

  // ---- tela: tutto dentro, con margine
  const M = 16;
  const minX = Math.min(...pieces.map((p) => p.x)) - M, minY = Math.min(...pieces.map((p) => p.y)) - M;
  const maxX = Math.max(...pieces.map((p) => p.x + p.width)) + M, maxY = Math.max(...pieces.map((p) => p.y + p.height)) + M;
  for (const p of pieces) {
    p.x -= minX; p.y -= minY;
    p.pivot = { x: p.pivot.x - minX, y: p.pivot.y - minY };
    p.matchError = 0;
    delete p.st; delete p.axis;
  }
  return { pieces, width: maxX - minX, height: maxY - minY, warnings, roles: pieces.map((p) => p.name) };
}


/** MONTAGGIO dei pezzi intorno al busto (fermo). Ripetibile: ogni aggancio è un bersaglio assoluto. */
function mount(pieces, busto, P, warnings, faceRef, sizedFromRef) {
  // ---- MONTAGGIO (coordinate della tavola; il busto resta dov'è)
  const move = (p, dx, dy) => { p.x = Math.round(p.x + dx); p.y = Math.round(p.y + dy); };
  const head = P("testa");
  if (head) {
    // scollatura sul bordo alto del vestito: per ogni colonna comune, fondo della testa - cima del
    // vestito; si cerca lo spostamento orizzontale con la differenza più regolare, poi la
    // sovrapposizione verticale (il petto entra sotto il vestito di OVERLAP px)
    const top = columnProfile(busto, "top");
    const OVERLAP = Math.max(6, Math.round(0.02 * head.height));
    let best = null;
    const bot0 = columnProfile(head, "bottom");
    for (let dx = Math.round(busto.st.cx - head.st.cx) - 80; dx <= Math.round(busto.st.cx - head.st.cx) + 80; dx += 2) {
      const d = [];
      for (const [x, yb] of bot0) { const yt = top.get(x + dx); if (yt !== undefined) d.push(yb - yt); }
      if (d.length < 0.3 * head.width) continue;
      d.sort((a, b) => a - b);
      const med = d[d.length >> 1];
      // regolarità: scarto medio dalla mediana nelle colonne centrali (scollatura)
      const spread = d.reduce((a, v) => a + Math.min(40, Math.abs(v - med)), 0) / d.length;
      if (!best || spread < best.spread) best = { dx, med, spread };
    }
    if (best) move(head, best.dx, -best.med + OVERLAP);
    else { move(head, busto.st.cx - head.st.cx, busto.y - (head.y + head.height) + OVERLAP); warnings.push("testa: scollatura non trovata, centrata sopra il vestito (controlla)."); }
    head.st = stats(head);
  }
  // bracci: estremo di attacco (quello più vicino al centro del corpo) sul moncherino della spalla
  // del suo lato (pixel più in basso del lato esterno della testa-busto)
  if (head)
    for (const side of ["dx", "sx"]) {
      const arm = P(`braccio_${side}`);
      if (!arm) continue;
      const e = arm.axis || axisEnds(arm);
      const bodyX = head.st.cx;
      const attach = Math.abs(e.a.x - bodyX) < Math.abs(e.b.x - bodyX) ? e.a : e.b;
      // moncherino: fra le colonne del 20% esterno della testa-busto, il fondo più basso
      const cols = columnProfile(head, "bottom");
      const xs = [...cols.keys()].sort((a, b) => a - b);
      const band = side === "dx" ? xs.slice(0, Math.ceil(0.2 * xs.length)) : xs.slice(-Math.ceil(0.2 * xs.length));
      let sx = 0, sy = 0;
      for (const x of band) { sx += x; sy += cols.get(x); }
      const stump = { x: sx / band.length, y: sy / band.length };
      const dx = stump.x - attach.x, dy = stump.y - attach.y;
      move(arm, dx, dy);
      arm.pivot = { x: Math.round(attach.x + dx), y: Math.round(attach.y + dy) };
    }
  // testa: parte alta (capigliatura + viso) = righe sopra il 45%
  const crown = head && (() => {
    const yLim = head.y + 0.45 * head.height;
    let x0 = Infinity, x1 = -Infinity;
    for (let y = 0; y < head.height; y++) for (let x = 0; x < head.width; x++) if (head.y + y < yLim && opaque(head, x, y)) { x0 = Math.min(x0, head.x + x); x1 = Math.max(x1, head.x + x); }
    return { x0, x1, cx: (x0 + x1) / 2, top: head.y, h: 0.45 * head.height };
  })();
  const back = P("capelli_dietro");
  if (back && crown) move(back, crown.cx - (back.x + back.width / 2), crown.top - 0.04 * back.height - back.y);
  for (const side of ["dx", "sx"]) {
    const lock = P(`ciocca_${side}`);
    if (!lock || !crown) continue;
    const targetX = side === "dx" ? crown.x0 + 0.08 * (crown.x1 - crown.x0) : crown.x1 - 0.08 * (crown.x1 - crown.x0);
    move(lock, targetX - (lock.x + lock.width / 2), crown.top + 0.45 * crown.h - lock.y);
  }
  for (const p of pieces.filter((q) => /^ciuffo/.test(q.name)))
    if (crown) move(p, crown.x0 + 0.25 * (crown.x1 - crown.x0) - (p.x + p.width / 2), crown.top + 0.05 * crown.h - p.y);
  // viso: trasformazione (scala + traslazione) dai centri degli occhi nella tavola alle palpebre chiuse
  const eDx = P("occhio_dx"), eSx = P("occhio_sx");
  const lids = head && findClosedEyes(head);
  if (eDx && eSx && lids) {
    const a0 = eDx.st, a1 = eSx.st;
    const s = Math.hypot(lids.sx.x - lids.dx.x, lids.sx.y - lids.dx.y) / Math.hypot(a1.cx - a0.cx, a1.cy - a0.cy);
    // tratti già portati alle misure dell'originale: solo traslazione
    const scale = sizedFromRef || Math.abs(s - 1) < 0.08 ? 1 : s;
    if (scale !== 1) warnings.push(`Viso: tratti disegnati in scala diversa dalla testa (×${(1 / scale).toFixed(2)}): riportati alla scala della testa.`);
    // occhio aperto: il centro sta un po' sopra la linea delle ciglia chiuse
    const lift = 0.25 * ((eDx.height + eSx.height) / 2) * scale;
    const mx = (a0.cx + a1.cx) / 2, my = (a0.cy + a1.cy) / 2;
    const tx = (lids.dx.x + lids.sx.x) / 2, ty = (lids.dx.y + lids.sx.y) / 2 - lift;
    for (const p of pieces.filter((q) => /^(occhio|sopracciglio|bocca)/.test(q.name))) {
      const sp = scale === 1 ? p : scaleNearest(p, scale);
      const c = { x: tx + (p.st.cx - mx) * scale, y: ty + (p.st.cy - my) * scale };
      Object.assign(p, sp, { x: Math.round(c.x - sp.width / 2), y: Math.round(c.y - sp.height / 2) });
      // bocca: alla distanza dagli occhi dell'ORIGINALE (GPT la mette dove vuole nella tavola)
      if (faceRef && p.name === "bocca") {
        p.x = Math.round(tx + (faceRef.mouth.x - faceRef.eyes.x) - p.width / 2);
        p.y = Math.round(ty + (faceRef.mouth.y - faceRef.eyes.y) - p.height / 2); // ty = centro degli occhi aperti
      }
    }
    for (const p of pieces.filter((q) => /^(occhio|sopracciglio|bocca)/.test(q.name))) p.st = stats(p);
  } else if (eDx || eSx) warnings.push("Viso: palpebre chiuse non trovate sulla testa, tratti lasciati come nella tavola (controlla).");

}

export function scaleNearest(p, s) {
  // ricampionamento a media d'area (alpha premoltiplicata): niente scalini sui tratti rimpiccioliti
  const w = Math.max(1, Math.round(p.width * s)), h = Math.max(1, Math.round(p.height * s));
  const out = new Uint8ClampedArray(w * h * 4);
  const fx = p.width / w, fy = p.height / h;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const x0 = x * fx, x1 = x0 + fx, y0 = y * fy, y1 = y0 + fy;
      let r = 0, g = 0, b = 0, a = 0, wsum = 0;
      for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++)
        for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
          if (sx >= p.width || sy >= p.height) continue;
          const wx = Math.min(sx + 1, x1) - Math.max(sx, x0), wy = Math.min(sy + 1, y1) - Math.max(sy, y0);
          const wgt = wx * wy;
          if (wgt <= 0) continue;
          const i = (sy * p.width + sx) * 4, al = p.rgba[i + 3] / 255;
          r += p.rgba[i] * al * wgt; g += p.rgba[i + 1] * al * wgt; b += p.rgba[i + 2] * al * wgt; a += al * wgt; wsum += wgt;
        }
      if (!wsum || !a) continue;
      const j = (y * w + x) * 4;
      out[j] = r / a; out[j + 1] = g / a; out[j + 2] = b / a; out[j + 3] = Math.round((255 * a) / wsum);
    }
  return { width: w, height: h, rgba: out };
}
