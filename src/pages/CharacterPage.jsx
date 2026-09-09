import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import CropTool from "../components/CropTool.jsx";
import SpriteSheetImporter from "../components/SpriteSheetImporter.jsx";
import AiCharacterGenerator from "../components/AiCharacterGenerator.jsx";
import CharacterRotationEditor from "../components/CharacterRotationEditor.jsx";
import { useCharacterAnimationLoop } from "../hooks/useCharacterAnimationLoop.js";
import { buildCharacterSkeleton, anchorToFraction } from "../lib/characterSkeleton.js";
import { buildMultiPartAtlas } from "../lib/atlasBuilder.js";
import { AVAILABLE_PART_ANIMATION_TYPES } from "../lib/characterAnimationTemplates.js";
import {
  getCharacterWithDetails,
  saveCharacterPart,
  deleteCharacterPart,
  updateCharacterPartMetadata,
  saveCharacterExport
} from "../lib/charactersRepository.js";
import { downloadCharacterPackage } from "../lib/exportZip.js";

const ANIM_LABELS = {
  static: "⏸️ Fermo",
  sway: "🎐 Oscillazione",
  bounce: "⬆️ Rimbalzo",
  blink: "✨ Lampeggio",
  wind: "🌬️ Vento (capobone catena)",
  physics: "🔗 Fisica (pendolo)"
};

