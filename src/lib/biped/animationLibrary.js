// src/lib/biped/animationLibrary.js — LIBRERIA di animazioni elaborate per personaggi "nati
// per Spine": INTRO, ATTACCO, MAGIA, REAZIONI (sorpresa, risata, delusione).
// Ogni animazione è una sequenza di pose chiave (angoli anatomici, vedi bipedSpec.js) con i
// passaggi tipici dell'animazione 2D: anticipo, scatto, oltrepasso, assestamento, ritorno alla
// posa di riposo. Le pose si adattano al personaggio: lato dell'arma, mezzo busto o figura
// intera, bocca con varianti o no, bagliore della magia presente o no.

import { buildAnimation, restAnatomy, simulateChain } from "./poseAnimator.js";

/** Animazioni disponibili, nell'ordine in cui compaiono nell'app. */
export const ANIMATIONS = ["intro", "potere", "magia", "sorpresa", "risata", "delusione", "idle", "apertura"];

const mirror = (side) => (side === "sx" ? "dx" : "sx");

function features(rig) {
  const names = new Set(rig.json.bones.map((b) => b.name));
  const prop = ["dx", "sx"].find((s) => names.has(`oggetto_${s}`)) || null;
  const mouthSlot = rig.json.skins[0].attachments[rig.json.slots.find((s) => s.bone === "bocca")?.name || ""] || {};
  return {
    full: rig.meta.body === "full",
    prop,
    weaponSide: prop || "dx",
    mouth: new Set(Object.keys(mouthSlot).map((k) => k.replace(/^bocca_/, ""))),
    fx: ["sx", "dx"].filter((s) => rig.json.slots.some((sl) => sl.bone === `fx_${s}`)),
    H: rig.json.skeleton.height
  };
}

/** Bocca solo se il kit ha quella variante. */
const mouthIf = (F, v) => (F.mouth.has(v) ? { mouth: v } : {});

// entrata su ARCO (non in verticale "a binario"): parte un po' di lato, sale curvando, atterra al centro
export function introSpec(rig) {
  const F = features(rig), H = F.H, rest = restAnatomy(rig.json);
  const a = (side, o, f = rest[`avambraccio_${side}`]) => ({ [`omero_${side}`]: o, [`avambraccio_${side}`]: f });
  const feet = (y) => (F.full ? { foot_sx: { x: 0, y }, foot_dx: { x: 0, y } } : {});
  return {
    name: "intro",
    keys: [
      { t: 0, ease: "out", pose: { jump: { x: -0.07 * H, y: -0.55 * H }, squash: { x: 0.94, y: 1.08 }, ...a("sx", 150, 20), ...a("dx", 150, 20), ...feet(0), ...mouthIf(F, "open"), brows: 0.8 } },
      { t: 0.32, ease: "in", pose: { jump: { x: 0.02 * H, y: 0.07 * H }, squash: { x: 0.92, y: 1.1 }, ...a("sx", 165, 10), ...a("dx", 165, 10), ...feet(0.06 * H), ...mouthIf(F, "open"), brows: 1 } },
      { t: 0.5, ease: "out", pose: { jump: { x: 0, y: 0 }, body: { x: 0, y: F.full ? -0.05 * H : -0.02 * H }, squash: { x: 1.12, y: 0.88 }, ...a("sx", 70, 30), ...a("dx", 70, 30), testa: -6, look: { x: 0, y: -0.5 }, ...feet(0) } },
      { t: 0.68, ease: "inOut", pose: { body: { x: 0, y: 0.01 * H }, squash: { x: 0.97, y: 1.03 }, ...a("sx", 40, -60), ...a("dx", 100, 60), testa: 4, look: { x: 0.2, y: 0.1 }, ...feet(0) } },
      { t: 0.95, ease: "out", pose: { ...a(F.weaponSide, 125, 45), [`mano_${F.weaponSide}`]: 25, ...a(mirror(F.weaponSide), 35, -105), testa: 8, look: { x: 0.45, y: 0.1 }, brows: 0.5, ...mouthIf(F, "smile"), ...feet(0) } },
      { t: 1.45, ease: "inOut", pose: { ...a(F.weaponSide, 120, 40), [`mano_${F.weaponSide}`]: 18, ...a(mirror(F.weaponSide), 35, -100), testa: 6, look: { x: 0.35, y: 0 }, brows: 0.4, ...mouthIf(F, "smile"), ...feet(0) } },
      { t: 1.85, ease: "inOut", pose: {} }
    ],
    blinks: [1.2]
  };
}

