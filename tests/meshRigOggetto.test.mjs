// OGGETTO COMPLETATO (R13 di docs/REGOLE_MESH.md, zeus-mesh-10): Robin Hood, 9 ott 2026 — "l'arco si spezza, non è
// separato con la mano". Nel browser il riconoscimento aveva preso solo il tratto d'arco vicino alla mano (13709 px):
// il resto dell'arco restava nel corpo e si piegava. Caso: tests/fixtures/recognition/robin_arco (originale vero, posa
// dalle ossa del pacchetto, piece.png = pezzo tagliato nel browser; il seme dell'oggetto sono i suoi pixel color legno).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { recognizeParts, PART } from "../src/lib/partRecognition.js";
import { buildMeshRig, MESH_RIG_RULES } from "../src/lib/meshRig.js";
import { renderFrame } from "../scripts/renderSpine.mjs";

const D = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/recognition/robin_arco");
const im = PNG.sync.read(fs.readFileSync(path.join(D, "image.png"))), W = im.width, H = im.height, rgba = im.data;
const pc = PNG.sync.read(fs.readFileSync(path.join(D, "piece.png")));
const cat = PNG.sync.read(fs.readFileSync(path.join(D, "categories.png")));
const categories = new Uint8Array(W * H), alpha = new Uint8Array(W * H), fg = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) { categories[i] = cat.data[i * 4]; alpha[i] = rgba[i * 4 + 3]; fg[i] = alpha[i] >= 128 ? 1 : 0; }
const landmarks = JSON.parse(fs.readFileSync(path.join(D, "landmarks.json"), "utf8")).landmarks.map(([x, y, v]) => ({ x, y, visibility: v }));
const rec = recognizeParts({ width: W, height: H, landmarks, categories, alpha, rgba });
const hsv = (r, g, b) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0; if (d) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; } return [(h * 60 + 360) % 360, mx ? d / mx : 0, mx]; };
const hand = landmarks[16], parts = Uint8Array.from(rec.parts);
for (let i = 0; i < W * H; i++) {
  if (parts[i] === PART.oggetto_in_mano) parts[i] = PART.busto;
  if (pc.data[i * 4] <= 128) continue;
  const [h, s, v] = hsv(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]), x = i % W, y = (i / W) | 0;
  parts[i] = h > 28 && h < 55 && s > 0.45 && v > 90 && Math.hypot(x - hand.x, y - hand.y) > 25 ? PART.oggetto_in_mano : PART.avambraccio_dx;
}
const build = (rules) => buildMeshRig({ width: W, height: H, rgba, fg, parts: Uint8Array.from(parts), categories, landmarks, joints: rec.joints }, rules);
let fx0 = W, fy0 = H; for (let i = 0; i < W * H; i++) if (fg[i]) { fx0 = Math.min(fx0, i % W); fy0 = Math.min(fy0, (i / W) | 0); }
const ox = Math.max(0, fx0 - MESH_RIG_RULES.pad), oy = Math.max(0, fy0 - MESH_RIG_RULES.pad);
const pieceMask = ({ json, images }) => {
  const only = { ...json, slots: json.slots.filter((s) => s.name === "braccio_dx"), animations: { f: { bones: {} } } };
  const f = renderFrame(only, images, "f", 0, { scale: 1, bg: [255, 0, 255, 255] }), m = new Uint8Array(W * H);
  for (let y = 0; y < f.height; y++) for (let x = 0; x < f.width; x++) { const i = (y * f.width + x) * 4; if (!(f.data[i] === 255 && f.data[i + 1] === 0 && f.data[i + 2] === 255)) m[(y + oy) * W + x + ox] = 1; }
  return m;
};
// arco: estremi in alto e in basso (pixel color legno sopra e sotto il pugno, a sinistra del corpo)
const count = (m, y0, y1, x0, x1) => { let n = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) n += m[y * W + x]; return n; };

