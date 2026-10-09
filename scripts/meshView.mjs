// Vista mesh come in Spine: immagine a riposo su fondo scuro, lati dei triangoli e vertici in azzurro.
// Uso: node scripts/meshView.mjs <cartella del pacchetto> <nome.json> [uscita.png] [scala] [pesi]
// Con "pesi" come quinto argomento: colori delle ossa mescolati secondo i pesi (vista Weights di Spine).
// (il pacchetto è quello scritto da scripts/meshCase.mjs o scripts/zeusMesh.mjs, con images/)
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";

const DIR = process.argv[2], FILE = process.argv[3], OUT = process.argv[4] || path.join(DIR, "_mesh_view.png"), SC = Number(process.argv[5] || 0.5);
const json = JSON.parse(fs.readFileSync(path.join(DIR, FILE), "utf8"));
const bones = {};
for (const b of json.bones) {
  const p = b.parent ? bones[b.parent] : { x: 0, y: 0, a: 0 }, a = ((b.rotation || 0) * Math.PI) / 180;
  const bx = b.x || 0, by = b.y || 0;
  bones[b.name] = { x: p.x + bx * Math.cos(p.a) - by * Math.sin(p.a), y: p.y + bx * Math.sin(p.a) + by * Math.cos(p.a), a: p.a + a };
}
const names = json.bones.map((b) => b.name);
const WEIGHTS = process.argv[6] === "pesi";
const PAL = [[255, 60, 60], [60, 200, 255], [255, 200, 40], [150, 80, 255], [60, 230, 120], [255, 120, 220], [255, 140, 40], [40, 120, 255], [200, 255, 60], [0, 220, 200], [255, 255, 255], [180, 120, 60], [120, 255, 255], [255, 80, 140]];
const NAMED = { root: [255, 255, 255], anca: [40, 120, 255], schiena: [0, 220, 200], petto: [255, 200, 40], collo: [255, 140, 40], testa: [255, 60, 60], viso: [255, 120, 220],
  omero_sx: [60, 230, 120], avambraccio_sx: [200, 255, 60], mano_sx: [120, 255, 255], omero_dx: [60, 230, 120], avambraccio_dx: [200, 255, 60], mano_dx: [120, 255, 255],
  coscia_sx: [150, 80, 255], gamba_sx: [180, 120, 60], coscia_dx: [150, 80, 255], gamba_dx: [180, 120, 60], capelli_1: [255, 160, 160], capelli_2: [200, 100, 100] };