export function attackSpec(rig) {
  const F = features(rig), H = F.H, s = F.weaponSide, o = mirror(s);
  const lean = s === "dx" ? 1 : -1; // + = verso il lato dx del personaggio
  const dir = s === "dx" ? -1 : 1; // x verso il lato dell'arma
  const foot = (x, y) => (F.full ? { [`foot_${s}`]: { x: x * dir, y } } : {});
  return {
    name: "attacco",
    keys: [
      { t: 0, ease: "in", pose: {} },
      // anticipo: carica all'indietro, sguardo sul bersaglio, sopracciglia giù
      { t: 0.38, ease: "in", pose: { torace: -8 * lean, bacino: -3 * lean, body: { x: -0.03 * H * dir, y: -0.01 * H }, [`omero_${s}`]: 165, [`avambraccio_${s}`]: 80, [`mano_${s}`]: -35, [`omero_${o}`]: 55, [`avambraccio_${o}`]: 40, testa: -4 * lean, look: { x: 0.6 * dir * -1, y: 0 }, brows: -0.8, ...mouthIf(F, "neutral"), ...foot(-0.02 * H, 0) } },
      // colpo: scatto, arma allungata (smear) e corpo in avanti
      { t: 0.46, ease: "snap", pose: { torace: 18 * lean, bacino: 6 * lean, body: { x: 0.06 * H * dir, y: -0.02 * H }, squash: { x: 1.05, y: 0.96 }, [`omero_${s}`]: 15, [`avambraccio_${s}`]: 5, [`mano_${s}`]: 35, [`smear_${s}`]: 1.4, [`omero_${o}`]: 80, [`avambraccio_${o}`]: 60, testa: 10 * lean, look: { x: 0.8 * dir * -1, y: -0.1 }, brows: -1, ...mouthIf(F, "open"), ...foot(0.1 * H, 0) } },
      // oltrepasso
      { t: 0.53, ease: "out", pose: { torace: 22 * lean, bacino: 8 * lean, body: { x: 0.07 * H * dir, y: -0.025 * H }, [`omero_${s}`]: -15, [`avambraccio_${s}`]: 10, [`mano_${s}`]: 45, [`smear_${s}`]: 1, [`omero_${o}`]: 75, [`avambraccio_${o}`]: 55, testa: 12 * lean, brows: -1, ...mouthIf(F, "open"), ...foot(0.1 * H, 0) } },
      // assestamento con il peso
      { t: 0.95, ease: "inOut", pose: { torace: 8 * lean, body: { x: 0.03 * H * dir, y: -0.01 * H }, [`omero_${s}`]: 35, [`avambraccio_${s}`]: 35, [`mano_${s}`]: 15, [`omero_${o}`]: 40, [`avambraccio_${o}`]: 20, testa: 4 * lean, brows: -0.4, ...mouthIf(F, "neutral"), ...foot(0.1 * H, 0) } },
      { t: 1.45, ease: "inOut", pose: {} }
    ],
    blinks: [1.1]
  };
}

export function magicSpec(rig) {
  const F = features(rig), H = F.H;
  const both = (o, f, m, reach) => ({ omero_sx: o, omero_dx: o, avambraccio_sx: f, avambraccio_dx: f, mano_sx: m, mano_dx: m, ...(reach ? { reach_sx: reach, reach_dx: reach } : {}) });
  const fx = (alpha, scale) => Object.fromEntries(F.fx.map((s) => [`fx_${s}`, { alpha, scale }]));
  return {
    name: "magia",
    keys: [
      { t: 0, ease: "inOut", pose: {} },
      // raccolta: mani al petto, sguardo sulle mani, il bagliore nasce
      { t: 0.45, ease: "inOut", pose: { ...both(50, -115, 25), testa: 0, look: { x: 0, y: -0.5 }, brows: -0.3, ...fx(0.7, 0.7), ...mouthIf(F, "neutral") } },
      // carica: si abbassa, il bagliore cresce
      { t: 0.78, ease: "in", pose: { ...both(45, -125, 30), body: { x: 0, y: -0.03 * H }, squash: { x: 1.05, y: 0.95 }, look: { x: 0, y: -0.6 }, brows: -0.6, ...fx(1, 1.1) } },
      // lancio: braccia avanti verso chi guarda (accorciate), esplosione di luce
      { t: 0.88, ease: "snap", pose: { ...both(105, 8, -25, 0.78), body: { x: 0, y: 0.025 * H }, squash: { x: 0.95, y: 1.06 }, testa: 0, look: { x: 0, y: 0.2 }, brows: 0.8, ...fx(1, 2.4), ...mouthIf(F, "open") } },
      { t: 1.08, ease: "out", pose: { ...both(100, 12, -20, 0.8), body: { x: 0, y: 0.01 * H }, look: { x: 0, y: 0.1 }, brows: 0.6, ...fx(0, 3.2), ...mouthIf(F, "open") } },
      { t: 1.55, ease: "inOut", pose: { ...both(40, 25, 0), brows: 0.2, ...fx(0, 0.4), ...mouthIf(F, "smile") } },
      { t: 1.95, ease: "inOut", pose: {} }
    ],
    blinks: [1.65]
  };
}

