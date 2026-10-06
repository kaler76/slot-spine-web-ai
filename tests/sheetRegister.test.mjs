// PEZZI DELLA TAVOLA RIMESSI SULL'ORIGINALE UNO PER UNO (src/lib/sheetRegister.js, 6 ott 2026).
// Caso: Jessica, tavola di GPT con i pezzi in scale diverse. Risultato atteso: i pezzi della
// tavola (nomi, divisione, zone nascoste) nella posizione e misura dell'originale; a riposo
// identico all'originale; export valido; piedi fermi (bug delle ossa inserite dalla mesh testa).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { registerSheetOnOriginal } from "../src/lib/sheetRegister.js";
import { underlayJoints } from "../src/lib/jointUnderlay.js";
import { composePieces } from "../src/lib/partExtraction.js";
import { piecesToCharacterParts } from "../src/lib/characterFromPieces.js";
import { buildCharacterSkeleton } from "../src/lib/characterSkeleton.js";
import { addTorsoBreathMesh, addHeadMesh } from "../src/lib/torsoMesh.js";
import { toSpine41 } from "../src/lib/spineFormat.js";
import { verifyExportSkeleton } from "../src/lib/exportCheck.js";
import { simulateLoop } from "../src/lib/animationSim.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => { const p = PNG.sync.read(fs.readFileSync(f)); return { width: p.width, height: p.height, rgba: p.data }; };
const J = path.join(here, "fixtures", "exploded", "jessica");
const lm = JSON.parse(fs.readFileSync(path.join(J, "landmarks.json"), "utf8"));
const joints = Object.fromEntries(Object.entries(lm.joints).map(([k, v]) => [k, { x: v[0], y: v[1] }]));
const landmarks = lm.landmarks.map(([x, y, v]) => ({ x, y, visibility: v }));
const original = read(path.join(J, "original.png"));
const r = registerSheetOnOriginal({ sheet: read(path.join(here, "fixtures", "sheet_source", "jessica_gpt", "sheet.png")), original, landmarks, joints });
const pieces = underlayJoints(r.pieces, { reach: 0.25 }).pieces;
const P = (n) => pieces.find((p) => p.name === n);

test("jessica GPT registrata: pezzi della tavola, scale diverse per pezzo", () => {
  for (const n of ["testa", "busto", "braccio_dx", "braccio_sx", "capelli_dietro", "ciocca_dx", "ciocca_sx", "occhio_dx", "occhio_sx", "bocca"]) assert.ok(P(n), `${n} mancante`);
  assert.ok(r.scales.occhio_dx < 0.75 && r.scales.busto > 1.05, "il viso di GPT va rimpicciolito, il vestito ingrandito");
  assert.ok(r.assembly.holeShare <= 0.01);
});

test("jessica GPT registrata: a riposo identica all'originale", () => {
  const { width: W, height: H, rgba } = original;
  const C = composePieces(pieces, W, H);
  let diff = 0, n = 0;
  for (let i = 0; i < W * H; i++) {
    if (C[i * 4 + 3] < 128) continue;
    n++;
    if (Math.abs(C[i * 4] - rgba[i * 4]) + Math.abs(C[i * 4 + 1] - rgba[i * 4 + 1]) + Math.abs(C[i * 4 + 2] - rgba[i * 4 + 2]) > 30) diff++;
  }
  assert.ok(diff / n < 0.005, `${((100 * diff) / n).toFixed(2)}% pixel diversi`);
});

test("jessica GPT registrata: viso sui punti della posa, export valido, piedi fermi", () => {
  const c = (p) => ({ x: p.x + p.width / 2, y: p.y + p.height / 2 });
  for (const [n, i] of [["occhio_dx", 5], ["occhio_sx", 2]]) assert.ok(Math.hypot(c(P(n)).x - landmarks[i].x, c(P(n)).y - landmarks[i].y) < 25, `${n} lontano dall'occhio`);
  const { parts } = piecesToCharacterParts(pieces);
  let j = buildCharacterSkeleton({ parts });
  j = addTorsoBreathMesh(j, parts).json;
  j = addHeadMesh(j, parts).json;
  const json = toSpine41(j);
  const v = verifyExportSkeleton(json, parts);
  assert.ok(v.ok, v.errors.join("\n"));
  const sim = simulateLoop(json, { fps: 15, images: Object.fromEntries(pieces.map((p) => [p.name, p])) });
  assert.ok(!sim.problems.some((p) => /base si muove|staccato/.test(p)), sim.problems.join("\n"));
});
