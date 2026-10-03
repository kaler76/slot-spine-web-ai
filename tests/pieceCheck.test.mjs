// Controllo PEZZO PER PEZZO (src/lib/pieceCheck.js) sui casi reali della tavola esplosa e su
// mutazioni volute di folletto_viso: un controllo che non trova i difetti voluti non serve.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { importExplodedSheet } from "../src/lib/explodedSheet.js";
import { checkPieces } from "../src/lib/pieceCheck.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "exploded");
const read = (f) => {
  const p = PNG.sync.read(fs.readFileSync(f));
  return { width: p.width, height: p.height, rgba: p.data };
};
const load = (name) => {
  const dir = path.join(root, name);
  const original = read(path.join(dir, "original.png"));
  const sheet = read(path.join(dir, "sheet.png"));
  const landmarks = JSON.parse(fs.readFileSync(path.join(dir, "landmarks.json"), "utf8")).landmarks.map(([x, y, v]) => ({ x, y, visibility: v }));
  return { original, ...importExplodedSheet({ sheet, original, landmarks }) };
};

for (const name of ["folletto", "avvocato", "folletto_viso"])
  test(`${name}: tutti i pezzi superano il controllo`, () => {
    const r = load(name);
    assert.equal(r.piecesOk, true, r.warnings.join("\n"));
    for (const p of r.pieces) assert.equal(p.check.level, "ok", `${p.name}: ${p.check.issues.join("; ")}`);
  });

const viso = load("folletto_viso");
const mutate = (f) => {
  const ps = viso.pieces.map((p) => ({ ...p }));
  f(ps);
  return checkPieces(ps, viso.original);
};
const shift = (name, dx, dy) => (ps) => {
  const p = ps.find((q) => q.name === name);
  p.x += dx;
  p.y += dy;
};
const levelOf = (c, name) => c.checks.find((k) => k.name === name)?.level;

test("mutazione: occhio finito sul busto (caso reale) = fuori posto", () => {
  const c = mutate(shift("occhio_sx", -20, 150));
  assert.equal(c.ok, false);
  assert.equal(levelOf(c, "occhio_sx"), "bad");
  assert.match(c.warnings.join(" "), /non poggia sulla testa/);
});

test("mutazione: bocca sullo sfondo = fuori dalla sagoma", () => {
  const c = mutate(shift("bocca", -250, 0));
  assert.equal(levelOf(c, "bocca"), "bad");
  assert.match(c.warnings.join(" "), /fuori dalla sagoma/);
});

test("mutazione: occhio spostato di 6 px sulla testa = non combacia", () => {
  const c = mutate(shift("occhio_sx", 6, 0));
  assert.equal(levelOf(c, "occhio_sx"), "bad");
  assert.match(c.warnings.join(" "), /non combacia/);
});

test("mutazione: manca un occhio = viso incompleto", () => {
  const c = mutate((ps) => ps.splice(ps.findIndex((p) => p.name === "occhio_dx"), 1));
  assert.equal(c.ok, false);
  assert.match(c.warnings.join(" "), /manca occhio_dx/);
});

test("la fedeltà globale NON vede l'occhio fuori posto, il controllo pezzo per pezzo sì", () => {
  assert.equal(viso.usable, true);
  assert.equal(mutate(shift("occhio_sx", -20, 150)).ok, false);
});

test("tavola ridisegnata: niente avvisi pezzo per pezzo in più (è già da rifare)", () => {
  const r = load("folletto_ridisegnata");
  assert.equal(r.usable, false);
  assert.ok(!r.warnings.some((w) => /Pezzo (FUORI POSTO|da controllare)/.test(w)));
});
