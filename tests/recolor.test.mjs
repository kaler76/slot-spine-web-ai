// SAGOMA DALLA TAVOLA, COLORI DALL'ORIGINALE (8 ott 2026, sheetAssembly.recolorVisible).
// Riferimento approvato dall'utente: zeus_ambient_spine41 (3 ott), "la versione più vicina alla
// perfezione": a riposo identico all'originale. Con il profilo Standard (pezzi = tavola, 6 ott) la
// scelta automatica deve dare di nuovo il disegno dell'originale a riposo, senza buchi, tenendo
// i tagli della tavola in movimento.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { autoImportSheet } from "../src/lib/autoSelect.js";
import { composePieces } from "../src/lib/partExtraction.js";
import { foregroundMask, recolorVisible } from "../src/lib/sheetAssembly.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "exploded");
const read = (f) => { const p = PNG.sync.read(fs.readFileSync(f)); return { width: p.width, height: p.height, rgba: p.data }; };
const MAX_DIFF = 0.025, MAX_HOLES = 0.005;

for (const name of ["zeus", "avvocato", "folletto"]) {
  test(`${name}: profilo Standard automatico, a riposo coi colori dell'originale`, () => {
    const dir = path.join(root, name);
    const J = JSON.parse(fs.readFileSync(path.join(dir, "landmarks.json"), "utf8"));
    const landmarks = J.landmarks.map(([x, y, v]) => ({ x, y, visibility: v }));
    const joints = J.joints && Object.fromEntries(Object.entries(J.joints).map(([k, [x, y]]) => [k, { x, y }]));
    const original = read(path.join(dir, "original.png"));
    const r = autoImportSheet({ sheet: read(path.join(dir, "sheet.png")), original, landmarks, joints, profile: "standard" });
    assert.ok(r.usable);
    const C = composePieces(r.pieces, original.width, original.height), fg = foregroundMask(original);
    let n = 0, diff = 0, holes = 0;
    for (let i = 0; i < fg.length; i++) {
      if (!fg[i]) continue;
      n++;
      if (C[i * 4 + 3] < 128) { holes++; continue; }
      let d = 0;
      for (let k = 0; k < 3; k++) d += Math.abs(C[i * 4 + k] - original.rgba[i * 4 + k]);
      if (d > 30) diff++;
    }
    assert.ok(holes / n <= MAX_HOLES, `pixel scoperti ${((holes / n) * 100).toFixed(2)}%`);
    assert.ok(diff / n <= MAX_DIFF, `pixel diversi ${((diff / n) * 100).toFixed(2)}%`);
    assert.ok(r.pieces.length <= 16, `pezzi ${r.pieces.length}`);
  });
}

test("recolorVisible: sagoma della tavola, colore dell'originale; sporgenze tolte; bordo assegnato", () => {
  // originale 10x10: quadrato rosso 2..7; tavola: stesso quadrato blu spostato di 1 a destra
  const W = 10, H = 10, rgba = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; rgba[i + 3] = 255; if (x >= 2 && x <= 7 && y >= 2 && y <= 7) rgba[i] = 220; }
  const pr = new Uint8ClampedArray(6 * 6 * 4);
  for (let i = 0; i < 36; i++) pr.set([0, 0, 220, 255], i * 4);
  const { pieces, rest } = recolorVisible([{ name: "busto", order: 0, x: 3, y: 2, width: 6, height: 6, rgba: pr }], { width: W, height: H, rgba });
  const p = pieces[0];
  assert.equal(rest.length, 0);
  const at = (gx, gy) => { const i = ((gy - p.y) * p.width + (gx - p.x)) * 4; return [...p.rgba.subarray(i, i + 4)]; };
  assert.deepEqual(at(4, 4).slice(0, 3), [220, 0, 0]); // colore dall'originale
  assert.equal(at(8, 4)[3], 0); // sporgenza oltre l'originale tolta
  assert.deepEqual(at(2, 4), [220, 0, 0, 255]); // colonna scoperta assegnata al pezzo
});