export function surpriseSpec(rig) {
  const F = features(rig), H = F.H;
  return {
    name: "sorpresa",
    keys: [
      { t: 0, ease: "in", pose: {} },
      { t: 0.08, ease: "snap", pose: { body: { x: 0, y: -0.012 * H }, squash: { x: 1.03, y: 0.97 }, brows: -0.2 } },
      // sobbalzo: indietro e su, mani verso il viso, sopracciglia alte, bocca a "O"
      { t: 0.18, ease: "out", pose: { ...(F.full ? { jump: { x: 0, y: 0.03 * H } } : {}), body: { x: 0, y: F.full ? 0 : 0.035 * H }, squash: { x: 0.94, y: 1.08 }, omero_sx: 75, omero_dx: 75, avambraccio_sx: 115, avambraccio_dx: 115, mano_sx: 30, mano_dx: 30, testa: -6, look: { x: 0, y: 0.3 }, brows: 1, ...mouthIf(F, "o") } },
      { t: 0.34, ease: "inOut", pose: { body: { x: 0, y: 0.01 * H }, squash: { x: 1.02, y: 0.98 }, omero_sx: 65, omero_dx: 65, avambraccio_sx: 105, avambraccio_dx: 105, mano_sx: 20, mano_dx: 20, testa: -3, look: { x: 0, y: 0.2 }, brows: 0.9, ...mouthIf(F, "o") } },
      { t: 1.0, ease: "inOut", pose: { omero_sx: 62, omero_dx: 62, avambraccio_sx: 100, avambraccio_dx: 100, mano_sx: 18, mano_dx: 18, testa: -2, look: { x: 0.2, y: 0.15 }, brows: 0.85, ...mouthIf(F, "o") } },
      { t: 1.45, ease: "inOut", pose: {} }
    ],
    blinks: [0.62]
  };
}

export function laughSpec(rig) {
  const F = features(rig), H = F.H;
  // mano sulla pancia senza attraversare il busto (le braccia in mesh pesata non devono incrociare il corpo)
  const base = { omero_dx: 22, avambraccio_dx: -75, mano_dx: 10, omero_sx: 45, avambraccio_sx: 60, mano_sx: 20 };
  const keys = [{ t: 0, ease: "inOut", pose: {} }, { t: 0.22, ease: "out", pose: { ...base, testa: -10, look: { x: 0, y: 0.35 }, brows: 0.5, body: { x: 0, y: 0.01 * H }, ...mouthIf(F, "open") } }];
  // scosse delle spalle: rapide, smorzate (risata), bocca che alterna aperta/sorriso
  for (let i = 0; i < 7; i++) {
    const t = 0.32 + i * 0.13, damp = 1 - i / 9, up = i % 2 === 0;
    keys.push({ t: +t.toFixed(3), ease: "inOut", pose: { ...base, testa: (up ? -12 : -7) * damp, look: { x: 0, y: 0.3 * damp }, brows: 0.5, body: { x: 0, y: (up ? 0.022 : -0.004) * H * damp }, squash: { x: up ? 0.97 : 1.03, y: up ? 1.03 : 0.97 }, ...mouthIf(F, up ? "open" : "smile") } });
  }
  keys.push({ t: 1.45, ease: "inOut", pose: { ...base, testa: -4, brows: 0.3, ...mouthIf(F, "smile") } });
  keys.push({ t: 1.85, ease: "inOut", pose: {} });
  return { name: "risata", keys, blinks: [1.5] };
}

