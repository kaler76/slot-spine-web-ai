// MESH SULLA SAGOMA (R16 di docs/REGOLE_MESH.md, zeus-mesh-13). 9 ott: nella vista mesh di Spine la mesh di Zeus era
// una griglia regolare su tutto il riquadro, con vertici anche sullo sfondo trasparente ("dobbiamo metterla bene").
// Ora il contorno segue la sagoma, i vertici stanno solo dentro, i buchi grandi (cerchio della Domatrice) restano vuoti.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { recognizeParts } from "../src/lib/partRecognition.js";
import { buildMeshRig, MESH_RIG_RULES } from "../src/lib/meshRig.js";
import { silhouetteMesh } from "../src/lib/silhouetteMesh.js";

const D = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/recognition/domatrice");
const img = PNG.sync.read(fs.readFileSync(path.join(D, "image.png"))), W = img.width, H = img.height, rgba = img.data;
const cat = PNG.sync.read(fs.readFileSync(path.join(D, "categories.png")));
const categories = new Uint8Array(W * H), alpha = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) { categories[i] = cat.data[i * 4]; alpha[i] = rgba[i * 4 + 3]; }
const landmarks = JSON.parse(fs.readFileSync(path.join(D, "landmarks.json"), "utf8")).landmarks.map(([x, y, v]) => ({ x, y, visibility: v }));
const rec = recognizeParts({ width: W, height: H, landmarks, categories, alpha, rgba });
const fg = Uint8Array.from(alpha, (a) => (a >= 128 ? 1 : 0));
const input = { width: W, height: H, rgba, fg, parts: rec.parts, categories, landmarks, joints: rec.joints };
const { json, images } = buildMeshRig(input);
const meshes = Object.entries(json.skins[0].attachments).flatMap(([, a]) => Object.entries(a)).filter(([n, a]) => a.type === "mesh" && !n.startsWith("palpebra"));

// pixel visibili del pezzo coperti dalla mesh? distanza di un punto UV dal pixel visibile più vicino?
function check(name, a) {
  const im = images[name], w = im.width, h = im.height, U = a.uvs, T = a.triangles;
  const P = (i) => [U[2 * i] * w, U[2 * i + 1] * h];
  const cover = new Uint8Array(w * h);
  for (let t = 0; t < T.length; t += 3) {
    const [p, q, r] = [T[t], T[t + 1], T[t + 2]].map(P), d = (q[1] - r[1]) * (p[0] - r[0]) + (r[0] - q[0]) * (p[1] - r[1]);
    for (let y = Math.floor(Math.min(p[1], q[1], r[1])); y <= Math.ceil(Math.max(p[1], q[1], r[1])); y++) for (let x = Math.floor(Math.min(p[0], q[0], r[0])); x <= Math.ceil(Math.max(p[0], q[0], r[0])); x++) {
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const X = x + 0.5, Y = y + 0.5, u = ((q[1] - r[1]) * (X - r[0]) + (r[0] - q[0]) * (Y - r[1])) / d, v = ((r[1] - p[1]) * (X - r[0]) + (p[0] - r[0]) * (Y - r[1])) / d;
      if (u >= -1e-9 && v >= -1e-9 && 1 - u - v >= -1e-9) cover[y * w + x] = 1;
    }
  }
  let lost = 0, vis = 0, cov = 0;
  for (let i = 0; i < w * h; i++) { if (im.rgba[i * 4 + 3]) { vis++; if (!cover[i]) lost++; } if (cover[i]) cov++; }
  return { lost, vis, cov, area: w * h, P, w, h };
}

test("H1 contorno sulla sagoma: nessun pixel visibile scoperto, mesh molto più piccola del riquadro", () => {
  for (const [name, a] of meshes) {
    const c = check(name, a);
    assert.ok(c.lost <= 0.0005 * c.vis, `${name}: ${c.lost} pixel visibili fuori dalla mesh su ${c.vis}`);
    assert.ok(c.cov < 0.8 * c.area, `${name}: la mesh copre ${Math.round((100 * c.cov) / c.area)}% del riquadro (griglia?)`);
    assert.ok(Array.isArray(a.edges) && a.edges.length >= 2 * a.hull, `${name}: lati del contorno per l'editor`);
  }
});

test("H2 vertici del contorno vicini alla sagoma (≤ 4 px da un pixel visibile), mai sullo sfondo lontano", () => {
  for (const [name, a] of meshes) {
    const im = images[name], { P, w, h } = check(name, a);
    for (let i = 0; i < a.hull; i++) {
      const [x, y] = P(i); let ok = false;
      for (let dy = -5; dy <= 4 && !ok; dy++) for (let dx = -5; dx <= 4; dx++) { const X = Math.round(x) + dx, Y = Math.round(y) + dy; if (X >= 0 && Y >= 0 && X < w && Y < h && im.rgba[(Y * w + X) * 4 + 3]) { ok = true; break; } }
      assert.ok(ok, `${name}: vertice del contorno ${i} (${x}, ${y}) lontano dalla sagoma`);
    }
  }
});

