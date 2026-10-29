// Personaggi "nati per Spine" (src/lib/biped): rig automatico + libreria di animazioni,
// verificati sul runtime UFFICIALE Spine 4.1 (spine-core), fotogramma per fotogramma:
//  B1 il pacchetto si carica (ossa, slot, mesh delle catene, IK, varianti della bocca);
//  B2 ogni articolazione resta entro i limiti anatomici in ogni fotogramma (anche le ginocchia
//     guidate dall'IK e le catene di capelli/mantello);
//  B3 ogni animazione inizia e finisce nella posa di riposo (si aggancia all'idle senza scatti);
//  B4 figura intera: i piedi restano a terra quando il personaggio non salta; ginocchia verso l'esterno;
//  B5 l'attacco ha davvero anticipo → colpo veloce → assestamento (il colpo dura pochi fotogrammi);
//  B6 la stoffa segue con ritardo (follow-through) e torna ferma;
//  B7 niente shear, niente chiavi di deformazione.
import test from "node:test";
import assert from "node:assert/strict";
import { syntheticBipedKit } from "../src/lib/biped/syntheticBiped.js";
import { buildBipedSkeleton } from "../src/lib/biped/bipedRig.js";
import { addLibraryAnimations, ANIMATIONS } from "../src/lib/biped/animationLibrary.js";
import { JOINT_LIMITS, SIGN, splitBone } from "../src/lib/biped/bipedSpec.js";
import { packAtlas } from "../src/lib/meshRig.js";

const norm = (a) => { let d = ((a + 180) % 360 + 360) % 360 - 180; return d === -180 ? 180 : d; };

function build(body) {
  const { kit, images } = syntheticBipedKit({ body });
  const rig = buildBipedSkeleton(kit);
  const report = addLibraryAnimations(rig);
  return { kit, images, rig, report };
}

async function runtime(json, images) {
  const spine = await import("@esotericsoftware/spine-core");
  const atlas = new spine.TextureAtlas(packAtlas(images, "p.png").text);
  for (const p of atlas.pages) p.setTexture({ setFilters() {}, setWraps() {}, dispose() {}, getImage: () => ({ width: p.width, height: p.height }) });
  const data = new spine.SkeletonJson(new spine.AtlasAttachmentLoader(atlas)).readSkeletonData(JSON.stringify(json));
  return { spine, data };
}

/** Pose del runtime a fps fissi per un'animazione: callback(skeleton, t). */
function sweep(spine, data, anim, fps, fn) {
  const sk = new spine.Skeleton(data);
  const a = data.findAnimation(anim);
  for (let i = 0; i <= Math.round(a.duration * fps); i++) {
    const t = Math.min(a.duration, i / fps);
    sk.setToSetupPose();
    a.apply(sk, 0, t, false, [], 1, spine.MixBlend.setup, spine.MixDirection.mixIn);
    sk.updateWorldTransform();
    fn(sk, t, a.duration);
  }
}

const ZERO = { omero: 180, coscia: 180, bacino: 90 };
function anatomical(bone) {
  const { joint, side } = splitBone(bone.data.name);
  const sign = SIGN[joint]?.[side] ?? SIGN[joint]?.c ?? 1;
  return sign * norm(bone.arotation - (ZERO[joint] || 0));
}

for (const body of ["bust", "full"]) {
  test(`B1 ${body}: il pacchetto si carica nel runtime Spine 4.1`, async () => {
    const { rig, images, report } = build(body);
    const { data } = await runtime(rig.json, images);
    assert.deepEqual(report.map((r) => r.name), ANIMATIONS);
    for (const n of ANIMATIONS) assert.ok(data.findAnimation(n), `manca ${n}`);
    assert.ok(data.findSlot("cape") && data.findSlot("hair_back"), "catene");
    if (body === "full") assert.equal(data.ikConstraints.length, 2);
    const mouth = data.defaultSkin.getAttachments().filter((e) => e.name.startsWith("bocca_")).map((e) => e.name);
    assert.ok(mouth.includes("bocca_open") && mouth.includes("bocca_o"), mouth.join());
  });

  test(`B2 ${body}: ogni articolazione resta entro i limiti in ogni fotogramma`, async () => {
    const { rig, images } = build(body);
    const { spine, data } = await runtime(rig.json, images);
    const bad = [];
    const chainMax = new Map(rig.meta.chains.flatMap((c) => c.bones.map((b) => [b, c.maxDeg])));
    const restKnee = {};
    for (const anim of ANIMATIONS) sweep(spine, data, anim, 30, (sk, t) => {
      for (const b of sk.bones) {
        const { joint } = splitBone(b.data.name);
        if (chainMax.has(b.data.name)) {
          const d = Math.abs(norm(b.arotation - b.data.rotation));
          if (d > chainMax.get(b.data.name) + 0.5) bad.push(`${anim}@${t.toFixed(2)} ${b.data.name} ${d.toFixed(1)}°`);
          continue;
        }
        const lim = JOINT_LIMITS[joint];
        if (!lim || joint === "piede") continue;
        const v = anatomical(b);
        if (joint === "gamba") { restKnee[b.data.name] ??= v; }
        if (v < lim.min - 1 || v > lim.max + 1) bad.push(`${anim}@${t.toFixed(2)} ${b.data.name} ${v.toFixed(1)}° fuori [${lim.min},${lim.max}]`);
      }
    });
    assert.deepEqual(bad.slice(0, 8), []);
  });

  test(`B3 ${body}: ogni animazione inizia e finisce nella posa di riposo`, async () => {
    const { rig, images } = build(body);
    const { spine, data } = await runtime(rig.json, images);
    const setup = new spine.Skeleton(data); setup.setToSetupPose(); setup.updateWorldTransform();
    const ref = setup.bones.map((b) => ({ x: b.worldX, y: b.worldY }));
    for (const anim of ANIMATIONS) {
      sweep(spine, data, anim, 30, (sk, t, dur) => {
        if (t !== dur && !(t === 0 && anim !== "intro")) return;
        const worst = Math.max(...sk.bones.map((b, i) => Math.hypot(b.worldX - ref[i].x, b.worldY - ref[i].y)));
        assert.ok(worst < 1, `${anim} a ${t}s: ossa a ${worst.toFixed(2)} px dal riposo`);
      });
    }
  });
}

