// PEZZI TAGLIATI DALL'ORIGINALE (src/lib/originalCut.js, 6 ott 2026) — caso Zeus: riconoscimento
// (categorie + posa salvate) -> pezzi + viso staccato + sovrapposizione ai raccordi.
// Garanzie: a riposo identico all'originale, export valido, simulazione del loop senza problemi.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { recognizeParts, foregroundFromUniformBorder } from "../src/lib/partRecognition.js";
import { composePieces } from "../src/lib/partExtraction.js";
import { cutFromOriginal } from "../src/lib/originalCut.js";
import { piecesToCharacterParts } from "../src/lib/characterFromPieces.js";
import { buildCharacterSkeleton } from "../src/lib/characterSkeleton.js";
import { toSpine41 } from "../src/lib/spineFormat.js";
import { verifyExportSkeleton } from "../src/lib/exportCheck.js";
import { simulateLoop } from "../src/lib/animationSim.js";

const D = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "exploded", "zeus");
const rd = (f) => PNG.sync.read(fs.readFileSync(path.join(D, f)));
const o = rd("original.png"), W = o.width, H = o.height, rgba = o.data;
const c = rd("categorie.png");
const categories = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) categories[i] = Math.round(c.data[i * 4] / 40);
const landmarks = JSON.parse(fs.readFileSync(path.join(D, "landmarks.json"), "utf8")).landmarks.map(([x, y, v]) => ({ x, y, visibility: v }));
let hasAlpha = false;
for (let i = 3; i < rgba.length; i += 4) if (rgba[i] < 250) { hasAlpha = true; break; }
const alpha = hasAlpha ? Float32Array.from({ length: W * H }, (_, i) => rgba[i * 4 + 3] / 255) : foregroundFromUniformBorder({ width: W, height: H, rgba, categories });
const rec = recognizeParts({ width: W, height: H, landmarks, categories, alpha, rgba });
const cut = cutFromOriginal({ width: W, height: H, rgba, parts: rec.parts, joints: rec.joints, landmarks });

test("zeus dall'originale: a riposo identico all'originale", () => {
  const C = composePieces(cut.pieces, W, H);
  let diff = 0, n = 0;
  for (let i = 0; i < W * H; i++) {
    if (C[i * 4 + 3] < 128) continue;
    n++;
    if (Math.abs(C[i * 4] - rgba[i * 4]) + Math.abs(C[i * 4 + 1] - rgba[i * 4 + 1]) + Math.abs(C[i * 4 + 2] - rgba[i * 4 + 2]) > 30) diff++;
  }
  assert.ok(diff / n < 0.002, `${((100 * diff) / n).toFixed(2)}% pixel diversi`);
});

test("zeus dall'originale: viso staccato, export valido, loop simulato senza problemi", () => {
  const names = cut.pieces.map((p) => p.name);
  for (const n of ["testa", "busto", "occhio_sx", "occhio_dx", "bocca"]) assert.ok(names.includes(n), `${n} mancante`);
  const { parts } = piecesToCharacterParts(cut.pieces);
  const json = toSpine41(buildCharacterSkeleton({ parts }));
  const v = verifyExportSkeleton(json, parts);
  assert.ok(v.ok, v.errors.join("\n"));
  const sim = simulateLoop(json, { fps: 15, images: Object.fromEntries(cut.pieces.map((p) => [p.name, p])) });
  assert.ok(sim.ok, sim.problems.join("\n"));
});
