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
/** Prompt per la mappa delle parti (stessi colori di PART_COLORS). */
export const PARTMAP_PROMPT = `Using the attached character image, produce a PART MAP of it for 2D skeletal animation.
- Output the SAME character in EXACTLY the same pose, position, size and silhouette as the attached image. Do not move, resize, crop, rotate or redraw anything. Keep the character centered exactly as in the input, same proportions.
- Fill every pixel of the character with ONE flat solid color depending on which part it belongs to. No outlines, no shading, no gradients, no texture, no anti-aliasing glow, no text, no labels.
- Background: pure black #000000.
Part colors (left/right are the CHARACTER's anatomical sides: the character's RIGHT arm is on the viewer's LEFT):
- HEAD: face skin, ears, neck, hat/crown/helmet AND the BARE skin of shoulders, collarbones and chest above the clothing = pure red #FF0000
- HAIR (all hair behind and around the head, including long hair falling over the shoulders) = purple #8000FF
- SIDE HAIR LOCKS hanging in front, beside the face = dark green #008000
- EYES (each eye, iris and white) = cyan #00FFFF
- EYEBROWS = magenta #FF00FF
- MOUTH / LIPS = gray #808080
- MUSTACHE (if any) = brown #804000
- TORSO: all clothing of the body (dress, tunic, armor), belly, hips, legs and feet = pure green #00FF00
- CHARACTER'S RIGHT ARM (bare skin of the upper arm from the armpit down, forearm, hand, glove, bracelet) = pure blue #0000FF
- CHARACTER'S LEFT ARM (bare skin of the upper arm from the armpit down, forearm, hand, glove, bracelet) = pure yellow #FFFF00
- HELD OBJECTS (staff, sword, cigarette holder, bag, lightning bolt…) and smoke/particles = orange #FF8000
- Anything else (jewelry, earrings, belt ornaments) = the color of the part it is attached to.`;

/**
 * Secondo passaggio, SOLO TESTA (il viso nella mappa intera è troppo piccolo: occhi e
 * sopracciglia di pochi pixel si perdono): si manda a Gemini il ritaglio della testa ingrandito.
 */
export const FACE_PARTMAP_PROMPT = `Using the attached close-up of a character's head, produce a FACE PART MAP of it.
- Output EXACTLY the same framing, position, size and shapes as the attached image. Do not move, resize, crop, rotate or redraw anything.
- Fill every pixel with ONE flat solid color depending on what it is. No outlines, no shading, no gradients, no text.
- EYES (each whole eye: white, iris, eyelids and lashes) = cyan #00FFFF
- EYEBROWS = magenta #FF00FF
- MOUTH / LIPS = gray #808080
- MUSTACHE (if any) = brown #804000
- HAIR (all hair, front and back) = purple #8000FF
- Everything else of the head (face skin, nose, ears, neck, earrings, hat/crown) = pure red #FF0000
- Anything that is not the head or hair (shoulders, clothes, arms, objects) and the background = pure black #000000.`;

/** Ordine di disegno per parte (0 = dietro). */
const ORDER = { capelli_dietro: 0, busto: 1, braccio_sx: 2, braccio_dx: 2, testa: 3, ciocca: 4, baffo: 5, bocca: 5, occhio: 5, sopracciglio: 5, oggetto: 6 };
/** Genitore preferito per parte (se si toccano); altrimenti la parte con più bordo in comune. */
const PARENT = { busto: null, testa: "busto", braccio_sx: "busto", braccio_dx: "busto", capelli_dietro: "testa", ciocca: "testa", occhio: "testa", sopracciglio: "testa", bocca: "testa", baffo: "testa", oggetto: null };
/** Parti a coppia: componenti separate con il lato del personaggio. */
const PAIRED = new Set(["occhio", "sopracciglio", "ciocca", "baffo"]);

const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** Quota minima dei pixel del personaggio con un colore della palette (mappa valida). */
export const MAP_MIN_PALETTE = 0.75;

