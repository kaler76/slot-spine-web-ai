// src/lib/pieceCheck.js — CONTROLLO PEZZO PER PEZZO della tavola esplosa ricomposta.
// La fedeltà globale (importExplodedSheet) è una media pesata sull'area: un occhio di 300 px
// finito sul busto non la sposta (caso reale: folletto con viso, fedeltà "ok" con occhi e bocca
// sul busto). Qui ogni pezzo viene giudicato da solo, sui pixel dell'originale:
//   - sagoma: quota dei pixel del pezzo che cadono sul personaggio (non sullo sfondo);
//   - combacia: errore medio (troncato) tra i pixel del pezzo e l'originale in quel punto.
//     I pezzi piccoli (viso) non hanno zone ridisegnate: soglia più stretta;
//   - viso: occhi, sopracciglia e bocca devono poggiare sulla testa;
//   - viso completo: occhi e sopracciglia a coppie (il battito è sincronizzato).
// Livelli: "ok", "warn" (da guardare), "bad" (pezzo fuori posto: rigenerare o correggere).
// Puro: nessun DOM.

import { borderColor } from "./explodedSheet.js";

/** Soglie (calibrate su folletto, folletto_viso, avvocato, folletto_ridisegnata). */
export const PIECE_RULES = {
  smallSide: 0.12, // pezzo piccolo: lato < 12% del lato maggiore dell'originale (come alignPiece)
  fgMin: 0.6, // casi reali: 0.84..1.00
  smallErrMax: 65, // pezzi piccoli: casi reali 18..54 (occhi 49-54)
  bigErrMax: 75, // = USABLE_MAX; casi reali usabili 21..73 (sacchetto in parte nascosto: 73)
  onHeadMin: 0.7, // occhi/sopracciglia/bocca sulla testa: casi reali 1.00
  T: 120 // troncamento dell'errore per pixel (come matchError)
};

const CORE_FACE = /^(occhio|sopracciglio|bocca)(_|$)/;

function alphaOf(p, x, y) {
  const lx = x - p.x, ly = y - p.y;
  if (lx < 0 || ly < 0 || lx >= p.width || ly >= p.height) return 0;
  return p.rgba[(ly * p.width + lx) * 4 + 3];
}

/** Misure di un pezzo già ricollocato (p.x, p.y in coordinate dell'originale). */
export function measurePiece(p, original, { head = null, bg = borderColor(original), maxSamples = 6000 } = {}) {
  const { width: W, height: H, rgba } = original;
  let opaque = 0;
  for (let i = 3; i < p.rgba.length; i += 4) if (p.rgba[i] >= 240) opaque++;
  const step = Math.max(1, Math.floor(opaque / maxSamples));
  let n = 0, fg = 0, onHead = 0, err = 0, k = 0;
  for (let y = 0; y < p.height; y++)
    for (let x = 0; x < p.width; x++) {
      const li = (y * p.width + x) * 4;
      if (p.rgba[li + 3] < 240 || k++ % step) continue;
      n++;
      const gx = p.x + x, gy = p.y + y;
      if (head && alphaOf(head, gx, gy) > 128) onHead++;
      if (gx < 0 || gy < 0 || gx >= W || gy >= H) { err += PIECE_RULES.T; continue; }
      const gi = (gy * W + gx) * 4;
      const d = Math.abs(rgba[gi] - p.rgba[li]) + Math.abs(rgba[gi + 1] - p.rgba[li + 1]) + Math.abs(rgba[gi + 2] - p.rgba[li + 2]);
      err += Math.min(d, PIECE_RULES.T);
      if (rgba[gi + 3] >= 128 && Math.hypot(rgba[gi] - bg[0], rgba[gi + 1] - bg[1], rgba[gi + 2] - bg[2]) >= 40) fg++;
    }
  n = Math.max(1, n);
  return { fgShare: +(fg / n).toFixed(2), localError: +(err / n).toFixed(1), onHead: head ? +(onHead / n).toFixed(2) : null };
}

/**
 * @param {Array} pieces - pezzi ricollocati e con nome (importExplodedSheet)
 * @param {{width,height,rgba}} original
 * @returns {{ checks: Array<{name,level,issues:string[],small:boolean,fgShare,localError,onHead}>, warnings: string[], ok: boolean }}
 */
export function checkPieces(pieces, original) {
  const bg = borderColor(original);
  const side = Math.max(original.width, original.height);
  const head = pieces.find((p) => p.name === "testa") || null;
  const checks = pieces.map((p) => {
    // pezzi "resto" (sheetAssembly): pixel dell'originale per costruzione, niente da controllare
    if (p.restOf !== undefined) return { name: p.name, level: "ok", issues: [], small: false, fgShare: 1, localError: 0, onHead: null };
    const small = Math.max(p.width, p.height) < PIECE_RULES.smallSide * side;
    const isCore = CORE_FACE.test(p.name);
    const m = measurePiece(p, original, { head: isCore && p !== head ? head : null, bg });
    const issues = [];
    let level = "ok";
    const raise = (l, msg) => {
      issues.push(msg);
      if (l === "bad" || level === "ok") level = l;
    };
    if (m.fgShare < PIECE_RULES.fgMin)
      raise("bad", `fuori dalla sagoma del personaggio: solo il ${Math.round(m.fgShare * 100)}% dei pixel cade sul disegno originale`);
    const errMax = small ? PIECE_RULES.smallErrMax : PIECE_RULES.bigErrMax;
    if (m.localError > errMax)
      raise(small ? "bad" : "warn", `non combacia con l'originale in quel punto (errore ${m.localError}, limite ${errMax}${small ? " per i pezzi piccoli" : ""})`);
    if (isCore) {
      if (!head) raise("bad", "tratto del viso ma nessun pezzo testa");
      else if (m.onHead < PIECE_RULES.onHeadMin)
        raise("bad", `non poggia sulla testa (${Math.round(m.onHead * 100)}% sulla testa): probabilmente finito sul busto o su un braccio`);
    }
    if (small && /^oggetto/.test(p.name) && head)
      raise("warn", "pezzo piccolo non riconosciuto come parte del viso: controlla se è un occhio, la bocca o una ciocca fuori posto");
    return { name: p.name, level, issues, small, ...m };
  });
  // viso completo: se c'è un tratto del viso, occhi e sopracciglia vanno a coppie
  const names = new Set(pieces.map((p) => p.name));
  const warnings = [];
  if (pieces.some((p) => CORE_FACE.test(p.name)))
    for (const [a, b, what] of [["occhio_sx", "occhio_dx", "occhio"], ["sopracciglio_sx", "sopracciglio_dx", "sopracciglio"]])
      if (names.has(a) !== names.has(b))
        warnings.push(`Viso incompleto: c'è ${names.has(a) ? a : b} ma manca ${names.has(a) ? b : a}. Un ${what} non riconosciuto è forse finito fuori posto o fuso con un altro pezzo.`);
  for (const c of checks)
    if (c.level !== "ok") warnings.push(`${c.level === "bad" ? "Pezzo FUORI POSTO" : "Pezzo da controllare"} — ${c.name}: ${c.issues.join("; ")}.`);
  return { checks, warnings, ok: checks.every((c) => c.level !== "bad") && !warnings.some((w) => w.startsWith("Viso incompleto")) };
}
