// OCCHI SOCCHIUSI (zeus-mesh-14.5, Avventuriero 11 ott): se il buco trovato è minuscolo rispetto alla distanza fra
// gli occhi (solo l'angolo bianco di un occhio socchiuso) niente battito: la palpebra si stirava in righe scure.
// Soglia: superficie del buco < 0,01 × distanza² o larghezza < 0,15 × distanza. I casi di riferimento stanno sopra
// (minimo 0,0165 e 0,24), l'Avventuriero sotto (~0,005).
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

test("S1 buco degli occhi sotto la soglia: niente buco/bianco/pupilla; senza battito per socchiusi nessun pezzo occhio", () => {
  const { images, report } = buildMeshRig(input, { ...MESH_RIG_RULES, eyeMinArea: 0.5, squintBlink: false });
  assert.ok(report.decision.some((d) => /troppo socchiusi/.test(d)), report.decision.join(" | "));
  assert.ok(!Object.keys(images).some((n) => /^(palpebra|bianco|pupilla)_/.test(n)), Object.keys(images).join(","));
});

test("S3 occhi socchiusi (15.4): palpebra disegnata sulla fessura, invisibile a riposo, compare nel battito", () => {
  const { images, report, json } = buildMeshRig(input, { ...MESH_RIG_RULES, eyeMinArea: 0.5 });
  assert.ok(report.decision.some((d) => /battito con palpebra disegnata/.test(d)), report.decision.join(" | "));
  assert.ok(!Object.keys(images).some((n) => /^(bianco|pupilla)_/.test(n)));
  for (const sd of ["sx", "dx"]) {
    const im = images[`palpebra_${sd}`]; assert.ok(im, `palpebra_${sd}`);
    const sl = json.slots.find((s) => s.name === `palpebra_${sd}`); assert.equal(sl.color, "ffffff00");
    const k = json.animations.ambient.slots[`palpebra_${sd}`].rgba; assert.ok(k.some((x) => x.color === "ffffffff"));
    const ipd = Math.hypot(landmarks[2].x - landmarks[5].x, landmarks[2].y - landmarks[5].y);
    assert.ok(im.width < 0.75 * ipd && im.height < 0.35 * ipd, `palpebra ${im.width}×${im.height} (distanza occhi ${ipd.toFixed(0)})`);
  }
});

test("S2 con la soglia normale gli occhi di Jessica restano animati", () => {
  const { report } = buildMeshRig(input);
  assert.ok(report.decision.some((d) => /^occhi: buco \+ bianco/.test(d)), report.decision.join(" | "));
});

// Viso REALE dell'Avventuriero (pacchetto del 12 ott, ritaglio 230×180 da x 330, y 120). Fabio: "calcolare da A a B
// l'inclinazione per definire gli occhi": l'occhio sinistro (nell'immagine) scende verso l'angolo interno (~17°).
test("S4 Avventuriero: angoli A e B sulla rima, inclinazione dell'occhio, palpebra che copre il bianco", async () => {
  const { findSlit } = await import("../src/lib/meshRig.js");
  const p = PNG.sync.read(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/pieces/avventuriero_viso.png")));
  const Wf = p.width, Hf = p.height, fgf = new Uint8Array(Wf * Hf); for (let i = 0; i < Wf * Hf; i++) fgf[i] = p.data[i * 4 + 3] >= 128 ? 1 : 0;
  const sx = findSlit({ x: 416 - 330, y: 185 - 120 }, 71, Wf, Hf, p.data, fgf), dx = findSlit({ x: 485 - 330, y: 201 - 120 }, 71, Wf, Hf, p.data, fgf);
  assert.ok(sx && dx, "fessure trovate");
  assert.ok(sx.tilt >= 10 && sx.tilt <= 25, `inclinazione occhio sinistro ${sx.tilt}°`);
  assert.ok(dx.tilt >= 0 && dx.tilt <= 15, `inclinazione occhio destro ${dx.tilt}°`);
  for (const l of [sx, dx]) { const L = Math.hypot(l.B[0] - l.A[0], l.B[1] - l.A[1]); assert.ok(L > 0.35 * 71 && L < 0.65 * 71, `A→B ${JSON.stringify([l.A, l.B])}`); }
});
