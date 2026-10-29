// src/lib/biped/poseAnimator.js — dalle POSE CHIAVE all'animazione Spine 4.1.
// L'animazione si descrive come un animatore: poche pose (angoli anatomici, spostamenti,
// bocca, sguardo) con il loro tempo e il tipo di passaggio (anticipo lento, scatto, assestamento).
// Il motore applica da solo i principi dei tutorial (claude/REGOLE_TUTORIAL_SPINE.md):
//  - ogni angolo resta entro i LIMITI dell'articolazione (bipedSpec.JOINT_LIMITS);
//  - curve a S/di scatto per ogni passaggio, primo e ultimo fotogramma in posa di riposo
//    (così l'animazione si aggancia all'idle senza scatti);
//  - OVERLAP: mano, testa e oggetto arrivano qualche fotogramma dopo il segmento che li porta;
//  - FOLLOW-THROUGH: capelli, mantello e coda simulati come catene a molla (ritardo, inerzia,
//    oscillazioni che si spengono), poi ridotti a poche chiavi;
//  - niente shear, nessuna chiave di deformazione: solo ossa (leggero sul motore).
// Puro: nessun DOM.

import { JOINT_LIMITS, REACH_LIMITS, SIGN, clampJoint, splitBone } from "./bipedSpec.js";
import { poseAt } from "../animationSim.js";

const R2D = 180 / Math.PI;
const round = (v, n = 3) => +v.toFixed(n);
const norm = (a) => { let d = ((a + 180) % 360 + 360) % 360 - 180; return d === -180 ? 180 : d; };

/** Passaggi fra una posa e la successiva (Bézier normalizzata: tempo, valore). */
export const EASE = {
  linear: null,
  inOut: [0.45, 0, 0.55, 1], // curva a S
  out: [0.15, 0.7, 0.35, 1], // parte veloce e si assesta
  in: [0.65, 0, 0.9, 0.5], // parte lenta e accelera (anticipo → colpo)
  snap: [0.05, 0.85, 0.2, 1], // scatto: quasi tutto nel primo fotogramma
  hold: "stepped"
};

/** Rotazione anatomica di riposo di ogni articolazione, dalla posa del kit. */
export function restAnatomy(json) {
  const out = {};
  const zero = { omero: 180, coscia: 180, bacino: 90 };
  for (const b of json.bones) {
    const { joint, side } = splitBone(b.name);
    if (!JOINT_LIMITS[joint]) continue;
    const sign = SIGN[joint]?.[side] ?? SIGN[joint]?.c ?? 1;
    out[b.name] = round(sign * norm((b.rotation || 0) - (zero[joint] || 0)), 2);
  }
  return out;
}

/** Misure utili alle animazioni: unità del viso, altezza, spalle. */
export function rigMeasures(json) {
  const bone = (n) => json.bones.find((b) => b.name === n);
  const head = bone("testa");
  const eyes = ["occhio_sx", "occhio_dx"].map(bone).filter(Boolean);
  const u = eyes.length === 2 ? Math.hypot(eyes[0].x - eyes[1].x, eyes[0].y - eyes[1].y) : (head?.length || 100) * 0.35;
  return { u, headLen: head?.length || 100, height: json.skeleton.height };
}

/**
 * Costruisce UNA animazione e la aggiunge a json.animations.
 * @param {{json, meta}} rig - uscita di buildBipedSkeleton
 * @param {Object} spec - { name, loop?, keys: [{ t, pose, ease }], overlap?, blinks?, secondary? }
 * pose: { <osso>: gradi anatomici, reach_<lato>: 0.72..1.08, body: {x,y}, jump: {x,y},
 *         squash: {x,y}, look: {x,y} (-1..1), brows: -1..1, mouth: variante,
 *         fx_<lato>: {alpha, scale}, smear_<lato>: scala dell'oggetto lungo l'osso }
 * @returns {{ name, duration, clamped: string[] }}
 */
