// Dal kit generato (posa neutra + tavola corpo + tavola viso, PNG su fondo chroma) al pacchetto
// Spine 4.1 animato (6 animazioni della libreria) + fotogrammi di controllo.
// Uso: node scripts/importBipedKit.mjs <neutra.png> <corpo.png> <viso.png> <cartella uscita> [nome]
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import * as spine from "@esotericsoftware/spine-core";
import { importBipedKit } from "../src/lib/biped/kitImport.js";
import { buildBipedSkeleton } from "../src/lib/biped/bipedRig.js";
import { addLibraryAnimations, ANIMATIONS } from "../src/lib/biped/animationLibrary.js";
import { packAtlas } from "../src/lib/meshRig.js";
import { loadRuntime, renderPose } from "./renderBiped.mjs";

const load = (p) => { const png = PNG.sync.read(fs.readFileSync(p)); return { width: png.width, height: png.height, rgba: new Uint8ClampedArray(png.data) }; };
const [ref, body, face, out, name = "personaggio"] = process.argv.slice(2);
const t0 = Date.now();
const { kit, images, report } = importBipedKit({ reference: load(ref), bodySheet: load(body), faceSheet: load(face) }, { name });
console.log("import", ((Date.now() - t0) / 1000).toFixed(1) + "s", JSON.stringify(report, null, 1));
const rig = buildBipedSkeleton(kit);
const anims = addLibraryAnimations(rig);
for (const a of anims) if (a.clamped.length) console.log("limiti:", a.clamped.join("; "));
fs.mkdirSync(out, { recursive: true });
const page = packAtlas(images, `${name}.png`, { maxWidth: 2048 });
const png = new PNG({ width: page.width, height: page.height }); png.data = Buffer.from(page.rgba.buffer);
fs.writeFileSync(path.join(out, `${name}.png`), PNG.sync.write(png));
fs.writeFileSync(path.join(out, `${name}.atlas`), page.text);
fs.writeFileSync(path.join(out, `${name}.json`), JSON.stringify(rig.json, null, 1));
fs.writeFileSync(path.join(out, "kit.json"), JSON.stringify({ kit, report }, null, 1));
// fotogrammi di controllo
const { data } = loadRuntime(rig.json, images);
const page2 = packAtlas(images, "p.png");
const sk = new spine.Skeleton(data);
const H = rig.json.skeleton.height, W = rig.json.skeleton.width;
const box = { x: -W * 0.8, y: -0.55 * H, width: W * 1.6, height: H * 1.75 };
const fdir = path.join(out, "fotogrammi"); fs.mkdirSync(fdir, { recursive: true });
for (const n of ANIMATIONS) {
  const a = data.findAnimation(n);
  for (let i = 0; i <= Math.round(a.duration * 12); i++) {
    const t = Math.min(a.duration, i / 12);
    sk.setToSetupPose(); a.apply(sk, 0, t, false, [], 1, spine.MixBlend.setup, spine.MixDirection.mixIn); sk.updateWorldTransform();
    fs.writeFileSync(path.join(fdir, `${n}_${String(i).padStart(3, "0")}.png`), PNG.sync.write(renderPose(sk, page2, { box, scale: 0.35 })));
  }
}
console.log("ok", out, ((Date.now() - t0) / 1000).toFixed(1) + "s");
