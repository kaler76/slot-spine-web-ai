// METODO MESH sulla Domatrice (tests/fixtures/recognition/domatrice): braccio col cerchio che scende
// lungo il fianco. Difetti segnalati l'8 ott 2026 (zeus-mesh-5.1): il pezzo del braccio si portava
// via risvolto e bottoni della giacca (striscia grigia quando si muoveva) e un frammento del
// cerchio restava sospeso nel corpo. Regola R8 di docs/REGOLE_MESH.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { recognizeParts, PART } from "../src/lib/partRecognition.js";
import { buildMeshRig, MESH_RIG_RULES } from "../src/lib/meshRig.js";
import { renderFrame } from "../scripts/renderSpine.mjs";

const D = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/recognition/domatrice");
const img = PNG.sync.read(fs.readFileSync(path.join(D, "image.png"))), W = img.width, H = img.height, rgba = img.data;
const cat = PNG.sync.read(fs.readFileSync(path.join(D, "categories.png")));
const categories = new Uint8Array(W * H), alpha = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) { categories[i] = cat.data[i * 4]; alpha[i] = rgba[i * 4 + 3]; }
const landmarks = JSON.parse(fs.readFileSync(path.join(D, "landmarks.json"), "utf8")).landmarks.map(([x, y, v]) => ({ x, y, visibility: v }));
const rec = recognizeParts({ width: W, height: H, landmarks, categories, alpha, rgba });
const fg = Uint8Array.from(alpha, (a) => (a >= 128 ? 1 : 0));
const { json, images, report } = buildMeshRig({ width: W, height: H, rgba, fg, parts: rec.parts, categories, landmarks, joints: rec.joints });
let fx0 = W, fy0 = H; for (let i = 0; i < W * H; i++) if (fg[i]) { fx0 = Math.min(fx0, i % W); fy0 = Math.min(fy0, (i / W) | 0); }
const ox = Math.max(0, fx0 - MESH_RIG_RULES.pad), oy = Math.max(0, fy0 - MESH_RIG_RULES.pad);

test("D1 braccio col cerchio tagliato dal GOMITO (omero lungo il fianco)", () => {
  assert.ok(report.decision.some((r) => /braccio_sx: TAGLIO/.test(r)));
  assert.ok(report.decision.some((r) => /braccio_sx tagliato dal GOMITO/.test(r)), report.decision.join(" | "));
});

test("D2 la giacca resta nel corpo: nel pezzo del braccio niente pixel sul lato interno della spalla (risvolto, bottoni)", () => {
  const sh = landmarks[11], el = landmarks[13];
  // pixel opachi del pezzo sopra il gomito e a sinistra della spalla (lato del busto): risvolto e bottoni
  const sw = Math.hypot(landmarks[11].x - landmarks[12].x, landmarks[11].y - landmarks[12].y);
  const still = { ...json, animations: { fermo: { bones: {} } }, slots: json.slots.filter((s) => s.name === "braccio_sx") };
  const f = renderFrame(still, images, "fermo", 0, { scale: 1, bg: false });
  let n = 0;
  for (let y = 0; y < f.height; y++) for (let x = 0; x < f.width; x++) {
    const gx = x + ox, gy = y + oy, i = (y * f.width + x) * 4;
    if (f.data[i] + f.data[i + 1] + f.data[i + 2] === 0) continue;
    if (gy < el.y - 0.12 * sw && gx < sh.x + 0.05 * sw) n++;
  }
  assert.ok(n < 50, `pixel della giacca nel pezzo del braccio: ${n}`);
});

test("D3 a riposo identico all'originale (≤ 2%, quasi tutto negli occhi: bianco e pupilla generati; ≤ 0,2% altrove)", () => {
  const eyeC = { x: (landmarks[2].x + landmarks[5].x) / 2, y: (landmarks[2].y + landmarks[5].y) / 2 }, ipd = Math.hypot(landmarks[2].x - landmarks[5].x, landmarks[2].y - landmarks[5].y);
  let far = 0;
  const still = { ...json, animations: { fermo: { bones: {} } } };
  const f = renderFrame(still, images, "fermo", 0, { scale: 1, bg: false });
  let n = 0, diff = 0;
  for (let y = 0; y < f.height; y++) for (let x = 0; x < f.width; x++) {
    const g = (y + oy) * W + x + ox; if (!fg[g]) continue; n++;
    const i = (y * f.width + x) * 4;
    // il fotogramma è su nero: confronto col colore originale moltiplicato per la sua trasparenza
    const a = rgba[g * 4 + 3] / 255, d = (k) => Math.abs(f.data[i + k] - rgba[g * 4 + k] * a);
    if (d(0) + d(1) + d(2) > 30) { diff++; if (Math.hypot(x + ox - eyeC.x, y + oy - eyeC.y) > 1.2 * ipd) far++; }
  }
  assert.ok(far / n <= 0.002, `pixel diversi lontano dagli occhi ${((100 * far) / n).toFixed(2)}%`);
  assert.ok(diff / n <= 0.02, `pixel diversi ${((100 * diff) / n).toFixed(2)}%`);
});

test("D4 nessuna isola sospesa nel corpo: tutti i pixel opachi del corpo sono collegati", () => {
  const im = images.corpo, w = im.width, h = im.height, seen = new Uint8Array(w * h);
  let comps = [];
  for (let s = 0; s < w * h; s++) {
    if (seen[s] || im.rgba[s * 4 + 3] < 128) continue;
    let n = 0; const st = [s]; seen[s] = 1;
    while (st.length) { const i = st.pop(); n++; const x = i % w, y = (i / w) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue; const j = ny * w + nx; if (!seen[j] && im.rgba[j * 4 + 3] >= 128) { seen[j] = 1; st.push(j); } } }
    comps.push(n);
  }
  comps.sort((a, b) => b - a);
  assert.ok((comps[1] || 0) < 200, `seconda isola di ${comps[1]} px`);
});

test("D5 in movimento nessun buco nel personaggio: nessuna zona trasparente chiusa che a riposo era piena", () => {
  // fondo magenta: un pixel è trasparente se resta magenta puro (il nero del guanto non lo è)
  const KEY = [255, 0, 255, 255], inside = (f, i) => !(f.data[i] === 255 && f.data[i + 1] === 0 && f.data[i + 2] === 255);
  const rest = renderFrame(json, images, "ambient", 0, { scale: 0.5, bg: KEY });
  for (const t of [0.75, 1.5, 3, 4.5]) {
    const f = renderFrame(json, images, "ambient", t, { scale: 0.5, bg: KEY });
    const w = f.width, h = f.height, out = new Uint8Array(w * h), q = [];
    // fuori = trasparente collegato a uno sfondo STABILE (trasparente sia a riposo sia ora: anche
    // l'interno del cerchio); buco = trasparente ora, pieno a riposo e chiuso dentro il personaggio
    for (let p = 0; p < w * h; p++) if (!inside(f, p * 4) && !inside(rest, p * 4)) { out[p] = 1; q.push(p); }
    for (let k = 0; k < q.length; k++) { const p = q[k], x = p % w, y = (p / w) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue; const j = Y * w + X; if (!out[j] && !inside(f, j * 4)) { out[j] = 1; q.push(j); } } }
    let holes = 0;
    for (let p = 0; p < w * h; p++) if (!out[p] && !inside(f, p * 4) && inside(rest, p * 4)) holes++;
    assert.ok(holes < 30, `t=${t}: ${holes} pixel di buchi chiusi`);
  }
});
