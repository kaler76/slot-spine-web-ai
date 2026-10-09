// src/lib/silhouetteMesh.js — MESH SULLA SAGOMA (regola R16 di docs/REGOLE_MESH.md, zeus-mesh-13).
// Prima ogni mesh era una griglia regolare sul riquadro intero (vertici anche sullo sfondo trasparente).
// Come in un rig professionale (Domatrice) qui:
//   - il CONTORNO (hull) segue la sagoma dei pixel visibili, allargata di 2 px (bordo sfumato coperto);
//     parti staccate unite da un corridoio sottile, buchi interni riempiti (Spine vuole UN contorno);
//   - i vertici interni stanno SOLO dentro la sagoma, più fitti nelle zone indicate (articolazioni, viso);
//   - triangolazione di Delaunay che rispetta il contorno (lati mancanti divisi a metà finché compaiono).
// Coordinate intere sugli spigoli dei pixel (0..bw, 0..bh): UV esatte, controlli geometrici esatti.
// Se qualcosa non torna (area dei triangoli diversa da quella del contorno) restituisce null e chi chiama
// usa la griglia di prima. Puro: nessun DOM.

const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** Maschera della sagoma: pixel visibili allargati, un solo pezzo 4-connesso, senza buchi né strozzature. */
export function silhouetteMask(alpha, w, h, grow = 2, keepHole = Infinity) {
  // griglia con un bordo vuoto di 1 px (il contorno non tocca mai il limite dell'array)
  const W = w + 2, H = h + 2, m = new Uint8Array(W * H);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (alpha[y * w + x]) m[(y + 1) * W + x + 1] = 1;
  dropSpecks(m, W, H);
  // allargamento (quadrato di lato 2·grow+1), dentro il riquadro dell'immagine
  for (let k = 0; k < grow; k++) {
    const src = m.slice();
    for (let y = 1; y <= h; y++) for (let x = 1; x <= w; x++) {
      if (src[y * W + x]) continue;
      let on = 0;
      for (let dy = -1; dy <= 1 && !on; dy++) for (let dx = -1; dx <= 1; dx++) if (src[(y + dy) * W + x + dx]) { on = 1; break; }
      if (on) m[y * W + x] = 1;
    }
  }
  let any = false; for (let i = 0; i < W * H; i++) if (m[i]) { any = true; break; }
  if (!any) return null;
  connect(m, W, H);
  for (let it = 0; it < 6; it++) { const a = fixPinches(m, W, H), b = fillHoles(m, W, H, keepHole); if (!a && !b) break; }
  return { m, W, H };
}

// puntini staccati (pochi pixel rimasti dal ritaglio: Zeus aveva 16 isole da 1–10 px attorno al fulmine): fuori
// dalla mesh, così non tirano corridoi fino a loro (non si vedono: Spine disegna solo dentro la mesh)
function dropSpecks(m, W, H) {
  const seen = new Uint8Array(W * H), comps = [];
  let tot = 0;
  for (let s = 0; s < W * H; s++) {
    if (!m[s] || seen[s]) continue;
    const st = [s], px = []; seen[s] = 1;
    while (st.length) { const i = st.pop(); px.push(i); const x = i % W, y = (i / W) | 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const j = (y + dy) * W + x + dx; if (m[j] && !seen[j]) { seen[j] = 1; st.push(j); } } }
    comps.push(px); tot += px.length;
  }
  const min = Math.min(200, 0.0005 * tot);
  for (const px of comps) if (px.length < min) for (const i of px) m[i] = 0;
}

