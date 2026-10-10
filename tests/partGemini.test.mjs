// PEZZO SEPARATO CON GEMINI (R22, zeus-mesh-14): maschera dalla differenza originale ↔ risposta di Gemini.
// Scena sintetica: corpo a righe (texture), braccio viola col contorno scuro sopra il corpo e fuori dalla sagoma.
// La "risposta di Gemini" è il corpo senza braccio su fondo magenta, spostata, ingrandita, coi colori cambiati e rumore:
// la maschera deve coincidere col braccio e la piastra non deve uscire dalla sagoma del corpo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { armCropBox, armPartFromGemini, flattenOnKey, PART_KEY } from "../src/lib/partGemini.js";

const W = 900, H = 700;
const sh = { x: 520, y: 330 }, el = { x: 640, y: 420 }, wr = { x: 660, y: 230 }, hd = { x: 665, y: 180 }, shoulderW = 200;
const segD = (x, y, a, b) => { const vx = b.x - a.x, vy = b.y - a.y, l2 = vx * vx + vy * vy, t = Math.max(0, Math.min(1, ((x - a.x) * vx + (y - a.y) * vy) / l2)); return Math.hypot(x - a.x - vx * t, y - a.y - vy * t); };
const armD = (x, y) => Math.min(segD(x, y, sh, el) - 30, segD(x, y, el, wr) - 26, segD(x, y, wr, hd) - 32);
const inBody = (x, y) => ((x - 450) / 170) ** 2 + ((y - 420) / 300) ** 2 <= 1 || ((x - 450) / 70) ** 2 + ((y - 120) / 80) ** 2 <= 1;
const bodyCol = (x, y) => (Math.floor(y / 6) % 2 ? [200, 40, 40] : [230, 90, 70]).map((c, k) => c + ((x * 7 + y * 13 + k * 5) % 23) - 11);
const orig = new Uint8ClampedArray(W * H * 4), truth = new Uint8Array(W * H);
const bodyOnly = new Uint8ClampedArray(W * H * 4);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = (y * W + x) * 4;
  if (inBody(x, y)) { orig.set([...bodyCol(x, y), 255], i); bodyOnly.set([...bodyCol(x, y), 255], i); }
  const d = armD(x, y);
  if (d <= 0) { orig.set(d > -3 ? [30, 10, 40, 255] : [120 + (y % 9), 40, 170, 255], i); truth[y * W + x] = 1; }
}

function geminiLike(box) {
  // ritaglio del corpo senza braccio, fondo magenta, poi ingrandito 2% e spostato (6, -4), colori +6% e rumore
  const w = box.width, h = box.height, src = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const X = x + box.x0, Y = y + box.y0, i = (y * w + x) * 4;
    if (X >= 0 && Y >= 0 && X < W && Y < H && bodyOnly[(Y * W + X) * 4 + 3]) src.set(bodyOnly.subarray((Y * W + X) * 4, (Y * W + X) * 4 + 4), i);
    else src.set([...PART_KEY, 255], i);
  }
  const out = new Uint8ClampedArray(w * h * 4); let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5) * 20;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    // risposta(g) = sorgente((g - centro - spost.) / s + centro)
    const sx = Math.round((x - w / 2 - 6) / 1.02 + w / 2), sy = Math.round((y - h / 2 + 4) / 1.02 + h / 2), i = (y * w + x) * 4;
    const j = (Math.min(h - 1, Math.max(0, sy)) * w + Math.min(w - 1, Math.max(0, sx))) * 4;
    const key = src[j] === 255 && src[j + 1] === 0 && src[j + 2] === 255;
    for (let k = 0; k < 3; k++) out[i + k] = key ? src[j + k] : src[j + k] * 1.06 + rnd();
    out[i + 3] = 255;
  }
  return out;
}

const arm = { sh, el, wr, hd, shoulderW };
const box = armCropBox(arm);
const crop = new Uint8ClampedArray(box.width * box.height * 4);
for (let y = 0; y < box.height; y++) for (let x = 0; x < box.width; x++) { const X = x + box.x0, Y = y + box.y0; if (X >= 0 && Y >= 0 && X < W && Y < H) crop.set(orig.subarray((Y * W + X) * 4, (Y * W + X) * 4 + 4), (y * box.width + x) * 4); }

test("G1 riquadro 16:9 che contiene tutto il braccio", () => {
  assert.ok(Math.abs(box.width / box.height - 16 / 9) < 0.01);
  for (const p of [sh, el, wr, hd]) assert.ok(p.x > box.x0 && p.x < box.x0 + box.width && p.y > box.y0 && p.y < box.y0 + box.height);
  const f = flattenOnKey(crop); assert.equal(f[3], 255);
});

test("G2 maschera = braccio (IoU ≥ 0,9), piastra dentro la sagoma del corpo", () => {
  const r = armPartFromGemini({ orig: crop, gen: geminiLike(box), box, arm, W, H });
  assert.equal(r.error, null, JSON.stringify(r.checks));
  let inter = 0, uni = 0, plateOut = 0, plateIn = 0, under = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const g = y * W + x, a = r.mask[g], b = truth[g];
    if (a && b) inter++; if (a || b) uni++;
    if (r.plate[g * 4 + 3] > 128) { if (inBody(x, y)) plateIn++; else plateOut++; }
    if (b && inBody(x, y)) under++;
  }
  assert.ok(inter / uni >= 0.9, `IoU ${(inter / uni).toFixed(3)}`);
  assert.ok(plateOut <= 0.03 * plateIn, `piastra fuori ${plateOut} / dentro ${plateIn}`);
  assert.ok(plateIn >= 0.85 * under, `dietro il braccio ridisegnato ${plateIn} di ${under}`);
});

test("G3 Gemini che non toglie il braccio o cambia tutto: errore (si torna al metodo senza AI)", () => {
  const same = flattenOnKey(crop);
  assert.match(armPartFromGemini({ orig: crop, gen: same, box, arm, W, H }).error, /non ha tolto/);
  let sd = 3; const noise = new Uint8ClampedArray(crop.length); for (let i = 0; i < noise.length; i++) noise[i] = (sd = (sd * 1103515245 + 12345) & 0x7fffffff) >> 23;
  assert.ok(armPartFromGemini({ orig: crop, gen: noise, box, arm, W, H }).error);
});
