// src/lib/animationSim.js — SIMULAZIONE dell'animazione esportata, fotogramma per fotogramma.
// Riproduce lo skeleton Spine 4.1 (uscita di toSpine41) come farebbe il runtime: ossa con
// traslazione/rotazione/scala ereditate, allegati region (quadrilatero) e mesh pesate
// (vertici = somma pesata delle ossa). Su ogni fotogramma controlla ciò che in movimento si
// rompe e da fermo non si vede:
//  - RACCORDI: il punto di aggancio di ogni parte (spalla, collo, mano) resta sopra la parte
//    genitore: niente buco fra braccio e busto o fra testa e collo;
//  - PIEDI FERMI: la base del busto (vertici in basso della mesh) non si muove;
//  - MESH SANE: nessun triangolo si rovescia o si schiaccia oltre metà area;
//  - LIMITI: nessuna parte esce troppo dall'ingombro di riposo; rotazioni entro il massimo;
//  - VISO: occhi/sopracciglia/bocca non scivolano sulla pelle della testa; gli occhi battono insieme.
// Puro: nessun DOM. Gli stessi calcoli servono per un'anteprima fedele all'export.

const deg = (d) => (d * Math.PI) / 180;

/** Valore di una timeline a tempo t (interpolazione lineare; le nostre chiavi sono fitte). */
function sample(keys, t, field, dflt) {
  if (!keys || !keys.length) return dflt;
  if (t <= keys[0].time) return keys[0][field] ?? dflt;
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i].time) {
      const a = keys[i - 1], b = keys[i];
      const f = (t - a.time) / (b.time - a.time || 1);
      return (a[field] ?? dflt) + ((b[field] ?? dflt) - (a[field] ?? dflt)) * f;
    }
  }
  return keys[keys.length - 1][field] ?? dflt;
}

/** Matrici mondo [a, b, c, d, tx, ty] di tutte le ossa al tempo t (y verso l'alto). */
export function poseAt(json, t, animName = "ambient") {
  const anim = json.animations?.[animName]?.bones || {};
  const world = {};
  for (const b of json.bones) {
    const tl = anim[b.name] || {};
    const x = (b.x || 0) + sample(tl.translate, t, "x", 0);
    const y = (b.y || 0) + sample(tl.translate, t, "y", 0);
    const rot = (b.rotation || 0) + sample(tl.rotate, t, "value", 0);
    const sx = (b.scaleX ?? 1) * sample(tl.scale, t, "x", 1);
    const sy = (b.scaleY ?? 1) * sample(tl.scale, t, "y", 1);
    const c = Math.cos(deg(rot)), s = Math.sin(deg(rot));
    const la = c * sx, lb = -s * sy, lc = s * sx, ld = c * sy;
    const p = b.parent ? world[b.parent] : null;
    world[b.name] = p
      ? { a: p.a * la + p.b * lc, b: p.a * lb + p.b * ld, c: p.c * la + p.d * lc, d: p.c * lb + p.d * ld, tx: p.a * x + p.b * y + p.tx, ty: p.c * x + p.d * y + p.ty, rot: p.rot + rot }
      : { a: la, b: lb, c: lc, d: ld, tx: x, ty: y, rot };
  }
  return world;
}

const apply = (m, x, y) => ({ x: m.a * x + m.b * y + m.tx, y: m.c * x + m.d * y + m.ty });

