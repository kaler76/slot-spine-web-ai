// Collaudo su personaggi SINTETICI (src/lib/syntheticRig.js): centinaia di pose casuali con la
// risposta esatta nota. Ogni proprietà deve valere per TUTTI i casi; un fallimento stampa i semi
// da riprodurre (makeSyntheticCharacter(seme)).
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeSyntheticCharacter, truthPieces } from "../src/lib/syntheticRig.js";
import { labelPieces } from "../src/lib/explodedSheet.js";
import { piecesToCharacterParts } from "../src/lib/characterFromPieces.js";
import { buildCharacterSkeleton } from "../src/lib/characterSkeleton.js";
import { addTorsoBreathMesh, addHeadMesh } from "../src/lib/torsoMesh.js";
import { toSpine41 } from "../src/lib/spineFormat.js";
import { verifyExportSkeleton } from "../src/lib/exportCheck.js";
import { restWorld } from "../src/lib/rigRules.js";
import { LOOP_SECONDS, isRaisedArm } from "../src/lib/characterAnimationTemplates.js";

const N = Number(process.env.SYNTH_N || 300);
const cases = Array.from({ length: N }, (_, i) => [i + 1, makeSyntheticCharacter(i + 1)]);
const fail = (bad, what) => assert.equal(bad.length, 0, `${what}: ${bad.length}/${N} casi falliti, semi ${bad.slice(0, 10).join(", ")}`);

test(`sintetici (${N}): i nomi dei pezzi dalla posa sono quelli veri`, () => {
  const bad = [];
  for (const [seed, ch] of cases) {
    const pieces = ch.pieces.map((p) => ({ ...p }));
    labelPieces(pieces, ch.landmarks);
    if (pieces.some((p) => p.name !== p.truth)) bad.push(`${seed}(${pieces.filter((p) => p.name !== p.truth).map((p) => `${p.truth}->${p.name}`).join(";")})`);
  }
  fail(bad, "nomi");
});

test(`sintetici (${N}): le ossa ricompongono ogni pezzo al suo posto (< 0.5 px)`, () => {
  const bad = [];
  for (const [seed, ch] of cases) {
    const pieces = truthPieces(ch);
    const { parts, origin } = piecesToCharacterParts(pieces);
    const world = restWorld(parts);
    for (const part of parts) {
      const p = pieces.find((q) => q.name === part.partKey);
      const left = origin.x + world[part.partKey].x - part.pivotFx * part.width;
      const top = origin.y - world[part.partKey].y - part.pivotFy * part.height;
      if (Math.abs(left - p.x) > 0.5 || Math.abs(top - p.y) > 0.5) {
        bad.push(`${seed}:${part.partKey}`);
        break;
      }
    }
  }
  fail(bad, "ricomposizione");
});

test(`sintetici (${N}): export con mesh valido, loop chiuso, saluto solo sui bracci alzati`, () => {
  const bad = [];
  for (const [seed, ch] of cases) {
    const { parts } = piecesToCharacterParts(truthPieces(ch));
    let j = buildCharacterSkeleton({ parts });
    j = addTorsoBreathMesh(j, parts).json;
    j = addHeadMesh(j, parts).json;
    const out = toSpine41(j);
    const r = verifyExportSkeleton(out, parts);
    if (!r.ok || r.warnings.length || r.summary.meshes !== 2 || r.summary.duration !== LOOP_SECONDS) {
      bad.push(`${seed}(${[...r.errors, ...r.warnings].join(" | ").slice(0, 120)})`);
      continue;
    }
    for (const side of ["sx", "dx"]) {
      const part = parts.find((p) => p.partKey === `braccio_${side}`);
      if (isRaisedArm(part) !== ch.truth.raised[side]) bad.push(`${seed}:saluto_${side}`);
    }
  }
  fail(bad, "export");
});

test(`sintetici (${N}): l'oggetto è figlio del braccio che lo tiene`, () => {
  const bad = [];
  for (const [seed, ch] of cases) {
    if (!ch.truth.objectSide) continue;
    const { parts } = piecesToCharacterParts(truthPieces(ch));
    const obj = parts.find((p) => p.partKey === "oggetto");
    if (obj.parentKey !== `braccio_${ch.truth.objectSide}`) bad.push(seed);
  }
  fail(bad, "genitore oggetto");
});
