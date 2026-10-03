// src/lib/handObject.js — REGOLA "MANO E OGGETTO LUNGO IN UN UNICO PEZZO" (decisione utente 3 ott 2026).
// Quando il personaggio impugna un oggetto lungo (fulmine, bastone, lancia, spada), la tavola
// esplosa contiene MANO + OGGETTO come un solo pezzo, tagliato dal braccio al polso:
//  - pixel originali della presa conservati (dita, sagoma della mano, angolo dell'oggetto);
//    la parte dell'oggetto nascosta nel pugno resta nascosta nello stesso pezzo;
//  - un unico pivot al POLSO, figlio del braccio di quel lato; nessuna animazione propria
//    (eredita il braccio: mano e oggetto non scorrono né ruotano l'una rispetto all'altro,
//    e il raccordo del polso resta coperto durante il movimento);
//  - conta come UN pezzo nel limite di MAX_PIECES.
// Qui: riconoscimento del blocco fra i pezzi "oggetto*", nome, genitore/pivot e controlli
// (mano duplicata sul braccio, polso scoperto, frammenti dell'oggetto staccati).
// Non cambia gli altri oggetti né i casi già approvati (sacchetto del folletto: non lungo).
// Puro: nessun DOM.

import { LM } from "./partRecognition.js";

export const HAND_OBJECT_RULE_VERSION = "2026-10-03.mano-oggetto.1";
/**
 * Oggetto "lungo": lunghezza lungo l'asse principale ≥ longMin × avambraccio (gomito–polso) E
 * allungato (deviazione lungo l'asse principale ≥ elongMin × quella trasversale). L'asse viene dai
 * momenti dei pixel, così vale anche per un oggetto in diagonale (fulmine). Il sacchetto del
 * folletto (tozzo) resta un oggetto separato.
 */
export const HAND_OBJECT_RULES = { longMin: 1.5, elongMin: 2.2, coverR: 8, wristOverlap: 6, fragmentPad: 12 };

const SIDES = {
  sx: { wrist: LM.wristSx, elbow: LM.elbowSx, hand: [LM.indexSx, LM.pinkySx, LM.thumbSx] },
  dx: { wrist: LM.wristDx, elbow: LM.elbowDx, hand: [LM.indexDx, LM.pinkyDx, LM.thumbDx] }
};

