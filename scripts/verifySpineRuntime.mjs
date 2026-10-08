// Verifica un pacchetto con il RUNTIME UFFICIALE Spine 4.1 (@esotericsoftware/spine-core 4.1.56):
// legge atlas + JSON come farebbe il gioco, riproduce ogni animazione e confronta i vertici
// con il simulatore dell'app (src/lib/animationSim.js).
// Uso: node scripts/verifySpineRuntime.mjs <cartella spine-core> <file.json> <file.atlas>
import fs from "node:fs";
import path from "node:path";
import { poseAt, attachmentGeometry } from "../src/lib/animationSim.js";

const [, , coreDir, jsonPath, atlasPath] = process.argv;
const spine = await import(path.resolve(coreDir, "node_modules/@esotericsoftware/spine-core/dist/index.js"));
const text = fs.readFileSync(jsonPath, "utf8"), json = JSON.parse(text);
const atlas = new spine.TextureAtlas(fs.readFileSync(atlasPath, "utf8"));
for (const p of atlas.pages) p.setTexture({ setFilters() {}, setWraps() {}, dispose() {}, getImage: () => ({ width: p.width, height: p.height }) });
const data = new spine.SkeletonJson(new spine.AtlasAttachmentLoader(atlas)).readSkeletonData(text);
const sk = new spine.Skeleton(data);
const report = { ossa: data.bones.length, slot: data.slots.length, animazioni: data.animations.map((a) => `${a.name} ${a.duration}s`), scarto_max_px: 0, valori_non_validi: 0 };
for (const anim of data.animations) {
  const st = new spine.AnimationState(new spine.AnimationStateData(data));
  st.setAnimation(0, anim.name, true);
  for (let f = 0; f <= 60; f++) {
    const t = (f / 60) * anim.duration;
    sk.setToSetupPose(); st.tracks[0].trackTime = t; st.apply(sk); sk.updateWorldTransform();
    const world = poseAt(json, t, anim.name);
    for (const slot of sk.slots) {
      const att = slot.getAttachment();
      if (!att) continue;
      let v;
      if (att instanceof spine.MeshAttachment) { v = new Float32Array(att.worldVerticesLength); att.computeWorldVertices(slot, 0, att.worldVerticesLength, v, 0, 2); }
      else if (att instanceof spine.RegionAttachment) { v = new Float32Array(8); att.computeWorldVertices(slot, v, 0, 2); }
      else continue;
      for (const x of v) if (!Number.isFinite(x)) report.valori_non_validi++;
      const ours = attachmentGeometry(json, world, { name: slot.data.name, bone: slot.data.boneData.name, attachment: att.name });
      if (!ours || !(att instanceof spine.MeshAttachment)) continue;
      for (let i = 0; i < ours.verts.length; i++) report.scarto_max_px = Math.max(report.scarto_max_px, Math.hypot(ours.verts[i].x - v[2 * i], ours.verts[i].y - v[2 * i + 1]));
    }
  }
}
report.scarto_max_px = +report.scarto_max_px.toFixed(3);
console.log(JSON.stringify(report, null, 1));
