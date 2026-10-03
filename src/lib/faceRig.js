// src/lib/faceRig.js — VISO: nomi, genitore e pivot dei pezzi del viso (occhi, sopracciglia,
// bocca, ciocche di capelli) a partire dai punti del viso della posa MediaPipe:
//   1-3 occhio sinistro (2 = centro), 4-6 occhio destro (5 = centro), 7-8 orecchie,
//   9-10 angoli della bocca. "sx" = lato SINISTRO del personaggio (x maggiore per chi guarda).
// Regole (collaudate sui sintetici di syntheticRig.js con { face: true }):
//  - unità di misura del viso u = distanza fra i centri degli occhi;
//  - un pezzo del viso è attaccato alla testa (riquadri sovrapposti), non contiene gomito/polso
//    (copre un polso = oggetto in mano) ed è piccolo (< 1.2 u; ciocche < 2.4 u);
//  - occhio = pezzo col centro entro 0.35 u dal centro dell'occhio; sopracciglio = 0.5 u sopra
//    l'occhio; bocca = entro 0.5 u dal centro fra gli angoli; assegnazione globale dal più vicino;
//  - il resto attaccato alla testa che sporge dal viso = ciocca (lato dal centro della testa);
//    dentro il viso = dettaglio_viso (fermo).
// Animazione (characterFromPieces): occhi = battito (scala y + trasparenza, sincronizzati),
// ciocche = vento in ritardo sulla testa, sopracciglia e bocca ferme (espressioni: passo dopo).
// Puro: nessun DOM.

export const FACE_LM = { eyeSx: 2, eyeDx: 5, earSx: 7, earDx: 8, mouthSx: 9, mouthDx: 10, nose: 0 };
// baffi (Zeus, tavola corretta dall'utente 3 ott): due metà ai lati della bocca, attaccate sotto il
// naso; centro a ~0.6 u dal centro della bocca, verso il lato, poco sotto
export const FACE_RULES = { eyeMax: 0.35, browAbove: 0.5, browMax: 0.35, mouthMax: 0.5, maxSize: 1.2, mouthSize: 1.8, hairOut: 0.6, mustacheSide: 0.6, mustacheDown: 0.15, mustacheMax: 0.45, mustacheSize: 1.8, belowMouthMax: 1.0 };
export const FACE_PREFIXES = ["occhio", "sopracciglio", "bocca", "baffo", "ciocca", "capelli_dietro", "dettaglio_viso"];
export const isFaceName = (name) => FACE_PREFIXES.some((k) => name === k || name?.startsWith(`${k}_`));

const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const centerOf = (p) => ({ x: p.x + p.width / 2, y: p.y + p.height / 2 });

/** Riferimenti del viso dalla posa (null se mancano gli occhi). */
export function faceFrame(landmarks) {
  const P = (i) => landmarks?.[i];
  const eSx = P(FACE_LM.eyeSx), eDx = P(FACE_LM.eyeDx);
  if (!eSx || !eDx) return null;
  const u = dist(eSx, eDx) || 1;
  const eyes = mid(eSx, eDx);
  const mouth = P(FACE_LM.mouthSx) && P(FACE_LM.mouthDx) ? mid(P(FACE_LM.mouthSx), P(FACE_LM.mouthDx)) : { x: eyes.x, y: eyes.y + u };
  // "su" del viso: dalla bocca verso gli occhi
  const ux = eyes.x - mouth.x, uy = eyes.y - mouth.y, ul = Math.hypot(ux, uy) || 1;
  const up = { x: ux / ul, y: uy / ul };
  const above = (p) => ({ x: p.x + up.x * FACE_RULES.browAbove * u, y: p.y + up.y * FACE_RULES.browAbove * u });
  const ears = P(FACE_LM.earSx) && P(FACE_LM.earDx) ? [P(FACE_LM.earSx), P(FACE_LM.earDx)] : null;
  const center = ears ? mid(ears[0], ears[1]) : eyes;
  const radius = ears ? dist(ears[0], ears[1]) / 2 : 1.6 * u;
  // direzione "verso il lato sinistro del personaggio"
  const sxDir = { x: (eSx.x - eDx.x) / u, y: (eSx.y - eDx.y) / u };
  const mustache = (sgn) => ({
    x: mouth.x + sgn * sxDir.x * FACE_RULES.mustacheSide * u - up.x * FACE_RULES.mustacheDown * u,
    y: mouth.y + sgn * sxDir.y * FACE_RULES.mustacheSide * u - up.y * FACE_RULES.mustacheDown * u
  });
  return { u, eyeSx: eSx, eyeDx: eDx, browSx: above(eSx), browDx: above(eDx), mouth, mustacheSx: mustache(1), mustacheDx: mustache(-1), center, radius, sxDir };
}

