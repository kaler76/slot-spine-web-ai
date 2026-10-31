// Banco di prova della costruzione dei personaggi "nati per Spine" (3 tavole → rig → animazioni).
// Per ogni personaggio misura, col runtime ufficiale spine-core 4.1:
//  - riposo: pixel diversi dall'originale, figura scoperta, pixel in più fuori figura
//  - strappi: buchi trasparenti chiusi dentro la sagoma che compaiono in movimento (rispetto al riposo)
//  - trascinamento: quanto si muove busto/gonna quando muovo SOLO le braccia (braccia nascoste nel confronto)
//  - ruoli e avvisi dell'importazione
// e salva un foglio di controllo PNG (originale | riposo | fotogrammi peggiori).
// Uso: node scripts/bancoPersonaggi.mjs <casi.json> <cartella uscita> [nome]
//   casi.json: [{ "name": "maga", "reference": "...png", "body": "...png", "face": "...png", "layout": "grid" }]
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import * as spine from "@esotericsoftware/spine-core";
import { importBipedKit, downscale } from "../src/lib/biped/kitImport.js";
import { buildBipedSkeleton } from "../src/lib/biped/bipedRig.js";
import { addLibraryAnimations, ANIMATIONS } from "../src/lib/biped/animationLibrary.js";
import { loadRuntime, renderPose } from "./renderBiped.mjs";
import { crackMask as holes, meshStretch as stretch, trajectoryStats, constructionVerdict, CONSTRUCTION_RULES_VERSION } from "../src/lib/biped/constructionRules.js";

const load = (p) => { const png = PNG.sync.read(fs.readFileSync(p)); return { width: png.width, height: png.height, rgba: new Uint8ClampedArray(png.data) }; };
const ARM = /omero|avambr|mano|manica|polso|dita|braccio/;

function isArmSlot(slot) {
  for (let b = slot.bone; b; b = b.parent) if (ARM.test(b.data.name)) return true;
  return false;
}

