// Regole dalla tavola di Zeus corretta a mano dall'utente (3 ott 2026): capelli posteriori sempre
// separati, baffi in due metà, lembo con fibula = copertura della spalla figlia del busto.
// Sintetici a capsule (coordinate perfette).
import { test } from "node:test";
import assert from "node:assert/strict";
import { LM } from "../src/lib/partRecognition.js";
import { labelBackHair, labelFacePieces, facePivot, faceDefaults } from "../src/lib/faceRig.js";
import { shoulderCoverSide } from "../src/lib/explodedSheet.js";

const segDist = (px, py, a, b) => {
  const vx = b.x - a.x, vy = b.y - a.y, l2 = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, ((px - a.x) * vx + (py - a.y) * vy) / l2));
  return Math.hypot(px - (a.x + t * vx), py - (a.y + t * vy));
};
function piece(name, caps) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [a, b, r] of caps) {
    minX = Math.min(minX, a.x - r, b.x - r); maxX = Math.max(maxX, a.x + r, b.x + r);
    minY = Math.min(minY, a.y - r, b.y - r); maxY = Math.max(maxY, a.y + r, b.y + r);
  }
  const x0 = Math.floor(minX), y0 = Math.floor(minY), w = Math.ceil(maxX) - x0 + 1, h = Math.ceil(maxY) - y0 + 1;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) if (caps.some(([a, b, r]) => segDist(x + x0, y + y0, a, b) <= r)) rgba[(y * w + x) * 4 + 3] = 255;
  return { name, x: x0, y: y0, width: w, height: h, rgba, area: w * h };
}
const P = (x, y) => ({ x, y });
// testa centrata in (200,100), occhi distanti 40 px (u = 40); "sx" = lato a destra nell'immagine
const L = Array.from({ length: 33 }, () => null);
Object.assign(L, {
  [LM.nose]: P(200, 110), 2: P(220, 95), 5: P(180, 95), 7: P(250, 100), 8: P(150, 100), 9: P(215, 135), 10: P(185, 135),
  [LM.shoulderSx]: P(250, 190), [LM.shoulderDx]: P(150, 190), [LM.elbowSx]: P(280, 250), [LM.elbowDx]: P(120, 250),
  [LM.wristSx]: P(290, 310), [LM.wristDx]: P(110, 310), [LM.hipSx]: P(225, 330), [LM.hipDx]: P(175, 330)
});
const head = piece("testa", [[P(200, 100), P(200, 115), 52]]);

test("capelli dietro la testa: un pezzo capelli_dietro (genitore testa, vento, attaccatura in alto)", () => {
  const back = piece("?", [[P(170, 70), P(130, 175), 28]]); // ciuffo grande dietro la nuca, sporge a sinistra
  const found = labelBackHair([back], L, head);
  assert.equal(found.size, 1);
  assert.equal(back.name, "capelli_dietro");
  assert.deepEqual(faceDefaults(back.name), { role: "hair", animationType: "wind", speed: 0.8 });
  const pv = facePivot(back, head);
  assert.ok(pv.y < back.y + back.height / 3, "attaccatura in alto, sulla testa");
});

test("pezzo grande lontano dalla testa (lembo sul busto) NON diventa capelli_dietro", () => {
  const drape = piece("?", [[P(260, 200), P(290, 240), 25]]);
  assert.equal(labelBackHair([drape], L, head).size, 0);
});

test("baffi in due metà ai lati della bocca: baffo_sx e baffo_dx, sul lato giusto", () => {
  const mouth = piece("?", [[P(192, 136), P(208, 136), 7]]);
  const bSx = piece("?", [[P(212, 128), P(226, 150), 7]]);
  const bDx = piece("?", [[P(188, 128), P(174, 150), 7]]);
  labelFacePieces([mouth, bSx, bDx], L, head);
  assert.equal(mouth.name, "bocca");
  assert.equal(bSx.name, "baffo_sx");
  assert.equal(bDx.name, "baffo_dx");
});

test("lembo con fibula fra busto e spalla = copertura della spalla di quel lato", () => {
  const busto = piece("busto", [[P(200, 190), P(200, 330), 55]]);
  const armSx = piece("braccio_sx", [[L[LM.shoulderSx], L[LM.elbowSx], 16], [L[LM.elbowSx], L[LM.wristSx], 14]]);
  const armDx = piece("braccio_dx", [[L[LM.shoulderDx], L[LM.elbowDx], 16], [L[LM.elbowDx], L[LM.wristDx], 14]]);
  const drape = piece("accessorio", [[P(238, 180), P(262, 215), 16]]);
  assert.equal(shoulderCoverSide(drape, [busto, armSx, armDx, drape], L), "sx");
  const belt = piece("accessorio", [[P(170, 300), P(230, 300), 8]]); // solo sul busto
  assert.equal(shoulderCoverSide(belt, [busto, armSx, armDx, belt], L), null);
});
