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

/** Track "a tre chiavi" del singolo tipo (versione storica, durate diverse per parte). */
export function buildPartTrack(animationType, partKey, speed = 1) {
  const fn = TEMPLATES[animationType];
  if (!fn) {
    throw new Error(
      `Tipo di animazione parte "${animationType}" non valido. Valori ammessi: ${AVAILABLE_PART_ANIMATION_TYPES.join(", ")}`
    );
  }
  return fn(partKey, speed);
}

// ---------------------------------------------------------------- loop ambient v2
// Regole approvate sul folletto (2026-10-01, "PERFETTO"):
//  1. UN solo ciclo per tutte le parti (LOOP_SECONDS): ogni parte fa un numero intero di
//     oscillazioni nel ciclo, così il loop si chiude senza scatti (prima ogni parte aveva la
//     sua durata e le più corte restavano ferme fino alla fine della timeline).
//  2. Oscillazioni simmetriche attorno alla posa di riposo (sinusoide), campionate a SAMPLE_FPS.
//  3. Ampiezza per RUOLO: testa ±2.5°, braccio ±2°, braccio alzato (mano sopra la spalla:
//     pivot nella metà bassa dell'immagine) = saluto ±9° con 2 oscillazioni, oggetto ±3.5°
//     in ritardo sul braccio (peso), altre parti ±3°. Vento: metà ampiezza, ciclo intero.
//  4. Fase diversa per parte (non si muove tutto all'unisono).
export const LOOP_SECONDS = 4;
export const SAMPLE_FPS = 15;
export const AMBIENT_RULES_VERSION = "2026-10-01.v2";

const ROLE_SWAY = { head: 2.5, arm: 2, forearm: 2, hand: 3, accessory: 3.5, headdress: 2, hair: 3, earring: 4 };
const ROLE_PHASE = { head: 0, arm: 1.2, forearm: 1.6, hand: 2.0, accessory: 2.0, headdress: 0.3, hair: 0.8, earring: 2.4 };

function hashPhase(key) {
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return ((h % 628) / 100);
}

/** Braccio alzato (saluto): il pivot (spalla) sta nella metà bassa dell'immagine del braccio. */
export function isRaisedArm(part) {
  return (part.role === "arm" || part.role === "forearm") && Number.isFinite(Number(part.pivotFy)) && part.pivotFy !== null && Number(part.pivotFy) >= 0.5;
}

/** Numero intero di cicli nel loop per una parte con periodo "naturale" base/speed. */
function cyclesIn(baseSeconds, speed) {
  const period = baseSeconds / (speed && speed > 0 ? speed : 1);
  return Math.max(1, Math.round(LOOP_SECONDS / period));
}

function sampled(fn) {
  const n = Math.round(LOOP_SECONDS * SAMPLE_FPS);
  const out = [];
  for (let k = 0; k <= n; k++) {
    const t = k / SAMPLE_FPS;
    out.push({ time: +t.toFixed(4), ...fn(t) });
  }
  return out;
}

/**
 * Traccia v2 di una parte (stesso formato delle tracce storiche: rotate con "angle",
 * convertito in "value" solo all'export da spineFormat.toSpine41).
 */
export function buildLoopTrack(part) {
  const { partKey, animationType, speed, role } = part;
  const phase = role && ROLE_PHASE[role] !== undefined ? ROLE_PHASE[role] : hashPhase(partKey);
  const w = (2 * Math.PI) / LOOP_SECONDS;
  if (animationType === "sway" || animationType === "wind") {
    let amp = role && ROLE_SWAY[role] !== undefined ? ROLE_SWAY[role] : 3;
    let n = animationType === "wind" ? 1 : cyclesIn(4, speed);
    if (animationType === "wind") amp = amp / 2;
    if (animationType === "sway" && isRaisedArm(part)) {
      amp = 9;
      n = Math.max(2, n);
    }
    return { bones: { [partKey]: { rotate: sampled((t) => ({ angle: +(amp * Math.sin(n * w * t + phase)).toFixed(3) })) } } };
  }
  if (animationType === "bounce") {
    const n = cyclesIn(1.1, speed);
    return {
      bones: { [partKey]: { translate: sampled((t) => ({ x: 0, y: +(5 * (1 - Math.cos(n * w * t + 0))).toFixed(3) })) } }
    };
  }
  if (animationType === "blink") {
    // lampeggio breve ripetuto un numero intero di volte nel ciclo
    const n = cyclesIn(2.6, speed);
    const d = LOOP_SECONDS / n;
    const scale = [], rgba = [];
    for (let c = 0; c < n; c++) {
      const t0 = c * d;
      // occhio: trasparenza PIENA a occhio chiuso, così si vede la palpebra dipinta sulla testa
      // (folletto con viso, approvato 2 ott: "palpebre fantastico"); luci e dettagli: 20%
      const shut = role === "eye" ? "ffffff00" : "ffffff33";
      for (const [f, sy, col] of [[0, 1, "ffffffff"], [0.85, 1, "ffffffff"], [0.89, 0.1, shut], [0.93, 1, "ffffffff"]]) {
        scale.push({ time: +(t0 + f * d).toFixed(4), x: 1, y: sy });
        rgba.push({ time: +(t0 + f * d).toFixed(4), color: col });
      }
    }
    scale.push({ time: LOOP_SECONDS, x: 1, y: 1 });
    rgba.push({ time: LOOP_SECONDS, color: "ffffffff" });
    return { bones: { [partKey]: { scale } }, slots: { [partKey]: { rgba } } };
  }
  return { bones: {} }; // static, physics (simulata nell'anteprima)
}

/**
 * Combina le parti in un'unica timeline "ambient" con ciclo comune (vedi regole sopra).
 * @param {Array<{partKey: string, animationType: string, speed: number, role?: string, pivotFy?: number}>} parts
 */
export function buildAmbientCharacterAnimation(parts) {
  const bones = {};
  const slots = {};
  let animated = false;
  for (const part of parts) {
    if (!TEMPLATES[part.animationType]) buildPartTrack(part.animationType, part.partKey, part.speed); // stesso errore di prima
    const track = buildLoopTrack(part);
    if (track.bones) Object.assign(bones, track.bones);
    if (track.slots) Object.assign(slots, track.slots);
    if (Object.keys(track.bones || {}).length) animated = true;
  }
  // chiave finta sulla radice: la timeline dura sempre LOOP_SECONDS anche se nessuna parte si muove
  if (!animated) bones.root = { rotate: [{ time: 0, angle: 0 }, { time: LOOP_SECONDS, angle: 0 }] };
  return { ambient: { bones, ...(Object.keys(slots).length ? { slots } : {}) } };
}
