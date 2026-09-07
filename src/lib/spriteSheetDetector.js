/**
 * Rilevamento automatico delle "tessere" in uno sprite sheet, portato in JS
 * puro (stessa logica dello script Python usato per i test manuali):
 *  1. maschera dei pixel non trasparenti
 *  2. leggera dilatazione per unire tratti dello stesso disegno separati da
 *     piccoli gap (anti-aliasing, dettagli sottili)
 *  3. connected components (8-adiacenza) via flood fill iterativo
 *  4. bounding box ristretto ai pixel REALI (non dilatati) di ogni componente
 *  5. classificazione illustrazione vs etichetta di testo tramite saturazione
 *     media HSV (le etichette nero/bianco hanno saturazione quasi zero)
 *
 * Operiamo su semplici array (Uint8Array/Int32Array), senza dipendenze da
 * canvas: il chiamante fornisce { width, height, rgba } (Uint8ClampedArray
 * RGBA, come da ImageData) e riceve indietro le regioni rilevate.
 */

const MIN_COMPONENT_PIXELS = 200;
const MIN_COMPONENT_AREA = 400;
const DILATION_ITERATIONS = 2;
const EROSION_ITERATIONS = 1;
const ALPHA_THRESHOLD = 15;
const LABEL_SATURATION_THRESHOLD = 0.12;

function dilateMask(mask, width, height, iterations) {
  let current = mask;
  for (let it = 0; it < iterations; it++) {
    const next = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (current[idx]) {
          next[idx] = 1;
          continue;
        }
        let found = 0;
        for (let dy = -1; dy <= 1 && !found; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= width) continue;
            if (current[ny * width + nx]) {
              found = 1;
              break;
            }
          }
        }
        next[idx] = found;
      }
    }
    current = next;
  }
  return current;
}

/**
 * Erosione: un pixel resta "dentro" solo se lui E tutti gli 8 vicini lo sono già.
 * Serve a togliere il sottile bordino chiaro di anti-aliasing che resta attaccato
 * al ritaglio quando lo sfondo non è vera trasparenza alpha ma un bianco pieno
 * (la sfumatura verso il bianco a bordo forma altrimenti un contorno bianco/grigio
 * visibile su ogni pezzo importato).
 */
function erodeMask(mask, width, height, iterations) {
  let current = mask;
  for (let it = 0; it < iterations; it++) {
    const next = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (!current[idx]) continue;
        let allForeground = 1;
        for (let dy = -1; dy <= 1 && allForeground; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) { allForeground = 0; break; }
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= width || !current[ny * width + nx]) { allForeground = 0; break; }
          }
        }
        next[idx] = allForeground;
      }
    }
    current = next;
  }
  return current;
}

/** Connected components a 8-adiacenza tramite flood fill iterativo (BFS con array come coda). */
function labelComponents(mask, width, height) {
  const labels = new Int32Array(width * height); // 0 = nessuna componente
  let nextLabel = 1;
  const queue = new Int32Array(width * height);

  for (let start = 0; start < width * height; start++) {
    if (!mask[start] || labels[start]) continue;
    const label = nextLabel++;
    let qHead = 0;
    let qTail = 0;
    queue[qTail++] = start;
    labels[start] = label;

    while (qHead < qTail) {
      const idx = queue[qHead++];
      const x = idx % width;
      const y = (idx - x) / width;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const nIdx = ny * width + nx;
          if (mask[nIdx] && !labels[nIdx]) {
            labels[nIdx] = label;
            queue[qTail++] = nIdx;
          }
        }
      }
    }
  }
  return { labels, count: nextLabel - 1 };
}

/**
 * Analizza un buffer RGBA e ritorna le regioni rilevate.
 * @param {Object} params
 * @param {number} params.width
 * @param {number} params.height
 * @param {Uint8ClampedArray|Uint8Array} params.rgba - 4 byte per pixel (R,G,B,A)
 * @returns {{ regions: Array, labels: Int32Array }}
 */
