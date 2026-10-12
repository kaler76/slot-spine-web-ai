// CONTROLLO AUTOMATICO DEI TAGLI (zeus-mesh-15.3, Avventuriero 12 ott: "dover scegliere io andando a tentativi non è
// opportuno"): un pezzo del braccio a schegge annulla da solo il taglio di quel braccio.
// Pezzi REALI dell'Avventuriero (pacchetti del 12 ott): braccio basso con la borsa presa per oggetto (schegge) e braccio
// alzato separato con Gemini (pulito).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { recognizeParts } from "../src/lib/partRecognition.js";
import { buildMeshRig, pieceFragments, MESH_RIG_RULES } from "../src/lib/meshRig.js";

const T = path.dirname(fileURLToPath(import.meta.url));
const png = (f) => { const p = PNG.sync.read(fs.readFileSync(path.join(T, "fixtures/pieces", f))); return { width: p.width, height: p.height, rgba: p.data }; };

test("P1 pezzi reali dell'Avventuriero: borsa = schegge (bocciato), braccio con Gemini = un corpo unico (promosso)", () => {
  const bad = pieceFragments(png("avventuriero_braccio_sx_schegge.png")), good = pieceFragments(png("avventuriero_braccio_dx_gemini.png"));
  assert.ok(bad.parts > 6 || bad.main < 0.9, JSON.stringify(bad));
  assert.ok(good.parts <= 6 && good.main >= 0.9, JSON.stringify(good));
});

// Domatrice (cerchio in mano, approvata): il taglio resta; con una soglia impossibile il meccanismo lo annulla e lo dice
const D = path.join(T, "fixtures/recognition/domatrice");
const img = PNG.sync.read(fs.readFileSync(path.join(D, "image.png"))), W = img.width, H = img.height, rgba = img.data;
const cat = PNG.sync.read(fs.readFileSync(path.join(D, "categories.png")));
const categories = new Uint8Array(W * H), alpha = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) { categories[i] = cat.data[i * 4]; alpha[i] = rgba[i * 4 + 3]; }
const landmarks = JSON.parse(fs.readFileSync(path.join(D, "landmarks.json"), "utf8")).landmarks.map(([x, y, v]) => ({ x, y, visibility: v }));
const rec = recognizeParts({ width: W, height: H, landmarks, categories, alpha, rgba });
const input = { width: W, height: H, rgba, fg: Uint8Array.from(alpha, (a) => (a >= 128 ? 1 : 0)), parts: rec.parts, categories, landmarks, joints: rec.joints };

test("P2 casi approvati: il controllo non annulla nulla (Domatrice: braccio col cerchio tagliato)", () => {
  const { report } = buildMeshRig(input);
  assert.equal(report.pieceCheck, undefined);
  assert.ok(report.decision.some((d) => /braccio_sx: TAGLIO/.test(d)), report.decision.join(" | "));
});

test("P3 pezzo bocciato: taglio annullato da solo, braccio in mesh, motivo nel riepilogo", () => {
  const { report, images } = buildMeshRig(input, { ...MESH_RIG_RULES, pieceMinMain: 1.01 });
  assert.ok(report.pieceCheck?.sx, JSON.stringify(report.pieceCheck));
  assert.ok(report.decision.some((d) => /braccio_sx: mesh \(taglio annullato: pezzo a schegge/.test(d)), report.decision.join(" | "));
  assert.ok(!images.braccio_sx);
});
