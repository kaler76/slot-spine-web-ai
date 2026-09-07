import { useMemo, useRef } from "react";
import { useBackgroundAnimationLoop } from "../hooks/useBackgroundAnimationLoop.js";
import { anchorToFraction } from "../lib/characterSkeleton.js";
import { buildAmbientCharacterAnimation } from "../lib/characterAnimationTemplates.js";

/** Stessa logica di CharacterPage: risolve posizione+rotazione cumulata di una parte risalendo i genitori (vedi commento lì per i dettagli della convenzione y-up/antioraria). */
function resolveAbsoluteTransform(key, partsMap) {
  const chain = [];
  let current = key;
  const visited = new Set();
  while (current && partsMap[current] && !visited.has(current)) {
    visited.add(current);
    chain.unshift(current);
    const parentKey = partsMap[current].parentKey;
    current = parentKey && parentKey !== "root" ? parentKey : null;
  }
  let x = 0, y = 0, angleDeg = 0;
  for (const k of chain) {
    const p = partsMap[k];
    const rad = (angleDeg * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const ox = p.offsetX || 0;
    const oy = p.offsetY || 0;
    x += ox * cos - oy * sin;
    y += ox * sin + oy * cos;
    angleDeg += p.rotation || 0;
  }
  return { x, y, angleDeg };
}

/** Stessa logica di CharacterPage: le 4 estremità del rettangolo width×height dato l'ancoraggio, ruotate e traslate. */
function rotatedCorners({ x, y, angleDeg, width, height, fracX, fracY }) {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const localXs = [-width * fracX, width * (1 - fracX)];
  const localYs = [-height * (1 - fracY), height * fracY];
  const corners = [];
  for (const lx of localXs) {
    for (const ly of localYs) {
      corners.push({ x: x + lx * cos - ly * sin, y: y + lx * sin + ly * cos });
    }
  }
  return corners;
}

/**
 * Compone e anima un Character intero (tutte le sue parti, con la stessa animazione
 * "ambient" calcolata live in CharacterPage) dentro un riquadro largo `boxWidth` e alto
 * `boxHeight` (di norma uguali: una cella quadrata; diversi per i simboli "tall" che
 * occupano più righe di un rullo), per poterlo mostrare come risultato di un rullo
 * esattamente come un simbolo.
 */
export default function CharacterSprite({ character, boxWidth, boxHeight, playing }) {
  const partsMap = useMemo(() => {
    const map = {};
    for (const p of character.parts) {
      map[p.part_key] = {
        parentKey: p.parent_key || "root",
        width: p.width,
        height: p.height,
        offsetX: p.offset_x || 0,
        offsetY: p.offset_y || 0,
        zIndex: p.z_index || 0,
        animationType: p.animation_type || "static",
        speed: p.speed || 1,
        anchorX: p.anchor_x || "center",
        anchorY: p.anchor_y || "center",
        rotation: p.rotation || 0,
        url: p.image_url
      };
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [character.parts]);

  const orderedKeys = Object.keys(partsMap).sort((a, b) => partsMap[a].zIndex - partsMap[b].zIndex);
  const orderedKeysJoined = orderedKeys.join(",");

  const stageLayout = useMemo(() => {
    if (orderedKeys.length === 0) return { scale: 1, centerX: 0, centerY: 0, boundsW: 10, boundsH: 10 };
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const key of orderedKeys) {
      const p = partsMap[key];
      const abs = resolveAbsoluteTransform(key, partsMap);
      const { fracX, fracY } = anchorToFraction(p.anchorX, p.anchorY);
      const corners = rotatedCorners({ ...abs, width: p.width, height: p.height, fracX, fracY });
      for (const c of corners) {
        minX = Math.min(minX, c.x);
        maxX = Math.max(maxX, c.x);
        minY = Math.min(minY, c.y);
        maxY = Math.max(maxY, c.y);
      }
    }
    const boundsW = Math.max(maxX - minX, 10);
    const boundsH = Math.max(maxY - minY, 10);
    const scale = Math.min(boxWidth / boundsW, boxHeight / boundsH);
    return { scale, centerX: -minX, centerY: maxY, boundsW, boundsH };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderedKeysJoined, boxWidth, boxHeight]);

  const animationsObj = useMemo(
    () =>
      buildAmbientCharacterAnimation(
        orderedKeys.map((k) => ({ partKey: k, animationType: partsMap[k].animationType, speed: partsMap[k].speed }))
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orderedKeysJoined]
  );

  const partRefsMap = useRef({});
  for (const key of orderedKeys) {
    if (!partRefsMap.current[key]) partRefsMap.current[key] = { current: null };
  }

  const restRotationsKey = orderedKeys.map((k) => `${k}:${partsMap[k].rotation || 0}`).join(",");
  const restRotations = useMemo(
    () => Object.fromEntries(orderedKeys.map((k) => [k, partsMap[k].rotation || 0])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [restRotationsKey]
  );

  useBackgroundAnimationLoop({ layerRefs: partRefsMap.current, animationsObj, playing, restRotations });

  function effectiveParentOf(key) {
    const pk = partsMap[key]?.parentKey;
    return pk && pk !== "root" && partsMap[pk] ? pk : "root";
  }
  const rootKeys = orderedKeys.filter((k) => effectiveParentOf(k) === "root");

  function renderPartTree(key, isRoot) {
    const p = partsMap[key];
    const { fracX, fracY } = anchorToFraction(p.anchorX, p.anchorY);
    const boneLeft = isRoot ? stageLayout.centerX + (p.offsetX || 0) : p.offsetX || 0;
    const boneTop = isRoot ? stageLayout.centerY - (p.offsetY || 0) : -(p.offsetY || 0);
    const childKeys = orderedKeys
      .filter((k) => k !== key && effectiveParentOf(k) === key)
      .sort((a, b) => partsMap[a].zIndex - partsMap[b].zIndex);

    return (
      <div
        key={key}
        ref={partRefsMap.current[key]}
        style={{
          position: "absolute",
          left: boneLeft,
          top: boneTop,
          width: 0,
          height: 0,
          zIndex: p.zIndex,
          transform: p.rotation ? `rotate(${-p.rotation}deg)` : undefined
        }}
      >
        <img
          src={p.url}
          alt={key}
          style={{
            position: "absolute",
            left: -p.width * fracX,
            top: -p.height * fracY,
            width: p.width,
            height: p.height,
            transformOrigin: `${fracX * 100}% ${fracY * 100}%`
          }}
          draggable={false}
        />
        {childKeys.map((childKey) => renderPartTree(childKey, false))}
      </div>
    );
  }

  if (orderedKeys.length === 0) return null;

  return (
    <div style={{ width: boxWidth, height: boxHeight, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: stageLayout.boundsW, height: stageLayout.boundsH, transform: `scale(${stageLayout.scale})`, position: "relative" }}>
        {rootKeys.map((key) => renderPartTree(key, true))}
      </div>
    </div>
  );
}
