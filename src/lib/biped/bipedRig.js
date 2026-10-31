// src/lib/biped/bipedRig.js — RIG AUTOMATICO di un personaggio "nato per Spine".
// Dal kit di pezzi (immagini già separate, in posa neutra, con i punti delle articolazioni)
// costruisce lo skeleton Spine 4.1: ossa nella gerarchia standard, slot nell'ordine di
// disegno, allegati region, catene di ossa con mesh pesata per capelli/mantello/coda,
// controllo del viso, oggetto in mano, bagliore per la magia, IK dei piedi (figura intera).
// Puro e deterministico: nessun DOM, nessuna immagine letta (solo misure).
//
// Kit (coordinate del personaggio in pixel, y verso il basso):
// {
//   name, body: "bust" | "full",
//   points: { waist, neck, crown, shoulder_sx, elbow_sx, wrist_sx, fingertip_sx, ...,
//             pelvis, hip_sx, knee_sx, ankle_sx, toe_sx, ..., face_center },
//   ground?: y del suolo (figura intera), default = punto più basso
//   parts: [{ name, role, side?, x, y, width, height, z?,
//             // role "chain": kind (hair|cape|tail|ribbon), points [{x,y}...] dall'attacco alla punta, parent?
//             // role "prop": side, grip {x,y} (punto della presa)
//             // role "mouth": variants { neutral: {name,width,height,x,y}, open: ..., ... }
//             // role "fx": side (bagliore sulla mano), color
//           }]
// }

import { BIPED_RULES_VERSION, PART_ROLES, CHAIN_DEFAULTS, boneName, requiredParts } from "./bipedSpec.js";

const R2D = 180 / Math.PI;
const round = (v, n = 3) => +v.toFixed(n);

/** Ordine di disegno di partenza (dal fondo): chi non ha z lo prende da qui. */
const DEFAULT_LAYER = {
  "chain:hair_back": 0, "chain:cape": 1, "chain:tail": 2,
  thigh: 10, shin: 11, foot: 12, pelvis: 13, torso: 20,
  upper_arm: 30, forearm: 31, hand: 32, prop: 33,
  head: 40, eye: 41, lid: 41.5, brow: 42, mouth: 43, "chain:hair": 44, "chain:ribbon": 45, fx: 60
};

