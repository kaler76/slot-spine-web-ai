// Esporta i personaggi di prova "nati per Spine" come pacchetti Spine 4.1 (json + atlas + png),
// pronti da importare nell'editor Spine.
// Uso: node scripts/exportBiped.mjs <cartella uscita>
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import { syntheticBipedKit } from "../src/lib/biped/syntheticBiped.js";
import { buildBipedSkeleton } from "../src/lib/biped/bipedRig.js";
import { addLibraryAnimations } from "../src/lib/biped/animationLibrary.js";
import { packAtlas } from "../src/lib/meshRig.js";

const out = process.argv[2] || "biped_spine41";
for (const [body, nome] of [["bust", "busto"], ["full", "figura_intera"]]) {
  const { kit, images } = syntheticBipedKit({ body });
  const rig = buildBipedSkeleton(kit);
  const report = addLibraryAnimations(rig);
  const page = packAtlas(images, `${nome}.png`);
  const png = new PNG({ width: page.width, height: page.height });
  png.data = Buffer.from(page.rgba.buffer);
  const dir = path.join(out, nome);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${nome}.json`), JSON.stringify(rig.json, null, 1));
  fs.writeFileSync(path.join(dir, `${nome}.atlas`), page.text);
  fs.writeFileSync(path.join(dir, `${nome}.png`), PNG.sync.write(png));
  console.log(`${nome}: ${rig.json.bones.length} ossa, animazioni ${report.map((r) => r.name).join(", ")} -> ${dir}`);
}
