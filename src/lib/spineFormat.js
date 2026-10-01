/**
 * Normalizza uno skeleton JSON generato dall'app al formato Spine 4.1 prima dell'export.
 *
 * - Timeline rotate: Spine 4.x legge la chiave "value"; i template interni usano "angle"
 *   (formato 3.8), che l'editor/runtime 4.1 ignora -> animazione ferma a 0°.
 *   La preview interna continua a leggere "angle": qui si converte solo la copia esportata.
 * - skeleton.images: le PNG sono nello zip accanto al .json, non in ./images/.
 * - bones: ordine topologico (genitore prima dei figli), richiesto da Spine.
 *
 * Non muta l'oggetto in ingresso.
 */
export function toSpine41(skeletonJson) {
  const json = structuredClone(skeletonJson);

  if (json.skeleton) json.skeleton.images = "./";

  if (Array.isArray(json.bones)) json.bones = sortBonesTopologically(json.bones);

  for (const anim of Object.values(json.animations || {})) {
    for (const timelines of Object.values(anim.bones || {})) {
      for (const key of timelines.rotate || []) {
        if ("angle" in key) {
          if (!("value" in key)) key.value = key.angle;
          delete key.angle;
        }
      }
    }
  }
  return json;
}

function sortBonesTopologically(bones) {
  const out = [];
  const placed = new Set();
  const pending = [...bones];
  while (pending.length) {
    const before = pending.length;
    for (let i = 0; i < pending.length; i++) {
      const b = pending[i];
      if (!b.parent || placed.has(b.parent)) {
        out.push(b);
        placed.add(b.name);
        pending.splice(i--, 1);
      }
    }
    if (pending.length === before) {
      throw new Error(`Gerarchia ossa non valida (genitore mancante o ciclo): ${pending.map((b) => b.name).join(", ")}`);
    }
  }
  return out;
}
