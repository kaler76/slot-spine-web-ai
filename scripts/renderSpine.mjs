// Rende fotogrammi PNG di uno skeleton Spine 4.1 (JSON + un PNG per allegato) col simulatore
// dell'app (src/lib/animationSim.js): mesh pesate, region, ordine degli slot, alfa e fusione additiva.
// Uso: node scripts/renderSpine.mjs <file.json> <cartella immagini> <animazione> <cartella uscita> [scala] [t1,t2,...]
// Senza tempi: 60 fotogrammi sulla durata dell'animazione.
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import { poseAt, attachmentGeometry } from "../src/lib/animationSim.js";

export function renderFrame(json, images, anim, t, { scale = 0.5, box = null, bg = true } = {}) {
  const sk = json.skeleton;
  const bx = box || { x: sk.x, y: sk.y, width: sk.width, height: sk.height };
  const fw = Math.round(bx.width * scale), fh = Math.round(bx.height * scale);
  const out = new PNG({ width: fw, height: fh });
  for (let i = 0; i < fw * fh; i++) { const x = i % fw, y = (i / fw) | 0; out.data.set(bg ? (((x >> 4) + (y >> 4)) & 1 ? [70, 70, 80, 255] : [50, 50, 58, 255]) : [0, 0, 0, 255], i * 4); }
  const world = poseAt(json, t, anim);
  const slotAnims = json.animations?.[anim]?.slots || {};
  for (const slot0 of json.slots) {
    const attName = slotAnims[slot0.name]?.attachment ? sampleStep(slotAnims[slot0.name].attachment, t, "name", slot0.attachment) : slot0.attachment;
    if (!attName) continue;
    const slot = { ...slot0, attachment: attName };
    const att = json.skins[0].attachments[slot.name]?.[attName];
    if (!att) continue;
    const img = images[att.path || attName];
    const g = attachmentGeometry(json, world, slot);
    if (!g || !img) continue;
    const col = slotAnims[slot.name]?.rgba ? sampleColor(slotAnims[slot.name].rgba, t) : hex(slot.color || "ffffffff");
    const additive = slot.blend === "additive";
    const P = g.verts.map((v) => ({ x: (v.x - bx.x) * scale, y: (bx.y + bx.height - v.y) * scale }));
    for (let k = 0; k < g.tris.length; k += 3) {
      const [ia, ib, ic] = [g.tris[k], g.tris[k + 1], g.tris[k + 2]];
      const a = P[ia], b = P[ib], c = P[ic];
      const A = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
      if (Math.abs(A) < 1e-9) continue;
      const minX = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x))), maxX = Math.min(fw - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
      const minY = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y))), maxY = Math.min(fh - 1, Math.ceil(Math.max(a.y, b.y, c.y)));
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5, py = y + 0.5;
        const u = ((b.x - px) * (c.y - py) - (c.x - px) * (b.y - py)) / A;
        const v = ((c.x - px) * (a.y - py) - (a.x - px) * (c.y - py)) / A;
        const w = 1 - u - v;
        if (u < -1e-6 || v < -1e-6 || w < -1e-6) continue;
        const tu = u * g.uvs[ia * 2] + v * g.uvs[ib * 2] + w * g.uvs[ic * 2];
        const tv = u * g.uvs[ia * 2 + 1] + v * g.uvs[ib * 2 + 1] + w * g.uvs[ic * 2 + 1];
        // UV come Spine: 0 = bordo sinistro/alto, 1 = bordo destro/basso
        const ix = Math.min(img.width - 1, Math.max(0, Math.floor(tu * img.width)));
        const iy = Math.min(img.height - 1, Math.max(0, Math.floor(tv * img.height)));
        const si = (iy * img.width + ix) * 4, al = (img.rgba[si + 3] / 255) * col[3];
        if (!al) continue;
        const oi = (y * fw + x) * 4;
        for (let ch = 0; ch < 3; ch++) {
          const src = img.rgba[si + ch] * col[ch];
          out.data[oi + ch] = additive ? Math.min(255, out.data[oi + ch] + src * al) : out.data[oi + ch] * (1 - al) + src * al;
        }
      }
    }
  }
  return out;
}

const hex = (h) => [0, 2, 4, 6].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
function sampleColor(keys, t) {
  if (t <= (keys[0].time || 0)) return hex(keys[0].color);
  for (let i = 1; i < keys.length; i++) if (t <= keys[i].time) {
    const a = keys[i - 1], b = keys[i], f = (t - (a.time || 0)) / (b.time - (a.time || 0) || 1);
    const ca = hex(a.color), cb = hex(b.color);
    return ca.map((v, k) => v + (cb[k] - v) * f);
  }
  return hex(keys[keys.length - 1].color);
}
function sampleStep(keys, t, field, dflt) {
  let v = dflt;
  for (const k of keys) if ((k.time || 0) <= t) v = k[field]; else break;
  return v;
}

export function loadImages(dir) {
  const out = {};
  for (const f of fs.readdirSync(dir)) if (f.endsWith(".png")) { const p = PNG.sync.read(fs.readFileSync(path.join(dir, f))); out[f.replace(/\.png$/, "")] = { width: p.width, height: p.height, rgba: p.data }; }
  return out;
}

if (process.argv[1] && process.argv[1].endsWith("renderSpine.mjs")) {
  const [, , jsonPath, imgDir, anim, outDir, sc = "0.5", ts = ""] = process.argv;
  const json = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const images = loadImages(imgDir);
  let dur = 0;
  for (const tl of Object.values(json.animations[anim].bones || {})) for (const keys of Object.values(tl)) for (const k of keys) dur = Math.max(dur, k.time || 0);
  const times = ts ? ts.split(",").map(Number) : Array.from({ length: 60 }, (_, i) => (i / 60) * dur);
  fs.mkdirSync(outDir, { recursive: true });
  times.forEach((t, i) => fs.writeFileSync(path.join(outDir, `_frame_${String(i).padStart(2, "0")}.png`), PNG.sync.write(renderFrame(json, images, anim, t, { scale: Number(sc) }))));
  console.log(`${times.length} fotogrammi, durata ${dur}s`);
}
