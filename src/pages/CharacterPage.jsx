import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import CropTool from "../components/CropTool.jsx";
import SpriteSheetImporter from "../components/SpriteSheetImporter.jsx";
import AiCharacterGenerator from "../components/AiCharacterGenerator.jsx";
import CharacterTurnaroundTester from "../components/CharacterTurnaroundTester.jsx";
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
  saveCharacterExport,
  renameCharacter,
  logRigCorrection,
  renameCharacterPart,
  getOriginalPartImage,
  replaceCharacterPartImage,
  updateCharacterPartOffset
} from "../lib/charactersRepository.js";
import { downloadCharacterPackage } from "../lib/exportZip.js";
import { PART_ROLES, ROLE_LABELS, RULES_VERSION, guessRoles, planRig, loadPartMask } from "../lib/rigRules.js";
import { addTorsoBreathMesh, addHeadMesh, isRigidMaterial, metalShare } from "../lib/torsoMesh.js";
import { verifyExportSkeleton } from "../lib/exportCheck.js";
import { toSpine41 } from "../lib/spineFormat.js";
import { applyFrameClip } from "../lib/meshRig.js";

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
/** Pixel RGBA di un'immagine remota (Storage pubblico): per decidere il materiale delle parti. */
/** Ricampiona un PNG a w×h con dimezzamenti successivi (qualità migliore nelle riduzioni forti). */
async function resampleImage(blob, w, h) {
  let src = await createImageBitmap(blob);
  let cw = src.width, ch = src.height;
  while (cw / 2 >= w && ch / 2 >= h) {
    const c = document.createElement("canvas");
    c.width = Math.round(cw / 2);
    c.height = Math.round(ch / 2);
    const ctx = c.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, 0, 0, c.width, c.height);
    src = c;
    cw = c.width;
    ch = c.height;
  }
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, w, h);
  return new Promise((res) => out.toBlob(res, "image/png"));
}

