import { buildAmbientAnimation } from "./backgroundAnimationTemplates.js";

/**
 * Costruisce lo skeleton Spine 4.1.x per un background multi-layer.
 * Ogni layer è un bone figlio diretto di root; l'ordine degli slot (che determina
 * l'ordine di disegno, dal fondo al primo piano) segue lo z_index crescente.
 * Tutti i layer vengono adattati alla stessa risoluzione canvas (canvasWidth/canvasHeight),
 * indipendentemente dalle dimensioni native del file caricato — così ogni layer
 * copre esattamente l'intero schermo/frame, come richiesto per il parallax.
 *
 * @param {Object} params
 * @param {Array<{layerKey, zIndex, animationType, speed}>} params.layers
 * @param {number} params.canvasWidth
 * @param {number} params.canvasHeight
 * @returns {Object} skeleton JSON pronto per l'export
 */
export function buildBackgroundSkeleton({ layers, canvasWidth, canvasHeight }) {
  const sorted = [...layers].sort((a, b) => a.zIndex - b.zIndex);

  const skeleton = {
    hash: randomHexId(16),
    spine: "4.1.24",
    x: 0,
    y: 0,
    width: canvasWidth,
    height: canvasHeight,
    images: "./images/",
    audio: ""
  };

  const bones = [{ name: "root" }];
  const slots = [];
  const attachments = {};

  for (const layer of sorted) {
    bones.push({ name: layer.layerKey, parent: "root", x: 0, y: 0 });
    slots.push({ name: layer.layerKey, bone: layer.layerKey, attachment: layer.layerKey });
    attachments[layer.layerKey] = {
      [layer.layerKey]: {
        type: "region",
        x: 0,
        y: 0,
        width: canvasWidth,
        height: canvasHeight,
        name: layer.layerKey
      }
    };
  }

  const skins = [{ name: "default", attachments }];
  const animations = buildAmbientAnimation(
    sorted.map((l) => ({ layerKey: l.layerKey, animationType: l.animationType, speed: l.speed }))
  );

  return { skeleton, bones, slots, skins, animations };
}

function randomHexId(byteLength) {
  const bytes = new Uint8Array(byteLength);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < byteLength; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