export function buildBipedSkeleton(kit) {
  const body = kit.body === "full" ? "full" : "bust";
  const P = kit.points || {};
  const errors = [];
  for (const { role, side } of requiredParts(body)) {
    if (!kit.parts.some((p) => (p.role === role || p.covers?.includes(role)) && (p.side || null) === (side || null))) errors.push(`Manca il pezzo ${role}${side ? "_" + side : ""}.`);
  }
  if (errors.length) throw new Error(errors.join(" "));

  // origine: centro del corpo a terra (figura intera) o base del busto
  const solid = kit.parts.filter((p) => p.role !== "fx" && p.role !== "mouth");
  const allY = solid.map((p) => p.y + p.height);
  const ox = (P.pelvis || P.waist).x;
  const oy = kit.ground ?? Math.max(...allY);
  const S = (p) => ({ x: p.x - ox, y: oy - p.y });

  const bones = [{ name: "root" }];
  const world = { root: { x: 0, y: 0, rot: 0 } }; // posa di riposo in coordinate Spine
  const addBone = (name, parent, from, to, extra = {}) => {
    const a = S(from), b = to ? S(to) : null;
    const rot = b ? Math.atan2(b.y - a.y, b.x - a.x) * R2D : world[parent].rot;
    const pw = world[parent];
    const dx = a.x - pw.x, dy = a.y - pw.y;
    const c = Math.cos(-pw.rot / R2D), s = Math.sin(-pw.rot / R2D);
    const bone = { name, parent, x: round(dx * c - dy * s), y: round(dx * s + dy * c), rotation: round(rot - pw.rot) };
    if (b) bone.length = round(Math.hypot(b.x - a.x, b.y - a.y));
    Object.assign(bone, extra);
    bones.push(bone);
    world[name] = { x: a.x, y: a.y, rot, len: b ? Math.hypot(b.x - a.x, b.y - a.y) : 0 };
    return bone;
  };

  // corpo: bacino sempre presente (nel busto è un osso invisibile alla vita)
  if (body === "full") addBone("bacino", "root", P.pelvis, P.waist);
  else addBone("bacino", "root", P.waist, { x: P.waist.x, y: P.waist.y - 10 });
  addBone("torace", "bacino", P.waist, P.neck);
  // "eredita scala" disattivato su testa e braccia: il respiro/schiacciamento del torace non deforma
  // la testa né allunga le braccia (tutorial corso base)
  addBone("testa", "torace", P.neck, P.crown, { transform: "noScale" });
  for (const side of ["sx", "dx"]) {
    addBone(`omero_${side}`, "torace", P[`shoulder_${side}`], P[`elbow_${side}`], { transform: "noScale" });
    addBone(`avambraccio_${side}`, `omero_${side}`, P[`elbow_${side}`], P[`wrist_${side}`]);
    addBone(`mano_${side}`, `avambraccio_${side}`, P[`wrist_${side}`], P[`fingertip_${side}`]);
    if (body === "full") {
      addBone(`coscia_${side}`, "bacino", P[`hip_${side}`], P[`knee_${side}`]);
      addBone(`gamba_${side}`, `coscia_${side}`, P[`knee_${side}`], P[`ankle_${side}`]);
      addBone(`piede_${side}`, `gamba_${side}`, P[`ankle_${side}`], P[`toe_${side}`], { transform: "noRotationOrReflection" });
      addBone(`ik_piede_${side}`, "root", P[`ankle_${side}`], null, { color: "ff3f00ff" });
    }
    // bagliore della magia sul palmo (metà fra polso e punta delle dita)
    const w = P[`wrist_${side}`], f = P[`fingertip_${side}`];
    addBone(`fx_${side}`, `mano_${side}`, { x: (w.x + f.x) / 2, y: (w.y + f.y) / 2 }, null);
  }
  // controllo del viso (testa 2.5D, rig senza vincoli): occhi, sopracciglia e bocca lo seguono
  const fc = P.face_center || { x: P.neck.x, y: (P.neck.y + P.crown.y) / 2 };
  addBone("viso", "testa", fc, null);

  const slots = [];
  const attachments = {};
  const layered = [];
  const regionAt = (bone, part, attName = part.name) => {
    const w = world[bone];
    const c = S({ x: part.x + part.width / 2, y: part.y + part.height / 2 });
    const dx = c.x - w.x, dy = c.y - w.y;
    const co = Math.cos(-w.rot / R2D), si = Math.sin(-w.rot / R2D);
    return { type: "region", name: attName, x: round(dx * co - dy * si), y: round(dx * si + dy * co), rotation: round(-w.rot), width: part.width, height: part.height };
  };

  const chains = [];
  let faceMesh = null;
  for (const part of kit.parts) {
    let bone, layerKey = part.role, slot = { name: part.name, attachment: part.name };
    if (PART_ROLES[part.role]) {
      bone = boneName(part.role, part.side);
      if (part.skin) {
        // MESH PESATA (pesi automatici dalla distanza dalle ossa): il pezzo piega morbido sulle
        // articolazioni, senza giunture (braccio intero con la manica, busto con il respiro)
        const skin = [...part.skin];
        let rules = [];
        if (part.chainSkin) rules.push({ chain: part.chainSkin.bones, root: part.chainSkin.root, rootReach: part.chainSkin.rootReach, rootMax: part.chainSkin.rootMax, blend: part.chainSkin.blend, smooth: part.chainSkin.smooth ?? 0 });
        if (part.sleeve) {
          // MANICA dentro la mesh del braccio: catena di ossa figlie dell'avambraccio lungo l'orlo che
          // pende; pesa solo sulla stoffa lontana dall'avambraccio e dalla mano (il braccio resta braccio)
          const def = CHAIN_DEFAULTS.sleeve, parent = `avambraccio_${part.side}`;
          const pts = resamplePolyline(part.sleeve.points, def.bones + 1);
          const names = [];
          for (let i = 0; i < def.bones; i++) {
            const nm = `manica_${part.side}_${i + 1}`;
            addBone(nm, i ? names[i - 1] : parent, pts[i], pts[i + 1], { color: "3399ffff" });
            names.push(nm);
          }
          skin.push(...names);
          rules.push({ bones: names, awayFrom: [{ bone: parent, d: part.sleeve.armHalf }, { bone: `mano_${part.side}`, d: part.sleeve.armHalf * 1.2 }] });
          chains.push({ ...def, name: `manica_${part.side}`, kind: "sleeve", bones: names, parent });
        }
        for (const b of skin) if (!world[b]) throw new Error(`Pezzo ${part.name}: osso ${b} inesistente.`);
        attachments[part.name] = { [part.name]: skinnedMesh(part, skin, world, S, bones, part.grid, rules) };
      } else if (part.mesh) {
        // testa con il viso incorporato: mesh a griglia (le espressioni la deformano)
        const m = gridMesh(part, world[bone], S, 14, 16);
        attachments[part.name] = { [part.name]: m.att };
        faceMesh = { slot: part.name, attachment: part.name, bone, imgPts: m.imgPts, rot: world[bone].rot };
      } else attachments[part.name] = { [part.name]: regionAt(bone, part) };
    } else if (part.role === "eye" || part.role === "brow") {
      bone = `${part.role === "eye" ? "occhio" : "sopracciglio"}_${part.side}`;
      addBone(bone, "viso", { x: part.x + part.width / 2, y: part.y + part.height / 2 }, null);
      attachments[part.name] = { [part.name]: regionAt(bone, part) };
    } else if (part.role === "lid") {
      // palpebra chiusa: pezzo a sé sopra l'occhio, invisibile a riposo, visibile solo nel battito
      bone = `palpebra_${part.side}`;
      addBone(bone, "viso", { x: part.x + part.width / 2, y: part.y + part.height / 2 }, null);
      attachments[part.name] = { [part.name]: regionAt(bone, part) };
      slot = { ...slot, color: "ffffff00" };
    } else if (part.role === "mouth") {
      bone = "bocca";
      const base = part.variants?.neutral || Object.values(part.variants || {})[0] || part;
      addBone(bone, "viso", { x: base.x + base.width / 2, y: base.y + base.height / 2 }, null);
      const atts = {};
      for (const [v, img] of Object.entries(part.variants || { neutral: part })) atts[`bocca_${v}`] = regionAt(bone, img, img.name || `${part.name}_${v}`);
      attachments[part.name] = atts;
      if (part.overlay) delete slot.attachment; // bocche aperte sopra il viso in mesh: visibili solo nelle espressioni
      else slot.attachment = "bocca_neutral";
    } else if (part.role === "prop") {
      bone = `oggetto_${part.side}`;
      addBone(bone, `mano_${part.side}`, part.grip, null);
      attachments[part.name] = { [part.name]: regionAt(bone, part) };
    } else if (part.role === "fx") {
      bone = `fx_${part.side}`;
      const w = world[bone];
      attachments[part.name] = { [part.name]: { type: "region", name: part.name, x: 0, y: 0, rotation: round(-w.rot), width: part.width, height: part.height } };
      slot = { ...slot, color: "ffffff00", blend: "additive" };
    } else if (part.role === "chain") {
      const def = CHAIN_DEFAULTS[part.kind] || CHAIN_DEFAULTS.hair;
      const parent = part.parent || def.parent;
      const n = part.bones || def.bones;
      const pts = resamplePolyline(part.points, n + 1);
      const names = [];
      for (let i = 0; i < n; i++) {
        const nm = `${part.name}_${i + 1}`;
        addBone(nm, i ? names[i - 1] : parent, pts[i], pts[i + 1], { color: "33cc66ff" });
        names.push(nm);
      }
      bone = names[0];
      attachments[part.name] = { [part.name]: chainMesh(part, pts, names, world, S, bones) };
      chains.push({ ...def, name: part.name, kind: part.kind, bones: names, parent, maxDeg: part.maxDeg ?? def.maxDeg });
      layerKey = `chain:${part.layer || part.kind}`;
    } else {
      throw new Error(`Ruolo del pezzo "${part.name}" non riconosciuto: ${part.role}`);
    }
    layered.push({ z: part.z ?? DEFAULT_LAYER[layerKey] ?? 50, order: layered.length, slot: { ...slot, bone } });
  }
  layered.sort((a, b) => a.z - b.z || a.order - b.order);
  for (const l of layered) slots.push(l.slot);

  // ordini DIVERSI: con lo stesso "order" il runtime 4.1 ne applica uno solo
  const ik = body === "full" ? ["sx", "dx"].map((side, i) => ({
    name: `ik_gamba_${side}`, order: i, bones: [`coscia_${side}`, `gamba_${side}`], target: `ik_piede_${side}`,
    // il ginocchio piegato va verso l'esterno (verificato in spine-core: bipedRig.test)
    bendPositive: side === "dx"
  })) : [];

  const height = Math.max(...solid.map((p) => oy - p.y));
  const width = Math.max(...solid.map((p) => Math.abs(p.x - ox)), ...solid.map((p) => Math.abs(p.x + p.width - ox))) * 2;
  const json = {
    skeleton: { hash: hashOf(kit.name || "biped"), spine: "4.1.24", x: round(-width / 2), y: 0, width: round(width), height: round(height), images: "./", audio: "" },
    bones,
    slots,
    ...(ik.length ? { ik } : {}),
    skins: [{ name: "default", attachments }],
    animations: {}
  };
  return { json, meta: { rulesVersion: BIPED_RULES_VERSION, body, chains, world, origin: { x: ox, y: oy }, ...(faceMesh && kit.face ? { faceMesh: { ...faceMesh, face: kit.face } } : {}) } };
}

