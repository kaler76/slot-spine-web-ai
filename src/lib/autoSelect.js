// src/lib/autoSelect.js — SELETTORE AUTOMATICO della ricomposizione (5 ott 2026).
// Invece di fissare a mano le scelte (pixel visibili dall'originale o dalla tavola, quanta
// sovrapposizione ai raccordi), prova le varianti, le MISURA con i controlli che esistono già e
// tiene la migliore, spiegando perché:
//   - posa/sagoma (importExplodedSheet: usable, IoU, buchi a riposo);
//   - naso integro, scalini di colore ai raccordi, buchi in movimento (testaBustoCheck.js);
//   - a parità: meno sovrapposizione aggiunta, pixel dall'originale.
// Le soglie dei controlli NON cambiano: cambia solo quale variante si sceglie.
// Puro: nessun DOM (nel browser va chiamato in un Web Worker: due import completi).

import { importExplodedSheet } from "./explodedSheet.js";
import { underlayJoints } from "./jointUnderlay.js";
import { noseCheck, seamStats, motionStats, SEAM_SHARE_MAX, MOTION_HOLE_MAX } from "./testaBustoCheck.js";
import { PROFILES, DEFAULT_PROFILE } from "./separationProfiles.js";
import { LM } from "./partRecognition.js";
import { assembleFromSheet, SHEET_SOURCE_VERSION } from "./sheetSource.js";
import { foregroundMask } from "./sheetAssembly.js";
import { registerSheetOnOriginal, SHEET_REGISTER_VERSION } from "./sheetRegister.js";

export const AUTO_RULES_VERSION = "2026-10-05.auto.1";
export const AUTO_FILLS = [true, false]; // pixel visibili dall'originale / dalla tavola
export const AUTO_REACHES = [0, 0.12, 0.25]; // sovrapposizione: quota del lato del figlio
export const SOURCE_IOU_MIN = 0.84;
const USABLE_MAX_COLORS = 75; // oltre: tavola ridisegnata (utilizzabile solo per la sagoma) // sotto: personaggio ridisegnato -> tavola come sorgente

/** Misure di una variante (numeri, non frasi). */
export function measureVariant(pieces, original, landmarks, base) {
  const seams = seamStats(pieces, original).filter((s) => s.n >= 20);
  const motion = motionStats(pieces, original);
  return {
    usable: !!base.usable,
    iou: base.assembly?.iou ?? null,
    nose: noseCheck(pieces, original, landmarks?.[LM.nose]).length,
    seamBad: seams.filter((s) => s.share > SEAM_SHARE_MAX).length,
    seamMean: seams.length ? seams.reduce((a, s) => a + s.share, 0) / seams.length : 0,
    motionBad: motion.filter((m) => m.share > MOTION_HOLE_MAX).length,
    motionSum: motion.reduce((a, m) => a + m.share, 0)
  };
}

/** Punteggio: più basso = migliore. Prima la posa, poi naso, raccordi, movimento; poi economia. */
export function scoreVariant(m, { fill, reach }) {
  return (
    (m.usable ? 0 : 1000) +
    20 * m.nose +
    10 * m.seamBad + 5 * m.seamMean +
    10 * m.motionBad + 200 * m.motionSum +
    2 * reach + (fill ? 0 : 0.5)
  );
}

const describe = (v) => `pixel visibili ${v.fill ? "dall'originale" : "dalla tavola"}, sovrapposizione ai raccordi ${Math.round(v.reach * 100)}%`;

/**
 * Import con scelta automatica. Stessi argomenti di importExplodedSheet.
 * @returns risultato di importExplodedSheet (della variante scelta) + selection:
 *   { version, chosen, reasons: string[], table: [{ label, score, ...misure }] }
 */