export function disappointmentSpec(rig) {
  const F = features(rig), H = F.H;
  const slump = { omero_sx: 8, omero_dx: 8, avambraccio_sx: 4, avambraccio_dx: 4, mano_sx: -5, mano_dx: -5 };
  return {
    name: "delusione",
    keys: [
      { t: 0, ease: "inOut", pose: {} },
      // sospiro: prima si gonfia un attimo, poi si accascia lentamente
      { t: 0.35, ease: "inOut", pose: { squash: { x: 1.02, y: 1.03 }, body: { x: 0, y: 0.008 * H }, look: { x: 0, y: 0.2 }, brows: 0.3 } },
      { t: 1.0, ease: "out", pose: { ...slump, squash: { x: 1.03, y: 0.94 }, body: { x: 0, y: -0.035 * H }, testa: 7, look: { x: -0.2, y: -0.8 }, brows: -0.5, ...mouthIf(F, "sad") } },
      { t: 1.7, ease: "inOut", pose: { ...slump, squash: { x: 1.03, y: 0.95 }, body: { x: 0, y: -0.03 * H }, testa: 8, look: { x: -0.25, y: -0.75 }, brows: -0.5, ...mouthIf(F, "sad") } },
      { t: 2.2, ease: "inOut", pose: {} }
    ],
    blinks: [1.3]
  };
}

const SPECS = { intro: introSpec, attacco: attackSpec, potere: powerSpec, idle: idleSpec, apertura: openArmsSpec, magia: magicSpec, sorpresa: surpriseSpec, risata: laughSpec, delusione: disappointmentSpec };

/** Aggiunge allo skeleton le animazioni richieste (default: tutte). */
export function addLibraryAnimations(rig, names = ANIMATIONS) {
  const report = [];
  for (const n of names) {
    if (n === "idle") { report.push(buildIdle(rig)); continue; }
    const spec = SPECS[n](rig);
    report.push(buildAnimation(rig, spec));
  }
  return report;
}

/**
 * POTERE (al posto dell'attacco, regola "mai ostile verso il giocatore"): raccoglie l'energia al petto,
 * poi SOLLEVA un braccio sopra la testa e mostra il potere (bagliore che cresce) mentre l'altro braccio
 * si apre di lato; nessun gesto verso chi guarda. Anticipo → slancio → oltrepasso → tenuta → ritorno.
 */
export function powerSpec(rig) {
  const F = features(rig), H = F.H, s = F.weaponSide, o = mirror(s);
  const lean = s === "dx" ? 1 : -1;
  const fx = (alpha, scale) => (F.fx.includes(s) ? { [`fx_${s}`]: { alpha, scale } } : {});
  return {
    name: "potere",
    keys: [
      { t: 0, ease: "inOut", pose: {} },
      // anticipo: si abbassa appena, le mani si raccolgono davanti alla vita
      { t: 0.35, ease: "in", pose: { body: { x: 0, y: -0.02 * H }, squash: { x: 1.03, y: 0.97 }, [`omero_${s}`]: 30, [`avambraccio_${s}`]: 70, [`mano_${s}`]: 20, [`omero_${o}`]: 25, [`avambraccio_${o}`]: 60, torace: -3 * lean, testa: 3, ...fx(0.5, 0.6) } },
      // slancio: braccio su, palmo al cielo, corpo che sale e si allunga
      { t: 0.55, ease: "snap", pose: { body: { x: 0, y: 0.025 * H }, squash: { x: 0.97, y: 1.04 }, [`omero_${s}`]: 168, [`avambraccio_${s}`]: 12, [`mano_${s}`]: -25, [`omero_${o}`]: 55, [`avambraccio_${o}`]: 25, [`mano_${o}`]: -15, torace: 6 * lean, testa: -6, ...fx(1, 1.6) } },
      // oltrepasso e assestamento
      { t: 0.68, ease: "out", pose: { body: { x: 0, y: 0.03 * H }, squash: { x: 0.98, y: 1.03 }, [`omero_${s}`]: 172, [`avambraccio_${s}`]: 6, [`mano_${s}`]: -30, [`omero_${o}`]: 60, [`avambraccio_${o}`]: 22, [`mano_${o}`]: -20, torace: 8 * lean, testa: -8, ...fx(1, 2.1) } },
      { t: 1.25, ease: "inOut", pose: { body: { x: 0, y: 0.02 * H }, [`omero_${s}`]: 166, [`avambraccio_${s}`]: 10, [`mano_${s}`]: -22, [`omero_${o}`]: 52, [`avambraccio_${o}`]: 26, [`mano_${o}`]: -14, torace: 6 * lean, testa: -5, ...fx(0.9, 1.8) } },
      { t: 1.75, ease: "inOut", pose: { ...fx(0, 0.5) } },
      { t: 2.0, ease: "inOut", pose: {} }
    ],
    blinks: [1.45]
  };
}

