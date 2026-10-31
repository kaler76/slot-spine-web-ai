// Regole di costruzione imparate nell'addestramento (src/lib/biped/constructionRules.js, kitPrompts.js):
//  R1 l'elenco delle regole è completo (cosa, perché, dove) e le soglie esistono;
//  R2 traiettorie: retta = tutta "a binario", arco = curvo; lo scatto si vede;
//  R3 stiramento: identità 0, mesh stirata al doppio = tutta distorta;
//  R4 crepe: una fessura sottile si conta, un grande vuoto no;
//  R5 pesi a catena (C4): la stoffa accanto al fianco sotto il gomito segue l'avambraccio, non il busto;
//  R6 personaggio sintetico: stiramento e traiettorie entro le regole, intro su arco (C8);
//  R7 prompt delle tavole (C6, C7): posa a metà escursione e avvisi di progetto.
import test from "node:test";
import assert from "node:assert/strict";
import { CONSTRUCTION_RULES, THRESHOLDS, trajectoryStats, meshStretch, crackMask, constructionVerdict } from "../src/lib/biped/constructionRules.js";
import { buildKitPrompts, designWarnings } from "../src/lib/biped/kitPrompts.js";
import { skinnedMesh } from "../src/lib/biped/bipedRig.js";
import { syntheticBipedKit } from "../src/lib/biped/syntheticBiped.js";
import { buildBipedSkeleton } from "../src/lib/biped/bipedRig.js";
import { addLibraryAnimations } from "../src/lib/biped/animationLibrary.js";
import { packAtlas } from "../src/lib/meshRig.js";