export function autoImportSheet(args, { fills = AUTO_FILLS, reaches = AUTO_REACHES } = {}) {
  const prof = PROFILES[args.profile] || PROFILES[DEFAULT_PROFILE];
  const variants = [];
  let lastError = null;
  for (const fill of fills) {
    // la prima scelta (pixel dall'originale) è già senza problemi: inutile il secondo import
    // (metà del tempo nel caso tipico)
    const clean = variants.find((v) => v.m.usable && !v.m.nose && !v.m.seamBad && !v.m.motionBad);
    if (clean) break;
    let base;
    try {
      base = importExplodedSheet({ ...args, fillFromOriginal: fill });
    } catch (e) {
      lastError = e;
      continue;
    }
    // sagome che non combaciano: uguale per entrambe le scelte di pixel, inutile il secondo import
    if (!base.usable || (base.assembly?.iou ?? 1) < SOURCE_IOU_MIN) {
      variants.push({ fill, reach: 0, base, pieces: base.pieces, underlay: [], m: { usable: !!base.usable, iou: base.assembly?.iou ?? null }, score: 1000 });
      break;
    }
    for (const reach of reaches) {
      const u = underlayJoints(base.pieces, { reach });
      const m = measureVariant(u.pieces, args.original, args.landmarks, base);
      variants.push({ fill, reach, base, pieces: u.pieces, underlay: u.changes, m, score: scoreVariant(m, { fill, reach }) });
    }
  }
  variants.sort((a, b) => a.score - b.score);
  const best = variants[0];
  // TAVOLA COME SORGENTE: la tavola non combacia con l'originale (personaggio ridisegnato,
  // sagome sovrapposte < SOURCE_IOU_MIN o tavola non utilizzabile): i pezzi della tavola si
  // montano fra loro (sheetSource.js) invece di essere rimessi sull'originale
  if (!best || !best.m.usable || (best.m.iou ?? 1) < SOURCE_IOU_MIN) return sheetSourceResult(args, best, lastError);
  // TAVOLA RIDISEGNATA ma "utilizzabile" solo per la sagoma (colori > 75): con una scala unica i
  // pezzi in scale diverse finiscono male (Jessica GPT con la posa dell'app: guanto sinistro
  // perso, capelli dentro testa e braccio). Si prova la registrazione pezzo per pezzo e si tiene
  // se ha TUTTI i ruoli e pochi buchi.
  const need = ["testa", "busto", "braccio_dx", "braccio_sx"];
  const lostBase = need.filter((n) => !best.pieces.some((p) => p.name === n));
  // solo se con la scala unica si PERDE un pezzo principale (la tavola di Jessica approvata,
  // ridisegnata ma completa, resta col metodo a scala unica: test autoSelect)
  if (lostBase.length && args.original && args.landmarks) {
    try {
      const r = registerSheetOnOriginal(args);
      const names = new Set(r.pieces.map((p) => p.name));
      if (need.every((n) => names.has(n)) && r.assembly.holeShare <= 0.01) {
        const out = registeredResult(args, r, best);
        out.selection.reasons.splice(1, 0, `Scelta rispetto alla scala unica: con una sola scala per tutta la tavola mancavano ${lostBase.join(", ")} (tavola con pezzi in scale diverse, colori ${best.base.fidelityError}).`);
        return out;
      }
    } catch (e) {
      /* resta la variante a scala unica */
    }
  }

  // perché: confronto con la migliore variante che differisce in ciascuna scelta
  const reasons = [`Scelta: ${describe(best)}.`];
  const altFill = variants.find((v) => v.fill !== best.fill);
  if (!altFill && fills.length > 1) reasons.push("Pixel dall'originale: nessuno scalino, naso integro: la variante con i pixel della tavola non è servita.");
  if (altFill)
    reasons.push(
      `Pixel ${best.fill ? "dall'originale" : "dalla tavola"}: scalini ai raccordi ${best.m.seamBad} contro ${altFill.m.seamBad}, naso ${best.m.nose ? "da controllare" : "ok"} contro ${altFill.m.nose ? "da controllare" : "ok"}.`
    );
  const altReach = variants.filter((v) => v.fill === best.fill && v.reach !== best.reach).sort((a, b) => a.score - b.score)[0];
  if (altReach)
    reasons.push(
      `Sovrapposizione ${Math.round(best.reach * 100)}%: raccordi con buchi in movimento ${best.m.motionBad} contro ${altReach.m.motionBad} (con ${Math.round(altReach.reach * 100)}%).`
    );
  if (best.underlay.length)
    reasons.push(`Sovrapposizione aggiunta: ${best.underlay.map((c) => `${c.into} sotto ${c.joint} (${c.added} px)`).join(", ")}.`);

  // avvisi: quelli del profilo ricalcolati sui pezzi scelti (la sovrapposizione li cambia)
  const old = new Set(best.base.profileChecks || []);
  const warnings = best.base.warnings.filter((w) => !old.has(w));
  let profileChecks = best.base.profileChecks || [];
  if (prof.roles) {
    const { seamCheck, motionCheck } = TB;
    profileChecks = [...noseCheck(best.pieces, args.original, args.landmarks?.[LM.nose]), ...seamCheck(best.pieces, args.original), ...motionCheck(best.pieces, args.original)];
    warnings.push(...profileChecks);
  }
  return {
    ...best.base,
    pieces: best.pieces,
    warnings,
    profileChecks,
    selection: {
      version: AUTO_RULES_VERSION,
      chosen: { fill: best.fill, reach: best.reach },
      reasons,
      table: variants.map((v) => ({ label: describe(v), score: +v.score.toFixed(2), ...v.m }))
    }
  };
}

