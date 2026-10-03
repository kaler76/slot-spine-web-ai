// Regola "mano e oggetto lungo in un unico pezzo" (src/lib/handObject.js), decisione 3 ott 2026.
// Personaggio sintetico con sagome a capsula: braccio destro (a sinistra nell'immagine) che
// finisce al polso + blocco mano+bastone; braccio sinistro con la mano aperta.
import { test } from "node:test";
import assert from "node:assert/strict";
import { LM } from "../src/lib/partRecognition.js";
import { applyHandObjects, handObjectRig, checkHandObjects, HAND_OBJECT_RULE_VERSION } from "../src/lib/handObject.js";
import { piecesToCharacterParts } from "../src/lib/characterFromPieces.js";
import { MAX_PIECES } from "../src/lib/explodedSheet.js";

const segDist = (px, py, a, b) => {
  const vx = b.x - a.x, vy = b.y - a.y, l2 = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, ((px - a.x) * vx + (py - a.y) * vy) / l2));
  return Math.hypot(px - (a.x + t * vx), py - (a.y + t * vy));
};
/** Pezzo dall'unione di capsule [a, b, raggio], ritagliato al riquadro. */
function piece(name, caps) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [a, b, r] of caps) {
    minX = Math.min(minX, a.x - r, b.x - r); maxX = Math.max(maxX, a.x + r, b.x + r);
    minY = Math.min(minY, a.y - r, b.y - r); maxY = Math.max(maxY, a.y + r, b.y + r);
  }
  const x0 = Math.floor(minX), y0 = Math.floor(minY), w = Math.ceil(maxX) - x0 + 1, h = Math.ceil(maxY) - y0 + 1;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (caps.some(([a, b, r]) => segDist(x + x0, y + y0, a, b) <= r)) rgba.set([180, 120, 80, 255], (y * w + x) * 4);
  return { name, x: x0, y: y0, width: w, height: h, rgba, area: w * h, order: 0 };
}
const P = (x, y) => ({ x, y });

function scene({ armReachesWrist = true, armWithHand = false, shortObject = false, fragment = false } = {}) {
  const L = Array.from({ length: 33 }, () => null);
  Object.assign(L, {
    [LM.nose]: P(200, 80), 2: P(215, 70), 5: P(185, 70),
    [LM.shoulderDx]: P(150, 150), [LM.elbowDx]: P(120, 220), [LM.wristDx]: P(110, 280),
    [LM.indexDx]: P(108, 296), [LM.pinkyDx]: P(116, 294), [LM.thumbDx]: P(100, 288),
    [LM.shoulderSx]: P(250, 150), [LM.elbowSx]: P(280, 220), [LM.wristSx]: P(290, 280),
    [LM.indexSx]: P(292, 296), [LM.pinkySx]: P(284, 294), [LM.thumbSx]: P(300, 288),
    [LM.hipDx]: P(175, 300), [LM.hipSx]: P(225, 300)
  });
  const wrist = L[LM.wristDx], elbow = L[LM.elbowDx];
  const k = armReachesWrist ? 6 / 61 : 30 / 61; // il braccio finisce poco (o molto) prima del polso
  const armEnd = armWithHand ? P(110, 294) : P(wrist.x + (elbow.x - wrist.x) * k, wrist.y + (elbow.y - wrist.y) * k);
  const pieces = [
    piece("testa", [[P(200, 80), P(200, 80), 40]]),
    piece("busto", [[P(200, 160), P(200, 300), 45]]),
    piece("braccio_dx", [[L[LM.shoulderDx], elbow, 12], [elbow, armEnd, 10]]),
    piece("braccio_sx", [[L[LM.shoulderSx], L[LM.elbowSx], 12], [L[LM.elbowSx], P(290, 294), 11]]),
    piece("oggetto", [[wrist, P(110, 293), 12], shortObject ? [P(100, 285), P(120, 305), 8] : [P(80, 190), P(140, 390), 7]])
  ];
  if (fragment) pieces.push(piece("oggetto_2", [[P(145, 395), P(150, 400), 4]]));
  return { L, pieces };
}

test("mano che impugna un oggetto lungo = un solo pezzo mano_oggetto_dx, figlio del braccio, pivot al polso", () => {
  const { L, pieces } = scene();
  const found = applyHandObjects(pieces, L);
  assert.equal(found.length, 1);
  const b = pieces.find((p) => p.handObject);
  assert.equal(b.name, "mano_oggetto_dx");
  assert.equal(b.handObject.version, HAND_OBJECT_RULE_VERSION);
  assert.equal(b.motionLocked, true);
  assert.deepEqual(handObjectRig(b, L), { parent: "braccio_dx", pivot: { x: 110, y: 280 } });
  assert.deepEqual(checkHandObjects(pieces, L), []);
  assert.ok(pieces.length <= MAX_PIECES); // mano + oggetto contano UN pezzo
});

test("blocco mano+oggetto nel character: ruolo mano, nessuna animazione propria (eredita il braccio)", () => {
  const { L, pieces } = scene();
  applyHandObjects(pieces, L);
  const rig = { busto: [null, P(200, 300)], testa: ["busto", P(200, 120)], braccio_dx: ["busto", L[LM.shoulderDx]], braccio_sx: ["busto", L[LM.shoulderSx]] };
  for (const p of pieces) {
    const r = p.handObject ? handObjectRig(p, L) : { parent: rig[p.name][0], pivot: rig[p.name][1] };
    Object.assign(p, r);
  }
  const part = piecesToCharacterParts(pieces).parts.find((q) => q.partKey === "mano_oggetto_dx");
  assert.equal(part.parentKey, "braccio_dx");
  assert.equal(part.role, "hand");
  assert.equal(part.animationType, "static");
});

test("oggetto corto in mano (sacchetto): resta un oggetto separato, regola non applicata", () => {
  const { L, pieces } = scene({ shortObject: true });
  assert.equal(applyHandObjects(pieces, L).length, 0);
  assert.ok(pieces.some((p) => p.name === "oggetto"));
});

test("controllo: mano rimasta anche sul braccio = mano duplicata", () => {
  const { L, pieces } = scene({ armWithHand: true });
  applyHandObjects(pieces, L);
  assert.match(checkHandObjects(pieces, L).join(" "), /mano duplicata/);
});

test("controllo: braccio che finisce lontano dal polso = raccordo scoperto", () => {
  const { L, pieces } = scene({ armReachesWrist: false });
  applyHandObjects(pieces, L);
  assert.match(checkHandObjects(pieces, L).join(" "), /polso scoperto/);
});

test("controllo: frammento dell'oggetto rimasto come pezzo separato", () => {
  const { L, pieces } = scene({ fragment: true });
  applyHandObjects(pieces, L);
  assert.match(checkHandObjects(pieces, L).join(" "), /frammento/);
});
