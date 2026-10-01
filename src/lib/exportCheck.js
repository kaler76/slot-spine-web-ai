// src/lib/exportCheck.js — verifica dello skeleton ESPORTATO (dopo toSpine41), prima di
// salvarlo: si controlla il file che arriverà in Spine, non le intenzioni del generatore.
//  - parti attese per ruolo (testa, busto, due braccia) e oggetti;
//  - ogni slot ha il suo allegato, ogni osso ha un genitore esistente e viene dopo di lui;
//  - mesh: triangoli validi, indici ossa validi, pesi che sommano a 1;
//  - animazione ambient: tutte le tracce finiscono allo stesso istante (loop chiuso).
// Puro e testabile: nessun DOM.

/**
 * @param {Object} json - skeleton Spine 4.1 (uscita di toSpine41)
 * @param {Array<{partKey, role}>} parts - parti del character (per i ruoli attesi)
 * @returns {{ ok: boolean, errors: string[], warnings: string[], summary: Object }}
 */
export function verifyExportSkeleton(json, parts = []) {
  const errors = [];
  const warnings = [];
  const bones = json.bones || [];
  const names = new Map(bones.map((b, i) => [b.name, i]));

  // ossa: genitore esistente e prima del figlio
  bones.forEach((b, i) => {
    if (b.parent === undefined) return;
    if (!names.has(b.parent)) errors.push(`Osso "${b.name}": genitore "${b.parent}" inesistente.`);
    else if (names.get(b.parent) > i) errors.push(`Osso "${b.name}" prima del suo genitore "${b.parent}".`);
  });

  // slot e allegati
  const skin = json.skins?.[0]?.attachments || {};
  let regions = 0, meshes = 0;
  const meshNames = [];
  for (const s of json.slots || []) {
    if (!names.has(s.bone)) errors.push(`Slot "${s.name}": osso "${s.bone}" inesistente.`);
    const att = skin[s.name]?.[s.attachment];
    if (!att) {
      errors.push(`Slot "${s.name}": allegato "${s.attachment}" mancante.`);
      continue;
    }
    if (att.type === "mesh") {
      meshes++;
      meshNames.push(s.name);
      const nV = att.uvs.length / 2;
      if (att.triangles.some((t) => t < 0 || t >= nV)) errors.push(`Mesh "${s.name}": triangolo con vertice inesistente.`);
      if (!(att.hull > 2 && att.hull <= nV)) errors.push(`Mesh "${s.name}": contorno (hull) non valido.`);
      if (att.vertices.length !== att.uvs.length) {
        // pesata: [n, (osso, x, y, peso) * n] per vertice
        let i = 0, v = 0;
        while (i < att.vertices.length) {
          const n = att.vertices[i++];
          let sum = 0;
          for (let k = 0; k < n; k++, i += 4) {
            const bi = att.vertices[i];
            if (!(bi >= 0 && bi < bones.length)) {
              errors.push(`Mesh "${s.name}": vertice ${v} legato a un osso inesistente (${bi}).`);
              break;
            }
            sum += att.vertices[i + 3];
          }
          if (Math.abs(sum - 1) > 0.01) {
            errors.push(`Mesh "${s.name}": pesi del vertice ${v} sommano a ${sum.toFixed(3)}.`);
            break;
          }
          v++;
        }
        if (v !== nV) errors.push(`Mesh "${s.name}": ${v} vertici pesati invece di ${nV}.`);
      }
    } else if (att.type === "region" || !att.type) regions++;
  }

  // parti attese per ruolo
  const byRole = (r) => parts.filter((p) => p.role === r).map((p) => p.partKey);
  if (!byRole("head").length) warnings.push("Nessuna parte con ruolo testa.");
  if (!byRole("torso").length) warnings.push("Nessuna parte con ruolo busto.");
  const arms = byRole("arm");
  if (arms.length < 2) warnings.push(`Braccia trovate: ${arms.length} su 2 (${arms.join(", ") || "nessuna"}): controllare i ruoli prima di animare.`);
  for (const p of parts) if (!names.has(p.partKey)) errors.push(`Parte "${p.partKey}" senza osso nello skeleton.`);

  // animazione ambient: loop chiuso
  const amb = json.animations?.ambient;
  let duration = 0;
  if (!amb) warnings.push("Nessuna animazione ambient.");
  else {
    const ends = [];
    for (const [b, tl] of Object.entries(amb.bones || {})) {
      if (!names.has(b)) errors.push(`Animazione: osso "${b}" inesistente.`);
      for (const [kind, keys] of Object.entries(tl)) if (keys.length) ends.push([`${b}.${kind}`, keys[keys.length - 1].time]);
      for (const k of tl.rotate || []) if ("angle" in k) errors.push(`Animazione: osso "${b}" usa "angle" (Spine 4.1 vuole "value").`);
    }
    duration = Math.max(0, ...ends.map((e) => e[1]));
    const short = ends.filter((e) => Math.abs(e[1] - duration) > 1e-3);
    if (short.length) warnings.push(`Loop non chiuso: ${short.length} tracce finiscono prima di ${duration}s (${short.slice(0, 3).map((e) => e[0]).join(", ")}…).`);
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    summary: { bones: bones.length, slots: (json.slots || []).length, regions, meshes, meshNames, duration }
  };
}
