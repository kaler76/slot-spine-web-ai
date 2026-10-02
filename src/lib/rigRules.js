// src/lib/rigRules.js — regole di rig "anatomiche" per i character (ruoli, pivot
// alle articolazioni, gerarchia). Derivate dalla correzione manuale di Sym11 (v2):
//  - il braccio ruota attorno al centro della spalla, non a un angolo dell'immagine;
//  - la testa ruota attorno alla base del collo, non al centro del volto;
//  - capelli, orecchini e copricapo sono figli della testa (la seguono), anche se
//    disegnati dietro al busto (lo z/draw order resta quello della parte).
// Tutte le funzioni sono pure; il caricamento dei pixel è in loadPartMask.
// Le modifiche proposte preservano la posa di riposo: ogni immagine resta nello
// stesso punto del mondo, cambiano solo pivot, genitore e offset locali.

import { anchorToFraction } from "./characterSkeleton.js";

/** Versione delle regole: va incrementata a ogni modifica di euristiche/soglie (finisce nel registro correzioni). */
export const RULES_VERSION = "2026-10-01.2";

export const PART_ROLES = ["torso", "head", "arm", "forearm", "hand", "hair", "earring", "headdress", "accessory", "other", "eye", "eyebrow", "mouth"];

export const ROLE_LABELS = {
  torso: "Busto",
  head: "Testa",
  arm: "Braccio",
  forearm: "Avambraccio",
  hand: "Mano",
  hair: "Capelli",
  earring: "Orecchino/pendente",
  headdress: "Copricapo",
  accessory: "Accessorio",
  other: "Altro",
  eye: "Occhio",
  eyebrow: "Sopracciglio",
  mouth: "Bocca"
};

/** Ruoli che seguono la testa (diventano suoi figli). */
const HEAD_FOLLOWERS = new Set(["hair", "earring", "headdress", "eye", "eyebrow", "mouth"]);

const ALPHA_MIN = 128;

/** Carica l'immagine di una parte e ne restituisce la maschera alpha binaria. */
export function loadPartMask(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, w, h).data;
      const mask = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) mask[i] = data[i * 4 + 3] >= ALPHA_MIN ? 1 : 0;
      resolve({ w, h, mask });
    };
    img.onerror = () => reject(new Error(`Immagine non caricabile: ${url}`));
    img.src = url;
  });
}

// ---------------------------------------------------------------- geometria

/** Trasformazione mondo di riposo di ogni bone (y verso l'alto, gradi antiorari). */
export function restWorld(parts) {
  const byKey = Object.fromEntries(parts.map((p) => [p.partKey, p]));
  const world = {};
  const resolve = (key, seen = new Set()) => {
    if (world[key]) return world[key];
    const p = byKey[key];
    if (!p || seen.has(key)) return { x: 0, y: 0, angle: 0 };
    seen.add(key);
    const parent = p.parentKey && p.parentKey !== "root" && byKey[p.parentKey] ? resolve(p.parentKey, seen) : { x: 0, y: 0, angle: 0 };
    const r = (parent.angle * Math.PI) / 180;
    const ox = p.offsetX || 0;
    const oy = p.offsetY || 0;
    world[key] = {
      x: parent.x + ox * Math.cos(r) - oy * Math.sin(r),
      y: parent.y + ox * Math.sin(r) + oy * Math.cos(r),
      angle: parent.angle + (p.rotation || 0)
    };
    return world[key];
  };
  for (const p of parts) resolve(p.partKey);
  return world;
}

/** Punto (u,v) dell'immagine (frazioni 0..1, v verso il basso) in coordinate mondo di riposo. */
function imagePointToWorld(p, bone, u, v) {
  const { fracX, fracY } = anchorToFraction(p.anchorX, p.anchorY, p.pivotFx, p.pivotFy);
  const lx = (u - fracX) * p.width;
  const ly = (fracY - v) * p.height;
  const r = (bone.angle * Math.PI) / 180;
  return { x: bone.x + lx * Math.cos(r) - ly * Math.sin(r), y: bone.y + lx * Math.sin(r) + ly * Math.cos(r) };
}

