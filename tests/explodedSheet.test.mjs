// Casi di riferimento dell'import della TAVOLA ESPLOSA (src/lib/explodedSheet.js).
// Ogni cartella in tests/fixtures/exploded/<nome>/ contiene: original.png (personaggio intero),
// sheet.png (pezzi separati su sfondo a tinta unita), landmarks.json (posa MediaPipe
// dell'originale, in pixel) ed expected.json (risultato approvato: nome, ordine, posizione).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { importExplodedSheet } from "../src/lib/explodedSheet.js";
import { composePieces } from "../src/lib/partExtraction.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "exploded");
const read = (f) => {
  const p = PNG.sync.read(fs.readFileSync(f));
  return { width: p.width, height: p.height, rgba: p.data };
};

for (const name of fs.existsSync(root) ? fs.readdirSync(root) : []) {
  const dir = path.join(root, name);
  if (!fs.existsSync(path.join(dir, "expected.json"))) continue;
  const original = read(path.join(dir, "original.png"));
  const sheet = read(path.join(dir, "sheet.png"));
  const landmarks = JSON.parse(fs.readFileSync(path.join(dir, "landmarks.json"), "utf8")).landmarks.map(([x, y, v]) => ({ x, y, visibility: v }));
  const expected = JSON.parse(fs.readFileSync(path.join(dir, "expected.json"), "utf8"));
  const r = importExplodedSheet({ sheet, original, landmarks });

  test(`${name}: pezzi e ordine di disegno`, () => {
    assert.deepEqual(r.pieces.map((p) => p.name), expected.pieces.map((p) => p.name));
  });

  test(`${name}: ogni pezzo torna al suo posto`, () => {
    for (const e of expected.pieces) {
      const p = r.pieces.find((q) => q.name === e.name);
      assert.ok(p, `${e.name} mancante`);
      const d = Math.hypot(p.x - e.x, p.y - e.y);
      assert.ok(d <= 3, `${e.name}: spostato di ${d.toFixed(1)}px`);
      assert.equal(p.parent, e.parent, `${e.name}: genitore`);
    }
  });

  test(`${name}: la ricomposizione somiglia all'originale`, () => {
    const C = composePieces(r.pieces, original.width, original.height);
    let diff = 0, n = 0;
    for (let i = 0; i < original.width * original.height; i++) {
      if (C[i * 4 + 3] < 250) continue;
      n++;
      let d = 0;
      for (let k = 0; k < 3; k++) d += Math.abs(C[i * 4 + k] - original.rgba[i * 4 + k]);
      if (d > 60) diff++;
    }
    assert.ok(diff / n <= expected.maxDiffShare, `pixel diversi ${((diff / n) * 100).toFixed(1)}%`);
  });
}
