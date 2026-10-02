// VISO su personaggi sintetici (syntheticRig.js con { face: true }): nomi dei pezzi del viso
// dai punti della posa, rig (figli della testa), export valido, simulazione del loop con occhi
// che battono insieme e pezzi del viso che non scivolano sulla mesh della testa.
// Mutazioni: occhi fuori sincrono, testa senza pelle sotto gli occhi, regole mesh non adattate.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeSyntheticCharacter, truthPieces } from "../src/lib/syntheticRig.js";
import { labelPieces } from "../src/lib/explodedSheet.js";
import { piecesToCharacterParts } from "../src/lib/characterFromPieces.js";
import { buildCharacterSkeleton } from "../src/lib/characterSkeleton.js";
import { addTorsoBreathMesh, addHeadMesh } from "../src/lib/torsoMesh.js";
import { toSpine41 } from "../src/lib/spineFormat.js";
import { verifyExportSkeleton } from "../src/lib/exportCheck.js";
import { simulateLoop } from "../src/lib/animationSim.js";
import { restWorld } from "../src/lib/rigRules.js";
import { isFaceName, facePivot } from "../src/lib/faceRig.js";

const N = Number(process.env.SYNTH_N || 200);
const cases = Array.from({ length: N }, (_, i) => [i + 1, makeSyntheticCharacter(i + 1, { face: true })]);
const fail = (bad, what) => assert.equal(bad.length, 0, `${what}: ${bad.length}/${N} casi falliti, semi ${bad.slice(0, 10).join(", ")}`);
const build = (pieces) => {
  const { parts } = piecesToCharacterParts(pieces);
  let j = buildCharacterSkeleton({ parts });
  j = addTorsoBreathMesh(j, parts).json;
  j = addHeadMesh(j, parts).json;
  return { parts, json: toSpine41(j) };
};
const imagesOf = (pieces) => Object.fromEntries(pieces.map((p) => [p.name, { width: p.width, height: p.height, rgba: p.rgba }]));

test(`viso (${N}): i nomi di tutti i pezzi (corpo + viso) sono quelli veri`, () => {
  const bad = [];
  for (const [seed, ch] of cases) {
    const pieces = ch.pieces.map((p) => ({ ...p }));
    labelPieces(pieces, ch.landmarks);
    const wrong = pieces.filter((p) => p.name !== p.truth);
    if (wrong.length) bad.push(`${seed}(${wrong.map((p) => `${p.truth}->${p.name}`).join(";")})`);
  }
  fail(bad, "nomi viso");
});

test("viso: senza il flag face i personaggi sintetici restano identici (i vecchi semi valgono)", () => {
  for (const seed of [1, 42, 295]) {
    const a = makeSyntheticCharacter(seed), b = makeSyntheticCharacter(seed, { face: true });
    const body = b.pieces.filter((p) => !isFaceName(p.truth));
    assert.deepEqual(a.pieces.map((p) => [p.truth, p.x, p.y, p.width, p.height]), body.map((p) => [p.truth, p.x, p.y, p.width, p.height]));
  }
});

test(`viso (${N}): pivot delle ciocche sulla testa, pezzi del viso figli della testa e al loro posto`, () => {
  const bad = [];
  for (const [seed, ch] of cases) {
    const pieces = truthPieces(ch);
    const head = pieces.find((p) => p.name === "testa");
    for (const p of pieces.filter((q) => q.name.startsWith("ciocca"))) {
      const pv = facePivot(p, head);
      const i = (Math.round(pv.y - head.y) * head.width + Math.round(pv.x - head.x)) * 4 + 3;
      if (!(head.rgba[i] > 128)) bad.push(`${seed}:${p.name}`);
    }
    const { parts, origin } = piecesToCharacterParts(pieces);
    const world = restWorld(parts);
    for (const part of parts.filter((q) => isFaceName(q.partKey))) {
      if (part.parentKey !== "testa") bad.push(`${seed}:${part.partKey}->${part.parentKey}`);
      const p = pieces.find((q) => q.name === part.partKey);
      const left = origin.x + world[part.partKey].x - part.pivotFx * part.width;
      if (Math.abs(left - p.x) > 0.5) bad.push(`${seed}:${part.partKey}@`);
    }
  }
  fail(bad, "rig viso");
});

