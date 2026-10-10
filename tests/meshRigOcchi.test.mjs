// OCCHI (R12 di docs/REGOLE_MESH.md, zeus-mesh-9.3): a occhio chiuso non si vede né il bianco né la pupilla,
// anche con iride castana e bianco in ombra (avvocato), trucco scuro attorno all'occhio (Domatrice) e iride VERDE
// con il punto della posa di lato all'occhio (Robin Hood, approvato "perfetto" il 9 ott); iride OLIVA e posa a mano
// a mezzo busto, occhi stimati e cercati nel viso (Rita, 10 ott: "non chiude gli occhi").
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
for (const [name, maxVisible] of [["avvocato", 25], ["domatrice", 25], ["robin", 25], ["rita", 40]]) {
  test(`O1 ${name}: occhio chiuso senza bianco né pupilla visibili; occhi aperti col bianco`, () => {
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
    const { json, images } = buildMeshRig({ width: W, height: H, rgba, fg, parts: rec.parts, categories, landmarks, joints: rec.joints });
    const im = structuredClone(images);
    for (const k of ["bianco_sx", "bianco_dx", "pupilla_sx", "pupilla_dx"]) { const a = im[k].rgba; for (let i = 0; i < a.length; i += 4) if (a[i + 3]) a.set([255, 0, 255, 255], i); }
    const count = (t) => { const f = renderFrame(json, im, "ambient", t, { scale: 1, bg: [0, 0, 0, 255] }); let n = 0; for (let i = 0; i < f.data.length; i += 4) if (f.data[i] === 255 && f.data[i + 1] === 0 && f.data[i + 2] === 255) n++; return n; };
    assert.ok(count(0) > 150, "a occhi aperti il bianco e la pupilla si vedono");
    const closed = count(MESH_RIG_RULES.blinkAt + 0.133);
    assert.ok(closed <= maxVisible, `a occhio chiuso si vedono ancora ${closed} pixel di bianco/pupilla`);
    // iride a cerchio (Rita, 10 ott: "righe negli occhi"): sguardo fermo, nel loop il bianco non si scopre
    if (name === "rita") {
      for (const s of ["sx", "dx"]) assert.equal(json.animations.ambient.bones[`pupilla_${s}`].translate.every((k) => !k.x && !k.y), true, `pupilla_${s} ferma`);
    }
  });
}