/** Geometria mondo di un allegato: { verts: [{x,y}], tris: [i,j,k...], uvs } */
export function attachmentGeometry(json, world, slot) {
  const att = json.skins?.[0]?.attachments?.[slot.name]?.[slot.attachment];
  if (!att) return null;
  if (att.type === "mesh") {
    const verts = [];
    if (att.vertices.length === att.uvs.length) {
      const m = world[slot.bone];
      for (let i = 0; i < att.vertices.length; i += 2) verts.push(apply(m, att.vertices[i], att.vertices[i + 1]));
    } else {
      for (let i = 0; i < att.vertices.length; ) {
        const n = att.vertices[i++];
        let x = 0, y = 0;
        for (let k = 0; k < n; k++, i += 4) {
          const m = world[json.bones[att.vertices[i]].name];
          const p = apply(m, att.vertices[i + 1], att.vertices[i + 2]);
          x += p.x * att.vertices[i + 3];
          y += p.y * att.vertices[i + 3];
        }
        verts.push({ x, y });
      }
    }
    return { verts, tris: att.triangles, uvs: att.uvs, mesh: true };
  }
  const m = world[slot.bone];
  const hw = att.width / 2, hh = att.height / 2, ax = att.x || 0, ay = att.y || 0;
  const verts = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => apply(m, ax + x, ay + y));
  return { verts, tris: [0, 1, 2, 0, 2, 3], uvs: [0, 1, 1, 1, 1, 0, 0, 0], mesh: false };
}