test("B1 arco intero nel pezzo della mano: punta in alto e punta in basso comprese", () => {
  const r = build(MESH_RIG_RULES), m = pieceMask(r);
  assert.ok(r.report.decision.some((d) => /oggetto_dx: completato/.test(d)), r.report.decision.join(" | "));
  const top = count(m, 40, 320, 300, 470), bottom = count(m, Math.round(hand.y + 200), 1000, 360, 480);
  assert.ok(top > 2500, `arco sopra la mano nel pezzo: ${top} px`);
  assert.ok(bottom > 1500, `arco sotto la mano nel pezzo: ${bottom} px`);
});

test("B2 la crescita non scende nello stivale né entra nel corpo a destra dell'arco", () => {
  const m = pieceMask(build(MESH_RIG_RULES));
  // limite noto: il risvolto dello stivale toccato dalla punta dell'arco (stesso marrone) entra in parte nel pezzo;
  // nell'app la categoria del segmentatore ("vestiti" ≠ "accessori") lo esclude, qui le categorie sono grezze
  assert.ok(count(m, 1015, H, 0, W) < 100, `pezzo dentro lo stivale: ${count(m, 1015, H, 0, W)} px`);
  assert.ok(count(m, 0, H, 540, W) < 300, `pezzo sul corpo a destra dell'arco: ${count(m, 0, H, 540, W)} px`);
});

test("B3 senza completamento (regola spenta) l'arco resta spezzato: il caso è davvero quello del difetto", () => {
  const m = pieceMask(build({ ...MESH_RIG_RULES, objectGrow: false }));
  const top = count(m, 40, 320, 300, 470);
  assert.ok(top < 1000, `arco sopra la mano senza completamento: ${top} px`);
});

test("B4 niente macchie di riempimento accanto all'oggetto fuori dal corpo (punta dell'arco vicino alla corda)", () => {
  const { images } = build(MESH_RIG_RULES), c = images.corpo;
  // zona della punta alta dell'arco: dopo il taglio nel corpo resta solo la corda (~500 px); prima della correzione
  // c'era anche la macchia di riempimento (~1500 px)
  let n = 0;
  for (let y = 115; y < 200; y++) for (let x = 360; x < 440; x++) { const cx = x - ox, cy = y - oy; if (cx < 0 || cy < 0 || cx >= c.width || cy >= c.height) continue; if (c.rgba[(cy * c.width + cx) * 4 + 3] > 128) n++; }
  assert.ok(n < 800, `pixel del corpo attorno alla punta dell'arco: ${n} (solo la corda)`);
});

test("B5 oggetto FERMO (maschera block): arco e mano identici in tutto il loop, anche senza completamento", () => {
  for (const objectGrow of [true, false]) {
    const r = build({ ...MESH_RIG_RULES, lockObject: true, objectGrow });
    assert.ok(r.report.decision.some((d) => /oggetto FERMO/.test(d)));
    const fr = (t) => renderFrame(r.json, r.images, "ambient", t, { scale: 1, bg: [0, 0, 0, 255] });
    const a = fr(0);
    for (const t of [1.5, 3, 4.5]) {
      const b = fr(t);
      // zona dell'arco (a sinistra del corpo, dalla punta alta a quella bassa): pixel cambiati ≤ 1%
      let n = 0, d = 0;
      for (let y = 40 - oy; y < 1000 - oy; y++) for (let x = 300 - ox; x < 420 - ox; x++) { if (x < 0 || y < 0 || x >= a.width || y >= a.height) continue; const i = (y * a.width + x) * 4; if (a.data[i] + a.data[i + 1] + a.data[i + 2] < 30) continue; n++; if (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]) > 30) d++; }
      // senza completamento resta mobile solo un tratto di corda vicino alla punta alta
      assert.ok(d / n < (objectGrow ? 0.01 : 0.03), `objectGrow=${objectGrow}, t=${t}: ${((100 * d) / n).toFixed(2)}% dei pixel dell'arco cambiati`);
    }
  }
});
