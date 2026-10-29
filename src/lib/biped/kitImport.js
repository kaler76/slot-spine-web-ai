// src/lib/biped/kitImport.js — dal KIT GENERATO DALL'AI al kit "nato per Spine".
// Ingresso: 3 immagini prodotte dal generatore (fondo chroma):
//  - reference: il personaggio intero in posa neutra di animazione (mezzo busto);
//  - bodySheet: la tavola dei pezzi del corpo (testa senza tratti, capelli dietro, busto senza
//    braccia, omero/avambraccio/mano per lato), pezzi solo spostati: stessa scala e orientamento;
//  - faceSheet: riga 1 occhio dx, occhio sx, sopracciglio dx, sopracciglio sx; riga 2 cinque bocche
//    (neutra, risata aperta, "O", sorriso largo, triste).
// Uscita: { kit, images, report } per bipedRig.buildBipedSkeleton.
// Come: chroma key → pezzi → ognuno ricollocato sulla posa neutra (ricerca per confronto di
// colore) → ruoli dalla geometria (busto = il più grande, testa = pelle in alto, capelli = senza
// pelle, braccia per lato e altezza) → articolazioni dalle estremità tonde dei pezzi.
// Puro: nessun DOM (immagini { width, height, rgba }).

import { keyBackground, splitComponents, cutPiece, alignPiece, estimateScale, scalePiece } from "../explodedSheet.js";

export const KIT_IMPORT_VERSION = "2026-10-29.kit.1";
const MOUTHS = ["neutral", "open", "o", "smile", "sad"];

/** Errore medio (troncato a 120) del pezzo posto in (x,y) sull'immagine, su pixel campione. */
function matchAt(p, img, x0, y0, step = 4) {
  let e = 0, n = 0;
  for (let y = 0; y < p.height; y += step)
    for (let x = 0; x < p.width; x += step) {
      const li = (y * p.width + x) * 4;
      if (p.rgba[li + 3] < 240) continue;
      const gx = x0 + x, gy = y0 + y;
      n++;
      if (gx < 0 || gy < 0 || gx >= img.width || gy >= img.height) { e += 120; continue; }
      const gi = (gy * img.width + gx) * 4;
      e += Math.min(120, Math.abs(img.rgba[gi] - p.rgba[li]) + Math.abs(img.rgba[gi + 1] - p.rgba[li + 1]) + Math.abs(img.rgba[gi + 2] - p.rgba[li + 2]));
    }
  return e / Math.max(1, n);
}

function pieces(img, minArea) {
  const { alpha, bg } = keyBackground(img);
  const { lab, comps } = splitComponents(alpha, img.width, img.height, minArea);
  return comps.map((c) => ({ ...cutPiece(img, alpha, lab, c, bg), area: c.area }));
}

/** Immagine ridotta (media dei pixel) per lavorare più in fretta. */
export function downscale(img, f) {
  if (f === 1) return img;
  const w = Math.round(img.width * f), h = Math.round(img.height * f);
  const out = new Uint8ClampedArray(w * h * 4);
  const k = 1 / f;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const acc = [0, 0, 0, 0];
      let n = 0;
      for (let yy = Math.floor(y * k); yy < Math.min(img.height, Math.floor((y + 1) * k)); yy++)
        for (let xx = Math.floor(x * k); xx < Math.min(img.width, Math.floor((x + 1) * k)); xx++) {
          const i = (yy * img.width + xx) * 4;
          for (let c = 0; c < 4; c++) acc[c] += img.rgba[i + c];
          n++;
        }
      for (let c = 0; c < 4; c++) out[(y * w + x) * 4 + c] = acc[c] / Math.max(1, n);
    }
  return { width: w, height: h, rgba: out };
}

/** Pixel opachi del pezzo in coordinate della posa (dopo il ricollocamento). */
function opaquePoints(p, step = 2) {
  const pts = [];
  for (let y = 0; y < p.height; y += step) for (let x = 0; x < p.width; x += step) if (p.rgba[(y * p.width + x) * 4 + 3] > 200) pts.push({ x: p.x + x, y: p.y + y });
  return pts;
}

