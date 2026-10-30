// Rende fotogrammi di un personaggio "nato per Spine" col runtime UFFICIALE spine-core 4.1
// (IK, modi di trasformazione, mesh pesate, additivo), per controllare a occhio le animazioni.
// Uso: node scripts/renderBiped.mjs <bust|full> <cartella uscita> [fps] [scala]
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import * as spine from "@esotericsoftware/spine-core";
import { syntheticBipedKit } from "../src/lib/biped/syntheticBiped.js";
import { buildBipedSkeleton } from "../src/lib/biped/bipedRig.js";
import { addLibraryAnimations, ANIMATIONS } from "../src/lib/biped/animationLibrary.js";
import { packAtlas } from "../src/lib/meshRig.js";

export function loadRuntime(json, images) {
  const page = packAtlas(images, "p.png");
  const atlas = new spine.TextureAtlas(page.text);
  for (const p of atlas.pages) p.setTexture({ setFilters() {}, setWraps() {}, dispose() {}, getImage: () => ({ width: p.width, height: p.height }) });
  const data = new spine.SkeletonJson(new spine.AtlasAttachmentLoader(atlas)).readSkeletonData(JSON.stringify(json));
  return { data, page };
}

export function renderPose(sk, page, { box, scale = 0.5, bg = [36, 38, 48, 255], hide = null }) {
  const fw = Math.round(box.width * scale), fh = Math.round(box.height * scale);
  const out = new Float32Array(fw * fh * 3);
  const cov = new Float32Array(fw * fh); // copertura (alfa accumulato) per buchi e strappi
  for (let i = 0; i < fw * fh; i++) { out[i * 3] = bg[0]; out[i * 3 + 1] = bg[1]; out[i * 3 + 2] = bg[2]; }
  const tex = (u, v) => { const x = Math.min(page.width - 1, Math.max(0, Math.floor(u * page.width))), y = Math.min(page.height - 1, Math.max(0, Math.floor(v * page.height))); const i = (y * page.width + x) * 4; return page.rgba.subarray(i, i + 4); };
  for (const slot of sk.drawOrder) {
    if (hide && hide(slot)) continue;
    const att = slot.getAttachment();
    if (!att || !(att instanceof spine.RegionAttachment || att instanceof spine.MeshAttachment)) continue;
    let verts, uvs, tris;
    if (att instanceof spine.RegionAttachment) { verts = new Float32Array(8); att.computeWorldVertices(slot, verts, 0, 2); uvs = att.uvs; tris = [0, 1, 2, 2, 3, 0]; }
    else { verts = new Float32Array(att.worldVerticesLength); att.computeWorldVertices(slot, 0, att.worldVerticesLength, verts, 0, 2); uvs = att.uvs; tris = att.triangles; }
    const alpha = slot.color.a * sk.color.a, add = slot.data.blendMode === spine.BlendMode.Additive;
    if (alpha <= 0.003) continue;
    const P = []; for (let i = 0; i < verts.length; i += 2) P.push({ x: (verts[i] - box.x) * scale, y: (box.y + box.height - verts[i + 1]) * scale });
    for (let k = 0; k < tris.length; k += 3) {
      const ia = tris[k], ib = tris[k + 1], ic = tris[k + 2], a = P[ia], b = P[ib], c = P[ic];
      const A = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y); if (Math.abs(A) < 1e-9) continue;
      const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x))), x1 = Math.min(fw - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
      const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y))), y1 = Math.min(fh - 1, Math.ceil(Math.max(a.y, b.y, c.y)));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, py = y + 0.5;
        const wa = ((b.x - px) * (c.y - py) - (c.x - px) * (b.y - py)) / A, wb = ((c.x - px) * (a.y - py) - (a.x - px) * (c.y - py)) / A, wc = 1 - wa - wb;
        if (wa < -1e-4 || wb < -1e-4 || wc < -1e-4) continue;
        const u = wa * uvs[ia * 2] + wb * uvs[ib * 2] + wc * uvs[ic * 2], v = wa * uvs[ia * 2 + 1] + wb * uvs[ib * 2 + 1] + wc * uvs[ic * 2 + 1];
        const t = tex(u, v); const al = (t[3] / 255) * alpha; if (al <= 0) continue;
        const o = (y * fw + x) * 3;
        if (!add) cov[y * fw + x] += (1 - cov[y * fw + x]) * al;
        for (let ch = 0; ch < 3; ch++) out[o + ch] = add ? Math.min(255, out[o + ch] + t[ch] * al) : out[o + ch] * (1 - al) + t[ch] * al;
      }
    }
  }
  const png = new PNG({ width: fw, height: fh });
  for (let i = 0; i < fw * fh; i++) { png.data[i * 4] = out[i * 3]; png.data[i * 4 + 1] = out[i * 3 + 1]; png.data[i * 4 + 2] = out[i * 3 + 2]; png.data[i * 4 + 3] = 255; }
  png.coverage = cov;
  return png;
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const body = process.argv[2] || "bust", outDir = process.argv[3] || "out", fps = Number(process.argv[4] || 24), scale = Number(process.argv[5] || 0.5);
  const { kit, images } = syntheticBipedKit({ body });
  const rig = buildBipedSkeleton(kit); addLibraryAnimations(rig);
  const { data, page } = loadRuntime(rig.json, images);
  const H = rig.json.skeleton.height;
  const box = { x: -380, y: -0.62 * H, width: 760, height: H * 1.75 };
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "skeleton.json"), JSON.stringify(rig.json));
  const sk = new spine.Skeleton(data);
  for (const name of ANIMATIONS) {
    const a = data.findAnimation(name);
    const n = Math.round(a.duration * fps) + Math.round(0.4 * fps);
    for (let i = 0; i <= n; i++) {
      const t = Math.min(a.duration, i / fps);
      sk.setToSetupPose(); a.apply(sk, 0, t, false, [], 1, spine.MixBlend.setup, spine.MixDirection.mixIn); sk.updateWorldTransform();
      fs.writeFileSync(path.join(outDir, `${name}_${String(i).padStart(3, "0")}.png`), PNG.sync.write(renderPose(sk, page, { box, scale })));
    }
  }
  console.log("ok", outDir);
}