// parti staccate: albero minimo dei corridoi fra le parti (Voronoi a 4 vicini), corridoio largo 5 px
function connect(m, W, H) {
  const comp = new Int32Array(W * H).fill(-1);
  let nc = 0;
  for (let s = 0; s < W * H; s++) {
    if (!m[s] || comp[s] >= 0) continue;
    const st = [s]; comp[s] = nc;
    while (st.length) { const i = st.pop(), x = i % W, y = (i / W) | 0; for (const [dx, dy] of N4) { const j = (y + dy) * W + x + dx; if (m[j] && comp[j] < 0) { comp[j] = nc; st.push(j); } } }
    nc++;
  }
  if (nc < 2) return;
  const own = comp.slice(), par = new Int32Array(W * H).fill(-1), dist = new Int32Array(W * H).fill(-1), q = [];
  for (let i = 0; i < W * H; i++) if (own[i] >= 0) { dist[i] = 0; q.push(i); }
  for (let k = 0; k < q.length; k++) {
    const i = q[k], x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of N4) { const nx = x + dx, ny = y + dy; if (nx < 1 || ny < 1 || nx > W - 2 || ny > H - 2) continue; const j = ny * W + nx; if (dist[j] < 0) { dist[j] = dist[i] + 1; own[j] = own[i]; par[j] = i; q.push(j); } }
  }
  const best = new Map();
  for (let i = 0; i < W * H; i++) {
    if (own[i] < 0) continue;
    const x = i % W;
    for (const j of [i + 1, i + W]) {
      if (j >= W * H || (j === i + 1 && x === W - 1) || own[j] < 0 || own[j] === own[i]) continue;
      const a = Math.min(own[i], own[j]), b = Math.max(own[i], own[j]), key = a * nc + b, c = dist[i] + dist[j];
      const cur = best.get(key);
      if (!cur || c < cur.c) best.set(key, { a, b, c, i, j });
    }
  }
  const root = Array.from({ length: nc }, (_, i) => i), find = (x) => (root[x] === x ? x : (root[x] = find(root[x])));
  const path = [];
  for (const e of [...best.values()].sort((p, q) => p.c - q.c)) {
    const ra = find(e.a), rb = find(e.b); if (ra === rb) continue; root[ra] = rb;
    for (let p = e.i; p >= 0; p = par[p]) path.push(p);
    for (let p = e.j; p >= 0; p = par[p]) path.push(p);
  }
  for (const i of path) { const x = i % W, y = (i / W) | 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const nx = x + dx, ny = y + dy; if (nx >= 1 && ny >= 1 && nx <= W - 2 && ny <= H - 2) m[ny * W + nx] = 1; } }
}

// due pixel che si toccano solo in diagonale: si riempie uno dei due vuoti (contorno semplice)
function fixPinches(m, W, H) {
  let ch = 0;
  for (let y = 0; y < H - 1; y++) for (let x = 0; x < W - 1; x++) {
    const a = m[y * W + x], b = m[y * W + x + 1], c = m[(y + 1) * W + x], d = m[(y + 1) * W + x + 1];
    if (a && d && !b && !c) { m[y * W + x + 1] = 1; ch++; } else if (b && c && !a && !d) { m[y * W + x] = 1; ch++; }
  }
  return ch;
}

// buchi chiusi: riempiti, tranne quelli grandi (≥ keepHole pixel), che restano vuoti nella mesh
function fillHoles(m, W, H, keepHole = Infinity) {
  const out = new Uint8Array(W * H), q = [0]; out[0] = 1;
  for (let k = 0; k < q.length; k++) { const i = q[k], x = i % W, y = (i / W) | 0; for (const [dx, dy] of N4) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const j = ny * W + nx; if (!m[j] && !out[j]) { out[j] = 1; q.push(j); } } }
  let ch = 0;
  for (let s = 0; s < W * H; s++) {
    if (m[s] || out[s]) continue;
    const st = [s], px = []; out[s] = 1;
    while (st.length) { const i = st.pop(); px.push(i); const x = i % W, y = (i / W) | 0; for (const [dx, dy] of N4) { const j = (y + dy) * W + x + dx; if (!m[j] && !out[j]) { out[j] = 1; st.push(j); } } }
    if (px.length < keepHole) { for (const i of px) m[i] = 1; ch += px.length; }
  }
  return ch;
}

