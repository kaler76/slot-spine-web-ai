// SORRISO RIDISEGNATO con Gemini (R10 di docs/REGOLE_MESH.md, zeus-mesh-9). Gemini non gira nei test: la sua
// risposta è simulata (ritaglio spostato, ingrandito, con colori diversi e una bocca diversa) per verificare
// riallineamento, adattamento dei colori, bordo sfumato e pezzo nel pacchetto.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { recognizeParts, foregroundFromUniformBorder } from "../src/lib/partRecognition.js";
import { buildMeshRig, findMouth, MESH_RIG_RULES } from "../src/lib/meshRig.js";
import { mouthCropBox, cropRgba, smilePatchFromGemini, SMILE_PROMPTS, isGeminiRefusal } from "../src/lib/mouthGemini.js";
import { renderFrame } from "../scripts/renderSpine.mjs";

const D = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/recognition/avvocato");
const img = PNG.sync.read(fs.readFileSync(path.join(D, "image.png"))), W = img.width, H = img.height, rgba = img.data;
const cat = PNG.sync.read(fs.readFileSync(path.join(D, "categories.png")));
const categories = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) categories[i] = cat.data[i * 4];
const landmarks = JSON.parse(fs.readFileSync(path.join(D, "landmarks.json"), "utf8")).landmarks.map(([x, y, v]) => ({ x, y, visibility: v }));
const fgA = foregroundFromUniformBorder({ width: W, height: H, rgba, categories });
const fg = Uint8Array.from(fgA, (a) => (a >= 128 ? 1 : 0));
const rec = recognizeParts({ width: W, height: H, landmarks, categories, alpha: fgA, rgba });
const ipd = Math.hypot(landmarks[2].x - landmarks[5].x, landmarks[2].y - landmarks[5].y);
const mouth = findMouth(landmarks, ipd, W, H, rgba, fg);
const box = mouthCropBox(mouth);
const orig = cropRgba(rgba, W, H, box);
const w = box.width, h = box.height;
// "Gemini": bocca ridipinta di verde puro, rosso +15 ovunque, poi spostata (+7, -4) e ingrandita 1,03
const SH = { dx: 7, dy: -4, s: 1.03 };
const mcx = mouth.center.x - box.x0, mcy = mouth.center.y - box.y0;
const painted = new Uint8ClampedArray(orig);
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  const i = (y * w + x) * 4;
  if (((x - mcx) / (0.45 * mouth.width)) ** 2 + ((y - mcy) / (0.2 * mouth.width)) ** 2 <= 1) painted.set([0, 255, 0, 255], i);
  else painted[i] = Math.min(255, painted[i] + 15);
}
const gen = new Uint8ClampedArray(w * h * 4);
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  const sx = Math.round((x - SH.dx - w / 2) / SH.s + w / 2), sy = Math.round((y - SH.dy - h / 2) / SH.s + h / 2);
  gen.set(sx < 0 || sy < 0 || sx >= w || sy >= h ? [30, 30, 30, 255] : painted.subarray((sy * w + sx) * 4, (sy * w + sx) * 4 + 4), (y * w + x) * 4);
}
const patch = smilePatchFromGemini({ orig, gen, box, mouth });

test("G1 prompt: si cambia SOLO la bocca, inquadratura identica", () => {
  for (const list of Object.values(SMILE_PROMPTS)) {
    assert.ok(list.length >= 3, "almeno 3 varianti (Gemini a volte rifiuta: IMAGE_OTHER)");
    for (const p of list) { assert.match(p, /ONLY the mouth/); assert.match(p, /same framing/); }
  }
});

test("G1b rifiuto di Gemini riconosciuto (si prova la variante successiva, poi la deformazione)", () => {
  assert.ok(isGeminiRefusal("Nessuna immagine nella risposta Gemini (finishReason: IMAGE_OTHER)."));
  assert.ok(!isGeminiRefusal("Errore HTTP 500"));
});

test("G2 riallineamento: ritrova spostamento e scala della risposta", () => {
  assert.ok(!patch.error);
  assert.ok(Math.abs(patch.shift.dx - SH.dx) <= 1 && Math.abs(patch.shift.dy - SH.dy) <= 1, JSON.stringify(patch.shift));
  assert.ok(Math.abs(patch.shift.s - SH.s) <= 0.011, JSON.stringify(patch.shift));
});

test("G3 pezzo: bocca nuova al centro, bordo sfumato a zero, colori riportati a quelli dell'originale", () => {
  const p = patch, at = (gx, gy) => { const i = ((Math.round(gy) - p.y0) * p.width + Math.round(gx) - p.x0) * 4; return Array.from(p.rgba.subarray(i, i + 4)); };
  const c = at(mouth.center.x, mouth.center.y);
  assert.ok(c[1] > 200 && c[0] < 60 && c[3] === 255, `centro ${c}`);
  for (let x = 0; x < p.width; x++) assert.ok(p.rgba[x * 4 + 3] < 40, "bordo alto quasi trasparente (sfumato)");
  // pelle sull'anello di mezzo: il +15 di rosso tolto
  const gx = mouth.center.x + 0.8 * 1.15 * mouth.width, gy = mouth.center.y, o = (Math.round(gy) * W + Math.round(gx)) * 4, q = at(gx, gy);
  assert.ok(q[3] > 0 && Math.abs(q[0] - rgba[o]) <= 8, `rosso ${q[0]} contro ${rgba[o]}`);
});

test("G4 nel pacchetto: invisibile nel setup, compare nel loop e sparisce; \"sempre\" lo tiene", () => {
  const { json, images, report } = buildMeshRig({ width: W, height: H, rgba, fg, parts: rec.parts, categories, landmarks, joints: rec.joints, smilePatch: patch }, { ...MESH_RIG_RULES, smile: "loop" });
  const slot = json.slots.find((s) => s.name === "bocca_sorriso");
  assert.ok(slot && slot.color === "ffffff00" && slot.bone === "viso");
  assert.ok(json.slots.indexOf(slot) > json.slots.findIndex((s) => s.name === "corpo"));
  assert.ok(report.decision.some((d) => /RIDISEGNATO/.test(d)));
  assert.ok(!json.bones.some((b) => b.name.startsWith("bocca_")), "niente deformazione insieme al pezzo");
  const green = (t) => { const f = renderFrame(json, images, "ambient", t, { scale: 1, bg: [0, 0, 0, 255] }); let n = 0; for (let i = 0; i < f.data.length; i += 4) if (f.data[i + 1] > 200 && f.data[i] < 60 && f.data[i + 2] < 60) n++; return n; };
  assert.ok(green(0) < 5, "a riposo la bocca è quella del disegno");
  assert.ok(green(4.2) > 40, "nel sorriso c'è la bocca nuova");
  assert.ok(green(5.9) < 5, "a fine loop è sparita");
  const fixed = buildMeshRig({ width: W, height: H, rgba, fg, parts: rec.parts, categories, landmarks, joints: rec.joints, smilePatch: patch }, { ...MESH_RIG_RULES, smile: "sempre" });
  assert.deepEqual(fixed.json.animations.ambient.slots.bocca_sorriso.rgba, [{ time: 0, color: "ffffffff" }]);
});