const skinShare = (p) => {
  let n = 0, s = 0;
  for (let i = 0; i < p.width * p.height; i += 3) {
    if (p.rgba[i * 4 + 3] < 200) continue;
    n++;
    const r = p.rgba[i * 4], g = p.rgba[i * 4 + 1], b = p.rgba[i * 4 + 2];
    // pelle: calda e satura (i capelli bianchi o grigi, anche se caldi, hanno r−b piccolo)
    if (r > 140 && r - g > 25 && g - b > 15 && r - b > 70 && r - b < 170) s++;
  }
  return s / Math.max(1, n);
};

/**
 * Asse principale (PCA) di un pezzo allungato e le due estremità "di articolazione": il centro
 * della calotta tonda, cioè l'estremo lungo l'asse spostato verso l'interno di mezzo spessore.
 */
export function limbAxis(p) {
  const pts = opaquePoints(p);
  const cx = pts.reduce((a, q) => a + q.x, 0) / pts.length, cy = pts.reduce((a, q) => a + q.y, 0) / pts.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const q of pts) { sxx += (q.x - cx) ** 2; syy += (q.y - cy) ** 2; sxy += (q.x - cx) * (q.y - cy); }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const ux = Math.cos(ang), uy = Math.sin(ang);
  let lo = Infinity, hi = -Infinity, wmax = 0;
  for (const q of pts) {
    const t = (q.x - cx) * ux + (q.y - cy) * uy, n = Math.abs(-(q.x - cx) * uy + (q.y - cy) * ux);
    lo = Math.min(lo, t); hi = Math.max(hi, t); wmax = Math.max(wmax, n);
  }
  const r = Math.min(wmax, (hi - lo) / 4);
  const a = { x: cx + ux * (lo + r), y: cy + uy * (lo + r) }, b = { x: cx + ux * (hi - r), y: cy + uy * (hi - r) };
  const tipA = { x: cx + ux * lo, y: cy + uy * lo }, tipB = { x: cx + ux * hi, y: cy + uy * hi };
  return { center: { x: cx, y: cy }, a, b, tipA, tipB, halfWidth: wmax };
}

const mid = (p, q) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });

/**
 * Palpebre chiuse dipinte sulla testa: tratti scuri (ciglia) nella fascia degli occhi, lontani dal
 * contorno della testa. Restituisce per lato (dx = a sinistra per chi guarda) centro e larghezza.
 */
export function closedLids(head, targets) {
  const W = head.width, H = head.height;
  const out = {};
  for (const sd of ["dx", "sx"]) {
    // si cerca solo attorno alla zona dell'occhio accesa dalla differenza (rughe, orecchie e capelli
    // hanno tratti scuri anche loro); poi si tiene il gruppo scuro più grande (la riga delle ciglia)
    const t = targets[sd];
    const cx = Math.round(t.cx - head.x), cy = Math.round(t.cy - head.y), R = Math.round(t.r * 1.6);
    const dark = new Uint8Array(W * H);
    for (let y = Math.max(0, cy - R); y < Math.min(H, cy + R); y++)
      for (let x = Math.max(0, cx - R); x < Math.min(W, cx + R); x++) {
        const i = (y * W + x) * 4;
        const lum = 0.3 * head.rgba[i] + 0.59 * head.rgba[i + 1] + 0.11 * head.rgba[i + 2];
        if (head.rgba[i + 3] > 200 && lum < 90) dark[y * W + x] = 1;
      }
    const seen = new Uint8Array(W * H);
    let best = null;
    for (let i = 0; i < W * H; i++) {
      if (!dark[i] || seen[i]) continue;
      const st = [i]; seen[i] = 1;
      let n = 0, sx = 0, sy = 0, mnx = Infinity, mxx = -Infinity;
      while (st.length) {
        const j = st.pop(); const x = j % W, y = (j - x) / W;
        n++; sx += x; sy += y; mnx = Math.min(mnx, x); mxx = Math.max(mxx, x);
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          const k = (y + dy) * W + (x + dx);
          if (x + dx >= 0 && x + dx < W && y + dy >= 0 && y + dy < H && dark[k] && !seen[k]) { seen[k] = 1; st.push(k); }
        }
      }
      // la riga delle ciglia è larga e bassa; si preferisce il gruppo più largo vicino al centro
      const score = (mxx - mnx) - 0.5 * Math.hypot(sx / n - cx, sy / n - cy);
      if (n >= 10 && (!best || score > best.score)) best = { score, cx: head.x + sx / n, cy: head.y + sy / n, w: mxx - mnx, n };
    }
    if (!best) return null;
    out[sd] = best;
  }
  return out;
}