const alphaAt = (p, x, y) => {
  const lx = Math.round(x - p.x), ly = Math.round(y - p.y);
  if (lx < 0 || ly < 0 || lx >= p.width || ly >= p.height) return 0;
  return p.rgba[(ly * p.width + lx) * 4 + 3];
};
function covers(p, pt, r = 4) {
  if (!pt) return false;
  for (let dy = -r; dy <= r; dy += 2) for (let dx = -r; dx <= r; dx += 2) if (alphaAt(p, pt.x + dx, pt.y + dy) > 128) return true;
  return false;
}
const overlaps = (a, b, pad = 0) => a.x - pad < b.x + b.width && b.x - pad < a.x + a.width && a.y - pad < b.y + b.height && b.y - pad < a.y + a.height;

/**
 * Dà il nome ai pezzi del viso fra quelli rimasti senza nome (dopo testa/busto/braccia).
 * @param {Array} rest - pezzi senza nome (vengono modificati: p.name)
 * @param {Array} landmarks - posa dell'originale (pixel)
 * @param {Object} head - pezzo "testa"
 * @returns {Set} pezzi del viso a cui è stato dato un nome
 */
export function labelFacePieces(rest, landmarks, head, takenNames = new Set()) {
  const fr = faceFrame(landmarks);
  const named = new Set();
  if (!fr || !head) return named;
  // polsi: un pezzo che li copre è un oggetto tenuto in mano, non il viso (il gomito no: un
  // braccio alzato passa accanto alla testa e il suo gomito cade su ciocche e sopracciglia)
  const limbs = [15, 16].map((i) => landmarks?.[i]).filter(Boolean);
  const cand = rest.filter(
    (p) => overlaps(p, head, 0.1 * fr.u) && Math.max(p.width, p.height) < Math.max(FACE_RULES.maxSize * 2, FACE_RULES.mustacheSize) * fr.u && !limbs.some((pt) => covers(p, pt))
  );
  // [nome, punto, distanza massima, lato massimo] — la bocca sorridente è larga (folletto: 1.15 u
  // più il margine del ritaglio): fino a 1.8 u
  const targets = [
    ["occhio_sx", fr.eyeSx, FACE_RULES.eyeMax, FACE_RULES.maxSize],
    ["occhio_dx", fr.eyeDx, FACE_RULES.eyeMax, FACE_RULES.maxSize],
    ["sopracciglio_sx", fr.browSx, FACE_RULES.browMax, FACE_RULES.maxSize],
    ["sopracciglio_dx", fr.browDx, FACE_RULES.browMax, FACE_RULES.maxSize],
    ["bocca", fr.mouth, FACE_RULES.mouthMax, FACE_RULES.mouthSize],
    ["baffo_sx", fr.mustacheSx, FACE_RULES.mustacheMax, FACE_RULES.mustacheSize],
    ["baffo_dx", fr.mustacheDx, FACE_RULES.mustacheMax, FACE_RULES.mustacheSize]
  ];
  const pairs = [];
  for (const p of cand) {
    const c = centerOf(p);
    for (const [name, pt, max, size] of targets) {
      if (Math.max(p.width, p.height) > size * fr.u) continue; // parti del viso: piccole
      const d = dist(c, pt) / fr.u;
      if (d <= max) pairs.push({ p, name, d });
    }
  }
  pairs.sort((a, b) => a.d - b.d);
  const done = new Set(takenNames); // nomi già dati dal gruppo del viso (sheetAssembly)
  for (const { p, name } of pairs) {
    if (named.has(p) || done.has(name)) continue;
    p.name = name;
    named.add(p);
    done.add(name);
  }
  // il resto attaccato alla testa: ciocca se sporge dal viso, altrimenti dettaglio del viso
  const count = {};
  const uniq = (base) => {
    count[base] = (count[base] || 0) + 1;
    return count[base] === 1 ? base : `${base}_${count[base]}`;
  };
  // "giù" del viso = verso la bocca: un pezzo con il centro oltre 1 u sotto la bocca non è una
  // ciocca né un dettaglio del viso (caso Zeus: lembo del mantello sulla spalla preso per ciocca)
  const eyesMid = mid(fr.eyeSx, fr.eyeDx);
  const ul = dist(eyesMid, fr.mouth) || 1;
  const below = (c) => ((c.x - fr.mouth.x) * (fr.mouth.x - eyesMid.x) + (c.y - fr.mouth.y) * (fr.mouth.y - eyesMid.y)) / ul;
  for (const p of cand) {
    if (named.has(p)) continue;
    const c = centerOf(p);
    if (below(c) > FACE_RULES.belowMouthMax * fr.u) continue;
    const out = dist(c, fr.center) >= FACE_RULES.hairOut * fr.radius || p.x < fr.center.x - fr.radius || p.x + p.width > fr.center.x + fr.radius || p.y < fr.center.y - fr.radius;
    if (out) {
      const side = (c.x - fr.center.x) * fr.sxDir.x + (c.y - fr.center.y) * fr.sxDir.y;
      p.name = uniq(Math.abs(side) < 0.25 * fr.u ? "ciocca" : side > 0 ? "ciocca_sx" : "ciocca_dx");
    } else p.name = uniq("dettaglio_viso");
    named.add(p);
  }
  return named;
}

