import { buildAnimation } from "./animationTemplates.js";

/**
 * Costruisce un file skeleton Spine 4.1.x completo per UN simbolo.
 * Versione browser: usa Web Crypto API invece del modulo "crypto" di Node.
 *
 * @param {Object} params
 * @param {string} params.symbolName - nome del simbolo (es. "cherry", "seven_gold")
 * @param {number} params.width - larghezza del simbolo in px (dimensione richiesta in output)
 * @param {number} params.height - altezza del simbolo in px
 * @param {string} params.animationType - "idle" | "win" | "spinBlur" | "land"
 * @param {number} params.speed - moltiplicatore velocità (1 = normale)
 * @returns {Object} oggetto JSON pronto per essere serializzato come skeleton.json
 */
export function buildSpineSkeleton({ symbolName, width, height, animationType, speed = 1 }) {
  const boneName = symbolName;
  const slotName = symbolName;
  const attachmentName = symbolName;

  const hash = randomHexId(16);

  const skeleton = {
    hash,
    spine: "4.1.24",
    x: 0,
    y: 0,
    width,
    height,
    images: "./images/",
    audio: ""
  };

  const bones = [
    { name: "root" },
    { name: boneName, parent: "root", x: 0, y: 0 }
  ];

  const slots = [
    { name: slotName, bone: boneName, attachment: attachmentName }
  ];

  const skins = [
    {
      name: "default",
      attachments: {
        [slotName]: {
          [attachmentName]: {
            type: "region",
            x: 0,
            y: 0,
            width,
            height,
            name: attachmentName
          }
        }
      }
    }
  ];

  const animations = buildAnimation(animationType, boneName, slotName, speed);

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
