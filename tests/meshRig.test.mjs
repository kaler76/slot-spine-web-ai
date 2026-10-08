// METODO MESH (src/lib/meshRig.js, docs/REGOLE_MESH.md) sul caso di riferimento Zeus (zeus-mesh-5,
// approvato dall'utente l'8 ott 2026). Ogni regola del documento ha qui il suo controllo.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { recognizeParts, foregroundFromUniformBorder } from "../src/lib/partRecognition.js";
import { buildMeshRig, MESH_RIG_RULES } from "../src/lib/meshRig.js";
import { renderFrame } from "../scripts/renderSpine.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const D = path.join(root, "tests/fixtures/exploded/zeus");
const o = PNG.sync.read(fs.readFileSync(path.join(D, "original.png"))), W = o.width, H = o.height, rgba = o.data;
const c = PNG.sync.read(fs.readFileSync(path.join(D, "categorie.png")));
const categories = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) categories[i] = Math.round(c.data[i * 4] / 40);
const landmarks = JSON.parse(fs.readFileSync(path.join(D, "landmarks.json"), "utf8")).landmarks.map(([x, y, v]) => ({ x, y, visibility: v }));
const alpha = foregroundFromUniformBorder({ width: W, height: H, rgba, categories });
const fg = Uint8Array.from(alpha, (a) => (a >= 0.5 ? 1 : 0));
const rec = recognizeParts({ width: W, height: H, landmarks, categories, alpha, rgba });
const { json, images, report } = buildMeshRig({ width: W, height: H, rgba, fg, parts: rec.parts, categories, landmarks, joints: rec.joints });
const T = MESH_RIG_RULES.loopSeconds, B = MESH_RIG_RULES.blinkAt;

test("M1 scelta automatica su Zeus: taglio solo del braccio col fulmine, occhi con buco, niente capelli dietro", () => {
  const names = json.slots.map((s) => s.name);
  assert.deepEqual(names, ["bianco_sx", "bianco_dx", "pupilla_sx", "pupilla_dx", "corpo", "palpebra_sx", "palpebra_dx", "braccio_dx"]);
  assert.ok(report.decision.some((r) => /braccio_dx: TAGLIO/.test(r)));
  assert.ok(report.decision.some((r) => /braccio_sx: mesh/.test(r)));
});

test("M2 a riposo identico all'originale (≤ 1,5% pixel diversi: solo il bianco degli occhi è generato)", () => {
  const still = { ...json, animations: { fermo: { bones: {} } } };
  const f = renderFrame(still, images, "fermo", 0, { scale: 1, bg: false });
  // il riquadro dello skeleton è l'ingombro del personaggio meno il margine (come in buildMeshRig)
  let fx0 = W, fy0 = H; for (let i = 0; i < W * H; i++) if (fg[i]) { fx0 = Math.min(fx0, i % W); fy0 = Math.min(fy0, (i / W) | 0); }
  const ox = Math.max(0, fx0 - MESH_RIG_RULES.pad), oy = Math.max(0, fy0 - MESH_RIG_RULES.pad);
  let n = 0, diff = 0;
  for (let y = 0; y < f.height; y++) for (let x = 0; x < f.width; x++) {
    const g = (y + oy) * W + x + ox; if (!fg[g]) continue; n++;
    const i = (y * f.width + x) * 4;
    if (Math.abs(f.data[i] - rgba[g * 4]) + Math.abs(f.data[i + 1] - rgba[g * 4 + 1]) + Math.abs(f.data[i + 2] - rgba[g * 4 + 2]) > 30) diff++;
  }
  assert.ok(diff / n <= 0.015, `pixel diversi ${((100 * diff) / n).toFixed(2)}%`);
});

