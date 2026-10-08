// Prototipo "zeus mesh 1": Zeus intero in mesh pesata (src/lib/meshRig.js).
// Uso: node scripts/zeusMesh1.mjs [cartella di uscita] [moltiplicatore ampiezze per la prova]
// Scrive zeus_mesh_1.json / .atlas / .png (da aprire in Spine 4.1) e i fotogrammi di controllo.
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import { recognizeParts, foregroundFromUniformBorder } from "../src/lib/partRecognition.js";
import { buildMeshRig, atlasFor, MESH_RIG_RULES } from "../src/lib/meshRig.js";
import { poseAt, attachmentGeometry, simulateLoop } from "../src/lib/animationSim.js";

const OUT = process.argv[2] || "prototipi/zeus_mesh_1";
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
const { json, image, report } = buildMeshRig({ width: W, height: H, rgba, fg, parts: rec.parts, landmarks, joints: rec.joints }, rules);

fs.mkdirSync(OUT, { recursive: true });
const base = path.join(OUT, "zeus_mesh_1");
fs.writeFileSync(base + ".json", JSON.stringify(json, null, 1));
fs.writeFileSync(base + ".atlas", atlasFor("zeus_mesh_1.png", image.width, image.height));
const png = new PNG({ width: image.width, height: image.height });
png.data = Buffer.from(image.rgba);
fs.writeFileSync(base + ".png", PNG.sync.write(png));

const sim = simulateLoop(json, { fps: 15, images: { personaggio: image } });
console.log(JSON.stringify(report), "\nsimulazione:", sim.ok ? "OK" : sim.problems.join(" | "));

// fotogrammi: rasterizzazione della mesh deformata
const slot = json.slots[0], F = 12, sc = 0.5;
const fw = Math.round(image.width * sc), fh = Math.round(image.height * sc);
const off = { x: image.width / 2, y: image.height }; // radice in basso al centro
for (let f = 0; f < F; f++) {
  const t = (f / F) * MESH_RIG_RULES.loopSeconds;
  const g = attachmentGeometry(json, poseAt(json, t, "ambient"), slot);
  const out = new PNG({ width: fw, height: fh });
  for (let i = 0; i < fw * fh; i++) { const x = i % fw, y = (i / fw) | 0; out.data.set(((x >> 4) + (y >> 4)) & 1 ? [70, 70, 80, 255] : [50, 50, 58, 255], i * 4); }
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
      const ix = Math.min(image.width - 1, Math.max(0, Math.round(tu * (image.width - 1))));
      const iy = Math.min(image.height - 1, Math.max(0, Math.round(tv * (image.height - 1))));
      const si = (iy * image.width + ix) * 4, al = image.rgba[si + 3] / 255;
      if (!al) continue;
      const oi = (y * fw + x) * 4;
      for (let ch = 0; ch < 3; ch++) out.data[oi + ch] = out.data[oi + ch] * (1 - al) + image.rgba[si + ch] * al;
    }
  }
  fs.writeFileSync(path.join(OUT, `_frame_${String(f).padStart(2, "0")}.png`), PNG.sync.write(out));
}