test("B4 figura intera: piedi a terra quando non salta, ginocchia verso l'esterno", async () => {
  const { rig, images } = build("full");
  const { spine, data } = await runtime(rig.json, images);
  const bad = [];
  for (const anim of ANIMATIONS) sweep(spine, data, anim, 30, (sk, t) => {
    const root = sk.findBone("root");
    if (Math.abs(root.y) > 0.5) return; // in volo
    for (const side of ["sx", "dx"]) {
      const shin = sk.findBone(`gamba_${side}`), tgt = sk.findBone(`ik_piede_${side}`);
      if (Math.abs(tgt.worldY - tgt.data.y) > 0.5) continue; // piede alzato di proposito (passo)
      // la punta della gamba (caviglia) coincide col bersaglio a terra
      const ax = shin.worldX + shin.a * shin.data.length, ay = shin.worldY + shin.c * shin.data.length;
      const d = Math.hypot(ax - tgt.worldX, ay - tgt.worldY);
      if (d > 2) bad.push(`${anim}@${t.toFixed(2)} caviglia ${side} a ${d.toFixed(1)} px da terra`);
      const knee = sk.findBone(`gamba_${side}`);
      const hip = sk.findBone(`coscia_${side}`);
      const out = side === "sx" ? knee.worldX - (hip.worldX + tgt.worldX) / 2 : (hip.worldX + tgt.worldX) / 2 - knee.worldX;
      if (out < -3) bad.push(`${anim}@${t.toFixed(2)} ginocchio ${side} verso l'interno (${out.toFixed(1)})`);
    }
  });
  assert.deepEqual(bad.slice(0, 8), []);
});

test("B5 attacco: anticipo lento, colpo in pochi fotogrammi, oltrepasso e ritorno", async () => {
  const { rig, images } = build("bust");
  const { spine, data } = await runtime(rig.json, images);
  const series = [];
  sweep(spine, data, "attacco", 60, (sk, t) => series.push({ t, a: anatomical(sk.findBone("omero_dx")) }));
  const peak = series.reduce((m, s) => (s.a > m.a ? s : m));
  const low = series.filter((s) => s.t > peak.t).reduce((m, s) => (s.a < m.a ? s : m));
  assert.ok(peak.t > 0.25 && peak.a > 150, `carica: ${peak.a.toFixed(0)}° a ${peak.t}s`);
  const swing = series.filter((s) => s.t >= peak.t && s.t <= low.t);
  assert.ok(low.t - peak.t <= 0.2, `il colpo dura ${(low.t - peak.t).toFixed(2)} s`);
  assert.ok(peak.a - low.a > 140 && swing.length > 2, `escursione ${(peak.a - low.a).toFixed(0)}°`);
});

test("B6 il mantello segue con ritardo e si ferma", async () => {
  const { rig, images } = build("bust");
  const { spine, data } = await runtime(rig.json, images);
  const tip = [], torso = [];
  sweep(spine, data, "attacco", 60, (sk, t) => {
    tip.push({ t, v: norm(sk.findBone("cape_4").arotation - sk.findBone("cape_4").data.rotation) });
    torso.push({ t, v: sk.findBone("torace").arotation - sk.findBone("torace").data.rotation });
  });
  const maxAt = (arr) => arr.reduce((m, s) => (Math.abs(s.v) > Math.abs(m.v) ? s : m));
  const tp = maxAt(tip), bp = maxAt(torso);
  assert.ok(Math.abs(tp.v) > 3, `il mantello si muove (${tp.v.toFixed(1)}°)`);
  assert.ok(tp.t > bp.t - 0.15, `ritardo: punta ${tp.t}s, busto ${bp.t}s`);
  assert.ok(Math.abs(tip[tip.length - 1].v) < 0.5, "a fine animazione il mantello è fermo");
});

test("B7 niente shear e niente chiavi di deformazione", () => {
  for (const body of ["bust", "full"]) {
    const { rig } = build(body);
    for (const [n, a] of Object.entries(rig.json.animations)) {
      assert.ok(!a.deform && !a.attachments, `${n}: deformazioni`);
      for (const tl of Object.values(a.bones)) assert.ok(!tl.shear, `${n}: shear`);
    }
  }
});
