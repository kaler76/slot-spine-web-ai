import { buildAmbientCharacterAnimation } from "./characterAnimationTemplates.js";

/**
 * Converte un punto di ancoraggio (left/center/right, top/center/bottom) nella
 * frazione 0..1 corrispondente all'interno del riquadro dell'immagine.
 * 0 = bordo sinistro/superiore, 0.5 = centro, 1 = bordo destro/inferiore.
 */
export function anchorToFraction(anchorX, anchorY) {
  const fracX = anchorX === "left" ? 0 : anchorX === "right" ? 1 : 0.5;
  const fracY = anchorY === "top" ? 0 : anchorY === "bottom" ? 1 : 0.5;
  return { fracX, fracY };
}

/**
 * Costruisce lo skeleton Spine 4.1.x multi-bone per un character con parti libere.
 * Il bone di ciascuna parte è posizionato nel punto di ancoraggio scelto (non più
 * sempre al centro dell'immagine): questo è il "cardine" attorno a cui ruotano
 * le animazioni (es. un orecchino che dondola dall'alto come un pendolo).
 *
 * @param {Object} params
 * @param {Array<{partKey, parentKey, width, height, offsetX, offsetY, rotation, zIndex, animationType, speed, anchorX, anchorY}>} params.parts
 * @returns {Object} skeleton JSON pronto per l'export
 */
export function buildCharacterSkeleton({ parts }) {
  const partKeys = parts.map((p) => p.partKey);
  const sorted = [...parts].sort((a, b) => a.zIndex - b.zIndex);

  const bodyLike = parts.find((p) => p.parentKey === "root") || parts[0] || { width: 300, height: 400 };

  const skeleton = {
    hash: randomHexId(16),
    spine: "4.1.24",
    x: 0,
    y: 0,
    width: bodyLike.width,
    height: bodyLike.height,
    images: "./images/",
    audio: ""
  };

  const bones = [{ name: "root" }];
  const slots = [];
  const attachments = {};

  for (const part of sorted) {
    // Se il genitore dichiarato non è tra le parti presenti, aggancia a "root"
    // per evitare un riferimento a un bone inesistente.
    const parent = part.parentKey === "root" || partKeys.includes(part.parentKey) ? part.parentKey : "root";
    bones.push({
      name: part.partKey,
      parent,
      x: part.offsetX || 0,
      y: part.offsetY || 0,
      rotation: part.rotation || 0
    });
    slots.push({ name: part.partKey, bone: part.partKey, attachment: part.partKey });

    // L'offset dell'attachment rispetto al bone determina dove sta il "cardine":
    // di default (centro) l'immagine è centrata sul bone, come prima. Con un
    // ancoraggio diverso (es. "alto"), l'immagine viene disegnata spostata in
    // modo che il bone coincida col bordo scelto invece che col centro.
    const { fracX, fracY } = anchorToFraction(part.anchorX, part.anchorY);
    const attachX = part.width * (0.5 - fracX);
    const attachY = part.height * (fracY - 0.5);

    attachments[part.partKey] = {
      [part.partKey]: {
        type: "region",
        x: attachX,
        y: attachY,
        width: part.width,
        height: part.height,
        name: part.partKey
      }
    };
  }

  const skins = [{ name: "default", attachments }];
  const animations = buildAmbientCharacterAnimation(
    sorted.map((p) => ({ partKey: p.partKey, animationType: p.animationType, speed: p.speed }))
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