import * as TB from "./testaBustoCheck.js";
import { motionCheck } from "./testaBustoCheck.js";

/**
 * Tavola ridisegnata: PRIMA si prova a rimettere ogni pezzo sull'originale con la sua scala
 * (sheetRegister.js: pezzi della tavola, posizione/misura/pixel visibili dell'originale); solo se
 * non riesce (ruoli mancanti, buchi) si monta la tavola come sorgente (sheetSource.js).
 */
function sheetSourceResult(args, best, lastError) {
  if (args.original && args.landmarks) {
    try {
      const r = registerSheetOnOriginal(args);
      const names = r.pieces.map((p) => p.name);
      if (names.includes("testa") && names.includes("busto") && r.assembly.holeShare <= 0.01) return registeredResult(args, r, best);
    } catch (e) {
      /* si passa al montaggio */
    }
  }
  return assembledResult(args, best, lastError);
}

function registeredResult(args, r, best) {
  const variants = AUTO_REACHES.map((reach) => {
    const u = underlayJoints(r.pieces, { reach });
    const motion = motionStats(u.pieces, args.original);
    const m = { usable: true, iou: r.assembly.iou, nose: 0, seamBad: 0, seamMean: 0, motionBad: motion.filter((x) => x.share > MOTION_HOLE_MAX).length, motionSum: motion.reduce((s, x) => s + x.share, 0) };
    return { reach, pieces: u.pieces, underlay: u.changes, m, score: scoreVariant(m, { fill: true, reach }) };
  }).sort((x, y) => x.score - y.score);
  const v = variants[0];
  const reasons = [
    `Tavola ridisegnata (sagome ${best?.m?.iou != null ? Math.round(best.m.iou * 100) + "%" : "—"} con scala unica): ogni pezzo rimesso sull'originale con la SUA scala (${SHEET_REGISTER_VERSION}). Pezzi e zone nascoste dalla tavola, posizione, misura e pixel visibili dall'originale.`,
    `Scale dei pezzi: ${Object.entries(r.scales).map(([n, k]) => `${n} ×${k}`).join(", ")}.`,
    `Sovrapposizione ai raccordi ${Math.round(v.reach * 100)}%: raccordi con buchi in movimento ${v.m.motionBad}.`
  ];
  const profileChecks = motionCheck(v.pieces, args.original);
  return {
    pieces: v.pieces, mode: "sheet-registered", scale: 1, front: [], bg: null,
    warnings: [...r.warnings, ...profileChecks],
    fidelityError: best?.base?.fidelityError ?? null, faithful: false, usable: true, assembly: r.assembly,
    piecesOk: true, pieceChecks: [], profileChecks, handObjects: [], finishing: { version: null, rules: [], changes: [] },
    selection: {
      version: AUTO_RULES_VERSION, chosen: { mode: "sheet-registered", reach: v.reach }, reasons,
      table: variants.map((x) => ({ label: `pezzi registrati uno per uno, sovrapposizione ${Math.round(x.reach * 100)}%`, score: +x.score.toFixed(2), ...x.m }))
    }
  };
}

