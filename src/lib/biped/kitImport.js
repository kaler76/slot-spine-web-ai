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
import { transplantOriginal } from "../sheetAssembly.js";
import { underlayJoints } from "../jointUnderlay.js";

export const KIT_IMPORT_VERSION = "2026-10-31.kit.2";
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

/**
 * Sposta il contenuto di un riquadro della testa: pixel nuovo(x,y) = vecchio(x+dx, y+dy), con i bordi
 * sinistro/destro sfumati su 6 px (la pelle intorno non mostra scalini).
 */
function shiftPatch(p, box, dx, dy) {
  const W = p.width, H = p.height, src = p.rgba.slice();
  const x0 = Math.max(0, Math.floor(box.x0 - p.x)), x1 = Math.min(W - 1, Math.ceil(box.x1 - p.x));
  const y0 = Math.max(0, Math.floor(box.y0 - p.y)), y1 = Math.min(H - 1, Math.ceil(box.y1 - p.y));
  const F = 6;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const sx = x + dx, sy = y + dy;
      if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
      const w = Math.min(1, (x - x0) / F, (x1 - x) / F, (y - y0) / F, (y1 - y) / F);
      const i = (y * W + x) * 4, j = (sy * W + sx) * 4;
      for (let c = 0; c < 4; c++) p.rgba[i + c] = src[i + c] * (1 - w) + src[j + c] * w;
    }
}

/** Ritaglio ovale (bordi sfumati) di un riquadro di un pezzo. */
function cropOval(p, box) {
  const x0 = Math.max(0, Math.floor(box.x0 - p.x)), x1 = Math.min(p.width - 1, Math.ceil(box.x1 - p.x));
  const y0 = Math.max(0, Math.floor(box.y0 - p.y)), y1 = Math.min(p.height - 1, Math.ceil(box.y1 - p.y));
  const w = x1 - x0 + 1, h = y1 - y0 + 1, out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const d = Math.hypot((x - w / 2) / (w / 2), (y - h / 2) / (h / 2));
      const f = Math.max(0, Math.min(1, (1 - d) / 0.25));
      const i = ((y + y0) * p.width + x + x0) * 4, o = (y * w + x) * 4;
      out[o] = p.rgba[i]; out[o + 1] = p.rgba[i + 1]; out[o + 2] = p.rgba[i + 2]; out[o + 3] = p.rgba[i + 3] * f;
    }
  return { width: w, height: h, rgba: out };
}

/** Riempie un riquadro di un pezzo con la pelle intorno (diffusione dai bordi: niente righe). */
function fillSkin(p, box) {
  const x0 = Math.max(1, Math.floor(box.x0 - p.x)), x1 = Math.min(p.width - 2, Math.ceil(box.x1 - p.x));
  const y0 = Math.max(1, Math.floor(box.y0 - p.y)), y1 = Math.min(p.height - 2, Math.ceil(box.y1 - p.y));
  const W = p.width;
  const inOval = (x, y) => Math.hypot((x - (x0 + x1) / 2) / ((x1 - x0) / 2), (y - (y0 + y1) / 2) / ((y1 - y0) / 2)) < 1;
  // partenza: media della pelle sul bordo dell'ovale (le ciglia scure non devono restare come macchia)
  const acc = [0, 0, 0]; let n = 0;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      if (inOval(x, y) || !inOval(x + (x < (x0 + x1) / 2 ? 3 : -3), y)) continue;
      const i = (y * W + x) * 4;
      if (p.rgba[i + 3] < 200) continue;
      const lum = 0.3 * p.rgba[i] + 0.59 * p.rgba[i + 1] + 0.11 * p.rgba[i + 2];
      if (lum < 90) continue;
      for (let c = 0; c < 3; c++) acc[c] += p.rgba[i + c];
      n++;
    }
  if (n) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (inOval(x, y)) { const i = (y * W + x) * 4; for (let c = 0; c < 3; c++) p.rgba[i + c] = acc[c] / n; }
  for (let it = 0; it < 400; it++)
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        if (!inOval(x, y)) continue;
        const i = (y * W + x) * 4;
        for (let c = 0; c < 3; c++) p.rgba[i + c] = (p.rgba[i - 4 + c] + p.rgba[i + 4 + c] + p.rgba[i - W * 4 + c] + p.rgba[i + W * 4 + c]) / 4;
      }
}

/** Nucleo colorato (labbra, pelle) di un pezzo bocca con baffi/barba: riquadro dei pixel saturi. */
function coloredCore(p) {
  let n = 0, sy = 0, mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity;
  for (let y = 0; y < p.height; y++)
    for (let x = 0; x < p.width; x++) {
      const i = (y * p.width + x) * 4;
      if (p.rgba[i + 3] < 200) continue;
      const r = p.rgba[i], g = p.rgba[i + 1], b = p.rgba[i + 2];
      const sat = Math.max(r, g, b) - Math.min(r, g, b);
      // labbra e interno della bocca, non la pelle (la pelle rosata delle donne è satura anche lei):
      // il rosso che si stacca dalla media di verde e blu
      if (sat > 70 && r > g && r - (g + b) / 2 > 72) { n++; sy += y; mnx = Math.min(mnx, x); mxx = Math.max(mxx, x); mny = Math.min(mny, y); mxy = Math.max(mxy, y); }
    }
  return n < 15 ? null : { cy: sy / n, cx: (mnx + mxx) / 2, w: mxx - mnx, h: mxy - mny };
}

/**
 * Riquadro delle LABBRA (angolo-angolo della bocca) nel pezzo: tinta rosa/rossa (hue < 14° o > 335°,
 * saturazione > 0,3), non la pelle aranciata (hue ~20–35°) che coloredCore conta quando la pelle è
 * calda (Francese). Larghezza = distanza fra i due angoli della bocca (5°–95° percentile delle colonne).
 */
