// src/lib/torsoMesh.js — busto come MESH PESATA per il respiro (solo export, Spine Professional).
// Il busto (ruolo "torso", osso alle anche) diventa una griglia di vertici legata a due ossa:
//   - l'osso del busto stesso (bacino, fermo): gambe e anche, peso 1 sotto la linea delle anche;
//   - un nuovo osso "<busto>_petto" a metà tra anche e collo: torace, peso 1 dalla vita in su;
//   sfumatura tra le due nella fascia della vita.
// Testa e braccia agganciate sopra la vita passano sotto il petto, così seguono il respiro.
// Il respiro (petto che sale di poco e si allarga dell'1%) si aggiunge al loop ambient.
// L'anteprima nell'app resta rigida: la deformazione si vede in Spine.
// Puro: nessun DOM. Lavora sulla copia dello skeleton generato da buildCharacterSkeleton.

import { LOOP_SECONDS, SAMPLE_FPS } from "./characterAnimationTemplates.js";

export const TORSO_MESH_RULES = {
  cols: 6, // colonne della griglia
  rows: 10, // righe della griglia
  chestAt: 0.55, // osso petto: frazione del tratto anche -> collo
  waistFrom: 0.0, // inizio sfumatura (frazione anche -> collo): sotto, tutto bacino
  waistTo: 0.4, // fine sfumatura: sopra, tutto petto
  breathLift: 0.006, // sollevamento del petto, frazione dell'altezza del busto
  breathScale: 0.012 // allargamento del petto
};

const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/**
 * Griglia di vertici sull'immagine di una region (coordinate locali dell'osso), con il
 * contorno prima (richiesto da "hull") e gli interni dopo. weightsAt(x, y, u, v) restituisce
 * [[indiceOsso, xLocaleOsso, yLocaleOsso, peso], ...] per ogni vertice.
 */
function gridMesh(skin, name, cols, rows, weightsAt) {
  const order = [];
  for (let c = 0; c <= cols; c++) order.push([c, 0]);
  for (let r = 1; r <= rows; r++) order.push([cols, r]);
  for (let c = cols - 1; c >= 0; c--) order.push([c, rows]);
  for (let r = rows - 1; r >= 1; r--) order.push([0, r]);
  const hull = order.length;
  for (let r = 1; r < rows; r++) for (let c = 1; c < cols; c++) order.push([c, r]);
  const index = new Map(order.map(([c, r], i) => [`${c},${r}`, i]));
  const uvs = [];
  const vertices = [];
  const w = skin.width, h = skin.height;
  for (const [c, r] of order) {
    const u = c / cols, v = r / rows; // v dall'alto, come nell'atlas
    uvs.push(+u.toFixed(5), +v.toFixed(5));
    const x = skin.x - w / 2 + u * w;
    const y = skin.y + h / 2 - v * h; // locale dell'osso, y in su
    const ws = weightsAt(x, y, u, v).filter((q) => q[3] > 0);
    vertices.push(ws.length);
    for (const [bi, bx, by, wt] of ws) vertices.push(bi, +bx.toFixed(2), +by.toFixed(2), +wt.toFixed(4));
  }
  const triangles = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const a = index.get(`${c},${r}`), b = index.get(`${c + 1},${r}`);
      const d = index.get(`${c},${r + 1}`), e = index.get(`${c + 1},${r + 1}`);
      triangles.push(a, b, e, a, e, d);
    }
  return { type: "mesh", uvs, triangles, vertices, hull, width: w, height: h, name };
}

/**
 * @param {Object} skeletonJson - uscita di buildCharacterSkeleton (non modificata)
 * @param {Array<{partKey, role}>} parts - per trovare busto (torso) e testa (head)
 * @returns {{ json: Object, applied: boolean, reason?: string }}
 */
