// src/lib/characterFromPieces.js — dai pezzi della tavola esplosa (explodedSheet.js) alle parti
// di un character (tabella character_parts, stesso formato di saveCharacterPart):
// osso nel pivot, offset relativo al genitore in coordinate Spine (y verso l'alto),
// ordine di disegno, ruolo e animazione di partenza. Puro e testabile: nessun DOM.

import { faceDefaults } from "./faceRig.js";
import { isHandObjectName } from "./handObject.js";

/** Ruolo (rigRules.PART_ROLES) e animazione di partenza per nome del pezzo. */
const DEFAULTS = {
  busto: { role: "torso", animationType: "static", speed: 1 },
  testa: { role: "head", animationType: "sway", speed: 0.6 },
  braccio_sx: { role: "arm", animationType: "sway", speed: 0.8 },
  braccio_dx: { role: "arm", animationType: "sway", speed: 0.8 },
  oggetto: { role: "accessory", animationType: "sway", speed: 0.7 }
};
const defaultsFor = (name) =>
  // mano + oggetto lungo (handObject.js): un solo blocco con pivot al polso, eredita il braccio
  (name.startsWith("presa_") || isHandObjectName(name) ? { role: "hand", animationType: "static", speed: 1 } :
    name.startsWith("copertura_") ? { role: "other", animationType: "static", speed: 1 } : null) ||
  DEFAULTS[name] || faceDefaults(name) || (name.startsWith("oggetto") ? DEFAULTS.oggetto : { role: "other", animationType: "static", speed: 1 });

/**
 * @param {Array} pieces - pezzi di importExplodedSheet (x,y,width,height,pivot,parent,order nel sistema dell'immagine)
 * @returns {{ parts: Array, origin: {x,y} }} parti pronte per saveCharacterPart (senza imageBlob)
 */
export function piecesToCharacterParts(pieces) {
  // il pivot può stare fuori dall'immagine del pezzo (es. oggetto tenuto in mano: osso sulla
  // mano) entro il vincolo pivot -1..2 di character_parts; oltre si porta al limite
  const lim = (v, a, size) => Math.min(a + 2 * size, Math.max(a - size, v));
  pieces = pieces.map((p) => ({
    ...p,
    pivot: { x: lim(p.pivot.x, p.x, p.width), y: lim(p.pivot.y, p.y, p.height) }
  }));
  const byName = Object.fromEntries(pieces.map((p) => [p.name, p]));
  const rootPiece = pieces.find((p) => !p.parent) || pieces[0];
  // origine del personaggio: centro in basso del pezzo radice (i piedi), come nei character esistenti
  const origin = { x: Math.round(rootPiece.x + rootPiece.width / 2), y: rootPiece.y + rootPiece.height };
  const parts = pieces.map((p) => {
    const parent = p.parent && byName[p.parent] ? byName[p.parent] : null;
    const ref = parent ? parent.pivot : origin;
    const d = defaultsFor(p.name);
    return {
      partKey: p.name,
      parentKey: parent ? parent.name : "root",
      width: p.width,
      height: p.height,
      // y verso l'alto (Spine): differenza invertita rispetto all'immagine
      offsetX: p.pivot.x - ref.x,
      offsetY: ref.y - p.pivot.y,
      zIndex: p.order,
      rotation: 0,
      segments: 1,
      anchorX: "center",
      anchorY: "center",
      pivotFx: +((p.pivot.x - p.x) / p.width).toFixed(4),
      pivotFy: +((p.pivot.y - p.y) / p.height).toFixed(4),
      role: d.role,
      animationType: p.motionLocked ? "static" : d.animationType,
      speed: d.speed
    };
  });
  return { parts, origin };
}