/** Etichetta di ogni pixel della mappa: indice in PART_COLORS, -1 sfondo, -2 incerto. */
export function quantizeMap({ width: W, height: H, rgba }, { maxDist = 70, bgMax = 60 } = {}) {
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
  // CONTROLLO: se Gemini non ha ricolorato (ha restituito il personaggio con i suoi colori) quasi
  // nessun pixel è vicino alla palette: meglio fermarsi che produrre decine di pezzi sbagliati
  let fgM = 0, ok = 0;
  for (let i = 0; i < W * H; i++) if (lab[i] !== -1) { fgM++; if (lab[i] >= 0) ok++; }
  if (fgM && ok / fgM < MAP_MIN_PALETTE) {
    const e = new Error(`La mappa di Gemini non è a tinte piatte (solo ${Math.round((ok / fgM) * 100)}% dei pixel ha un colore della palette): ha ridisegnato il personaggio invece di ricolorarlo. Riprova a generarla.`);
    e.code = "partmap_not_flat";
    throw e;
  }
  // APERTURA: la mappa arriva in JPEG e i bordi fra due colori creano colori intermedi (blu+giallo
  // = grigio "bocca", verde+nero = verde scuro "ciocca", rosso+verde = marrone "baffo"): linee
  // sottili. Un pixel resta etichettato solo se tutti i suoi 8 vicini hanno la sua etichetta
  // (o sono sfondo); il resto diventa incerto e viene riassegnato alla parte vicina.
  const out = Int8Array.from(lab);
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x, v = lab[i];
      if (v < 0) continue;
      for (let dy = -1; dy <= 1 && out[i] === v; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const u = lab[i + dy * W + dx];
          if (u !== v && u !== -1) { out[i] = -2; break; }
        }
    }
  return out;
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

/**
 * Riempimento delle zone nascoste con la MEDIA SFUMATA dei colori noti vicini (convoluzione
 * normalizzata a raggi crescenti 4, 8, 16, 32, 64 px): niente strisce, colore continuo.
 */
function diffuseFill(rgba, known, fill, w, h) {
  const todo = [];
  for (let i = 0; i < w * h; i++) if (fill[i] && !known[i]) todo.push(i);
  if (!todo.length) return;
  // immagini integrali di colore*noto e di noto
  const S = [0, 1, 2, 3].map(() => new Float64Array((w + 1) * (h + 1)));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x, k = known[i] ? 1 : 0;
      const vals = [rgba[i * 4] * k, rgba[i * 4 + 1] * k, rgba[i * 4 + 2] * k, k];
      for (let c = 0; c < 4; c++) {
        const a = S[c];
        a[(y + 1) * (w + 1) + x + 1] = vals[c] + a[y * (w + 1) + x + 1] + a[(y + 1) * (w + 1) + x] - a[y * (w + 1) + x];
      }
    }
  const box = (a, x0, y0, x1, y1) => a[(y1 + 1) * (w + 1) + x1 + 1] - a[y0 * (w + 1) + x1 + 1] - a[(y1 + 1) * (w + 1) + x0] + a[y0 * (w + 1) + x0];
  for (const i of todo) {
    const x = i % w, y = (i - x) / w;
    for (const r of [4, 8, 16, 32, 64, 128]) {
      const x0 = Math.max(0, x - r), y0 = Math.max(0, y - r), x1 = Math.min(w - 1, x + r), y1 = Math.min(h - 1, y + r);
      const n = box(S[3], x0, y0, x1, y1);
      if (n < 4) continue;
      for (let c = 0; c < 3; c++) rgba[i * 4 + c] = box(S[c], x0, y0, x1, y1) / n;
      rgba[i * 4 + 3] = 255;
      break;
    }
  }
}

const HEADISH = new Set(["testa", "occhio", "sopracciglio", "bocca", "baffo"]);
const HAIR = new Set(["capelli_dietro", "ciocca"]);
const partIndex = (name) => PART_COLORS.findIndex((c) => c.part === name);

/**
 * Riquadro della TESTA nell'originale (dalla mappa intera), con margine: è il ritaglio da mandare
 * a Gemini per la mappa del viso (FACE_PARTMAP_PROMPT).
 * @returns {{x,y,w,h}|null}
 */
