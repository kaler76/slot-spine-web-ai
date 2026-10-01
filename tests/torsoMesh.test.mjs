// Busto come mesh pesata (respiro): struttura valida per Spine 4.1, pesi che sommano a 1,
// gambe ferme sul bacino, testa e braccia agganciate al petto, indici ossa corretti dopo
// il riordino topologico dell'export.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { importExplodedSheet } from "../src/lib/explodedSheet.js";
import { piecesToCharacterParts } from "../src/lib/characterFromPieces.js";
import { buildCharacterSkeleton } from "../src/lib/characterSkeleton.js";
import { addTorsoBreathMesh } from "../src/lib/torsoMesh.js";
import { toSpine41 } from "../src/lib/spineFormat.js";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "exploded", "folletto");
const read = (f) => {
  const p = PNG.sync.read(fs.readFileSync(path.join(dir, f)));
  return { width: p.width, height: p.height, rgba: p.data };
};
const landmarks = JSON.parse(fs.readFileSync(path.join(dir, "landmarks.json"), "utf8")).landmarks.map(([x, y, v]) => ({ x, y, visibility: v }));
const { pieces } = importExplodedSheet({ sheet: read("sheet.png"), original: read("original.png"), landmarks });
const { parts } = piecesToCharacterParts(pieces);
const { json, applied } = addTorsoBreathMesh(buildCharacterSkeleton({ parts }), parts);
const out = toSpine41(json);

/** Posizione mondo di riposo (solo traslazioni: tutte le rotazioni di riposo sono 0). */
function worldPos(bones, name) {
  let x = 0, y = 0;
  for (let b = bones.find((q) => q.name === name); b; b = bones.find((q) => q.name === b.parent)) {
    x += b.x || 0;
    y += b.y || 0;
  }
  return { x, y };
}

test("mesh del busto: struttura e pesi", () => {
  assert.ok(applied);
  const mesh = out.skins[0].attachments.busto.busto;
  assert.equal(mesh.type, "mesh");
  const nV = mesh.uvs.length / 2;
  assert.ok(mesh.triangles.every((i) => i >= 0 && i < nV));
  assert.ok(mesh.hull > 2 && mesh.hull < nV);
  const busto = out.bones.findIndex((b) => b.name === "busto");
  const petto = out.bones.findIndex((b) => b.name === "busto_petto");
  assert.ok(petto > busto, "petto dopo il busto");
  let i = 0, v = 0, legsOnPelvis = 0;
  while (i < mesh.vertices.length) {
    const count = mesh.vertices[i++];
    let sum = 0;
    const uvY = mesh.uvs[v * 2 + 1];
    for (let k = 0; k < count; k++, i += 4) {
      const bi = mesh.vertices[i];
      assert.ok(bi === busto || bi === petto, `osso ${bi} non previsto`);
      sum += mesh.vertices[i + 3];
      if (uvY === 1 && bi === busto && mesh.vertices[i + 3] === 1) legsOnPelvis++;
    }
    assert.ok(Math.abs(sum - 1) < 0.001, `vertice ${v}: pesi ${sum}`);
    v++;
  }
  assert.equal(v, nV);
  assert.ok(legsOnPelvis > 0, "i piedi restano sul bacino");
});

test("testa e braccia seguono il petto, nella stessa posizione di prima", () => {
  const plain = toSpine41(buildCharacterSkeleton({ parts }));
  for (const k of ["testa", "braccio_sx", "braccio_dx"]) {
    assert.equal(out.bones.find((b) => b.name === k).parent, "busto_petto", k);
    const a = worldPos(out.bones, k), b = worldPos(plain.bones, k);
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 0.05, `${k} spostato`);
  }
  assert.ok(out.animations.ambient.bones.busto_petto.translate.length > 2, "respiro nel loop");
});

import { addHeadMesh } from "../src/lib/torsoMesh.js";

test("testa come mesh: cima e mento in ritardo, pesi validi, viso rigido", () => {
  const r = addHeadMesh(json, parts);
  assert.ok(r.applied);
  const s = toSpine41(r.json);
  const mesh = s.skins[0].attachments.testa.testa;
  assert.equal(mesh.type, "mesh");
  const idx = (n) => s.bones.findIndex((b) => b.name === n);
  const [testa, cima, mento] = ["testa", "testa_cima", "testa_mento"].map(idx);
  assert.ok(cima > testa && mento > testa);
  let i = 0, v = 0;
  while (i < mesh.vertices.length) {
    const count = mesh.vertices[i++];
    const fy = mesh.uvs[v * 2 + 1];
    const w = {};
    for (let k = 0; k < count; k++, i += 4) w[mesh.vertices[i]] = mesh.vertices[i + 3];
    const sum = Object.values(w).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 0.001, `vertice ${v}: ${sum}`);
    if (fy <= 0.25) assert.equal(w[cima], 1, "cappello tutto sulla cima");
    if (fy >= 0.55 && fy <= 0.62) assert.equal(w[testa], 1, "viso rigido");
    if (fy === 1) assert.equal(w[mento], 1, "punta della barba sul mento");
    v++;
  }
  const rot = s.animations.ambient.bones.testa_mento.rotate;
  assert.equal(rot[rot.length - 1].time, 4);
  assert.ok(!("angle" in rot[0]));
});