test("R1 regole complete con soglie", () => {
  const ids = CONSTRUCTION_RULES.map((r) => r.id);
  for (const id of ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10"]) assert.ok(ids.includes(id), id);
  for (const r of CONSTRUCTION_RULES) {
    assert.ok(r.regola && r.perche && r.dove, r.id);
    for (const k of r.misura) assert.ok(THRESHOLDS[k], `${r.id}: soglia ${k}`);
  }
});

test("R2 traiettorie: retta, arco, scatto", () => {
  const line = Array.from({ length: 61 }, (_, i) => [i * 5, i * 2]);
  assert.equal(trajectoryStats(line).straightShare, 1);
  const arc = Array.from({ length: 61 }, (_, i) => { const a = (Math.PI * i) / 60; return [200 * Math.cos(a), 200 * Math.sin(a)]; });
  const s = trajectoryStats(arc);
  assert.equal(s.straightShare, 0);
  assert.ok(s.arc > 0.3, `arco ${s.arc}`);
  const snap = Array.from({ length: 61 }, (_, i) => [i < 30 ? i * 4 : 120 - (i - 30) * 4, 0]);
  assert.ok(trajectoryStats(snap).jerk > THRESHOLDS.jerk.ok);
  // verdetto sulla quota di percorsi dritti
  const many = Object.fromEntries(Array.from({ length: 10 }, (_, k) => [`a${k}`, { mano: k < 5 ? trajectoryStats(line) : s }]));
  assert.equal(constructionVerdict({ trajectories: many }).ok, false);
});

test("R3 stiramento delle mesh", () => {
  const v = new Float32Array([0, 0, 10, 0, 0, 10, 10, 10]), tris = [0, 1, 2, 1, 3, 2];
  assert.equal(meshStretch({ m: { v, tris } }, { m: { v, tris } }).frac, 0);
  const v2 = new Float32Array([0, 0, 20, 0, 0, 10, 20, 10]);
  assert.equal(meshStretch({ m: { v, tris } }, { m: { v: v2, tris } }).frac, 1);
});

test("R4 crepe sottili sì, grandi vuoti no", () => {
  const w = 60, h = 40, cov = new Float32Array(w * h).fill(1);
  for (let y = 5; y < 35; y++) for (let x = 29; x < 31; x++) cov[y * w + x] = 0; // fessura di 2 px
  for (let y = 10; y < 30; y++) for (let x = 40; x < 55; x++) cov[y * w + x] = 0; // vuoto 15×20
  const m = crackMask(cov, w, h);
  assert.equal(m.mask[20 * w + 30], 1);
  assert.equal(m.mask[20 * w + 47], 0);
});

test("R5 pesi a catena: la manica accanto al fianco segue l'avambraccio", () => {
  // braccio che scende: spalla (0,0) → gomito (0,-100) → polso (0,-200); busto verticale a x=-60
  const world = {
    torace: { x: -60, y: -150, rot: 90, len: 150 },
    omero: { x: 0, y: 0, rot: -90, len: 100 },
    avambraccio: { x: 0, y: -100, rot: -90, len: 100 },
    mano: { x: 0, y: -200, rot: -90, len: 40 }
  };
  const bones = Object.keys(world).map((name) => ({ name }));
  const part = { name: "arm", x: -40, y: 0, width: 80, height: 240 };
  const S = (p) => ({ x: p.x, y: -p.y });
  const m = skinnedMesh(part, ["torace", "omero", "avambraccio", "mano"], world, S, bones, { cols: 5, rows: 13 }, [{ chain: ["omero", "avambraccio", "mano"], root: "torace" }]);
  // vertice dell'orlo verso il busto, all'altezza dell'avambraccio (riga 7 di 13, colonna 0)
  const nVert = m.uvs.length / 2;
  let k = 0, found = null;
  for (let i = 0; i < nVert; i++) {
    const n = m.vertices[k];
    const u = m.uvs[i * 2], vv = m.uvs[i * 2 + 1];
    const infl = [];
    for (let j = 0; j < n; j++) infl.push({ b: bones[m.vertices[k + 1 + j * 4]].name, w: m.vertices[k + 4 + j * 4] });
    if (u === 0 && Math.abs(vv - 0.58) < 0.05) found = infl;
    k += 1 + n * 4;
  }
  assert.ok(found, "vertice trovato");
  const w = Object.fromEntries(found.map((x) => [x.b, x.w]));
  assert.ok((w.avambraccio || 0) > 0.6, JSON.stringify(w));
  assert.ok(!w.torace, `il busto non deve pesare sotto il gomito: ${JSON.stringify(w)}`);
});

test("R6 personaggio sintetico entro le regole di movimento", async () => {
  const spine = await import("@esotericsoftware/spine-core");
  const { kit, images } = syntheticBipedKit({ body: "bust" });
  const rig = buildBipedSkeleton(kit);
  addLibraryAnimations(rig);
  const atlas = new spine.TextureAtlas(packAtlas(images, "p.png").text);
  for (const p of atlas.pages) p.setTexture({ setFilters() {}, setWraps() {}, dispose() {}, getImage: () => ({ width: p.width, height: p.height }) });
  const data = new spine.SkeletonJson(new spine.AtlasAttachmentLoader(atlas)).readSkeletonData(JSON.stringify(rig.json));
  const sk = new spine.Skeleton(data);
  const meshes = () => {
    const m = {};
    for (const slot of sk.slots) {
      const att = slot.getAttachment();
      if (!(att instanceof spine.MeshAttachment)) continue;
      const v = new Float32Array(att.worldVerticesLength);
      att.computeWorldVertices(slot, 0, att.worldVerticesLength, v, 0, 2);
      m[slot.data.name] = { v, tris: att.triangles };
    }
    return m;
  };
  sk.setToSetupPose(); sk.updateWorldTransform();
  const rest = meshes();
  const traj = {};
  let worstStretch = 0;
  for (const an of data.animations) {
    const n = Math.round(an.duration * 60), pts = { mano_dx: [], mano_sx: [], testa: [] };
    for (let i = 0; i <= n; i++) {
      sk.setToSetupPose();
      an.apply(sk, 0, (an.duration * i) / n, false, [], 1, spine.MixBlend.setup, spine.MixDirection.mixIn);
      sk.updateWorldTransform();
      for (const b of Object.keys(pts)) { const bn = sk.findBone(b); if (bn) pts[b].push([bn.worldX, bn.worldY]); }
      if (i % 10 === 0) worstStretch = Math.max(worstStretch, meshStretch(rest, meshes()).frac);
    }
    traj[an.name] = Object.fromEntries(Object.entries(pts).filter(([, p]) => p.length).map(([b, p]) => [b, trajectoryStats(p)]));
  }
  const v = constructionVerdict({ stretchMaxPct: +(100 * worstStretch).toFixed(2), trajectories: traj });
  assert.ok(v.ok, v.errors.join("; "));
  // C8: l'entrata della testa corre su un arco
  assert.ok(traj.intro.testa.straightShare <= THRESHOLDS.straightShare.max, `intro testa ${traj.intro.testa.straightShare}`);
});

test("R7 prompt delle tavole e avvisi di progetto", () => {
  const p = buildKitPrompts({ description: "a friendly French man with a blue beret, curled moustache, striped fitted shirt", fromReference: true });
  assert.match(p.neutro, /35 degrees/);
  assert.match(p.neutro, /NOT crossed/);
  assert.match(p.neutro, /fitted sleeves/);
  assert.match(p.kit_corpo, /cuff included in the forearm/);
  assert.match(p.kit_viso, /moustache and beard stay on the head/);
  assert.deepEqual(p.warnings, []);
  const maga = designWarnings("a sorceress with very long wavy hair, wide flowing bell sleeves and a purple cape, holding a staff");
  assert.ok(maga.length >= 4, maga.join(" | "));
});
