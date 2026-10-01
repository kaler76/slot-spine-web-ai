import { useLayoutEffect, useRef } from "react";
import { sampleTrack, sampleColor, hexToRgb, totalDuration } from "../lib/animationPreview.js";

// Costanti base della simulazione a "speed" (responsività) = 1: rigidezza della
// molla che riporta il bone verso la sua rotazione di riposo, smorzamento che
// dissipa l'energia, e quanto dell'ACCELERAZIONE angolare del genitore si
// trasferisce come spinta inerziale al pezzo agganciato — l'accelerazione (non
// la velocità) è la grandezza fisicamente corretta per l'inerzia: un pendolo
// appeso a un braccio che gira a velocità costante non subisce alcuna spinta,
// solo quando il braccio ACCELERA o FRENA il pendolo viene "tirato" e reagisce
// con ritardo prima di riassestarsi sulla posa di riposo.
const PHYSICS_BASE_STIFFNESS = 40;
const PHYSICS_BASE_DAMPING = 6;
const PHYSICS_DRIVE_GAIN = 3;
const MAX_DT = 0.05; // clamp per evitare salti enormi dopo un cambio tab/freeze del browser

const IDENTITY = [1, 0, 0, 1, 0, 0];

/**
 * Matrice locale di un bone nello spazio schermo (y verso il basso), formato CSS
 * matrix(a, b, c, d, e, f): T(offset) · T(traslazione animata) · R(-angolo) · S(scala).
 * Stessa composizione che prima faceva il DOM annidato (left/top = offset, poi
 * transform = translate · rotate · scale), ora calcolata esplicitamente.
 */
function localMatrix(p, translate, angleDeg, scale) {
  const rad = (-angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [
    cos * scale.x,
    sin * scale.x,
    -sin * scale.y,
    cos * scale.y,
    (p.offsetX || 0) + translate.x,
    -(p.offsetY || 0) - translate.y
  ];
}

function multiply(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5]
  ];
}

const toCss = (m) => `matrix(${m.map((v) => +v.toFixed(5)).join(", ")})`;

/**
 * Motore di animazione unificato per un character: a differenza di
 * useBackgroundAnimationLoop (stateless, campiona una traccia a keyframe in
 * base al tempo trascorso) questo hook elabora i bone in ordine gerarchico
 * (genitori prima dei figli) ad ogni frame, perché i bone con animationType
 * "physics" hanno bisogno di conoscere la rotazione GIÀ CALCOLATA in questo
 * stesso frame del proprio genitore per simulare l'inerzia — cosa che una
 * traccia a keyframe indipendente per bone non può fare.
 *
 * Le parti sono renderizzate "piatte" (tutte sorelle, ordinate per zIndex come
 * gli slot di Spine): ogni frame si calcola la trasformazione MONDO di ogni bone
 * componendo quella del genitore con la locale, e la si applica come matrix().
 * Così un figlio può stare dietro a un'altra parte anche se il genitore è davanti
 * (es. capelli figli della testa ma dietro al busto), esattamente come in Spine —
 * cosa impossibile con il DOM annidato, dove i figli ereditano lo stacking del genitore.
 *
 * @param {Array<{key, parentKey, rotation, animationType, speed, offsetX, offsetY}>} parts
 * @param {Object} layerRefs - { [key]: ref } sugli elementi DOM (piatti) di ogni parte
 * @param {Object} animationsObj - { ambient: { bones, slots } } da buildAmbientCharacterAnimation
 * @param {boolean} playing
 */