const colOf = (n) => NAMED[n] || PAL[names.indexOf(n) % PAL.length];
const atts = [];
for (const slot of json.slots) {
  const skin = json.skins[0].attachments[slot.name]; if (!skin || !slot.attachment) continue;
  const at = skin[slot.attachment]; if (!at || at.type !== "mesh") continue;
  const n = at.uvs.length / 2, pts = [];
  const cols = [];
  if (at.vertices.length > n * 2) {
    for (let i = 0, k = 0; i < n; i++) {
      const c = at.vertices[k++]; let x = 0, y = 0; const col = [0, 0, 0];
      for (let j = 0; j < c; j++) { const bi = at.vertices[k++], b = bones[names[bi]], vx = at.vertices[k++], vy = at.vertices[k++], w = at.vertices[k++]; x += (b.x + vx * Math.cos(b.a) - vy * Math.sin(b.a)) * w; y += (b.y + vx * Math.sin(b.a) + vy * Math.cos(b.a)) * w; for (let q = 0; q < 3; q++) col[q] += colOf(names[bi])[q] * w; }
      pts.push([x, y]); cols.push(col);
    }
  } else { const b = bones[slot.bone]; for (let i = 0; i < n; i++) { const vx = at.vertices[2 * i], vy = at.vertices[2 * i + 1]; pts.push([b.x + vx * Math.cos(b.a) - vy * Math.sin(b.a), b.y + vx * Math.sin(b.a) + vy * Math.cos(b.a)]); } }
  atts.push({ name: slot.attachment, at, pts, cols });
}
let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
for (const a of atts) for (const [x, y] of a.pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
const pad = 10, OW = Math.ceil((x1 - x0) * SC) + 2 * pad, OH = Math.ceil((y1 - y0) * SC) + 2 * pad;
const out = new PNG({ width: OW, height: OH });
for (let i = 0; i < OW * OH; i++) out.data.set([45, 45, 48, 255], i * 4);
const S = ([x, y]) => [(x - x0) * SC + pad, (y1 - y) * SC + pad];
const blend = (X, Y, c, al) => { X = Math.round(X); Y = Math.round(Y); if (X < 0 || Y < 0 || X >= OW || Y >= OH) return; const i = (Y * OW + X) * 4; for (let k = 0; k < 3; k++) out.data[i + k] = out.data[i + k] * (1 - al) + c[k] * al; };
// immagini (mappatura per triangolo, campione più vicino)
for (const a of atts) {
  const imPath = path.join(DIR, "images", a.name + ".png"); if (!fs.existsSync(imPath)) continue;
  const im = PNG.sync.read(fs.readFileSync(imPath)), T = a.at.triangles, uv = a.at.uvs;
  for (let t = 0; t < T.length; t += 3) {
    const [p, q, r] = [T[t], T[t + 1], T[t + 2]].map((i) => S(a.pts[i]));
    const d = (q[1] - r[1]) * (p[0] - r[0]) + (r[0] - q[0]) * (p[1] - r[1]); if (!d) continue;
    for (let Y = Math.floor(Math.min(p[1], q[1], r[1])); Y <= Math.ceil(Math.max(p[1], q[1], r[1])); Y++) for (let X = Math.floor(Math.min(p[0], q[0], r[0])); X <= Math.ceil(Math.max(p[0], q[0], r[0])); X++) {
      const u = ((q[1] - r[1]) * (X - r[0]) + (r[0] - q[0]) * (Y - r[1])) / d, v = ((r[1] - p[1]) * (X - r[0]) + (p[0] - r[0]) * (Y - r[1])) / d, w = 1 - u - v;
      if (u < 0 || v < 0 || w < 0) continue;
      const tu = u * uv[T[t] * 2] + v * uv[T[t + 1] * 2] + w * uv[T[t + 2] * 2], tv = u * uv[T[t] * 2 + 1] + v * uv[T[t + 1] * 2 + 1] + w * uv[T[t + 2] * 2 + 1];
      const sx = Math.min(im.width - 1, Math.floor(tu * im.width)), sy = Math.min(im.height - 1, Math.floor(tv * im.height)), si = (sy * im.width + sx) * 4;
      if (WEIGHTS && a.cols.length) { const C = [0, 1, 2].map((q) => u * a.cols[T[t]][q] + v * a.cols[T[t + 1]][q] + w * a.cols[T[t + 2]][q]); const g = (im.data[si] + im.data[si + 1] + im.data[si + 2]) / 765; blend(X, Y, C.map((c) => c * (0.55 + 0.45 * g)), 0.25 + 0.75 * (im.data[si + 3] / 255)); }
      else blend(X, Y, [im.data[si], im.data[si + 1], im.data[si + 2]], im.data[si + 3] / 255);
    }
  }
}
const line = (a, b, c, al) => { const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])) + 1; for (let k = 0; k <= n; k++) blend(a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n, c, al); };
for (const a of atts) {
  const T = a.at.triangles, P = a.pts.map(S);
  for (let t = 0; t < T.length; t += 3) for (let e = 0; e < 3; e++) line(P[T[t + e]], P[T[t + (e + 1) % 3]], [0, 200, 255], 0.45);
  for (let i = 0; i < a.at.hull; i++) line(P[i], P[(i + 1) % a.at.hull], [255, 160, 0], 0.95);
  for (const [X, Y] of P) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) blend(X + dx, Y + dy, [0, 230, 255], 1);
}
fs.writeFileSync(OUT, PNG.sync.write(out));
console.log(OUT, atts.map((a) => `${a.name}: ${a.at.uvs.length / 2} vertici, ${a.at.triangles.length / 3} triangoli, contorno ${a.at.hull}`).join("; "));