/**
 * CAPELLI POSTERIORI (regola dalla tavola Zeus corretta dall'utente, 3 ott): sempre un pezzo a
 * sé, dietro la testa, così testa e capelli si muovono in modo indipendente e il contorno della
 * testa resta pulito. Riconosciuto fra i pezzi rimasti: si appoggia alla testa (almeno il 20%
 * dei suoi pixel sopra la testa), è grande (oltre le misure del viso), non copre i polsi.
 * Nome capelli_dietro (genitore testa, attaccatura in alto, vento, disegnato DIETRO la testa).
 * @returns {Set} pezzi riconosciuti
 */
export function labelBackHair(rest, landmarks, head) {
  const fr = faceFrame(landmarks);
  const found = new Set();
  if (!fr || !head) return found;
  const limbs = [15, 16].map((i) => landmarks?.[i]).filter(Boolean);
  let k = 0;
  for (const p of rest) {
    if (limbs.some((pt) => covers(p, pt, 6))) continue;
    if (Math.max(p.width, p.height) < FACE_RULES.maxSize * fr.u) continue; // ciocche piccole: labelFacePieces
    let n = 0, on = 0;
    for (let y = 0; y < p.height; y += 2)
      for (let x = 0; x < p.width; x += 2) {
        if (p.rgba[(y * p.width + x) * 4 + 3] < 128) continue;
        n++;
        if (alphaAt(head, p.x + x, p.y + y) > 128) on++;
      }
    // oppure: riquadro in gran parte sovrapposto a quello della testa e centro sopra le spalle
    // (Zeus: ciocca posteriore spostata dal ridisegno, pochi pixel sopra la testa ma stessa zona)
    const ix = Math.max(0, Math.min(p.x + p.width, head.x + head.width) - Math.max(p.x, head.x));
    const iy = Math.max(0, Math.min(p.y + p.height, head.y + head.height) - Math.max(p.y, head.y));
    const sh = [11, 12].map((i) => landmarks?.[i]).filter(Boolean);
    const shY = sh.length ? sh.reduce((a, q) => a + q.y, 0) / sh.length : Infinity;
    const boxOk = (ix * iy) / (p.width * p.height) >= 0.3 && p.y + p.height / 2 < shY;
    if (!n || (on / n < 0.2 && !boxOk)) continue;
    p.name = ++k === 1 ? "capelli_dietro" : `capelli_dietro_${k}`;
    found.add(p);
  }
  return found;
}

/**
 * Pivot di un pezzo del viso (coordinate immagine): centro per occhi, sopracciglia, bocca e
 * dettagli; per ciocche, baffi e capelli posteriori il centro della riga più alta che poggia
 * sulla testa (attaccatura).
 */
export function facePivot(p, head) {
  if (!/^(ciocca|baffo|capelli_dietro)/.test(p.name)) return centerOf(p);
  for (let y = p.y; y < p.y + p.height; y++) {
    let sx = 0, n = 0;
    for (let x = p.x; x < p.x + p.width; x++)
      if (alphaAt(p, x, y) > 128 && (!head || alphaAt(head, x, y) > 128)) {
        sx += x;
        n++;
      }
    if (n) return { x: sx / n, y };
  }
  return { x: p.x + p.width / 2, y: p.y };
}

/** Ruolo e animazione di partenza dei pezzi del viso (per characterFromPieces). */
export function faceDefaults(name) {
  if (name.startsWith("occhio")) return { role: "eye", animationType: "blink", speed: 0.65 }; // 1 battito ogni 4 s
  if (name.startsWith("sopracciglio")) return { role: "eyebrow", animationType: "static", speed: 1 };
  if (name.startsWith("bocca")) return { role: "mouth", animationType: "static", speed: 1 };
  if (name.startsWith("ciocca")) return { role: "hair", animationType: "wind", speed: 1 };
  if (name.startsWith("capelli_dietro")) return { role: "hair", animationType: "wind", speed: 0.8 };
  if (name.startsWith("baffo")) return { role: "hair", animationType: "wind", speed: 0.7 };
  if (name.startsWith("dettaglio_viso")) return { role: "other", animationType: "static", speed: 1 };
  return null;
}
