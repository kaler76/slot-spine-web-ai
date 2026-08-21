/**
 * Template di animazione per un singolo layer di background. A differenza dei
 * simboli/character, qui non c'è idle/win: ogni layer ha UN loop ambientale
 * continuo, e più layer vengono combinati nella stessa timeline "ambient".
 */

function scaledDuration(baseDuration, speed) {
  const s = speed && speed > 0 ? speed : 1;
  return +(baseDuration / s).toFixed(4);
}

/** STATIC: nessun movimento, il layer resta fermo. */
function staticTrack() {
  return { bones: {} };
}

/**
 * PARALLAX-LOOP: deriva orizzontale lenta avanti/indietro (ping-pong).
 * Nota: non è uno scroll infinito reale (richiederebbe texture ripetuta/wrap),
 * ma una oscillazione orizzontale ampia che dà la sensazione di parallax.
 */
function parallaxLoopTrack(layerKey, speed, amplitude = 60) {
  const d = scaledDuration(6, speed);
  const half = +(d / 2).toFixed(4);
  return {
    bones: {
      [layerKey]: {
        translate: [
          { time: 0, x: -amplitude, y: 0 },
          { time: half, x: amplitude, y: 0 },
          { time: d, x: -amplitude, y: 0 }
        ]
      }
    }
  };
}

/** SWAY: leggera oscillazione verticale (es. nuvole, elementi fluttuanti). */
function swayTrack(layerKey, speed, amplitude = 15) {
  const d = scaledDuration(3.5, speed);
  const half = +(d / 2).toFixed(4);
  return {
    bones: {
      [layerKey]: {
        translate: [
          { time: 0, x: 0, y: 0 },
          { time: half, x: 0, y: amplitude },
          { time: d, x: 0, y: 0 }
        ]
      }
    }
  };
}

/** PULSE: pulsazione di luminosità/alpha (es. insegne, luci). */
function pulseTrack(layerKey, speed) {
  const d = scaledDuration(1.4, speed);
  const half = +(d / 2).toFixed(4);
  return {
    bones: {},
    slots: {
      [layerKey]: {
        rgba: [
          { time: 0, color: "ffffffff" },
          { time: half, color: "ffffff66" },
          { time: d, color: "ffffffff" }
        ]
      }
    }
  };
}

const TEMPLATES = {
  static: () => staticTrack(),
  parallaxLoop: (layerKey, speed) => parallaxLoopTrack(layerKey, speed),
  sway: (layerKey, speed) => swayTrack(layerKey, speed),
  pulse: (layerKey, speed) => pulseTrack(layerKey, speed)
};

export const AVAILABLE_LAYER_ANIMATION_TYPES = Object.keys(TEMPLATES);

export function buildLayerTrack(animationType, layerKey, speed = 1) {
  const fn = TEMPLATES[animationType];
  if (!fn) {
    throw new Error(
      `Tipo di animazione layer "${animationType}" non valido. Valori ammessi: ${AVAILABLE_LAYER_ANIMATION_TYPES.join(", ")}`
    );
  }
  return fn(layerKey, speed);
}

/**
 * Combina i track di più layer in un'unica timeline "ambient".
 * @param {Array<{layerKey: string, animationType: string, speed: number}>} layers
 */
export function buildAmbientAnimation(layers) {
  const bones = {};
  const slots = {};
  for (const { layerKey, animationType, speed } of layers) {
    const track = buildLayerTrack(animationType, layerKey, speed);
    if (track.bones) Object.assign(bones, track.bones);
    if (track.slots) Object.assign(slots, track.slots);
  }
  return { ambient: { bones, slots } };
}
