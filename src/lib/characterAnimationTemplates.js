/**
 * Template di animazione per una singola parte del character. Come per i layer
 * dei background, ogni parte ha UN tipo di movimento continuo scelto da un menu
 * a tendina, e più parti vengono combinate nella stessa timeline "ambient".
 */

function scaledDuration(baseDuration, speed) {
  const s = speed && speed > 0 ? speed : 1;
  return +(baseDuration / s).toFixed(4);
}

/** FERMO: nessun movimento. */
function staticTrack() {
  return { bones: {} };
}

/** OSCILLAZIONE: rotazione avanti/indietro (braccia, capelli, orecchini che dondolano). */
function swayTrack(partKey, speed, amplitude = 6) {
  const d = scaledDuration(2.2, speed);
  const half = +(d / 2).toFixed(4);
  return {
    bones: {
      [partKey]: {
        rotate: [
          { time: 0, angle: 0 },
          { time: half, angle: amplitude },
          { time: d, angle: 0 }
        ]
      }
    }
  };
}

/** RIMBALZO: piccolo movimento verticale su e giù (elementi che rimbalzano). */
function bounceTrack(partKey, speed, amplitude = 10) {
  const d = scaledDuration(1.1, speed);
  const half = +(d / 2).toFixed(4);
  return {
    bones: {
      [partKey]: {
        translate: [
          { time: 0, x: 0, y: 0 },
          { time: half, x: 0, y: amplitude },
          { time: d, x: 0, y: 0 }
        ]
      }
    }
  };
}

/** LAMPEGGIO: flash rapido — schiacciamento (utile per occhi) + variazione di luminosità/opacità (utile per luci, dettagli lucenti). */
function blinkTrack(partKey, speed) {
  const d = scaledDuration(2.6, speed);
  const t1 = +(d * 0.85).toFixed(4);
  const t2 = +(d * 0.89).toFixed(4);
  const t3 = +(d * 0.93).toFixed(4);
  return {
    bones: {
      [partKey]: {
        scale: [
          { time: 0, x: 1, y: 1 },
          { time: t1, x: 1, y: 1 },
          { time: t2, x: 1, y: 0.1 },
          { time: t3, x: 1, y: 1 },
          { time: d, x: 1, y: 1 }
        ]
      }
    },
    slots: {
      [partKey]: {
        rgba: [
          { time: 0, color: "ffffffff" },
          { time: t1, color: "ffffffff" },
          { time: t2, color: "ffffff33" },
          { time: t3, color: "ffffffff" },
          { time: d, color: "ffffffff" }
        ]
      }
    }
  };
}

/**
 * VENTO: oscillazione indipendente e leggera (più lenta e sottile della normale
 * Oscillazione), pensata per fare da "capobone" di una catena a più segmenti
 * (capelli lunghi, sciarpe, code) — è la tecnica della "rotazione semplice dei
 * bone" per dare vita a capelli/tessuti senza mesh con pesi: si anima da sola
 * (non serve un genitore già in movimento, a differenza di Fisica) e i
 * segmenti successivi della stessa catena la seguono a cascata via Fisica.
 */
function windTrack(partKey, speed, amplitude = 3.5) {
  const d = scaledDuration(3.6, speed);
  const half = +(d / 2).toFixed(4);
  return {
    bones: {
      [partKey]: {
        rotate: [
          { time: 0, angle: 0 },
          { time: half, angle: amplitude },
          { time: d, angle: 0 }
        ]
      }
    }
  };
}

/**
 * FISICA (pendolo a molla): a differenza degli altri tipi non produce una
 * traccia a keyframe — il movimento è simulato frame per frame da
 * useCharacterAnimationLoop (reagisce al movimento del bone genitore con
 * inerzia/molla, non segue una formula fissa). La traccia resta vuota qui
 * di proposito: serve solo perché "physics" compaia come tipo valido e per
 * l'export dello skeleton, che per ora esporta questo bone come statico
 * (la fisica è per ora solo un'anteprima live, non ancora nel pacchetto
 * Spine esportato).
 */
function physicsTrack() {
  return { bones: {} };
}

const TEMPLATES = {
  static: () => staticTrack(),
  sway: (partKey, speed) => swayTrack(partKey, speed),
  bounce: (partKey, speed) => bounceTrack(partKey, speed),
  blink: (partKey, speed) => blinkTrack(partKey, speed),
  wind: (partKey, speed) => windTrack(partKey, speed),
  physics: () => physicsTrack()
};

export const AVAILABLE_PART_ANIMATION_TYPES = Object.keys(TEMPLATES);

export function buildPartTrack(animationType, partKey, speed = 1) {
  const fn = TEMPLATES[animationType];
  if (!fn) {
    throw new Error(
      `Tipo di animazione parte "${animationType}" non valido. Valori ammessi: ${AVAILABLE_PART_ANIMATION_TYPES.join(", ")}`
    );
  }
  return fn(partKey, speed);
}

/**
 * Combina i track di più parti in un'unica timeline "ambient" (bones + slots colore).
 * @param {Array<{partKey: string, animationType: string, speed: number}>} parts
 */
export function buildAmbientCharacterAnimation(parts) {
  const bones = {};
  const slots = {};
  for (const { partKey, animationType, speed } of parts) {
    const track = buildPartTrack(animationType, partKey, speed);
    if (track.bones) Object.assign(bones, track.bones);
    if (track.slots) Object.assign(slots, track.slots);
  }
  return { ambient: { bones, ...(Object.keys(slots).length ? { slots } : {}) } };
}
