// Profilo TESTA-BUSTO (Jessica): quando si carica la tavola separata si usano I SUOI PEZZI così
// come sono (pixel della tavola, niente resto_N dall'originale) e i nomi vengono dai 12 ruoli,
// anche se la posa cliccata a mano mette la mano vicino a una ciocca (caso reale 3 ott 2026:
// ciocca diventata oggetto_1 figlia del braccio, bocca diventata baffo).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { importExplodedSheet } from "../src/lib/explodedSheet.js";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "exploded", "jessica");
const read = (f) => {
  const p = PNG.sync.read(fs.readFileSync(path.join(dir, f)));
  return { width: p.width, height: p.height, rgba: p.data };
};
const J = JSON.parse(fs.readFileSync(path.join(dir, "landmarks.json"), "utf8"));
const landmarks = J.landmarks.map(([x, y, v]) => ({ x, y, visibility: v }));
const joints = Object.fromEntries(Object.entries(J.joints).map(([k, [x, y]]) => [k, { x, y }]));
// posa a mano: mano alzata vicino alla ciocca destra
joints.mano_dx = { x: 320, y: 230 };
landmarks[16] = { x: 330, y: 240, visibility: 1 };
const sheet = read("sheet.png");
const r = importExplodedSheet({ sheet, original: read("original.png"), landmarks, joints, profile: "testa-busto" });
const NAMES = ["testa", "ciocca_dx", "ciocca_sx", "sopracciglio_dx", "sopracciglio_sx", "occhio_dx", "occhio_sx", "bocca", "capelli_dietro", "braccio_dx", "braccio_sx", "busto"];

test("testa-busto: 12 pezzi, uno per ruolo, niente oggetti/baffi/resto", () => {
  assert.deepEqual(r.pieces.map((p) => p.name).sort(), [...NAMES].sort());
});

test("testa-busto: ciocche figlie della testa, non del braccio", () => {
  for (const n of ["ciocca_dx", "ciocca_sx"]) assert.equal(r.pieces.find((p) => p.name === n).parent, "testa");
});

test("testa-busto: pixel della tavola, non dell'originale", () => {
  for (const p of r.pieces) assert.equal(p.ownPixels, undefined, `${p.name}: ritagliato dall'originale`);
});