export function useCharacterAnimationLoop({ parts, layerRefs, animationsObj, playing }) {
  const frameRef = useRef(null);
  const lastTimeRef = useRef(null);
  const startRef = useRef(null);
  const physicsStateRef = useRef({});

  const entry = animationsObj?.ambient;
  const duration =
    Math.max(
      ...Object.values(entry?.bones || {}).map((track) => totalDuration(track)),
      ...Object.values(entry?.slots || {}).map((track) => {
        const rgba = track?.rgba;
        return rgba && rgba.length ? rgba[rgba.length - 1].time : 0;
      }),
      0.001
    ) || 1;

  const depsKey = parts
    .map((p) => `${p.key}:${p.parentKey}:${p.rotation}:${p.animationType}:${p.speed}:${p.offsetX}:${p.offsetY}`)
    .join(",");

  useLayoutEffect(() => {
    const partsByKey = {};
    for (const p of parts) partsByKey[p.key] = p;

    // Ordine topologico (genitori prima dei figli), partendo dalle radici —
    // così quando si elabora un bone "physics" il genitore ha già il suo
    // angolo di questo frame pronto in currentAngle.
    const order = [];
    const visited = new Set();
    const roots = parts.filter((p) => !p.parentKey || p.parentKey === "root" || !partsByKey[p.parentKey]);
    const queue = roots.map((p) => p.key);
    while (queue.length) {
      const k = queue.shift();
      if (visited.has(k)) continue;
      visited.add(k);
      order.push(k);
      for (const p of parts) {
        if (p.parentKey === k && !visited.has(p.key)) queue.push(p.key);
      }
    }
    for (const p of parts) if (!visited.has(p.key)) order.push(p.key); // fallback, non dovrebbe servire

    if (frameRef.current) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }

    const parentWorld = (p, world) =>
      p.parentKey && p.parentKey !== "root" && world[p.parentKey] ? world[p.parentKey] : IDENTITY;

    if (!playing) {
      const world = {};
      for (const key of order) {
        const p = partsByKey[key];
        if (!p) continue;
        world[key] = multiply(parentWorld(p, world), localMatrix(p, { x: 0, y: 0 }, p.rotation || 0, { x: 1, y: 1 }));
        const ref = layerRefs[key];
        if (!ref?.current) continue;
        ref.current.style.transform = toCss(world[key]);
        ref.current.style.filter = "";
      }
      // Da fermo si azzera anche lo stato della simulazione: alla ripartenza
      // il pendolo riparte dalla posa di riposo invece che dall'ultimo stato.
      physicsStateRef.current = {};
      return;
    }

    startRef.current = performance.now();
    lastTimeRef.current = startRef.current;

    function frame(now) {
      const dt = Math.min((now - lastTimeRef.current) / 1000, MAX_DT);
      lastTimeRef.current = now;
      const elapsed = ((now - startRef.current) / 1000) % duration;
      const currentAngle = {};
      const world = {};

      for (const key of order) {
        const p = partsByKey[key];
        if (!p) continue;
        const rest = p.rotation || 0;
        let angleDeg;
        let translate = { x: 0, y: 0 };
        let scale = { x: 1, y: 1 };
        let filter = "";

        if (p.animationType === "physics") {
          const parentAngle = p.parentKey && p.parentKey !== "root" ? currentAngle[p.parentKey] ?? 0 : 0;
          const state = (physicsStateRef.current[key] ||= {
            angle: rest,
            velocity: 0,
            parentAngle,
            parentVelocity: 0
          });
          const parentVelocity = dt > 0 ? (parentAngle - state.parentAngle) / dt : 0;
          const parentAccel = dt > 0 ? (parentVelocity - state.parentVelocity) / dt : 0;
          state.parentAngle = parentAngle;
          state.parentVelocity = parentVelocity;

          const responsiveness = p.speed && p.speed > 0 ? p.speed : 1;
          const stiffness = PHYSICS_BASE_STIFFNESS * responsiveness;
          const damping = PHYSICS_BASE_DAMPING * Math.sqrt(responsiveness);
          const springAccel = -stiffness * (state.angle - rest);
          const dampingAccel = -damping * state.velocity;
          const driveAccel = PHYSICS_DRIVE_GAIN * parentAccel;
          state.velocity += (springAccel + dampingAccel + driveAccel) * dt;
          state.angle += state.velocity * dt;
          angleDeg = state.angle;
        } else {
          const boneTrack = entry?.bones?.[key] || {};
          const slotTrack = entry?.slots?.[key] || {};
          const s = sampleTrack(boneTrack.scale, elapsed, ["x", "y"], { x: 1, y: 1 });
          const t = sampleTrack(boneTrack.translate, elapsed, ["x", "y"], { x: 0, y: 0 });
          const r = sampleTrack(boneTrack.rotate, elapsed, ["angle"], { angle: 0 });
          angleDeg = r.angle + rest;
          translate = t;
          scale = s;
          const colorHex = sampleColor(slotTrack.rgba, elapsed);
          if (colorHex && colorHex.toLowerCase() !== "ffffffff") {
            const { r: cr, g: cg, b: cb } = hexToRgb(colorHex);
            filter = `drop-shadow(0 0 14px rgba(${cr},${cg},${cb},0.85)) brightness(1.08)`;
          }
        }

        currentAngle[key] = angleDeg;
        world[key] = multiply(parentWorld(p, world), localMatrix(p, translate, angleDeg, scale));
        const ref = layerRefs[key];
        if (ref?.current) {
          ref.current.style.transform = toCss(world[key]);
          ref.current.style.filter = filter;
        }
      }

      frameRef.current = requestAnimationFrame(frame);
    }
    frameRef.current = requestAnimationFrame(frame);

    return () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, entry, duration, depsKey]);

  return { duration };
}