function sanitizeKey(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Risolve la trasformazione assoluta (posizione + rotazione cumulata) di una
 * parte risalendo la catena dei genitori — stesso spazio y-up di offsetX/Y
 * (positivo = su), con rotazione in convenzione Spine (antioraria positiva,
 * coerente coi gradi memorizzati). L'offset di ogni anello della catena va
 * ruotato dell'angolo accumulato FINO A QUEL PUNTO (il genitore), perché è
 * definito dentro il riferimento già ruotato del genitore — esattamente come
 * avviene nel DOM annidato. Serve per calcolare un bounding box dell'anteprima
 * che includa anche le parti ruotate, non solo la loro posizione non ruotata.
 */
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

/** Le 4 estremità (x,y) del rettangolo width×height dato l'ancoraggio, ruotate di angleDeg (antiorario, y-up) e traslate in (x,y). */
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

const SEGMENT_KEY_SEP = "__seg";

/**
 * Fase 3 (semplificata): una parte con animazione "Fisica" e più di 1
 * segmento viene sostituita da una CATENA di N sotto-bone sintetici (mai
 * salvati su DB, solo per il rendering e l'animazione): ognuno mostra 1/N
 * dell'immagine originale (una fascia orizzontale) ed è agganciato
 * fisicamente al segmento precedente della stessa catena, così il movimento
 * si propaga a cascata e il pezzo si PIEGA lungo la sua lunghezza invece di
 * ruotare come un blocco rigido unico — l'equivalente "leggero" di una mesh
 * con pesi, senza bisogno di un editor di vertici dedicato. Il primo segmento
 * mantiene la chiave/il genitore/la rotazione di riposo originali; dal
 * secondo in poi l'ancoraggio verticale è sempre "alto" (il segmento pende
 * dalla base di quello sopra) e la rotazione di riposo è 0 (a riposo la
 * catena resta dritta, ricostruendo l'immagine originale non deformata).
 */
function expandSegmentedParts(partsMap) {
  const expanded = {};
  const resolveParent = (pk) => (pk && pk !== "root" && partsMap[pk] ? pk : "root");

  for (const [key, p] of Object.entries(partsMap)) {
    const segments = Math.max(1, Math.round(p.segments) || 1);
    const isChainable = p.animationType === "physics" || p.animationType === "wind";
    if (segments <= 1 || !isChainable) {
      expanded[key] = { ...p, parentKey: resolveParent(p.parentKey), sliced: false };
      continue;
    }
    const bandHeight = p.height / segments;
    const segKeys = Array.from({ length: segments }, (_, i) => (i === 0 ? key : `${key}${SEGMENT_KEY_SEP}${i + 1}`));
    for (let i = 0; i < segments; i++) {
      expanded[segKeys[i]] = {
        ...p,
        parentKey: i === 0 ? resolveParent(p.parentKey) : segKeys[i - 1],
        rotation: i === 0 ? p.rotation || 0 : 0,
        offsetX: i === 0 ? p.offsetX : 0,
        offsetY: i === 0 ? p.offsetY : -bandHeight,
        anchorY: "top",
        width: p.width,
        height: bandHeight,
        fullHeight: p.height,
        cropTop: i * bandHeight,
        sliced: true,
        // Solo il primo segmento (il "capobone") mantiene il tipo scelto — se è
        // "Vento" si anima da solo; dal secondo in poi la catena segue sempre a
        // cascata via Fisica, altrimenti niente si muove (Fisica pura senza un
        // genitore animato resta ferma alla posa di riposo).
        animationType: i === 0 ? p.animationType : "physics",
        segments: 1
      };
    }
  }
  return expanded;
}

export default function CharacterPage() {
  const { id } = useParams();
  const [character, setCharacter] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // --- Form "aggiungi parte" ---
  const [partName, setPartName] = useState("");
  const [parentKey, setParentKey] = useState("root");
  const [file, setFile] = useState(null);
  const [workingBlob, setWorkingBlob] = useState(null);
  const [workingUrl, setWorkingUrl] = useState(null);
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [zIndex, setZIndex] = useState(0);
  const [rotation, setRotation] = useState(0);
  const [segments, setSegments] = useState(1);
  const [animationType, setAnimationType] = useState("static");
  const [anchorX, setAnchorX] = useState("center");
  const [anchorY, setAnchorY] = useState("center");
  const [partSpeed, setPartSpeed] = useState(1);
  const [savingPart, setSavingPart] = useState(false);
  const [status, setStatus] = useState("");

  const [isDraggingPart, setIsDraggingPart] = useState(false);
  const dragStartRef = useRef(null);

  const [playing, setPlaying] = useState(false);
  const [savingExport, setSavingExport] = useState(false);

  // --- Editing inline parti esistenti ---
  const [editingPartId, setEditingPartId] = useState(null);
  const [editValues, setEditValues] = useState({});
  const [savingEdit, setSavingEdit] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getCharacterWithDetails(id);
      setCharacter(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function resetAddForm() {
    setPartName("");
    // Genitore di default: l'ultima parte aggiunta (se esiste), invece di sempre
    // "root" — normalmente la prossima parte va agganciata a quella appena fatta
    // (es. dopo il corpo aggiungi la testa, dopo la testa aggiungi gli occhi).
    const lastPart = character?.parts?.[character.parts.length - 1];
    setParentKey(lastPart ? lastPart.part_key : "root");
    setFile(null);
    setWorkingBlob(null);
    setWorkingUrl(null);
    setWidth("");
    setHeight("");
    setOffsetX(0);
    setOffsetY(0);
    setZIndex((character?.parts.length || 0) * 10);
    setRotation(0);
    setSegments(1);
    setAnimationType("static");
    setPartSpeed(1);
    setAnchorX("center");
    setAnchorY("center");
  }

  function handleCropped(blob, w, h) {
    setWorkingBlob(blob);
    setWorkingUrl(URL.createObjectURL(blob));
    setWidth(w);
    setHeight(h);
    setFile(null);
  }

  function handlePartDragStart(e, mode) {
    e.preventDefault();
    setIsDraggingPart(true);
    const startOffsetX = mode === "editing" ? Number(editValues.offsetX) || 0 : Number(offsetX) || 0;
    const startOffsetY = mode === "editing" ? Number(editValues.offsetY) || 0 : Number(offsetY) || 0;
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      offsetX: startOffsetX,
      offsetY: startOffsetY,
      mode
    };
  }

  useEffect(() => {
    if (!isDraggingPart) return;
    function handleMouseMove(e) {
      const start = dragStartRef.current;
      if (!start) return;
      const s = stageLayout.stageScale || 1;
      const deltaX = (e.clientX - start.mouseX) / s;
      const deltaY = (e.clientY - start.mouseY) / s;
      const newX = Math.round(start.offsetX + deltaX);
      const newY = Math.round(start.offsetY - deltaY);
      if (start.mode === "editing") {
        setEditValues((v) => ({ ...v, offsetX: newX, offsetY: newY }));
      } else {
        setOffsetX(newX);
        setOffsetY(newY);
      }
    }
    function handleMouseUp() {
      setIsDraggingPart(false);
      dragStartRef.current = null;
    }
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDraggingPart]);

  async function handleSaveNewPart() {
    const key = sanitizeKey(partName);
    if (!key) {
      setStatus("⚠️ Dai un nome alla parte (es. orecchini, cappello, cicatrice).");
      return;
    }
    if (character.parts.some((p) => p.part_key === key)) {
      setStatus(`⚠️ Esiste già una parte chiamata "${key}". Scegli un altro nome, oppure modificala dall'elenco sopra.`);
      return;
    }
    if (!workingBlob) {
      setStatus("⚠️ Carica e ritaglia un'immagine per questa parte.");
      return;
    }
    setSavingPart(true);
    setStatus("⏳ Salvataggio parte in corso...");
    try {
      await saveCharacterPart({
        characterId: character.id,
        partKey: key,
        parentKey,
        imageBlob: workingBlob,
        width: Number(width),
        height: Number(height),
        offsetX: Number(offsetX),
        offsetY: Number(offsetY),
        zIndex: Number(zIndex) || 0,
        rotation: Number(rotation) || 0,
        segments: Number(segments) || 1,
        animationType,
        speed: Number(partSpeed) || 1,
        anchorX,
        anchorY
      });
      setStatus(`✅ Parte "${key}" salvata.`);
      resetAddForm();
      await refresh();
    } catch (err) {
      setStatus(`❌ Errore salvataggio parte: ${err.message}`);
    } finally {
      setSavingPart(false);
    }
  }

  async function handleDeletePart(partId, partKey) {
    if (!confirm(`Eliminare la parte "${partKey}"? Le parti che la usano come genitore verranno agganciate alla radice.`)) return;
    try {
      await deleteCharacterPart(partId);
      setStatus(`✅ Parte "${partKey}" eliminata.`);
      await refresh();
    } catch (err) {
      setStatus(`❌ Errore eliminazione parte: ${err.message}`);
    }
  }

  function startEditingPart(p) {
    setEditingPartId(p.id);
    setEditValues({
      width: p.width,
      height: p.height,
      offsetX: p.offset_x,
      offsetY: p.offset_y,
      zIndex: p.z_index ?? 0,
      rotation: p.rotation ?? 0,
      segments: p.segments ?? 1,
      parentKey: p.parent_key || "root",
      animationType: p.animation_type || "static",
      speed: p.speed ?? 1,
      anchorX: p.anchor_x || "center",
      anchorY: p.anchor_y || "center"
    });
  }

  function cancelEditingPart() {
    setEditingPartId(null);
  }

  async function saveEditingPart(partId, partKey) {
    setSavingEdit(true);
    setStatus(`⏳ Aggiornamento "${partKey}"...`);
    try {
      await updateCharacterPartMetadata(partId, {
        width: Number(editValues.width),
        height: Number(editValues.height),
        offsetX: Number(editValues.offsetX),
        offsetY: Number(editValues.offsetY),
        zIndex: Number(editValues.zIndex),
        rotation: Number(editValues.rotation) || 0,
        segments: Number(editValues.segments) || 1,
        parentKey: editValues.parentKey,
        animationType: editValues.animationType,
        speed: Number(editValues.speed) || 1,
        anchorX: editValues.anchorX,
        anchorY: editValues.anchorY
      });
      setStatus(`✅ "${partKey}" aggiornata.`);
      setEditingPartId(null);
      await refresh();
    } catch (err) {
      setStatus(`❌ Errore aggiornamento: ${err.message}`);
    } finally {
      setSavingEdit(false);
    }
  }

  // Mappa parti pronte per anteprima/generazione: quelle salvate + quella in editing (se presente)
  const previewPartsMap = useMemo(() => {
    if (!character) return {};
    const map = {};
    for (const p of character.parts) {
      const isBeingEdited = editingPartId === p.id;
      map[p.part_key] = isBeingEdited
        ? {
            width: Number(editValues.width) || p.width,
            height: Number(editValues.height) || p.height,
            offsetX: Number(editValues.offsetX) || 0,
            offsetY: Number(editValues.offsetY) || 0,
            zIndex: Number(editValues.zIndex) || 0,
            rotation: Number(editValues.rotation) || 0,
            segments: Number(editValues.segments) || 1,
            parentKey: editValues.parentKey || "root",
            animationType: editValues.animationType || "static",
            speed: Number(editValues.speed) || 1,
            anchorX: editValues.anchorX || "center",
            anchorY: editValues.anchorY || "center",
            url: p.image_url
          }
        : {
            width: p.width,
            height: p.height,
            offsetX: p.offset_x,
            offsetY: p.offset_y,
            zIndex: p.z_index ?? 0,
            rotation: p.rotation ?? 0,
            segments: p.segments ?? 1,
            parentKey: p.parent_key || "root",
            animationType: p.animation_type || "static",
            speed: p.speed ?? 1,
            anchorX: p.anchor_x || "center",
            anchorY: p.anchor_y || "center",
            url: p.image_url
          };
    }
    if (workingBlob && width && height) {
      const key = sanitizeKey(partName) || "__new__";
      map[key] = {
        width: Number(width),
        height: Number(height),
        offsetX: Number(offsetX),
        offsetY: Number(offsetY),
        zIndex: Number(zIndex) || 0,
        rotation: Number(rotation) || 0,
        segments: Number(segments) || 1,
        parentKey,
        animationType,
        speed: Number(partSpeed) || 1,
        anchorX,
        anchorY,
        url: workingUrl
      };
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    character,
    workingBlob,
    width,
    height,
    offsetX,
    offsetY,
    zIndex,
    rotation,
    segments,
    parentKey,
    animationType,
    partSpeed,
    partName,
    workingUrl,
    anchorX,
    anchorY,
    editingPartId,
    editValues
  ]);

  const orderedPartKeys = Object.keys(previewPartsMap).sort(
    (a, b) => previewPartsMap[a].zIndex - previewPartsMap[b].zIndex
  );
  const hasAnyPart = orderedPartKeys.length > 0;

  // Parti con animazione "Fisica" e più di 1 segmento vengono sostituite da una
  // catena di sotto-bone sintetici (vedi expandSegmentedParts) — bounding box,
  // loop di animazione e albero di rendering lavorano tutti su questa mappa
  // "espansa", non su previewPartsMap direttamente (l'export dello skeleton
  // resta invece sulle parti reali, la fisica non è ancora esportabile).
  const expandedPartsMap = useMemo(
    () => expandSegmentedParts(previewPartsMap),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [previewPartsMap, orderedPartKeys.join(",")]
  );
  const expandedOrderedKeys = Object.keys(expandedPartsMap).sort(
    (a, b) => expandedPartsMap[a].zIndex - expandedPartsMap[b].zIndex
  );

  // Bounding box reale calcolato dalle posizioni assolute effettive di tutte le
  // parti (non dalla dimensione della singola parte più grande), così anche
  // offset molto ampi o immagini a piena risoluzione (es. 1024×1024) rientrano
  // sempre nel riquadro dell'anteprima invece di sbordare.
  const stageLayout = useMemo(() => {
    if (!hasAnyPart) return { stageScale: 1, stageCenterX: 0, stageCenterY: 0, boundsW: 100, boundsH: 100 };
    let minX = 0, maxX = 0, minY = 0, maxY = 0;
    for (const key of expandedOrderedKeys) {
      const p = expandedPartsMap[key];
      const abs = resolveAbsoluteTransform(key, expandedPartsMap);
      const { fracX, fracY } = anchorToFraction(p.anchorX, p.anchorY);
      const corners = rotatedCorners({ ...abs, width: p.width, height: p.height, fracX, fracY });
      for (const c of corners) {
        minX = Math.min(minX, c.x);
        maxX = Math.max(maxX, c.x);
        minY = Math.min(minY, c.y);
        maxY = Math.max(maxY, c.y);
      }
    }
    const boundsW = Math.max(maxX - minX, 100);
    const boundsH = Math.max(maxY - minY, 100);
    const STAGE_BOX_W = 640;
    const STAGE_BOX_H = 420;
    const stageScale = Math.min(STAGE_BOX_W / boundsW, STAGE_BOX_H / boundsH, 1);
    return { stageScale, stageCenterX: -minX, stageCenterY: maxY, boundsW, boundsH };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasAnyPart, expandedPartsMap, expandedOrderedKeys.join(",")]);

  const skeletonData = useMemo(() => {
    if (!hasAnyPart) return null;
    const parts = orderedPartKeys.map((k) => ({ partKey: k, ...previewPartsMap[k] }));
    return buildCharacterSkeleton({ parts });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasAnyPart, previewPartsMap, orderedPartKeys.join(",")]);

  const partRefsMap = useRef({});
  for (const key of expandedOrderedKeys) {
    if (!partRefsMap.current[key]) partRefsMap.current[key] = { current: null };
  }

  const animationParts = expandedOrderedKeys.map((k) => ({
    key: k,
    parentKey: expandedPartsMap[k].parentKey,
    rotation: expandedPartsMap[k].rotation || 0,
    animationType: expandedPartsMap[k].animationType,
    speed: expandedPartsMap[k].speed
  }));

  const { duration: previewDuration } = useCharacterAnimationLoop({
    parts: animationParts,
    layerRefs: partRefsMap.current,
    animationsObj: skeletonData?.animations,
    playing: playing && !!skeletonData
  });

  async function handleGenerateExport() {
    if (!skeletonData) return;
    setSavingExport(true);
    setStatus("⏳ Generazione ed export in corso...");
    try {
      const atlasText = buildMultiPartAtlas(
        orderedPartKeys.map((k) => ({
          imageFileName: `${k}.png`,
          regionName: k,
          width: previewPartsMap[k].width,
          height: previewPartsMap[k].height
        }))
      );
      await saveCharacterExport({ characterId: character.id, skeletonJson: skeletonData, atlasText });
      setStatus("✅ Export generato e salvato.");
      await refresh();
    } catch (err) {
      setStatus(`❌ Errore export: ${err.message}`);
    } finally {
      setSavingExport(false);
    }
  }

  async function handleDownload() {
    if (!character?.export) {
      setStatus('⚠️ Premi prima "Genera export" per creare il pacchetto scaricabile.');
      return;
    }
    setStatus("⏳ Preparo il pacchetto...");
    try {
      await downloadCharacterPackage({
        characterName: character.name,
        skeletonJson: character.export.skeleton_json,
        atlasText: character.export.atlas_text,
        parts: character.parts
      });
      setStatus("✅ Download avviato.");
    } catch (err) {
      setStatus(`❌ Errore download: ${err.message}`);
    }
  }

  if (loading) return <div className="page status">⏳ Carico character...</div>;
  if (error) return <div className="page status error">❌ {error}</div>;
  if (!character) return null;

  const parentOptions = ["root", ...character.parts.map((p) => p.part_key)];
  const { stageScale, stageCenterX, stageCenterY, boundsW, boundsH } = stageLayout;

  // Genitore "effettivo" di una parte nella mappa espansa (già completamente
  // risolto da expandSegmentedParts: sempre "root" o una chiave esistente).
  function effectiveParentOf(key) {
    return expandedPartsMap[key]?.parentKey || "root";
  }

  const rootPartKeys = expandedOrderedKeys.filter((k) => effectiveParentOf(k) === "root");
  const editingPartKeyForDrag = character.parts.find((p) => p.id === editingPartId)?.part_key || null;

  /**
   * Renderizza una parte E, annidate al suo interno, tutte le sue parti figlie
   * (o segmenti sintetici, per le parti con "Fisica" a più segmenti — vedi
   * expandSegmentedParts): così il transform (rotazione/scala) animato sul
   * contenitore della parte si trasmette automaticamente ai figli tramite la
   * normale composizione CSS, esattamente come la gerarchia dei bone in Spine.
   */
  function renderPartTree(key, isRoot) {
    const p = expandedPartsMap[key];
    if (!p) return null;
    // Per un segmento di catena l'ancoraggio verticale è sempre "alto" (pende
    // dal segmento sopra), imposto già da expandSegmentedParts sul valore di p.
    const { fracX, fracY } = anchorToFraction(p.anchorX, p.anchorY);

    // Per le parti alla radice la posizione è calcolata rispetto al centro dello
    // stage; per le parti annidate è relativa al genitore diretto (che è già
    // posizionato correttamente grazie all'annidamento DOM).
    const boneLeft = isRoot ? stageCenterX + (p.offsetX || 0) : p.offsetX || 0;
    const boneTop = isRoot ? stageCenterY - (p.offsetY || 0) : -(p.offsetY || 0);

    const isNewPartDraggable = workingBlob && key === (sanitizeKey(partName) || "__new__");
    const isEditingPartDraggable = editingPartId && key === editingPartKeyForDrag;
    const isDraggable = isNewPartDraggable || isEditingPartDraggable;
    const dragMode = isEditingPartDraggable ? "editing" : "new";

    const childKeys = expandedOrderedKeys
      .filter((k) => k !== key && effectiveParentOf(k) === key)
      .sort((a, b) => expandedPartsMap[a].zIndex - expandedPartsMap[b].zIndex);

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
        {p.sliced ? (
          <div
            style={{ position: "absolute", left: -p.width * fracX, top: -p.height * fracY, width: p.width, height: p.height, overflow: "hidden" }}
          >
            <img
              src={p.url}
              alt={key}
              className={`character-part-img ${isDraggable ? "character-part-draggable" : ""}`}
              style={{ position: "absolute", left: 0, top: -p.cropTop, width: p.width, height: p.fullHeight }}
              onMouseDown={isDraggable ? (e) => handlePartDragStart(e, dragMode) : undefined}
              draggable={false}
            />
          </div>
        ) : (
          <img
            src={p.url}
            alt={key}
            className={`character-part-img ${isDraggable ? "character-part-draggable" : ""}`}
            style={{
              position: "absolute",
              left: -p.width * fracX,
              top: -p.height * fracY,
              width: p.width,
              height: p.height,
              transformOrigin: `${fracX * 100}% ${fracY * 100}%`
            }}
            onMouseDown={isDraggable ? (e) => handlePartDragStart(e, dragMode) : undefined}
            draggable={false}
          />
        )}
        {childKeys.map((childKey) => renderPartTree(childKey, false))}
      </div>
    );
  }

  return (
    <div className="page character-page-layout">
      <div className="character-main">
      <Link to="/characters" className="back-link">← Tutti i character</Link>
      <h1>🧙 {character.name}</h1>

      {character.parts.length > 0 && (
        <>
          <h2 className="section-title">📋 Dettagli tecnici</h2>
          <div className="hint">Clicca su una riga per modificare genitore, dimensioni, offset, z-index, ancoraggio o animazione.</div>
          {editingPartId && (
            <div className="hint" style={{ color: "#9fc4ff" }}>
              🖱️ Puoi anche trascinare direttamente la parte evidenziata nell'anteprima qui sotto, invece di digitare gli offset a mano.
            </div>
          )}
          <div className="tech-details-table">
            <div className="tech-details-row tech-details-header tech-details-row-char">
              <span>Parte</span>
              <span>Genitore</span>
              <span>Dimensioni</span>
              <span>Offset X/Y</span>
              <span>Z</span>
              <span>Rotazione</span>
              <span>Ancoraggio</span>
              <span>Animazione</span>
              <span>Segm.</span>
              <span></span>
            </div>
            {[...character.parts].sort((a, b) => a.z_index - b.z_index).map((p) => {
              const isEditing = editingPartId === p.id;
              if (isEditing) {
                return (
                  <div className="tech-details-row tech-details-row-char tech-details-row-editing" key={p.id}>
                    <span>{p.part_key}</span>
                    <select
                      value={editValues.parentKey}
                      onChange={(e) => setEditValues((v) => ({ ...v, parentKey: e.target.value }))}
                    >
                      <option value="root">— (radice)</option>
                      {character.parts.filter((pp) => pp.id !== p.id).map((pp) => (
                        <option key={pp.id} value={pp.part_key}>{pp.part_key}</option>
                      ))}
                    </select>
                    <span className="tech-edit-pair" title="Le dimensioni riflettono sempre il file immagine reale: per cambiarle serve ricaricare/ritagliare di nuovo l'immagine, non sono modificabili qui per evitare che l'export risulti disallineato dal PNG effettivo.">
                      {editValues.width}×{editValues.height}px 🔒
                    </span>
                    <span className="tech-edit-pair">
                      <input type="number" value={editValues.offsetX} onChange={(e) => setEditValues((v) => ({ ...v, offsetX: e.target.value }))} />
                      <input type="number" value={editValues.offsetY} onChange={(e) => setEditValues((v) => ({ ...v, offsetY: e.target.value }))} />
                    </span>
                    <input type="number" value={editValues.zIndex} onChange={(e) => setEditValues((v) => ({ ...v, zIndex: e.target.value }))} />
                    <input
                      type="number"
                      value={editValues.rotation}
                      title="Rotazione di riposo del bone (gradi, antiorario positivo — come in Spine)"
                      onChange={(e) => setEditValues((v) => ({ ...v, rotation: e.target.value }))}
                    />
                    <span className="tech-edit-pair">
                      <select value={editValues.anchorX} onChange={(e) => setEditValues((v) => ({ ...v, anchorX: e.target.value }))}>
                        <option value="left">⬅️</option>
                        <option value="center">◯</option>
                        <option value="right">➡️</option>
                      </select>
                      <select value={editValues.anchorY} onChange={(e) => setEditValues((v) => ({ ...v, anchorY: e.target.value }))}>
                        <option value="top">⬆️</option>
                        <option value="center">◯</option>
                        <option value="bottom">⬇️</option>
                      </select>
                    </span>
                    <select
                      value={editValues.animationType}
                      onChange={(e) => setEditValues((v) => ({ ...v, animationType: e.target.value }))}
                    >
                      {AVAILABLE_PART_ANIMATION_TYPES.map((t) => (
                        <option key={t} value={t}>{ANIM_LABELS[t]}</option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min="1"
                      max="8"
                      value={editValues.segments}
                      title="Segmenti (solo con animazione Fisica o Vento): divide il pezzo in N fasce che si piegano a cascata"
                      onChange={(e) => setEditValues((v) => ({ ...v, segments: e.target.value }))}
                    />
                    <span className="tech-edit-actions">
                      <button type="button" className="btn tiny" disabled={savingEdit} onClick={() => saveEditingPart(p.id, p.part_key)}>✓</button>
                      <button type="button" className="btn secondary tiny" onClick={cancelEditingPart}>✕</button>
                    </span>
                  </div>
                );
              }
              return (
                <div
                  className="tech-details-row tech-details-row-char tech-details-row-editable"
                  key={p.id}
                  onClick={() => startEditingPart(p)}
                  title="Clicca per modificare"
                >
                  <span>{p.part_key}</span>
                  <span>{p.parent_key === "root" ? "— (radice)" : p.parent_key}</span>
                  <span>{p.width}×{p.height}px</span>
                  <span>{p.offset_x}, {p.offset_y}</span>
                  <span>{p.z_index}</span>
                  <span>{p.rotation || 0}°</span>
                  <span>
                    {{ left: "⬅️", center: "◯", right: "➡️" }[p.anchor_x || "center"]}
                    {{ top: "⬆️", center: "◯", bottom: "⬇️" }[p.anchor_y || "center"]}
                  </span>
                  <span>{ANIM_LABELS[p.animation_type]}</span>
                  <span>{p.segments && p.segments > 1 ? `${p.segments}×` : "—"}</span>
                  <span className="tech-edit-hint">✏️</span>
                </div>
              );
            })}
          </div>
        </>
      )}

      <h2 className="section-title">Parti esistenti</h2>
      {character.parts.length === 0 && <div className="hint">Nessuna parte ancora. Aggiungine una qui sotto.</div>}
      <div className="symbol-cards-grid">
        {character.parts.map((p) => (
          <div key={p.id} className="symbol-card" style={{ cursor: "pointer" }} onClick={() => startEditingPart(p)}>
            <button
              type="button"
              className="symbol-card-delete"
              onClick={(e) => {
                e.stopPropagation();
                handleDeletePart(p.id, p.part_key);
              }}
              title="Elimina parte"
            >
              ✕
            </button>
            <div className="symbol-card-thumb">
              <img src={p.image_url} alt={p.part_key} />
            </div>
            <div className="symbol-card-name">{p.part_key}</div>
            <div className="hint" style={{ textAlign: "center", margin: 0 }}>
              genitore: {p.parent_key === "root" ? "—" : p.parent_key} · {ANIM_LABELS[p.animation_type]}
            </div>
          </div>
        ))}
      </div>

      {hasAnyPart && (
        <>
          <h2 className="section-title">Anteprima composita (loop ambientale)</h2>
          <div className="hint">
            Le parti annidate (es. occhi/bocca/capelli con genitore "testa") seguono visivamente il movimento del
            genitore, oltre alla propria animazione — come nel vero Spine.
          </div>
          <div
            className="character-stage-outer"
            style={{ width: Math.round(boundsW * stageScale), height: Math.round(boundsH * stageScale) }}
          >
            <div
              className="character-stage-inner"
              style={{ width: boundsW, height: boundsH, transform: `scale(${stageScale})` }}
            >
              {rootPartKeys.map((key) => renderPartTree(key, true))}
            </div>
          </div>
          {workingBlob && (
            <div className="hint">
              Trascina la nuova parte direttamente nel riquadro per posizionarla — i campi Offset X/Y si aggiornano da soli.
            </div>
          )}

          <div className="btn-row">
            <button type="button" className="btn secondary" onClick={() => setPlaying((p) => !p)}>
              {playing ? `⏸ Pausa (${previewDuration.toFixed(2)}s)` : "▶ Anteprima loop ambientale"}
            </button>
            <button type="button" className="btn" onClick={handleGenerateExport} disabled={savingExport}>
              ⚙️ Genera export
            </button>
          </div>
          <div className="btn-row">
            <button type="button" className="btn secondary" onClick={handleDownload}>
              ⬇ Scarica pacchetto
            </button>
          </div>
        </>
      )}

      {status && <div className="status">{status}</div>}
      </div>

      <div className="character-sidebar">
      <h2 className="section-title">🎨 Genera con AI (Gemini)</h2>
      <AiCharacterGenerator characterId={character.id} existingParts={character.parts} onImported={refresh} />

      <h2 className="section-title">📥 Importa da sprite sheet (manuale)</h2>
      <SpriteSheetImporter characterId={character.id} existingParts={character.parts} onImported={refresh} />

      <h2 className="section-title">🌀 Rotazione (frame intermedi)</h2>
      <CharacterRotationEditor
        characterId={character.id}
        rotationFrames={character.rotationFrames || []}
        rotationSpeed={character.rotation_speed}
        onChanged={refresh}
      />

      <h2 className="section-title">➕ Aggiungi parte (una alla volta)</h2>

      <label className="field-label">
        Nome parte (es. orecchini, cappello, cicatrice, occhiali)
        <input type="text" value={partName} onChange={(e) => setPartName(e.target.value)} />
      </label>

      <label className="field-label">
        Genitore (a quale parte è agganciata)
        <select value={parentKey} onChange={(e) => setParentKey(e.target.value)}>
          <option value="root">— (nessuno, si aggancia direttamente alla radice)</option>
          {parentOptions
            .filter((k) => k !== "root")
            .map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
        </select>
      </label>

      <label className="field-label">
        Immagine parte (PNG)
        <input
          type="file"
          accept="image/png"
          onChange={(e) => {
            setFile(e.target.files[0]);
            setWorkingBlob(null);
            setWorkingUrl(null);
          }}
        />
      </label>

      {file && <CropTool file={file} onDone={handleCropped} />}

      {workingBlob && (
        <>
          <div className="hint" style={{ color: "#9fc4ff" }}>
            📐 Dimensioni rilevate automaticamente dall'immagine caricata: {width}×{height}px. Non sono modificabili
            a mano — se le dimensioni non sono quelle giuste, ricarica o ritaglia di nuovo l'immagine. Questo evita
            che l'export dichiari una dimensione diversa dal PNG reale, che è la causa più comune di export Spine
            che sembrano vuoti o con parti mancanti quando aperti nell'editor.
          </div>
          <div className="row">
            <label className="field-label">
              Offset X (px, relativo al genitore)
              <input type="number" value={offsetX} onChange={(e) => setOffsetX(e.target.value)} />
            </label>
            <label className="field-label">
              Offset Y (px, positivo = verso l'alto)
              <input type="number" value={offsetY} onChange={(e) => setOffsetY(e.target.value)} />
            </label>
          </div>
          <div className="row">
            <label className="field-label">
              Z-index (ordine: più alto = più in primo piano)
              <input type="number" value={zIndex} onChange={(e) => setZIndex(e.target.value)} />
            </label>
            <label className="field-label" title="Posa di riposo del bone: gradi antiorari, come le rotazioni Spine — 0 = nessuna rotazione">
              Rotazione di riposo (gradi)
              <input type="number" value={rotation} onChange={(e) => setRotation(e.target.value)} />
            </label>
          </div>
          <div className="row">
            <label className="field-label">
              Tipo animazione
              <select value={animationType} onChange={(e) => setAnimationType(e.target.value)}>
                {AVAILABLE_PART_ANIMATION_TYPES.map((t) => (
                  <option key={t} value={t}>{ANIM_LABELS[t]}</option>
                ))}
              </select>
            </label>
          </div>
          {animationType === "physics" && (
            <div className="hint" style={{ color: "#9fc4ff" }}>
              🔗 Un pezzo con "Fisica" reagisce con inerzia e ritardo al movimento del suo genitore (invece di seguirlo
              rigidamente o oscillare a formula fissa) — se il genitore è fermo (statico), anche questo pezzo resterà
              fermo alla sua posa di riposo: aggancialo a un genitore che si muove (es. il busto con "Oscillazione") per
              vederne l'effetto. "Velocità" qui controlla quanto è rigida/reattiva la molla (1 = normale, più alto =
              più rigido e scattante, più basso = più morbido e "flottante"). Nota: per ora è solo un'anteprima live,
              non ancora inclusa nel pacchetto Spine esportato.
            </div>
          )}
          {animationType === "wind" && (
            <div className="hint" style={{ color: "#9fc4ff" }}>
              🌬️ "Vento" si muove da solo (oscillazione lenta e sottile), anche se il genitore è statico — è pensato
              per fare da capobone di una catena a più segmenti (vedi sotto): imposta i segmenti e ogni fascia
              successiva seguirà quella sopra a cascata via Fisica, ricreando l'effetto di capelli/sciarpe/code che
              ondeggiano al vento con pochissimi bone, come nel rig professionale. Con 1 solo segmento equivale a
              un'oscillazione dolce del pezzo intero.
            </div>
          )}
          {(animationType === "physics" || animationType === "wind") && (
            <>
              <label className="field-label" title="Divide l'immagine in N fasce che si piegano a cascata invece di ruotare come un blocco unico — utile per capelli lunghi o tessuti che pendono">
                Segmenti (1 = pezzo rigido, più segmenti = si piega come una catena)
                <input type="number" min="1" max="8" value={segments} onChange={(e) => setSegments(e.target.value)} />
              </label>
              {Number(segments) > 1 && (
                <div className="hint">
                  ✂️ L'immagine verrà divisa in {Number(segments)} fasce orizzontali uguali. La prima fascia mantiene
                  l'animazione "{ANIM_LABELS[animationType]}"; dalla seconda in poi seguono sempre a cascata via
                  Fisica, agganciata ognuna alla precedente: il pezzo si piegherà lungo la sua lunghezza invece di
                  ruotare tutto insieme. L'ancoraggio verticale per questo pezzo diventa sempre "Alto" (pende
                  dall'alto).
                </div>
              )}
            </>
          )}
          <div className="row">
            <label className="field-label">
              Ancoraggio orizzontale (cardine per la rotazione)
              <select value={anchorX} onChange={(e) => setAnchorX(e.target.value)}>
                <option value="left">⬅️ Sinistra</option>
                <option value="center">◯ Centro</option>
                <option value="right">➡️ Destra</option>
              </select>
            </label>
            <label className="field-label">
              Ancoraggio verticale (cardine per la rotazione)
              <select value={anchorY} onChange={(e) => setAnchorY(e.target.value)}>
                <option value="top">⬆️ Alto (es. pendolo)</option>
                <option value="center">◯ Centro</option>
                <option value="bottom">⬇️ Basso</option>
              </select>
            </label>
          </div>
          <label className="field-label">
            Velocità (1 = normale)
            <input type="number" step="0.1" min="0.1" value={partSpeed} onChange={(e) => setPartSpeed(e.target.value)} />
          </label>

          <button type="button" className="btn" onClick={handleSaveNewPart} disabled={savingPart}>
            💾 Salva parte
          </button>
        </>
      )}
      </div>
    </div>
  );
}