/** Contorno sugli spigoli dei pixel (senso orario con y verso il basso), coordinate senza il bordo di 1 px. */
export function traceContour({ m, W, H }) {
  const next = new Map(), key = (x, y) => y * (W + 1) + x;
  let start = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!m[y * W + x]) continue;
    if (start < 0) start = key(x, y);
    if (!m[(y - 1) * W + x]) next.set(key(x, y), key(x + 1, y));
    if (!m[y * W + x + 1]) next.set(key(x + 1, y), key(x + 1, y + 1));
    if (!m[(y + 1) * W + x]) next.set(key(x + 1, y + 1), key(x, y + 1));
    if (!m[y * W + x - 1]) next.set(key(x, y + 1), key(x, y));
  }
  const pts = [];
  let k = start, guard = 0;
  do { pts.push([(k % (W + 1)) - 1, Math.floor(k / (W + 1)) - 1]); k = next.get(k); } while (k !== undefined && k !== start && ++guard < 4 * W * H);
  if (k !== start) return null;
  // solo gli angoli
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[(i + pts.length - 1) % pts.length], c = pts[i], n = pts[(i + 1) % pts.length];
    if ((c[0] - p[0]) * (n[1] - c[1]) - (c[1] - p[1]) * (n[0] - c[0]) !== 0) out.push(c);
  }
  return out;
}

const segDist = (p, a, b) => {
  const vx = b[0] - a[0], vy = b[1] - a[1], l2 = vx * vx + vy * vy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / l2)) : 0;
  return Math.hypot(p[0] - a[0] - vx * t, p[1] - a[1] - vy * t);
};

function dp(pts, eps) {
  // poligono chiuso: si parte dai due punti più lontani
  let i0 = 0, i1 = 0, dm = -1;
  for (let i = 0; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]); if (d > dm) { dm = d; i1 = i; } }
  const keep = new Uint8Array(pts.length); keep[i0] = keep[i1] = 1;
  const rec = (a, b) => {
    const n = pts.length, len = (b - a + n) % n; if (len < 2) return;
    let best = -1, bd = -1;
    for (let k = 1; k < len; k++) { const i = (a + k) % n, d = segDist(pts[i], pts[a], pts[b]); if (d > bd) { bd = d; best = i; } }
    if (bd > eps) { keep[best] = 1; rec(a, best); rec(best, b); }
  };
  rec(i0, i1); rec(i1, i0);
  return pts.filter((_, i) => keep[i]);
}

