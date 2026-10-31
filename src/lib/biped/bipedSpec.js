// src/lib/biped/bipedSpec.js — personaggi "nati per Spine": ruoli dei pezzi, gerarchia e
// LIMITI delle articolazioni. Unica fonte di verità per rig (bipedRig.js), animazioni
// (poseAnimator.js) e controlli (bipedCheck.js).
//
// Convenzioni
//  - Coordinate del KIT: pixel immagine (y verso il basso), personaggio di fronte.
//  - "sx/dx" = lato del PERSONAGGIO: il suo sinistro sta a destra per chi guarda (x maggiore).
//  - Gli angoli delle pose sono ANATOMICI e relativi al segmento genitore, come li pensa un
//    animatore: spalla 0 = braccio giù lungo il fianco, 90 = orizzontale verso l'esterno,
//    180 = in alto; gomito 0 = dritto, 150 = piegato al massimo. Il motore li converte nelle
//    rotazioni Spine del lato giusto (SIGN) e li tiene SEMPRE dentro i limiti.

export const BIPED_RULES_VERSION = "2026-10-31.biped.2";

/** Corpi supportati: mezzo busto per i simboli, figura intera per mascotte e presentatori. */
export const BODY_TYPES = ["bust", "full"];

/**
 * Pezzi del kit. `joint` = articolazione mossa dall'osso del pezzo; `from`/`to` = punti del
 * kit che definiscono l'osso (pivot → punta). Lato: chiave con suffisso _sx/_dx.
 */
export const PART_ROLES = {
  pelvis: { bodies: ["full"], bone: "bacino", from: "pelvis", to: "waist", parent: "root" },
  torso: { bodies: ["bust", "full"], bone: "torace", from: "waist", to: "neck", parent: "bacino" },
  head: { bodies: ["bust", "full"], bone: "testa", from: "neck", to: "crown", parent: "torace" },
  upper_arm: { bodies: ["bust", "full"], bone: "omero", from: "shoulder", to: "elbow", parent: "torace", sided: true },
  forearm: { bodies: ["bust", "full"], bone: "avambraccio", from: "elbow", to: "wrist", parent: "omero", sided: true },
  hand: { bodies: ["bust", "full"], bone: "mano", from: "wrist", to: "fingertip", parent: "avambraccio", sided: true },
  thigh: { bodies: ["full"], bone: "coscia", from: "hip", to: "knee", parent: "bacino", sided: true },
  shin: { bodies: ["full"], bone: "gamba", from: "knee", to: "ankle", parent: "coscia", sided: true },
  foot: { bodies: ["full"], bone: "piede", from: "ankle", to: "toe", parent: "gamba", sided: true }
};

/** Parti facoltative del viso (figlie del controllo del viso, rig "A" senza vincoli). */
export const FACE_ROLES = ["eye_sx", "eye_dx", "brow_sx", "brow_dx", "mouth"];
/** Varianti della bocca (allegati alternativi dello stesso slot). */
export const MOUTH_VARIANTS = ["neutral", "open", "o", "smile", "sad"];

/**
 * Limiti anatomici in gradi, relativi al genitore. Il motore non li supera mai
 * (clamp) e il controllo li verifica fotogramma per fotogramma.
 */
export const JOINT_LIMITS = {
  bacino: { min: -15, max: 15 }, // inclinazione laterale del bacino
  torace: { min: -25, max: 25 }, // flessione laterale del busto
  testa: { min: -30, max: 30 }, // inclinazione della testa
  omero: { min: -20, max: 175 }, // abduzione: 0 giù, 90 orizzontale, 175 in alto
  // gomito: di fronte la piega si vede in due versi (braccio ruotato): + = mano verso l'alto/
  // la testa (bicipite), − = mano verso il corpo (mani sui fianchi). Mai oltre 150: l'avambraccio
  // non attraversa l'omero.
  avambraccio: { min: -150, max: 150 },
  mano: { min: -55, max: 55 }, // polso
  coscia: { min: -20, max: 70 }, // apertura della gamba
  gamba: { min: 0, max: 140 }, // ginocchio (guidato dall'IK)
  piede: { min: -25, max: 25 }
};

/** Accorciamento lungo l'osso per simulare il braccio che punta verso chi guarda. */
export const REACH_LIMITS = { min: 0.72, max: 1.08 };

/**
 * Verso di rotazione Spine (antiorario positivo, y su) per ogni giunto e lato.
 * Esempio: alzare il braccio sinistro (a destra dello schermo) = antiorario (+);
 * il destro = orario (−). Il gomito piega l'avambraccio verso il corpo.
 */
export const SIGN = {
  omero: { sx: +1, dx: -1 },
  avambraccio: { sx: +1, dx: -1 },
  mano: { sx: +1, dx: -1 },
  coscia: { sx: +1, dx: -1 },
  gamba: { sx: -1, dx: +1 }, // di fronte il ginocchio piegato va verso l'esterno (verificato in spine-core)
  piede: { sx: +1, dx: -1 },
  bacino: { c: +1 },
  torace: { c: +1 },
  testa: { c: +1 }
};

/** Catene secondarie (capelli, mantello, coda): ossa e oscillazione massima per osso. */
export const CHAIN_DEFAULTS = {
  // manica a campana: stoffa appesa all'avambraccio, tende a ricadere verso il basso (hang) e ondeggia
  sleeve: { bones: 2, maxDeg: 75, stiffness: 95, damping: 7, hang: 0.7, parent: null },
  hair: { bones: 3, maxDeg: 8, stiffness: 260, damping: 14, parent: "testa" }, // capelli dietro: restano dietro la testa
  cape: { bones: 4, maxDeg: 22, stiffness: 110, damping: 8, parent: "torace" },
  tail: { bones: 4, maxDeg: 45, stiffness: 70, damping: 6, parent: "bacino" },
  ribbon: { bones: 3, maxDeg: 50, stiffness: 110, damping: 8, parent: "torace" }
};

/** Nome dell'osso per un ruolo e un lato: omero_sx, testa, ... */
export function boneName(role, side) {
  const r = PART_ROLES[role];
  const base = r ? r.bone : role;
  return r && r.sided ? `${base}_${side}` : base;
}

/** Ruoli obbligatori per un tipo di corpo (con lato espanso). */
export function requiredParts(body) {
  const out = [];
  for (const [role, def] of Object.entries(PART_ROLES)) {
    if (!def.bodies.includes(body)) continue;
    if (def.sided) out.push({ role, side: "sx" }, { role, side: "dx" });
    else out.push({ role });
  }
  return out;
}

/** Limita un angolo anatomico al range dell'articolazione (osso senza suffisso di lato). */
export function clampJoint(joint, deg) {
  const lim = JOINT_LIMITS[joint];
  if (!lim) return deg;
  return Math.max(lim.min, Math.min(lim.max, deg));
}

/** Articolazione e lato da un nome osso: "omero_sx" → { joint: "omero", side: "sx" } */
export function splitBone(name) {
  const m = /^(.*)_(sx|dx)$/.exec(name);
  return m ? { joint: m[1], side: m[2] } : { joint: name, side: "c" };
}
