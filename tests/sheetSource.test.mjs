// TAVOLA COME SORGENTE (src/lib/sheetSource.js, 6 ott 2026): tavola di GPT con il personaggio
// ridisegnato (Jessica, abito lungo): i pezzi non combaciano con l'originale e si montano fra loro.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { assembleFromSheet, findClosedEyes } from "../src/lib/sheetSource.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const p = PNG.sync.read(fs.readFileSync(path.join(here, "fixtures", "sheet_source", "jessica_gpt", "sheet.png")));
const lm = JSON.parse(fs.readFileSync(path.join(here, "fixtures", "exploded", "jessica", "landmarks.json"), "utf8"));
const landmarks = lm.landmarks.map(([x, y, v]) => ({ x, y, visibility: v }));
const SIL_H = 1449; // altezza della sagoma dell'originale di Jessica
const r = assembleFromSheet({ width: p.width, height: p.height, rgba: p.data }, { ref: { landmarks, silhouetteHeight: SIL_H } });
const P = (n) => r.pieces.find((q) => q.name === n);
const center = (q) => ({ x: q.x + q.width / 2, y: q.y + q.height / 2 });

test("jessica GPT: 13 pezzi con i ruoli del profilo testa-busto", () => {
  assert.deepEqual([...r.roles].sort(), ["bocca", "braccio_dx", "braccio_sx", "busto", "capelli_dietro", "ciocca_dx", "ciocca_sx", "ciuffo", "occhio_dx", "occhio_sx", "sopracciglio_dx", "sopracciglio_sx", "testa"]);
});

test("jessica GPT: montaggio — testa sul vestito, braccia ai lati, viso sulle palpebre", () => {
  const t = P("testa"), b = P("busto");
  assert.ok(t.y + t.height > b.y && t.y < b.y, "la scollatura deve entrare sotto il bordo del vestito");
  assert.ok(Math.abs(center(t).x - center(b).x) < 0.15 * b.width, "testa centrata sul vestito");
  assert.ok(center(P("braccio_dx")).x < center(t).x && center(P("braccio_sx")).x > center(t).x, "braccia ai lati giusti");
  for (const s of ["dx", "sx"]) {
    const a = P(`braccio_${s}`);
    assert.ok(a.pivot.x >= t.x - 10 && a.pivot.x <= t.x + t.width + 10 && a.pivot.y >= t.y && a.pivot.y <= t.y + t.height + 10, `braccio_${s}: pivot sulla spalla`);
  }
  const lids = findClosedEyes(t);
  assert.ok(lids, "palpebre chiuse trovate");
  for (const s of ["dx", "sx"]) {
    const e = center(P(`occhio_${s}`));
    assert.ok(Math.hypot(e.x - lids[s].x, e.y - lids[s].y) < 0.6 * P(`occhio_${s}`).width, `occhio_${s} sulla palpebra`);
    assert.ok(center(P(`sopracciglio_${s}`)).y < e.y, `sopracciglio_${s} sopra l'occhio`);
  }
  assert.ok(center(P("bocca")).y > center(P("occhio_dx")).y, "bocca sotto gli occhi");
  assert.ok(P("capelli_dietro").order < t.order && P("ciuffo").order > P("occhio_dx").order, "ordine: capelli dietro in fondo, ciuffo davanti agli occhi");
});

test("jessica GPT: proporzioni dall'originale (distanza occhi, altezza)", () => {
  const u = Math.hypot(landmarks[2].x - landmarks[5].x, landmarks[2].y - landmarks[5].y);
  const e = Math.hypot(center(P("occhio_sx")).x - center(P("occhio_dx")).x, center(P("occhio_sx")).y - center(P("occhio_dx")).y);
  assert.ok(Math.abs(e - u) < 0.12 * u, `occhi a ${e.toFixed(0)} px, originale ${u.toFixed(0)}`);
  const top = Math.min(...r.pieces.map((q) => q.y)), bottom = Math.max(...r.pieces.map((q) => q.y + q.height));
  assert.ok(Math.abs(bottom - top - SIL_H) < 0.06 * SIL_H, `altezza ${bottom - top}, originale ${SIL_H}`);
});