export function addTorsoBreathMesh(skeletonJson, parts, rules = TORSO_MESH_RULES) {
  const json = structuredClone(skeletonJson);
  const torso = parts.find((p) => p.role === "torso");
  if (!torso) return { json, applied: false, reason: "nessuna parte con ruolo busto" };
  const key = torso.partKey;
  const boneIdx = json.bones.findIndex((b) => b.name === key);
  const skin = json.skins?.[0]?.attachments?.[key]?.[key];
  if (boneIdx < 0 || !skin || skin.type !== "region") return { json, applied: false, reason: "busto non trovato nello skeleton" };

  // collo = osso della testa (in coordinate locali del busto); in mancanza, 80% dell'altezza
  const head = parts.find((p) => p.role === "head" && json.bones.find((b) => b.name === p.partKey)?.parent === key);
  const headBone = head && json.bones.find((b) => b.name === head.partKey);
  const neck = headBone ? { x: headBone.x || 0, y: headBone.y || 0 } : { x: 0, y: skin.y + skin.height * 0.3 };
  if (neck.y <= 0) return { json, applied: false, reason: "collo non sopra le anche" };

  const chestName = `${key}_petto`;
  const chest = { x: +(neck.x * rules.chestAt).toFixed(2), y: +(neck.y * rules.chestAt).toFixed(2) };
  json.bones.splice(boneIdx + 1, 0, { name: chestName, parent: key, x: chest.x, y: chest.y, rotation: 0 });
  const chestIdx = boneIdx + 1;

  // figli del busto sopra la vita -> figli del petto (coordinate riportate al petto)
  const waistY = neck.y * rules.waistTo;
  for (const b of json.bones) {
    if (b.parent === key && b.name !== chestName && (b.y || 0) >= waistY) {
      b.parent = chestName;
      b.x = +((b.x || 0) - chest.x).toFixed(2);
      b.y = +((b.y || 0) - chest.y).toFixed(2);
    }
  }

  const { cols, rows } = rules;
  json.skins[0].attachments[key][key] = gridMesh(skin, skin.name || key, cols, rows, (x, y) => {
    const t = smooth((y / neck.y - rules.waistFrom) / (rules.waistTo - rules.waistFrom));
    return [
      [boneIdx, x, y, 1 - t],
      [chestIdx, x - chest.x, y - chest.y, t]
    ];
  });
  const h = skin.height;

  // respiro nel loop ambient: un respiro per ciclo
  const anim = (json.animations.ambient ||= { bones: {} });
  anim.bones ||= {};
  const n = Math.round(LOOP_SECONDS * SAMPLE_FPS);
  const lift = rules.breathLift * h;
  const translate = [], scale = [];
  for (let k = 0; k <= n; k++) {
    const t = k / SAMPLE_FPS;
    const b = (1 - Math.cos((2 * Math.PI * t) / LOOP_SECONDS)) / 2; // 0 -> 1 -> 0
    translate.push({ time: +t.toFixed(4), x: 0, y: +(lift * b).toFixed(3) });
    scale.push({ time: +t.toFixed(4), x: +(1 + rules.breathScale * b).toFixed(4), y: +(1 + (rules.breathScale / 2) * b).toFixed(4) });
  }
  anim.bones[chestName] = { translate, scale };
  return { json, applied: true };
}

// ---------------------------------------------------------------- testa
export const HEAD_MESH_RULES = {
  cols: 6,
  rows: 12,
  // frazioni dell'altezza dell'immagine della testa, dall'ALTO
  topBone: 0.45, // osso "cima" (cappello/capelli) alla base del cappello
  topFrom: 0.35, // sopra: tutto cima
  topTo: 0.5, // sotto: niente cima
  chinBone: 0.68, // osso "mento" (barba) sotto la bocca
  chinFrom: 0.65, // sopra: niente mento
  chinTo: 0.8, // sotto: tutto mento
  topSway: 1.5, // gradi: il cappello ondeggia in ritardo (inerzia)
  topLag: 0.8, // radianti di ritardo rispetto alla testa
  chinSway: 3, // gradi: la barba dondola in ritardo
  chinLag: 1.0
};

/**
 * Testa come MESH PESATA: tre fasce verticali legate a tre ossa
 *   "<testa>_cima" (cappello/capelli), l'osso della testa (viso), "<testa>_mento" (barba/mento).
 * Cima e mento ondeggiano in ritardo sulla testa (inerzia), il viso resta rigido.
 * Fasce per proporzione dell'immagine: valide per teste "frontali" con cappello sopra e
 * barba/mento sotto; ritoccabili in Spine.
 */
