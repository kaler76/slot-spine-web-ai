// BORDO D'ALTRO SUL PEZZO CHE SI MUOVE (sheetAssembly.transplantOriginal, peelForeign, 6 ott 2026).
// Zeus: la tavola ridisegnata metteva nel braccio_sx il bordo dorato, la linea nera e un lembo viola
// del drappo; in movimento ruotavano col braccio (linea nera sul bicipite, segnalata dall'utente).
// Il bordo deve stare nel busto (fermo) e a riposo la ricomposizione resta identica all'originale.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { importExplodedSheet } from "../src/lib/explodedSheet.js";
import { composePieces } from "../src/lib/partExtraction.js";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "exploded", "zeus");
const read = (f) => {
  const p = PNG.sync.read(fs.readFileSync(path.join(dir, f)));
  return { width: p.width, height: p.height, rgba: p.data };
};
const lm = JSON.parse(fs.readFileSync(path.join(dir, "landmarks.json"), "utf8"));
const landmarks = (lm.landmarks || lm).map((a) => (Array.isArray(a) ? { x: a[0], y: a[1], visibility: a[2] } : a));
const joints = Object.fromEntries(Object.entries(lm.joints || {}).map(([k, v]) => [k, Array.isArray(v) ? { x: v[0], y: v[1] } : v]));

test("zeus: il bordo del drappo non sta nel braccio che si muove, a riposo identico", () => {
  const original = read("original.png");
  const r = importExplodedSheet({ sheet: read("sheet.png"), original, landmarks, joints, profile: "standard", fillFromOriginal: true });
  const arm = r.pieces.find((p) => p.name === "braccio_sx");
  assert.ok(arm);
  let purple = 0;
  for (let i = 0; i < arm.rgba.length; i += 4) {
    if (arm.rgba[i + 3] < 128) continue;
    const [R, G, B] = [arm.rgba[i], arm.rgba[i + 1], arm.rgba[i + 2]];
    if (B > R + 20 && B > G + 40) purple++;
  }
  // prima della regola: 168 pixel viola del drappo nel braccio
  assert.ok(purple < 40, `${purple} pixel viola nel braccio_sx`);
  const A = composePieces(r.pieces, original.width, original.height);
  let diff = 0, fg = 0;
  for (let i = 0; i < A.length; i += 4) {
    if (original.rgba[i + 3] < 128) continue;
    fg++;
    if (Math.abs(A[i] - original.rgba[i]) + Math.abs(A[i + 1] - original.rgba[i + 1]) + Math.abs(A[i + 2] - original.rgba[i + 2]) > 30) diff++;
  }
  assert.ok(diff <= 0.03 * fg, `${diff}/${fg} pixel diversi a riposo`);
});