export function headCrop({ map, original, fg, margin = 0.25 }) {
  const { width: W, height: H } = original;
  const mapLab = quantizeMap(map);
  const T = alignMap(mapLab, map.width, map.height, fg, W, H);
  const lab = labelOriginal(mapLab, map.width, map.height, fg, W, H, T);
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let i = 0; i < W * H; i++) {
    if (lab[i] < 0 || !HEADISH.has(PART_COLORS[lab[i]].part)) continue;
    const x = i % W, y = (i - x) / W;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) return null;
  const mx = Math.round((x1 - x0) * margin), my = Math.round((y1 - y0) * margin);
  x0 = Math.max(0, x0 - mx); y0 = Math.max(0, y0 - my); x1 = Math.min(W - 1, x1 + mx); y1 = Math.min(H - 1, y1 + my);
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Sovrascrive i tratti del viso con la mappa del viso (più dettagliata) dentro il ritaglio. */
function mergeFaceMap(lab, W, H, faceMap, crop, warnings) {
  let fLab;
  try {
    fLab = quantizeMap(faceMap);
  } catch (e) {
    warnings.push(`Mappa del viso non valida (${e.message.slice(0, 80)}…): occhi e bocca presi dalla mappa intera.`);
    return;
  }
  // sagoma di confronto: testa + capelli nel ritaglio
  const cm = new Uint8Array(crop.w * crop.h);
  for (let y = 0; y < crop.h; y++)
    for (let x = 0; x < crop.w; x++) {
      const v = lab[(y + crop.y) * W + (x + crop.x)];
      if (v >= 0 && (HEADISH.has(PART_COLORS[v].part) || HAIR.has(PART_COLORS[v].part))) cm[y * crop.w + x] = 1;
    }
  const T = alignMap(fLab, faceMap.width, faceMap.height, cm, crop.w, crop.h);
  if (T.iou < 0.8) {
    warnings.push(`Mappa del viso poco sovrapposta alla testa (IoU ${T.iou.toFixed(2)}): occhi e bocca presi dalla mappa intera.`);
    return;
  }
  const testa = partIndex("testa");
  for (let y = 0; y < crop.h; y++)
    for (let x = 0; x < crop.w; x++) {
      const gi = (y + crop.y) * W + (x + crop.x);
      if (lab[gi] < 0 || !HEADISH.has(PART_COLORS[lab[gi]].part)) continue;
      const mx = Math.round((x - T.tx) / T.s), my = Math.round((y - T.ty) / T.s);
      if (mx < 0 || my < 0 || mx >= faceMap.width || my >= faceMap.height) continue;
      const v = fLab[my * faceMap.width + mx];
      if (v < 0) continue;
      const part = PART_COLORS[v].part;
      if (HEADISH.has(part)) lab[gi] = v;
      else if (lab[gi] !== testa) lab[gi] = testa; // tratto sbagliato nella mappa intera: torna testa
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
export function piecesFromPartMap({ map, original, fg, hiddenPad = null, faceMap = null, faceCrop = null }) {
  const warnings = [];
  const { width: W, height: H, rgba } = original;
  const mapLab = quantizeMap(map);
  const T = alignMap(mapLab, map.width, map.height, fg, W, H);
  if (T.iou < 0.85) warnings.push(`Mappa delle parti poco sovrapposta alla sagoma (IoU ${T.iou.toFixed(2)}): Gemini ha spostato o ridisegnato il personaggio.`);
  const lab = labelOriginal(mapLab, map.width, map.height, fg, W, H, T);
  if (faceMap && faceCrop) mergeFaceMap(lab, W, H, faceMap, faceCrop, warnings);
  let fgN = 0, labeled = 0;
  for (let i = 0; i < W * H; i++) if (fg[i]) { fgN++; if (lab[i] >= 0) labeled++; }
  // area minima: piccola per i tratti del viso (occhi, sopracciglia: pochi pixel nella mappa)
  const FACE = new Set(["occhio", "sopracciglio", "bocca", "baffo"]);
  const minAreaOf = (part) => (FACE.has(part) ? Math.max(20, Math.round(0.00004 * fgN)) : Math.max(40, Math.round(0.0008 * fgN)));
  const minArea = Math.max(40, Math.round(0.0008 * fgN));
  // briciole di una parte (isole sotto l'area minima, o isole staccate di una parte UNICA come
  // testa e busto: si tiene il pezzo principale) -> parte con più bordo in comune
  for (let k = 0; k < PART_COLORS.length; k++) {
    const part = PART_COLORS[k].part;
    const unique = !PAIRED.has(part) && part !== "oggetto";
    const comps = components(lab, W, H, k);
    comps.forEach((px, ci) => {
      if (px.length >= minAreaOf(part) && !(unique && ci > 0)) return;
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
    });
  }
  // pezzi: componenti di ogni parte
  const raw = [];
  PART_COLORS.forEach((c, k) => {
    const comps = components(lab, W, H, k).filter((px) => px.length >= minAreaOf(c.part));
    comps.forEach((px) => raw.push({ part: c.part, k, px }));
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
    diffuseFill(out, known, fill, w, h);
    // riquadro stretto sui pixel opachi (il margine serviva solo per le zone nascoste)
    let tx0 = w, ty0 = h, tx1 = -1, ty1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (out[(y * w + x) * 4 + 3]) {
      if (x < tx0) tx0 = x; if (x > tx1) tx1 = x; if (y < ty0) ty0 = y; if (y > ty1) ty1 = y;
    }
    const tw = tx1 - tx0 + 1, th = ty1 - ty0 + 1, trimmed = new Uint8ClampedArray(tw * th * 4);
    for (let y = 0; y < th; y++) trimmed.set(out.subarray(((y + ty0) * w + tx0) * 4, ((y + ty0) * w + tx1 + 1) * 4), y * tw * 4);
    return {
      name: r.name, part: r.part, x: x0 + tx0, y: y0 + ty0, width: tw, height: th, rgba: trimmed, area: r.px.length,
      parent: r.parent, pivot: { x: Math.round(r.pivot.x), y: Math.round(r.pivot.y) }, order: ORDER[r.part] ?? 3, matchError: 0
    };
  });
  // ordine finale: per parte, poi area (a parità, il più grande dietro)
  [...pieces].sort((a, b) => a.order - b.order || b.area - a.area).forEach((p, i) => (p.order = i));
  const coverage = fgN ? labeled / fgN : 0;
  return { pieces, transform: T, coverage, warnings };
}

// ---------------------------------------------------------------------------------------------
// TAVOLA ESPLOSA GUIDATA DALLA MAPPA (decisione utente, Jessica 3 ott 2026): i pezzi giusti sono
// QUELLI DELLA TAVOLA (tagli, zone nascoste dipinte, palpebre chiuse); la mappa serve solo a
// capire DOVE va ogni pezzo e COME si chiama. Per ogni pezzo della tavola si cerca la parte della
// mappa (componente) e la posizione con la massima sovrapposizione delle sagome (IoU): la forma
// resta riconoscibile anche quando Gemini ha ridisegnato colori e dettagli.

/**
 * Componenti della mappa nell'originale, con nome (lato del personaggio per le parti a coppia).
 * @returns {{ lab: Int8Array, comps: Array<{name, part, px:number[], box}> , T }}
 */
export function mapComponents({ map, original, fg, faceMap = null, faceCrop = null }) {
  const { width: W, height: H } = original;
  const mapLab = quantizeMap(map);
  const T = alignMap(mapLab, map.width, map.height, fg, W, H);
  const lab = labelOriginal(mapLab, map.width, map.height, fg, W, H, T);
  if (faceMap && faceCrop) mergeFaceMap(lab, W, H, faceMap, faceCrop, []);
  let fgN = 0;
  for (let i = 0; i < W * H; i++) if (fg[i]) fgN++;
  const FACE = new Set(["occhio", "sopracciglio", "bocca", "baffo"]);
  const minAreaOf = (part) => (FACE.has(part) ? Math.max(20, Math.round(0.00004 * fgN)) : Math.max(40, Math.round(0.0008 * fgN)));
  const comps = [];
  PART_COLORS.forEach((c, k) => {
    const list = components(lab, W, H, k).filter((px) => px.length >= minAreaOf(c.part));
    const unique = !PAIRED.has(c.part) && c.part !== "oggetto";
    const use = unique ? list.slice(0, 1) : list;
    const cx = (px) => px.reduce((a, i) => a + (i % W), 0) / px.length;
    use.sort((a, b) => cx(a) - cx(b));
    use.forEach((px, i) => {
      let name = c.part;
      if (PAIRED.has(c.part) && use.length === 2) name = `${c.part}_${i === 0 ? "dx" : "sx"}`;
      else if (use.length > 1) name = `${c.part}_${i + 1}`;
      let x0 = W, y0 = H, x1 = 0, y1 = 0;
      for (const j of px) {
        const x = j % W, y = (j - x) / W;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      comps.push({ name, part: c.part, px, box: { x0, y0, x1, y1 } });
    });
  });
  return { lab, comps, T };
}

/**
 * Posizione e nome di ogni pezzo della tavola dalla mappa (sovrapposizione delle sagome su una
 * griglia ridotta di fattore `ds`, poi rifinitura a 1 px).
 * @param {Array} pieces - pezzi della tavola GIÀ in scala dell'originale (width, height, rgba)
 * @returns {Array<{piece, name, part, x, y, iou, s}>} assegnazioni (un componente per pezzo)
 */
export function placeByPartMap(pieces, comps, W, H, { ds = 4, scales = [1, 0.9, 1.1, 0.8, 1.25] } = {}) {
  const dw = Math.ceil(W / ds), dh = Math.ceil(H / ds);
  // maschere ridotte dei componenti
  const cm = comps.map((c) => {
    const m = new Uint8Array(dw * dh);
    for (const i of c.px) {
      const x = i % W, y = (i - x) / W;
      m[Math.floor(y / ds) * dw + Math.floor(x / ds)] = 1;
    }
    let n = 0;
    for (const v of m) n += v;
    return { m, n };
  });
  const pieceMask = (p, s) => {
    const w = Math.max(1, Math.round((p.width * s) / ds)), h = Math.max(1, Math.round((p.height * s) / ds));
    const m = new Uint8Array(w * h);
    let n = 0;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const sx = Math.min(p.width - 1, Math.floor(((x + 0.5) * ds) / s)), sy = Math.min(p.height - 1, Math.floor(((y + 0.5) * ds) / s));
        if (p.rgba[(sy * p.width + sx) * 4 + 3] >= 128) { m[y * w + x] = 1; n++; }
      }
    return { m, w, h, n };
  };
  const cand = [];
  pieces.forEach((p, pi) => {
    const small = Math.max(p.width, p.height) < 0.12 * Math.max(W, H);
    for (const s of small ? scales : [1]) {
      const pm = pieceMask(p, s);
      if (!pm.n) continue;
      comps.forEach((c, ci) => {
        const C = cm[ci];
        // il pezzo non può essere molto più piccolo o più grande del componente
        const ratio = pm.n / Math.max(1, C.n);
        if (ratio < 0.4 || ratio > 3.5) return;
        const b = c.box;
        const bx0 = Math.floor(b.x0 / ds) - pm.w, bx1 = Math.ceil(b.x1 / ds), by0 = Math.floor(b.y0 / ds) - pm.h, by1 = Math.ceil(b.y1 / ds);
        let best = null;
        for (let oy = by0; oy <= by1; oy++)
          for (let ox = bx0; ox <= bx1; ox++) {
            let inter = 0;
            for (let y = 0; y < pm.h; y++) {
              const gy = oy + y;
              if (gy < 0 || gy >= dh) continue;
              for (let x = 0; x < pm.w; x++) {
                const gx = ox + x;
                if (gx < 0 || gx >= dw || !pm.m[y * pm.w + x]) continue;
                inter += C.m[gy * dw + gx];
              }
            }
            const iou = inter / (pm.n + C.n - inter);
            if (!best || iou > best.iou) best = { iou, ox, oy };
          }
        if (best) cand.push({ pi, ci, s, iou: best.iou, x: best.ox * ds, y: best.oy * ds });
      });
    }
  });
  // assegnazione globale: IoU più alta prima, un componente e un pezzo una volta sola
  cand.sort((a, b) => b.iou - a.iou);
  const usedP = new Set(), usedC = new Set(), out = [];
  for (const c of cand) {
    if (usedP.has(c.pi) || usedC.has(c.ci) || c.iou < 0.3) continue;
    usedP.add(c.pi);
    usedC.add(c.ci);
    out.push({ piece: pieces[c.pi], name: comps[c.ci].name, part: comps[c.ci].part, x: c.x, y: c.y, iou: +c.iou.toFixed(3), s: c.s });
  }
  return out;
}
