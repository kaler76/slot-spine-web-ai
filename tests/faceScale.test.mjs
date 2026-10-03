// Pezzi del viso disegnati dal modello in scala diversa dal resto della tavola (caso reale Zeus:
// occhi ingranditi -> posizione incerta, nomi sbagliati). alignFacePieceScaled li riporta alla
// scala dell'originale cercandoli a più scale attorno al viso.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { importExplodedSheet, alignFacePieceScaled, alignPiece } from "../src/lib/explodedSheet.js";
import { faceFrame } from "../src/lib/faceRig.js";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "exploded", "folletto_viso");
const read = (f) => {
  const p = PNG.sync.read(fs.readFileSync(path.join(dir, f)));
  return { width: p.width, height: p.height, rgba: p.data };
};
const original = read("original.png");
const landmarks = JSON.parse(fs.readFileSync(path.join(dir, "landmarks.json"), "utf8")).landmarks.map(([x, y, v]) => ({ x, y, visibility: v }));
const r = importExplodedSheet({ sheet: read("sheet.png"), original, landmarks, transplant: false }); // pezzi della tavola, non ritagliati dall'originale

/** Ingrandimento nearest (come farebbe il modello disegnando l'occhio più grande). */
function enlarge(p, k) {
  const w = Math.round(p.width * k), h = Math.round(p.height * k), rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sx = Math.min(p.width - 1, Math.floor(x / k)), sy = Math.min(p.height - 1, Math.floor(y / k));
      rgba.set(p.rgba.subarray((sy * p.width + sx) * 4, (sy * p.width + sx) * 4 + 4), (y * w + x) * 4);
    }
  return { width: w, height: h, rgba, area: p.area };
}

for (const name of ["occhio_sx", "sopracciglio_dx", "bocca"])
  test(`${name} disegnato 1.25× più grande: ritrovato al suo posto e riportato in scala`, () => {
    const p = r.pieces.find((q) => q.name === name);
    const big = enlarge(p, 1.25);
    const fr = faceFrame(landmarks);
    const win = { cx: fr.center.x, cy: fr.center.y, r: Math.max(3 * fr.u, 1.6 * fr.radius) };
    const at1 = alignPiece(big, original, 1, { coarse: 2, nFew: 600, window: win });
    const res = alignFacePieceScaled(big, original, win, at1.err);
    assert.ok(res, `non ritrovato (errore a scala 1: ${at1.err.toFixed(0)})`);
    assert.equal(res.s, 0.8);
    const d = Math.hypot(res.pos.x - p.x, res.pos.y - p.y);
    assert.ok(d <= 3, `spostato di ${d.toFixed(1)} px`);
  });

test("pezzo piccolo che non esiste nell'originale (ridisegnato): nessuna scala lo fa combaciare", () => {
  const p = r.pieces.find((q) => q.name === "occhio_sx");
  // stesso occhio ma con i colori invertiti: forma uguale, pixel diversi
  const inv = { ...p, rgba: p.rgba.map((v, i) => (i % 4 === 3 ? v : 255 - v)) };
  const fr = faceFrame(landmarks);
  const win = { cx: fr.center.x, cy: fr.center.y, r: Math.max(3 * fr.u, 1.6 * fr.radius) };
  assert.ok(!alignFacePieceScaled(inv, original, win, 110));
});
