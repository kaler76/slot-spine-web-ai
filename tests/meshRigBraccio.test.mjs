// BRACCIO ALZATO (zeus-mesh-13.7, Jessica 10 ott: "se c'è un braccio così dovrebbe essere tagliato BENE e animato
// indipendente"). Braccio alzato e staccato dal busto: pezzo dalla SPALLA, con fumo e bocchino, senza ciocche di
// capelli; dietro, i capelli continuano (niente buchi quando si muove).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { recognizeParts, SEG } from "../src/lib/partRecognition.js";
import { buildMeshRig, MESH_RIG_RULES } from "../src/lib/meshRig.js";
import { renderFrame } from "../scripts/renderSpine.mjs";

const D = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/recognition/jessica");
const img = PNG.sync.read(fs.readFileSync(path.join(D, "image.png"))), W = img.width, H = img.height, rgba = img.data;
const cat = PNG.sync.read(fs.readFileSync(path.join(D, "categories.png")));
const categories = new Uint8Array(W * H), alpha = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) { categories[i] = cat.data[i * 4]; alpha[i] = rgba[i * 4 + 3]; }
const landmarks = JSON.parse(fs.readFileSync(path.join(D, "landmarks.json"), "utf8")).landmarks.map(([x, y, v]) => ({ x, y, visibility: v }));
const rec = recognizeParts({ width: W, height: H, landmarks, categories, alpha, rgba });
const fg = Uint8Array.from(alpha, (a) => (a >= 128 ? 1 : 0));
const { json, images, report } = buildMeshRig({ width: W, height: H, rgba, fg, parts: rec.parts, categories, landmarks, joints: rec.joints });
let x0 = W, y0 = H; for (let i = 0; i < W * H; i++) if (fg[i]) { x0 = Math.min(x0, i % W); y0 = Math.min(y0, (i / W) | 0); }
x0 = Math.max(0, x0 - MESH_RIG_RULES.pad); y0 = Math.max(0, y0 - MESH_RIG_RULES.pad);

test("J1 braccio alzato tagliato dalla SPALLA, l'altro (lungo il vestito) resta in mesh", () => {
  assert.ok(report.decision.some((d) => /braccio_dx tagliato dalla SPALLA/.test(d)), report.decision.join(" | "));
  assert.ok(report.decision.some((d) => d === "braccio_sx: mesh"), report.decision.join(" | "));
});

test("J2 nel pezzo del braccio niente capelli (le ciocche restano al corpo) e c'è il fumo sopra il bocchino", () => {
  const im = images.braccio_dx;
  let hair = 0, n = 0, topOpaque = 0;
  // il pezzo è ritagliato sul riquadro del braccio: lo si confronta con le categorie rimettendolo nell'immagine
  let a = W, b = H; for (let i = 0; i < W * H; i++) if (false) a = 0; // (offset ricavato sotto)
  // offset: il pixel opaco più in alto a sinistra del pezzo coincide con un pixel opaco dell'originale
  const only = { ...json, slots: json.slots.filter((s) => s.name === "braccio_dx"), animations: { f: { bones: {} } } };
  const f = renderFrame(only, images, "f", 0, { scale: 1, bg: [255, 0, 255, 255] });
  for (let y = 0; y < f.height; y++) for (let x = 0; x < f.width; x++) {
    const i = (y * f.width + x) * 4; if (f.data[i] === 255 && f.data[i + 1] === 0 && f.data[i + 2] === 255) continue;
    n++; const g = (y + y0) * W + x + x0; if (categories[g] === SEG.hair) hair++;
    if (y + y0 < 120) topOpaque++;
  }
  assert.ok(n > 1000 && im.width > 0);
  assert.ok(hair < 0.03 * n, `${hair} pixel di capelli nel pezzo su ${n}`);
  assert.ok(topOpaque > 300, `fumo nel pezzo: ${topOpaque} pixel sopra y=120`);
});

test("J3 nel movimento niente buchi chiusi nel personaggio (dietro il braccio i capelli continuano)", () => {
  const KEY = [255, 0, 255, 255], inside = (f, i) => !(f.data[i] === 255 && f.data[i + 1] === 0 && f.data[i + 2] === 255);
  const rest = renderFrame(json, images, "ambient", 0, { scale: 0.5, bg: KEY });
  for (const t of [1.2, 2.6, 4.2]) {
    const f = renderFrame(json, images, "ambient", t, { scale: 0.5, bg: KEY });
    const w = f.width, h = f.height, out = new Uint8Array(w * h), q = [];
    for (let p = 0; p < w * h; p++) if (!inside(f, p * 4) && !inside(rest, p * 4)) { out[p] = 1; q.push(p); }
    for (let k = 0; k < q.length; k++) { const p = q[k], x = p % w, y = (p / w) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue; const j = Y * w + X; if (!out[j] && !inside(f, j * 4)) { out[j] = 1; q.push(j); } } }
    let holes = 0;
    // solo dalla parte del braccio alzato (metà sinistra dell'immagine): dall'altra parte oscillano i capelli dietro
    for (let p = 0; p < w * h; p++) if (p % w < 0.45 * w && !out[p] && !inside(f, p * 4) && inside(rest, p * 4)) holes++;
    assert.ok(holes < 60, `t=${t}: ${holes} pixel di buchi chiusi`);
  }
});

test("J4 fumo STACCATO dalla punta della sigaretta (bordo sfumato tolto dal fondo): va comunque col braccio", () => {
  const fg2 = fg.slice();
  for (let y = 126; y <= 142; y++) for (let x = 120; x < 210; x++) fg2[y * W + x] = 0; // stacco di 17 px fra fumo e punta
  const r = buildMeshRig({ width: W, height: H, rgba, fg: fg2, parts: rec.parts, categories, landmarks, joints: rec.joints });
  const sx0 = Math.max(0, x0), sy0 = Math.max(0, y0);
  let bx = W, by2 = H; for (let i = 0; i < W * H; i++) if (fg2[i]) { bx = Math.min(bx, i % W); by2 = Math.min(by2, (i / W) | 0); }
  const ox = Math.max(0, bx - MESH_RIG_RULES.pad), oy = Math.max(0, by2 - MESH_RIG_RULES.pad);
  const only = (names) => renderFrame({ ...r.json, slots: r.json.slots.filter((s) => names.includes(s.name)), animations: { f: { bones: {} } } }, r.images, "f", 0, { scale: 1, bg: [255, 0, 255, 255] });
  const arm = only(["braccio_dx"]), body = only(["corpo"]);
  let inArm = 0, inBody = 0;
  for (let y = 30; y < 110; y++) for (let x = 140; x < 200; x++) {
    const fx = x - ox, fy = y - oy; if (fx < 0 || fy < 0 || fx >= arm.width || fy >= arm.height) continue;
    const i = (fy * arm.width + fx) * 4;
    if (!(arm.data[i] === 255 && arm.data[i + 1] === 0 && arm.data[i + 2] === 255)) inArm++;
    if (!(body.data[i] === 255 && body.data[i + 1] === 0 && body.data[i + 2] === 255)) inBody++;
  }
  assert.ok(sx0 >= 0 && sy0 >= 0);
  assert.ok(inArm > 300 && inBody < 20, `fumo nel braccio ${inArm}, nel corpo ${inBody}`);
});