const alphaAt = (p, x, y) => {
  const lx = Math.round(x - p.x), ly = Math.round(y - p.y);
  if (lx < 0 || ly < 0 || lx >= p.width || ly >= p.height) return 0;
  return p.rgba[(ly * p.width + lx) * 4 + 3];
};
function covers(p, pt, r = HAND_OBJECT_RULES.coverR) {
  if (!p || !pt) return false;
  for (let dy = -r; dy <= r; dy += 2) for (let dx = -r; dx <= r; dx += 2) if (alphaAt(p, pt.x + dx, pt.y + dy) > 128) return true;
  return false;
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Asse principale dei pixel opachi: { length (estensione lungo l'asse), elong (rapporto deviazioni) }. */
export function principalShape(p) {
  let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  const step = Math.max(1, Math.floor(Math.sqrt((p.width * p.height) / 40000)));
  for (let y = 0; y < p.height; y += step)
    for (let x = 0; x < p.width; x += step)
      if (p.rgba[(y * p.width + x) * 4 + 3] > 128) {
        n++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
      }
  if (n < 3) return { length: 0, elong: 1 };
  const mx = sx / n, my = sy / n;
  const a = sxx / n - mx * mx, c = syy / n - my * my, b = sxy / n - mx * my;
  const t = Math.sqrt(((a - c) / 2) ** 2 + b * b);
  const l1 = (a + c) / 2 + t, l2 = Math.max(1e-6, (a + c) / 2 - t);
  const th = 0.5 * Math.atan2(2 * b, a - c), ux = Math.cos(th), uy = Math.sin(th);
  let lo = Infinity, hi = -Infinity;
  for (let y = 0; y < p.height; y += step)
    for (let x = 0; x < p.width; x += step)
      if (p.rgba[(y * p.width + x) * 4 + 3] > 128) {
        const d = (x - mx) * ux + (y - my) * uy;
        if (d < lo) lo = d;
        if (d > hi) hi = d;
      }
  return { length: hi - lo + step, elong: Math.sqrt(l1 / l2) };
}
export const isHandObjectName = (name) => /^mano_/.test(name || "");

/** Polso della mano (articolazione di recognizeParts se c'è, altrimenti il punto della posa). */
const wristOf = (side, landmarks, joints) => joints?.[`mano_${side}`] || landmarks?.[SIDES[side].wrist];

/**
 * Riconosce fra i pezzi "oggetto*" i blocchi MANO+OGGETTO LUNGO e li rinomina
 * (mano_oggetto_sx / mano_oggetto_dx), con genitore il braccio e pivot al polso.
 * Da chiamare dopo labelPieces. Modifica i pezzi; restituisce i blocchi trovati.
 */
export function applyHandObjects(pieces, landmarks, joints) {
  const found = [];
  if (!landmarks) return found;
  for (const p of pieces) {
    if (!/^oggetto/.test(p.name)) continue;
    let best = null;
    for (const side of ["sx", "dx"]) {
      const S = SIDES[side];
      const wrist = wristOf(side, landmarks, joints), elbow = landmarks[S.elbow];
      if (!wrist || !elbow || !covers(p, wrist)) continue;
      // la mano è nel pezzo: copre il polso E almeno un punto della mano (indice, mignolo, pollice)
      const handHits = S.hand.filter((i) => covers(p, landmarks[i])).length;
      if (!handHits) continue;
      const forearm = dist(elbow, wrist) || 1;
      const shape = principalShape(p);
      const long = shape.length >= HAND_OBJECT_RULES.longMin * forearm && shape.elong >= HAND_OBJECT_RULES.elongMin;
      if (!long) continue;
      // se la mano è rimasta ANCHE sul braccio, il blocco resta comunque mano+oggetto e
      // checkHandObjects segnala la mano duplicata (tavola da rigenerare secondo la regola)
      const score = handHits;
      if (!best || score > best.score) best = { side, score };
    }
    if (!best) continue;
    const others = found.filter((f) => f.side === best.side).length;
    p.name = `mano_oggetto_${best.side}${others ? `_${others + 1}` : ""}`;
    p.handObject = { side: best.side, version: HAND_OBJECT_RULE_VERSION };
    p.motionLocked = true; // eredita il braccio: niente oscillazione propria
    found.push({ piece: p, side: best.side });
  }
  return found;
}

/** Genitore e pivot del blocco mano+oggetto (per rigInfo di explodedSheet). */
export function handObjectRig(p, landmarks, joints) {
  const side = p.handObject?.side;
  const w = side && wristOf(side, landmarks, joints);
  if (!w) return null;
  return { parent: `braccio_${side}`, pivot: { x: Math.round(w.x), y: Math.round(w.y) } };
}

/**
 * Controlli della regola (coordinate dell'originale, pezzi già ricollocati):
 *  - la mano non deve restare duplicata sul braccio;
 *  - il polso deve essere coperto da braccio E blocco (sovrapposizione minima), così il raccordo
 *    non si apre quando il braccio si muove;
 *  - nessun frammento dell'oggetto rimasto come pezzo a sé attaccato al blocco.
 * @returns {string[]} avvisi
 */
export function checkHandObjects(pieces, landmarks, joints) {
  const warnings = [];
  for (const p of pieces.filter((q) => q.handObject)) {
    const { side } = p.handObject;
    const S = SIDES[side];
    const arm = pieces.find((q) => q.name === `braccio_${side}`);
    const wrist = wristOf(side, landmarks, joints), elbow = landmarks?.[S.elbow];
    if (!arm) {
      warnings.push(`${p.name}: manca braccio_${side} a cui agganciare il blocco mano+oggetto.`);
      continue;
    }
    const dup = S.hand.filter((i) => covers(arm, landmarks?.[i], 4));
    if (dup.length >= 2)
      warnings.push(`${p.name}: la mano sembra ancora presente anche su braccio_${side} (mano duplicata): il braccio deve finire al polso.`);
    if (wrist && elbow) {
      // un punto appena prima del polso, verso il gomito: deve essere coperto dal braccio, e il
      // polso dal blocco; il blocco deve arrivare (sovrapposizione) fin quasi a quel punto
      const k = HAND_OBJECT_RULES.wristOverlap / (dist(elbow, wrist) || 1);
      const inner = { x: wrist.x + (elbow.x - wrist.x) * k, y: wrist.y + (elbow.y - wrist.y) * k };
      const ok = covers(arm, inner, 3) && covers(p, wrist, 3) && (covers(arm, wrist, 4) || covers(p, inner, 4));
      if (!ok) warnings.push(`${p.name}: raccordo del polso scoperto (braccio e blocco non si sovrappongono al polso): rigenera con un piccolo margine di sovrapposizione.`);
    }
    const pad = HAND_OBJECT_RULES.fragmentPad;
    for (const q of pieces)
      if (/^oggetto/.test(q.name) && q.x - pad < p.x + p.width && p.x - pad < q.x + q.width && q.y - pad < p.y + p.height && p.y - pad < q.y + q.height)
        warnings.push(`${q.name}: attaccato a ${p.name}, forse un frammento dell'oggetto rimasto separato (l'oggetto lungo deve stare tutto nel blocco con la mano).`);
  }
  return warnings;
}