test("H3 buco grande vuoto: il centro del cerchio della Domatrice non è nella mesh del braccio", () => {
  const [name, a] = meshes.find(([n]) => n.startsWith("braccio_"));
  const c = check(name, a), im = images[name];
  // centro del cerchio: pixel trasparente più lontano dai pixel visibili, dentro il pezzo
  let best = -1, bx = 0, by = 0;
  for (let y = 0; y < c.h; y += 4) for (let x = 0; x < c.w; x += 4) {
    if (im.rgba[(y * c.w + x) * 4 + 3]) continue;
    let d = 0; while (d < 400) { d += 4; let hit = false; for (const [dx, dy] of [[d, 0], [-d, 0], [0, d], [0, -d]]) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= c.w || Y >= c.h) { hit = "fuori"; break; } if (im.rgba[(Y * c.w + X) * 4 + 3]) hit = true; } if (hit) { if (hit === "fuori") d = -1; break; } }
    if (d > best) { best = d; bx = x; by = y; }
  }
  assert.ok(best > 100, `vuoto del cerchio trovato (raggio ${best})`);
  const U = a.uvs, T = a.triangles, P = (i) => [U[2 * i] * c.w, U[2 * i + 1] * c.h];
  for (let t = 0; t < T.length; t += 3) {
    const [p, q, r] = [T[t], T[t + 1], T[t + 2]].map(P), d = (q[1] - r[1]) * (p[0] - r[0]) + (r[0] - q[0]) * (p[1] - r[1]);
    const u = ((q[1] - r[1]) * (bx - r[0]) + (r[0] - q[0]) * (by - r[1])) / d, v = ((r[1] - p[1]) * (bx - r[0]) + (p[0] - r[0]) * (by - r[1])) / d;
    assert.ok(!(u > 0 && v > 0 && 1 - u - v > 0), "il centro del cerchio è coperto da un triangolo");
  }
});

test("H4 più fitta nelle zone indicate (articolazioni, viso), parti staccate unite in UN contorno", () => {
  // anello pieno con un puntino isolato e una seconda parte staccata
  const w = 200, h = 120, al = new Uint8Array(w * h);
  for (let y = 10; y < 110; y++) for (let x = 10; x < 90; x++) al[y * w + x] = 255;
  for (let y = 30; y < 90; y++) for (let x = 130; x < 190; x++) al[y * w + x] = 255;
  al[5 * w + 150] = 255; // puntino: fuori dalla mesh
  const m = silhouetteMesh(al, w, h, 12, (x) => (x < 50 ? 5 : 12));
  assert.ok(m && m.holes === 0);
  const n = (f) => m.points.slice(m.hull).filter(([x]) => f(x)).length;
  assert.ok(n((x) => x < 50) > 2 * n((x) => x >= 50 && x < 90), "più vertici dove il passo è minore");
  assert.ok(!m.points.some(([x, y]) => y < 8 && Math.abs(x - 150) < 4), "niente corridoio fino al puntino");
});

test("H5 regola spenta (meshShape: \"griglia\"): la griglia di prima, stesso riposo", () => {
  const g = buildMeshRig(input, { ...MESH_RIG_RULES, meshShape: "griglia" });
  const a = g.json.skins[0].attachments.corpo.corpo;
  assert.ok(!a.edges && a.hull >= 4);
});

// PESI MORBIDI (R17, 9 ott: "gestisci i pesi in maniera ottimale", vista Weights di Spine a gradini)
function weightJumps(json) {
  const a = json.skins[0].attachments.corpo.corpo, n = a.uvs.length / 2, Wv = [];
  for (let i = 0, k = 0; i < n; i++) { const c = a.vertices[k++], w = {}; let s = 0; for (let j = 0; j < c; j++) { const b = a.vertices[k++]; k += 2; w[b] = a.vertices[k++]; s += w[b]; } assert.ok(Math.abs(s - 1) < 1e-6 && c <= 4, `vertice ${i}: ${c} ossa, somma ${s}`); Wv.push(w); }
  const jumps = [];
  for (let t = 0; t < a.triangles.length; t += 3) for (let e = 0; e < 3; e++) {
    const p = Wv[a.triangles[t + e]], q = Wv[a.triangles[t + ((e + 1) % 3)]];
    let d = 0; for (const b of new Set([...Object.keys(p), ...Object.keys(q)])) d = Math.max(d, Math.abs((p[b] || 0) - (q[b] || 0)));
    jumps.push(d);
  }
  jumps.sort((x, y) => x - y);
  return { p99: jumps[Math.floor(0.99 * jumps.length)], big: jumps.filter((d) => d > 0.6).length };
}
test("W1 pesi morbidi: fra vertici vicini niente salti netti; ≤ 4 ossa per vertice, somma 1", () => {
  const off = weightJumps(buildMeshRig(input, { ...MESH_RIG_RULES, weightSmooth: 0 }).json), on = weightJumps(json);
  assert.ok(on.big < off.big / 3, `salti > 0,6: ${on.big} (prima ${off.big})`);
  assert.ok(on.p99 < off.p99, `99° percentile ${on.p99} contro ${off.p99}`);
});