function lipBox(p) {
  const xs = [], ys = [];
  for (let y = 0; y < p.height; y++)
    for (let x = 0; x < p.width; x++) {
      const i = (y * p.width + x) * 4;
      if (p.rgba[i + 3] < 200) continue;
      const r = p.rgba[i] / 255, g = p.rgba[i + 1] / 255, b = p.rgba[i + 2] / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
      if (mx < 0.25 || d / mx < 0.3) continue;
      let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h = (h * 60 + 360) % 360;
      if (h < 14 || h > 335) { xs.push(x); ys.push(y); }
    }
  if (xs.length < 15) return null;
  const sx = [...xs].sort((a, b) => a - b), sy = [...ys].sort((a, b) => a - b);
  const q = (a, f) => a[Math.min(a.length - 1, Math.floor(f * a.length))];
  const x0 = q(sx, 0.02), x1 = q(sx, 0.98), y0 = q(sy, 0.03), y1 = q(sy, 0.97);
  return { cx: (x0 + x1) / 2, cy: ys.reduce((a, v) => a + v, 0) / ys.length, w: x1 - x0, h: y1 - y0, top: y0 };
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

/** Larghezza della sclera (bianco neutro, non pelle chiara) per righe: la riga più larga. */
function scleraWidth(p) {
  let best = 0;
  for (let y = 0; y < p.height; y++) {
    let mn = Infinity, mx = -Infinity, n = 0;
    for (let x = 0; x < p.width; x++) {
      const i = (y * p.width + x) * 4, r = p.rgba[i], g = p.rgba[i + 1], b = p.rgba[i + 2];
      if (p.rgba[i + 3] < 200 || Math.min(r, g, b) < 200 || Math.max(r, g, b) - Math.min(r, g, b) > 22) continue;
      n++; mn = Math.min(mn, x); mx = Math.max(mx, x);
    }
    if (n >= 3) best = Math.max(best, mx - mn);
  }
  return best || p.width * 0.6;
}

/**
 * @param {{reference, bodySheet, faceSheet}} imgs - immagini { width, height, rgba }
 * @param {{ work?: number }} opt - fattore di riduzione di lavoro (default 0.5)
 */
export function importBipedKit({ reference, bodySheet, faceSheet }, opt = {}) {
  const f = opt.work ?? 0.5;
  const ref = downscale(reference, f);
  const report = { version: KIT_IMPORT_VERSION, warnings: [], pieces: [] };

  if (opt.layout === "grid") return importGrid({ ref, bodySheet, faceSheet, f, report, opt });
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

  // PIXEL VISIBILI DALL'ORIGINALE (regola della tavola esplosa: la tavola serve solo per le zone
  // nascoste). Ogni pixel della posa va al pezzo più davanti che lo copre; braccia e busto prendono i
  // colori veri della posa (il Francese: maniche ridisegnate più strette, pantaloni assenti nella
  // tavola). La testa partecipa solo per non cedere il viso al busto: il suo pezzo resta quello della
  // tavola, perché il viso lo ricompone R7 più avanti. Ciò che nessun pezzo copre (es. pantaloni)
  // va al busto.
  if (opt.transplant !== false) {
    const ORDER = { hair_back: 0, torso: 1, upper_arm: 2, forearm: 3, hand: 4, head: 5 };
    const NAME = { hair_back: "capelli", torso: "busto", upper_arm: "braccio", forearm: "avambraccio", hand: "mano", head: "testa" };
    const list = [...roles].map(([pc, role]) => {
      const base = role.replace(/_(dx|sx)$/, "");
      pc.order = ORDER[base]; pc.name = NAME[base] + (role.match(/_(dx|sx)$/)?.[0] || "");
      return pc;
    });
    const tr = transplantOriginal(list, ref, { maxFill: Math.round(0.05 * ref.width) });
    const byOld = new Map(list.map((pc, i) => [pc, tr.pieces[i]]));
    let mergedRest = 0;
    for (const [pc, nw] of byOld) {
      if (pc === head) continue; // la testa resta quella della tavola (R7)
      Object.assign(pc, { x: nw.x, y: nw.y, width: nw.width, height: nw.height, rgba: nw.rgba });
    }
    // resti scoperti (pantaloni, oggetti non disegnati nella tavola) dentro il busto
    for (const r of tr.rest || []) {
      const x0 = Math.min(torso.x, r.x), y0 = Math.min(torso.y, r.y), x1 = Math.max(torso.x + torso.width, r.x + r.width), y1 = Math.max(torso.y + torso.height, r.y + r.height);
      const w = x1 - x0, h = y1 - y0, px = new Uint8ClampedArray(w * h * 4);
      for (const q of [torso, r]) for (let y = 0; y < q.height; y++) for (let x = 0; x < q.width; x++) {
        const si = (y * q.width + x) * 4; if (!q.rgba[si + 3]) continue;
        const di = ((q.y - y0 + y) * w + (q.x - x0 + x)) * 4; px.set(q.rgba.subarray(si, si + 4), di);
      }
      Object.assign(torso, { x: x0, y: y0, width: w, height: h, rgba: px });
      mergedRest += r.area || 0;
    }
    report.transplant = { holeShare: +tr.holeShare.toFixed(3), filledShare: +tr.filledShare.toFixed(3), restInTorso: mergedRest, iou: +tr.iou.toFixed(3) };
    // SOVRAPPOSIZIONE AI RACCORDI (jointUnderlay): dove braccio/avambraccio/mano coprono a riposo e
    // dietro non c'è nulla, il pezzo dietro si allunga sotto di loro: piegando non si aprono crepe
    const PARENT = { braccio: ["busto", "shoulder"], avambraccio: ["braccio", "elbow"], mano: ["avambraccio", "wrist"] };
    const ul = list.filter((pc) => pc !== head && pc !== hair).map((pc) => {
      const m = pc.name.match(/^(braccio|avambraccio|mano)_(dx|sx)$/);
      if (!m) return pc;
      const [par, joint] = PARENT[m[1]];
      return Object.assign(pc, { parent: par === "busto" ? "busto" : `${par}_${m[2]}`, pivot: P[`${joint}_${m[2]}`] });
    });
    const under = underlayJoints(ul, { reach: 0.25, maxPx: Math.round(0.06 * ref.width) });
    for (const nw of under.pieces) {
      const pc = ul.find((q) => q.name === nw.name);
      if (pc && nw !== pc) Object.assign(pc, { x: nw.x, y: nw.y, width: nw.width, height: nw.height, rgba: nw.rgba });
    }
    report.transplant.underlay = under.changes.map((c) => `${c.joint}→${c.into} +${c.added}`);
  }

  return faceAndKit({ ref, faceSheet, f, report, opt, s, torso, head, roles, P });
}

/**
 * Viso (tratti dalla posa, viso in mesh, palpebre, bocche) e kit finale: comune ai due formati di
 * tavola. roles: Map pezzo → ruolo (torso, head, hair_back, upper_arm_dx, ..., oppure cape,
 * hair_front_dx, arm_dx per la tavola a griglia); extra: proprietà aggiuntive per ruolo.
 */
function faceAndKit({ ref, faceSheet, f, report, opt, s, torso, head, roles, P, extra = {} }) {
  const hcx = head.x + head.width / 2;
  // 4) viso: tratti cercati sulla posa neutra, a più scale, nella zona del viso
  const face = pieces(downscale(faceSheet, f), 60 * f * f * 4);
  const rowY = (p) => p.sheetY + p.height / 2;
  const sorted = [...face].sort((a, b) => rowY(a) - rowY(b));
  const yCut = (rowY(sorted[0]) + rowY(sorted[sorted.length - 1])) / 2;
  const row1 = face.filter((p) => rowY(p) < yCut).sort((a, b) => a.sheetX - b.sheetX);
  const row2 = face.filter((p) => rowY(p) >= yCut).sort((a, b) => a.sheetX - b.sheetX);
  const faceParts = [];
  const lidParts = [];
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
  // maschera della differenza allargata di 3 px (comprende il contorno scuro dei tratti)
  const diffWide = new Uint8Array(diff.length);
  for (let y = 0; y < head.height; y++)
    for (let x = 0; x < head.width; x++) {
      if (!diff[y * head.width + x]) continue;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < head.width && yy < head.height) diffWide[yy * head.width + xx] = 1;
      }
    }
  /** Ritaglio dei pixel della POSA NEUTRA dove differiscono dalla testa, nel riquadro (coordinate posa). */
  const cutFromRef = (box) => {
    const x0 = Math.max(Math.floor(box.x0), head.x), y0 = Math.max(Math.floor(box.y0), head.y);
    const x1 = Math.min(Math.ceil(box.x1), head.x + head.width - 1), y1 = Math.min(Math.ceil(box.y1), head.y + head.height - 1);
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    if (w < 4 || h < 4) return null;
    const rgba = new Uint8ClampedArray(w * h * 4);
    let n = 0;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const lx = x + x0 - head.x, ly = y + y0 - head.y;
        if (!diffWide[ly * head.width + lx]) continue;
        // bordo morbido: quanti vicini (raggio 2) sono nella maschera
        let k = 0, t = 0;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { t++; const xx = lx + dx, yy = ly + dy; if (xx >= 0 && yy >= 0 && xx < head.width && yy < head.height && diffWide[yy * head.width + xx]) k++; }
        const gi = ((y + y0) * ref.width + x + x0) * 4, o = (y * w + x) * 4;
        rgba[o] = ref.rgba[gi]; rgba[o + 1] = ref.rgba[gi + 1]; rgba[o + 2] = ref.rgba[gi + 2]; rgba[o + 3] = Math.round(255 * Math.min(1, (k / t) * 1.6));
        n++;
      }
    return n < 30 ? null : { x: x0, y: y0, width: w, height: h, rgba };
  };
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
    // GEOMETRIA DEL VISO (regole fisse):
    //  R0 la tavola del viso è disegnata a UNA sola scala: si misura sui due occhi (che nella posa
    //     neutra sono ben visibili) e vale per sopracciglia e bocche;
    //  R1 gli occhi stanno dove sono nella posa neutra (ricerca a coppia), poi:
    //  R2 stessa altezza e simmetrici rispetto alla mediana del viso (punto medio fra gli occhi);
    //  R3 sopracciglia alla stessa altezza fra loro, sulla verticale del proprio occhio, sopra l'occhio;
    //  R4 bocca (con i suoi baffi) centrata sulla mediana, cercata SOTTO il naso alla scala R0.
    // testa RIDISEGNATA (tavola a griglia): la differenza è rumorosa ovunque e non indica gli occhi.
    // Ricerca geometrica: coppia simmetrica (stessa altezza, stessa scala) con distanza fra i centri
    // da 0,16 a 0,32 della larghezza della testa; larghezza del pezzo occhio da 1,1 a 1,7 volte la semidistanza.
    const geoPair = (pa, pb) => {
      let best = null;
      const hcx0 = head.x + head.width / 2;
      for (let half = 0.08 * hw; half <= 0.16 * hw; half += 2) for (const ratio of [1.1, 1.3, 1.5, 1.7]) {
        const k = (ratio * half) / (pa.width * s);
        const sa = scalePiece(pa, s * k), sb = scalePiece(pb, s * k);
        if (sa.width < 4 || sb.width < 4) continue;
        for (let m = hcx0 - 0.04 * hw; m <= hcx0 + 0.04 * hw; m += 3)
          for (let ey = head.y + 0.2 * hh; ey <= head.y + 0.55 * hh; ey += 3) {
            const ax = Math.round(m - half - sa.width / 2), bx = Math.round(m + half - sb.width / 2);
            const e = matchAt(sa, ref, ax, Math.round(ey - sa.height / 2), 3) + matchAt(sb, ref, bx, Math.round(ey - sb.height / 2), 3);
            if (!best || e < best.e) best = { e, k, a: { sp: sa, pos: { x: ax, y: Math.round(ey - sa.height / 2), err: e / 2 } }, b: { sp: sb, pos: { x: bx, y: Math.round(ey - sb.height / 2), err: e / 2 } } };
          }
      }
      return best;
    };
    const eyeFit = opt.eyeSearch === "geo" ? geoPair(row1[0], row1[1]) : findPair(row1[0], row1[1], tgt.eye_dx, tgt.eye_sx);
    const K = eyeFit.k;
    const ca = { x: eyeFit.a.pos.x + eyeFit.a.sp.width / 2, y: eyeFit.a.pos.y + eyeFit.a.sp.height / 2 };
    const cb = { x: eyeFit.b.pos.x + eyeFit.b.sp.width / 2, y: eyeFit.b.pos.y + eyeFit.b.sp.height / 2 };
    const mid = (ca.x + cb.x) / 2, eyeY = (ca.y + cb.y) / 2, half = Math.abs(cb.x - ca.x) / 2;
    report.face = { rule: "scala unica + simmetria", K: +K.toFixed(2), mid: Math.round(mid), eyeY: Math.round(eyeY), half: Math.round(half), eyeErr: Math.round(eyeFit.e / 2) };
    // R6 (regola approvata nel progetto: "il viso migliore viene dalla testa originale"): occhi e
    // sopracciglia si RITAGLIANO dalla posa neutra (stessi pixel, stesso punto), dove la posa differisce
    // dalla testa a occhi chiusi; i pezzi della tavola servono solo a trovarli e a stimarne la misura.
    for (const [sd, r, sign] of [["dx", eyeFit.a, -1], ["sx", eyeFit.b, +1]]) {
      const cx = r.pos.x + r.sp.width / 2, cy = r.pos.y + r.sp.height / 2;
      const cut = cutFromRef({ x0: cx - 0.75 * r.sp.width, x1: cx + 0.75 * r.sp.width, y0: cy - 0.75 * r.sp.height, y1: cy + 0.7 * r.sp.height });
      if (cut) faceParts.push({ role: "eye", side: sd, piece: cut, x: cut.x, y: cut.y, err: 0, scale: K, target: "ritaglio dalla posa" });
      else faceParts.push({ role: "eye", side: sd, piece: r.sp, x: Math.round(mid + sign * half - r.sp.width / 2), y: Math.round(eyeY - r.sp.height / 2), err: r.pos.err, scale: K, target: "posa+simmetria" });
    }
    // R1b le palpebre chiuse dipinte sulla testa: l'AI non le mette esattamente sotto gli occhi aperti,
    // e a riposo spunterebbero sotto l'occhio. Si STACCANO dalla testa come pezzi a sé (palpebra_dx/sx,
    // visibili solo nel battito, centrate sull'occhio) e sulla testa il loro posto si riempie di pelle.
    const lids = closedLids(head, { dx: { cx: mid - half, cy: eyeY + 0.2 * half, r: 0.4 * half }, sx: { cx: mid + half, cy: eyeY + 0.2 * half, r: 0.4 * half } });
    if (lids) {
      const eh = eyeFit.a.sp.height, ew = eyeFit.a.sp.width;
      report.face.lids = {};
      for (const [sd, sign] of [["dx", -1], ["sx", +1]]) {
        const L = lids[sd];
        const box = { x0: L.cx - 0.62 * ew, x1: L.cx + 0.62 * ew, y0: L.cy - 0.45 * eh, y1: L.cy + 0.4 * eh };
        const patch = cropOval(head, box);
        fillSkin(head, box);
        const cx = mid + sign * half, cy = eyeY + 0.12 * eh;
        lidParts.push({ side: sd, piece: patch, x: Math.round(cx - patch.width / 2), y: Math.round(cy - patch.height / 2) });
        report.face.lids[sd] = { dx: Math.round(L.cx - cx), dy: Math.round(L.cy - cy) };
      }
    }
    // sopracciglia alla scala R0: si cerca solo la quota, sopra ciascun occhio
    const browAt = (piece, cx) => {
      const sp = scalePiece(piece, s * K);
      let best = { err: Infinity };
      for (let cy = eyeY - 2.2 * half; cy <= eyeY - 0.25 * half; cy += 1) {
        const e = matchAt(sp, ref, Math.round(cx - sp.width / 2), Math.round(cy - sp.height / 2), 2);
        if (e < best.err) best = { err: e, cy };
      }
      return { sp, ...best };
    };
    const bA = browAt(row1[2], mid - half), bB = browAt(row1[3], mid + half);
    const browY = (bA.cy + bB.cy) / 2;
    for (const [sd, r, sign] of [["dx", bA, -1], ["sx", bB, +1]]) {
      const cx = mid + sign * half;
      const cut = cutFromRef({ x0: cx - 0.8 * r.sp.width, x1: cx + 0.8 * r.sp.width, y0: browY - 1.0 * r.sp.height, y1: Math.min(browY + 0.9 * r.sp.height, eyeY - 0.35 * half) });
      if (cut) faceParts.push({ role: "brow", side: sd, piece: cut, x: cut.x, y: cut.y, err: 0, scale: K, target: "ritaglio dalla posa" });
      else faceParts.push({ role: "brow", side: sd, piece: r.sp, x: Math.round(cx - r.sp.width / 2), y: Math.round(browY - r.sp.height / 2), err: r.err, scale: K, target: "scala unica+simmetria" });
    }
  } else report.warnings.push(`Tavola del viso: ${row1.length} pezzi nella prima riga invece di 4.`);
  let mouth = null, mouthCenterY = null;
  if (row2.length >= 5) {
    const K = report.face?.K ?? 1, mid = report.face?.mid ?? hcx, eyeY = report.face?.eyeY ?? head.y + 0.4 * hh, half = report.face?.half ?? 0.15 * hw;
    // la bocca della tavola porta con sé baffi e barba e non segue la scala R0. Si allinea la BOCCA
    // vera (labbra e pelle sotto i baffi): nella posa neutra è la zona accesa dalla differenza con la
    // testa (dove la testa ha la bocca tolta), nel pezzo sono i pixel colorati fra i peli bianchi.
    let zm = zone((mid - 1.3 * half - head.x) / head.width, (mid + 1.3 * half - head.x) / head.width, (eyeY + 1.1 * half - head.y) / head.height, (eyeY + 3.2 * half - head.y) / head.height);
    if (opt.eyeSearch === "geo") {
      // testa ridisegnata: bocca neutra della tavola cercata sulla mediana (scala e altezza), poi la
      // zona delle labbra = il suo nucleo colorato in quella posizione
      let bm = null;
      const c0 = coloredCore(row2[0]);
      for (let wl = 0.9 * half; wl <= 2.2 * half; wl += 2) {
        const k = c0 ? wl / c0.w : wl / row2[0].width;
        const sp = scalePiece(row2[0], k);
        if (sp.width < 6) continue;
        for (let y = eyeY + 1.2 * half; y <= eyeY + 3.4 * half; y += 2) {
          const e = matchAt(sp, ref, Math.round(mid - sp.width / 2), Math.round(y - sp.height / 2), 2);
          if (!bm || e < bm.e) bm = { e, k, y, sp };
        }
      }
      if (bm) {
        const c = coloredCore(bm.sp);
        if (c) zm = { cx: mid, cy: bm.y - bm.sp.height / 2 + c.cy, w: c.w, h: c.h, n: 100 };
      }
    }
    const pm = coloredCore(row2[0]);
    let MK, mouthTop;
    if (zm && pm) {
      mouthCenterY = zm.cy;
      MK = zm.w / pm.w / s;
      mouthTop = zm.cy - pm.cy * s * MK;
      report.face.mouth = { rule: "bocca su bocca", refW: Math.round(zm.w), k: +MK.toFixed(2) };
    } else {
      MK = K * 1.6; mouthTop = eyeY + 1.3 * half;
      report.warnings.push("Bocca della posa non trovata: posta sotto il naso con una scala stimata.");
    }
    // rifinitura della quota a scala fissa: i baffi del pezzo devono coprire quelli della posa
    const spN = scalePiece(row2[0], s * MK);
    let best = { err: Infinity, y: mouthTop };
    for (let y = mouthTop - 1.0 * half; y <= mouthTop + 0.5 * half; y += 1) {
      const e = matchAt(spN, ref, Math.round(mid - spN.width / 2), Math.round(y), 2);
      if (e < best.err) best = { err: e, y };
    }
    const variants = {};
    // REGOLA BOCCA (utente, 31 ott, sul Francese):
    //  R-B1 LARGHEZZA: la bocca è larga quanto la distanza fra il dentro dei due occhi (pupille):
    //       angoli della bocca sotto le pupille (coerente con la Regola 1 del viso). Una sola scala per
    //       tutte le bocche della tavola, presa dalle labbra della bocca neutra: le altre mantengono le
    //       proporzioni disegnate (la "O" resta più stretta, la risata più aperta).
    //  R-B2 POSIZIONE: il centro della bocca sta sulla verticale del centro del NASO, misurato sulla posa
    //       (asse di simmetria della zona del naso), non sul centro del pezzo.
    // (sostituisce il +12% fisso deciso a occhio su Zeus; opt.mouthScale lo rimette se serve)
    // pupille VERE sulla posa: centroide dei pixel più scuri (2,5%) in una finestra attorno a ogni occhio
    // (con la testa appena girata la metà fra gli occhi non è l'asse del naso, e mid ± half non cade
    // sulle pupille: Francese)
    const lumP = (i) => 0.3 * ref.rgba[i] + 0.59 * ref.rgba[i + 1] + 0.11 * ref.rgba[i + 2];
    const pupilAt = (cx0) => {
      const pts = [];
      for (let y = Math.round(eyeY - 0.45 * half); y <= Math.round(eyeY + 0.35 * half); y++)
        for (let x = Math.round(cx0 - 0.55 * half); x <= Math.round(cx0 + 0.55 * half); x++) {
          if (x < 0 || y < 0 || x >= ref.width || y >= ref.height) continue;
          const i = (y * ref.width + x) * 4, r = ref.rgba[i], g = ref.rgba[i + 1], b = ref.rgba[i + 2];
          // pupilla/iride: scura, non pelle; si escludono i capelli e le ciglia allungate (bordo finestra)
          pts.push({ x, y, l: lumP(i) + (b > r ? -20 : 0) });
        }
      pts.sort((a, b) => a.l - b.l);
      const k = Math.max(4, Math.round(pts.length * 0.025)), sel = pts.slice(0, k);
      return { x: sel.reduce((a, q) => a + q.x, 0) / k, y: sel.reduce((a, q) => a + q.y, 0) / k };
    };
    const pupL = pupilAt(mid - half), pupR = pupilAt(mid + half);
    const pupilGap = Math.abs(pupR.x - pupL.x) || 2 * half;
    const c0 = lipBox(row2[0]) || coloredCore(row2[0]);
    const kMouth = opt.mouthScale ? s * MK * opt.mouthScale : c0 ? (pupilGap * (opt.mouthWidth ?? 1)) / c0.w : s * MK * 1.12;
    // centro del naso: asse di simmetria orizzontale della fascia fra occhi e bocca (posa originale)
    const noseX = (() => {
      const y0 = Math.round(eyeY + 0.35 * half), y1 = Math.round(eyeY + 1.25 * half), r = Math.round(0.55 * half);
      let bx = mid, be = Infinity;
      for (let cx = Math.round(mid - 0.35 * half); cx <= Math.round(mid + 0.35 * half); cx++) {
        let e = 0, n = 0;
        for (let y = y0; y <= y1; y += 1)
          for (let d = 1; d <= r; d++) {
            const a = (y * ref.width + cx - d) * 4, b = (y * ref.width + cx + d) * 4;
            if (cx - d < 0 || cx + d >= ref.width) continue;
            e += Math.abs(ref.rgba[a] - ref.rgba[b]) + Math.abs(ref.rgba[a + 1] - ref.rgba[b + 1]) + Math.abs(ref.rgba[a + 2] - ref.rgba[b + 2]); n++;
          }
        if (n && e / n < be) { be = e / n; bx = cx; }
      }
      return bx;
    })();
    //  R-B3 ALTEZZA (utente, 31 ott): con i BAFFI le labbra stanno attaccate alla parte bassa dei baffi
    //       (il bordo alto del labbro tocca il loro bordo inferiore); SENZA baffi, nella vita reale la
    //       bocca è a circa 2,5 cm dalla base del naso: con la distanza fra le pupille ≈ 6,3 cm, la linea
    //       della bocca sta 0,40 · distanza pupille sotto la base del naso.
    const lum = (i) => 0.3 * ref.rgba[i] + 0.59 * ref.rgba[i + 1] + 0.11 * ref.rgba[i + 2];
    const band = Math.max(2, Math.round(0.35 * half));
    // pelle di riferimento: guance subito sotto gli occhi (sopra baffi e riccioli)
    const skin = (() => {
      const acc = [0, 0, 0]; let n = 0;
      for (const sx of [-1, 1]) for (let y = Math.round(eyeY + 0.25 * half); y <= Math.round(eyeY + 0.45 * half); y++)
        for (let x = Math.round(noseX + sx * 0.75 * half - 3); x <= Math.round(noseX + sx * 0.75 * half + 3); x++) {
          const i = (y * ref.width + x) * 4; acc[0] += ref.rgba[i]; acc[1] += ref.rgba[i + 1]; acc[2] += ref.rgba[i + 2]; n++;
        }
      return acc.map((v) => v / (n || 1));
    })();
    // pixel di baffi (scuri o bianchi, comunque lontani dalla pelle); le labbra rosse non contano
    const hairPx = (x, y) => {
      const i = (y * ref.width + x) * 4, r = ref.rgba[i], g = ref.rgba[i + 1], b = ref.rgba[i + 2];
      if (g > r + 40 && g > b + 40) return false;
      const lip = r > g + 45 && r > b + 35 && lum(i) > 70;
      return !lip && Math.abs(r - skin[0]) + Math.abs(g - skin[1]) + Math.abs(b - skin[2]) > 110;
    };
    const bx0 = Math.round(noseX - 0.5 * half), bx1 = Math.round(noseX + 0.5 * half);
    const rowHair = (y) => { let h = 0, n = 0; for (let x = bx0; x <= bx1; x += 2) { n++; if (hairPx(x, y)) h++; } return h / n; };
    // baffi: prima riga (scendendo dagli occhi) con almeno metà della fascia centrale "pelo"; finiscono
    // dove la fascia torna pelle/labbra per 3 righe. La loro cima è la base del naso.
    let moustacheTop = null, moustacheBottom = null;
    for (let y = Math.round(eyeY + 0.5 * half); y <= Math.round(eyeY + 2.2 * half); y++) if (rowHair(y) >= 0.5) { moustacheTop = y; break; }
    if (moustacheTop != null) {
      let miss = 0, y = moustacheTop;
      for (; y <= moustacheTop + 1.4 * half; y++) { if (rowHair(y) >= 0.5) { moustacheBottom = y; miss = 0; } else if (++miss >= 3) break; }
      if (moustacheBottom - moustacheTop < 0.12 * half) moustacheTop = moustacheBottom = null;
    }
    // base del naso: cima dei baffi, altrimenti la riga più scura (narici) sulla verticale del naso
    let noseBase = moustacheTop ?? eyeY + 1.2 * half;
    if (moustacheTop == null) {
      let darkest = Infinity;
      for (let y = Math.round(eyeY + 0.6 * half); y <= Math.round(eyeY + 2.0 * half); y++) {
        let L = 0, n = 0;
        for (let x = Math.round(noseX - 0.25 * half); x <= Math.round(noseX + 0.25 * half); x++) { L += lum((y * ref.width + x) * 4); n++; }
        if (n && L / n < darkest) { darkest = L / n; noseBase = y; }
      }
    }
    const mouthLineNoBeard = noseBase + 0.4 * pupilGap;
    report.face.mouthRule = { pupilL: Math.round(pupL.x), pupilR: Math.round(pupR.x), pupilGap: Math.round(pupilGap), noseX: Math.round(noseX), eyesMid: Math.round(mid), noseBase: Math.round(noseBase), moustacheBottom, mouthLine: moustacheBottom == null ? Math.round(mouthLineNoBeard) : null, scale: +kMouth.toFixed(3), prevScale: +(s * MK * 1.12).toFixed(3) };
    row2.slice(0, 5).forEach((p, i) => {
      // R-B1 per variante (regola 1 del viso): a riposo angoli sotto le pupille (1,00); risata 1,05;
      // sorriso largo oltre le pupille (1,15); triste un po' più stretta (0,95); la "O" resta come disegnata
      // rispetto alla neutra. Ogni bocca si misura sulle SUE labbra, così una tavola disegnata
      // incoerente (Zeus: risata più stretta della neutra) non cambia la regola.
      const TARGET = { neutral: 1, open: 1.05, smile: 1.15, sad: 0.95 };
      const lb0 = lipBox(p);
      const kV = !opt.mouthScale && lb0 && TARGET[MOUTHS[i]] ? (pupilGap * TARGET[MOUTHS[i]] * (opt.mouthWidth ?? 1)) / lb0.w : kMouth;
      const sp = scalePiece(p, kV);
      const lb = lipBox(sp), cc = coloredCore(sp);
      // centro e bordo alto dalle LABBRA (lipBox); l'ellisse sfumata più sotto usa il nucleo colorato
      const c = lb ? { ...cc, cx: lb.cx, cy: lb.top + lb.h / 2, w: lb.w, h: lb.h } : cc;
      (report.face.mouthRule.widths ||= {})[MOUTHS[i]] = c ? +(c.w / pupilGap).toFixed(2) : null;
      // centrata sulle LABBRA (R7b) e sulla verticale del naso (R-B2)
      const x = Math.round(noseX - (c ? c.cx : sp.width / 2));
      // R-B3: labbro alto attaccato ai baffi (2 px sotto il loro bordo, per non lasciare fessure), oppure
      // linea della bocca a 2,5 cm reali dalla base del naso; ripiego: labbra trovate nella posa
      const y = c
        ? moustacheBottom != null
          ? Math.round(moustacheBottom - 2 - (c.cy - c.h / 2))
          : opt.mouthFromRef && mouthCenterY != null ? Math.round(mouthCenterY - c.cy) : Math.round(mouthLineNoBeard - c.cy)
        : Math.round(best.y);
      // con il viso in mesh la bocca è sopra la barba ORIGINALE: si tiene solo l'interno della bocca
      // (ellisse sfumata attorno a labbra e denti), non i baffi e la barba disegnati nella tavola
      if (c && opt.faceMesh !== false) {
        const rx = c.w / 2 + 3, ry = Math.max(c.h / 2, c.w * 0.18) + 3;
        for (let yy = 0; yy < sp.height; yy++)
          for (let xx = 0; xx < sp.width; xx++) {
            const d = Math.hypot((xx - c.cx) / rx, (yy - c.cy) / ry);
            const k = d < 0.8 ? 1 : d > 1 ? 0 : (1 - d) / 0.2;
            sp.rgba[(yy * sp.width + xx) * 4 + 3] *= k;
          }
      }
      variants[MOUTHS[i]] = { piece: sp, x, y };
    });
    // R6 anche per la bocca a riposo: la neutra è ritagliata dalla posa (baffi e labbra originali);
    // le altre bocche della tavola restano allineate sulle labbra (si vedono solo nelle espressioni)
    const cutM = cutFromRef({ x0: mid - 1.5 * half, x1: mid + 1.5 * half, y0: eyeY + 0.95 * half, y1: eyeY + 3.0 * half });
    if (cutM) variants.neutral = { piece: cutM, x: cutM.x, y: cutM.y };
    mouth = { variants, err: best.err, scale: +MK.toFixed(2) };
  } else report.warnings.push(`Tavola del viso: ${row2.length} bocche invece di 5.`);
  const eyes = faceParts.filter((p) => p.role === "eye");
  P.face_center = eyes.length === 2 ? mid({ x: eyes[0].x + eyes[0].piece.width / 2, y: eyes[0].y + eyes[0].piece.height / 2 }, { x: eyes[1].x + eyes[1].piece.width / 2, y: eyes[1].y + eyes[1].piece.height / 2 }) : { x: hcx, y: head.y + hh * 0.45 };

  // 4b) VISO IN MESH (regola dei tutorial: "mai lasciare il viso senza manipolazione della mesh"):
  // occhi, sopracciglia e bocca a riposo, ritagliati dalla posa, si INCORPORANO nella testa, che
  // diventa una mesh unica; le espressioni sono deformazioni della mesh (poseAnimator). Restano pezzi a
  // sé solo le palpebre del battito e le bocche aperte (interno della bocca, con trasparenza).
  let faceGeo = null;
  if (opt.faceMesh !== false && faceParts.length === 4 && mouth?.variants.neutral) {
    const paste = (pc, x0, y0) => {
      for (let y = 0; y < pc.height; y++)
        for (let x = 0; x < pc.width; x++) {
          const a = pc.rgba[(y * pc.width + x) * 4 + 3] / 255;
          if (a <= 0) continue;
          const hx = x + x0 - head.x, hy = y + y0 - head.y;
          if (hx < 0 || hy < 0 || hx >= head.width || hy >= head.height) continue;
          const i = (hy * head.width + hx) * 4, o = (y * pc.width + x) * 4;
          for (let c = 0; c < 3; c++) head.rgba[i + c] = head.rgba[i + c] * (1 - a) + pc.rgba[o + c] * a;
          head.rgba[i + 3] = Math.max(head.rgba[i + 3], pc.rgba[o + 3]);
        }
    };
    const center = (fp) => ({ x: fp.x + fp.piece.width / 2, y: fp.y + fp.piece.height / 2 });
    for (const fp of faceParts) paste(fp.piece, fp.x, fp.y);
    const mn = mouth.variants.neutral;
    paste(mn.piece, mn.x, mn.y);
    // R7 la testa a riposo è l'ORIGINALE: barba, baffi e capelli della tavola sono ridisegnati (più
    // piccoli, spostati). Si prendono i pixel della posa per tutta la testa + barba: riempimento dai
    // pixel della testa sopra la bocca, poi giù solo su pixel "barba" (chiari, poco saturi) fermandosi
    // sui contorni scuri. La testa della tavola resta solo dove è nascosta (collo).
    {
      const eyeY0 = report.face.eyeY, half0 = report.face.half;
      const mY = mouthCenterY ?? eyeY0 + 2 * half0;
      const X0 = Math.max(0, Math.floor(head.x - 0.2 * hw)), X1 = Math.min(ref.width - 1, Math.ceil(head.x + 1.2 * hw));
      const Y0 = Math.max(0, head.y), Y1 = Math.min(ref.height - 1, Math.ceil(head.y + 1.45 * hh));
      const W2 = X1 - X0 + 1, H2 = Y1 - Y0 + 1;
      const px = (x, y) => (y * ref.width + x) * 4;
      const isBg = (i) => ref.rgba[i + 3] < 128 || (ref.rgba[i + 1] > ref.rgba[i] + 40 && ref.rgba[i + 1] > ref.rgba[i + 2] + 40);
      const kitA = (x, y) => { const hx = x - head.x, hy = y - head.y; return hx < 0 || hy < 0 || hx >= head.width || hy >= head.height ? 0 : head.rgba[(hy * head.width + hx) * 4 + 3]; };
      const beardLike = (i) => { const r = ref.rgba[i], g = ref.rgba[i + 1], b = ref.rgba[i + 2]; return Math.max(r, g, b) - Math.min(r, g, b) < 55 && (r + g + b) / 3 > 135; };
      const F = new Uint8Array(W2 * H2), q = [];
      for (let y = Y0; y <= (opt.headFlood === false ? Y1 : Math.min(Y1, mY)); y++)
        for (let x = X0; x <= X1; x++) if (kitA(x, y) > 128 && !isBg(px(x, y))) { F[(y - Y0) * W2 + x - X0] = 1; q.push(x, y); }
      while (q.length) {
        const y = q.pop(), x = q.pop();
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const xx = x + dx, yy = y + dy;
          if (xx < X0 || xx > X1 || yy < Y0 || yy > Y1) continue;
          const k = (yy - Y0) * W2 + xx - X0;
          if (F[k]) continue;
          const i = px(xx, yy);
          if (isBg(i)) continue;
          // con opt.headFlood=false (capelli lunghi in pezzi a parte) si resta nella sagoma della testa
          if ((yy <= mY || opt.headFlood === false) && kitA(xx, yy) > 128) { F[k] = 1; q.push(xx, yy); }
          else if (opt.headFlood !== false && yy > mY - half0 && beardLike(i)) { F[k] = 1; q.push(xx, yy); }
        }
      }
      // contorno scuro della barba (2 px)
      for (let it = 0; it < 2; it++) {
        const add = [];
        for (let y = 1; y < H2 - 1; y++)
          for (let x = 1; x < W2 - 1; x++) {
            const k = y * W2 + x;
            if (F[k] || !(F[k - 1] || F[k + 1] || F[k - W2] || F[k + W2])) continue;
            const i = px(x + X0, y + Y0);
            if (!isBg(i) && ref.rgba[i] + ref.rgba[i + 1] + ref.rgba[i + 2] < 300) add.push(k);
          }
        for (const k of add) F[k] = 1;
      }
      const rgba = new Uint8ClampedArray(W2 * H2 * 4);
      let nOrig = 0;
      for (let y = 0; y < H2; y++)
        for (let x = 0; x < W2; x++) {
          const o = (y * W2 + x) * 4, gx = x + X0, gy = y + Y0, i = px(gx, gy);
          if (F[y * W2 + x]) { rgba[o] = ref.rgba[i]; rgba[o + 1] = ref.rgba[i + 1]; rgba[o + 2] = ref.rgba[i + 2]; rgba[o + 3] = 255; nOrig++; continue; }
          const a = kitA(gx, gy);
          // la tavola solo dove la posa ha qualcosa davanti (collo nascosto), mai sul fondo
          if (a > 0 && !isBg(i)) { const hi = ((gy - head.y) * head.width + gx - head.x) * 4; rgba[o] = head.rgba[hi]; rgba[o + 1] = head.rgba[hi + 1]; rgba[o + 2] = head.rgba[hi + 2]; rgba[o + 3] = a; }
        }
      // ritaglio dello spazio vuoto
      let bx0 = W2, by0 = H2, bx1 = -1, by1 = -1;
      for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) if (rgba[(y * W2 + x) * 4 + 3]) { bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y); }
      const cw = bx1 - bx0 + 1, ch = by1 - by0 + 1, out = new Uint8ClampedArray(cw * ch * 4);
      for (let y = 0; y < ch; y++) out.set(rgba.subarray(((y + by0) * W2 + bx0) * 4, ((y + by0) * W2 + bx1 + 1) * 4), y * cw * 4);
      Object.assign(head, { x: X0 + bx0, y: Y0 + by0, width: cw, height: ch, rgba: out });
      report.face.headFromRef = { px: nOrig, box: [head.x, head.y, cw, ch] };
    }
    const eyesC = ["dx", "sx"].map((sd) => center(faceParts.find((f) => f.role === "eye" && f.side === sd)));
    const browsC = ["dx", "sx"].map((sd) => center(faceParts.find((f) => f.role === "brow" && f.side === sd)));
    const zm2 = report.face?.mouth;
    const mid2 = report.face?.mid ?? (eyesC[0].x + eyesC[1].x) / 2, half2 = report.face?.half ?? Math.abs(eyesC[1].x - eyesC[0].x) / 2;
    faceGeo = {
      eyes: eyesC, brows: browsC,
      // bocca: centro e larghezza delle labbra nella posa (dalla zona accesa dalla differenza)
      mouth: { x: mid2, y: mouthCenterY ?? report.face.eyeY + 1.9 * half2, w: zm2?.refW ?? 1.6 * half2 },
      u: 2 * half2
    };
    // REGOLA DEL VISO 2 (proporzioni): attaccatura→sopracciglia, sopracciglia→base del naso e base
    // del naso→mento sono tre terzi uguali (T); la bocca sta a 1/3 del terzo inferiore; gli occhi a
    // metà della testa (cima dei capelli = 1/6 sopra l'attaccatura). Da sopracciglia e bocca:
    // T = 0,75·(bocca − sopracciglia); naso = sopracciglia + T; mento = sopracciglia + 2T.
    {
      const browY = (browsC[0].y + browsC[1].y) / 2, mY = faceGeo.mouth.y, T = 0.75 * (mY - browY);
      const eyeY = (eyesC[0].y + eyesC[1].y) / 2, eyeExp = browY + 0.2 * T;
      faceGeo.nose = { x: faceGeo.mouth.x, y: browY + T };
      faceGeo.chin = { x: faceGeo.mouth.x, y: browY + 2 * T };
      faceGeo.hairline = browY - T;
      report.face.rule2 = { third: Math.round(T), eyeVsHalf: +((eyeY - eyeExp) / T).toFixed(2) };
      if (Math.abs(eyeY - eyeExp) > 0.25 * T) report.warnings.push(`Viso: occhi lontani dalla metà della testa (${Math.round(((eyeY - eyeExp) / T) * 100)}% di un terzo).`);
    }
    // REGOLA DEL VISO 3 (Loomis): cerchio del cranio dalla cima alla base del naso, sopracciglia sul
    // suo centro; in larghezza il viso fra gli angoli esterni degli occhi si divide in 3 parti uguali:
    // occhio, spazio fra gli occhi (= larghezza del naso), occhio. Sotto il naso: bocca a 1/3, mento a 3/3.
    {
      const eyeParts = faceParts.filter((fp) => fp.role === "eye").sort((a, b) => a.x - b.x);
      if (eyeParts.length === 2) {
        // larghezza vera dell'occhio = bianco da angolo ad angolo (il ritaglio ha un margine)
        const [l, r] = eyeParts, wL = scleraWidth(l.piece), wR = scleraWidth(r.piece);
        const dC = (r.x + r.piece.width / 2) - (l.x + l.piece.width / 2);
        const gap = dC - (wL + wR) / 2, span = dC + (wL + wR) / 2;
        faceGeo.noseWidth = Math.max(gap, 0.25 * span);
        report.face.rule3 = { eyeW: Math.round((wL + wR) / 2), gap: Math.round(gap), gapOverEye: +(gap / ((wL + wR) / 2)).toFixed(2) };
      }
    }
    // controllo REGOLA DEL VISO 1: angoli della bocca sulla verticale delle pupille, bocca sulla mediana
    {
      const mw = faceGeo.mouth.w, pd = Math.abs(eyesC[1].x - eyesC[0].x);
      const off = (faceGeo.mouth.x - (eyesC[0].x + eyesC[1].x) / 2) / pd;
      report.face.rule1 = { mouthOverPupils: +(mw / pd).toFixed(2), centerOffset: +off.toFixed(3) };
      if (Math.abs(off) > 0.05) report.warnings.push(`Viso: bocca fuori dalla mediana del ${Math.round(Math.abs(off) * 100)}% della distanza fra le pupille.`);
    }
    faceParts.length = 0;
    delete mouth.variants.neutral;
    report.face.mesh = true;
  }

  // 5) kit
  const images = {};
  const parts = [];
  const put = (name, p, extra) => {
    images[name] = { width: p.width, height: p.height, rgba: p.rgba };
    parts.push({ name, x: p.x, y: p.y, width: p.width, height: p.height, ...extra });
  };
  for (const [p, r] of roles) {
    report.pieces.push({ role: r, err: Math.round(p.err) });
    if (extra[r]?.role) put(r, p, extra[r]);
    else if (r === "hair_back") {
      const top = { x: p.x + p.width / 2, y: p.y + p.height * 0.12 };
      put("hair_back", p, { role: "chain", kind: "hair", layer: "hair_back", points: [top, { x: top.x, y: p.y + p.height * 0.55 }, { x: top.x, y: p.y + p.height * 0.97 }] });
    } else {
      const m = /^(.*)_(sx|dx)$/.exec(r);
      put(r, p, { ...(m ? { role: m[1], side: m[2] } : { role: r, ...(r === "head" && faceGeo ? { mesh: true } : {}) }), ...(extra[r] || {}) });
    }
  }
  for (const fp of faceParts) {
    put(`${fp.role}_${fp.side}`, { ...fp.piece, x: fp.x, y: fp.y }, { role: fp.role, side: fp.side });
    report.pieces.push({ role: `${fp.role}_${fp.side}`, err: Math.round(fp.err), scale: fp.scale });
  }
  for (const lp of lidParts) put(`lid_${lp.side}`, { ...lp.piece, x: lp.x, y: lp.y }, { role: "lid", side: lp.side });
  if (mouth) {
    const variants = {};
    for (const [v, m] of Object.entries(mouth.variants)) {
      const name = `mouth_${v}`;
      images[name] = { width: m.piece.width, height: m.piece.height, rgba: m.piece.rgba };
      variants[v] = { name, x: m.x, y: m.y, width: m.piece.width, height: m.piece.height };
    }
    parts.push({ name: "mouth", role: "mouth", variants, ...(faceGeo ? { overlay: true } : {}) });
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
  const kit = { name: opt.name || "personaggio", body: "bust", points: P, parts, ...(faceGeo ? { face: faceGeo } : {}) };
  return { kit, images, report, scale: s, work: f };
}

