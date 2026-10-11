// TESTA RIGIDA (zeus-mesh-14.6, Avventuriero 11 ott: "il volto con l'oscillamento non dovrebbe deformarsi"): se il
// riconoscimento lascia viso e cappello come "busto", la testa va comunque tutta sulle ossa della testa.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { recognizeParts, PART } from "../src/lib/partRecognition.js";
import { buildMeshRig, MESH_RIG_RULES } from "../src/lib/meshRig.js";

const D = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/recognition/jessica");
const img = PNG.sync.read(fs.readFileSync(path.join(D, "image.png"))), W = img.width, H = img.height, rgba = img.data;
const cat = PNG.sync.read(fs.readFileSync(path.join(D, "categories.png")));
const categories = new Uint8Array(W * H), alpha = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) { categories[i] = cat.data[i * 4]; alpha[i] = rgba[i * 4 + 3]; }
const landmarks = JSON.parse(fs.readFileSync(path.join(D, "landmarks.json"), "utf8")).landmarks.map(([x, y, v]) => ({ x, y, visibility: v }));
const rec = recognizeParts({ width: W, height: H, landmarks, categories, alpha, rgba });
const fg = Uint8Array.from(alpha, (a) => (a >= 128 ? 1 : 0));
// riconoscimento "sbagliato": testa e cappello etichettati come busto
const parts = Uint8Array.from(rec.parts, (p) => (p === PART.testa || p === PART.cappello ? PART.busto : p));

test("T1 testa riconosciuta come corpo: i vertici del viso restano sulle ossa della testa (≥ 90%)", () => {
  const { json, report } = buildMeshRig({ width: W, height: H, rgba, fg, parts, categories, landmarks, joints: rec.joints });
  assert.ok(report.decision.some((d) => /^testa: /.test(d)), report.decision.join(" | "));
  const names = json.bones.map((b) => b.name), at = json.skins[0].attachments.corpo.corpo, V = at.vertices, n = at.uvs.length / 2;
  // vertici del viso dalla fronte alla bocca (sotto: mento e collo, dove la sfumatura è giusta)
  const nose = landmarks[0], sw = Math.hypot(landmarks[11].x - landmarks[12].x, landmarks[11].y - landmarks[12].y);
  let x0 = W, y0 = H; for (let i = 0; i < W * H; i++) if (fg[i]) { x0 = Math.min(x0, i % W); y0 = Math.min(y0, (i / W) | 0); }
  x0 = Math.max(0, x0 - MESH_RIG_RULES.pad); y0 = Math.max(0, y0 - MESH_RIG_RULES.pad);
  let k = 0, cnt = 0, bad = 0;
  for (let i = 0; i < n; i++) {
    const c = V[k++]; let head = 0;
    for (let j = 0; j < c; j++) { const b = names[V[k++]]; k += 2; const w = V[k++]; if (/^(testa|viso|occhio|palpebra|pupilla)/.test(b)) head += w; }
    const px = at.uvs[2 * i] * at.width, py = at.uvs[2 * i + 1] * at.height;
    if (Math.abs(px - (nose.x - x0)) < 0.35 * sw && py - (nose.y - y0) > -0.35 * sw && py - (nose.y - y0) < 0.15 * sw) { cnt++; if (head < 0.9) { bad++; if (process.env.TDBG) console.log("V", Math.round(px - nose.x + x0), Math.round(py - nose.y + y0), head.toFixed(2)); } }
  }
  assert.ok(cnt >= 5, `vertici vicini al naso: ${cnt}`);
  assert.ok(bad <= 0.1 * cnt, `vertici del viso non sulla testa: ${bad} di ${cnt}`);
});
