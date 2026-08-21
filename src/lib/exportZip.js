import JSZip from "jszip";

/**
 * Costruisce e scarica lo zip Spine per una variante di animazione già salvata
 * (skeleton_json + atlas_text presenti nel record, immagine scaricata dall'URL pubblico).
 */
export async function downloadSpinePackage({ symbolName, animationType, imageUrl, skeletonJson, atlasText }) {
  const zip = new JSZip();
  const safeName = sanitizeName(symbolName);

  zip.file(`${safeName}.json`, JSON.stringify(skeletonJson, null, 2));
  zip.file(`${safeName}.atlas`, atlasText);

  const imageResponse = await fetch(imageUrl);
  const imageBlob = await imageResponse.blob();
  zip.file(`${safeName}.png`, imageBlob);

  const zipBlob = await zip.generateAsync({ type: "blob" });
  triggerDownload(zipBlob, `${safeName}_${animationType}_spine41.zip`);
}

/** Scarica in un unico zip tutte le animazioni disponibili per un simbolo. */
export async function downloadAllAnimationsPackage({ symbolName, animations }) {
  const zip = new JSZip();
  const safeName = sanitizeName(symbolName);

  for (const anim of animations) {
    const folder = zip.folder(anim.animation_type);
    folder.file(`${safeName}.json`, JSON.stringify(anim.skeleton_json, null, 2));
    folder.file(`${safeName}.atlas`, anim.atlas_text);
    const imageResponse = await fetch(anim.image_url);
    const imageBlob = await imageResponse.blob();
    folder.file(`${safeName}.png`, imageBlob);
  }

  const zipBlob = await zip.generateAsync({ type: "blob" });
  triggerDownload(zipBlob, `${safeName}_all_animations_spine41.zip`);
}

/**
 * Scarica il pacchetto Spine di un background: skeleton.json + atlas multi-pagina
 * + le immagini di tutti i layer.
 */
export async function downloadBackgroundPackage({ backgroundName, skeletonJson, atlasText, layers }) {
  const zip = new JSZip();
  const safeName = sanitizeName(backgroundName);

  zip.file(`${safeName}.json`, JSON.stringify(skeletonJson, null, 2));
  zip.file(`${safeName}.atlas`, atlasText);

  for (const layer of layers) {
    const imageResponse = await fetch(layer.image_url);
    const imageBlob = await imageResponse.blob();
    zip.file(`${layer.layer_key}.png`, imageBlob);
  }

  const zipBlob = await zip.generateAsync({ type: "blob" });
  triggerDownload(zipBlob, `${safeName}_ambient_spine41.zip`);
}

function sanitizeName(name) {
  return String(name || "symbol")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "") || "symbol";
}

/**
 * Scarica il pacchetto Spine di un character per una singola animazione:
 * skeleton.json + atlas multi-pagina + le immagini di tutte le parti usate.
 */
export async function downloadCharacterPackage({ characterName, skeletonJson, atlasText, parts }) {
  const zip = new JSZip();
  const safeName = sanitizeName(characterName);

  zip.file(`${safeName}.json`, JSON.stringify(skeletonJson, null, 2));
  zip.file(`${safeName}.atlas`, atlasText);

  for (const part of parts) {
    const imageResponse = await fetch(part.image_url);
    const imageBlob = await imageResponse.blob();
    zip.file(`${part.part_key}.png`, imageBlob);
  }

  const zipBlob = await zip.generateAsync({ type: "blob" });
  triggerDownload(zipBlob, `${safeName}_ambient_spine41.zip`);
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