/**
 * TAVOLA A GRIGLIA (personaggi con mesh pesate, es. la maga): 10 pezzi in 3 righe
 *  riga 1: testa | capelli dietro | mantello
 *  riga 2: ciocca davanti dx | busto | ciocca davanti sx
 *  riga 3: braccio dx (spalla→polso con manica, mano compresa) | mano dx | mano sx | braccio sx
 * I pezzi NON sono vicini alla loro posizione: ognuno si cerca sulla posa in una finestra anatomica
 * attorno al busto. Le mani della riga 3 servono solo a trovare polso e punta delle dita (la mano è
 * già nel braccio, che diventa UNA mesh pesata su omero, avambraccio e mano: niente giunture).
 */
function importGrid({ ref, bodySheet, faceSheet, f, report, opt }) {
  const all = pieces(downscale(bodySheet, f), 400 * f * f * 4).sort((a, b) => b.area - a.area).slice(0, 10);
  if (all.length < 10) throw new Error(`Tavola a griglia: ${all.length} pezzi, ne servono 10.`);
  const cy = (p) => p.sheetY + p.height / 2, cx = (p) => p.sheetX + p.width / 2;
  // righe: i due salti più grandi fra i centri in verticale
  const byY = [...all].sort((a, b) => cy(a) - cy(b));
  const gaps = byY.slice(1).map((p, i) => ({ i: i + 1, g: cy(p) - cy(byY[i]) })).sort((a, b) => b.g - a.g).slice(0, 2).map((g) => g.i).sort((a, b) => a - b);
  const rows = [byY.slice(0, gaps[0]), byY.slice(gaps[0], gaps[1]), byY.slice(gaps[1])].map((r) => r.sort((a, b) => cx(a) - cx(b)));
  if (rows[0].length !== 3 || rows[1].length !== 3 || rows[2].length !== 4)
    throw new Error(`Tavola a griglia: righe da ${rows.map((r) => r.length).join("/")} pezzi invece di 3/3/4.`);
  const [[head, hair, cape], [lockDx, torso, lockSx], [armDx, handDx, handSx, armSx]] = rows;
  const W = ref.width;
  // nella griglia il generatore rimpicciolisce i pezzi per farli stare: scala cercata su un intervallo
  // ampio sul busto, poi rifinita pezzo per pezzo (±15%) nella sua finestra
  // scala: il busto da solo è ingannevole (un busto piccolo "sta" dentro il vestito). Si prova ogni
  // scala sul GRUPPO busto + testa + due braccia, ognuno nella sua finestra rispetto al busto, e vince
  // l'errore totale più basso (pesato sull'area): a scala sbagliata testa e braccia non tornano.
  const groupErr = (k, coarse) => {
    let tot = 0, wsum = 0;
    const tsp = scalePiece(torso, k);
    const tp = alignPiece(tsp, ref, 1, { coarse, nFew: 150 });
    const tx = tp.x, ty = tp.y, tw = tsp.width;
    const add = (pc, win) => {
      const sp = scalePiece(pc, k);
      const e = alignPiece(sp, ref, 1, { coarse, nFew: 150, window: win }).err;
      tot += e * pc.area; wsum += pc.area;
    };
    tot += tp.err * torso.area; wsum += torso.area;
    add(head, { cx: tx + tw / 2, cy: ty - head.height * k * 0.3, r: 0.12 * W });
    add(armDx, { cx: tx + 0.05 * tw, cy: ty + armDx.height * k * 0.5, r: 0.18 * W });
    add(armSx, { cx: tx + 0.95 * tw, cy: ty + armSx.height * k * 0.5, r: 0.18 * W });
    return tot / wsum;
  };
  let best = { k: 1, e: Infinity };
  for (let k = 0.8; k <= 2.4; k += 0.1) { const e = groupErr(k, 10); if (e < best.e) best = { k, e }; }
  for (const k of [best.k - 0.06, best.k - 0.03, best.k + 0.03, best.k + 0.06]) { const e = groupErr(k, 6); if (e < best.e) best = { k, e }; }
  const s = +best.k.toFixed(3);
  report.gridScale = { s, err: Math.round(best.e) };
  const place = (p, win, coarse = 4, ks = [0.88, 0.94, 1, 1.06, 1.12]) => {
    let best = null;
    for (const k of win ? ks : [1]) {
      const sp = scalePiece(p, s * k);
      const pos = alignPiece(sp, ref, 1, { coarse, nFew: 300, ...(win ? { window: win } : {}) });
      if (!best || pos.err < best.pos.err) best = { sp, pos, k };
    }
    Object.assign(p, best.sp, { x: best.pos.x, y: best.pos.y, err: best.pos.err, scaleK: best.k });
    return p;
  };
  place(torso, null, 6);
  const T = { x: torso.x, y: torso.y, w: torso.width, h: torso.height, cx: torso.x + torso.width / 2 };
  place(head, { cx: T.cx, cy: T.y - head.height * s * 0.3, r: 0.12 * W });
  const H = { cx: head.x + head.width / 2, y: head.y, h: head.height };
  // capelli dietro e mantello sono in gran parte nascosti e il generatore li disegna spesso più
  // piccoli: scala cercata su un intervallo più ampio
  // Si piazzano sul RIQUADRO DEL LORO COLORE nella posa (mantello: viola; capelli: lilla/chiari poco
  // saturi), centrati sul busto: il confronto pixel per pixel su pezzi quasi nascosti non è affidabile.
  const colorBox = (test) => {
    let x0 = Infinity, x1 = -1, y0 = Infinity, y1 = -1, n = 0;
    for (let y = 0; y < ref.height; y++)
      for (let x = 0; x < ref.width; x++) {
        const i = (y * ref.width + x) * 4;
        if (ref.rgba[i + 3] < 128 || !test(ref.rgba[i], ref.rgba[i + 1], ref.rgba[i + 2])) continue;
        n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    return n > 200 ? { x0, x1, y0, y1 } : null;
  };
  // tinta dominante del pezzo della tavola, per riconoscere il suo colore nella posa
  const hueOf = (p) => {
    const hist = new Float64Array(36);
    for (let i = 0; i < p.width * p.height; i += 5) {
      if (p.rgba[i * 4 + 3] < 200) continue;
      const r = p.rgba[i * 4], g = p.rgba[i * 4 + 1], b = p.rgba[i * 4 + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx - mn < 20) continue;
      let h = mx === r ? (g - b) / (mx - mn) : mx === g ? 2 + (b - r) / (mx - mn) : 4 + (r - g) / (mx - mn);
      h = ((h * 60) + 360) % 360;
      hist[Math.floor(h / 10)] += 1;
    }
    let bi = 0; hist.forEach((v, i) => { if (v > hist[bi]) bi = i; });
    return bi * 10 + 5;
  };
  const hueTest = (hc, tol, minSat, minV = 0, maxSat = 255) => (r, g, b) => {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx - mn < minSat || mx - mn > maxSat || mx < minV) return false;
    let h = mx === r ? (g - b) / (mx - mn) : mx === g ? 2 + (b - r) / (mx - mn) : 4 + (r - g) / (mx - mn);
    h = ((h * 60) + 360) % 360;
    const d = Math.abs(h - hc);
    return Math.min(d, 360 - d) <= tol;
  };
  const fitBox = (p, box, { top = 0 } = {}) => {
    const k = (box.x1 - box.x0 + 1) / p.width;
    const sp = scalePiece(p, k);
    Object.assign(p, sp, { x: Math.round((box.x0 + box.x1) / 2 - sp.width / 2), y: Math.round(box.y0 - top * sp.height), err: 0, fitBox: true });
  };
  const capeHue = hueOf(cape), hairHue = hueOf(hair);
  const capeBox = colorBox(hueTest(capeHue, 18, 60));
  const hairBox = colorBox(hueTest(hairHue, 25, 12, 150, 90));
  report.colorFit = { capeHue, hairHue, capeBox, hairBox };
  const wide = [0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6];
  if (hairBox) fitBox(hair, hairBox); else place(hair, { cx: H.cx, cy: H.y + hair.height * s * 0.55, r: 0.12 * W }, 4, wide);
  if (capeBox) fitBox(cape, capeBox); else place(cape, { cx: T.cx, cy: T.y + cape.height * s * 0.5, r: 0.14 * W }, 4, wide);
  // il mantello sta dietro a tutto e si vede solo ai lati: il generatore lo disegna più piccolo. Lo si
  // adatta (scala diversa in x e y) al riquadro dei pixel viola della posa, così copre anche le zone
  // che si scoprono quando le braccia si alzano
  {
    // righe con almeno 1% di pixel viola (le ombre viola sparse nei capelli non contano)
    let x0 = ref.width, y0 = ref.height, x1 = -1, y1 = -1;
    const rowsC = [];
    let lastC = -1;
    const thin = [];
    for (let y = 0; y < ref.height; y++) {
      let n = 0, a = ref.width, b = -1;
      for (let x = 0; x < ref.width; x++) {
        const i = (y * ref.width + x) * 4;
        if (ref.rgba[i + 3] < 128 || colorClass(ref.rgba[i], ref.rgba[i + 1], ref.rgba[i + 2]) !== "C") continue;
        n++; if (x < a) a = x; if (x > b) b = x;
      }
      rowsC.push(n >= ref.width * 0.04 ? [a, b] : null);
      if (n >= ref.width * 0.01) { lastC = y; thin.push([y, a, b]); }
    }
    // la fascia continua più lunga di righe viola
    let run = null;
    for (let y = 0, st = -1; y <= rowsC.length; y++) {
      // buchi fino a 12 righe (stelle e fermagli) non spezzano la fascia
      if (y < rowsC.length && (rowsC[y] || (st >= 0 && rowsC.slice(y, y + 12).some(Boolean)))) { if (st < 0) st = y; continue; }
      if (st >= 0 && (!run || y - st > run[1] - run[0])) run = [st, y - 1];
      st = -1;
    }
    if (run) for (let y = run[0]; y <= run[1]; y++) { if (!rowsC[y]) continue; const [a, b] = rowsC[y]; if (a < x0) x0 = a; if (b > x1) x1 = b; y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    // il fondo del mantello: spesso coperto in parte dalle maniche, conta anche una fascia sottile
    if (run) {
      y1 = Math.max(y1, lastC);
      for (const [y, a, b] of thin) if (y > run[1]) { x0 = Math.min(x0, a); x1 = Math.max(x1, b); }
    }
    if (x1 > x0 && y1 > y0 && (x1 - x0) * (y1 - y0) > cape.width * cape.height * 0.5) {
      Object.assign(cape, resizePiece(cape, x1 - x0 + 1, y1 - y0 + 1), { x: x0, y: y0 });
      report.capeFit = [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
    }
  }
  place(lockDx, { cx: T.x + 0.2 * T.w, cy: T.y + lockDx.height * s * 0.4, r: 0.15 * W });
  place(lockSx, { cx: T.x + 0.8 * T.w, cy: T.y + lockSx.height * s * 0.4, r: 0.15 * W });
  place(armDx, { cx: T.x + 0.05 * T.w, cy: T.y + armDx.height * s * 0.5, r: 0.18 * W });
  place(armSx, { cx: T.x + 0.95 * T.w, cy: T.y + armSx.height * s * 0.5, r: 0.18 * W });
  // mani: in fondo al proprio braccio
  place(handDx, { cx: armDx.x + armDx.width * 0.35, cy: armDx.y + armDx.height * 0.85, r: 0.08 * W }, 3);
  place(handSx, { cx: armSx.x + armSx.width * 0.65, cy: armSx.y + armSx.height * 0.85, r: 0.08 * W }, 3);

  // PIXEL VISIBILI DALL'ORIGINALE con PROPRIETÀ PER COLORE. La tavola è ridisegnata: le sagome dei
  // pezzi ricollocati non coincidono con la posa, e il solo "pezzo più davanti" mette stelle del
  // mantello nelle maniche o ciocche nel busto. Ogni pixel della posa va al pezzo più davanti che lo
  // copre E che accetta il suo colore (mantello: viola; capelli: lilla/chiari; busto e braccia: blu,
  // pelle; testa: tutto; neutri come argento e contorni: chiunque), altrimenti al pezzo compatibile
  // più vicino. Nel pezzo: pixel della posa dove è suo, disegno della tavola dove è nascosto.
  // spalle: dalla calotta disegnata nella TAVOLA (prima di prendere i pixel della posa, dove la spalla
  // è coperta da capelli e mantello: dopo, la cima del braccio sarebbe la manica sotto i capelli e il
  // braccio girerebbe "segato" all'altezza del deltoide)
  // SPALLA VERA = angolo alto del busto (le spalle a sbuffo disegnate nella tavola, sotto il fermaglio
  // del mantello: indicate dall'utente). Il braccio della tavola spesso è posato più in basso: lo si
  // allunga verso l'alto fino a quell'angolo, così la parte alta del braccio (dalla spalla all'ascella)
  // è del BRACCIO e non resta attaccata al busto quando il braccio si alza.
  const shoulderAt = {};
  for (const [sd, arm] of [["dx", armDx], ["sx", armSx]]) {
    const yy = Math.round(torso.height * 0.07);
    let ex = sd === "dx" ? torso.width : -1;
    for (let y = Math.max(0, yy - 3); y <= yy + 3; y++)
      for (let x = 0; x < torso.width; x++) {
        if (torso.rgba[(y * torso.width + x) * 4 + 3] < 128) continue;
        if (sd === "dx") ex = Math.min(ex, x); else ex = Math.max(ex, x);
      }
    const inward = (sd === "dx" ? 1 : -1) * 0.22 * arm.width;
    const corner = { x: torso.x + ex + inward, y: torso.y + yy };
    const cap = capCenter(arm, 0.08);
    const dy = cap.y - corner.y;
    if (dy > 4) {
      // allungamento verticale della sola parte alta: si ricampiona il pezzo con un riquadro più alto
      const bottom = arm.y + arm.height, top = arm.y - dy;
      const shiftX = corner.x - cap.x;
      const res = resizePiece(arm, arm.width, Math.round(bottom - top));
      Object.assign(arm, res, { y: Math.round(top), x: Math.round(arm.x + shiftX * 0.6) });
    }
    shoulderAt[sd] = corner;
  }
  report.shoulders = shoulderAt;
  const sheetArm = { dx: { ...armDx }, sx: { ...armSx } };
  const layered = [cape, hair, torso, armDx, armSx, head, lockDx, lockSx];
  const accepts = new Map([[cape, "CN"], [hair, "HN"], [lockDx, "HN"], [lockSx, "HN"], [torso, "BKN"], [armDx, "BKN"], [armSx, "BKN"], [head, "HCBKN"]]);
  // la testa possiede solo i pixel dentro la propria sagoma (niente "più vicino"): il petto sotto il
  // mento va al busto, non alla testa
  const own = ownByColor(layered, ref, accepts, { grow: 6, reach: 60, strict: new Set([head]), prefer: { 1: { pieces: [lockDx, lockSx], reach: 1e9, over: [torso, armDx, armSx] } } });
  // (capelli chiari che stanno SOPRA busto e braccia = ciocche davanti; quelli ai lati = capelli dietro)
  layered.forEach((p, k) => { if (p !== head) Object.assign(p, cleanSpecks(own.pieces[k])); });
  report.ownership = own.stats;

  // articolazioni
  const P = {};
  const sleeves = {};

  for (const [sd, arm, hand] of [["dx", armDx, handDx], ["sx", armSx, handSx]]) {
    const ax = limbAxis(hand);
    const [wr, ft] = ax.tipA.y <= ax.tipB.y ? [ax.a, ax.tipB] : [ax.b, ax.tipA];
    const sh = shoulderAt[sd] || capCenter(sheetArm[sd], 0.08);
    P[`shoulder_${sd}`] = sh;
    P[`wrist_${sd}`] = wr;
    P[`fingertip_${sd}`] = ft;
    // gomito: poco sotto metà fra spalla e polso (avambraccio un po' più lungo dell'omero nel busto)
    P[`elbow_${sd}`] = { x: sh.x + 0.47 * (wr.x - sh.x), y: sh.y + 0.47 * (wr.y - sh.y) };
    // MANICA a campana: dall'esterno del gomito all'angolo dell'orlo più basso e più esterno, lontano
    // dalla mano (la stoffa che pende)
    {
      const el = P[`elbow_${sd}`], out = sd === "dx" ? -1 : 1; // dx = a sinistra per chi guarda
      const handR = Math.max(8, ax.halfWidth * 1.3);
      let best = null;
      for (let y = 0; y < arm.height; y += 2) for (let x = 0; x < arm.width; x += 2) {
        if (arm.rgba[(y * arm.width + x) * 4 + 3] < 200) continue;
        const gx = arm.x + x, gy = arm.y + y;
        if (gy < el.y) continue;
        // lontano dal segmento polso → punta delle dita
        const vx = ft.x - wr.x, vy = ft.y - wr.y, l2 = vx * vx + vy * vy || 1;
        const f = Math.max(0, Math.min(1, ((gx - wr.x) * vx + (gy - wr.y) * vy) / l2));
        if (Math.hypot(gx - (wr.x + f * vx), gy - (wr.y + f * vy)) < handR) continue;
        const score = (gy - el.y) + 0.8 * out * (gx - el.x);
        if (!best || score > best.score) best = { score, x: gx, y: gy };
      }
      if (best && opt.sleeves) {
        const start = { x: el.x + out * 0.25 * ax.halfWidth * 2, y: el.y + 4 };
        sleeves[sd] = { points: [start, { x: (start.x + best.x) / 2, y: (start.y + best.y) / 2 }, { x: best.x, y: best.y }], armHalf: Math.max(6, ax.halfWidth * 1.1) };
      }
    }
    report.pieces.push({ side: sd, armLen: Math.round(dist(sh, wr)), handErr: Math.round(hand.err), sleeve: !!sleeves[sd] });
  }
  const colTop = (p, x) => { const lx = Math.round(x - p.x); for (let y = 0; y < p.height; y++) if (p.rgba[(y * p.width + lx) * 4 + 3] > 200) return p.y + y; return p.y; };
  P.neck = { x: H.cx, y: colTop(torso, H.cx) };
  P.crown = { x: H.cx, y: colTop(head, H.cx) };
  P.waist = { x: T.cx, y: T.y + T.h * 0.92 };

  const roles = new Map([[cape, "cape"], [hair, "hair_back"], [torso, "torso"], [armDx, "arm_dx"], [armSx, "arm_sx"], [head, "head"], [lockDx, "hair_front_dx"], [lockSx, "hair_front_sx"]]);
  const vline = (p, a = 0.06, b = 0.97) => [{ x: p.x + p.width / 2, y: p.y + p.height * a }, { x: p.x + p.width / 2, y: p.y + p.height * (a + b) / 2 }, { x: p.x + p.width / 2, y: p.y + p.height * b }];
  const lockPts = (p) => {
    // dalla radice (alto) alla punta (basso), seguendo il centro dei pixel per fasce
    const pts = [];
    for (const fr of [0.04, 0.35, 0.65, 0.96]) {
      const y = Math.round(p.height * fr);
      let n = 0, sx = 0;
      for (let x = 0; x < p.width; x++) if (p.rgba[(y * p.width + x) * 4 + 3] > 200) { n++; sx += x; }
      pts.push({ x: p.x + (n ? sx / n : p.width / 2), y: p.y + y });
    }
    return pts;
  };
  const extra = {
    cape: { role: "chain", kind: "cape", z: -1, parent: "torace", points: vline(cape, 0.05, 0.97) },
    hair_back: { role: "chain", kind: "hair", layer: "hair_back", points: vline(hair, 0.12, 0.97) },
    hair_front_dx: { role: "chain", kind: "hair", parent: "testa", z: 44, bones: 3, maxDeg: 14, points: lockPts(lockDx) },
    hair_front_sx: { role: "chain", kind: "hair", parent: "testa", z: 44, bones: 3, maxDeg: 14, points: lockPts(lockSx) },
    torso: { skin: ["bacino", "torace", "testa"] },
    arm_dx: { role: "upper_arm", side: "dx", covers: ["upper_arm", "forearm", "hand"], skin: ["torace", "omero_dx", "avambraccio_dx", "mano_dx"], chainSkin: { bones: ["omero_dx", "avambraccio_dx", "mano_dx"], root: "torace" }, grid: { cols: 9, rows: 13 }, ...(sleeves.dx ? { sleeve: sleeves.dx } : {}) },
    arm_sx: { role: "upper_arm", side: "sx", covers: ["upper_arm", "forearm", "hand"], skin: ["torace", "omero_sx", "avambraccio_sx", "mano_sx"], chainSkin: { bones: ["omero_sx", "avambraccio_sx", "mano_sx"], root: "torace" }, grid: { cols: 9, rows: 13 }, ...(sleeves.sx ? { sleeve: sleeves.sx } : {}) }
  };
  report.layout = "grid";
  return faceAndKit({ ref, faceSheet, f, report, opt: { headFlood: false, eyeSearch: "geo", ...opt }, s, torso, head, roles, P, extra });
}

/**
 * PROPRIETÀ DEI PIXEL per tavole ridisegnate (forme un po' diverse dalla posa). Ogni pixel del
 * personaggio nella posa va a uno dei pezzi la cui sagoma (allargata di D px) lo copre: quello con la
 * TAVOLOZZA più vicina al colore del pixel (mantello viola, capelli lilla, vestito blu...), a parità
 * il più davanti. Poi ogni pezzo: pixel suoi = colore della posa; pixel della sua sagoma che nella
 * posa appartengono a un pezzo DAVANTI = disegno della tavola (parte nascosta); pixel che nella posa
 * sono fondo o appartengono a un pezzo DIETRO = trasparenti. A riposo coincide con la posa.
 * pieces: dal fondo al davanti; keep: pezzi di cui si calcola la proprietà ma non si cambia l'immagine.
 */
function ownByPalette(pieces, ref, { D = 10, keep = new Set(), maxPal = 80, maxIsland = 0.004 * ref.width * ref.height } = {}) {
  const W = ref.width, Hh = ref.height, N = W * Hh;
  const isBg = (g) => ref.rgba[g * 4 + 3] < 128 || (ref.rgba[g * 4 + 1] > ref.rgba[g * 4] + 40 && ref.rgba[g * 4 + 1] > ref.rgba[g * 4 + 2] + 40);
  // tavolozze: 6 colori per pezzo (k-means su un campione)
  const palettes = pieces.map((p) => {
    const smp = [];
    for (let i = 0; i < p.width * p.height; i += 7) if (p.rgba[i * 4 + 3] > 200) smp.push([p.rgba[i * 4], p.rgba[i * 4 + 1], p.rgba[i * 4 + 2]]);
    let c = Array.from({ length: 6 }, (_, k) => smp[Math.floor(((k + 0.5) * smp.length) / 6)] || [0, 0, 0]);
    for (let it = 0; it < 8; it++) {
      const acc = c.map(() => [0, 0, 0, 0]);
      for (const v of smp) {
        let bi = 0, bd = Infinity;
        c.forEach((q, k) => { const d = (v[0] - q[0]) ** 2 + (v[1] - q[1]) ** 2 + (v[2] - q[2]) ** 2; if (d < bd) { bd = d; bi = k; } });
        acc[bi][0] += v[0]; acc[bi][1] += v[1]; acc[bi][2] += v[2]; acc[bi][3]++;
      }
      c = c.map((q, k) => (acc[k][3] ? [acc[k][0] / acc[k][3], acc[k][1] / acc[k][3], acc[k][2] / acc[k][3]] : q));
    }
    return c;
  });
  const palDist = (k, g) => {
    let bd = Infinity;
    for (const q of palettes[k]) bd = Math.min(bd, Math.abs(ref.rgba[g * 4] - q[0]) + Math.abs(ref.rgba[g * 4 + 1] - q[1]) + Math.abs(ref.rgba[g * 4 + 2] - q[2]));
    return bd;
  };
  // sagome nella posa, e sagome allargate (distanza dal pezzo ≤ D)
  const inMask = pieces.map((p) => (g) => {
    const x = (g % W) - p.x, y = ((g / W) | 0) - p.y;
    return x >= 0 && y >= 0 && x < p.width && y < p.height && p.rgba[(y * p.width + x) * 4 + 3] > 128;
  });
  const near = pieces.map((p, k) => {
    const Dk = typeof D === "function" ? D(p, k) : D;
    const m = new Uint8Array(N);
    const q = [];
    for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) {
      if (p.rgba[(y * p.width + x) * 4 + 3] <= 128) continue;
      const gx = p.x + x, gy = p.y + y;
      if (gx < 0 || gy < 0 || gx >= W || gy >= Hh) continue;
      const g = gy * W + gx;
      if (!m[g]) { m[g] = 1; q.push(g); }
    }
    for (let d = 1; d <= Dk; d++) {
      const nq = [];
      for (const g of q) {
        const x = g % W;
        for (const h of [g - 1, g + 1, g - W, g + W]) {
          if (h < 0 || h >= N || m[h] || Math.abs((h % W) - x) > 1) continue;
          m[h] = d + 1; nq.push(h);
        }
      }
      q.length = 0; q.push(...nq);
    }
    return m;
  });
  const nearMax = pieces.map((p, k) => (typeof D === "function" ? D(p, k) : D) + 1);
  const owner = new Int16Array(N).fill(-1);
  let holes = 0, fgN = 0;
  for (let g = 0; g < N; g++) {
    if (isBg(g)) continue;
    fgN++;
    let best = -1, bs = Infinity;
    for (let k = 0; k < pieces.length; k++) {
      if (!near[k][g]) continue;
      // tavolozza + piccola penalità se il pixel è fuori dalla sagoma vera + piccolo vantaggio a chi sta davanti
      const sc = palDist(k, g) + (near[k][g] > 1 ? (30 * near[k][g]) / nearMax[k] : 0) - k * 2;
      if (sc < bs) { bs = sc; best = k; }
    }
    // colore lontano da tutte le tavolozze vicine: lo decide la propagazione (es. mantello viola dietro
    // la manica, quando il mantello della tavola è più piccolo e non arriva fin lì)
    if (best >= 0 && palDist(best, g) > maxPal) best = -1;
    if (best < 0) holes++;
    owner[g] = best;
  }
  // pixel non coperti da nessuna sagoma allargata: propagazione dai vicini già assegnati (il pezzo
  // si estende fin dove arriva nella posa, es. mantello e capelli disegnati più piccoli nella tavola)
  {
    let q = [];
    for (let g = 0; g < N; g++) if (owner[g] >= 0) q.push(g);
    while (q.length) {
      const nq = [];
      // a ogni giro: ogni pixel libero accanto a pixel assegnati prende, fra i proprietari vicini,
      // quello con la tavolozza più simile
      const cand = new Map();
      for (const g of q) {
        const x = g % W;
        for (const h of [g - 1, g + 1, g - W, g + W]) {
          if (h < 0 || h >= N || owner[h] >= 0 || Math.abs((h % W) - x) > 1 || isBg(h)) continue;
          const k = owner[g], d = palDist(k, h);
          const c = cand.get(h);
          if (!c || d < c.d) cand.set(h, { k, d });
        }
      }
      for (const [h, c] of cand) { owner[h] = c.k; nq.push(h); }
      q = nq;
    }
  }
  pieces.forEach((p, k) => {
    if (keep.has(p)) return;
    // nuovo riquadro: sagoma allargata + pixel propri
    let x0 = W, y0 = Hh, x1 = -1, y1 = -1;
    for (let g = 0; g < N; g++) if (near[k][g] || owner[g] === k) { const x = g % W, y = (g / W) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) return;
    const w = x1 - x0 + 1, h = y1 - y0 + 1, out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const g = (y + y0) * W + x + x0, o = (y * w + x) * 4;
        if (owner[g] === k) { out[o] = ref.rgba[g * 4]; out[o + 1] = ref.rgba[g * 4 + 1]; out[o + 2] = ref.rgba[g * 4 + 2]; out[o + 3] = 255; continue; }
        if (!inMask[k](g)) continue;
        if (isBg(g) || owner[g] < k) continue; // fondo o pezzo dietro: qui il pezzo non c'è
        // nascosto da un pezzo davanti: resta il disegno della tavola
        const lx = x + x0 - p.x, ly = y + y0 - p.y, li = (ly * p.width + lx) * 4;
        out[o] = p.rgba[li]; out[o + 1] = p.rgba[li + 1]; out[o + 2] = p.rgba[li + 2]; out[o + 3] = p.rgba[li + 3];
      }
    Object.assign(p, { x: x0, y: y0, width: w, height: h, rgba: out });
  });
  // isole: componenti piccole di un proprietario chiuse dentro un altro (decori argentati del vestito
  // presi per capelli, stelle del mantello prese per altro...) passano a chi le circonda
  {
    const seen = new Uint8Array(N);
    for (let g0 = 0; g0 < N; g0++) {
      if (seen[g0] || owner[g0] < 0) continue;
      const k = owner[g0], comp = [g0], border = new Map();
      seen[g0] = 1;
      for (let qi = 0; qi < comp.length; qi++) {
        const g = comp[qi], x = g % W;
        for (const h of [g - 1, g + 1, g - W, g + W]) {
          if (h < 0 || h >= N || Math.abs((h % W) - x) > 1) continue;
          if (owner[h] === k) { if (!seen[h]) { seen[h] = 1; comp.push(h); } }
          else border.set(owner[h], (border.get(owner[h]) || 0) + 1);
        }
      }
      if (comp.length > maxIsland) continue;
      let bo = -2, bn = 0, tot = 0;
      for (const [o, n] of border) { tot += n; if (n > bn) { bn = n; bo = o; } }
      if (bo >= 0 && bn > 0.6 * tot) for (const g of comp) owner[g] = bo;
    }
  }
  if (globalThis.__ownerDebug) globalThis.__ownerDebug = { owner, W, Hh };
  return { holeShare: +(holes / Math.max(1, fgN)).toFixed(4) };
}

