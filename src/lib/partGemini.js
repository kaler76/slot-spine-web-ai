// src/lib/partGemini.js — PEZZO SEPARATO CON GEMINI (regola R22 di docs/REGOLE_MESH.md, zeus-mesh-14).
// Metodo standard per qualsiasi personaggio, non per un caso: quando un pezzo da tagliare (oggi il braccio alzato)
// è difficile da separare per forma e colore (capelli dello stesso tono, punti della posa spostati, categorie
// sbagliate), si chiede a Gemini la STESSA immagine SENZA quel pezzo, con ridisegnato quello che c'era dietro.
//   1. ritaglio 16:9 attorno al pezzo (il formato della funzione edge), fondo magenta pieno sotto il trasparente;
//   2. risposta riallineata al ritaglio (spostamento + scala cercati sui pixel LONTANI dal pezzo) e colori adattati;
//   3. contorno del pezzo = dove l'originale e la risposta differiscono, solo nella zona attorno alle ossa del pezzo;
//   4. il pezzo si prende dall'ORIGINALE (pixel identici); dalla risposta solo il "dietro" (piastra) per il corpo.
// Controlli automatici (allineamento, grandezza, asse coperto): se uno fallisce si torna al metodo senza AI.
// Puro: nessun DOM (ridimensionamento e chiamata di rete sono nel componente).

export const PART_KEY = [255, 0, 255]; // fondo magenta: Gemini lo conserva, e dice dove dietro al pezzo non c'è niente

const KEEP =
  "Everything else must stay IDENTICAL to the input, pixel for pixel: same framing, same crop, same zoom, same position of every feature, same face, hair, clothes, lighting, colors, line weight and art style. " +
  "Do not move, rotate, crop, zoom, reframe or restyle anything. Same image size. No text, no borders.";
const CONTEXT = "The attached image is a crop of an ORIGINAL stylized cartoon character illustration for a slot machine game (not a photo, not a real person). ";
const BG = "Where nothing of the character was behind it, fill with the same flat magenta background. ";

/** Varianti del prompt per togliere il braccio alzato (provate in ordine se Gemini rifiuta). side = lato nell'immagine. */
export function armRemovalPrompts(side) {
  const where = side === "left" ? "on the LEFT side of the image" : "on the RIGHT side of the image";
  return [
    CONTEXT + `Edit the illustration: REMOVE completely the character's raised arm ${where} — the whole arm from the shoulder to the fingers — together with anything held in that hand (and its smoke or effects). ` +
      "Redraw what was hidden behind it (hair, shoulder, neck, chest, clothes) by continuing the existing shapes, colors and painting style. " + BG + KEEP,
    CONTEXT + `Retouch this game artwork: erase the raised arm ${where} and the object in its hand, and paint the hair, shoulder and clothes that were behind it in the same style. ` + BG +
      "Keep the same framing, same size, same everything else.",
    `Game art retouch on an original cartoon illustration: remove the raised arm ${where} with the held object; paint what was behind it in the same style; flat magenta background where empty. Same framing, same size, all other pixels unchanged.`
  ];
}

const segD = (x, y, a, b) => { const vx = b.x - a.x, vy = b.y - a.y, l2 = vx * vx + vy * vy || 1; const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (y - a.y) * vy) / l2)); return Math.hypot(x - a.x - vx * t, y - a.y - vy * t); };

/**
 * Riquadro 16:9 (coordinate immagine) attorno al braccio: spalla, gomito, polso, punta della mano, oggetto, + margine.
 * @param {{ sh, el, wr, hd, shoulderW, objBox? }} arm  objBox = { x0, y0, x1, y1 } dell'oggetto (facoltativo)
 */
export function armCropBox(arm) {
  const m = 0.55 * arm.shoulderW;
  let x0 = Math.min(arm.sh.x, arm.el.x, arm.wr.x, arm.hd.x), x1 = Math.max(arm.sh.x, arm.el.x, arm.wr.x, arm.hd.x);
  let y0 = Math.min(arm.sh.y, arm.el.y, arm.wr.y, arm.hd.y), y1 = Math.max(arm.sh.y, arm.el.y, arm.wr.y, arm.hd.y);
  if (arm.objBox) { x0 = Math.min(x0, arm.objBox.x0); x1 = Math.max(x1, arm.objBox.x1); y0 = Math.min(y0, arm.objBox.y0); y1 = Math.max(y1, arm.objBox.y1); }
  x0 -= m; x1 += m; y0 -= m; y1 += m;
  let w = x1 - x0, h = y1 - y0;
  if (w / h < 16 / 9) w = (h * 16) / 9; else h = (w * 9) / 16;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return { x0: Math.round(cx - w / 2), y0: Math.round(cy - h / 2), width: Math.round(w), height: Math.round(h) };
}

