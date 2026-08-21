/**
 * Template di animazione parametrici per simboli slot machine.
 * Ogni funzione riceve:
 *   - boneName: nome del bone principale del simbolo
 *   - slotName: nome dello slot (per animare l'attachment / colore, es. glow)
 *   - speed: moltiplicatore di velocità (1 = normale, 2 = doppia velocità, 0.5 = metà velocità)
 * e ritorna un oggetto "animation" nel formato Spine 4.1
 * (chiavi: bones / slots -> nome bone/slot -> tipo timeline -> keyframe[])
 *
 * Le durate BASE sono pensate per essere moltiplicate da 1/speed:
 * più alto è "speed", più corta è la durata (animazione più rapida).
 */

function scaledDuration(baseDuration, speed) {
  const s = speed && speed > 0 ? speed : 1;
  return +(baseDuration / s).toFixed(4);
}

/**
 * IDLE: leggero respiro/bounce continuo, loop.
 */
export function idleAnimation(boneName, speed = 1) {
  const d = scaledDuration(1.6, speed);
  const half = +(d / 2).toFixed(4);
  return {
    bones: {
      [boneName]: {
        scale: [
          { time: 0, x: 1, y: 1 },
          { time: half, x: 1.04, y: 1.04 },
          { time: d, x: 1, y: 1 }
        ],
        translate: [
          { time: 0, x: 0, y: 0 },
          { time: half, x: 0, y: 4 },
          { time: d, x: 0, y: 0 }
        ]
      }
    }
  };
}

/**
 * WIN: pulsazione decisa + glow (alpha) sullo slot, non in loop (one-shot, poi si può fare loop lato runtime).
 */
export function winAnimation(boneName, slotName, speed = 1) {
  const d = scaledDuration(0.8, speed);
  const t1 = +(d * 0.25).toFixed(4);
  const t2 = +(d * 0.5).toFixed(4);
  const t3 = +(d * 0.75).toFixed(4);
  return {
    bones: {
      [boneName]: {
        scale: [
          { time: 0, x: 1, y: 1 },
          { time: t1, x: 1.18, y: 1.18 },
          { time: t2, x: 0.95, y: 0.95 },
          { time: t3, x: 1.08, y: 1.08 },
          { time: d, x: 1, y: 1 }
        ],
        rotate: [
          { time: 0, angle: 0 },
          { time: t1, angle: -4 },
          { time: t2, angle: 4 },
          { time: d, angle: 0 }
        ]
      }
    },
    slots: {
      [slotName]: {
        rgba: [
          { time: 0, color: "ffffffff" },
          { time: t1, color: "ffffccff" },
          { time: t2, color: "ffffffff" },
          { time: t3, color: "ffffccff" },
          { time: d, color: "ffffffff" }
        ]
      }
    }
  };
}

/**
 * SPIN-BLUR: simula il blur da rotazione veloce dei reel tramite squash orizzontale
 * rapido + leggero shear (rotazione alternata), pensata per essere in loop mentre il reel gira.
 */
export function spinBlurAnimation(boneName, speed = 1) {
  const d = scaledDuration(0.25, speed);
  const half = +(d / 2).toFixed(4);
  return {
    bones: {
      [boneName]: {
        scale: [
          { time: 0, x: 1, y: 1 },
          { time: half, x: 0.7, y: 1.15 },
          { time: d, x: 1, y: 1 }
        ]
      }
    },
    slots: {}
  };
}

/**
 * LAND: "atterraggio" del simbolo dopo lo stop del reel (squash & stretch), one-shot.
 */
export function landAnimation(boneName, speed = 1) {
  const d = scaledDuration(0.4, speed);
  const t1 = +(d * 0.35).toFixed(4);
  const t2 = +(d * 0.65).toFixed(4);
  return {
    bones: {
      [boneName]: {
        scale: [
          { time: 0, x: 1, y: 1 },
          { time: t1, x: 1.25, y: 0.75 },
          { time: t2, x: 0.9, y: 1.08 },
          { time: d, x: 1, y: 1 }
        ],
        translate: [
          { time: 0, x: 0, y: -30 },
          { time: t1, x: 0, y: 0 },
          { time: d, x: 0, y: 0 }
        ]
      }
    }
  };
}

const TEMPLATES = {
  idle: (boneName, slotName, speed) => idleAnimation(boneName, speed),
  win: (boneName, slotName, speed) => winAnimation(boneName, slotName, speed),
  spinBlur: (boneName, slotName, speed) => spinBlurAnimation(boneName, speed),
  land: (boneName, slotName, speed) => landAnimation(boneName, speed)
};

export const AVAILABLE_ANIMATION_TYPES = Object.keys(TEMPLATES);

/**
 * Genera l'oggetto "animations" completo per lo skeleton Spine, con il nome
 * dell'animazione richiesta come chiave (es. { "win": {...} }).
 */
export function buildAnimation(animationType, boneName, slotName, speed = 1) {
  const fn = TEMPLATES[animationType];
  if (!fn) {
    throw new Error(
      `Tipo di animazione "${animationType}" non valido. Valori ammessi: ${AVAILABLE_ANIMATION_TYPES.join(", ")}`
    );
  }
  return { [animationType]: fn(boneName, slotName, speed) };
}