/**
 * Mesh a griglia NON pesata su un osso (vertici in coordinate dell'osso). imgPts = posizione di ogni
 * vertice nell'immagine del personaggio (per calcolare le deformazioni delle espressioni).
 */
export function gridMesh(part, w, S, cols, rows) {
  const co = Math.cos(-w.rot / R2D), si = Math.sin(-w.rot / R2D);
  const uvs = [], vertices = [], imgPts = [], triangles = [];
  const id = (r, c) => r * cols + c;
  // ordine: prima il contorno (hull) in senso orario, poi l'interno
  const order = [];
  for (let c = 0; c < cols; c++) order.push([0, c]);
  for (let r = 1; r < rows; r++) order.push([r, cols - 1]);
  for (let c = cols - 2; c >= 0; c--) order.push([rows - 1, c]);
  for (let r = rows - 2; r >= 1; r--) order.push([r, 0]);
  const hull = order.length;
  for (let r = 1; r < rows - 1; r++) for (let c = 1; c < cols - 1; c++) order.push([r, c]);
  const index = new Map(order.map(([r, c], i) => [id(r, c), i]));
  for (const [r, c] of order) {
    const u = c / (cols - 1), v = r / (rows - 1);
    const px = part.x + u * part.width, py = part.y + v * part.height;
    const sp = S({ x: px, y: py });
    const dx = sp.x - w.x, dy = sp.y - w.y;
    uvs.push(round(u, 5), round(v, 5));
    vertices.push(round(dx * co - dy * si), round(dx * si + dy * co));
    imgPts.push({ x: px, y: py });
  }
  for (let r = 0; r < rows - 1; r++)
    for (let c = 0; c < cols - 1; c++) {
      const a = index.get(id(r, c)), b = index.get(id(r, c + 1)), d = index.get(id(r + 1, c)), e = index.get(id(r + 1, c + 1));
      triangles.push(a, d, b, b, d, e);
    }
  const edges = [];
  for (let k = 0; k < hull; k++) edges.push(k * 2, ((k + 1) % hull) * 2);
  return { att: { type: "mesh", name: part.name, uvs, triangles, vertices, hull, edges, width: part.width, height: part.height }, imgPts };
}

