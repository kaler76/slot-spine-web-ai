// Casi di riferimento del RICONOSCIMENTO da immagine intera (src/lib/partRecognition.js).
// Ogni cartella in tests/fixtures/recognition/<nome>/ contiene: image.png (RGBA), categories.png
// (indice categoria MediaPipe per pixel), landmarks.json (posa MediaPipe in pixel) ed expected.json
// (risultato approvato dall'utente). I modelli MediaPipe girano solo nel browser: qui si
// salvano le loro uscite e si verifica che le REGOLE continuino a produrre il risultato approvato.
// Nuovo caso: "Scarica risultato" in /recognize + immagine originale -> nuova cartella.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { recognizeParts, foregroundFromUniformBorder, PARTS } from "../src/lib/partRecognition.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "recognition");

for (const name of fs.existsSync(root) ? fs.readdirSync(root) : []) {
  const dir = path.join(root, name);
  if (!fs.existsSync(path.join(dir, "expected.json"))) continue;
  const img = PNG.sync.read(fs.readFileSync(path.join(dir, "image.png")));
  const cat = PNG.sync.read(fs.readFileSync(path.join(dir, "categories.png")));
  const W = img.width, H = img.height;
  const categories = new Uint8Array(W * H);
  const alpha = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    categories[i] = cat.data[i * 4];
    alpha[i] = img.data[i * 4 + 3];
  }
  const lm = JSON.parse(fs.readFileSync(path.join(dir, "landmarks.json"), "utf8"));
  const landmarks = lm.landmarks.map(([x, y, v]) => ({ x, y, visibility: v }));
  const expected = JSON.parse(fs.readFileSync(path.join(dir, "expected.json"), "utf8"));
  // come nell'app: trasparenza del PNG se c'è, altrimenti sfondo uniforme (es. nero) + segmentatore
  let hasAlpha = false;
  for (let i = 0; i < W * H; i++) if (alpha[i] < 250) { hasAlpha = true; break; }
  const fgAlpha = hasAlpha ? alpha : foregroundFromUniformBorder({ width: W, height: H, rgba: img.data, categories }) || undefined;
  const r = recognizeParts({ width: W, height: H, landmarks, categories, alpha: fgAlpha, rgba: img.data });
  const diag = Math.hypot(W, H);

  const acc = {};
  let tot = 0;
  for (let i = 0; i < W * H; i++) {
    const p = r.parts[i];
    if (!p) continue;
    const k = PARTS[p];
    const x = i % W, y = (i - x) / W;
    (acc[k] ||= { n: 0, sx: 0, sy: 0 }).n++;
    acc[k].sx += x;
    acc[k].sy += y;
    tot++;
  }

  test(`${name}: stesse parti riconosciute`, () => {
    assert.deepEqual(Object.keys(acc).sort(), Object.keys(expected.parts).sort());
  });

  test(`${name}: quota e baricentro di ogni parte`, () => {
    for (const [k, e] of Object.entries(expected.parts)) {
      const a = acc[k];
      assert.ok(a, `${k} mancante`);
      const share = (a.n / tot) * 100;
      assert.ok(Math.abs(share - e.share) <= 1.5, `${k}: quota ${share.toFixed(2)}% invece di ${e.share}%`);
      const d = Math.hypot(a.sx / a.n - e.centroid[0], a.sy / a.n - e.centroid[1]);
      assert.ok(d <= 0.02 * diag, `${k}: baricentro spostato di ${d.toFixed(0)}px`);
    }
  });

  test(`${name}: articolazioni`, () => {
    for (const [k, [ex, ey]] of Object.entries(expected.joints)) {
      const p = r.joints[k];
      const d = Math.hypot(p.x - ex, p.y - ey);
      assert.ok(d <= 0.02 * diag, `${k}: spostata di ${d.toFixed(0)}px`);
    }
  });
}