const orient = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function segCross(a, b, c, d) {
  const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
  return ((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0));
}
function isSimple(P) {
  const n = P.length;
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    if (i === 0 && j === n - 1) continue;
    if (segCross(P[i], P[(i + 1) % n], P[j], P[(j + 1) % n])) return false;
  }
  // punti ripetuti
  const s = new Set(P.map((p) => p[0] + "," + p[1]));
  return s.size === n;
}
const polyArea2 = (P) => { let a = 0; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; a += p[0] * q[1] - q[0] * p[1]; } return a; };
function inside(P, x, y) {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [xi, yi] = P[i], [xj, yj] = P[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
const distPoly = (P, p) => { let d = Infinity; for (let i = 0; i < P.length; i++) d = Math.min(d, segDist(p, P[i], P[(i + 1) % P.length])); return d; };

// Delaunay (Bowyer-Watson): triangoli come terne di indici
function delaunay(pts) {
  let mx = 0; for (const p of pts) mx = Math.max(mx, Math.abs(p[0]), Math.abs(p[1]));
  const S = 20 * (mx + 10), P = pts.concat([[-S, -S], [3 * S, -S], [-S, 3 * S]]), n = pts.length;
  let tris = [[n, n + 1, n + 2]];
  const circ = (t) => {
    const [a, b, c] = t.map((i) => P[i]);
    const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
    const a2 = a[0] ** 2 + a[1] ** 2, b2 = b[0] ** 2 + b[1] ** 2, c2 = c[0] ** 2 + c[1] ** 2;
    const ux = (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d, uy = (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d;
    return [ux, uy, (a[0] - ux) ** 2 + (a[1] - uy) ** 2];
  };
  let cc = tris.map(circ);
  for (let k = 0; k < n; k++) {
    const p = P[k], bad = [], keepT = [], keepC = [];
    for (let t = 0; t < tris.length; t++) { const [ux, uy, r2] = cc[t]; if ((p[0] - ux) ** 2 + (p[1] - uy) ** 2 < r2 * (1 - 1e-12)) bad.push(tris[t]); else { keepT.push(tris[t]); keepC.push(cc[t]); } }
    const edges = new Map();
    for (const t of bad) for (let e = 0; e < 3; e++) {
      const a = t[e], b = t[(e + 1) % 3], kk = a < b ? a + "," + b : b + "," + a;
      if (edges.has(kk)) edges.set(kk, null); else edges.set(kk, [a, b]);
    }
    tris = keepT; cc = keepC;
    for (const e of edges.values()) if (e) { const t = [e[0], e[1], k]; tris.push(t); cc.push(circ(t)); }
  }
  return tris.filter((t) => t[0] < n && t[1] < n && t[2] < n);
}

// BUCHI GRANDI (il vuoto dentro il cerchio della Domatrice): restano fuori dalla mesh. Il buco si stringe di 2 px
// (copertura garantita anche dopo la semplificazione), strozzature tolte, ogni parte rimasta è un anello di lati.
function bigHoles(sm, minArea) {
  const { m, W, H } = sm, out = new Uint8Array(W * H), q = [0]; out[0] = 1;
  for (let k = 0; k < q.length; k++) { const i = q[k], x = i % W, y = (i / W) | 0; for (const [dx, dy] of N4) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const j = ny * W + nx; if (!m[j] && !out[j]) { out[j] = 1; q.push(j); } } }
  const hole = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) if (!m[i] && !out[i]) hole[i] = 1;
  const rings = [];
  const seen = new Uint8Array(W * H);
  for (let s0 = 0; s0 < W * H; s0++) {
    if (!hole[s0] || seen[s0]) continue;
    const st = [s0], px = []; seen[s0] = 1;
    while (st.length) { const i = st.pop(); px.push(i); const x = i % W, y = (i / W) | 0; for (const [dx, dy] of N4) { const j = (y + dy) * W + x + dx; if (hole[j] && !seen[j]) { seen[j] = 1; st.push(j); } } }
    if (px.length < minArea) continue;
    // stretto di 2 px
    let hm = new Uint8Array(W * H); for (const i of px) hm[i] = 1;
    for (let k = 0; k < 2; k++) { const src = hm.slice(); for (const i of px) { if (!src[i]) continue; const x = i % W, y = (i / W) | 0; let ok = 1; for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = -1; dx <= 1; dx++) if (!src[(y + dy) * W + x + dx]) { ok = 0; break; } hm[i] = ok; } }
    for (let it = 0; it < 4; it++) {
      let ch = 0;
      for (let y = 0; y < H - 1; y++) for (let x = 0; x < W - 1; x++) {
        const a = hm[y * W + x], b = hm[y * W + x + 1], c = hm[(y + 1) * W + x], d = hm[(y + 1) * W + x + 1];
        if (a && d && !b && !c) { hm[y * W + x] = 0; ch++; } else if (b && c && !a && !d) { hm[y * W + x + 1] = 0; ch++; }
      }
      if (!ch) break;
    }
    // ogni parte rimasta (abbastanza grande) separata
    const sn = new Uint8Array(W * H);
    for (const s1 of px) {
      if (!hm[s1] || sn[s1]) continue;
      const st2 = [s1], part = []; sn[s1] = 1;
      while (st2.length) { const i = st2.pop(); part.push(i); const x = i % W, y = (i / W) | 0; for (const [dx, dy] of N4) { const j = (y + dy) * W + x + dx; if (hm[j] && !sn[j]) { sn[j] = 1; st2.push(j); } } }
      if (part.length < minArea / 2) continue;
      const pm = new Uint8Array(W * H); for (const i of part) pm[i] = 1;
      // buchi dentro il buco (isole del personaggio dentro il vuoto): riempiti nel buco = coperti dalla mesh? no:
      // un'isola dentro il buco non sarebbe coperta, quindi il buco si chiude solo sul suo contorno esterno e
      // le isole interne restano escluse; per sicurezza un buco con isole dentro non si apre
      const ring = traceContour({ m: pm, W, H });
      if (!ring || ring.length < 3) continue;
      let island = false;
      { const fillT = new Uint8Array(W * H), qq = [0]; fillT[0] = 1; for (let k = 0; k < qq.length; k++) { const i = qq[k], x = i % W, y = (i / W) | 0; for (const [dx, dy] of N4) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const j = ny * W + nx; if (!pm[j] && !fillT[j]) { fillT[j] = 1; qq.push(j); } } } for (let i = 0; i < W * H; i++) if (!pm[i] && !fillT[i]) { island = true; break; } }
      if (!island) rings.push(ring);
    }
  }
  return rings;
}