/**
 * IDLE lungo e desincronizzato (tutorial "revisione": niente loop corto in cui tutto succede insieme):
 * 6 s, respiro (petto che si alza) con periodo diverso dall'ondeggio del busto e della testa, braccia
 * rilassate con micro-movimenti sfasati, un solo battito irregolare. Loop chiuso.
 */
export function idleSpec(rig) {
  const F = features(rig), H = F.H;
  const breath = (k) => ({ squash: { x: 1 + 0.006 * k, y: 1 + 0.014 * k }, body: { x: 0, y: 0.003 * H * k } });
  return {
    name: "idle",
    loop: true,
    keys: [
      { t: 0, ease: "inOut", pose: {} },
      { t: 1.1, ease: "inOut", pose: { ...breath(1), torace: 1.2, testa: -1.5, omero_sx: 3, omero_dx: -1, avambraccio_sx: 4 } },
      { t: 2.3, ease: "inOut", pose: { ...breath(0), torace: 0.4, testa: 1.8, omero_sx: 1, omero_dx: 2, avambraccio_dx: 5 } },
      { t: 3.2, ease: "inOut", pose: { ...breath(1), torace: -1.2, testa: 2.5, omero_sx: -1, omero_dx: 3, mano_dx: 4 } },
      { t: 4.6, ease: "inOut", pose: { ...breath(0.2), torace: -0.6, testa: -1, omero_sx: 2, omero_dx: 1, mano_sx: -3 } },
      { t: 6.0, ease: "inOut", pose: {} }
    ],
    blinks: [2.7]
  };
}

/**
 * IDLE "da animatore" con i numeri degli esempi ufficiali Spine (spineboy, hero, mix-and-match, owl):
 * ogni osso ha il SUO ciclo (periodo, fase, ampiezza), non pose comuni a tutti:
 *  - bacino: su/giù ~1,2% dell'altezza (2 respiri per ciclo) e di lato ~0,6% (spostamento del peso),
 *    rotazione ±1,2°;
 *  - torace: ±2,2° in ritardo sul bacino; respiro in scala (testa e braccia non ereditano la scala);
 *  - testa: ±3° in ritardo sul torace;
 *  - braccia: omero ±7°, avambraccio ±11°, mano ±6°, i figli in ritardo (overlap) e i due lati sfasati;
 *  - catene (capelli, ciocche, mantello): ondeggio con ritardo a cascata + inerzia dal corpo.
 * Durata 3,2 s, loop chiuso (tutte le onde hanno periodi che dividono la durata): come negli esempi
 * ufficiali il loop non parte per forza dalla posa di riposo. Un battito.
 */