test(`viso (${N}): export valido, ruoli e animazioni del viso, loop simulato senza problemi`, () => {
  const bad = [];
  for (const [seed, ch] of cases) {
    const pieces = truthPieces(ch);
    const { parts, json } = build(pieces);
    const r = verifyExportSkeleton(json, parts);
    if (!r.ok || r.warnings.length) {
      bad.push(`${seed}(${[...r.errors, ...r.warnings].join(" | ").slice(0, 120)})`);
      continue;
    }
    const role = (k) => parts.find((p) => p.partKey === k)?.role;
    if (role("occhio_sx") !== "eye" || role("bocca") !== "mouth") bad.push(`${seed}:ruoli`);
    if (!json.animations.ambient.bones.occhio_sx?.scale) bad.push(`${seed}:battito`);
    // i pezzi del viso non finiscono sulla "cima" che ondeggia
    for (const b of json.bones) if (/^(occhio|sopracciglio|bocca)/.test(b.name) && b.parent !== "testa") bad.push(`${seed}:${b.name}^${b.parent}`);
    const sim = simulateLoop(json, { fps: 15, images: imagesOf(pieces) });
    if (!sim.ok) bad.push(`${seed}: ${sim.problems[0]}`);
  }
  fail(bad, "export/simulazione viso");
});

test("viso: il simulatore trova i difetti del viso (mutazioni volute)", () => {
  const seed = 11;
  // 1. occhi fuori sincrono
  {
    const pieces = truthPieces(makeSyntheticCharacter(seed, { face: true }));
    const { json } = build(pieces);
    const sc = json.animations.ambient.bones.occhio_dx.scale;
    json.animations.ambient.bones.occhio_dx.scale = sc.map((k) => ({ ...k, time: k.time === 0 || k.time === 4 ? k.time : +((k.time + 1) % 4).toFixed(4) })).sort((a, b) => a.time - b.time);
    const r = simulateLoop(json, { fps: 30, images: imagesOf(pieces) });
    assert.ok(r.problems.some((p) => p.startsWith("Occhi non sincronizzati")), r.problems.join("\n"));
  }
  // 2. testa senza pelle sotto gli occhi: chiudendo l'occhio si vede il buco
  {
    const pieces = truthPieces(makeSyntheticCharacter(seed, { face: true, eyeHoles: true }));
    const { json } = build(pieces);
    const r = simulateLoop(json, { fps: 30, images: imagesOf(pieces) });
    assert.ok(r.problems.some((p) => p.startsWith("Buco al raccordo \"occhio")), r.problems.join("\n"));
  }
  // 3. mesh della testa con la fascia che ondeggia sopra gli occhi (regole vecchie): l'occhio scivola
  {
    const pieces = truthPieces(makeSyntheticCharacter(seed, { face: true }));
    const { parts } = piecesToCharacterParts(pieces);
    let j = buildCharacterSkeleton({ parts });
    // ruoli tolti solo per la mesh: addHeadMesh non vede il viso e usa le fasce standard
    j = addHeadMesh(j, parts.map((p) => (/^(occhio|sopracciglio|bocca)/.test(p.partKey) ? { ...p, role: "other" } : p)), { cols: 6, rows: 12, topBone: 0.2, topFrom: 0.3, topTo: 0.6, chinBone: 0.68, chinFrom: 0.65, chinTo: 0.8, topSway: 4, topLag: 0.8, chinSway: 3, chinLag: 1 }).json;
    const json = toSpine41(j);
    const r = simulateLoop(json, { fps: 30, images: imagesOf(pieces), maxRotation: 30 });
    assert.ok(r.problems.some((p) => p.includes("scivola")), r.problems.join("\n"));
  }
});