export function buildAnimation(rig, spec) {
  const { json } = rig;
  const rest = restAnatomy(json);
  const m = rigMeasures(json);
  const has = new Set(json.bones.map((b) => b.name));
  const boneLen = Object.fromEntries(json.bones.map((b) => [b.name, b.length || 0]));
  const keys = [...spec.keys].sort((a, b) => a.t - b.t);
  const duration = keys[keys.length - 1].t;
  const clamped = [];
  const anim = { bones: {}, slots: {}, ik: {} };
  const overlap = { mano_sx: 0.05, mano_dx: 0.05, testa: 0.05, oggetto_sx: 0.07, oggetto_dx: 0.07, viso: 0.03, ...(spec.overlap || {}) };

  // valori per osso e canale in ogni posa (posa mancante = riposo)
  const channels = new Map(); // "bone|rotate" → [{t, v, ease}]
  const push = (bone, ch, t, v, ease) => {
    const k = `${bone}|${ch}`;
    if (!channels.has(k)) channels.set(k, []);
    channels.get(k).push({ t, v, ease });
  };
  const anatomical = Object.keys(rest).filter((n) => has.has(n));
  const facial = ["occhio_sx", "occhio_dx", "sopracciglio_sx", "sopracciglio_dx"].filter((n) => has.has(n));
  for (const k of keys) {
    const p = k.pose || {};
    for (const bone of anatomical) {
      const { joint, side } = splitBone(bone);
      if (joint === "gamba" && json.ik) continue; // ginocchio guidato dall'IK
      if (joint === "piede" && json.ik) continue;
      // mezzo busto: il bacino è la base dell'inquadratura, non ruota (sembrerebbe cadere)
      if (joint === "bacino" && !json.ik) { push(bone, "rotate", k.t, 0, k.ease); continue; }
      let target = p[bone] ?? rest[bone];
      if (joint === "torace" && !json.ik) target = Math.max(-15, Math.min(15, target)); // busto: inclinazione contenuta
      const lim = clampJoint(joint, target);
      if (lim !== target) clamped.push(`${spec.name}@${k.t}s ${bone} ${target}°→${lim}°`);
      target = lim;
      const sign = SIGN[joint]?.[side] ?? SIGN[joint]?.c ?? 1;
      push(bone, "rotate", k.t, sign * (target - rest[bone]), k.ease);
    }
    for (const side of ["sx", "dx"]) {
      const r = Math.max(REACH_LIMITS.min, Math.min(REACH_LIMITS.max, p[`reach_${side}`] ?? 1));
      if (has.has(`omero_${side}`)) { push(`omero_${side}`, "scale", k.t, { x: r, y: 1 }, k.ease); push(`avambraccio_${side}`, "scale", k.t, { x: r, y: 1 }, k.ease); }
      if (has.has(`oggetto_${side}`)) push(`oggetto_${side}`, "scale", k.t, { x: p[`smear_${side}`] ?? 1, y: 1 / Math.sqrt(p[`smear_${side}`] ?? 1) }, k.ease);
      if (has.has(`fx_${side}`)) {
        const fx = p[`fx_${side}`] || { alpha: 0, scale: 0.4 };
        push(`fx_${side}`, "scale", k.t, { x: fx.scale ?? 1, y: fx.scale ?? 1 }, k.ease);
        push(`fx_${side}`, "alpha", k.t, fx.alpha ?? 0, k.ease);
      }
    }
    let bodyY = p.body?.y ?? 0;
    if (json.ik) {
      // gambe mai tese oltre il 97% (regola dei tutorial): il bacino non sale oltre ciò che le gambe raggiungono
      for (const side of ["sx", "dx"]) {
        const W = rig.meta.world, hip = W[`coscia_${side}`], ank = W[`ik_piede_${side}`];
        // se il kit ha già le gambe più tese (figura frontale), il limite è la posa di riposo
        const L = Math.max(0.97 * ((boneLen[`coscia_${side}`] || 0) + (boneLen[`gamba_${side}`] || 0)), Math.hypot(hip.x - ank.x, hip.y - ank.y) + 0.01);
        const f = p[`foot_${side}`] || { x: 0, y: 0 };
        const dx = hip.x + (p.body?.x ?? 0) - (ank.x + f.x);
        const maxY = Math.sqrt(Math.max(0, L * L - dx * dx)) - (hip.y - ank.y - f.y);
        if (bodyY > maxY) { clamped.push(`${spec.name}@${k.t}s bacino y ${bodyY.toFixed(1)}→${maxY.toFixed(1)} (gamba al 97%)`); bodyY = maxY; }
      }
    }
    push("bacino", "translate", k.t, { x: p.body?.x ?? 0, y: bodyY }, k.ease);
    push("root", "translate", k.t, { x: p.jump?.x ?? 0, y: p.jump?.y ?? 0 }, k.ease);
    push("torace", "scale", k.t, { x: p.squash?.x ?? 1, y: p.squash?.y ?? 1 }, k.ease);
    // R5 tratti del viso INCOLLATI alla testa: con la testa in un solo pezzo (non mesh) spostare occhi,
    // sopracciglia e bocca li fa scivolare fuori dalle palpebre dipinte (segnalato su Zeus, 29 ott).
    // Lo sguardo si potrà animare solo con le pupille separate o con la testa in mesh 2.5D.
    if (has.has("viso") && rig.meta.faceMesh) push("viso", "translate", k.t, { x: (p.look?.x ?? 0) * m.u * 0.22, y: (p.look?.y ?? 0) * m.u * 0.12 }, k.ease);
    // sopracciglia: solo su e giù, poco (0,08 u): si alzano sulla fronte senza staccarsi dall'occhio
    for (const b of facial.filter((n) => n.startsWith("sopracciglio"))) push(b, "translate", k.t, { x: 0, y: Math.max(-1, Math.min(1, p.brows ?? 0)) * m.u * 0.08 }, k.ease);
    for (const side of ["sx", "dx"]) if (json.ik && has.has(`ik_piede_${side}`)) {
      const f = p[`foot_${side}`] || { x: 0, y: 0 };
      push(`ik_piede_${side}`, "translate", k.t, { x: f.x, y: f.y }, k.ease);
    }
    if (has.has("bocca")) push("bocca", "attachment", k.t, `bocca_${p.mouth || "neutral"}`, "hold"); // posa senza bocca = bocca a riposo
  }

  for (const [key, list] of channels) {
    const [bone, ch] = key.split("|");
    const d = overlap[bone] || 0;
    const timed = list.map((k, i) => ({ ...k, t: i === 0 || i === list.length - 1 ? k.t : Math.min(duration, k.t + d) }));
    if (ch === "attachment") {
      const slot = json.slots.find((s) => s.bone === "bocca");
      if (slot) {
        const out = []; let prev = null;
        for (const k of timed) if (k.v !== prev) { out.push({ time: round(k.t, 4), name: k.v }); prev = k.v; }
        if (out[0]?.time !== 0) out.unshift({ time: 0, name: "bocca_neutral" });
        if (out.some((k) => k.name !== "bocca_neutral")) (anim.slots[slot.name] ||= {}).attachment = out;
      }
      continue;
    }
    if (ch === "alpha") {
      const slot = json.slots.find((s) => s.bone === bone);
      if (!slot) continue;
      const hex = (a) => "ffffff" + Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, "0");
      (anim.slots[slot.name] ||= {}).rgba = dedupe(timed.map((k) => ({ time: round(k.t, 4), color: hex(k.v) })), (k) => k.color);
      continue;
    }
    const keysOut = timed.map((k, i) => {
      const nx = timed[i + 1];
      const o = { time: round(k.t, 4) };
      if (ch === "rotate") o.value = round(k.v, 2);
      else { o.x = round(k.v.x, 4); o.y = round(k.v.y, 4); }
      if (nx) {
        const e = EASE[k.ease || "inOut"];
        if (e === "stepped") o.curve = "stepped";
        else if (e) o.curve = ch === "rotate" ? bez(e, k.t, nx.t, k.v, nx.v) : [...bez(e, k.t, nx.t, k.v.x, nx.v.x), ...bez(e, k.t, nx.t, k.v.y, nx.v.y)];
      }
      return o;
    });
    const flat = ch === "rotate" ? keysOut.every((k) => Math.abs(k.value) < 0.01) : keysOut.every((k) => Math.abs(k.x - (ch === "scale" ? 1 : 0)) < 1e-4 && Math.abs(k.y - (ch === "scale" ? 1 : 0)) < 1e-4);
    if (flat) continue;
    (anim.bones[bone] ||= {})[ch] = keysOut;
  }

  // battito degli occhi (scala y + trasparenza piena: si vede la palpebra dipinta)
  for (const t0 of spec.blinks || []) for (const eye of facial.filter((n) => n.startsWith("occhio"))) {
    const tl = ((anim.bones[eye] ||= {}).scale ||= [{ time: 0, x: 1, y: 1 }]);
    tl.push({ time: round(t0, 4), x: 1, y: 1 }, { time: round(t0 + 0.04, 4), x: 1, y: 0.1 }, { time: round(t0 + 0.12, 4), x: 1, y: 1 });
    const slot = json.slots.find((s) => s.bone === eye);
    if (slot) {
      const rg = ((anim.slots[slot.name] ||= {}).rgba ||= [{ time: 0, color: "ffffffff" }]);
      rg.push({ time: round(t0, 4), color: "ffffffff" }, { time: round(t0 + 0.04, 4), color: "ffffff00" }, { time: round(t0 + 0.12, 4), color: "ffffffff" });
    }
    // palpebra a pezzo (se c'è): compare mentre l'occhio si chiude, sparisce quando si riapre
    const lid = json.slots.find((s) => s.bone === eye.replace("occhio", "palpebra"));
    if (lid) {
      const rl = ((anim.slots[lid.name] ||= {}).rgba ||= [{ time: 0, color: "ffffff00" }]);
      rl.push({ time: round(t0 + 0.02, 4), color: "ffffff00" }, { time: round(t0 + 0.04, 4), color: "ffffffff" }, { time: round(t0 + 0.1, 4), color: "ffffffff" }, { time: round(t0 + 0.12, 4), color: "ffffff00" });
    }
  }
  for (const eye of facial.filter((n) => n.startsWith("occhio"))) {
    const sc = anim.bones[eye]?.scale;
    if (sc && sc[sc.length - 1].time < duration) sc.push({ time: duration, x: 1, y: 1 });
    const slot = json.slots.find((s) => s.bone === eye);
    const rg = slot && anim.slots[slot.name]?.rgba;
    if (rg && rg[rg.length - 1].time < duration) rg.push({ time: duration, color: "ffffffff" });
    const lid = json.slots.find((s) => s.bone === eye.replace("occhio", "palpebra"));
    const rl = lid && anim.slots[lid.name]?.rgba;
    if (rl && rl[rl.length - 1].time < duration) rl.push({ time: duration, color: "ffffff00" });
  }

  json.animations[spec.name] = anim;
  if (!Object.keys(anim.slots).length) delete anim.slots;
  if (!Object.keys(anim.ik).length) delete anim.ik;
  // FOLLOW-THROUGH sulle catene (dopo: servono le ossa genitore già animate)
  if (spec.secondary !== false) for (const chain of rig.meta.chains) simulateChain(json, spec.name, chain, duration, !!spec.loop);
  return { name: spec.name, duration, clamped };
}

