// Casi di riferimento approvati: ogni personaggio corretto/approvato dall'utente
// diventa una cartella in tests/fixtures/<nome>/ (PNG delle parti + case.json).
// Questo test verifica che le regole automatiche (src/lib/rigRules.js) continuino
// a riprodurre il risultato approvato: ruoli, genitori, pivot entro tolleranza e
// posa di riposo invariata. Lancia con: npm.cmd test
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { guessRoles, planRig, restWorld } from "../src/lib/rigRules.js";
import { anchorToFraction } from "../src/lib/characterSkeleton.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(here, "fixtures");

function loadMask(file) {
  const png = PNG.sync.read(fs.readFileSync(file));
  const mask = new Uint8Array(png.width * png.height);
  for (let i = 0; i < mask.length; i++) mask[i] = png.data[i * 4 + 3] >= 128 ? 1 : 0;
  return { w: png.width, h: png.height, mask };
}

/** Centro mondo di riposo di ogni immagine: deve restare identico dopo il rig. */
function imageCenters(parts) {
  const world = restWorld(parts);
  return Object.fromEntries(
    parts.map((p) => {
      const b = world[p.partKey];
      const { fracX, fracY } = anchorToFraction(p.anchorX, p.anchorY, p.pivotFx, p.pivotFy);
      const lx = (0.5 - fracX) * p.width;
      const ly = (fracY - 0.5) * p.height;
      const r = (b.angle * Math.PI) / 180;
      return [p.partKey, { x: b.x + lx * Math.cos(r) - ly * Math.sin(r), y: b.y + lx * Math.sin(r) + ly * Math.cos(r) }];
    })
  );
}

for (const name of fs.readdirSync(fixturesDir)) {
  const dir = path.join(fixturesDir, name);
  const caseFile = path.join(dir, "case.json");
  if (!fs.existsSync(caseFile)) continue;
  const c = JSON.parse(fs.readFileSync(caseFile, "utf8"));
  const parts = c.parts.map((p) => ({ rotation: 0, segments: 1, role: null, pivotFx: null, pivotFy: null, ...p }));
  const masks = Object.fromEntries(parts.map((p) => [p.partKey, loadMask(path.join(dir, `${p.partKey}.png`))]));

  test(`${name}: ruoli proposti`, () => {
    assert.deepEqual(guessRoles(parts), c.expected.roles);
  });

  const plan = planRig(parts, c.expected.roles, masks);
  const byKey = Object.fromEntries(plan.map((p) => [p.partKey, p]));

  test(`${name}: genitori`, () => {
    for (const [k, parent] of Object.entries(c.expected.parents)) assert.equal(byKey[k].parentKey, parent, k);
  });

  test(`${name}: pivot entro ${c.tolerancePx}px dal riferimento`, () => {
    for (const [k, [ex, ey]] of Object.entries(c.expected.pivotsPx)) {
      const p = parts.find((pp) => pp.partKey === k);
      const gx = byKey[k].pivotFx * p.width;
      const gy = byKey[k].pivotFy * p.height;
      const d = Math.hypot(gx - ex, gy - ey);
      assert.ok(d <= c.tolerancePx, `${k}: pivot ${gx.toFixed(0)},${gy.toFixed(0)} dista ${d.toFixed(1)}px da ${ex},${ey}`);
    }
  });

  test(`${name}: posa di riposo invariata`, () => {
    const after = parts.map((p) => ({ ...p, ...byKey[p.partKey] }));
    const a = imageCenters(parts);
    const b = imageCenters(after);
    for (const k of Object.keys(a)) {
      assert.ok(Math.hypot(a[k].x - b[k].x, a[k].y - b[k].y) < 0.05, `${k} si è spostata`);
    }
  });
}
