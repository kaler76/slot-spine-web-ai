// src/lib/jointUnderlay.js — SOVRAPPOSIZIONE AUTOMATICA ai raccordi (autoSelect.js).
// Quando un pezzo ruota attorno al suo pivot, dove prima c'erano i suoi pixel si vede ciò che sta
// DIETRO di lui: se dietro non c'è nulla si apre un buco (testaBustoCheck.motionStats).
// Qui, vicino al pivot di ogni pezzo che si muove, la zona che il pezzo copre a riposo e sotto cui
// non c'è nulla viene riempita nei pezzi che gli stanno DIETRO (fermi rispetto a lui), per
// dilatazione dal loro bordo (media dei vicini già pieni). Si aggiungono solo pixel nascosti dal
// pezzo davanti (alpha ≥ 250): a riposo la ricomposizione resta identica.
// Puro: nessun DOM.

const OPAQUE = 250;
const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];

const alphaAt = (p, gx, gy) => {
  const x = Math.round(gx - p.x), y = Math.round(gy - p.y);
  if (x < 0 || y < 0 || x >= p.width || y >= p.height) return 0;
  return p.rgba[(y * p.width + x) * 4 + 3];
};

/** Copia del pezzo allargata per contenere il riquadro [x0,y0]-[x1,y1] (coordinate globali). */
function grow(p, x0, y0, x1, y1) {
  const px = Math.round(p.x), py = Math.round(p.y);
  const nx0 = Math.min(px, x0), ny0 = Math.min(py, y0);
  const nx1 = Math.max(px + p.width, x1 + 1), ny1 = Math.max(py + p.height, y1 + 1);
  const W = nx1 - nx0, H = ny1 - ny0;
  if (nx0 === px && ny0 === py && W === p.width && H === p.height) return { ...p, rgba: Uint8ClampedArray.from(p.rgba) };
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < p.height; y++) rgba.set(p.rgba.subarray(y * p.width * 4, (y + 1) * p.width * 4), ((y + py - ny0) * W + (px - nx0)) * 4);
  // jointBase: misura originale (i controlli in movimento ragionano sul pezzo disegnato)
  return { ...p, x: nx0, y: ny0, width: W, height: H, rgba, jointBase: p.jointBase || { width: p.width, height: p.height } };
}

/** Discendenti nel rig (genitore = nome), pezzo incluso. */
function subtreeNames(pieces, root) {
  const out = new Set([root]);
  let more = true;
  while (more) {
    more = false;
    for (const q of pieces) if (q.parent && out.has(q.parent) && !out.has(q.name)) { out.add(q.name); more = true; }
  }
  return out;
}

/**
 * @param {Array} pieces - pezzi di importExplodedSheet (name, parent, pivot, order, x, y, rgba)
 * @param {Object} [o] - reach: raggio come quota del lato maggiore del pezzo (0 = niente); maxPx
 * @returns {{ pieces, changes: Array<{ joint, into, radius, added }> }}
 */
export function underlayJoints(pieces, { reach = 0.2, maxPx = 90 } = {}) {
  if (!reach) return { pieces, changes: [] };
  let list = pieces.slice();
  const changes = [];
  for (const child of pieces) {
    if (!child.parent || !child.pivot || !Number.isFinite(child.pivot.x) || !Number.isFinite(child.pivot.y)) continue;
    const c = list.find((p) => p.name === child.name);
    const moving = subtreeNames(list, c.name);
    const behind = list.filter((q) => !moving.has(q.name) && q.order < c.order).sort((a, b) => b.order - a.order);
    if (!behind.length) continue;
    const base = c.jointBase || c;
    const R = Math.round(Math.min(maxPx, reach * Math.max(base.width, base.height)));
    if (!(R >= 2)) continue;
    const cx = c.pivot.x, cy = c.pivot.y;
    const x0 = Math.floor(cx - R) - 1, y0 = Math.floor(cy - R) - 1, x1 = Math.ceil(cx + R) + 1, y1 = Math.ceil(cy + R) + 1;
    const W = x1 - x0 + 1, H = y1 - y0 + 1;
    // owner: indice in "behind" del pezzo dietro più vicino in profondità (-1 = vuoto); colore
    const owner = new Int16Array(W * H).fill(-1);
    const col = new Float32Array(W * H * 3);
    const mask = new Uint8Array(W * H);
    let todo = 0;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const gx = x + x0, gy = y + y0, i = y * W + x;
        const k = behind.findIndex((q) => alphaAt(q, gx, gy) >= 200);
        if (k >= 0) {
          const q = behind[k], j = (Math.round(gy - q.y) * q.width + Math.round(gx - q.x)) * 4;
          owner[i] = k;
          col.set([q.rgba[j], q.rgba[j + 1], q.rgba[j + 2]], i * 3);
        } else if (Math.hypot(gx - cx, gy - cy) <= R && alphaAt(c, gx, gy) >= OPAQUE) {
          mask[i] = 1;
          todo++;
        }
      }
    if (!todo) continue;
    const added = new Map();
    for (let step = 0; step < R && todo; step++) {
      const fill = [];
      for (let i = 0; i < W * H; i++) {
        if (!mask[i]) continue;
        const x = i % W, y = (i - x) / W;
        let r = 0, g = 0, b = 0, n = 0, k = -1;
        for (const [dx, dy] of N8) {
          const X = x + dx, Y = y + dy;
          if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
          const j = Y * W + X;
          if (owner[j] < 0 || mask[j]) continue;
          if (k < 0 || owner[j] < k) k = owner[j]; // a parità, il pezzo più vicino in profondità
          r += col[j * 3]; g += col[j * 3 + 1]; b += col[j * 3 + 2]; n++;
        }
        if (n) fill.push([i, k, r / n, g / n, b / n]);
      }
      if (!fill.length) break;
      for (const [i, k, r, g, b] of fill) {
        owner[i] = k;
        col.set([r, g, b], i * 3);
        mask[i] = 0;
        todo--;
        const a = added.get(k) || [];
        a.push(i);
        added.set(k, a);
      }
    }
    for (const [k, idxs] of added) {
      const q0 = behind[k];
      let gx0 = Infinity, gy0 = Infinity, gx1 = -Infinity, gy1 = -Infinity;
      for (const i of idxs) {
        const x = (i % W) + x0, y = Math.floor(i / W) + y0;
        gx0 = Math.min(gx0, x); gy0 = Math.min(gy0, y); gx1 = Math.max(gx1, x); gy1 = Math.max(gy1, y);
      }
      const q = grow(q0, gx0, gy0, gx1, gy1);
      for (const i of idxs) {
        const gx = (i % W) + x0, gy = Math.floor(i / W) + y0;
        const j = ((gy - q.y) * q.width + (gx - q.x)) * 4;
        q.rgba[j] = col[i * 3]; q.rgba[j + 1] = col[i * 3 + 1]; q.rgba[j + 2] = col[i * 3 + 2]; q.rgba[j + 3] = 255;
      }
      list = list.map((p) => (p.name === q.name ? q : p));
      behind[k] = q;
      changes.push({ joint: c.name, into: q.name, radius: R, added: idxs.length });
    }
  }
  return { pieces: list, changes };
}
