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

// CIUFFO (P7.3): capelli che coprono l'occhio -> "ciuffo" se pezzo in più; se è una ciocca si riusa
import { applyRoles } from "../src/lib/explodedSheet.js";
import { TESTA_BUSTO_ROLES } from "../src/lib/separationProfiles.js";
const box = (name, x, y, w, h) => ({ name, x, y, width: w, height: h, area: w * h, rgba: new Uint8ClampedArray(w * h * 4).fill(255) });
const lm = () => {
  const L = Array.from({ length: 33 }, () => ({ x: 100, y: 100 }));
  L[0] = { x: 100, y: 80 };
  L[11] = { x: 140, y: 150 };
  L[12] = { x: 60, y: 150 };
  return L;
};

test("testa-busto: pezzo in più sopra l'occhio = ciuffo, figlio della testa, davanti all'occhio", () => {
  const ps = [box("testa", 50, 20, 100, 120), box("occhio_dx", 70, 60, 20, 10), box("oggetto_1", 65, 30, 20, 40)];
  const w = [];
  applyRoles(ps, TESTA_BUSTO_ROLES, lm(), w);
  assert.equal(ps[2].name, "ciuffo");
  assert.equal(ps[2].overEye, true);
});

test("testa-busto: ciocca già separata sopra l'occhio = riusata (nessun ciuffo doppio)", () => {
  const ps = [box("testa", 50, 20, 100, 120), box("occhio_dx", 70, 60, 20, 10), box("ciocca_dx", 65, 30, 20, 40)];
  applyRoles(ps, TESTA_BUSTO_ROLES, lm(), []);
  assert.equal(ps[2].name, "ciocca_dx");
  assert.equal(ps[2].overEye, true);
  assert.ok(!ps.some((p) => p.name === "ciuffo"));
});

test("testa-busto: ciocca lontana dall'occhio resta ciocca normale", () => {
  const ps = [box("testa", 50, 20, 100, 120), box("occhio_dx", 70, 60, 20, 10), box("ciocca_sx", 140, 60, 15, 60)];
  applyRoles(ps, TESTA_BUSTO_ROLES, lm(), []);
  assert.equal(ps[2].overEye, undefined);
});
