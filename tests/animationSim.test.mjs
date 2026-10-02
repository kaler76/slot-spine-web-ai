// SIMULAZIONE dell'animazione esportata (src/lib/animationSim.js): il loop viene riprodotto
// fotogramma per fotogramma e si controlla ciò che si rompe solo in movimento (raccordi, piedi,
// mesh, ingombro, rotazioni). Su personaggi sintetici e sui casi reali approvati.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { makeSyntheticCharacter, truthPieces } from "../src/lib/syntheticRig.js";
import { importExplodedSheet } from "../src/lib/explodedSheet.js";
import { piecesToCharacterParts } from "../src/lib/characterFromPieces.js";
import { buildCharacterSkeleton } from "../src/lib/characterSkeleton.js";
import { addTorsoBreathMesh, addHeadMesh } from "../src/lib/torsoMesh.js";
import { toSpine41 } from "../src/lib/spineFormat.js";
import { simulateLoop, poseAt } from "../src/lib/animationSim.js";

const exportOf = (pieces) => {
  const { parts } = piecesToCharacterParts(pieces);
  let j = buildCharacterSkeleton({ parts });
  j = addTorsoBreathMesh(j, parts).json;
  j = addHeadMesh(j, parts).json;
  return toSpine41(j);
};
const imagesOf = (pieces) => Object.fromEntries(pieces.map((p) => [p.name, { width: p.width, height: p.height, rgba: p.rgba }]));

test("simulatore: senza animazione ogni fotogramma è la posa di riposo", () => {
  const pieces = truthPieces(makeSyntheticCharacter(7));
  const json = exportOf(pieces);
  const still = { ...json, animations: {} };
  const rest = poseAt(json, 0, "__nessuna__");
  for (const t of [0, 1.3, 2.7]) {
    const w = poseAt(still, t);
    for (const k of Object.keys(rest)) assert.ok(Math.hypot(w[k].tx - rest[k].tx, w[k].ty - rest[k].ty) < 1e-9, k);
  }
  // e il riposo rispetta la gerarchia: l'osso radice del busto è dove lo dice lo skeleton
  const busto = json.bones.find((b) => b.name === "busto");
  assert.ok(Math.abs(rest.busto.tx - busto.x) < 1e-9 && Math.abs(rest.busto.ty - busto.y) < 1e-9);
});

const N = Number(process.env.SYNTH_N || 120);
test(`simulazione su ${N} personaggi sintetici: raccordi, piedi fermi, mesh sane, limiti`, () => {
  const bad = [];
  for (let seed = 1; seed <= N; seed++) {
    const pieces = truthPieces(makeSyntheticCharacter(seed));
    const r = simulateLoop(exportOf(pieces), { fps: 15, images: imagesOf(pieces) });
    if (!r.ok) bad.push(`${seed}: ${r.problems[0]}`);
  }
  assert.equal(bad.length, 0, `${bad.length}/${N} falliti\n${bad.slice(0, 8).join("\n")}`);
});

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "exploded");
for (const name of ["folletto", "avvocato", "folletto_viso"]) {
  test(`simulazione caso reale: ${name}`, () => {
    const dir = path.join(root, name);
    const read = (f) => {
      const p = PNG.sync.read(fs.readFileSync(path.join(dir, f)));
      return { width: p.width, height: p.height, rgba: p.data };
    };
    const landmarks = JSON.parse(fs.readFileSync(path.join(dir, "landmarks.json"), "utf8")).landmarks.map(([x, y, v]) => ({ x, y, visibility: v }));
    const { pieces } = importExplodedSheet({ sheet: read("sheet.png"), original: read("original.png"), landmarks });
    const json = exportOf(pieces);
    const r = simulateLoop(json, { fps: 15, images: imagesOf(pieces) });
    assert.ok(r.ok, r.problems.join("\n"));
    // viso: occhi davanti alla testa, battito con trasparenza piena (si vede la palpebra dipinta)
    if (name === "folletto_viso") {
      const slots = json.slots.map((s) => s.name);
      for (const k of ["occhio_sx", "occhio_dx", "sopracciglio_sx", "sopracciglio_dx", "bocca"]) assert.ok(slots.indexOf(k) > slots.indexOf("testa"), `${k} dietro la testa`);
      for (const k of ["occhio_sx", "occhio_dx"]) assert.ok(json.animations.ambient.slots[k].rgba.some((c) => c.color === "ffffff00"), `${k}: battito senza trasparenza piena`);
    }
  });
}

test("il simulatore trova i difetti (mutazioni volute)", () => {
  const pieces = truthPieces(makeSyntheticCharacter(11));
  const images = imagesOf(pieces);
  // 1) braccio agganciato lontano dal busto -> raccordo staccato
  let j = exportOf(pieces);
  j.bones.find((b) => b.name === "braccio_sx").x += 80;
  assert.ok(simulateLoop(j, { fps: 10, images }).problems.some((p) => /Raccordo "braccio_sx"/.test(p)));
  // 2) piedi pesati sul petto -> la base del busto si muove
  j = exportOf(pieces);
  const mesh = j.skins[0].attachments.busto.busto;
  const petto = j.bones.findIndex((b) => b.name === "busto_petto");
  for (let i = 0, v = 0; i < mesh.vertices.length; v++) {
    const n = mesh.vertices[i++];
    if (mesh.uvs[v * 2 + 1] >= 0.99) for (let k = 0; k < n; k++) mesh.vertices[i + k * 4] = petto;
    i += n * 4;
  }
  assert.ok(simulateLoop(j, { fps: 10, images }).problems.some((p) => /base si muove/.test(p)));
  // 2b) moncone: braccio tagliato poco sotto la spalla (niente sovrapposizione col busto) e
  // rotazione ampia -> buco al raccordo
  j = exportOf(pieces);
  const arm = pieces.find((p) => p.name === "braccio_sx");
  const cut = { ...arm, rgba: Uint8ClampedArray.from(arm.rgba) };
  const sh = { x: arm.pivot.x - arm.x, y: arm.pivot.y - arm.y };
  for (let y = 0; y < cut.height; y++)
    for (let x = 0; x < cut.width; x++) if (Math.hypot(x - sh.x, y - sh.y) < 16) cut.rgba[(y * cut.width + x) * 4 + 3] = 0;
  for (const k of j.animations.ambient.bones.braccio_sx.rotate) k.value *= 4;
  assert.ok(simulateLoop(j, { fps: 10, images: { ...images, braccio_sx: cut }, referenceImages: images, maxRotation: 90 }).problems.some((p) => /Buco al raccordo "braccio_sx"/.test(p)));
  // 3) rotazione esagerata -> oltre il massimo
  j = exportOf(pieces);
  for (const k of j.animations.ambient.bones.testa.rotate) k.value *= 10;
  assert.ok(simulateLoop(j, { fps: 10, images }).problems.some((p) => /Osso "testa" ruota/.test(p)));
});