export function benchCase(c, outDir) {
  const t0 = Date.now();
  const refFull = load(c.reference);
  const r = importBipedKit({ reference: refFull, bodySheet: load(c.body), faceSheet: load(c.face) }, { layout: c.layout || "grid", name: c.name });
  const rig = buildBipedSkeleton(r.kit);
  addLibraryAnimations(rig);
  const { data, page } = loadRuntime(rig.json, r.images);
  const sk = new spine.Skeleton(data);
  const o = rig.meta.origin;
  const ref = downscale(refFull, refFull.width > 1200 ? 0.5 : 1);
  const W = ref.width, H = ref.height;
  // stessa corrispondenza dell'importazione: origine dello scheletro in pixel del riferimento ridotto
  const box = { x: -o.x, y: o.y - H, width: W, height: H };
  const scale = 1;
  const pose = (anim, t, hide) => {
    sk.setToSetupPose();
    if (anim) data.findAnimation(anim).apply(sk, 0, t, false, [], 1, spine.MixBlend.setup, spine.MixDirection.mixIn);
    sk.updateWorldTransform();
    return renderPose(sk, page, { box, scale, hide });
  };
  // vertici mondo di ogni mesh visibile
  const meshVerts = () => {
    const m = {};
    for (const slot of sk.slots) {
      const att = slot.getAttachment();
      if (!(att instanceof spine.MeshAttachment) || slot.color.a < 0.05) continue;
      const v = new Float32Array(att.worldVerticesLength);
      att.computeWorldVertices(slot, 0, att.worldVerticesLength, v, 0, 2);
      m[slot.data.name] = { v, tris: att.triangles };
    }
    return m;
  };
  // riposo contro l'originale
  const rest = pose(null, 0);
  let fig = 0, diff = 0, unc = 0, extra = 0;
  for (let i = 0; i < W * H; i++) {
    const R = ref.rgba[i * 4], G = ref.rgba[i * 4 + 1], B = ref.rgba[i * 4 + 2];
    const bg = G > R + 40 && G > B + 40;
    const cv = rest.coverage[i];
    if (bg) { if (cv > 0.5) extra++; continue; }
    fig++;
    if (cv < 0.5) unc++;
    else if (Math.abs(R - rest.data[i * 4]) + Math.abs(G - rest.data[i * 4 + 1]) + Math.abs(B - rest.data[i * 4 + 2]) > 60) diff++;
  }
  const restHoles = holes(rest.coverage, W, H).n;

  // movimento: crepe e stiramento delle mesh
  sk.setToSetupPose(); sk.updateWorldTransform();
  const restMesh = meshVerts();
  const frames = [];
  for (const a of Object.keys(rig.json.animations)) {
    const dur = data.findAnimation(a).duration;
    for (let k = 1; k <= 6; k++) {
      const t = (dur * k) / 7;
      const img = pose(a, t);
      const h = holes(img.coverage, W, H);
      const st = stretch(restMesh, meshVerts());
      frames.push({ anim: a, t: +t.toFixed(2), tears: Math.max(0, h.n - restHoles), drag: st.frac, dragSlot: `${st.worst[0]} ${(100 * st.worst[1]).toFixed(0)}%`, img, mask: h.mask });
    }
  }
  // TRAIETTORIE (lezione Playtika: il movimento bello corre su archi, non su rette, e senza scatti).
  // Per mani e testa, in ogni animazione: punti a 60 fps; arco = scostamento massimo dalla corda / corda
  // (sotto 0,06 su un tragitto lungo = movimento "a binario"); scatto = picco della derivata seconda
  // rispetto alla media (salto di velocità in un fotogramma oltre 1,1 volte la velocità massima: sopra il 90° percentile degli esempi ufficiali Spine); ciclo chiuso per idle.
  const ends = ["mano_dx", "mano_sx", "testa"].filter((n) => sk.findBone(n));
  const traj = {};
  for (const a of Object.keys(rig.json.animations)) {
    const an = data.findAnimation(a), n = Math.max(8, Math.round(an.duration * 60));
    const pts = Object.fromEntries(ends.map((e) => [e, []]));
    for (let i = 0; i <= n; i++) {
      sk.setToSetupPose();
      an.apply(sk, 0, (an.duration * i) / n, false, [], 1, spine.MixBlend.setup, spine.MixDirection.mixIn);
      sk.updateWorldTransform();
      for (const e of ends) { const b = sk.findBone(e); pts[e].push([b.worldX, b.worldY]); }
    }
    traj[a] = Object.fromEntries(ends.map((e) => [e, trajectoryStats(pts[e])]));
  }
  const worstTear = frames.reduce((m, f) => (f.tears > m.tears ? f : m), frames[0]);
  const worstDrag = frames.reduce((m, f) => (f.drag > m.drag ? f : m), frames[0]);
  const res = {
    name: c.name,
    seconds: +((Date.now() - t0) / 1000).toFixed(1),
    restDiffPct: +((100 * diff) / fig).toFixed(2),
    restUncoveredPct: +((100 * unc) / fig).toFixed(2),
    restExtraPct: +((100 * extra) / fig).toFixed(2),
    tearsMaxPx: worstTear.tears,
    tearsPctFig: +((100 * worstTear.tears) / fig).toFixed(3),
    tearsWhere: `${worstTear.anim}@${worstTear.t}`,
    stretchMaxPct: +(100 * worstDrag.drag).toFixed(2),
    stretchWhere: `${worstDrag.anim}@${worstDrag.t} ${worstDrag.dragSlot}`,
    perAnim: Object.fromEntries([...new Set(frames.map((f) => f.anim))].map((a) => {
      const fs_ = frames.filter((f) => f.anim === a);
      return [a, { tears: Math.max(...fs_.map((f) => f.tears)), drag: +(100 * Math.max(...fs_.map((f) => f.drag))).toFixed(1) }];
    })),
    trajectories: traj,
    bones: rig.json.bones.length,
    warnings: r.report.warnings || []
  };
  res.verdict = constructionVerdict(res);
  res.rules = CONSTRUCTION_RULES_VERSION;

  // foglio di controllo: originale | riposo | strappo peggiore (buchi in magenta) | trascinamento peggiore | apertura picco
  const ap = frames.filter((f) => f.anim === "apertura").sort((a, b) => b.drag - a.drag)[0];
  const tiles = [{ data: ref.rgba }, rest, paint(worstTear), worstDrag.img, (ap || worstDrag).img];
  const sheet = new PNG({ width: W * tiles.length, height: H });
  tiles.forEach((t, k) => {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, j = (y * W * tiles.length + k * W + x) * 4;
      sheet.data[j] = t.data[i]; sheet.data[j + 1] = t.data[i + 1]; sheet.data[j + 2] = t.data[i + 2]; sheet.data[j + 3] = 255;
    }
  });
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${c.name}.png`), PNG.sync.write(sheet));
  return res;

  function paint(f) {
    const p = { data: Buffer.from(f.img.data) };
    for (let i = 0; i < W * H; i++) if (f.mask[i]) { p.data[i * 4] = 255; p.data[i * 4 + 1] = 0; p.data[i * 4 + 2] = 255; }
    return p;
  }
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const cases = JSON.parse(fs.readFileSync(process.argv[2], "utf8")).filter((c) => !process.argv[4] || process.argv[4].split(",").includes(c.name));
  const outDir = process.argv[3] || "banco";
  const all = [];
  for (const c of cases) {
    try {
      const r = benchCase(c, outDir);
      all.push(r);
      console.log(JSON.stringify(r));
    } catch (e) {
      all.push({ name: c.name, error: e.message });
      console.log(JSON.stringify({ name: c.name, error: e.message, stack: e.stack.split("\n").slice(0, 4).join(" | ") }));
    }
  }
  fs.writeFileSync(path.join(outDir, "risultati.json"), JSON.stringify(all, null, 1));
}
