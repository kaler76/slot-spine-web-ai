import { useMemo, useRef } from "react";
import { useBackgroundAnimationLoop } from "../hooks/useBackgroundAnimationLoop.js";
import { anchorToFraction } from "../lib/characterSkeleton.js";
import { buildAmbientCharacterAnimation } from "../lib/characterAnimationTemplates.js";

/** Stessa logica di CharacterPage: risolve la posizione assoluta di una parte risalendo i genitori. */
function resolveAbsolutePosition(key, partsMap) {
  let x = 0;
  let y = 0;
  let current = key;
  const visited = new Set();
  while (current && partsMap[current] && !visited.has(current)) {
    visited.add(current);
    x += partsMap[current].offsetX;
    y += partsMap[current].offsetY;
    const parentKey = partsMap[current].parentKey;
    current = parentKey && parentKey !== "root" ? parentKey : null;
  }
  return { x, y };
}

/**
 * Compone e anima un Character intero (tutte le sue parti, con la stessa animazione
 * "ambient" calcolata live in CharacterPage) dentro un riquadro quadrato di lato `size`,
 * per poterlo mostrare come risultato di un rullo esattamente come un simbolo.
 */
export default function CharacterSprite({ character, size, playing }) {
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
      const abs = resolveAbsolutePosition(key, partsMap);
      minX = Math.min(minX, abs.x - p.width / 2);
      maxX = Math.max(maxX, abs.x + p.width / 2);
      minY = Math.min(minY, abs.y - p.height / 2);
      maxY = Math.max(maxY, abs.y + p.height / 2);
    }
    const boundsW = Math.max(maxX - minX, 10);
    const boundsH = Math.max(maxY - minY, 10);
    const scale = Math.min(size / boundsW, size / boundsH);
    return { scale, centerX: -minX, centerY: maxY, boundsW, boundsH };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderedKeysJoined, size]);

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

  useBackgroundAnimationLoop({ layerRefs: partRefsMap.current, animationsObj, playing });

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
        style={{ position: "absolute", left: boneLeft, top: boneTop, width: 0, height: 0, zIndex: p.zIndex }}
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
    <div style={{ width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: stageLayout.boundsW, height: stageLayout.boundsH, transform: `scale(${stageLayout.scale})`, position: "relative" }}>
        {rootKeys.map((key) => renderPartTree(key, true))}
      </div>
    </div>
  );
}