test("M3 occhio chiuso senza fessure: nessun pixel di bianco o pupilla visibile al culmine del battito", () => {
  const im = structuredClone(images);
  for (const k of ["bianco_sx", "bianco_dx", "pupilla_sx", "pupilla_dx"]) { const a = im[k].rgba; for (let i = 0; i < a.length; i += 4) if (a[i + 3]) a.set([255, 0, 255, 255], i); }
  const count = (t) => { const f = renderFrame(json, im, "ambient", t, { scale: 1, bg: false }); let n = 0; for (let i = 0; i < f.data.length; i += 4) if (f.data[i] === 255 && f.data[i + 1] === 0 && f.data[i + 2] === 255) n++; return n; };
  assert.ok(count(0) > 300, "a occhi aperti il bianco e la pupilla si vedono");
  assert.equal(count(B + 0.133), 0);
});

test("M4 fulmine rigido: i vertici dell'oggetto in mano dipendono solo dall'osso della mano", () => {
  const att = json.skins[0].attachments.braccio_dx.braccio_dx, mano = json.bones.findIndex((b) => b.name === "mano_dx");
  let solo = 0;
  for (let i = 0; i < att.vertices.length; ) { const n = att.vertices[i++]; const bones = []; for (let k = 0; k < n; k++, i += 4) bones.push(att.vertices[i]); if (n === 1 && bones[0] === mano) solo++; }
  assert.ok(solo >= 40, `vertici solo-mano ${solo}`);
});

test("M5 loop chiuso e morbido: ogni traccia ha la stessa chiave a 0 e a fine loop; chiavi poche con curve", () => {
  for (const [bone, tl] of Object.entries(json.animations.ambient.bones))
    for (const [ch, keys] of Object.entries(tl)) {
      const a = keys[0], z = keys[keys.length - 1];
      assert.equal(z.time, T, `${bone}.${ch} non finisce a ${T}s`);
      for (const k of ["value", "x", "y"]) if (k in a) assert.ok(Math.abs(a[k] - z[k]) < 1e-3, `${bone}.${ch}.${k} non torna al valore iniziale`);
      assert.ok(keys.length <= 12, `${bone}.${ch}: ${keys.length} chiavi`);
    }
});

test("M6 testa non stirata: nessuno spostamento dell'osso testa (solo rotazione)", () => {
  assert.ok(!json.animations.ambient.bones.testa.translate);
});

test("M7 runtime ufficiale Spine 4.1 (se installato): legge il pacchetto e i vertici coincidono col simulatore", async (t) => {
  let spine;
  try { spine = await import("@esotericsoftware/spine-core"); } catch { t.skip("@esotericsoftware/spine-core non installato (npm.cmd i -D @esotericsoftware/spine-core@4.1.56)"); return; }
  const { packAtlas } = await import("../src/lib/meshRig.js");
  const { poseAt, attachmentGeometry } = await import("../src/lib/animationSim.js");
  const atlas = new spine.TextureAtlas(packAtlas(images, "p.png").text);
  for (const p of atlas.pages) p.setTexture({ setFilters() {}, setWraps() {}, dispose() {}, getImage: () => ({ width: p.width, height: p.height }) });
  const data = new spine.SkeletonJson(new spine.AtlasAttachmentLoader(atlas)).readSkeletonData(JSON.stringify(json));
  const sk = new spine.Skeleton(data), st = new spine.AnimationState(new spine.AnimationStateData(data));
  st.setAnimation(0, "ambient", true);
  let worst = 0;
  for (const tt of [0, 1, 2.1, 3.3, 5]) {
    sk.setToSetupPose(); st.tracks[0].trackTime = tt; st.apply(sk); sk.updateWorldTransform();
    const world = poseAt(json, tt, "ambient");
    for (const slot of sk.slots) {
      const att = slot.getAttachment();
      if (!(att instanceof spine.MeshAttachment)) continue;
      const v = new Float32Array(att.worldVerticesLength); att.computeWorldVertices(slot, 0, att.worldVerticesLength, v, 0, 2);
      const ours = attachmentGeometry(json, world, { name: slot.data.name, bone: slot.data.boneData.name, attachment: att.name });
      ours.verts.forEach((p, i) => (worst = Math.max(worst, Math.hypot(p.x - v[2 * i], p.y - v[2 * i + 1]))));
    }
  }
  assert.ok(worst < 1.5, `scarto runtime/simulatore ${worst.toFixed(2)} px`);
});
