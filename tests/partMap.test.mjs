// Pezzi dalla MAPPA DELLE PARTI (src/lib/partMap.js): personaggio sintetico, mappa come la
// restituirebbe Gemini (spostata, in scala diversa, colori non perfetti).
import { test } from "node:test";
import assert from "node:assert/strict";
import { piecesFromPartMap, PART_COLORS } from "../src/lib/partMap.js";
import { composePieces } from "../src/lib/partExtraction.js";

const W = 300, H = 400;
const segDist = (px, py, a, b) => {
  const vx = b.x - a.x, vy = b.y - a.y, l2 = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, ((px - a.x) * vx + (py - a.y) * vy) / l2));
  return Math.hypot(px - (a.x + t * vx), py - (a.y + t * vy));
};
const P = (x, y) => ({ x, y });
// parti in ordine di disegno (l'ultima copre le precedenti)
const SHAPES = [
  ["capelli_dietro", [[P(150, 60), P(150, 140), 45]], [150, 90, 40]],
  ["busto", [[P(150, 140), P(150, 330), 42]], [40, 160, 60]],
  ["braccio_dx", [[P(110, 150), P(70, 260), 13]], [220, 170, 140]],
  ["braccio_sx", [[P(190, 150), P(230, 260), 13]], [210, 160, 130]],
  ["testa", [[P(150, 80), P(150, 105), 34]], [235, 190, 160]],
  ["occhio", [[P(137, 80), P(137, 80), 5]], [40, 120, 60]],
  ["occhio", [[P(163, 80), P(163, 80), 5]], [40, 120, 60]],
  ["bocca", [[P(143, 106), P(157, 106), 4]], [200, 30, 40]],
  ["oggetto", [[P(70, 260), P(55, 360), 6]], [120, 90, 20]]
];
const original = { width: W, height: H, rgba: new Uint8ClampedArray(W * H * 4) };
const truth = new Int8Array(W * H).fill(-1);
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    const i = y * W + x;
    original.rgba[i * 4 + 3] = 255; // sfondo nero opaco
    SHAPES.forEach(([part, caps, col], k) => {
      if (caps.some(([a, b, r]) => segDist(x, y, a, b) <= r)) {
        original.rgba.set([...col.map((v) => v + ((x * 7 + y * 3) % 9)), 255], i * 4);
        truth[i] = k;
      }
    });
  }
// mappa: scala 0.8, spostata di (20, 15), colori della palette con rumore
const map = { width: 280, height: 360, rgba: new Uint8ClampedArray(280 * 360 * 4) };
for (let y = 0; y < 360; y++)
  for (let x = 0; x < 280; x++) {
    const ox = Math.round((x - 20) / 0.8), oy = Math.round((y - 15) / 0.8);
    const j = (y * 280 + x) * 4;
    map.rgba[j + 3] = 255;
    if (ox < 0 || oy < 0 || ox >= W || oy >= H) continue;
    const k = truth[oy * W + ox];
    if (k < 0) continue;
    const c = PART_COLORS.find((c) => c.part === SHAPES[k][0]).rgb;
    map.rgba.set(c.map((v) => Math.max(0, Math.min(255, v + ((x + y) % 25) - 12))), j);
  }
const fg = Uint8Array.from(truth, (v) => (v >= 0 ? 1 : 0));
const r = piecesFromPartMap({ map, original, fg });

test("mappa allineata (scala e spostamento) e personaggio coperto tutto", () => {
  assert.ok(Math.abs(r.transform.s - 1.25) < 0.03, `scala ${r.transform.s}`);
  assert.ok(r.transform.iou > 0.95, `IoU ${r.transform.iou}`);
  assert.ok(r.coverage > 0.999);
});

test("nomi dal colore, lati del personaggio per gli occhi, genitori dai contatti", () => {
  const names = r.pieces.map((p) => p.name).sort();
  assert.deepEqual(names, ["bocca", "braccio_dx", "braccio_sx", "busto", "capelli_dietro", "occhio_dx", "occhio_sx", "oggetto", "testa"]);
  const by = Object.fromEntries(r.pieces.map((p) => [p.name, p]));
  assert.ok(by.occhio_sx.pivot.x > by.occhio_dx.pivot.x, "occhio_sx a destra per chi guarda");
  assert.equal(by.testa.parent, "busto");
  assert.equal(by.braccio_dx.parent, "busto");
  assert.equal(by.occhio_sx.parent, "testa");
  assert.equal(by.capelli_dietro.parent, "testa");
  assert.equal(by.oggetto.parent, "braccio_dx", "l'oggetto è figlio del braccio che lo tocca");
  // pivot della spalla: sul contatto braccio/busto, vicino alla spalla vera
  assert.ok(Math.hypot(by.braccio_dx.pivot.x - 110, by.braccio_dx.pivot.y - 160) < 25, JSON.stringify(by.braccio_dx.pivot));
  assert.ok(by.testa.pivot.y > 105 && by.testa.pivot.y < 135, `collo ${by.testa.pivot.y}`);
});

test("ricomposizione identica all'originale e zone nascoste riempite", () => {
  const C = composePieces(r.pieces, W, H);
  let n = 0, diff = 0;
  for (let i = 0; i < W * H; i++) {
    if (!fg[i]) continue;
    n++;
    let d = 0;
    for (let k = 0; k < 3; k++) d += Math.abs(C[i * 4 + k] - original.rgba[i * 4 + k]);
    if (C[i * 4 + 3] < 128 || d > 30) diff++;
  }
  assert.ok(diff / n < 0.01, `pixel diversi ${((diff / n) * 100).toFixed(2)}%`);
  // il busto si estende sotto la testa (collo nascosto): pixel opachi dove c'è la testa
  const busto = r.pieces.find((p) => p.name === "busto");
  const a = (x, y) => busto.rgba[((y - busto.y) * busto.width + (x - busto.x)) * 4 + 3];
  assert.ok(a(150, 125) > 0, "busto sotto il collo");
});
