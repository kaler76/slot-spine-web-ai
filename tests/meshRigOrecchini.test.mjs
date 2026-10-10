// ORECCHINI PENDENTI (zeus-mesh-13.6, Rita 10 ott: "questi orecchini non si possono far muovere?"). Pezzo davanti al
// corpo sull'osso orecchino (figlio della testa) che oscilla come un pendolo; nessun falso orecchino su chi non ne ha
// (ciocche ramate della Domatrice, capelli grigi dell'avvocato).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { recognizeParts, foregroundFromUniformBorder } from "../src/lib/partRecognition.js";
import { buildMeshRig, MESH_RIG_RULES } from "../src/lib/meshRig.js";
import { renderFrame } from "../scripts/renderSpine.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/recognition");
function load(name) {
  const D = path.join(root, name);
  const img = PNG.sync.read(fs.readFileSync(path.join(D, "image.png"))), W = img.width, H = img.height, rgba = img.data;
  const cat = PNG.sync.read(fs.readFileSync(path.join(D, "categories.png")));
  const categories = new Uint8Array(W * H), alpha = new Uint8Array(W * H);
  let hasA = false;
  for (let i = 0; i < W * H; i++) { categories[i] = cat.data[i * 4]; alpha[i] = rgba[i * 4 + 3]; if (alpha[i] < 250) hasA = true; }
  const landmarks = JSON.parse(fs.readFileSync(path.join(D, "landmarks.json"), "utf8")).landmarks.map(([x, y, v]) => ({ x, y, visibility: v }));
  const fgA = hasA ? alpha : foregroundFromUniformBorder({ width: W, height: H, rgba, categories });
  const rec = recognizeParts({ width: W, height: H, landmarks, categories, alpha: fgA || undefined, rgba });
  const fg = Uint8Array.from(fgA, (a) => (a >= 128 ? 1 : 0));
  return { W, H, rgba, input: { width: W, height: H, rgba, fg, parts: rec.parts, categories, landmarks, joints: rec.joints } };
}

test("R1 Rita: due orecchini pendenti, davanti al corpo, sull'osso orecchino figlio della testa, che oscillano", () => {
  const { json, report } = buildMeshRig(load("rita").input);
  for (const s of ["sx", "dx"]) {
    assert.ok(report.decision.some((d) => d.startsWith(`orecchino_${s}: PENDENTE`)), report.decision.join(" | "));
    const b = json.bones.find((x) => x.name === `orecchino_${s}`);
    assert.equal(b.parent, "testa");
    assert.ok(json.slots.findIndex((x) => x.name === `orecchino_${s}`) > json.slots.findIndex((x) => x.name === "corpo"));
    const rot = json.animations.ambient.bones[`orecchino_${s}`].rotate.map((k) => k.value);
    assert.ok(Math.max(...rot) - Math.min(...rot) >= 10, "oscillazione visibile");
  }
});

test("R2 Rita a riposo: con gli orecchini staccati l'immagine è la stessa di senza (pezzo esatto, niente buchi)", () => {
  const { input } = load("rita");
  const still = (r) => renderFrame({ ...r.json, animations: { f: { bones: {} } } }, r.images, "f", 0, { scale: 1, bg: [0, 0, 0, 255] });
  const a = still(buildMeshRig(input)), b = still(buildMeshRig(input, { ...MESH_RIG_RULES, cuts: { ...MESH_RIG_RULES.cuts, earrings: false } }));
  assert.equal(a.width, b.width);
  let d = 0; for (let i = 0; i < a.data.length; i += 4) if (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]) > 30) d++;
  assert.ok(d < 0.001 * a.width * a.height, `${d} pixel diversi a riposo`);
});

for (const name of ["domatrice", "robin", "avvocato"]) {
  test(`R3 ${name}: nessun orecchino inventato`, () => {
    const { report } = buildMeshRig(load(name).input);
    assert.ok(report.decision.includes("orecchini: nessuno pendente"), report.decision.join(" | "));
  });
}
