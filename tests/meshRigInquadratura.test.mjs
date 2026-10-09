// INQUADRATURA nel pacchetto (R15 di docs/REGOLE_MESH.md, zeus-mesh-12): maschera di ritaglio Spine letta dal runtime
// ufficiale 4.1 (se installato) e struttura corretta.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { recognizeParts, foregroundFromUniformBorder } from "../src/lib/partRecognition.js";
import { buildMeshRig, applyFrameClip, packAtlas } from "../src/lib/meshRig.js";

const D = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/exploded/zeus");
const o = PNG.sync.read(fs.readFileSync(path.join(D, "original.png"))), W = o.width, H = o.height, rgba = o.data;
const c = PNG.sync.read(fs.readFileSync(path.join(D, "categorie.png")));
const categories = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) categories[i] = Math.round(c.data[i * 4] / 40);
const landmarks = JSON.parse(fs.readFileSync(path.join(D, "landmarks.json"), "utf8")).landmarks.map(([x, y, v]) => ({ x, y, visibility: v }));
const alpha = foregroundFromUniformBorder({ width: W, height: H, rgba, categories });
const fg = Uint8Array.from(alpha, (a) => (a >= 0.5 ? 1 : 0));
const rec = recognizeParts({ width: W, height: H, landmarks, categories, alpha, rgba });
const { json, images } = buildMeshRig({ width: W, height: H, rgba, fg, parts: rec.parts, categories, landmarks, joints: rec.joints });
const frame = { x: -200, y: 600, width: 400, height: 400 };
const clipped = applyFrameClip(json, frame);

test("F1 maschera di ritaglio: primo slot, osso radice, rettangolo dell'inquadratura, ritaglia fino all'ultimo slot", () => {
  assert.equal(clipped.slots[0].name, "inquadratura");
  assert.equal(clipped.slots[0].bone, "root");
  const a = clipped.skins[0].attachments.inquadratura.inquadratura;
  assert.equal(a.type, "clipping");
  assert.equal(a.end, clipped.slots[clipped.slots.length - 1].name);
  assert.deepEqual(a.vertices, [-200, 600, 200, 600, 200, 1000, -200, 1000]);
  assert.deepEqual([clipped.skeleton.x, clipped.skeleton.y, clipped.skeleton.width, clipped.skeleton.height], [-200, 600, 400, 400]);
  assert.equal(json.slots[0].name !== "inquadratura", true, "l'originale non cambia");
  assert.equal(applyFrameClip(json, null), json);
});

test("F2 runtime ufficiale Spine 4.1 (se installato): legge la maschera", async (t) => {
  let spine;
  try { spine = await import("@esotericsoftware/spine-core"); } catch { t.skip("spine-core non installato"); return; }
  const page = packAtlas(images, "zeus.png");
  const atlas = new spine.TextureAtlas(page.text);
  for (const p of atlas.pages) p.setTexture({ getImage: () => ({ width: page.width, height: page.height }), setFilters() {}, setWraps() {}, dispose() {} });
  const data = new spine.SkeletonJson(new spine.AtlasAttachmentLoader(atlas)).readSkeletonData(clipped);
  const slot = data.findSlot("inquadratura");
  assert.ok(slot);
  const att = data.defaultSkin.getAttachment(slot.index, "inquadratura");
  assert.ok(att instanceof spine.ClippingAttachment);
  assert.equal(att.endSlot.name, clipped.slots[clipped.slots.length - 1].name);
});