export function buildIdle(rig, D = 3.2) {
  const json = rig.json, H = json.skeleton.height;
  // battito e struttura dal motore (pose ferme), poi i cicli per osso
  const rep = buildAnimation(rig, { name: "idle", loop: true, secondary: false, keys: [{ t: 0, ease: "inOut", pose: {} }, { t: D, ease: "inOut", pose: {} }], blinks: [1.9] });
  const anim = json.animations.idle;
  const has = new Set(json.bones.map((b) => b.name));
  const N = 32; // campioni per ciclo intero
  const wave = (amp, cycles, phase, delay = 0) => (t) => amp * Math.sin(2 * Math.PI * (cycles * (t - delay) / D) + phase);
  const rot = (bone, f) => {
    if (!has.has(bone)) return;
    const keys = [];
    for (let k = 0; k <= N; k++) { const t = (k / N) * D; keys.push({ time: +t.toFixed(4), value: +f(t).toFixed(3) }); } // onde simmetriche: il loop si chiude (D è multiplo dei periodi)
    (anim.bones[bone] ||= {}).rotate = keys;
  };
  const tr = (bone, fx, fy) => {
    if (!has.has(bone)) return;
    const keys = [];
    for (let k = 0; k <= N; k++) { const t = (k / N) * D; keys.push({ time: +t.toFixed(4), x: +fx(t).toFixed(3), y: +fy(t).toFixed(3) }); }
    (anim.bones[bone] ||= {}).translate = keys;
  };
  const sc = (bone, fx, fy) => {
    if (!has.has(bone)) return;
    const keys = [];
    for (let k = 0; k <= N; k++) { const t = (k / N) * D; keys.push({ time: +t.toFixed(4), x: +fx(t).toFixed(4), y: +fy(t).toFixed(4) }); }
    (anim.bones[bone] ||= {}).scale = keys;
  };
  // bacino: peso (1 ciclo di lato) + respiro (2 cicli in su/giù)
  tr("bacino", wave(0.006 * H, 1, 0), (t) => -0.006 * H + wave(0.006 * H, 2, Math.PI / 2)(t));
  rot("bacino", wave(1.2, 1, 0.4));
  rot("torace", wave(2.2, 1, 0.4, 0.18));
  sc("torace", (t) => 1 + wave(0.004, 2, Math.PI / 2, 0.1)(t), (t) => 1 + wave(0.011, 2, Math.PI / 2, 0.1)(t));
  rot("testa", (t) => wave(3, 1, 0.4, 0.38)(t) + wave(0.8, 2, 1.1)(t));
  for (const [sd, ph] of [["sx", 0.3], ["dx", 2.2]]) {
    // vista frontale: l'oscillazione delle braccia è nel piano (apre/chiude), quindi più contenuta che
    // negli esempi di profilo, altrimenti le braccia "sbattono"
    rot(`omero_${sd}`, wave(3.5, 1, ph, 0.05));
    rot(`avambraccio_${sd}`, wave(6, 1, ph, 0.2));
    rot(`mano_${sd}`, wave(5, 1, ph, 0.33));
  }
  // catene: ondeggio a cascata (ampiezze dagli esempi: ciocche 6–16°, mantello ~5°)
  const WIND = { hair: { amp: 3.5, cycles: 1 }, cape: { amp: 1.5, cycles: 1 }, sleeve: { amp: 6, cycles: 1 }, tail: { amp: 10, cycles: 1 }, ribbon: { amp: 10, cycles: 2 } };
  rig.meta.chains.forEach((ch, i) => {
    const w = WIND[ch.kind] || WIND.hair;
    const front = /front/.test(ch.name);
    simulateChain(json, "idle", { ...ch, wind: { amp: front ? w.amp * 1.2 : w.amp, period: D / w.cycles, phase: i * 1.3 } }, D, true);

  });
  return rep;
}

/**
 * APERTURA A T (braccia spalancate, "eccomi" / vincita): anticipo (braccia che si chiudono e corpo che
 * scende), slancio con le braccia orizzontali, oltrepasso con i polsi in ritardo (le mani "frustano"),
 * assestamento, tenuta con respiro, ritorno. Overlap a cascata: avambraccio e mano dopo l'omero.
 */
export function openArmsSpec(rig) {
  const F = features(rig), H = F.H;
  const arms = (o, f, m) => ({ omero_sx: o, omero_dx: o, avambraccio_sx: f, avambraccio_dx: f, mano_sx: m, mano_dx: m });
  return {
    name: "apertura",
    overlap: { avambraccio_sx: 0.04, avambraccio_dx: 0.05, mano_sx: 0.08, mano_dx: 0.09, testa: 0.07 },
    keys: [
      { t: 0, ease: "inOut", pose: {} },
      // anticipo: le braccia si stringono al corpo, gomiti piegati, il corpo scende e si raccoglie
      { t: 0.32, ease: "in", pose: { ...arms(8, 35, 15), body: { x: 0, y: -0.018 * H }, squash: { x: 1.03, y: 0.97 }, testa: 4 } },
      // slancio: braccia aperte a T, corpo che sale, testa appena indietro
      { t: 0.52, ease: "snap", pose: { ...arms(92, 4, -8), body: { x: 0, y: 0.022 * H }, squash: { x: 0.98, y: 1.03 }, testa: -5 } },
      // oltrepasso: braccia un po' oltre l'orizzontale, polsi che arrivano dopo
      { t: 0.66, ease: "out", pose: { ...arms(100, -4, -22), body: { x: 0, y: 0.026 * H }, testa: -7 } },
      // assestamento e tenuta (respiro)
      { t: 0.95, ease: "inOut", pose: { ...arms(90, 2, -12), body: { x: 0, y: 0.015 * H }, testa: -4 } },
      { t: 1.5, ease: "inOut", pose: { ...arms(93, 0, -14), body: { x: 0, y: 0.02 * H }, squash: { x: 1.004, y: 1.012 }, testa: -5 } },
      { t: 2.0, ease: "inOut", pose: { ...arms(90, 3, -10), body: { x: 0, y: 0.014 * H }, testa: -3 } },
      // ritorno: le braccia scendono, mani in ritardo
      { t: 2.55, ease: "inOut", pose: {} }
    ],
    blinks: [1.7]
  };
}