/**
 * MESH PESATA con pesi automatici (come "Auto weights" dell'editor): griglia sul pezzo, ogni vertice
 * legato alle ossa più vicine con peso ∝ 1/(distanza dal segmento dell'osso)^4, al massimo 3 ossa,
 * pesi sotto il 3% tolti. Le ossa senza lunghezza contano come punti. Righe e colonne di default
 * dalla forma del pezzo (circa una cella ogni 1/8 del lato lungo).
 */
export function skinnedMesh(part, boneNames, world, S, bones, grid, rules = []) {
  const long = Math.max(part.width, part.height);
  const cols = grid?.cols ?? Math.max(3, Math.round((part.width / long) * 9) + 1);
  const rows = grid?.rows ?? Math.max(3, Math.round((part.height / long) * 9) + 1);
  const boneIndex = (nm) => bones.findIndex((b) => b.name === nm);
  const segs = boneNames.map((nm) => {
    const w = world[nm], r = w.rot / R2D;
    return { nm, ax: w.x, ay: w.y, bx: w.x + Math.cos(r) * w.len, by: w.y + Math.sin(r) * w.len, w };
  });
  const dist = (sg, x, y) => {
    const vx = sg.bx - sg.ax, vy = sg.by - sg.ay, l2 = vx * vx + vy * vy;
    const f = l2 ? Math.max(0, Math.min(1, ((x - sg.ax) * vx + (y - sg.ay) * vy) / l2)) : 0;
    return Math.hypot(x - (sg.ax + f * vx), y - (sg.ay + f * vy));
  };
  const scale = long * 0.04 + 1;
  // ARTO A CATENA: ogni vertice si proietta sulla polilinea spalla→gomito→polso→dita e prende i pesi
  // dalla posizione lungo l'arto (passaggio morbido solo attorno alle articolazioni). La stoffa che
  // pende (manica a campana accanto al fianco) segue così l'osso a cui appartiene e non resta
  // agganciata al busto: il busto pesa solo sulla calotta della spalla.
  const chainWeights = (rule, sp) => {
    const cs = rule.chain.map((nm) => segs.find((q) => q.nm === nm)).filter(Boolean);
    const lens = cs.map((sg) => Math.hypot(sg.bx - sg.ax, sg.by - sg.ay) || 1);
    let best = null, acc = 0;
    cs.forEach((sg, i) => {
      const vx = sg.bx - sg.ax, vy = sg.by - sg.ay, l2 = vx * vx + vy * vy || 1;
      const f = Math.max(i === 0 ? -1 : 0, Math.min(i === cs.length - 1 ? 2 : 1, ((sp.x - sg.ax) * vx + (sp.y - sg.ay) * vy) / l2));
      const fc = Math.max(0, Math.min(1, f));
      const d = Math.hypot(sp.x - (sg.ax + fc * vx), sp.y - (sg.ay + fc * vy));
      if (!best || d < best.d - 1e-6) best = { d, s: acc + f * lens[i] };
      acc += lens[i];
    });
    const out = cs.map((sg) => ({ sg, w: 0 }));
    let j = 0;
    const joints = [];
    for (let i = 0, a = 0; i < cs.length - 1; i++) { a += lens[i]; joints.push(a); }
    // peso a gradini con rampe larghe h attorno a ogni articolazione
    let w = cs.map(() => 0);
    const s0 = best.s;
    j = joints.findIndex((J) => s0 < J);
    if (j < 0) j = cs.length - 1;
    w[j] = 1;
    for (let k = 0; k < joints.length; k++) {
      const h = (rule.blend ?? 0.2) * Math.min(lens[k], lens[k + 1]);
      const t = (s0 - (joints[k] - h)) / (2 * h);
      if (t > 0 && t < 1) { const e = t * t * (3 - 2 * t); w = cs.map(() => 0); w[k] = 1 - e; w[k + 1] = e; break; }
    }
    out.forEach((o, i) => (o.w = w[i]));
    if (rule.root) {
      const rs = segs.find((q) => q.nm === rule.root);
      const r = (rule.rootReach ?? 0.3) * lens[0];
      const k = Math.max(0, Math.min(1, 1 - s0 / r)) * (rule.rootMax ?? 0.5);
      if (rs && k > 0) { out.forEach((o) => (o.w *= 1 - k)); out.push({ sg: rs, w: k }); }
    }
    return out.filter((o) => o.w > 0);
  };
  const order = [];
  for (let c = 0; c < cols; c++) order.push([0, c]);
  for (let r = 1; r < rows; r++) order.push([r, cols - 1]);
  for (let c = cols - 2; c >= 0; c--) order.push([rows - 1, c]);
  for (let r = rows - 2; r >= 1; r--) order.push([r, 0]);
  const hull = order.length;
  for (let r = 1; r < rows - 1; r++) for (let c = 1; c < cols - 1; c++) order.push([r, c]);
  const index = new Map(order.map(([r, c], i) => [r * cols + c, i]));
  const uvs = [], vertices = [], weights = [];
  // 1) pesi grezzi per ogni nodo della griglia
  const raw = new Map();
  for (const [r, c] of order) {
    const u = c / (cols - 1), v = r / (rows - 1);
    const sp = S({ x: part.x + u * part.width, y: part.y + v * part.height });
    // regole: certe ossa (manica) pesano solo lontano da altre (avambraccio, mano), con passaggio morbido
    const gate = (nm) => {
      let g = 1;
      for (const r of rules) if (r.bones) for (const nm2 of r.bones) if (nm2 === nm) for (const a of r.awayFrom) {
        const sa = segs.find((q) => q.nm === a.bone);
        if (!sa) continue;
        const d = dist(sa, sp.x, sp.y);
        g = Math.min(g, Math.max(0, Math.min(1, (d - a.d) / (0.6 * a.d))));
      }
      return g;
    };
    const chainRule = rules.find((r) => r.chain);
    const infl = chainRule
      ? chainWeights(chainRule, sp)
      : segs.map((sg) => ({ sg, w: gate(sg.nm) / Math.pow(dist(sg, sp.x, sp.y) / scale + 1, 4) })).filter((i) => i.w > 0);
    const sum = infl.reduce((x, i) => x + i.w, 0) || 1;
    raw.set(r * cols + c, { u, v, sp, w: new Map(infl.map((i) => [i.sg.nm, i.w / sum])) });
  }
  // 2) SMOOTH come nel Weights view di Spine: media con i vicini lungo i lati della mesh (qui la griglia),
  //    poi 3) PRUNE: via i pesi sotto soglia (ridistribuiti) e al massimo 3 ossa per vertice
  const passes = rules.find((r) => r.chain)?.smooth ?? 0;
  for (let k = 0; k < passes; k++) {
    const next = new Map();
    for (const [key, n] of raw) {
      const r = Math.floor(key / cols), c = key % cols, acc = new Map(), add = (m, f) => { for (const [b, w] of m) acc.set(b, (acc.get(b) || 0) + w * f); };
      add(n.w, 0.5);
      const nb = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].filter(([y, x]) => y >= 0 && x >= 0 && y < rows && x < cols);
      for (const [y, x] of nb) add(raw.get(y * cols + x).w, 0.5 / nb.length);
      next.set(key, { ...n, w: acc });
    }
    for (const [key, n] of next) raw.set(key, n);
  }
  for (const [r, c] of order) {
    const n = raw.get(r * cols + c), { u, v, sp } = n;
    let infl = [...n.w].map(([nm, w]) => ({ sg: segs.find((q) => q.nm === nm), w })).filter((i) => i.w > 0);
    infl.sort((a, b) => b.w - a.w);
    infl = infl.slice(0, 3);
    let sum = infl.reduce((a, i) => a + i.w, 0);
    infl = infl.filter((i) => i.w / sum >= (passes ? 0.05 : 0.03));
    sum = infl.reduce((a, i) => a + i.w, 0);
    uvs.push(round(u, 5), round(v, 5));
    vertices.push(infl.length);
    const wv = {};
    for (const { sg, w } of infl) {
      const dx = sp.x - sg.w.x, dy = sp.y - sg.w.y;
      const co = Math.cos(-sg.w.rot / R2D), si = Math.sin(-sg.w.rot / R2D);
      vertices.push(boneIndex(sg.nm), round(dx * co - dy * si), round(dx * si + dy * co), round(w / sum, 4));
      wv[sg.nm] = w / sum;
    }
    weights.push(wv);
  }
  const triangles = [];
  for (let r = 0; r < rows - 1; r++)
    for (let c = 0; c < cols - 1; c++) {
      const a = index.get(r * cols + c), b = index.get(r * cols + c + 1), d = index.get((r + 1) * cols + c), e = index.get((r + 1) * cols + c + 1);
      if ((r + c) % 2) triangles.push(a, d, b, b, d, e);
      else triangles.push(a, e, b, a, d, e);
    }
  const edges = [];
  for (let k = 0; k < hull; k++) edges.push(k * 2, ((k + 1) % hull) * 2);
  return { type: "mesh", name: part.name, uvs, triangles, vertices, hull, edges, width: part.width, height: part.height };
}