/** Bounding box mondo (asse-allineato) dell'immagine di una parte a riposo. */
function worldBox(p, bone) {
  const pts = [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1]
  ].map(([u, v]) => imagePointToWorld(p, bone, u, v));
  const xs = pts.map((q) => q.x);
  const ys = pts.map((q) => q.y);
  const box = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  box.cx = (box.minX + box.maxX) / 2;
  box.cy = (box.minY + box.maxY) / 2;
  box.w = box.maxX - box.minX;
  box.h = box.maxY - box.minY;
  box.area = p.width * p.height;
  return box;
}

function overlapArea(a, b) {
  const w = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const h = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
  return w > 0 && h > 0 ? w * h : 0;
}

// ---------------------------------------------------------------- ruoli

/**
 * Propone un ruolo per ogni parte senza ruolo, solo da geometria e draw order
 * della posa di riposo. È un suggerimento: l'utente lo conferma/corregge.
 * @returns {Record<string,string>} partKey -> ruolo
 */
export function guessRoles(parts) {
  const world = restWorld(parts);
  const boxes = Object.fromEntries(parts.map((p) => [p.partKey, worldBox(p, world[p.partKey])]));
  const roles = {};
  for (const p of parts) if (p.role) roles[p.partKey] = p.role;

  const free = () => parts.filter((p) => !roles[p.partKey]);
  const keyOf = (role) => Object.keys(roles).find((k) => roles[k] === role);

  if (!keyOf("torso")) {
    // Busto = tra le parti grandi (>= 50% della più grande) quella che arriva più in basso
    // (bordo inferiore, la vita). Non semplicemente la più grande: un copricapo di piume
    // può superarlo in area; né il centro più basso: un braccio lungo può scendere quasi
    // quanto il busto (entrambi casi di Sym5).
    const maxArea = Math.max(...free().map((p) => boxes[p.partKey].area));
    const t = free()
      .filter((p) => boxes[p.partKey].area >= 0.5 * maxArea)
      .sort((a, b) => boxes[a.partKey].minY - boxes[b.partKey].minY)[0];
    if (t) roles[t.partKey] = "torso";
  }
  const torsoKey = keyOf("torso");
  if (!torsoKey) return roles;
  const T = boxes[torsoKey];
  const torsoZ = parts.find((p) => p.partKey === torsoKey).zIndex || 0;

  if (!keyOf("head")) {
    const cands = free().filter((p) => {
      const b = boxes[p.partKey];
      const rel = b.area / T.area;
      const aspect = Math.max(b.w, b.h) / Math.max(1, Math.min(b.w, b.h));
      return b.cy > T.cy + 0.35 * T.h && rel >= 0.05 && rel <= 0.6 && aspect < 1.8 && b.maxX > T.minX && b.minX < T.maxX;
    });
    cands.sort((a, b) => boxes[a.partKey].cy - boxes[b.partKey].cy);
    if (cands[0]) roles[cands[0].partKey] = "head";
  }
  const headKey = keyOf("head");
  const H = headKey ? boxes[headKey] : null;
  const headZ = headKey ? parts.find((p) => p.partKey === headKey).zIndex || 0 : 0;

  for (const p of free()) {
    const b = boxes[p.partKey];
    const z = p.zIndex || 0;
    if (H) {
      const ov = overlapArea(b, H) / Math.max(1, Math.min(b.area, H.area));
      const nearHead = b.cx > H.minX - 0.25 * H.w && b.cx < H.maxX + 0.25 * H.w && b.cy > H.minY - 0.25 * H.h && b.cy < H.maxY;
      // Pendenti/orecchini: piccoli rispetto alla testa e vicini a essa (Sym11 ~0.1, Sym5 ~0.37 dell'area testa)
      if (b.area < 0.45 * H.area && nearHead) {
        roles[p.partKey] = "earring";
        continue;
      }
      if (z < torsoZ && ov > 0.5) {
        roles[p.partKey] = "hair";
        continue;
      }
      if (z > headZ && ov > 0.3 && b.cy > H.cy) {
        roles[p.partKey] = "headdress";
        continue;
      }
    }
    const aspect = Math.max(b.w, b.h) / Math.max(1, Math.min(b.w, b.h));
    if (aspect > 1.3 && overlapArea(b, T) > 0 && z > torsoZ && (!H || b.cy < H.minY)) {
      roles[p.partKey] = "arm";
      continue;
    }
    roles[p.partKey] = "other";
  }
  return roles;
}

