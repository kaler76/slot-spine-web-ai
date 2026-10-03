// GARANZIA DI PRECISIONE (regola approvata dall'utente su Zeus, 3 ott 2026): per OGNI caso reale
// utilizzabile la ricomposizione dei pezzi deve coincidere con l'originale (pixel visibili presi
// dall'originale, sheetAssembly.transplantOriginal). Ogni nuovo character approvato va aggiunto
// in tests/fixtures/exploded/<nome>/ e passa automaticamente da qui.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { importExplodedSheet } from "../src/lib/explodedSheet.js";
import { composePieces } from "../src/lib/partExtraction.js";
import { foregroundMask } from "../src/lib/sheetAssembly.js";

/** Soglie della garanzia: pixel del personaggio diversi dall'originale e pixel scoperti. */
const MAX_DIFF = 0.01, MAX_HOLES = 0.01;

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "exploded");
const read = (f) => {
  const p = PNG.sync.read(fs.readFileSync(f));
  return { width: p.width, height: p.height, rgba: p.data };
};

for (const name of fs.readdirSync(root)) {
  const dir = path.join(root, name);
  if (!fs.existsSync(path.join(dir, "expected.json"))) continue;
  const expected = JSON.parse(fs.readFileSync(path.join(dir, "expected.json"), "utf8"));
  if ((expected.usable ?? expected.faithful ?? true) === false) continue; // tavola da scartare
  test(`${name}: ricomposizione identica all'originale`, () => {
    const original = read(path.join(dir, "original.png"));
    const J = JSON.parse(fs.readFileSync(path.join(dir, "landmarks.json"), "utf8"));
    const landmarks = J.landmarks.map(([x, y, v]) => ({ x, y, visibility: v }));
    const joints = J.joints && Object.fromEntries(Object.entries(J.joints).map(([k, [x, y]]) => [k, { x, y }]));
    const r = importExplodedSheet({ sheet: read(path.join(dir, "sheet.png")), original, landmarks, joints });
    const C = composePieces(r.pieces, original.width, original.height);
    const fg = foregroundMask(original);
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
  });
}