/** n punti equidistanti lungo la polilinea. */
export function resamplePolyline(points, n) {
  const seg = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const l = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    seg.push(l);
    total += l;
  }
  const out = [];
  for (let k = 0; k < n; k++) {
    let d = (total * k) / (n - 1), i = 0;
    while (i < seg.length - 1 && d > seg[i]) d -= seg[i++];
    const f = seg[i] ? Math.min(1, d / seg[i]) : 0;
    out.push({ x: points[i].x + (points[i + 1].x - points[i].x) * f, y: points[i].y + (points[i + 1].y - points[i].y) * f });
  }
  return out;
}

/**
 * Mesh pesata di una catena: griglia sull'immagine, ogni vertice legato alle due ossa più
 * vicine lungo la catena (peso lineare), così la striscia piega morbida e senza scalini.
 * Più righe verso la punta (si muove di più), poche all'attacco.
 */
function chainMesh(part, pts, names, world, S, bones) {
  const cols = 4;
  const rows = names.length * 3 + 1;
  const total = pts.reduce((a, p, i) => (i ? a + Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) : 0), 0);
  // direzione principale: dall'attacco alla punta; le righe sono perpendicolari a questa
  const ax = pts[pts.length - 1].x - pts[0].x, ay = pts[pts.length - 1].y - pts[0].y;
  const vertical = Math.abs(ay) >= Math.abs(ax);
  const uvs = [], vertices = [], grid = [];
  const boneIndex = (nm) => bones.findIndex((b) => b.name === nm);
  for (let r = 0; r < rows; r++) {
    // righe più fitte verso la punta: parametro con leggera accelerazione
    const t = Math.pow(r / (rows - 1), 0.85);
    for (let c = 0; c < cols; c++) {
      const across = c / (cols - 1);
      const along = vertical ? (ay >= 0 ? t : 1 - t) : (ax >= 0 ? t : 1 - t);
      const uu = vertical ? across : along;
      const v = vertical ? along : across;
      const px = part.x + uu * part.width, py = part.y + v * part.height;
      uvs.push(round(uu, 5), round(v, 5));
      grid.push({ r, c });
      // distanza lungo la catena: proiezione sul segmento più vicino
      let best = { d: Infinity, s: 0 };
      let acc = 0;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        const vx = b.x - a.x, vy = b.y - a.y, l2 = vx * vx + vy * vy || 1;
        const f = Math.max(0, Math.min(1, ((px - a.x) * vx + (py - a.y) * vy) / l2));
        const d = Math.hypot(px - (a.x + f * vx), py - (a.y + f * vy));
        if (d < best.d) best = { d, s: acc + f * Math.sqrt(l2) };
        acc += Math.sqrt(l2);
      }
      const pos = (best.s / (total || 1)) * names.length; // 0..n lungo le ossa
      const i0 = Math.min(names.length - 1, Math.max(0, Math.floor(pos - 0.5)));
      const i1 = Math.min(names.length - 1, i0 + 1);
      const f = i0 === i1 ? 0 : Math.max(0, Math.min(1, pos - 0.5 - i0));
      const infl = i0 === i1 ? [[i0, 1]] : [[i0, 1 - f], [i1, f]].filter(([, w]) => w > 0.001);
      const wsum = infl.reduce((a, [, w]) => a + w, 0);
      vertices.push(infl.length);
      const sp = S({ x: px, y: py });
      for (const [bi, w] of infl) {
        const wb = world[names[bi]];
        const dx = sp.x - wb.x, dy = sp.y - wb.y;
        const co = Math.cos(-wb.rot / R2D), si = Math.sin(-wb.rot / R2D);
        vertices.push(boneIndex(names[bi]), round(dx * co - dy * si), round(dx * si + dy * co), round(w / wsum, 4));
      }
    }
  }
  const id = (r, c) => r * cols + c;
  const triangles = [];
  for (let r = 0; r < rows - 1; r++)
    for (let c = 0; c < cols - 1; c++) {
      // diagonali alternate (zigzag): piega più pulita sulle strisce lunghe
      if ((r + c) % 2) triangles.push(id(r, c), id(r + 1, c), id(r, c + 1), id(r, c + 1), id(r + 1, c), id(r + 1, c + 1));
      else triangles.push(id(r, c), id(r + 1, c + 1), id(r, c + 1), id(r, c), id(r + 1, c), id(r + 1, c + 1));
    }
  // contorno (hull) in senso orario: riga 0, colonna destra, ultima riga, colonna sinistra
  const hull = [];
  for (let c = 0; c < cols; c++) hull.push(id(0, c));
  for (let r = 1; r < rows; r++) hull.push(id(r, cols - 1));
  for (let c = cols - 2; c >= 0; c--) hull.push(id(rows - 1, c));
  for (let r = rows - 2; r >= 1; r--) hull.push(id(r, 0));
  // Spine vuole i vertici del contorno PRIMA: riordino
  const order = [...hull, ...grid.map((_, i) => i).filter((i) => !hull.includes(i))];
  const remap = new Map(order.map((old, nw) => [old, nw]));
  const vOf = [];
  { let i = 0; for (let k = 0; k < grid.length; k++) { const n = vertices[i]; vOf.push(vertices.slice(i, i + 1 + n * 4)); i += 1 + n * 4; } }
  const edges = [];
  for (let k = 0; k < hull.length; k++) edges.push(k * 2, ((k + 1) % hull.length) * 2);
  return {
    type: "mesh",
    name: part.name,
    uvs: order.flatMap((o) => [uvs[o * 2], uvs[o * 2 + 1]]),
    triangles: triangles.map((t) => remap.get(t)),
    vertices: order.flatMap((o) => vOf[o]),
    hull: hull.length,
    edges,
    width: part.width,
    height: part.height
  };
}

function hashOf(s) {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h.toString(16).padStart(8, "0") + "biped";
}
