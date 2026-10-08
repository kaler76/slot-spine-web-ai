// src/lib/mouthGemini.js — SORRISO RIDISEGNATO con Gemini (regola R10 di docs/REGOLE_MESH.md, zeus-mesh-9).
// La deformazione della bocca (R9) non basta per cambiare espressione: qui si manda a Gemini un ritaglio 16:9
// del viso (il formato che la funzione edge chiede a Gemini) con l'ordine di cambiare SOLO la bocca; la
// risposta si riallinea al ritaglio originale (spostamento e scala cercati sui pixel lontani dalla bocca),
// si adattano i colori sull'anello attorno alla bocca e si tiene solo la zona della bocca con bordo sfumato.
// Il risultato è un pezzo "bocca_sorriso" che nel loop compare in dissolvenza sopra il corpo.
// Puro: nessun DOM (ridimensionamento e chiamata di rete sono nel componente).

export const SMILE_PROMPTS = {
  chiusa:
    "Edit the attached image. Change ONLY the mouth: make the character smile warmly with the mouth CLOSED (lips together, corners clearly turned up, cheeks slightly raised). " +
    "Everything else must stay IDENTICAL to the input, pixel for pixel: same framing, same crop, same zoom, same position of every feature, same eyes, nose, hair, skin, lighting, colors, line weight and art style. " +
    "Do not move, rotate, crop, zoom, reframe, restyle or add anything. Same image size. No text, no borders.",
  aperta:
    "Edit the attached image. Change ONLY the mouth: make the character smile happily with the mouth slightly OPEN showing the upper teeth (corners clearly turned up, cheeks slightly raised). " +
    "Everything else must stay IDENTICAL to the input, pixel for pixel: same framing, same crop, same zoom, same position of every feature, same eyes, nose, hair, skin, lighting, colors, line weight and art style. " +
    "Do not move, rotate, crop, zoom, reframe, restyle or add anything. Same image size. No text, no borders."
};

/** Riquadro 16:9 attorno alla bocca (naso e mento dentro: servono per riallineare la risposta). */
export function mouthCropBox(mouth) {
  const w = Math.round(5 * mouth.width), h = Math.round((w * 9) / 16);
  return { x0: Math.round(mouth.center.x - w / 2), y0: Math.round(mouth.center.y - 0.42 * h), width: w, height: h };
}

/** Ritaglio RGBA (fuori dall'immagine: trasparente). */
export function cropRgba(rgba, W, H, box) {
  const out = new Uint8ClampedArray(box.width * box.height * 4);
  for (let y = 0; y < box.height; y++) for (let x = 0; x < box.width; x++) {
    const gx = x + box.x0, gy = y + box.y0;
    if (gx < 0 || gy < 0 || gx >= W || gy >= H) continue;
    out.set(rgba.subarray((gy * W + gx) * 4, (gy * W + gx) * 4 + 4), (y * box.width + x) * 4);
  }
  return out;
}

const lum = (a, i) => 0.3 * a[i] + 0.59 * a[i + 1] + 0.11 * a[i + 2];

function sampleBilinear(src, w, h, x, y, out, o) {
  if (x < 0 || y < 0 || x > w - 1 || y > h - 1) { out[o + 3] = 0; return false; }
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1), fx = x - x0, fy = y - y0;
  for (let k = 0; k < 4; k++) {
    const a = src[(y0 * w + x0) * 4 + k], b = src[(y0 * w + x1) * 4 + k], c = src[(y1 * w + x0) * 4 + k], d = src[(y1 * w + x1) * 4 + k];
    out[o + k] = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }
  return true;
}

/**
 * Pezzo del sorriso dal ritaglio originale e dalla risposta di Gemini GIÀ ridimensionata alle stesse misure.
 * @param {{ orig: Uint8ClampedArray, gen: Uint8ClampedArray, box, mouth }} p  mouth in coordinate immagine
 * @returns {{ x0, y0, width, height, rgba, shift: {dx, dy, s}, error }} pezzo in coordinate immagine
 */