/** Bézier normalizzata → punti di controllo assoluti (tempo, valore) del formato Spine 4.x. */
function bez([x1, y1, x2, y2], t0, t1, v0, v1) {
  return [round(t0 + x1 * (t1 - t0), 4), round(v0 + y1 * (v1 - v0), 4), round(t0 + x2 * (t1 - t0), 4), round(v0 + y2 * (v1 - v0), 4)];
}

function dedupe(list, keyOf) {
  return list.filter((k, i) => i === 0 || i === list.length - 1 || keyOf(k) !== keyOf(list[i - 1]) || keyOf(k) !== keyOf(list[i + 1]));
}

/**
 * Catena a molla: ogni segmento insegue la direzione di riposo rispetto al segmento prima
 * (ritardo a cascata), sente l'accelerazione del punto di attacco (inerzia: se il corpo
 * scatta a destra la stoffa resta indietro) e si smorza. Angoli locali entro ±maxDeg.
 * Fine animazione: ritorno morbido alla posa di riposo (non-loop) o chiusura del ciclo (loop).
 */
export function simulateChain(json, animName, chain, duration, loop) {
  const fps = 60, dt = 1 / fps;
  const bonesByName = new Map(json.bones.map((b) => [b.name, b]));
  const restLocal = chain.bones.map((n) => bonesByName.get(n).rotation || 0);
  const lens = chain.bones.map((n) => bonesByName.get(n).length || 20);
  const cycles = loop ? 2 : 1;
  const steps = Math.round(duration * fps);
  const samples = []; // per ogni passo: angoli locali di delta
  let theta = null, omega = chain.bones.map(() => 0);
  let prevAnchor = null, prevVel = { x: 0, y: 0 };
  for (let c = 0; c < cycles; c++) {
    for (let s = 0; s <= steps; s++) {
      const t = s * dt;
      const w = poseAt(json, Math.min(t, duration), animName);
      const pw = w[chain.parent];
      const parentRot = Math.atan2(pw.c, pw.a) * R2D;
      const anchor = { x: pw.a * bonesByName.get(chain.bones[0]).x + pw.b * bonesByName.get(chain.bones[0]).y + pw.tx, y: pw.c * bonesByName.get(chain.bones[0]).x + pw.d * bonesByName.get(chain.bones[0]).y + pw.ty };
      let acc = { x: 0, y: 0 };
      if (prevAnchor) {
        const vel = { x: (anchor.x - prevAnchor.x) / dt, y: (anchor.y - prevAnchor.y) / dt };
        acc = { x: (vel.x - prevVel.x) / dt, y: (vel.y - prevVel.y) / dt };
        prevVel = vel;
      }
      prevAnchor = anchor;
      if (!theta) {
        theta = []; let base = parentRot;
        for (let i = 0; i < chain.bones.length; i++) { base += restLocal[i]; theta.push(base); }
      }
      // integrazione (più sottopassi per stabilità)
      for (let sub = 0; sub < 4; sub++) {
        const h = dt / 4;
        let base = parentRot;
        for (let i = 0; i < chain.bones.length; i++) {
          const target = base + restLocal[i];
          const err = norm(theta[i] - target);
          const th = theta[i] / R2D;
          const inertia = -(Math.cos(th) * acc.y - Math.sin(th) * acc.x) / Math.max(lens[i] * (i + 1), 1) * R2D * 0.35;
          const alpha = -chain.stiffness * err - chain.damping * omega[i] + Math.max(-4000, Math.min(4000, inertia));
          omega[i] += alpha * h;
          theta[i] += omega[i] * h;
          let local = norm(theta[i] - base - restLocal[i]);
          if (Math.abs(local) > chain.maxDeg) { local = Math.sign(local) * chain.maxDeg; theta[i] = base + restLocal[i] + local; omega[i] *= 0.3; }
          base = theta[i];
        }
      }
      if (c === cycles - 1 && s % 2 === 0) {
        let base = parentRot;
        samples.push({ t: round(t, 4), d: chain.bones.map((_, i) => { const d = norm(theta[i] - base - restLocal[i]); base = theta[i]; return d; }) });
      }
    }
  }
  // fine: ritorno morbido a zero negli ultimi 0.25 s (non-loop) o raccordo col primo valore (loop)
  const tail = Math.min(0.25, duration / 3);
  const first = samples[0].d;
  for (const sm of samples) {
    if (sm.t >= duration - tail) {
      const f = (sm.t - (duration - tail)) / tail;
      const e = f * f * (3 - 2 * f);
      sm.d = sm.d.map((v, i) => v * (1 - e) + (loop ? first[i] : 0) * e);
    }
  }
  if (!loop) samples[0].d = samples[0].d.map(() => 0);
  const anim = json.animations[animName];
  chain.bones.forEach((bone, i) => {
    const pts = samples.map((sm) => ({ t: sm.t, v: sm.d[i] }));
    const reduced = rdp(pts, 0.35);
    if (reduced.every((p) => Math.abs(p.v) < 0.05)) return;
    (anim.bones[bone] ||= {}).rotate = reduced.map((p) => ({ time: p.t, value: round(p.v, 2) }));
  });
}

/** Ramer–Douglas–Peucker: tiene solo le chiavi che servono (errore massimo in gradi). */
export function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  const a = pts[0], b = pts[pts.length - 1];
  let idx = -1, max = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const v = a.v + ((b.v - a.v) * (p.t - a.t)) / (b.t - a.t || 1);
    const d = Math.abs(p.v - v);
    if (d > max) { max = d; idx = i; }
  }
  if (max <= eps) return [a, b];
  return [...rdp(pts.slice(0, idx + 1), eps).slice(0, -1), ...rdp(pts.slice(idx), eps)];
}