const ringsSimple = (R) => {
  const segs = [];
  for (const P of R) for (let i = 0; i < P.length; i++) segs.push([P[i], P[(i + 1) % P.length]]);
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) if (segCross(segs[i][0], segs[i][1], segs[j][0], segs[j][1])) return false;
  const s = new Set(R.flat().map((p) => p[0] + "," + p[1]));
  return s.size === R.reduce((a, P) => a + P.length, 0);
};

/**
 * Mesh sulla sagoma.
 * @param {Uint8Array|Uint8ClampedArray} alpha  un valore per pixel (≠0 = visibile), w×h
 * @param {number} step  distanza fra i vertici interni (px)
 * @param {(x:number,y:number)=>number} stepAt  facoltativo: passo locale (zone più fitte), coordinate del riquadro
 * @returns {{ points: number[][], hull: number, triangles: number[], holes: number } | null}
 *   points: prima il contorno (hull), poi i contorni dei buchi, poi i punti interni
 */
export function silhouetteMesh(alpha, w, h, step, stepAt = null) {
  const sm = silhouetteMask(alpha, w, h, 2, 2 * step * step);
  if (!sm) return null;
  const holeRings = bigHoles(sm, 2 * step * step);
  const filled = { ...sm, m: sm.m.slice() };
  fillHoles(filled.m, sm.W, sm.H);
  const corners = traceContour(filled);
  if (!corners || corners.length < 3) return null;
  const simplify = (c) => { for (const eps of [1.5, 1, 0.6]) { const s = dp(c, eps); if (s.length >= 3 && isSimple(s)) return s; } return c; };
  const loc = (x, y) => (stepAt ? Math.min(step, stepAt(x, y)) : step);
  // lati non più lunghi di un passo locale (punti interi)
  const densify = (P) => {
    const B = [];
    for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.max(1, Math.ceil(L / loc((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)));
      B.push(a);
      for (let k = 1; k < n; k++) {
        const q = [Math.round(a[0] + ((b[0] - a[0]) * k) / n), Math.round(a[1] + ((b[1] - a[1]) * k) / n)];
        const l = B[B.length - 1]; if ((q[0] !== l[0] || q[1] !== l[1]) && (q[0] !== b[0] || q[1] !== b[1])) B.push(q);
      }
    }
    return B;
  };
  const outer = densify(simplify(corners));
  if (!isSimple(outer)) return null;
  let R = [outer, ...holeRings.map((r) => densify(simplify(r))).filter((r) => r.length >= 3 && isSimple(r) && r.every((p) => inside(outer, p[0] + 0.01, p[1] + 0.013)))];
  if (!ringsSimple(R)) R = [outer];
  const inMesh = (x, y) => inside(R[0], x, y) && !R.slice(1).some((P) => inside(P, x, y));
  // vertici interni: griglia sfalsata al passo base, poi infittita nelle zone a passo minore
  const I = [], taken = new Set(R.flat().map((p) => p[0] + "," + p[1]));
  const tryAdd = (x, y) => {
    const p = [Math.round(x), Math.round(y)], s = loc(p[0], p[1]);
    if (p[0] <= 0 || p[1] <= 0 || p[0] >= w || p[1] >= h || taken.has(p[0] + "," + p[1])) return;
    if (!inMesh(p[0], p[1]) || R.some((P) => distPoly(P, p) < 0.5 * s)) return;
    for (const q of I) if (Math.abs(q[0] - p[0]) < 0.85 * s && Math.abs(q[1] - p[1]) < 0.85 * s && Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.85 * s) return;
    I.push(p); taken.add(p[0] + "," + p[1]);
  };
  for (const s of stepAt ? [step, step * 0.75, step * 0.55, step * 0.4] : [step]) {
    const dy = s * 0.866;
    for (let r = 0, y = dy / 2; y < h; y += dy, r++) for (let x = (r % 2 ? s / 2 : 0) + s / 4; x < w; x += s) if (loc(x, y) <= s * 1.01) tryAdd(x, y);
  }
  // triangolazione che rispetta contorno e buchi (lati mancanti divisi a metà)
  for (let it = 0; it < 40; it++) {
    const ringPts = R.flat(), pts = ringPts.concat(I), tris = delaunay(pts);
    const has = new Set();
    for (const t of tris) for (let e = 0; e < 3; e++) { const a = t[e], b = t[(e + 1) % 3]; has.add(a < b ? a + "," + b : b + "," + a); }
    const miss = []; // [anello, indice]
    let off = 0;
    for (let r = 0; r < R.length; r++) {
      const n = R[r].length;
      for (let i = 0; i < n; i++) { const a = off + i, b = off + ((i + 1) % n); if (!has.has(a < b ? a + "," + b : b + "," + a)) miss.push([r, i]); }
      off += n;
    }
    if (!miss.length) {
      const inT = tris.filter((t) => { const [a, b, c] = t.map((i) => pts[i]); return inMesh((a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3); });
      // controllo: area totale dei triangoli = area del contorno meno quella dei buchi
      let tot = 0;
      for (const t of inT) { const [a, b, c] = t.map((i) => pts[i]); let o = orient(a, b, c); if (o < 0) { [t[1], t[2]] = [t[2], t[1]]; o = -o; } if (o === 0) return null; tot += o; }
      const area = Math.abs(polyArea2(R[0])) - R.slice(1).reduce((a, P) => a + Math.abs(polyArea2(P)), 0);
      if (Math.abs(tot - area) > 1e-6 * area + 1e-6) return null;
      // lati dei contorni (per l'editor di Spine: "edges", indici × 2) — il buco resta un buco se si modifica la mesh
      const edges = []; let o0 = 0;
      for (const P of R) { for (let i = 0; i < P.length; i++) edges.push(2 * (o0 + i), 2 * (o0 + ((i + 1) % P.length))); o0 += P.length; }
      return { points: pts, hull: R[0].length, holes: R.length - 1, triangles: inT.flat(), edges };
    }
    let added = 0;
    for (const [r, i] of miss.reverse()) {
      const B = R[r], a = B[i], b = B[(i + 1) % B.length], q = [Math.round((a[0] + b[0]) / 2), Math.round((a[1] + b[1]) / 2)];
      if ((q[0] === a[0] && q[1] === a[1]) || (q[0] === b[0] && q[1] === b[1]) || taken.has(q[0] + "," + q[1])) continue;
      B.splice(i + 1, 0, q); taken.add(q[0] + "," + q[1]); added++;
    }
    // punti interni troppo vicini a un lato che non compare: tolti
    if (!added) {
      const before = I.length;
      for (const [r, i] of miss) { const B = R[r], a = B[i], b = B[(i + 1) % B.length]; for (let k = I.length - 1; k >= 0; k--) if (segDist(I[k], a, b) < Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.75) I.splice(k, 1); }
      if (I.length === before) return null;
    }
    if (!ringsSimple(R)) return null;
  }
  return null;
}
