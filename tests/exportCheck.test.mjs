// Verifica dell'export: lo skeleton del folletto (con mesh) passa; difetti tipici vengono trovati.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { importExplodedSheet } from "../src/lib/explodedSheet.js";
import { piecesToCharacterParts } from "../src/lib/characterFromPieces.js";
import { buildCharacterSkeleton } from "../src/lib/characterSkeleton.js";
import { addTorsoBreathMesh, addHeadMesh } from "../src/lib/torsoMesh.js";
import { toSpine41 } from "../src/lib/spineFormat.js";
import { verifyExportSkeleton } from "../src/lib/exportCheck.js";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "exploded", "folletto");
const read = (f) => {
  const p = PNG.sync.read(fs.readFileSync(path.join(dir, f)));
  return { width: p.width, height: p.height, rgba: p.data };
};
const landmarks = JSON.parse(fs.readFileSync(path.join(dir, "landmarks.json"), "utf8")).landmarks.map(([x, y, v]) => ({ x, y, visibility: v }));
const { pieces } = importExplodedSheet({ sheet: read("sheet.png"), original: read("original.png"), landmarks });
const { parts } = piecesToCharacterParts(pieces);
const withMeshes = () => {
  let j = buildCharacterSkeleton({ parts });
  j = addTorsoBreathMesh(j, parts).json;
  j = addHeadMesh(j, parts).json;
  return toSpine41(j);
};

test("folletto con mesh: export valido, 2 mesh, loop chiuso", () => {
  const r = verifyExportSkeleton(withMeshes(), parts);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.summary.meshes, 2);
  assert.equal(r.summary.duration, 4);
});

test("braccio mancante: avviso", () => {
  const p2 = parts.map((p) => (p.partKey === "braccio_sx" ? { ...p, role: "accessory" } : p));
  const r = verifyExportSkeleton(withMeshes(), p2);
  assert.ok(r.warnings.some((w) => /Braccia trovate: 1/.test(w)));
});

test("pesi sbagliati e allegato mancante: errori", () => {
  const j = withMeshes();
  const m = j.skins[0].attachments.busto.busto;
  m.vertices[4] = 0.5; // primo peso del primo vertice
  delete j.skins[0].attachments.testa;
  const r = verifyExportSkeleton(j, parts);
  assert.ok(!r.ok);
  assert.ok(r.errors.some((e) => /pesi del vertice 0/.test(e)));
  assert.ok(r.errors.some((e) => /allegato "testa" mancante/.test(e)));
});
