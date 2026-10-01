// Regole del loop ambient v2 (approvate sul folletto, 2026-10-01): ciclo unico, loop chiuso,
// ampiezze per ruolo, saluto per il braccio alzato. Verificate sul character costruito dalla
// tavola esplosa del folletto e sull'export Spine 4.1.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { importExplodedSheet } from "../src/lib/explodedSheet.js";
import { piecesToCharacterParts } from "../src/lib/characterFromPieces.js";
import { buildCharacterSkeleton } from "../src/lib/characterSkeleton.js";
import { toSpine41 } from "../src/lib/spineFormat.js";
import { LOOP_SECONDS } from "../src/lib/characterAnimationTemplates.js";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "exploded", "folletto");
const read = (f) => {
  const p = PNG.sync.read(fs.readFileSync(path.join(dir, f)));
  return { width: p.width, height: p.height, rgba: p.data };
};
const landmarks = JSON.parse(fs.readFileSync(path.join(dir, "landmarks.json"), "utf8")).landmarks.map(([x, y, v]) => ({ x, y, visibility: v }));
const { pieces } = importExplodedSheet({ sheet: read("sheet.png"), original: read("original.png"), landmarks });
const { parts } = piecesToCharacterParts(pieces);
const spine = toSpine41(buildCharacterSkeleton({ parts }));
const bones = spine.animations.ambient.bones;
const amp = (k) => Math.max(...bones[k].rotate.map((r) => Math.abs(r.value)));

test("loop: tutte le tracce durano LOOP_SECONDS e si chiudono sul valore iniziale", () => {
  for (const [k, tl] of Object.entries(bones)) {
    const r = tl.rotate;
    assert.equal(r[r.length - 1].time, LOOP_SECONDS, `${k}: durata`);
    assert.ok(Math.abs(r[0].value - r[r.length - 1].value) < 0.01, `${k}: loop non chiuso`);
    assert.ok(!("angle" in r[0]), `${k}: chiave "angle" nell'export Spine`);
  }
});

test("ampiezze per ruolo: testa ±2.5, braccio che saluta ±9, braccio col sacchetto ±2, oggetto ±3.5", () => {
  assert.ok(Math.abs(amp("testa") - 2.5) < 0.1);
  assert.ok(Math.abs(amp("braccio_sx") - 9) < 0.1, `braccio_sx ${amp("braccio_sx")}`);
  assert.ok(Math.abs(amp("braccio_dx") - 2) < 0.1, `braccio_dx ${amp("braccio_dx")}`);
  assert.ok(Math.abs(amp("oggetto") - 3.5) < 0.1);
  assert.equal(bones.busto, undefined, "il busto resta fermo");
});