export function addHeadMesh(skeletonJson, parts, rules = HEAD_MESH_RULES) {
  const json = structuredClone(skeletonJson);
  const head = parts.find((p) => p.role === "head");
  if (!head) return { json, applied: false, reason: "nessuna parte con ruolo testa" };
  const key = head.partKey;
  const boneIdx = json.bones.findIndex((b) => b.name === key);
  const skin = json.skins?.[0]?.attachments?.[key]?.[key];
  if (boneIdx < 0 || !skin || skin.type !== "region") return { json, applied: false, reason: "testa non trovata nello skeleton" };
  const h = skin.height;
  const yAt = (f) => skin.y + h / 2 - f * h; // frazione dall'alto -> y locale (su)
  const top = { x: skin.x, y: +yAt(rules.topBone).toFixed(2) };
  const chin = { x: skin.x, y: +yAt(rules.chinBone).toFixed(2) };
  const topName = `${key}_cima`, chinName = `${key}_mento`;
  json.bones.splice(boneIdx + 1, 0, { name: topName, parent: key, x: top.x, y: top.y, rotation: 0 }, { name: chinName, parent: key, x: chin.x, y: chin.y, rotation: 0 });
  const topIdx = boneIdx + 1, chinIdx = boneIdx + 2;

  // parti agganciate alla testa sopra la base del cappello (es. cappello separato) -> cima
  for (const b of json.bones) {
    if (b.parent === key && b.name !== topName && b.name !== chinName && (b.y || 0) >= top.y) {
      b.parent = topName;
      b.x = +((b.x || 0) - top.x).toFixed(2);
      b.y = +((b.y || 0) - top.y).toFixed(2);
    }
  }

  json.skins[0].attachments[key][key] = gridMesh(skin, skin.name || key, rules.cols, rules.rows, (x, y, u, v) => {
    const wt = smooth((rules.topTo - v) / (rules.topTo - rules.topFrom));
    const wc = smooth((v - rules.chinFrom) / (rules.chinTo - rules.chinFrom));
    return [
      [boneIdx, x, y, 1 - wt - wc],
      [topIdx, x - top.x, y - top.y, wt],
      [chinIdx, x - chin.x, y - chin.y, wc]
    ];
  });

  // ondeggiamento in ritardo sulla testa (stessa fase del ruolo "head" nel loop v2: 0)
  const anim = (json.animations.ambient ||= { bones: {} });
  anim.bones ||= {};
  const n = Math.round(LOOP_SECONDS * SAMPLE_FPS);
  const w = (2 * Math.PI) / LOOP_SECONDS;
  const track = (amp, lag) => {
    const out = [];
    for (let k = 0; k <= n; k++) {
      const t = k / SAMPLE_FPS;
      out.push({ time: +t.toFixed(4), angle: +(amp * Math.sin(w * t - lag)).toFixed(3) });
    }
    return out;
  };
  anim.bones[topName] = { rotate: track(rules.topSway, rules.topLag) };
  anim.bones[chinName] = { rotate: track(rules.chinSway, rules.chinLag) };
  return { json, applied: true };
}

// ---------------------------------------------------------------- materiale rigido
/**
 * Quota "metallo" di un'immagine RGBA: pixel opachi poco saturi e non scuri (acciaio, argento).
 * Serve a decidere da solo se una parte può deformarsi (stoffa, pelle, barba) o deve restare
 * rigida (elmo, corazza): una mesh che respira su una piastra di metallo la piega in modo falso.
 * Soglia tarata su due casi (folletto: 0.01 stoffa; cavaliere: 0.13-0.25 armatura): provvisoria.
 */
export const RIGID_METAL_SHARE = 0.08;
export function metalShare(rgba) {
  let n = 0, metal = 0;
  for (let i = 0; i < rgba.length; i += 4 * 3) {
    if (rgba[i + 3] < 128) continue;
    const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    n++;
    if (mx > 89 && (mx - mn) / mx < 0.2) metal++;
  }
  return n ? metal / n : 0;
}
export const isRigidMaterial = (rgba) => metalShare(rgba) >= RIGID_METAL_SHARE;
