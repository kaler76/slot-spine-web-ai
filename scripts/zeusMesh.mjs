// Prova "zeus mesh": Zeus in mesh pesata con tagli automatici (src/lib/meshRig.js).
// Uso: node scripts/zeusMesh.mjs [cartella] [moltiplicatore ampiezze]
// Scrive zeus_mesh.json / .atlas / <pezzo>.png (Spine 4.1) e i fotogrammi di controllo _frame_NN.png.
// Versione 1 (tutto mesh): git checkout zeus-mesh-1.
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import { recognizeParts, foregroundFromUniformBorder } from "../src/lib/partRecognition.js";
import { buildMeshRig, atlasFor, MESH_RIG_RULES } from "../src/lib/meshRig.js";
import { poseAt, attachmentGeometry, simulateLoop } from "../src/lib/animationSim.js";

const OUT = process.argv[2] || "prototipi/zeus_mesh_2";
const BOOST = Number(process.argv[3] || 1);
const D = "tests/fixtures/exploded/zeus/";
const o = PNG.sync.read(fs.readFileSync(D + "original.png")), W = o.width, H = o.height, rgba = o.data;
const c = PNG.sync.read(fs.readFileSync(D + "categorie.png"));
const categories = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) categories[i] = Math.round(c.data[i * 4] / 40);
const landmarks = JSON.parse(fs.readFileSync(D + "landmarks.json", "utf8")).landmarks.map(([x, y, v]) => ({ x, y, visibility: v }));
const alpha = foregroundFromUniformBorder({ width: W, height: H, rgba, categories });
const fg = Uint8Array.from(alpha, (a) => (a >= 0.5 ? 1 : 0));
const rec = recognizeParts({ width: W, height: H, landmarks, categories, alpha, rgba });
const rules = { ...MESH_RIG_RULES, amp: Object.fromEntries(Object.entries(MESH_RIG_RULES.amp).map(([k, v]) => [k, v * BOOST])) };
const { json, images, report } = buildMeshRig({ width: W, height: H, rgba, fg, parts: rec.parts, categories, landmarks, joints: rec.joints }, rules);

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "zeus_mesh.json"), JSON.stringify(json, null, 1));
fs.writeFileSync(path.join(OUT, "zeus_mesh.atlas"), atlasFor(images));
for (const [n, im] of Object.entries(images)) {
  const p = new PNG({ width: im.width, height: im.height });
  p.data = Buffer.from(im.rgba);
  fs.writeFileSync(path.join(OUT, n + ".png"), PNG.sync.write(p));
}
const sim = simulateLoop(json, { fps: 15, images });
console.log(JSON.stringify(report, null, 1), "\nsimulazione:", sim.ok ? "OK" : sim.problems.join(" | "));

// fotogrammi: tutti gli slot nell'ordine di disegno (12 del loop + 1 a occhi chiusi)
const sk = json.skeleton, sc = 0.5;
const fw = Math.round(sk.width * sc), fh = Math.round(sk.height * sc), off = { x: sk.width / 2, y: sk.height };
const times = [...Array.from({ length: 12 }, (_, f) => (f / 12) * MESH_RIG_RULES.loopSeconds), MESH_RIG_RULES.blinkAt + 0.133];
times.forEach((t, f) => {
  const world = poseAt(json, t, "ambient");
  const out = new PNG({ width: fw, height: fh });
  for (let i = 0; i < fw * fh; i++) { const x = i % fw, y = (i / fw) | 0; out.data.set(((x >> 4) + (y >> 4)) & 1 ? [70, 70, 80, 255] : [50, 50, 58, 255], i * 4); }
  for (const slot of json.slots) {
    const g = attachmentGeometry(json, world, slot), img = images[slot.name];
    if (!g || !img) continue;
    const P = g.verts.map((v) => ({ x: (v.x + off.x) * sc, y: (off.y - v.y) * sc }));
    for (let k = 0; k < g.tris.length; k += 3) {
      const [ia, ib, ic] = [g.tris[k], g.tris[k + 1], g.tris[k + 2]];
      const a = P[ia], b = P[ib], cc = P[ic];
      const A = (b.x - a.x) * (cc.y - a.y) - (cc.x - a.x) * (b.y - a.y);
      if (Math.abs(A) < 1e-9) continue;
      const minX = Math.max(0, Math.floor(Math.min(a.x, b.x, cc.x))), maxX = Math.min(fw - 1, Math.ceil(Math.max(a.x, b.x, cc.x)));
      const minY = Math.max(0, Math.floor(Math.min(a.y, b.y, cc.y))), maxY = Math.min(fh - 1, Math.ceil(Math.max(a.y, b.y, cc.y)));
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5, py = y + 0.5;
        const u = ((b.x - px) * (cc.y - py) - (cc.x - px) * (b.y - py)) / A;
        const v = ((cc.x - px) * (a.y - py) - (a.x - px) * (cc.y - py)) / A;
        const w = 1 - u - v;
        if (u < -1e-6 || v < -1e-6 || w < -1e-6) continue;
        const tu = u * g.uvs[ia * 2] + v * g.uvs[ib * 2] + w * g.uvs[ic * 2];
        const tv = u * g.uvs[ia * 2 + 1] + v * g.uvs[ib * 2 + 1] + w * g.uvs[ic * 2 + 1];
        const ix = Math.min(img.width - 1, Math.max(0, Math.round(tu * (img.width - 1))));
        const iy = Math.min(img.height - 1, Math.max(0, Math.round(tv * (img.height - 1))));
        const si = (iy * img.width + ix) * 4, al = img.rgba[si + 3] / 255;
        if (!al) continue;
        const oi = (y * fw + x) * 4;
        for (let ch = 0; ch < 3; ch++) out.data[oi + ch] = out.data[oi + ch] * (1 - al) + img.rgba[si + ch] * al;
      }
    }
  }
  fs.writeFileSync(path.join(OUT, `_frame_${String(f).padStart(2, "0")}.png`), PNG.sync.write(out));
});