const triArea = (a, b, c) => ((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;

/** Distanza di un punto dalla figura (0 se dentro uno dei triangoli). */
function distToShape(pt, g) {
  let best = Infinity;
  for (let i = 0; i < g.tris.length; i += 3) {
    const a = g.verts[g.tris[i]], b = g.verts[g.tris[i + 1]], c = g.verts[g.tris[i + 2]];
    const d1 = triArea(pt, a, b), d2 = triArea(pt, b, c), d3 = triArea(pt, c, a);
    const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
    if (!(neg && pos)) return 0;
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const vx = v.x - u.x, vy = v.y - u.y, l2 = vx * vx + vy * vy || 1;
      const t = Math.max(0, Math.min(1, ((pt.x - u.x) * vx + (pt.y - u.y) * vy) / l2));
      best = Math.min(best, Math.hypot(pt.x - (u.x + t * vx), pt.y - (u.y + t * vy)));
    }
  }
  return best;
}

/** Distanza (px, fino a limit+1) dal pixel opaco più vicino dell'immagine di una region. */
function distToOpaque(pt, json, world, slot, img, limit) {
  const att = json.skins[0].attachments[slot.name][slot.attachment];
  const m = world[slot.bone];
  const det = m.a * m.d - m.b * m.c || 1;
  const dx = pt.x - m.tx, dy = pt.y - m.ty;
  const lx = (m.d * dx - m.b * dy) / det, ly = (-m.c * dx + m.a * dy) / det; // locale dell'osso
  const px = lx - ((att.x || 0) - att.width / 2), py = (att.y || 0) + att.height / 2 - ly; // pixel immagine
  const sx = img.width / att.width, sy = img.height / att.height;
  let best = limit + 1;
  const r = Math.ceil(limit);
  for (let oy = -r; oy <= r; oy++)
    for (let ox = -r; ox <= r; ox++) {
      const d = Math.hypot(ox, oy);
      if (d >= best) continue;
      const ix = Math.round((px + ox) * sx), iy = Math.round((py + oy) * sy);
      if (ix < 0 || iy < 0 || ix >= img.width || iy >= img.height) continue;
      if (img.rgba[(iy * img.width + ix) * 4 + 3] >= 128) best = d;
    }
  return best;
}

/** C'è un pixel pieno di QUALCHE parte nel punto (serve a scoprire buchi ai raccordi). */
function coveredAt(pt, json, world, geos, images, only = null) {
  for (const slot of json.slots) {
    if (only && !only.has(slot.name)) continue;
    const img = images[slot.name];
    const g = geos[slot.name];
    if (!img || !g) continue;
    if (!g.mesh) {
      if (distToOpaque(pt, json, world, slot, img, 0) === 0) return true;
      continue;
    }
    for (let i = 0; i < g.tris.length; i += 3) {
      const [ia, ib, ic] = [g.tris[i], g.tris[i + 1], g.tris[i + 2]];
      const a = g.verts[ia], b = g.verts[ib], c = g.verts[ic];
      const A = triArea(a, b, c);
      if (Math.abs(A) < 1e-9) continue;
      const u = triArea(pt, b, c) / A, v = triArea(a, pt, c) / A, w = 1 - u - v;
      if (u < -1e-6 || v < -1e-6 || w < -1e-6) continue;
      const tu = u * g.uvs[ia * 2] + v * g.uvs[ib * 2] + w * g.uvs[ic * 2];
      const tv = u * g.uvs[ia * 2 + 1] + v * g.uvs[ib * 2 + 1] + w * g.uvs[ic * 2 + 1];
      const ix = Math.min(img.width - 1, Math.max(0, Math.round(tu * (img.width - 1))));
      const iy = Math.min(img.height - 1, Math.max(0, Math.round(tv * (img.height - 1))));
      if (img.rgba[(iy * img.width + ix) * 4 + 3] >= 128) return true;
      break;
    }
  }
  return false;
}

/**
 * Simula il loop e controlla le proprietà in movimento.
 * @param {Object} json - skeleton Spine 4.1
 * @param {Object} [opt] - { fps, jointTolerance (px), maxRotation (gradi), boundsMargin (quota),
 *   images: { nomeSlot: {width,height,rgba} } per controllare i raccordi sui pixel pieni,
 *   referenceImages: come images, ma "come dovrebbe essere" (es. pezzi prima di un ritocco) }
 * @returns {{ ok, problems: string[], stats }}
 */
export function simulateLoop(json, opt = {}) {
  const fps = opt.fps ?? 30;
  const tol = opt.jointTolerance ?? 6;
  const maxRot = opt.maxRotation ?? 15;
  const margin = opt.boundsMargin ?? 0.2;
  const anim = json.animations?.ambient;
  const duration = Math.max(0, ...Object.values(anim?.bones || {}).flatMap((tl) => Object.values(tl).map((k) => k[k.length - 1]?.time || 0)));
  const frames = Math.max(1, Math.round(duration * fps));
  const problems = [];
  const stats = { frames, worstJoint: {}, maxFootShift: 0, minTriRatio: 1, maxRotation: 0 };

  const boneByName = Object.fromEntries(json.bones.map((b) => [b.name, b]));
  const slotByBone = Object.fromEntries(json.slots.map((s) => [s.bone, s]));
  // genitore "visibile" di un osso: il primo antenato con un allegato
  const visibleParent = (name) => {
    for (let p = boneByName[name]?.parent; p; p = boneByName[p]?.parent) if (slotByBone[p]) return p;
    return null;
  };
  const joints = json.slots.map((s) => ({ child: s.bone, parent: visibleParent(s.bone) })).filter((j) => j.parent);

  // riposo: geometrie, ingombro, aree dei triangoli, vertici "piedi" delle mesh
  const rest = poseAt(json, 0, "__nessuna__");
  const restGeo = Object.fromEntries(json.slots.map((s) => [s.name, attachmentGeometry(json, rest, s)]));
  const all = Object.values(restGeo).filter(Boolean).flatMap((g) => g.verts);
  const box = { minX: Math.min(...all.map((p) => p.x)), maxX: Math.max(...all.map((p) => p.x)), minY: Math.min(...all.map((p) => p.y)), maxY: Math.max(...all.map((p) => p.y)) };
  const mx = (box.maxX - box.minX) * margin, my = (box.maxY - box.minY) * margin;
  const feet = {};
  // "piedi" = base delle mesh agganciate alla radice (il corpo che poggia a terra)
  const rootName = json.bones.find((b) => !b.parent)?.name;
  for (const s of json.slots) {
    const g = restGeo[s.name];
    if (g?.mesh && boneByName[s.bone]?.parent === rootName) feet[s.name] = g.verts.map((_, i) => i).filter((i) => g.uvs[i * 2 + 1] >= 0.99);
  }

  // RACCORDI pixel per pixel: punti attorno a ogni aggancio pieni a riposo devono restare pieni
  // (seguono l'aggancio): se in movimento si svuotano, si è aperto un buco fra le due parti
  const seamR = opt.seamRadius ?? 14, seamStep = 3;
  const seams = [];
  // solo i pixel delle due parti del raccordo (e dei figli della parte agganciata): un'altra
  // parte che passa lì vicino (es. il braccio alzato accanto a una ciocca) non conta
  const subtree = (name) => {
    const out = new Set([name]);
    for (const b of json.bones) if (b.parent && out.has(b.parent)) out.add(b.name);
    return out;
  };
  if (opt.images)
    for (const j of joints) {
      const o = rest[j.child];
      const only = new Set([...subtree(j.child), j.parent].map((b) => slotByBone[b]?.name).filter(Boolean));
      const pts = [];
      for (let dy = -seamR; dy <= seamR; dy += seamStep)
        for (let dx = -seamR; dx <= seamR; dx += seamStep)
          if (Math.hypot(dx, dy) <= seamR && coveredAt({ x: o.tx + dx, y: o.ty + dy }, json, rest, restGeo, opt.referenceImages || opt.images, only)) pts.push([dx, dy]);
      seams.push({ child: j.child, parent: j.parent, pts, only });
    }
  stats.seamHoles = {};

  // VISO: occhi/sopracciglia/bocca su una testa a mesh non devono SCIVOLARE sulla pelle (il punto
  // della mesh sotto il loro aggancio deve muoversi con loro) e gli occhi battono insieme
  const isFeature = (n) => /^(occhio|sopracciglio|bocca)(_|$)/.test(n);
  const slides = [];
  for (const j of joints) {
    if (!isFeature(j.child)) continue;
    const g = restGeo[slotByBone[j.parent].name];
    if (!g?.mesh) continue;
    const o = rest[j.child];
    for (let i = 0; i < g.tris.length; i += 3) {
      const [a, b, c] = [g.verts[g.tris[i]], g.verts[g.tris[i + 1]], g.verts[g.tris[i + 2]]];
      const A = triArea(a, b, c);
      if (Math.abs(A) < 1e-9) continue;
      const u = triArea({ x: o.tx, y: o.ty }, b, c) / A, v = triArea(a, { x: o.tx, y: o.ty }, c) / A, w = 1 - u - v;
      if (u < -1e-6 || v < -1e-6 || w < -1e-6) continue;
      slides.push({ child: j.child, slot: slotByBone[j.parent].name, tri: i, bary: [u, v, w] });
      break;
    }
  }
  const slideTol = opt.slideTolerance ?? 1;
  stats.maxSlide = 0;
  const eyes = json.bones.filter((b) => /^occhio(_|$)/.test(b.name)).map((b) => b.name);

  const report = new Set();
  const once = (key, msg) => {
    if (!report.has(key)) {
      report.add(key);
      problems.push(msg);
    }
  };
  for (let f = 0; f <= frames; f++) {
    const t = (f / frames) * duration;
    const w = poseAt(json, t);
    const geo = Object.fromEntries(json.slots.map((s) => [s.name, attachmentGeometry(json, w, s)]));
    for (const j of joints) {
      const o = w[j.child];
      const pslot = slotByBone[j.parent];
      const img = opt.images?.[pslot.name];
      // con l'immagine del genitore si controlla il pixel PIENO (non solo il rettangolo)
      const d = img && !geo[pslot.name].mesh ? distToOpaque({ x: o.tx, y: o.ty }, json, w, pslot, img, tol) : distToShape({ x: o.tx, y: o.ty }, geo[pslot.name]);
      stats.worstJoint[j.child] = Math.max(stats.worstJoint[j.child] || 0, d);
      if (d > tol) once(`joint:${j.child}`, `Raccordo "${j.child}" staccato da "${j.parent}" di ${d.toFixed(1)}px a t=${t.toFixed(2)}s.`);
    }
    for (const sm of seams) {
      const o = w[sm.child], po = w[sm.parent];
      // i punti seguono l'aggancio e ruotano a metà fra le due parti (la piega del giunto)
      const da = deg(((o.rot - rest[sm.child].rot) + (po.rot - rest[sm.parent].rot)) / 2);
      const c = Math.cos(da), sn = Math.sin(da);
      let holes = 0;
      for (const [dx, dy] of sm.pts)
        if (!coveredAt({ x: o.tx + c * dx - sn * dy, y: o.ty + sn * dx + c * dy }, json, w, geo, opt.images, sm.only)) holes++;
      stats.seamHoles[sm.child] = Math.max(stats.seamHoles[sm.child] || 0, holes);
      // tolleranza: bordi anti-alias e spigoli (≤ 5% dei punti, almeno 2)
      if (holes > (opt.seamHoleMax ?? Math.max(2, Math.round(0.05 * sm.pts.length)))) once(`seam:${sm.child}`, `Buco al raccordo "${sm.child}"/"${sm.parent}": ${holes} punti scoperti a t=${t.toFixed(2)}s.`);
    }
    for (const sl of slides) {
      const g = geo[sl.slot], o = w[sl.child];
      const [a, b, c] = [g.verts[g.tris[sl.tri]], g.verts[g.tris[sl.tri + 1]], g.verts[g.tris[sl.tri + 2]]];
      const [u, v, z] = sl.bary;
      const d = Math.hypot(u * a.x + v * b.x + z * c.x - o.tx, u * a.y + v * b.y + z * c.y - o.ty);
      stats.maxSlide = Math.max(stats.maxSlide, d);
      if (d > slideTol) once(`slide:${sl.child}`, `"${sl.child}" scivola sulla pelle della testa di ${d.toFixed(2)}px a t=${t.toFixed(2)}s (la fascia che ondeggia tocca il viso).`);
    }
    if (eyes.length > 1) {
      const sy = eyes.map((e) => sample(anim?.bones?.[e]?.scale, t, "y", 1));
      if (Math.max(...sy) - Math.min(...sy) > 0.05) once("eyes", `Occhi non sincronizzati a t=${t.toFixed(2)}s (${eyes.join(", ")}): devono battere insieme.`);
    }
    for (const [name, g] of Object.entries(geo)) {
      if (!g) continue;
      const r0 = restGeo[name];
      if (g.mesh) {
        for (const i of feet[name] || []) {
          const s = Math.hypot(g.verts[i].x - r0.verts[i].x, g.verts[i].y - r0.verts[i].y);
          stats.maxFootShift = Math.max(stats.maxFootShift, s);
          if (s > 0.5) once(`feet:${name}`, `Mesh "${name}": la base si muove di ${s.toFixed(2)}px a t=${t.toFixed(2)}s (i piedi devono restare fermi).`);
        }
        for (let i = 0; i < g.tris.length; i += 3) {
          const a0 = triArea(r0.verts[g.tris[i]], r0.verts[g.tris[i + 1]], r0.verts[g.tris[i + 2]]);
          const a1 = triArea(g.verts[g.tris[i]], g.verts[g.tris[i + 1]], g.verts[g.tris[i + 2]]);
          if (Math.abs(a0) < 1e-6) continue;
          const ratio = a1 / a0;
          stats.minTriRatio = Math.min(stats.minTriRatio, ratio);
          if (ratio < 0.5) once(`tri:${name}`, `Mesh "${name}": triangolo ${i / 3} ${ratio <= 0 ? "rovesciato" : "schiacciato"} (area ×${ratio.toFixed(2)}) a t=${t.toFixed(2)}s.`);
        }
      }
      for (const p of g.verts)
        if (p.x < box.minX - mx || p.x > box.maxX + mx || p.y < box.minY - my || p.y > box.maxY + my)
          once(`bounds:${name}`, `"${name}" esce dall'ingombro di riposo a t=${t.toFixed(2)}s.`);
    }
    for (const [b, tl] of Object.entries(anim?.bones || {})) {
      const r = Math.abs(sample(tl.rotate, t, "value", 0));
      stats.maxRotation = Math.max(stats.maxRotation, r);
      if (r > maxRot) once(`rot:${b}`, `Osso "${b}" ruota di ${r.toFixed(1)}° (massimo ${maxRot}°).`);
    }
  }
  return { ok: problems.length === 0, problems, stats };
}
