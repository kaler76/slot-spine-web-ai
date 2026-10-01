// Materiale delle parti: stoffa/pelle/barba deformabili (mesh), armatura metallica rigida.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { isRigidMaterial, metalShare } from "../src/lib/torsoMesh.js";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "material");
const px = (f) => PNG.sync.read(fs.readFileSync(path.join(dir, f))).data;

for (const [file, rigid] of [["folletto_busto.png", false], ["folletto_testa.png", false], ["cavaliere_busto.png", true], ["cavaliere_testa.png", true]])
  test(`materiale: ${file} ${rigid ? "rigido" : "deformabile"} (metallo ${metalShare(px(file)).toFixed(2)})`, () => {
    assert.equal(isRigidMaterial(px(file)), rigid);
  });