/** Ritaglio appiattito sul magenta (quello che si manda a Gemini). */
export function flattenOnKey(crop) {
  const out = new Uint8ClampedArray(crop);
  for (let i = 0; i < out.length; i += 4) { const a = out[i + 3] / 255; for (let k = 0; k < 3; k++) out[i + k] = out[i + k] * a + PART_KEY[k] * (1 - a); out[i + 3] = 255; }
  return out;
}

function sampleBilinear(src, w, h, x, y, out) {
  if (x < 0 || y < 0 || x > w - 1 || y > h - 1) return false;
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1), fx = x - x0, fy = y - y0;
  for (let k = 0; k < 4; k++) {
    const a = src[(y0 * w + x0) * 4 + k], b = src[(y0 * w + x1) * 4 + k], c = src[(y1 * w + x0) * 4 + k], d = src[(y1 * w + x1) * 4 + k];
    out[k] = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }
  return true;
}
const lum = (a, i) => 0.3 * a[i] + 0.59 * a[i + 1] + 0.11 * a[i + 2];

/**
 * Maschera del pezzo e piastra del "dietro" dalla risposta di Gemini GIÀ ridimensionata alle misure del ritaglio.
 * @param {{ orig: Uint8ClampedArray, gen: Uint8ClampedArray, box, arm, W, H }} p
 *   orig = ritaglio dell'originale (RGBA, trasparente fuori dal personaggio); arm in coordinate immagine
 * @returns {{ mask: Uint8Array, plate: Uint8ClampedArray, n, shift, mismatch, checks, error }} mask/plate a misura d'immagine
 */