/** Classe di colore di un pixel: H capelli chiari/lilla, C viola (mantello), B blu (vestito), K pelle, N neutro. */
export function colorClass(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, v = mx, sat = mx ? d / mx : 0;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  if (r > g && g > b && r - b > 40 && sat > 0.18 && sat < 0.65 && v > 120) return "K";
  if (v > 150 && sat < 0.3 && b >= g && r >= g - 4 && (r + b) / 2 - g > 10) return "H";
  if (sat > 0.45 && h >= 255 && h <= 315) return "C";
  if (sat > 0.35 && h >= 195 && h < 255) return "B";
  return "N";
}

/**
 * Proprietà dei pixel della posa per colore + ordine (vedi importGrid). pieces in ordine dal fondo;
 * accepts: Map pezzo → classi accettate. Restituisce i pezzi con rgba nuovo (stesso riquadro
 * allargato alla parte presa dalla posa) e le statistiche.
 */
function ownByColor(pieces, ref, accepts, { grow = 6, reach = 40, strict = new Set(), prefer = null } = {}) {
  const W = ref.width, H = ref.height, N = W * H;
  const fg = new Uint8Array(N), cls = new Uint8Array(N);
  const CODE = { H: 1, C: 2, B: 3, K: 4, N: 5 };
  for (let i = 0; i < N; i++) {
    const r = ref.rgba[i * 4], g = ref.rgba[i * 4 + 1], b = ref.rgba[i * 4 + 2];
    if (ref.rgba[i * 4 + 3] < 128 || (g > r + 40 && g > b + 40)) continue;
    fg[i] = 1; cls[i] = CODE[colorClass(r, g, b)];
  }
  // maschere dei pezzi (allargate di "grow") e distanza da ciascuna (fino a reach), per pezzo
  const masks = pieces.map((p) => {
    const m = new Uint8Array(N);
    for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) {
      if (p.rgba[(y * p.width + x) * 4 + 3] < 128) continue;
      const gx = p.x + x, gy = p.y + y;
      if (gx >= 0 && gy >= 0 && gx < W && gy < H) m[gy * W + gx] = 1;
    }
    return m;
  });
  const distTo = (m, lim) => {
    const d = new Uint16Array(N).fill(65535), q = [];
    for (let i = 0; i < N; i++) if (m[i]) { d[i] = 0; q.push(i); }
    for (let qi = 0; qi < q.length; qi++) {
      const i = q[qi], x = i % W, y = (i - x) / W;
      if (d[i] >= lim) continue;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1])
        if (j >= 0 && d[j] === 65535) { d[j] = d[i] + 1; q.push(j); }
    }
    return d;
  };
  const dists = masks.map((m) => distTo(m, reach));
  const acc = pieces.map((p) => new Set([...(accepts.get(p) || "HCBKN")].map((c) => CODE[c])));
  const owner = new Int8Array(N).fill(-1);
  let byFront = 0, byNear = 0, orphan = 0;
  const orphanBy = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < N; i++) {
    if (!fg[i]) continue;
    let k = -1;
    // preferenze per classe (es. i capelli chiari sopra le spalle sono delle CIOCCHE DAVANTI, non dei
    // capelli dietro: così il braccio sotto tiene la sua spalla disegnata e non resta "segato")
    const pref = prefer?.[cls[i]];
    if (pref && (!pref.over || pref.over.some((pc) => { const j = pieces.indexOf(pc); return j >= 0 && dists[j][i] <= 2; }))) {
      let bd = Infinity;
      for (const pc of pref.pieces) { const j = pieces.indexOf(pc); if (j >= 0 && dists[j][i] <= pref.reach && dists[j][i] < bd) { bd = dists[j][i]; k = j; } }
      if (k >= 0) { byFront++; owner[i] = k; continue; }
    }
    for (let j = pieces.length - 1; j >= 0; j--) if (dists[j][i] <= (strict.has(pieces[j]) ? 0 : grow) && acc[j].has(cls[i])) { k = j; break; }
    if (k >= 0) { byFront++; owner[i] = k; continue; }
    let bd = 65535;
    for (let j = 0; j < pieces.length; j++) if (!strict.has(pieces[j]) && acc[j].has(cls[i]) && dists[j][i] < bd) { bd = dists[j][i]; k = j; }
    if (k >= 0 && bd <= reach) { byNear++; owner[i] = k; } else { orphan++; orphanBy[cls[i]]++; }
  }
  const out = pieces.map((p, k) => {
    // riquadro: unione del pezzo e dei pixel della posa che possiede
    let x0 = p.x, y0 = p.y, x1 = p.x + p.width - 1, y1 = p.y + p.height - 1;
    for (let i = 0; i < N; i++) if (owner[i] === k) { const x = i % W, y = (i - x) / W; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(W - 1, x1); y1 = Math.min(H - 1, y1);
    const w = x1 - x0 + 1, h = y1 - y0 + 1, rgba = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const gx = x + x0, gy = y + y0, g = gy * W + gx, o = (y * w + x) * 4;
      if (owner[g] === k) { rgba.set(ref.rgba.subarray(g * 4, g * 4 + 3), o); rgba[o + 3] = 255; continue; }
      // disegno della tavola solo dove il pezzo è NASCOSTO da un pezzo più davanti
      const lx = gx - p.x, ly = gy - p.y;
      if (lx < 0 || ly < 0 || lx >= p.width || ly >= p.height) continue;
      const li = (ly * p.width + lx) * 4;
      if (p.rgba[li + 3] < 128) continue;
      if (fg[g] && owner[g] > k) { rgba.set(p.rgba.subarray(li, li + 4), o); }
    }
    return { x: x0, y: y0, width: w, height: h, rgba };
  });
  return { pieces: out, owner, stats: { byFront, byNear, orphan, orphanByClass: { H: orphanBy[1], C: orphanBy[2], B: orphanBy[3], K: orphanBy[4], N: orphanBy[5] } } };
}