function loadImagePixels(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      resolve(ctx.getImageData(0, 0, c.width, c.height).data);
    };
    img.onerror = reject;
    img.src = url;
  });
}

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
        pivotFx: null,
        pivotFy: null,
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
  // ZOOM dell'anteprima: "fit" = adatta allo spazio disponibile (finestra o schermo intero),
  // altrimenti fattore fisso (1 = 100%). Ricordato per il browser.
  const [stageZoom, setStageZoom] = useState(() => {
    try {
      const v = localStorage.getItem("spine.stageZoom");
      return v && v !== "fit" && isFinite(+v) ? +v : "fit";
    } catch {
      return "fit";
    }
  });
  const [viewport, setViewport] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const stageWrapRef = useRef(null);
  // INQUADRATURA (R15): rettangolo in coordinate dello skeleton (y in alto); con "ritaglia" va nel pacchetto come
  // maschera di ritaglio Spine (slot "inquadratura")
  const [frame, setFrame] = useState(null);
  const [frameMode, setFrameMode] = useState(false);
  const [frameDrag, setFrameDrag] = useState(null);
  const [clipPkg, setClipPkg] = useState(true);
  useEffect(() => {
    try {
      localStorage.setItem("spine.stageZoom", String(stageZoom));
    } catch {
      /* preferenza non salvata */
    }
  }, [stageZoom]);
  const [savingExport, setSavingExport] = useState(false);
  // busto come mesh pesata con respiro: solo export, richiede Spine Professional
  const [meshTorso, setMeshTorso] = useState(() => {
    try {
      // mesh automatiche di default; "0" solo se l'utente le ha disattivate (Spine Essential)
      return localStorage.getItem("spine.meshTorso") !== "0";
    } catch {
      return true;
    }
  });
  const [showTurnaroundTester, setShowTurnaroundTester] = useState(false);

  // --- Editing inline parti esistenti ---
  const [editingPartId, setEditingPartId] = useState(null);
  const [editValues, setEditValues] = useState({});
  const [applyingRig, setApplyingRig] = useState(false);
  // Ultima proposta delle regole rig per parte ({role, parentKey, pivot}): serve a
  // capire, quando l'utente salva una modifica, se sta correggendo una proposta
  // automatica (-> registro correzioni). Persistita in sessionStorage per pagina.
  const rigProposalRef = useRef(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [keyDraft, setKeyDraft] = useState("");
  const [keySaved, setKeySaved] = useState(null);
  const [renaming, setRenaming] = useState(false);
  const [scalePct, setScalePct] = useState(100);
  const [scaleBranch, setScaleBranch] = useState(true);
  const [scaling, setScaling] = useState(false);

  // --- Rinomina character ---
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);

  // silent: ricarica senza schermata di caricamento (rinomina/ridimensiona mentre si modifica una parte)
  const refresh = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
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

  function startEditingName() {
    setNameDraft(character.name);
    setEditingName(true);
  }

  async function handleSaveName() {
    // eslint-disable-next-line no-console
    console.log("[handleSaveName] invocato", { nameDraft, characterName: character?.name });
    const trimmed = nameDraft.trim();
    if (!trimmed) {
      setStatus("⚠️ Il nome non può essere vuoto.");
      return;
    }
    if (trimmed === character.name) {
      setStatus("ℹ️ Nome invariato, nessuna modifica da salvare.");
      setEditingName(false);
      return;
    }
    setSavingName(true);
    setStatus(`⏳ Rinomino in "${trimmed}"...`);
    try {
      await renameCharacter(character.id, trimmed);
      setEditingName(false);
      setStatus(`✅ Character rinominato in "${trimmed}".`);
      await refresh();
    } catch (err) {
      setStatus(`❌ Errore rinomina: ${err.message}`);
    } finally {
      setSavingName(false);
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
    setKeyDraft(p.part_key);
    setKeySaved(null);
    setScalePct(100);
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
      anchorY: p.anchor_y || "center",
      role: p.role || "",
      pivotFx: p.pivot_fx ?? null,
      pivotFy: p.pivot_fy ?? null
    });
  }

  function cancelEditingPart() {
    setEditingPartId(null);
  }

  /** Rinomina la parte SUBITO su database e Storage (Invio o uscita dal campo). */
  async function handleRenamePart(p) {
    const newKey = sanitizeKey(keyDraft);
    if (!newKey || newKey === p.part_key) {
      setKeyDraft(p.part_key);
      return;
    }
    setRenaming(true);
    setStatus(`⏳ Rinomino "${p.part_key}" → "${newKey}"...`);
    try {
      await renameCharacterPart({ characterId: character.id, partId: p.id, oldKey: p.part_key, newKey, siblings: character.parts });
      setKeyDraft(newKey);
      setKeySaved(newKey);
      setStatus(`✅ "${p.part_key}" rinominata in "${newKey}" (figli ricollegati).`);
      await refresh({ silent: true });
    } catch (err) {
      setKeyDraft(p.part_key);
      setStatus(`❌ Rinomina: ${err.message || err}`);
    } finally {
      setRenaming(false);
    }
  }

  /**
   * Ridimensiona il pezzo in %: ricampiona il PNG partendo SEMPRE dall'originale (copiato in
   * _orig/ alla prima volta), quindi più passaggi non degradano l'immagine. Il pivot resta lo
   * stesso punto del disegno (frazioni invariate). Con "tutto il ramo" scala anche i figli e i
   * loro attacchi (offset), così restano attaccati nello stesso punto.
   */
  async function handleScalePart(p) {
    const f = Number(scalePct) / 100;
    if (!(f > 0) || f === 1) return;
    setScaling(true);
    try {
      const parts = character.parts;
      const resized = {};
      const scaleImage = async (part) => {
        setStatus(`⏳ Ridimensiono "${part.part_key}" al ${scalePct}%...`);
        const w = Math.max(1, Math.round(part.width * f)), h = Math.max(1, Math.round(part.height * f));
        const src = await getOriginalPartImage(character.id, part.part_key);
        const blob = await resampleImage(src, w, h);
        await replaceCharacterPartImage({ characterId: character.id, partId: part.id, partKey: part.part_key, imageBlob: blob, width: w, height: h });
        resized[part.id] = { w, h };
      };
      const walk = async (part) => {
        await scaleImage(part);
        if (!scaleBranch) return;
        for (const child of parts.filter((c) => c.parent_key === part.part_key && c.id !== part.id)) {
          await updateCharacterPartOffset(child.id, Math.round(child.offset_x * f), Math.round(child.offset_y * f));
          await walk(child);
        }
      };
      await walk(p);
      setEditValues((v) => ({ ...v, width: resized[p.id].w, height: resized[p.id].h }));
      setStatus(`✅ Ridimensionate al ${scalePct}%: ${Object.keys(resized).length} parti.`);
      setScalePct(100);
      await refresh({ silent: true });
    } catch (err) {
      setStatus(`❌ Ridimensionamento: ${err.message || err}`);
    } finally {
      setScaling(false);
    }
  }

  function rigStorageKey(kind) {
    return `rig:${kind}:${character?.id}`;
  }

  function readSession(key, fallback) {
    try {
      const raw = sessionStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function writeSession(key, value) {
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage non disponibile: il registro funziona comunque per questa pagina */
    }
  }

  function getRigProposal() {
    if (rigProposalRef.current?.id !== character?.id) {
      rigProposalRef.current = { id: character?.id, data: readSession(rigStorageKey("proposal"), {}) };
    }
    return rigProposalRef.current.data;
  }

  /** Registra una correzione una sola volta per (parte, campo, valore corretto). */
  async function recordCorrection(partKey, field, proposed, corrected, context) {
    const loggedKey = rigStorageKey("logged");
    const logged = readSession(loggedKey, {});
    const id = `${partKey}|${field}|${JSON.stringify(corrected)}`;
    if (logged[id]) return;
    logged[id] = true;
    writeSession(loggedKey, logged);
    await logRigCorrection({
      characterId: character.id,
      partKey,
      field,
      proposed,
      corrected,
      rulesVersion: RULES_VERSION,
      context
    });
  }

  const pivotOf = (fx, fy) => (fx != null && fy != null ? [Number(fx), Number(fy)] : null);
  const samePivot = (a, b) => (!a && !b) || (a && b && Math.abs(a[0] - b[0]) < 0.001 && Math.abs(a[1] - b[1]) < 0.001);

  /** Confronta la parte salvata con l'ultima proposta delle regole e registra le differenze. */
  async function logEditAgainstProposal(partKey, values) {
    const proposal = getRigProposal()[partKey];
    if (!proposal) return;
    const context = { width: Number(values.width), height: Number(values.height) };
    const role = values.role || null;
    if (role !== proposal.role) await recordCorrection(partKey, "role", proposal.role, role, context);
    if ((values.parentKey || "root") !== proposal.parentKey)
      await recordCorrection(partKey, "parent_key", proposal.parentKey, values.parentKey || "root", context);
    const pivot = pivotOf(values.pivotFx, values.pivotFy);
    if (!samePivot(pivot, proposal.pivot)) await recordCorrection(partKey, "pivot", proposal.pivot, pivot, context);
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
        anchorY: editValues.anchorY,
        role: editValues.role || null,
        pivotFx: editValues.pivotFx ?? null,
        pivotFy: editValues.pivotFy ?? null
      });
      await logEditAgainstProposal(partKey, editValues);
      setStatus(`✅ "${partKey}" aggiornata.`);
      setEditingPartId(null);
      await refresh();
    } catch (err) {
      setStatus(`❌ Errore aggiornamento: ${err.message}`);
    } finally {
      setSavingEdit(false);
    }
  }

  /**
   * Regole rig (vedi lib/rigRules.js): propone i ruoli mancanti, calcola i pivot
   * anatomici dai pixel (spalla, base del collo, attacco degli orecchini) e aggancia
   * capelli/orecchini/copricapo alla testa, ricalcolando gli offset in modo che la
   * posa a riposo resti identica. Chiede conferma mostrando le modifiche.
   */
  async function handleApplyRigRules() {
    if (!character?.parts?.length) return;
    setApplyingRig(true);
    setStatus("⏳ Analisi delle parti per le regole rig...");
    try {
      const parts = character.parts.map((p) => ({
        id: p.id,
        partKey: p.part_key,
        parentKey: p.parent_key || "root",
        width: p.width,
        height: p.height,
        offsetX: Number(p.offset_x) || 0,
        offsetY: Number(p.offset_y) || 0,
        rotation: Number(p.rotation) || 0,
        zIndex: p.z_index ?? 0,
        anchorX: p.anchor_x || "center",
        anchorY: p.anchor_y || "center",
        pivotFx: p.pivot_fx ?? null,
        pivotFy: p.pivot_fy ?? null,
        segments: p.segments ?? 1,
        role: p.role || null
      }));
      const roles = guessRoles(parts);
      const masks = {};
      for (const p of character.parts) {
        if (["head", "arm", "forearm", "hand", "earring"].includes(roles[p.part_key])) {
          masks[p.part_key] = await loadPartMask(p.image_url);
        }
      }
      // Ruoli impostati a mano diversi da quelli che le regole avrebbero proposto = correzioni
      const pureRoles = guessRoles(parts.map((p) => ({ ...p, role: null })));
      for (const p of parts) {
        if (p.role && pureRoles[p.partKey] !== p.role) {
          await recordCorrection(p.partKey, "role", pureRoles[p.partKey] || null, p.role, {
            width: p.width,
            height: p.height,
            proposedRoles: pureRoles
          });
        }
      }
      const fullPlan = planRig(parts, roles, masks);
      const proposal = Object.fromEntries(
        fullPlan.map((c) => [c.partKey, { role: c.role, parentKey: c.parentKey, pivot: pivotOf(c.pivotFx, c.pivotFy) }])
      );
      rigProposalRef.current = { id: character.id, data: proposal };
      writeSession(rigStorageKey("proposal"), proposal);
      const plan = fullPlan.filter((c) => c.changes.length);
      if (!plan.length) {
        setStatus("✅ Regole rig: nessuna modifica necessaria.");
        return;
      }
      const summary = plan.map((c) => `• ${c.partKey}: ${c.changes.join("; ")}`).join("\n");
      if (!window.confirm(`Applicare queste modifiche al rig?\n\n${summary}`)) {
        setStatus("Regole rig annullate.");
        return;
      }
      for (const c of plan) {
        const p = character.parts.find((pp) => pp.part_key === c.partKey);
        await updateCharacterPartMetadata(p.id, {
          width: p.width,
          height: p.height,
          offsetX: c.offsetX,
          offsetY: c.offsetY,
          zIndex: p.z_index ?? 0,
          parentKey: c.parentKey,
          animationType: p.animation_type || "static",
          speed: p.speed ?? 1,
          anchorX: p.anchor_x || "center",
          anchorY: p.anchor_y || "center",
          rotation: c.rotation,
          segments: p.segments ?? 1,
          role: c.role,
          pivotFx: c.pivotFx,
          pivotFy: c.pivotFy
        });
      }
      setStatus(`✅ Regole rig applicate a ${plan.length} parti. Ricorda "Genera export" per aggiornare il pacchetto Spine.`);
      await refresh();
    } catch (err) {
      setStatus(`❌ Errore regole rig: ${err.message}`);
    } finally {
      setApplyingRig(false);
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
            pivotFx: editValues.pivotFx,
            pivotFy: editValues.pivotFy,
            // il ruolo serve a loop v2 (ampiezze, saluto), mesh automatiche e verifica dell'export
            role: editValues.role || null,
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
            pivotFx: p.pivot_fx,
            pivotFy: p.pivot_fy,
            role: p.role || null,
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
  useEffect(() => {
    // larghezza = quella del riquadro dell'anteprima (la pagina può essere più stretta della finestra)
    const onResize = () => setViewport({ w: stageWrapRef.current?.clientWidth || window.innerWidth, h: window.innerHeight });
    onResize();
    const ro = typeof ResizeObserver !== "undefined" && stageWrapRef.current ? new ResizeObserver(onResize) : null;
    if (ro) ro.observe(stageWrapRef.current);
    window.addEventListener("resize", onResize);
    document.addEventListener("fullscreenchange", onResize);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", onResize);
      document.removeEventListener("fullscreenchange", onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasAnyPart]);

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
      const { fracX, fracY } = anchorToFraction(p.anchorX, p.anchorY, p.pivotFx, p.pivotFy);
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
    // spazio disponibile: larghezza della pagina e altezza della finestra (meno la barra dei comandi)
    const full = typeof document !== "undefined" && !!document.fullscreenElement;
    const boxW = Math.max(320, viewport.w - (full ? 32 : 4));
    const boxH = Math.max(320, viewport.h - (full ? 80 : 160));
    const fitScale = Math.min(boxW / boundsW, boxH / boundsH, 4);
    const stageScale = stageZoom === "fit" ? fitScale : stageZoom;
    return { stageScale, fitScale, stageCenterX: -minX, stageCenterY: maxY, boundsW, boundsH };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasAnyPart, expandedPartsMap, expandedOrderedKeys.join(","), stageZoom, viewport.w, viewport.h]);

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
    speed: expandedPartsMap[k].speed,
    offsetX: expandedPartsMap[k].offsetX || 0,
    offsetY: expandedPartsMap[k].offsetY || 0
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
      let skeletonJson = skeletonData;
      let note = "";
      if (meshTorso) {
        const meshParts = orderedPartKeys.map((k) => ({ partKey: k, ...previewPartsMap[k] }));
        const done = [];
        // materiale: parti metalliche (elmo, corazza) restano rigide, niente deformazione
        const rigidOf = async (role) => {
          const part = meshParts.find((p) => p.role === role);
          const row = part && character.parts.find((p) => p.part_key === part.partKey);
          if (!row?.image_url) return { rigid: false };
          try {
            const px = await loadImagePixels(row.image_url);
            return { rigid: isRigidMaterial(px), share: metalShare(px), key: part.partKey };
          } catch {
            return { rigid: false };
          }
        };
        const torsoMat = await rigidOf("torso");
        if (torsoMat.rigid) note += ` Busto rigido (metallo ${Math.round(torsoMat.share * 100)}%): niente respiro.`;
        else {
          const r = addTorsoBreathMesh(skeletonJson, meshParts);
          if (r.applied) {
            skeletonJson = r.json;
            done.push("busto (respiro)");
          } else note += ` ⚠️ Mesh del busto non applicata: ${r.reason}.`;
        }
        const headMat = await rigidOf("head");
        if (headMat.rigid) note += ` Testa rigida (metallo ${Math.round(headMat.share * 100)}%, es. elmo): niente cappello/barba deformabili.`;
        else {
          const rh = addHeadMesh(skeletonJson, meshParts);
          if (rh.applied) {
            skeletonJson = rh.json;
            done.push("testa (cappello e barba in ritardo)");
          } else note += ` ⚠️ Mesh della testa non applicata: ${rh.reason}.`;
        }
        if (done.length) note = ` Mesh: ${done.join(", ")} — aprire con Spine Professional.${note}`;
      }
      // verifica del file che arriverà in Spine (non delle intenzioni): se ci sono errori non si salva
      const check = verifyExportSkeleton(
        toSpine41(skeletonJson),
        orderedPartKeys.map((k) => ({ partKey: k, role: previewPartsMap[k].role || null }))
      );
      const sum = `Verifica: ${check.summary.bones} ossa, ${check.summary.regions} immagini rigide, ${check.summary.meshes} mesh${check.summary.meshNames.length ? ` (${check.summary.meshNames.join(", ")})` : ""}, loop ${check.summary.duration}s.`;
      if (!check.ok) {
        setStatus(`❌ Export NON salvato: ${check.errors.join(" ")} ${sum}`);
        return;
      }
      await saveCharacterExport({ characterId: character.id, skeletonJson, atlasText });
      setStatus(`✅ Export generato e salvato.${note} ${sum}${check.warnings.length ? ` ⚠️ ${check.warnings.join(" ")}` : ""}`);
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
        skeletonJson: frame && clipPkg ? applyFrameClip(character.export.skeleton_json, frame) : character.export.skeleton_json,
        atlasText: character.export.atlas_text,
        parts: character.parts
      });
      setStatus(frame && clipPkg ? "✅ Download avviato (con l'inquadratura: slot \"inquadratura\" nel pacchetto)." : "✅ Download avviato.");
    } catch (err) {
      setStatus(`❌ Errore download: ${err.message}`);
    }
  }

  if (loading) return <div className="page status">⏳ Carico character...</div>;
  if (error) return <div className="page status error">❌ {error}</div>;
  if (!character) return null;

  const parentOptions = ["root", ...character.parts.map((p) => p.part_key)];
  const { stageScale, stageCenterX, stageCenterY, boundsW, boundsH } = stageLayout;

  const editingPartKeyForDrag = character.parts.find((p) => p.id === editingPartId)?.part_key || null;

  /**
   * Renderizza una parte come elemento "piatto" (fratello di tutte le altre,
   * ordinato per zIndex come gli slot di Spine). Posizione, rotazione e scala
   * nel mondo — compresa la catena dei genitori — sono applicate come matrix()
   * da useCharacterAnimationLoop: un figlio può quindi stare dietro a parti
   * davanti al suo genitore (es. capelli figli della testa, dietro al busto).
   */
  function renderPart(key) {
    const p = expandedPartsMap[key];
    if (!p) return null;
    // Per un segmento di catena l'ancoraggio verticale è sempre "alto" (pende
    // dal segmento sopra), imposto già da expandSegmentedParts sul valore di p.
    const { fracX, fracY } = anchorToFraction(p.anchorX, p.anchorY, p.pivotFx, p.pivotFy);


    const isNewPartDraggable = workingBlob && key === (sanitizeKey(partName) || "__new__");
    const isEditingPartDraggable = editingPartId && key === editingPartKeyForDrag;
    const isDraggable = isNewPartDraggable || isEditingPartDraggable;
    const dragMode = isEditingPartDraggable ? "editing" : "new";

    return (
      <div
        key={key}
        ref={partRefsMap.current[key]}
        style={{
          position: "absolute",
          left: stageCenterX,
          top: stageCenterY,
          width: 0,
          height: 0,
          zIndex: p.zIndex,
          transformOrigin: "0 0"
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
      </div>
    );
  }

  return (
    <div className="page page-wide">
      <Link to="/characters" className="back-link">← Tutti i character</Link>
      {editingName ? (
        <div className="row char-name-edit">
          <input
            type="text"
            value={nameDraft}
            autoFocus
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSaveName();
              if (e.key === "Escape") setEditingName(false);
            }}
          />
          <button type="button" className="btn tiny" disabled={savingName} onClick={handleSaveName}>✓</button>
          <button type="button" className="btn tiny secondary" disabled={savingName} onClick={() => setEditingName(false)}>✕</button>
        </div>
      ) : (
        <h1>
          🧙 {character.name}{" "}
          <button type="button" className="btn tiny secondary" title="Rinomina character" onClick={startEditingName}>✏️</button>
        </h1>
      )}
      <div className="hint">
        Il nome è anche ciò che collega questo character ai Rulli: deve coincidere esattamente con il nome di un
        simbolo del progetto Aztec importato (es. "sym5") perché compaia lì al posto suo — vedi <Link to="/reels">Rulli</Link>.
      </div>

      {character.parts.length > 0 && (
        <>
          <h2 className="section-title">📋 Dettagli tecnici</h2>
          <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" className="btn secondary" disabled={applyingRig} onClick={handleApplyRigRules}>
              🦴 Applica regole rig
            </button>
            <span className="hint" style={{ margin: 0 }}>
              Pivot alla spalla e alla base del collo, capelli/orecchini/copricapo figli della testa. La posa a riposo non cambia.
              I ruoli mancanti vengono proposti in automatico: controllali nella colonna Parte.
            </span>
          </div>
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
                const childCount = character.parts.filter((c) => c.parent_key === p.part_key).length;
                return (
                  <div className="tech-edit-panel" key={p.id}>
                    <div className="tech-edit-panel-title">✏️ Modifica parte</div>
                    <div className="tech-edit-grid">
                      <label className="tech-edit-field wide">
                        Nome parte (salvato subito)
                        <span className="tech-edit-pair">
                          <input
                            type="text"
                            value={keyDraft}
                            disabled={renaming}
                            title="Invio o clic fuori = rinomina su database e Storage; i figli vengono ricollegati. Esc = annulla"
                            onChange={(e) => setKeyDraft(e.target.value)}
                            onBlur={() => handleRenamePart(p)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") e.currentTarget.blur();
                              if (e.key === "Escape") setKeyDraft(p.part_key);
                            }}
                          />
                          {renaming ? <span className="tech-edit-saved">⏳</span> : keySaved === p.part_key && <span className="tech-edit-saved">✓ salvato</span>}
                        </span>
                      </label>
                      <label className="tech-edit-field">
                        Ruolo
                        <select value={editValues.role || ""} onChange={(e) => setEditValues((v) => ({ ...v, role: e.target.value }))}>
                          <option value="">— ruolo —</option>
                          {PART_ROLES.map((r) => (
                            <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                          ))}
                        </select>
                      </label>
                      <label className="tech-edit-field">
                        Genitore
                        <select value={editValues.parentKey} onChange={(e) => setEditValues((v) => ({ ...v, parentKey: e.target.value }))}>
                          <option value="root">— (radice)</option>
                          {character.parts.filter((pp) => pp.id !== p.id).map((pp) => (
                            <option key={pp.id} value={pp.part_key}>{pp.part_key}</option>
                          ))}
                        </select>
                      </label>
                      <div className="tech-edit-field">
                        Dimensioni (file PNG)
                        <span className="value" title="Le dimensioni seguono il file immagine reale: si cambiano solo con 'Ridimensiona'.">
                          {editValues.width}×{editValues.height}px 🔒
                        </span>
                      </div>
                      <div className="tech-edit-field wide">
                        Ridimensiona pezzo (%)
                        <span className="tech-edit-pair">
                          <input type="number" min="5" max="400" step="1" value={scalePct} disabled={scaling} onChange={(e) => setScalePct(e.target.value)} style={{ maxWidth: 90 }} />
                          <button type="button" className="btn tiny secondary" disabled={scaling} onClick={() => setScalePct(90)}>90</button>
                          <button type="button" className="btn tiny secondary" disabled={scaling} onClick={() => setScalePct(75)}>75</button>
                          <button type="button" className="btn tiny secondary" disabled={scaling} onClick={() => setScalePct(50)}>50</button>
                          <button type="button" className="btn tiny" disabled={scaling || Number(scalePct) === 100} onClick={() => handleScalePart(p)}>
                            {scaling ? "⏳" : "↘ Ridimensiona"}
                          </button>
                        </span>
                        {childCount > 0 && (
                          <label className="check">
                            <input type="checkbox" checked={scaleBranch} onChange={(e) => setScaleBranch(e.target.checked)} />
                            anche i {childCount} figli (tutto il ramo, con i loro attacchi)
                          </label>
                        )}
                      </div>
                      <label className="tech-edit-field">
                        Offset X
                        <input type="number" value={editValues.offsetX} onChange={(e) => setEditValues((v) => ({ ...v, offsetX: e.target.value }))} />
                      </label>
                      <label className="tech-edit-field">
                        Offset Y
                        <input type="number" value={editValues.offsetY} onChange={(e) => setEditValues((v) => ({ ...v, offsetY: e.target.value }))} />
                      </label>
                      <label className="tech-edit-field">
                        Z (ordine)
                        <input type="number" value={editValues.zIndex} onChange={(e) => setEditValues((v) => ({ ...v, zIndex: e.target.value }))} />
                      </label>
                      <label className="tech-edit-field">
                        Rotazione (°)
                        <input
                          type="number"
                          value={editValues.rotation}
                          title="Rotazione di riposo del bone (gradi, antiorario positivo — come in Spine)"
                          onChange={(e) => setEditValues((v) => ({ ...v, rotation: e.target.value }))}
                        />
                      </label>
                      <div className="tech-edit-field">
                        Ancoraggio{editValues.pivotFx != null && editValues.pivotFy != null ? " (🎯 pivot preciso)" : ""}
                        <span className="tech-edit-pair">
                          <select value={editValues.anchorX} onChange={(e) => setEditValues((v) => ({ ...v, anchorX: e.target.value, pivotFx: null, pivotFy: null }))}>
                            <option value="left">⬅️ sinistra</option>
                            <option value="center">◯ centro</option>
                            <option value="right">➡️ destra</option>
                          </select>
                          <select value={editValues.anchorY} onChange={(e) => setEditValues((v) => ({ ...v, anchorY: e.target.value, pivotFx: null, pivotFy: null }))}>
                            <option value="top">⬆️ alto</option>
                            <option value="center">◯ centro</option>
                            <option value="bottom">⬇️ basso</option>
                          </select>
                        </span>
                      </div>
                      <label className="tech-edit-field">
                        Animazione
                        <select value={editValues.animationType} onChange={(e) => setEditValues((v) => ({ ...v, animationType: e.target.value }))}>
                          {AVAILABLE_PART_ANIMATION_TYPES.map((t) => (
                            <option key={t} value={t}>{ANIM_LABELS[t]}</option>
                          ))}
                        </select>
                      </label>
                      <label className="tech-edit-field">
                        Velocità
                        <input type="number" min="0.1" step="0.05" value={editValues.speed} onChange={(e) => setEditValues((v) => ({ ...v, speed: e.target.value }))} />
                      </label>
                      <label className="tech-edit-field">
                        Segmenti
                        <input
                          type="number"
                          min="1"
                          max="8"
                          value={editValues.segments}
                          title="Segmenti (solo con animazione Fisica o Vento): divide il pezzo in N fasce che si piegano a cascata"
                          onChange={(e) => setEditValues((v) => ({ ...v, segments: e.target.value }))}
                        />
                      </label>
                    </div>
                    <div className="tech-edit-actions">
                      <button type="button" className="btn secondary tiny" onClick={cancelEditingPart}>✕ Annulla</button>
                      <button type="button" className="btn tiny" disabled={savingEdit || renaming || scaling} onClick={() => saveEditingPart(p.id, p.part_key)}>✓ Salva</button>
                    </div>
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
                  <span>
                    {p.part_key}
                    {p.role && <div className="hint" style={{ margin: 0 }}>{ROLE_LABELS[p.role] || p.role}</div>}
                  </span>
                  <span>{p.parent_key === "root" ? "— (radice)" : p.parent_key}</span>
                  <span>{p.width}×{p.height}px</span>
                  <span>{p.offset_x}, {p.offset_y}</span>
                  <span>{p.z_index}</span>
                  <span>{p.rotation || 0}°</span>
                  <span>
                    {p.pivot_fx != null && p.pivot_fy != null ? (
                      <span title="Pivot preciso calcolato dalle regole rig (frazione dell'immagine)">
                        🎯 {Math.round(p.pivot_fx * p.width)},{Math.round(p.pivot_fy * p.height)}
                      </span>
                    ) : (
                      <>
                        {{ left: "⬅️", center: "◯", right: "➡️" }[p.anchor_x || "center"]}
                        {{ top: "⬆️", center: "◯", bottom: "⬇️" }[p.anchor_y || "center"]}
                      </>
                    )}
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

      <h2 className="section-title">🎨 Genera con AI (Gemini)</h2>
      <AiCharacterGenerator characterId={character.id} existingParts={character.parts} onImported={refresh} />

      <h2 className="section-title">📥 Importa da sprite sheet (manuale)</h2>
      <SpriteSheetImporter characterId={character.id} existingParts={character.parts} onImported={refresh} />

      <h2 className="section-title">
        🧪 Test: nuovo sistema turnaround (sperimentale){" "}
        <button
          type="button"
          className="btn secondary"
          style={{ fontSize: "0.75rem", padding: "2px 8px", marginLeft: 8 }}
          onClick={() => setShowTurnaroundTester((v) => !v)}
        >
          {showTurnaroundTester ? "Nascondi" : "Mostra"}
        </button>
      </h2>
      {showTurnaroundTester && (
        <CharacterTurnaroundTester characterId={character.id} existingParts={character.parts} onImported={refresh} />
      )}

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

      {hasAnyPart && (
        <>
          <h2 className="section-title">Anteprima composita (loop ambientale)</h2>
          <div className="hint">
            Le parti annidate (es. occhi/bocca/capelli con genitore "testa") seguono visivamente il movimento del
            genitore, oltre alla propria animazione — come nel vero Spine.
          </div>
          <div className="stage-zoom-bar">
            <button type="button" className={`btn secondary${stageZoom === "fit" ? " active" : ""}`} onClick={() => setStageZoom("fit")} title="Adatta allo spazio disponibile">
              ⤢ Adatta
            </button>
            <button type="button" className="btn secondary" onClick={() => setStageZoom(Math.max(0.1, +(stageScale / 1.25).toFixed(3)))} title="Riduci">
              −
            </button>
            <span className="stage-zoom-value">{Math.round(stageScale * 100)}%</span>
            <button type="button" className="btn secondary" onClick={() => setStageZoom(Math.min(8, +(stageScale * 1.25).toFixed(3)))} title="Ingrandisci">
              +
            </button>
            <button type="button" className="btn secondary" onClick={() => setStageZoom(1)} title="Dimensione reale (1 pixel = 1 pixel)">
              100%
            </button>
            <button
              type="button"
              className="btn secondary"
              onClick={() => (document.fullscreenElement ? document.exitFullscreen() : stageWrapRef.current?.requestFullscreen?.())}
              title="Anteprima a schermo intero (Esc per uscire)"
            >
              ⛶ Schermo intero
            </button>
            <span className="hint">Ctrl + rotellina sull'anteprima per lo zoom</span>
          </div>
          <div
            ref={stageWrapRef}
            className="character-stage-scroll"
            onWheel={(e) => {
              if (!e.ctrlKey) return;
              e.preventDefault();
              const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
              setStageZoom(Math.min(8, Math.max(0.1, +(stageScale * f).toFixed(3))));
            }}
          >
            <div
              className="character-stage-outer"
              style={{ width: Math.round(boundsW * stageScale), height: Math.round(boundsH * stageScale) }}
            >
              <div
                className="character-stage-inner"
                style={{ width: boundsW, height: boundsH, transform: `scale(${stageScale})` }}
              >
                {expandedOrderedKeys.map((key) => renderPart(key))}
              </div>
              {(frameMode || frame) && (() => {
                // stage (pixel non scalati) <-> skeleton: x = px - centroX, y = centroY - py
                const toSk = (px, py) => ({ x: px / stageScale - stageCenterX, y: stageCenterY - py / stageScale });
                const pos = (e) => { const r = e.currentTarget.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
                const box = frameDrag
                  ? { left: Math.min(frameDrag.x0, frameDrag.x1), top: Math.min(frameDrag.y0, frameDrag.y1), width: Math.abs(frameDrag.x1 - frameDrag.x0), height: Math.abs(frameDrag.y1 - frameDrag.y0) }
                  : frame
                    ? { left: (frame.x + stageCenterX) * stageScale, top: (stageCenterY - frame.y - frame.height) * stageScale, width: frame.width * stageScale, height: frame.height * stageScale }
                    : null;
                return (
                  <div
                    style={{ position: "absolute", inset: 0, zIndex: 100000, cursor: frameMode ? "crosshair" : "default", pointerEvents: frameMode ? "auto" : "none", overflow: "hidden" }}
                    onMouseDown={(e) => { if (!frameMode) return; const p = pos(e); setFrameDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y }); }}
                    onMouseMove={(e) => { if (frameDrag) { const p = pos(e); setFrameDrag({ ...frameDrag, x1: p.x, y1: p.y }); } }}
                    onMouseUp={() => {
                      if (!frameDrag) return;
                      const l = Math.min(frameDrag.x0, frameDrag.x1), r = Math.max(frameDrag.x0, frameDrag.x1), t = Math.min(frameDrag.y0, frameDrag.y1), b = Math.max(frameDrag.y0, frameDrag.y1);
                      setFrameDrag(null);
                      if (r - l < 6 || b - t < 6) return;
                      const a = toSk(l, b), c = toSk(r, t);
                      setFrame({ x: a.x, y: a.y, width: c.x - a.x, height: c.y - a.y });
                      setFrameMode(false);
                    }}
                  >
                    {box && <div style={{ position: "absolute", ...box, border: "2px solid #ffb347", boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)", pointerEvents: "none" }} />}
                  </div>
                );
              })()}
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
          <label className="field-label-inline" title="Busto: mesh legata a bacino e petto (il petto respira, i piedi restano fermi). Testa: mesh a tre fasce (cima, viso, mento) con cappello e barba che ondeggiano in ritardo. Si vede solo in Spine (Professional).">
            <input
              type="checkbox"
              checked={meshTorso}
              onChange={(e) => {
                setMeshTorso(e.target.checked);
                try {
                  localStorage.setItem("spine.meshTorso", e.target.checked ? "1" : "0");
                } catch {
                  /* preferenza non salvata: nessun problema */
                }
              }}
            />{" "}
            🫁 Mesh automatiche nell'export: busto che respira, cappello e barba che ondeggiano; le parti di metallo restano rigide (richiede Spine Professional — togli la spunta per Spine Essential)
          </label>
          <div className="btn-row" style={{ alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" className={`btn secondary${frameMode ? " active" : ""}`} onClick={() => setFrameMode((m) => !m)}>
              🔍 {frameMode ? "Trascina un rettangolo sull'anteprima…" : "Inquadratura"}
            </button>
            {frame && (
              <button type="button" className="btn secondary" onClick={() => { setFrame(null); setFrameMode(false); }}>
                Tutto (togli inquadratura)
              </button>
            )}
            <label className="field-label-inline">
              <input type="checkbox" checked={clipPkg} disabled={!frame} onChange={(e) => setClipPkg(e.target.checked)} /> ✂️ Ritaglia anche il pacchetto Spine
            </label>
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
  );
}