// ---------------------------------------------------------------- pivot

/** Distanza chamfer (3-4) dal bordo della maschera: valori alti = centro di masse "spesse". */
function distanceTransform({ w, h, mask }) {
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = mask[i] ? INF : 0;
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x]);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], at(x - 1, y) + 3, at(x, y - 1) + 3, at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4);
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], at(x + 1, y) + 3, at(x, y + 1) + 3, at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4);
    }
  return d;
}

/** Base del collo: centro dei pixel nella fascia più bassa dell'immagine, poco sopra il bordo. */
function neckBasePivot({ w, h, mask }) {
  let bottom = -1;
  for (let y = h - 1; y >= 0 && bottom < 0; y--) for (let x = 0; x < w; x++) if (mask[y * w + x]) { bottom = y; break; }
  if (bottom < 0) return null;
  const band = Math.max(2, Math.round(0.08 * h));
  let sx = 0, n = 0;
  for (let y = bottom - band; y <= bottom; y++) for (let x = 0; x < w; x++) if (y >= 0 && mask[y * w + x]) { sx += x; n++; }
  if (!n) return null;
  return { fx: sx / n / w, fy: Math.max(0, bottom - band) / h };
}

/** Attacco in alto (orecchini/pendenti): centro della fascia superiore. */
function topAttachPivot({ w, h, mask }) {
  let top = -1;
  for (let y = 0; y < h && top < 0; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) { top = y; break; }
  if (top < 0) return null;
  const band = Math.max(2, Math.round(0.05 * h));
  let sx = 0, n = 0;
  for (let y = top; y <= Math.min(h - 1, top + band); y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) { sx += x; n++; }
  return n ? { fx: sx / n / w, fy: top / h } : null;
}

/**
 * Articolazione di un arto: nell'estremità più vicina al punto d'attacco (es. la
 * cima del busto) cerca il pixel più "interno" (massimo della distance transform):
 * è il centro del tappo arrotondato della spalla.
 * @param {{x:number,y:number}} target - punto d'attacco in pixel dell'immagine (y verso il basso)
 */
function jointPivot(maskData, target) {
  const { w, h, mask } = maskData;
  let minD = Infinity, maxD = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      const dd = Math.hypot(x - target.x, y - target.y);
      if (dd < minD) minD = dd;
      if (dd > maxD) maxD = dd;
    }
  if (!isFinite(minD)) return null;
  const limit = minD + 0.25 * (maxD - minD);
  const dt = distanceTransform(maskData);
  let best = -1, bx = 0, by = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i] || Math.hypot(x - target.x, y - target.y) > limit) continue;
      if (dt[i] > best) { best = dt[i]; bx = x; by = y; }
    }
  return best > 0 ? { fx: bx / w, fy: by / h } : null;
}

const round4 = (v) => Math.round(v * 10000) / 10000;

// ---------------------------------------------------------------- piano

/**
 * Calcola le modifiche di rig per tutte le parti, preservando la posa di riposo.
 * @param {Array} parts - {partKey,parentKey,width,height,offsetX,offsetY,rotation,zIndex,anchorX,anchorY,pivotFx,pivotFy,segments,role}
 * @param {Record<string,string>} roles - partKey -> ruolo (confermati o suggeriti)
 * @param {Record<string,{w,h,mask}>} masks - maschere alpha per partKey
 * @returns {Array<{partKey, role, parentKey, offsetX, offsetY, rotation, pivotFx, pivotFy, changes: string[]}>}
 */
