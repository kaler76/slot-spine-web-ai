/**
 * Genera il contenuto testuale di un file .atlas (formato libgdx/Spine) per
 * una singola immagine che occupa l'intera texture (nessun packing multi-region:
 * un blocco per immagine).
 *
 * @param {Object} params
 * @param {string} params.imageFileName - es. "cherry.png"
 * @param {string} params.regionName - nome della region, deve combaciare con
 *        il nome dell'attachment nello skeleton.json
 * @param {number} params.width - larghezza immagine/texture in px
 * @param {number} params.height - altezza immagine/texture in px
 * @returns {string} contenuto del file .atlas
 */
export function buildAtlas({ imageFileName, regionName, width, height }) {
  return [
    imageFileName,
    `size: ${width},${height}`,
    "format: RGBA8888",
    "filter: Linear,Linear",
    "repeat: none",
    regionName,
    "  rotate: false",
    "  xy: 0, 0",
    `  size: ${width}, ${height}`,
    `  orig: ${width}, ${height}`,
    "  offset: 0, 0",
    "  index: -1"
  ].join("\n") + "\n";
}

/**
 * Genera un atlas multi-pagina: una "pagina" (blocco immagine+region) per ciascuna
 * parte del character. Il formato .atlas di Spine supporta più pagine nello stesso
 * file, ciascuna introdotta dal proprio nome immagine — non serve un vero texture
 * packing, ogni parte resta un file PNG separato referenziato nello stesso atlas.
 *
 * @param {Array<{imageFileName: string, regionName: string, width: number, height: number}>} parts
 */
export function buildMultiPartAtlas(parts) {
  return parts.map((p) => buildAtlas(p)).join("\n");
}