export function armPartFromGemini({ orig, gen, box, arm, W, H }) {
  const w = box.width, h = box.height, sw = arm.shoulderW;
  const P = (p) => ({ x: p.x - box.x0, y: p.y - box.y0 });
  const sh = P(arm.sh), el = P(arm.el), wr = P(arm.wr), hd = P(arm.hd);
  const ob = arm.objBox && { x0: arm.objBox.x0 - box.x0, y0: arm.objBox.y0 - box.y0, x1: arm.objBox.x1 - box.x0, y1: arm.objBox.y1 - box.y0 };
  // ZONA del pezzo: capsule larghe attorno alle ossa (i punti della posa possono essere spostati) + oggetto
  const zoneD = (x, y) => Math.min(segD(x, y, sh, el) / 0.5, segD(x, y, el, wr) / 0.45, segD(x, y, wr, hd) / 0.6);
  const inObj = (x, y, m) => ob && x >= ob.x0 - m && x <= ob.x1 + m && y >= ob.y0 - m && y <= ob.y1 + m;
  const zone = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (zoneD(x, y) <= sw || inObj(x, y, 0.15 * sw)) zone[y * w + x] = 1;

  // 1. allineamento sui pixel opachi LONTANI dalla zona (viso, vestito, capelli dall'altra parte)
  // (anche il fondo, come magenta: i bordi della sagoma ancorano l'allineamento meglio delle texture ripetute, che
  // con una sola ricerca fine davano spostamenti "di una riga" sbagliati)
  const flat = flattenOnKey(orig);
  const pts = [], step = Math.max(1, Math.round(w / 180));
  let opaque = 0;
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) {
    if (zoneD(x, y) <= 1.4 * sw || inObj(x, y, 0.4 * sw)) continue;
    const i = (y * w + x) * 4; if (orig[i + 3] >= 200) opaque++; else if (orig[i + 3] > 8) continue;
    pts.push([x, y, orig[i + 3] >= 200 ? 1 : 0.3]);
  }
  const tmp = new Float32Array(4);
  // luminosità sfocate (media r×r) per la ricerca GROSSOLANA: senza, le texture ripetute (righe, paillettes) davano
  // allineamenti sfalsati di un motivo
  const boxBlur = (src, r) => {
    const I = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += src[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row; } }
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const a = Math.max(0, x - r), b = Math.max(0, y - r), c = Math.min(w, x + r + 1), d = Math.min(h, y + r + 1); out[y * w + x] = (I[d * (w + 1) + c] - I[b * (w + 1) + c] - I[d * (w + 1) + a] + I[b * (w + 1) + a]) / ((c - a) * (d - b)); }
    return out;
  };
  // due misure per pixel: luminosità e "magenta" ((R+B)/2 − G). Con la sola luminosità il fondo magenta (≈105) e una
  // pelle o un rosso medi si confondevano: il bordo della sagoma spariva e l'allineamento scivolava di lato
  const LO = new Float32Array(w * h), LG = new Float32Array(w * h), MO = new Float32Array(w * h), MG = new Float32Array(w * h);
  const mag = (a, i) => (a[i] + a[i + 2]) / 2 - a[i + 1];
  for (let j = 0; j < w * h; j++) { LO[j] = lum(flat, j * 4); LG[j] = lum(gen, j * 4); MO[j] = mag(flat, j * 4); MG[j] = mag(gen, j * 4); }
  const sample1 = (A, x, y) => {
    if (x < 0 || y < 0 || x > w - 1 || y > h - 1) return -1;
    const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1), fx = x - x0, fy = y - y0;
    return (A[y0 * w + x0] * (1 - fx) + A[y0 * w + x1] * fx) * (1 - fy) + (A[y1 * w + x0] * (1 - fx) + A[y1 * w + x1] * fx) * fy;
  };
  const makeCost = (O, G, O2, G2) => (dx, dy, s) => {
    let e = 0, n = 0;
    // almeno l'85% dei punti dentro la risposta (con meno punti vincevano gli spostamenti estremi); il fondo pesa poco
    // (uniforme, dice solo dov'è il bordo della sagoma)
    let tot = 0;
    for (const [x, y, wt] of pts) { tot += wt; const gx = (x - w / 2) * s + w / 2 + dx, gy = (y - h / 2) * s + h / 2 + dy, v = sample1(G, gx, gy); if (v < 0) continue; e += wt * (Math.abs(v - O[y * w + x]) + 0.5 * Math.abs(sample1(G2, gx, gy) - O2[y * w + x])); n += wt; }
    return n >= 0.85 * tot ? e / n : Infinity;
  };
  const cost = makeCost(LO, LG, MO, MG);
  let best = { dx: 0, dy: 0, s: 1, e: opaque >= 50 ? cost(0, 0, 1) : Infinity };
  if (opaque >= 50) {
    const R = Math.round(0.06 * w), st0 = Math.max(1, R >> 3), rb = Math.max(2, st0);
    const coarse = makeCost(boxBlur(LO, rb), boxBlur(LG, rb), boxBlur(MO, rb), boxBlur(MG, rb));
    let cb = { dx: 0, dy: 0, s: 1, e: coarse(0, 0, 1) };
    for (const s of [0.94, 0.97, 1, 1.03, 1.06]) for (let dy = -R; dy <= R; dy += st0) for (let dx = -R; dx <= R; dx += st0) { const e = coarse(dx, dy, s); if (e < cb.e) cb = { dx, dy, s, e }; }
    best = { ...cb, e: cost(cb.dx, cb.dy, cb.s) };
    for (let it = 0; it < 4; it++) {
      const st = Math.max(0.5, st0 / 2 ** (it + 1)), ss = 0.015 / 2 ** it;
      for (let rep = 0; rep < 3; rep++) {
        const b0 = best;
        for (const s of [b0.s - ss, b0.s, b0.s + ss]) for (const dy of [-st, 0, st]) for (const dx of [-st, 0, st]) { const e = cost(b0.dx + dx, b0.dy + dy, s); if (e < best.e) best = { dx: b0.dx + dx, dy: b0.dy + dy, s, e }; }
        if (best === b0) break;
      }
    }
  }
  // pixel lontani CAMBIATI (scarto > 40 di luminosità): Gemini ha ridisegnato anche altro, non solo il braccio
  let changed = 0, cn = 0;
  for (const [x, y] of pts) { const v = sample1(LG, (x - w / 2) * best.s + w / 2 + best.dx, (y - h / 2) * best.s + h / 2 + best.dy); if (v < 0) continue; cn++; if (Math.abs(v - LO[y * w + x]) > 40) changed++; }
  const checks = { mismatch: +best.e.toFixed(1), changedFar: +(changed / Math.max(1, cn)).toFixed(2), farPoints: pts.length };
  if (checks.changedFar > 0.3) return { error: `Gemini ha ridisegnato anche lontano dal braccio (${Math.round(100 * checks.changedFar)}% dei pixel cambiati)`, checks };
  if (!(best.e <= 40)) return { error: `risposta di Gemini non allineabile (scarto ${checks.mismatch} sui pixel lontani dal braccio)`, checks };

  // risposta riallineata
  const al = new Uint8ClampedArray(w * h * 4), ok = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (sampleBilinear(gen, w, h, (x - w / 2) * best.s + w / 2 + best.dx, (y - h / 2) * best.s + h / 2 + best.dy, tmp)) { al.set(tmp, (y * w + x) * 4); ok[y * w + x] = 1; }
  // colori: guadagno + scarto per canale stimati sui pixel lontani (stessa luce)
  const gain = [1, 1, 1], off = [0, 0, 0];
  {
    const so = [0, 0, 0], sg = [0, 0, 0], soo = [0, 0, 0], sgg = [0, 0, 0]; let n = 0;
    for (const [x, y] of pts) { const j = y * w + x, i = j * 4; if (!ok[j] || orig[i + 3] < 200) continue; for (let k = 0; k < 3; k++) { so[k] += orig[i + k]; sg[k] += al[i + k]; soo[k] += orig[i + k] ** 2; sgg[k] += al[i + k] ** 2; } n++; }
    if (n > 30) for (let k = 0; k < 3; k++) {
      const mo = so[k] / n, mg = sg[k] / n, vo = Math.max(1, soo[k] / n - mo * mo), vg = Math.max(1, sgg[k] / n - mg * mg);
      gain[k] = Math.min(1.4, Math.max(0.7, Math.sqrt(vo / vg))); off[k] = mo - gain[k] * mg;
    }
  }
  const keyA = (i) => { const d = Math.abs(al[i] - PART_KEY[0]) + Math.abs(al[i + 1] - PART_KEY[1]) + Math.abs(al[i + 2] - PART_KEY[2]); return Math.max(0, Math.min(1, (d - 60) / 90)); };

  // 2. differenza originale ↔ risposta (sfondo magenta = "niente": contro un pixel opaco è differenza piena)
  const diff = new Float32Array(w * h);
  for (let j = 0; j < w * h; j++) {
    const i = j * 4; if (!zone[j] || orig[i + 3] < 128) continue;
    if (!ok[j]) { diff[j] = 255; continue; }
    const ka = keyA(i); let d = 0;
    for (let k = 0; k < 3; k++) d = Math.max(d, Math.abs(orig[i + k] - (al[i + k] * gain[k] + off[k])));
    diff[j] = ka * d + (1 - ka) * 255;
  }
  // media su 5×5 (Gemini ridipinge le texture: paillettes e riflessi danno differenze sparse, il braccio è compatto)
  const blur = new Float32Array(w * h), r = 2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!zone[y * w + x] || orig[(y * w + x) * 4 + 3] < 128) continue;
    let s = 0, n = 0;
    for (let yy = Math.max(0, y - r); yy <= Math.min(h - 1, y + r); yy++) for (let xx = Math.max(0, x - r); xx <= Math.min(w - 1, x + r); xx++) { s += diff[yy * w + xx]; n++; }
    blur[y * w + x] = s / n;
  }
  let m = new Uint8Array(w * h);
  for (let j = 0; j < w * h; j++) if (blur[j] > 48) m[j] = 1;
  // chiusura (3 px): ricuce le righe interne del disegno uguali nelle due immagini
  const morph = (src, R, grow) => {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let hit = !grow;
      for (let dy = -R; dy <= R && hit !== grow; dy++) for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dy * dy > R * R) continue; const X = x + dx, Y = y + dy;
        const v = X >= 0 && Y >= 0 && X < w && Y < h ? src[Y * w + X] : 0;
        if (grow && v) { hit = true; break; } if (!grow && !v) { hit = false; break; }
      }
      out[y * w + x] = hit ? 1 : 0;
    }
    return out;
  };
  m = morph(morph(m, 3, true), 3, false);
  // componenti: si tengono quelle grandi (≥ 10% della più grande); le altre sono ritocchi sparsi di Gemini
  const comp = new Int32Array(w * h).fill(-1), sizes = [];
  for (let s0 = 0; s0 < w * h; s0++) {
    if (!m[s0] || comp[s0] >= 0) continue;
    const id = sizes.length, st = [s0]; comp[s0] = id; let n = 0;
    while (st.length) { const i = st.pop(); n++; const x = i % w, y = (i / w) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue; const j = Y * w + X; if (m[j] && comp[j] < 0) { comp[j] = id; st.push(j); } } }
    sizes.push(n);
  }
  const big = Math.max(0, ...sizes);
  for (let j = 0; j < w * h; j++) if (m[j] && sizes[comp[j]] < 0.1 * big) m[j] = 0;
  // buchi chiusi dentro il pezzo (riflessi, righe uguali nelle due immagini): pieni
  {
    const out = new Uint8Array(w * h), q = [];
    for (let x = 0; x < w; x++) for (const y of [0, h - 1]) { const j = y * w + x; if (!m[j] && !out[j]) { out[j] = 1; q.push(j); } }
    for (let y = 0; y < h; y++) for (const x of [0, w - 1]) { const j = y * w + x; if (!m[j] && !out[j]) { out[j] = 1; q.push(j); } }
    for (let k = 0; k < q.length; k++) { const i = q[k], x = i % w, y = (i / w) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue; const j = Y * w + X; if (!m[j] && !out[j]) { out[j] = 1; q.push(j); } } }
    for (let j = 0; j < w * h; j++) if (!out[j]) m[j] = 1;
  }
  // + 1 px di bordo (antialias del contorno), solo dove l'originale è opaco
  m = morph(m, 1, true);
  for (let j = 0; j < w * h; j++) if (orig[j * 4 + 3] < 8) m[j] = 0;

  // 3. controlli
  let n = 0; for (let j = 0; j < w * h; j++) n += m[j];
  const L = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const expected = (L(sh, el) + L(el, wr)) * 0.3 * sw + L(wr, hd) * 0.5 * sw;
  let axN = 0, axIn = 0;
  const rr = Math.max(2, Math.round(0.15 * sw));
  for (let t = 0.2; t <= 0.8001; t += 0.1) {
    const p = { x: el.x + (wr.x - el.x) * t, y: el.y + (wr.y - el.y) * t }; axN++;
    let hit = false;
    for (let dy = -rr; dy <= rr && !hit; dy++) for (let dx = -rr; dx <= rr; dx++) { const X = Math.round(p.x + dx), Y = Math.round(p.y + dy); if (X >= 0 && Y >= 0 && X < w && Y < h && m[Y * w + X]) { hit = true; break; } }
    if (hit) axIn++;
  }
  Object.assign(checks, { pixels: n, expected: Math.round(expected), ratio: +(n / expected).toFixed(2), axis: +(axIn / axN).toFixed(2) });
  if (n / expected < 0.25) return { error: `Gemini non ha tolto il braccio (pezzo di ${n} px, atteso ~${Math.round(expected)})`, checks };
  if (n / expected > 4) return { error: `Gemini ha cambiato troppo (differenze su ${n} px, atteso ~${Math.round(expected)})`, checks };
  if (axIn / axN < 0.4) return { error: "la differenza trovata non segue l'avambraccio", checks };

  // 4. maschera e piastra a misura d'immagine
  const mask = new Uint8Array(W * H), plate = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const j = y * w + x; if (!m[j]) continue;
    const X = x + box.x0, Y = y + box.y0; if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
    const g = Y * W + X, i = j * 4; mask[g] = 1;
    const a = keyA(i); if (a <= 0.02) continue;
    for (let k = 0; k < 3; k++) plate[g * 4 + k] = al[i + k] * gain[k] + off[k];
    plate[g * 4 + 3] = Math.round(255 * a);
  }
  return { mask, plate, n, shift: { dx: best.dx, dy: best.dy, s: best.s }, mismatch: best.e, checks, error: null };
}