/** Larghezza del bianco dell'occhio (da angolo ad angolo) nel pezzo occhio della tavola. */
function eyeWhiteWidth(p) {
  let mn = Infinity, mx = -Infinity;
  for (let y = 0; y < p.height; y++)
    for (let x = 0; x < p.width; x++) {
      const i = (y * p.width + x) * 4;
      if (p.rgba[i + 3] > 200 && p.rgba[i] > 200 && p.rgba[i + 1] > 200 && p.rgba[i + 2] > 200) { mn = Math.min(mn, x); mx = Math.max(mx, x); }
    }
  return mx > mn ? mx - mn : p.width * 0.8;
}
const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);

/**
 * @param {{reference, bodySheet, faceSheet}} imgs - immagini { width, height, rgba }
 * @param {{ work?: number }} opt - fattore di riduzione di lavoro (default 0.5)
 */
export function importBipedKit({ reference, bodySheet, faceSheet }, opt = {}) {
  const f = opt.work ?? 0.5;
  const ref = downscale(reference, f);
  const report = { version: KIT_IMPORT_VERSION, warnings: [], pieces: [] };

  // 1) pezzi del corpo e scala comune (dal pezzo più grande: il busto)
  const body = pieces(downscale(bodySheet, f), 400 * f * f * 4).sort((a, b) => b.area - a.area);
  if (body.length < 9) throw new Error(`Tavola del corpo: ${body.length} pezzi, ne servono 9 (testa, capelli, busto, 3 per braccio).`);
  if (body.length > 9) report.warnings.push(`Tavola del corpo: ${body.length} pezzi, uso i 9 più grandi.`);
  const kept = body.slice(0, 9);
  const s = estimateScale(kept[0], ref);
  // il busto si cerca su tutta l'immagine; gli altri pezzi vicino a dove la TAVOLA li mette rispetto
  // al busto (la tavola è un esploso: pezzi solo allontanati), così il braccio sinistro non finisce
  // sul destro (sono quasi simmetrici)
  for (const p of kept) p.sheet = { x: p.sheetX, y: p.sheetY, w: p.width, h: p.height };
  const t = kept[0];
  {
    const sp = scalePiece(t, s);
    const pos = alignPiece(sp, ref, 1, { coarse: 6, nFew: 300 });
    Object.assign(t, sp, { x: pos.x, y: pos.y, err: pos.err });
  }
  const tc = { x: t.sheet.x + t.sheet.w / 2, y: t.sheet.y + t.sheet.h / 2 };
  // testa e capelli dietro: sono i due pezzi più in alto nella tavola; stanno sopra il collo, cioè
  // centrati sul busto in orizzontale (finestra stretta in x: la testa non scivola sui capelli)
  const byY = kept.slice(1).sort((a, b) => a.sheet.y + a.sheet.h / 2 - (b.sheet.y + b.sheet.h / 2));
  const headish = new Set(byY.slice(0, 2));
  for (const p of kept.slice(1)) {
    const sp = scalePiece(p, s);
    const exp = { x: t.x + t.width / 2 + (p.sheet.x + p.sheet.w / 2 - tc.x) * s, y: t.y + t.height / 2 + (p.sheet.y + p.sheet.h / 2 - tc.y) * s };
    let pos;
    if (headish.has(p)) {
      pos = { err: Infinity };
      const cx = t.x + t.width / 2 - sp.width / 2;
      for (let dx = -0.04 * ref.width; dx <= 0.04 * ref.width; dx += 2)
        for (let y = Math.max(-sp.height / 2, t.y - sp.height * 1.1); y <= t.y; y += 3) {
          const e = matchAt(sp, ref, Math.round(cx + dx), Math.round(y));
          if (e < pos.err) pos = { x: Math.round(cx + dx), y: Math.round(y), err: e };
        }
    } else pos = alignPiece(sp, ref, 1, { coarse: 4, nFew: 300, window: { cx: exp.x, cy: exp.y, r: 0.22 * ref.width } });
    Object.assign(p, sp, { x: pos.x, y: pos.y, err: pos.err });
  }

  // 2) ruoli
  const torso = kept[0];
  const others = kept.slice(1);
  const top = [...others].sort((a, b) => a.sheet.y + a.sheet.h / 2 - (b.sheet.y + b.sheet.h / 2)).slice(0, 2);
  const [head, hair] = [...top].sort((a, b) => skinShare(b) - skinShare(a));
  // i capelli dietro sono quasi tutti nascosti nella posa: non si possono cercare per colore.
  // Stanno dietro la testa, centrati, alla stessa altezza che hanno nella tavola rispetto alla testa.
  hair.x = Math.round(head.x + head.width / 2 - hair.width / 2);
  hair.y = Math.round(head.y + (hair.sheet.y - head.sheet.y) * s);
  const arms = others.filter((p) => p !== head && p !== hair);
  const tcx = torso.sheet.x + torso.sheet.w / 2;
  const side = (p) => (p.sheet.x + p.sheet.w / 2 < tcx ? "dx" : "sx"); // sx/dx = lato del personaggio (dalla tavola)
  const roles = new Map([[torso, "torso"], [head, "head"], [hair, "hair_back"]]);
  for (const sd of ["dx", "sx"]) {
    const chain = arms.filter((p) => side(p) === sd).sort((a, b) => a.sheet.y + a.sheet.h / 2 - (b.sheet.y + b.sheet.h / 2));
    if (chain.length !== 3) throw new Error(`Braccio ${sd}: trovati ${chain.length} pezzi invece di 3 (omero, avambraccio, mano).`);
    chain.forEach((p, i) => roles.set(p, `${["upper_arm", "forearm", "hand"][i]}_${sd}`));
  }

  // 3) articolazioni dalle estremità tonde
  const P = {};
  for (const sd of ["dx", "sx"]) {
    const [ua, fa, hd] = ["upper_arm", "forearm", "hand"].map((r) => [...roles].find(([, v]) => v === `${r}_${sd}`)[0]);
    const axU = limbAxis(ua), axF = limbAxis(fa), axH = limbAxis(hd);
    // estremo vicino = quello più vicino al pezzo precedente nella catena (spalla: il più alto)
    const near = (ax, pt) => (dist(ax.a, pt) <= dist(ax.b, pt) ? [ax.a, ax.b] : [ax.b, ax.a]);
    const [uTop, uBot] = axU.a.y <= axU.b.y ? [axU.a, axU.b] : [axU.b, axU.a];
    const [fNear, fFar] = near(axF, uBot);
    const [hNear] = near(axH, fFar);
    const hFar = dist(axH.tipA, hNear) > dist(axH.tipB, hNear) ? axH.tipA : axH.tipB;
    P[`shoulder_${sd}`] = uTop;
    P[`elbow_${sd}`] = mid(uBot, fNear);
    P[`wrist_${sd}`] = mid(fFar, hNear);
    P[`fingertip_${sd}`] = hFar;
    report.pieces.push({ side: sd, upperArmLen: Math.round(dist(uTop, uBot)), forearmLen: Math.round(dist(fNear, fFar)), gapElbow: Math.round(dist(uBot, fNear)), gapWrist: Math.round(dist(fFar, hNear)) });
  }
  // collo: dove la testa incontra il busto (centro della testa, primo pixel del busto sotto)
  const hcx = head.x + head.width / 2;
  const colTop = (p, x) => { const lx = Math.round(x - p.x); for (let y = 0; y < p.height; y++) if (p.rgba[(y * p.width + lx) * 4 + 3] > 200) return p.y + y; return p.y; };
  P.neck = { x: hcx, y: colTop(torso, hcx) };
  P.crown = { x: hcx, y: colTop(head, hcx) };
  P.waist = { x: torso.x + torso.width / 2, y: torso.y + torso.height * 0.92 };

  // 4) viso: tratti cercati sulla posa neutra, a più scale, nella zona del viso
  const face = pieces(downscale(faceSheet, f), 60 * f * f * 4);
  const rowY = (p) => p.sheetY + p.height / 2;
  const sorted = [...face].sort((a, b) => rowY(a) - rowY(b));
  const yCut = (rowY(sorted[0]) + rowY(sorted[sorted.length - 1])) / 2;
  const row1 = face.filter((p) => rowY(p) < yCut).sort((a, b) => a.sheetX - b.sheetX);
  const row2 = face.filter((p) => rowY(p) >= yCut).sort((a, b) => a.sheetX - b.sheetX);
  const faceParts = [];
  const headBox = { x0: head.x, y0: head.y, x1: head.x + head.width, y1: head.y + head.height };
  const hw = headBox.x1 - headBox.x0, hh = headBox.y1 - headBox.y0;
  // DOVE stanno i tratti: la testa della tavola ha palpebre chiuse, niente sopracciglia e niente bocca;
  // la posa neutra li ha. La differenza fra le due, sopra la testa, accende proprio quelle zone.
  const diff = new Uint8Array(head.width * head.height);
  for (let y = 0; y < head.height; y++)
    for (let x = 0; x < head.width; x++) {
      const li = (y * head.width + x) * 4;
      if (head.rgba[li + 3] < 200) continue;
      const gx = head.x + x, gy = head.y + y;
      if (gx < 0 || gy < 0 || gx >= ref.width || gy >= ref.height) continue;
      const gi = (gy * ref.width + gx) * 4;
      const d = Math.abs(ref.rgba[gi] - head.rgba[li]) + Math.abs(ref.rgba[gi + 1] - head.rgba[li + 1]) + Math.abs(ref.rgba[gi + 2] - head.rgba[li + 2]);
      if (d > 110) diff[y * head.width + x] = 1;
    }
  const zone = (x0f, x1f, y0f, y1f) => {
    // baricentro e riquadro dei pixel diversi nella zona (frazioni della testa)
    let n = 0, sx = 0, sy = 0, mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity;
    for (let y = Math.floor(y0f * head.height); y < Math.min(head.height, y1f * head.height); y++)
      for (let x = Math.floor(x0f * head.width); x < Math.min(head.width, x1f * head.width); x++)
        if (diff[y * head.width + x]) { n++; sx += x; sy += y; mnx = Math.min(mnx, x); mxx = Math.max(mxx, x); mny = Math.min(mny, y); mxy = Math.max(mxy, y); }
    return n < 20 ? null : { cx: head.x + sx / n, cy: head.y + sy / n, w: mxx - mnx, h: mxy - mny, n };
  };
  // i tratti della tavola del viso spesso sono disegnati più grandi: scala cercata ampia, UGUALE per
  // i due occhi e per le due sopracciglia (coppia), posizione vicina alla zona accesa dalla differenza
  const KS = []; for (let k = 0.3; k <= 1.25; k += 0.05) KS.push(+k.toFixed(2));
  const findPair = (pa, pb, wa, wb) => {
    let best = null;
    for (const k of KS) {
      const sa = scalePiece(pa, s * k), sb = scalePiece(pb, s * k);
      if (sa.width < 4 || sb.width < 4) continue;
      const A = alignPiece(sa, ref, 1, { coarse: 2, nFew: 300, window: wa }), B = alignPiece(sb, ref, 1, { coarse: 2, nFew: 300, window: wb });
      const e = A.err + B.err;
      if (!best || e < best.e) best = { e, k, a: { sp: sa, pos: A }, b: { sp: sb, pos: B } };
    }
    return best;
  };
  const findIn = (piece, win) => {
    let best = null;
    for (const k of KS) {
      const sp = scalePiece(piece, s * k);
      if (sp.width < 4 || sp.height < 4) continue;
      const pos = alignPiece(sp, ref, 1, { coarse: 2, nFew: 300, window: win });
      if (!best || pos.err < best.pos.err) best = { sp, pos, k };
    }
    return best;
  };
  if (row1.length >= 4) {
    const tgt = {};
    for (const [role, sd, x0f, x1f] of [["eye", "dx", 0.1, 0.5], ["eye", "sx", 0.5, 0.9], ["brow", "dx", 0.1, 0.5], ["brow", "sx", 0.5, 0.9]]) {
      // occhi più in basso delle sopracciglia: la zona del lato si divide a metà altezza dei tratti
      const all = zone(x0f, x1f, 0.15, 0.55);
      const z = all && (role === "eye" ? zone(x0f, x1f, (all.cy - head.y) / head.height, 0.55) : zone(x0f, x1f, 0.15, (all.cy - head.y) / head.height));
      const t = z || all || { cx: headBox.x0 + (x0f + x1f) / 2 * hw, cy: headBox.y0 + (role === "eye" ? 0.42 : 0.33) * hh };
      tgt[`${role}_${sd}`] = { cx: t.cx, cy: t.cy, r: Math.max(10, 0.06 * hw), src: z ? "diff" : "stima" };
    }
    // GEOMETRIA DEL VISO (regole fisse):
    //  R1 le palpebre chiuse dipinte sulla testa dicono dove stanno gli occhi: ogni occhio aperto è
    //     centrato sulla sua palpebra (stesso centro), largo quanto la palpebra;
    //  R2 i due occhi hanno la stessa altezza e sono simmetrici rispetto alla linea mediana del viso
    //     (punto medio fra le palpebre); stessa scala per i due occhi;
    //  R3 le sopracciglia stanno sopra gli occhi, alla stessa altezza fra loro, simmetriche rispetto
    //     alla mediana, centrate sulla verticale del proprio occhio; stessa scala fra loro;
    //  R4 la bocca è centrata sulla mediana.
    const lids = closedLids(head, { dx: tgt.eye_dx, sx: tgt.eye_sx });
    const eyeFit = findPair(row1[0], row1[1], tgt.eye_dx, tgt.eye_sx);
    const browFit = findPair(row1[2], row1[3], tgt.brow_dx, tgt.brow_sx);
    let mid, eyeY, half, eyeK = eyeFit.k;
    if (lids) {
      mid = (lids.dx.cx + lids.sx.cx) / 2;
      eyeY = (lids.dx.cy + lids.sx.cy) / 2;
      half = (lids.sx.cx - lids.dx.cx) / 2;
      // larghezza: la palpebra chiusa copre l'occhio da angolo ad angolo (bianco compreso)
      const lidW = (lids.dx.w + lids.sx.w) / 2;
      eyeK = (1.08 * lidW) / eyeWhiteWidth(row1[0]) / s; // R1: un filo più largo della palpebra, così le ciglia chiuse non spuntano ai lati
      report.face = { rule: "palpebre", lidW: Math.round(lidW), mid: Math.round(mid), eyeY: Math.round(eyeY), half: Math.round(half) };
    } else {
      const ca = { x: eyeFit.a.pos.x + eyeFit.a.sp.width / 2, y: eyeFit.a.pos.y + eyeFit.a.sp.height / 2 }, cb = { x: eyeFit.b.pos.x + eyeFit.b.sp.width / 2, y: eyeFit.b.pos.y + eyeFit.b.sp.height / 2 };
      mid = (ca.x + cb.x) / 2; eyeY = (ca.y + cb.y) / 2; half = Math.abs(cb.x - ca.x) / 2;
      report.warnings.push("Palpebre chiuse non trovate sulla testa: occhi posti per somiglianza e resi simmetrici.");
      report.face = { rule: "simmetria" };
    }
    report.face.mid = Math.round(mid);
    for (const [sd, i, sign] of [["dx", 0, -1], ["sx", 1, +1]]) {
      const sp = scalePiece(row1[i], s * eyeK);
      // la riga delle ciglia chiuse sta un po' sotto il centro dell'occhio aperto
      faceParts.push({ role: "eye", side: sd, piece: sp, x: Math.round(mid + sign * half - sp.width / 2), y: Math.round(eyeY - (lids ? 0.12 * sp.height : 0) - sp.height / 2), err: 0, scale: +eyeK.toFixed(2), target: lids ? "palpebra" : "simmetria" });
    }
    // sopracciglia: altezza e distanza dalla mediana medie fra le due trovate, poi simmetriche
    const bA = browFit.a, bB = browFit.b;
    const byA = bA.pos.y + bA.sp.height / 2, byB = bB.pos.y + bB.sp.height / 2;
    const browY = Math.min((byA + byB) / 2, eyeY - 0.55 * half); // sempre sopra l'occhio
    for (const [sd, r, sign] of [["dx", bA, -1], ["sx", bB, +1]]) {
      faceParts.push({ role: "brow", side: sd, piece: r.sp, x: Math.round(mid + sign * half - r.sp.width / 2), y: Math.round(browY - r.sp.height / 2), err: r.pos.err, scale: browFit.k, target: "simmetria" });
    }
  } else report.warnings.push(`Tavola del viso: ${row1.length} pezzi nella prima riga invece di 4.`);
  let mouth = null;
  if (row2.length >= 5) {
    const z = zone(0.3, 0.7, 0.5, 0.85);
    const tgt = z || { cx: headBox.x0 + 0.5 * hw, cy: headBox.y0 + 0.65 * hh, w: 0 };
    // la bocca della tavola porta con sé baffi e barba: si allinea sulla barba della posa neutra
    const neutral = findIn(row2[0], { cx: tgt.cx, cy: tgt.cy + 0.08 * hh, r: 0.08 * hw });
    const cx = report.face?.mid ?? neutral.pos.x + neutral.sp.width / 2, cyTop = neutral.pos.y; // R4: bocca sulla mediana
    const variants = {};
    row2.slice(0, 5).forEach((p, i) => {
      const sp = scalePiece(p, s * neutral.k);
      variants[MOUTHS[i]] = { piece: sp, x: Math.round(cx - sp.width / 2), y: Math.round(cyTop) };
    });
    mouth = { variants, err: neutral.pos.err, scale: +neutral.k.toFixed(2) };
  } else report.warnings.push(`Tavola del viso: ${row2.length} bocche invece di 5.`);
  const eyes = faceParts.filter((p) => p.role === "eye");
  P.face_center = eyes.length === 2 ? mid({ x: eyes[0].x + eyes[0].piece.width / 2, y: eyes[0].y + eyes[0].piece.height / 2 }, { x: eyes[1].x + eyes[1].piece.width / 2, y: eyes[1].y + eyes[1].piece.height / 2 }) : { x: hcx, y: head.y + hh * 0.45 };

  // 5) kit
  const images = {};
  const parts = [];
  const put = (name, p, extra) => {
    images[name] = { width: p.width, height: p.height, rgba: p.rgba };
    parts.push({ name, x: p.x, y: p.y, width: p.width, height: p.height, ...extra });
  };
  for (const [p, r] of roles) {
    report.pieces.push({ role: r, err: Math.round(p.err) });
    if (r === "hair_back") {
      const top = { x: p.x + p.width / 2, y: p.y + p.height * 0.12 };
      put("hair_back", p, { role: "chain", kind: "hair", layer: "hair_back", points: [top, { x: top.x, y: p.y + p.height * 0.55 }, { x: top.x, y: p.y + p.height * 0.97 }] });
    } else {
      const m = /^(.*)_(sx|dx)$/.exec(r);
      put(r, p, m ? { role: m[1], side: m[2] } : { role: r });
    }
  }
  for (const fp of faceParts) {
    put(`${fp.role}_${fp.side}`, { ...fp.piece, x: fp.x, y: fp.y }, { role: fp.role, side: fp.side });
    report.pieces.push({ role: `${fp.role}_${fp.side}`, err: Math.round(fp.err), scale: fp.scale });
  }
  if (mouth) {
    const variants = {};
    for (const [v, m] of Object.entries(mouth.variants)) {
      const name = `mouth_${v}`;
      images[name] = { width: m.piece.width, height: m.piece.height, rgba: m.piece.rgba };
      variants[v] = { name, x: m.x, y: m.y, width: m.piece.width, height: m.piece.height };
    }
    parts.push({ name: "mouth", role: "mouth", variants });
    report.pieces.push({ role: "mouth", err: Math.round(mouth.err) });
  }
  // bagliore della magia generato (additivo)
  for (const sd of ["sx", "dx"]) {
    const R = Math.round(0.22 * hw);
    const rgba = new Uint8ClampedArray(4 * R * R * 4);
    for (let y = 0; y < 2 * R; y++) for (let x = 0; x < 2 * R; x++) {
      const a = Math.max(0, 1 - Math.hypot(x - R + 0.5, y - R + 0.5) / R) ** 2, i = (y * 2 * R + x) * 4;
      rgba[i] = 255; rgba[i + 1] = 200 + 55 * a; rgba[i + 2] = 80 + 120 * a; rgba[i + 3] = 255 * a;
    }
    images[`glow_${sd}`] = { width: 2 * R, height: 2 * R, rgba };
    parts.push({ name: `glow_${sd}`, role: "fx", side: sd, x: 0, y: 0, width: 2 * R, height: 2 * R });
  }
  const kit = { name: opt.name || "personaggio", body: "bust", points: P, parts };
  return { kit, images, report, scale: s, work: f };
}