export function planRig(parts, roles, masks) {
  const byKey = Object.fromEntries(parts.map((p) => [p.partKey, p]));
  const world = restWorld(parts);
  const keyOf = (role) => Object.keys(roles).find((k) => roles[k] === role && byKey[k]);
  const headKey = keyOf("head");
  const torsoKey = keyOf("torso");

  // 1) nuovo pivot (frazioni) e nuovo genitore per ogni parte
  const next = {};
  for (const p of parts) {
    const role = roles[p.partKey] || p.role || "other";
    const sliced = (p.segments || 1) > 1;
    let pivot = null;
    const m = masks[p.partKey];
    if (m && !sliced) {
      if (role === "head") pivot = neckBasePivot(m);
      else if (role === "earring") pivot = topAttachPivot(m);
      else if ((role === "arm" || role === "forearm" || role === "hand") && torsoKey && torsoKey !== p.partKey) {
        const parentKey = p.parentKey && p.parentKey !== "root" && byKey[p.parentKey] ? p.parentKey : torsoKey;
        const pp = byKey[parentKey];
        const pb = world[parentKey];
        // punto d'attacco: per un braccio la cima-centro del busto, per avambraccio/mano il pivot... del genitore
        const attachWorld =
          role === "arm" ? imagePointToWorld(pp, pb, 0.5, 0) : { x: pb.x, y: pb.y };
        // mondo -> pixel immagine di questa parte
        const bone = world[p.partKey];
        const { fracX, fracY } = anchorToFraction(p.anchorX, p.anchorY, p.pivotFx, p.pivotFy);
        const r = (-bone.angle * Math.PI) / 180;
        const dx = attachWorld.x - bone.x;
        const dy = attachWorld.y - bone.y;
        const lx = dx * Math.cos(r) - dy * Math.sin(r);
        const ly = dx * Math.sin(r) + dy * Math.cos(r);
        pivot = jointPivot(m, { x: fracX * p.width + lx, y: fracY * p.height - ly });
      }
    }
    let parentKey = p.parentKey || "root";
    if (HEAD_FOLLOWERS.has(role) && headKey && headKey !== p.partKey) parentKey = headKey;
    next[p.partKey] = { role, pivot, parentKey };
  }

  // evita cicli: se il nuovo genitore discende dalla parte, mantieni il vecchio
  const createsCycle = (key, parentKey) => {
    let cur = parentKey;
    const seen = new Set();
    while (cur && cur !== "root" && !seen.has(cur)) {
      if (cur === key) return true;
      seen.add(cur);
      cur = next[cur]?.parentKey;
    }
    return false;
  };
  for (const p of parts) if (createsCycle(p.partKey, next[p.partKey].parentKey)) next[p.partKey].parentKey = p.parentKey || "root";

  // 2) nuova posizione mondo del bone = punto pivot dell'immagine (immagine ferma)
  const newWorld = {};
  for (const p of parts) {
    const n = next[p.partKey];
    const bone = world[p.partKey];
    newWorld[p.partKey] = n.pivot ? { ...imagePointToWorld(p, bone, n.pivot.fx, n.pivot.fy), angle: bone.angle } : { ...bone };
  }

  // 3) offset/rotazione locali rispetto al (nuovo) genitore
  return parts.map((p) => {
    const n = next[p.partKey];
    const wb = newWorld[p.partKey];
    const pw = n.parentKey !== "root" && newWorld[n.parentKey] ? newWorld[n.parentKey] : { x: 0, y: 0, angle: 0 };
    const r = (-pw.angle * Math.PI) / 180;
    const dx = wb.x - pw.x;
    const dy = wb.y - pw.y;
    const offsetX = Math.round((dx * Math.cos(r) - dy * Math.sin(r)) * 100) / 100;
    const offsetY = Math.round((dx * Math.sin(r) + dy * Math.cos(r)) * 100) / 100;
    const rotation = Math.round((wb.angle - pw.angle) * 100) / 100;
    const pivotFx = n.pivot ? round4(n.pivot.fx) : p.pivotFx ?? null;
    const pivotFy = n.pivot ? round4(n.pivot.fy) : p.pivotFy ?? null;
    const changes = [];
    if (n.role !== p.role) changes.push(`ruolo → ${ROLE_LABELS[n.role] || n.role}`);
    if (n.parentKey !== (p.parentKey || "root")) changes.push(`genitore → ${n.parentKey}`);
    if (n.pivot) changes.push(`pivot → ${Math.round(n.pivot.fx * p.width)},${Math.round(n.pivot.fy * p.height)} px`);
    if (Math.abs(offsetX - (p.offsetX || 0)) > 0.01 || Math.abs(offsetY - (p.offsetY || 0)) > 0.01) changes.push(`offset → ${offsetX}, ${offsetY}`);
    return { partKey: p.partKey, role: n.role, parentKey: n.parentKey, offsetX, offsetY, rotation, pivotFx, pivotFy, changes };
  });
}
