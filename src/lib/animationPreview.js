export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function sampleTrack(track, time, propKeys, defaults) {
  if (!track || track.length === 0) return defaults;
  if (time <= track[0].time) return { ...defaults, ...track[0] };
  const last = track[track.length - 1];
  if (time >= last.time) return { ...defaults, ...last };

  for (let i = 0; i < track.length - 1; i++) {
    const a = track[i];
    const b = track[i + 1];
    if (time >= a.time && time <= b.time) {
      const span = b.time - a.time;
      const t = span > 0 ? (time - a.time) / span : 0;
      const out = {};
      for (const key of propKeys) {
        const av = a[key] !== undefined ? a[key] : defaults[key];
        const bv = b[key] !== undefined ? b[key] : defaults[key];
        out[key] = lerp(av, bv, t);
      }
      return out;
    }
  }
  return defaults;
}

export function hexToRgb(hex) {
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);
  return { r, g, b };
}

export function sampleColor(track, time) {
  if (!track || track.length === 0) return null;
  let closest = track[0];
  for (const kf of track) {
    if (kf.time <= time) closest = kf;
  }
  return closest.color;
}

export function totalDuration(boneTrack) {
  let max = 0;
  for (const key of ["scale", "translate", "rotate"]) {
    const arr = boneTrack?.[key];
    if (arr && arr.length) max = Math.max(max, arr[arr.length - 1].time);
  }
  return max || 1;
}

/**
 * Calcola lo stile CSS (transform + filter) da applicare all'immagine del simbolo
 * per il frame corrente, dato l'oggetto "animations.<tipo>" prodotto dal generatore.
 */
export function computeFrameStyle(animationEntry, boneName, slotName, elapsedSeconds) {
  const boneTrack = animationEntry?.bones?.[boneName] || {};
  const slotTrack = animationEntry?.slots?.[slotName] || {};

  const scale = sampleTrack(boneTrack.scale, elapsedSeconds, ["x", "y"], { x: 1, y: 1 });
  const translate = sampleTrack(boneTrack.translate, elapsedSeconds, ["x", "y"], { x: 0, y: 0 });
  const rotate = sampleTrack(boneTrack.rotate, elapsedSeconds, ["angle"], { angle: 0 });

  const transform = `translate(${translate.x}px, ${-translate.y}px) rotate(${-rotate.angle}deg) scale(${scale.x}, ${scale.y})`;

  const colorHex = sampleColor(slotTrack.rgba, elapsedSeconds);
  let filter = "";
  if (colorHex && colorHex.toLowerCase() !== "ffffffff") {
    const { r, g, b } = hexToRgb(colorHex);
    filter = `drop-shadow(0 0 14px rgba(${r},${g},${b},0.85)) brightness(1.08)`;
  }

  return { transform, filter };
}
