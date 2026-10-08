// SORRISO del metodo mesh (regola R9 di docs/REGOLE_MESH.md, zeus-mesh-8): avvocato (bocca all'ingiù,
// richiesta dell'utente dell'8 ott 2026 "come faccio a farlo sorridere") e Domatrice (labbra piene).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { recognizeParts, foregroundFromUniformBorder } from "../src/lib/partRecognition.js";
import { buildMeshRig, MESH_RIG_RULES } from "../src/lib/meshRig.js";
import { renderFrame } from "../scripts/renderSpine.mjs";
import { poseAt } from "../src/lib/animationSim.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/recognition");
function load(name, smile) {
  const D = path.join(root, name);
  const img = PNG.sync.read(fs.readFileSync(path.join(D, "image.png"))), W = img.width, H = img.height, rgba = img.data;
  const cat = PNG.sync.read(fs.readFileSync(path.join(D, "categories.png")));
  const categories = new Uint8Array(W * H), alpha = new Uint8Array(W * H);
  let hasAlpha = false;
  for (let i = 0; i < W * H; i++) { categories[i] = cat.data[i * 4]; alpha[i] = rgba[i * 4 + 3]; if (alpha[i] < 250) hasAlpha = true; }
  const landmarks = JSON.parse(fs.readFileSync(path.join(D, "landmarks.json"), "utf8")).landmarks.map(([x, y, v]) => ({ x, y, visibility: v }));
  const fgA = hasAlpha ? alpha : foregroundFromUniformBorder({ width: W, height: H, rgba, categories });
  const rec = recognizeParts({ width: W, height: H, landmarks, categories, alpha: fgA || undefined, rgba });
  const fg = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) fg[i] = fgA ? (fgA[i] >= 128 ? 1 : 0) : categories[i] ? 1 : 0;
  return { W, H, rgba, fg, landmarks, ...buildMeshRig({ width: W, height: H, rgba, fg, parts: rec.parts, categories, landmarks, joints: rec.joints }, { ...MESH_RIG_RULES, smile }) };
}
const avv = load("avvocato", "loop"), dom = load("domatrice", "loop");

test("S1 senza sorriso niente bocca (è una scelta: di serie la bocca resta quella del disegno)", () => {
  const r = load("avvocato", "no");
  assert.ok(!r.json.slots.some((s) => s.name === "bocca"));
  assert.ok(!r.json.bones.some((b) => b.name.startsWith("bocca_")));
});

test("S2 bocca trovata dai pixel: angoli sulla linea della bocca, larga quanto la bocca vera", () => {
  for (const [name, r, minW, maxW] of [["avvocato", avv, 38, 55], ["domatrice", dom, 34, 55]]) {
    const line = r.report.decision.find((d) => d.startsWith("bocca:"));
    assert.ok(line && !/posa|non trovata/.test(line), `${name}: ${line}`);
    const w = +line.match(/bocca (\d+) px/)[1];
    assert.ok(w >= minW && w <= maxW, `${name}: bocca ${w} px`);
  }
  assert.ok(/all'ingiù di (\d+) px/.test(avv.report.decision.join()), "l'avvocato ha la bocca all'ingiù");
  assert.ok(!/all'ingiù/.test(dom.report.decision.join()), "la Domatrice no (labbra piene, non è un broncio)");
});

test("S3 a riposo il pezzo della bocca coincide col corpo (nessuna differenza visibile)", () => {
  const { json, images } = avv;
  const noMouth = { ...json, slots: json.slots.filter((s) => s.name !== "bocca") };
  const a = renderFrame({ ...json, animations: { f: { bones: {} } } }, images, "f", 0, { scale: 1, bg: [255, 0, 255, 255] });
  const b = renderFrame({ ...noMouth, animations: { f: { bones: {} } } }, images, "f", 0, { scale: 1, bg: [255, 0, 255, 255] });
  let diff = 0;
  for (let i = 0; i < a.data.length; i += 4) if (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]) > 24) diff++;
  assert.ok(diff < 40, `${diff} pixel diversi`);
});

test("S4 nel sorriso gli angoli salgono rispetto al centro della bocca (e tornano a fine loop)", () => {
  for (const r of [avv, dom]) {
    const rel = (t) => { const w = poseAt(r.json, t, "ambient"); const v = w.viso; return ["bocca_sx", "bocca_dx"].map((n) => w[n].ty - v.ty); };
    const [s0, d0] = rel(0), [s1, d1] = rel(4.2), [s2, d2] = rel(MESH_RIG_RULES.loopSeconds);
    assert.ok(s1 - s0 > 3 && d1 - d0 > 3, `angoli saliti di ${(s1 - s0).toFixed(1)} e ${(d1 - d0).toFixed(1)} px`);
    assert.ok(Math.abs(s2 - s0) < 0.01 && Math.abs(d2 - d0) < 0.01, "il loop si chiude");
  }
});

test("S5 sorriso senza buchi: nessuna zona trasparente chiusa attorno alla bocca col sorriso", () => {
  const { json, images } = avv;
  const KEY = [255, 0, 255, 255], inside = (f, i) => !(f.data[i] === 255 && f.data[i + 1] === 0 && f.data[i + 2] === 255);
  const rest = renderFrame(json, images, "ambient", 0, { scale: 1, bg: KEY });
  const f = renderFrame(json, images, "ambient", 4.2, { scale: 1, bg: KEY });
  const w = f.width, h = f.height, out = new Uint8Array(w * h), q = [];
  for (let p = 0; p < w * h; p++) if (!inside(f, p * 4) && !inside(rest, p * 4)) { out[p] = 1; q.push(p); }
  for (let k = 0; k < q.length; k++) { const p = q[k], x = p % w, y = (p / w) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue; const j = Y * w + X; if (!out[j] && !inside(f, j * 4)) { out[j] = 1; q.push(j); } } }
  // zona della bocca nel fotogramma (scala 1: pixel = unità dello skeleton)
  const wp = poseAt(json, 4.2, "ambient"), sk = json.skeleton;
  const mx = (wp.bocca_sx.tx + wp.bocca_dx.tx) / 2 - sk.x, my = sk.y + sk.height - (wp.bocca_sx.ty + wp.bocca_dx.ty) / 2;
  const mw = Math.hypot(wp.bocca_sx.tx - wp.bocca_dx.tx, wp.bocca_sx.ty - wp.bocca_dx.ty);
  let holes = 0, bb = [w, h, 0, 0];
  for (let p = 0; p < w * h; p++) if (!out[p] && !inside(f, p * 4) && Math.hypot((p % w) - mx, ((p / w) | 0) - my) < 1.5 * mw) { holes++; const x = p % w, y = (p / w) | 0; bb = [Math.min(bb[0], x), Math.min(bb[1], y), Math.max(bb[2], x), Math.max(bb[3], y)]; }
  assert.ok(holes < 20, `${holes} pixel di buchi in ${bb}`);
});

test("S6 \"sempre\": sorriso tenuto per tutto il loop", () => {
  const r = load("avvocato", "sempre");
  const tl = r.json.animations.ambient.bones.bocca_sx.translate;
  assert.equal(tl.length, 2);
  assert.deepEqual([tl[0].x, tl[0].y], [tl[1].x, tl[1].y]);
});