/** Risultato in modalità "tavola come sorgente", nello stesso formato di importExplodedSheet. */
function assembledResult(args, best, lastError) {
  // proporzioni dall'originale: punti della posa e altezza della sagoma
  let silhouetteHeight = null;
  if (args.original) {
    const fg = foregroundMask(args.original), W = args.original.width;
    let y0 = Infinity, y1 = -1;
    for (let i = 0; i < fg.length; i++) if (fg[i]) { const y = (i / W) | 0; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (y1 > y0) silhouetteHeight = y1 - y0 + 1;
  }
  const a = assembleFromSheet(args.sheet, { ref: args.landmarks || silhouetteHeight ? { landmarks: args.landmarks, silhouetteHeight } : null });
  const canvas = { width: a.width, height: a.height };
  const variants = AUTO_REACHES.map((reach) => {
    const u = underlayJoints(a.pieces, { reach });
    const motion = motionStats(u.pieces, canvas);
    const m = { usable: true, iou: null, nose: 0, seamBad: 0, seamMean: 0, motionBad: motion.filter((x) => x.share > MOTION_HOLE_MAX).length, motionSum: motion.reduce((s, x) => s + x.share, 0) };
    return { reach, pieces: u.pieces, underlay: u.changes, m, score: scoreVariant(m, { fill: true, reach }) };
  }).sort((x, y) => x.score - y.score);
  const v = variants[0];
  const why = best
    ? `la tavola non combacia con l'originale (sagome sovrapposte ${best.m.iou != null ? Math.round(best.m.iou * 100) + "%" : "—"}${best.m.usable ? "" : ", posa o forme cambiate"})`
    : `la tavola non si ricompone sull'originale (${lastError?.message || "errore"})`;
  const reasons = [
    `Personaggio ridisegnato: ${why}. Montato dai pezzi della TAVOLA (${SHEET_SOURCE_VERSION}) con le PROPORZIONI dell'originale (occhi, braccia, altezza): disegno della tavola, misure dell'originale.`,
    `Sovrapposizione ai raccordi ${Math.round(v.reach * 100)}%: raccordi con buchi in movimento ${v.m.motionBad}.`
  ];
  if (v.underlay.length) reasons.push(`Sovrapposizione aggiunta: ${v.underlay.map((c) => `${c.into} sotto ${c.joint} (${c.added} px)`).join(", ")}.`);
  const profileChecks = motionCheck(v.pieces, canvas);
  return {
    pieces: v.pieces,
    canvas,
    mode: "sheet-source",
    scale: 1,
    front: [],
    bg: null,
    warnings: [`Personaggio ridisegnato: montato dai pezzi della tavola (controlla posizioni di viso, capelli e braccia).`, ...a.warnings, ...profileChecks],
    fidelityError: best?.base?.fidelityError ?? null,
    faithful: false,
    usable: true,
    assembly: null,
    piecesOk: true,
    pieceChecks: [],
    profileChecks,
    handObjects: [],
    finishing: { version: null, rules: [], changes: [] },
    selection: {
      version: AUTO_RULES_VERSION,
      chosen: { mode: "sheet-source", reach: v.reach },
      reasons,
      table: variants.map((x) => ({ label: `tavola come sorgente, sovrapposizione ${Math.round(x.reach * 100)}%`, score: +x.score.toFixed(2), ...x.m }))
    }
  };
}