/** Centro dei pixel opachi nella fascia più alta del pezzo (calotta della spalla). */
function capCenter(p, frac) {
  // centro dei pixel opachi nella fascia più alta del pezzo (calotta della spalla)
  let n = 0, sx = 0, sy = 0;
  for (let y = 0; y < Math.max(2, p.height * frac); y++)
    for (let x = 0; x < p.width; x++) if (p.rgba[(y * p.width + x) * 4 + 3] > 200) { n++; sx += x; sy += y; }
  return { x: p.x + sx / Math.max(1, n), y: p.y + sy / Math.max(1, n) };
};
/** Ridimensiona un pezzo a w×h (vicino più prossimo; scale diverse in x e y). */
function resizePiece(p, w, h) {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = Math.min(p.width - 1, Math.floor((x * p.width) / w)), sy = Math.min(p.height - 1, Math.floor((y * p.height) / h));
    rgba.set(p.rgba.subarray((sy * p.width + sx) * 4, (sy * p.width + sx) * 4 + 4), (y * w + x) * 4);
  }
  return { width: w, height: h, rgba };
}

/**
 * Pulizia del pezzo: via i pixel quasi trasparenti (< 60) e le isole staccate piccole (< 2% della più
 * grande). Le isole e i bordi sporchi, nelle mesh che si allungano, diventano righe tratteggiate e
 * puntini che volano attorno al pezzo (visti nell'apertura a T della maga).
 */
function cleanSpecks(p) {
  const { width: W, height: H, rgba } = p, N = W * H;
  for (let i = 0; i < N; i++) if (rgba[i * 4 + 3] < 60) rgba[i * 4 + 3] = 0;
  const lab = new Int32Array(N).fill(-1), sizes = [];
  for (let i = 0; i < N; i++) {
    if (lab[i] >= 0 || !rgba[i * 4 + 3]) continue;
    const id = sizes.length, q = [i]; lab[i] = id; let n = 0;
    while (q.length) {
      const j = q.pop(); n++;
      const x = j % W, y = (j - x) / W;
      for (const k of [x > 0 ? j - 1 : -1, x < W - 1 ? j + 1 : -1, y > 0 ? j - W : -1, y < H - 1 ? j + W : -1])
        if (k >= 0 && lab[k] < 0 && rgba[k * 4 + 3]) { lab[k] = id; q.push(k); }
    }
    sizes.push(n);
  }
  const big = Math.max(0, ...sizes);
  for (let i = 0; i < N; i++) if (lab[i] >= 0 && sizes[lab[i]] < 0.02 * big) rgba[i * 4 + 3] = 0;
  return p;
}