export function detectSpriteRegions({ width, height, rgba }) {
  const n = width * height;

  // Alcuni generatori AI non rispettano sempre la richiesta di sfondo
  // trasparente, restituendo invece un canvas bianco pieno (alpha=255
  // ovunque). In quel caso basarsi sull'alpha per separare gli elementi non
  // funziona: passiamo a un fallback basato sul colore (sfondo ~bianco).
  let transparentPixelCount = 0;
  for (let i = 0; i < n; i++) {
    if (rgba[i * 4 + 3] < 250) transparentPixelCount++;
  }
  const hasRealTransparency = transparentPixelCount / n > 0.01;

  const rawMask = new Uint8Array(n);
  if (hasRealTransparency) {
    for (let i = 0; i < n; i++) {
      rawMask[i] = rgba[i * 4 + 3] > ALPHA_THRESHOLD ? 1 : 0;
    }
  } else {
    const WHITE_THRESHOLD = 235;
    for (let i = 0; i < n; i++) {
      const r = rgba[i * 4];
      const g = rgba[i * 4 + 1];
      const b = rgba[i * 4 + 2];
      const isNearWhite = r > WHITE_THRESHOLD && g > WHITE_THRESHOLD && b > WHITE_THRESHOLD;
      rawMask[i] = isNearWhite ? 0 : 1;
    }
  }

  const dilated = dilateMask(rawMask, width, height, DILATION_ITERATIONS);
  const { labels, count } = labelComponents(dilated, width, height);
  // Solo per il ritaglio finale (non per bounding box/centro, che restano sui pixel
  // reali): elimina il bordino di anti-aliasing chiaro rimasto attaccato al pezzo.
  const erodedMask = erodeMask(rawMask, width, height, EROSION_ITERATIONS);

  // Bounding box + conteggio pixel REALI per ogni componente (sui pixel non dilatati)
  const stats = Array.from({ length: count + 1 }, () => ({
    minX: Infinity, minY: Infinity, maxX: -1, maxY: -1, pixelCount: 0
  }));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (!rawMask[idx]) continue;
      const label = labels[idx];
      if (!label) continue;
      const s = stats[label];
      if (x < s.minX) s.minX = x;
      if (x > s.maxX) s.maxX = x;
      if (y < s.minY) s.minY = y;
      if (y > s.maxY) s.maxY = y;
      s.pixelCount++;
    }
  }

  const regions = [];
  for (let label = 1; label <= count; label++) {
    const s = stats[label];
    if (s.pixelCount < MIN_COMPONENT_PIXELS || s.maxX < 0) continue;
    const w = s.maxX - s.minX + 1;
    const h = s.maxY - s.minY + 1;
    if (w * h < MIN_COMPONENT_AREA) continue;

    // Saturazione media HSV + frazione di pixel "estremi" (nerissimi/biancissimi)
    // sui pixel reali del componente, in un unico passaggio.
    let satSum = 0;
    let satCount = 0;
    let extremeCount = 0;
    for (let y = s.minY; y <= s.maxY; y++) {
      for (let x = s.minX; x <= s.maxX; x++) {
        const idx = y * width + x;
        if (!rawMask[idx] || labels[idx] !== label) continue;
        const r = rgba[idx * 4] / 255;
        const g = rgba[idx * 4 + 1] / 255;
        const b = rgba[idx * 4 + 2] / 255;
        const maxc = Math.max(r, g, b);
        const minc = Math.min(r, g, b);
        const sat = maxc > 0 ? (maxc - minc) / maxc : 0;
        satSum += sat;
        satCount++;
        // Luminanza: le etichette di testo sono quasi esclusivamente pixel
        // nerissimi (sfondo) o biancissimi (testo) — un'illustrazione desaturata
        // (es. pelle verde pallido) ha invece una gamma continua di toni medi.
        const luminance = (r + g + b) / 3;
        if (luminance < 0.15 || luminance > 0.9) extremeCount++;
      }
    }
    const meanSaturation = satCount > 0 ? satSum / satCount : 0;
    const extremeFraction = satCount > 0 ? extremeCount / satCount : 0;

    regions.push({
      label,
      x: s.minX,
      y: s.minY,
      w,
      h,
      pixelCount: s.pixelCount,
      meanSaturation,
      extremeFraction,
      // Un'etichetta è poco satura E marcatamente bimodale (nero+bianco), non
      // semplicemente poco satura: un'illustrazione con colori tenui (pelle
      // verde chiaro, toni pastello) non deve essere scartata per errore.
      isProbablyLabel: meanSaturation < LABEL_SATURATION_THRESHOLD && extremeFraction > 0.55
    });
  }

  regions.sort((a, b) => (a.y - b.y) || (a.x - b.x));
  return { regions, labels, rawMask, erodedMask };
}
