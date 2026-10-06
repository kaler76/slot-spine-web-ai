// SELETTORE AUTOMATICO (src/lib/autoSelect.js, 5 ott 2026): prova le varianti di ricomposizione
// (pixel dall'originale o dalla tavola, sovrapposizione ai raccordi), le misura con i controlli
// esistenti e tiene la migliore. Caso: Jessica (profilo testa-busto), tavola ridisegnata.
// La sovrapposizione aggiunta (jointUnderlay.js) non deve cambiare NULLA a riposo.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { autoImportSheet } from "../src/lib/autoSelect.js";
import { importExplodedSheet } from "../src/lib/explodedSheet.js";
import { underlayJoints } from "../src/lib/jointUnderlay.js";
import { motionStats } from "../src/lib/testaBustoCheck.js";
import { composePieces } from "../src/lib/partExtraction.js";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "exploded", "jessica");
const read = (f) => {
  const p = PNG.sync.read(fs.readFileSync(path.join(dir, f)));
  return { width: p.width, height: p.height, rgba: p.data };
};
const lm = JSON.parse(fs.readFileSync(path.join(dir, "landmarks.json"), "utf8"));
const landmarks = lm.landmarks.map(([x, y, v]) => ({ x, y, visibility: v }));
const joints = Object.fromEntries(Object.entries(lm.joints || {}).map(([k, v]) => [k, Array.isArray(v) ? { x: v[0], y: v[1] } : v]));
const original = read("original.png");
const sheet = read("sheet.png");

test("jessica: la scelta automatica elimina scalini, naso appiattito e buchi in movimento", () => {
  const r = autoImportSheet({ sheet, original, landmarks, joints, profile: "testa-busto" });
  const best = r.selection.table[0];
  assert.equal(r.selection.chosen.fill, true, r.selection.reasons.join("\n"));
  assert.ok(best.usable);
  assert.equal(best.nose, 0);
  assert.equal(best.seamBad, 0);
  assert.equal(best.motionBad, 0, r.selection.reasons.join("\n"));
  assert.ok(!r.warnings.some((w) => /scalino|buco al raccordo|Naso/.test(w)), r.warnings.join("\n"));
});

test("sovrapposizione ai raccordi: a riposo la ricomposizione è identica, in movimento meno buchi", () => {
  const base = importExplodedSheet({ sheet, original, landmarks, joints, profile: "testa-busto", fillFromOriginal: true });
  const u = underlayJoints(base.pieces, { reach: 0.25 });
  assert.ok(u.changes.length > 0);
  const A = composePieces(base.pieces, original.width, original.height);
  const B = composePieces(u.pieces, original.width, original.height);
  let diff = 0;
  for (let i = 0; i < A.length; i += 4) if (Math.abs(A[i + 3] - B[i + 3]) > 2 || Math.abs(A[i] - B[i]) > 2) diff++;
  assert.ok(diff <= 0.0005 * original.width * original.height, `${diff} pixel cambiati a riposo`);
  const sum = (ps) => motionStats(ps, original).reduce((a, m) => a + m.worst, 0);
  assert.ok(sum(u.pieces) < sum(base.pieces));
});