export function smilePatchFromGemini({ orig, gen, box, mouth }) {
  const w = box.width, h = box.height;
  const mcx = mouth.center.x - box.x0, mcy = mouth.center.y - box.y0, mw = mouth.width;
  // zona di confronto: pixel opachi dell'originale FUORI dalla bocca allargata (occhi, naso, mento, capelli)
  const far = (x, y) => ((x - mcx) / (1.5 * mw)) ** 2 + ((y - mcy) / (1.15 * mw)) ** 2 > 1;
  const pts = [];
  const step = Math.max(1, Math.round(w / 160));
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) { const i = (y * w + x) * 4; if (orig[i + 3] > 200 && far(x, y)) pts.push([x, y, lum(orig, i)]); }
  const tmp = new Float32Array(4);
  const cost = (dx, dy, s) => {
    let e = 0, n = 0;
    for (const [x, y, l] of pts) {
      // punto dell'originale -> punto della risposta (scala attorno al centro del ritaglio, poi spostamento)
      const gx = (x - w / 2) * s + w / 2 + dx, gy = (y - h / 2) * s + h / 2 + dy;
      if (!sampleBilinear(gen, w, h, gx, gy, tmp, 0)) continue;
      e += Math.abs(0.3 * tmp[0] + 0.59 * tmp[1] + 0.11 * tmp[2] - l); n++;
    }
    return n > pts.length * 0.5 ? e / n : Infinity;
  };
  // ricerca grossolana poi fine (Gemini a volte sposta o ingrandisce di qualche punto percentuale)
  let best = { dx: 0, dy: 0, s: 1, e: cost(0, 0, 1) };
  const R = Math.round(0.06 * w);
  for (const s of [0.94, 0.97, 1, 1.03, 1.06]) for (let dy = -R; dy <= R; dy += Math.max(1, R >> 3)) for (let dx = -R; dx <= R; dx += Math.max(1, R >> 3)) { const e = cost(dx, dy, s); if (e < best.e) best = { dx, dy, s, e }; }
  for (let it = 0; it < 3; it++) {
    const st = Math.max(0.5, (R >> 3) / 2 ** (it + 1)), ss = 0.01 / 2 ** it;
    for (const s of [best.s - ss, best.s, best.s + ss]) for (const dy of [-st, 0, st]) for (const dx of [-st, 0, st]) { const e = cost(best.dx + dx, best.dy + dy, s); if (e < best.e) best = { dx: best.dx + dx, dy: best.dy + dy, s, e }; }
  }
  // risposta riallineata sul ritaglio
  const al = new Uint8ClampedArray(w * h * 4), ok = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const gx = (x - w / 2) * best.s + w / 2 + best.dx, gy = (y - h / 2) * best.s + h / 2 + best.dy;
    if (sampleBilinear(gen, w, h, gx, gy, tmp, 0)) { al.set(tmp, (y * w + x) * 4); ok[y * w + x] = 1; }
  }
  // colori: guadagno + scarto per canale stimati sull'anello attorno alla bocca (stessa pelle, stessa luce)
  const rx = 1.15 * mw, ry = 0.85 * mw;
  const er = (x, y) => Math.sqrt(((x - mcx) / rx) ** 2 + ((y - mcy) / ry) ** 2);
  const gain = [1, 1, 1], off = [0, 0, 0];
  {
    const so = [0, 0, 0], sg = [0, 0, 0], soo = [0, 0, 0], sgg = [0, 0, 0];
    let n = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const r = er(x, y), i = (y * w + x) * 4;
      if (r < 0.85 || r > 1.25 || !ok[y * w + x] || orig[i + 3] < 200) continue;
      for (let k = 0; k < 3; k++) { so[k] += orig[i + k]; sg[k] += al[i + k]; soo[k] += orig[i + k] ** 2; sgg[k] += al[i + k] ** 2; }
      n++;
    }
    if (n > 30) for (let k = 0; k < 3; k++) {
      const mo = so[k] / n, mg = sg[k] / n, vo = Math.max(1, soo[k] / n - mo * mo), vg = Math.max(1, sgg[k] / n - mg * mg);
      gain[k] = Math.min(1.4, Math.max(0.7, Math.sqrt(vo / vg)));
      off[k] = mo - gain[k] * mg;
    }
  }
  // pezzo: dentro l'ellisse della bocca, bordo sfumato (pieno fino a 0,65 del raggio, nullo a 1)
  let bx0 = w, by0 = h, bx1 = -1, by1 = -1;
  const pa = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const r = er(x, y), i = (y * w + x) * 4;
    if (r >= 1 || !ok[y * w + x] || orig[i + 3] < 8) continue;
    const t = r <= 0.65 ? 1 : 1 - (r - 0.65) / 0.35, a = t * t * (3 - 2 * t) * (orig[i + 3] / 255);
    if (a <= 0.004) continue;
    for (let k = 0; k < 3; k++) pa[i + k] = al[i + k] * gain[k] + off[k];
    pa[i + 3] = Math.round(255 * a);
    bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y);
  }
  if (bx1 < 0) return { error: "risposta di Gemini non allineabile al viso" };
  const pw = bx1 - bx0 + 1, ph = by1 - by0 + 1, out = new Uint8ClampedArray(pw * ph * 4);
  for (let y = 0; y < ph; y++) out.set(pa.subarray(((y + by0) * w + bx0) * 4, ((y + by0) * w + bx1 + 1) * 4), y * pw * 4);
  // differenza media fuori dalla bocca dopo l'allineamento: alta = Gemini ha cambiato il viso, meglio rigenerare
  return { x0: box.x0 + bx0, y0: box.y0 + by0, width: pw, height: ph, rgba: out, shift: { dx: best.dx, dy: best.dy, s: best.s }, error: null, mismatch: best.e };
}
