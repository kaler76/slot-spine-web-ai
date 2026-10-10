// BRACCIO SEPARATO CON GEMINI nel rig (R22, zeus-mesh-14): con la maschera e la piastra date (qui finte, come le
// darebbe partGemini.js) il braccio alzato si taglia dalla maschera, i pixel del pezzo sono quelli dell'originale e
// nel corpo, dietro, c'è la piastra; senza piastra (o per un braccio non alzato) tutto come prima.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { recognizeParts } from "../src/lib/partRecognition.js";
import { buildMeshRig, MESH_RIG_RULES } from "../src/lib/meshRig.js";

const D = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/recognition/jessica");
const img = PNG.sync.read(fs.readFileSync(path.join(D, "image.png"))), W = img.width, H = img.height, rgba = img.data;
const cat = PNG.sync.read(fs.readFileSync(path.join(D, "categories.png")));
const categories = new Uint8Array(W * H), alpha = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) { categories[i] = cat.data[i * 4]; alpha[i] = rgba[i * 4 + 3]; }
const landmarks = JSON.parse(fs.readFileSync(path.join(D, "landmarks.json"), "utf8")).landmarks.map(([x, y, v]) => ({ x, y, visibility: v }));
const rec = recognizeParts({ width: W, height: H, landmarks, categories, alpha, rgba });
const fg = Uint8Array.from(alpha, (a) => (a >= 128 ? 1 : 0));
const input = { width: W, height: H, rgba, fg, parts: rec.parts, categories, landmarks, joints: rec.joints };
const first = buildMeshRig(input);

const segD = (x, y, a, b) => { const vx = b.x - a.x, vy = b.y - a.y, l2 = vx * vx + vy * vy || 1, t = Math.max(0, Math.min(1, ((x - a.x) * vx + (y - a.y) * vy) / l2)); return Math.hypot(x - a.x - vx * t, y - a.y - vy * t); };
function fakePatch(arm) {
  const mask = new Uint8Array(W * H), plate = new Uint8ClampedArray(W * H * 4), r = 0.15 * arm.shoulderW;
  let n = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; if (!fg[i]) continue;
    if (Math.min(segD(x, y, arm.sh, arm.el), segD(x, y, arm.el, arm.wr), segD(x, y, arm.wr, arm.hd)) > r) continue;
    mask[i] = 1; plate.set([10, 200, 10, 255], i * 4); n++;
  }
  return { mask, plate, n };
}

test("GR1 il primo passaggio riporta il braccio alzato (lato, punti, lato nell'immagine) per il ritaglio con Gemini", () => {
  const ra = first.report.raisedArms;
  assert.equal(ra.length, 1, JSON.stringify(ra));
  assert.equal(ra[0].side, "dx");
  assert.ok(["left", "right"].includes(ra[0].imageSide));
  assert.ok(ra[0].wr.y < ra[0].el.y && ra[0].shoulderW > 0);
});

test("GR2 con la maschera di Gemini: pezzo = maschera (pixel dell'originale), dietro la piastra, l'altro braccio fuori", () => {
  const arm = first.report.raisedArms[0], P = fakePatch(arm);
  const { images, report } = buildMeshRig({ ...input, partPatches: { dx: P } });
  assert.deepEqual(report.aiArms, ["dx"]);
  assert.ok(report.decision.some((d) => /GEMINI/.test(d)), report.decision.join(" | "));
  const im = images.braccio_dx; let op = 0, green = 0;
  for (let i = 0; i < im.width * im.height; i++) if (im.rgba[i * 4 + 3] > 0) { op++; if (im.rgba[i * 4] === 10 && im.rgba[i * 4 + 1] === 200) green++; }
  assert.equal(green, 0, "nel pezzo solo pixel dell'originale");
  // (+ isole staccate vicino alla mano: fumo e punta del bocchino fuori dalla maschera finta)
  assert.ok(op >= P.n && op <= 1.3 * P.n, `pezzo ${op} px, maschera ${P.n}`);
  const c = images.corpo; let plate = 0;
  for (let i = 0; i < c.width * c.height; i++) if (c.rgba[i * 4] === 10 && c.rgba[i * 4 + 1] === 200 && c.rgba[i * 4 + 2] === 10) plate++;
  assert.ok(plate >= 0.9 * P.n, `piastra nel corpo ${plate} di ${P.n}`);
  assert.ok(!images.braccio_sx, "il braccio lungo il vestito resta in mesh");
});

test("GR3 piastra per un braccio NON alzato: ignorata (stesso risultato di prima)", () => {
  const ra = first.report.raisedArms[0];
  const { report } = buildMeshRig({ ...input, partPatches: { sx: fakePatch({ ...ra, side: "sx" }) } });
  assert.deepEqual(report.aiArms, []);
  assert.deepEqual(report.decision, first.report.decision);
});
