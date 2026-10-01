// I pezzi della tavola esplosa diventano parti di character che, ricomposte con le regole del
// rig (restWorld + pivot), tornano esattamente nella posizione dell'immagine originale.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { importExplodedSheet } from "../src/lib/explodedSheet.js";
import { piecesToCharacterParts } from "../src/lib/characterFromPieces.js";
import { restWorld } from "../src/lib/rigRules.js";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "exploded", "folletto");
const read = (f) => {
  const p = PNG.sync.read(fs.readFileSync(path.join(dir, f)));
  return { width: p.width, height: p.height, rgba: p.data };
};

test("folletto: le parti del character ricompongono l'originale", () => {
  const original = read("original.png");
  const landmarks = JSON.parse(fs.readFileSync(path.join(dir, "landmarks.json"), "utf8")).landmarks.map(([x, y, v]) => ({ x, y, visibility: v }));
  const { pieces } = importExplodedSheet({ sheet: read("sheet.png"), original, landmarks });
  const { parts, origin } = piecesToCharacterParts(pieces);
  assert.equal(parts.filter((p) => p.parentKey === "root").length, 1, "una sola radice");
  const world = restWorld(parts);
  for (const part of parts) {
    const piece = pieces.find((p) => p.name === part.partKey);
    // angolo in alto a sinistra dell'immagine, dal bone e dal pivot, riportato in pixel immagine
    const left = origin.x + world[part.partKey].x - part.pivotFx * part.width;
    const top = origin.y - world[part.partKey].y - part.pivotFy * part.height;
    assert.ok(Math.abs(left - piece.x) < 0.5 && Math.abs(top - piece.y) < 0.5, `${part.partKey}: ${left},${top} invece di ${piece.x},${piece.y}`);
  }
  // l'oggetto è figlio del braccio che lo tiene e disegnato sopra il busto
  const obj = parts.find((p) => p.partKey === "oggetto");
  assert.equal(obj.parentKey, "braccio_dx");
  assert.ok(obj.zIndex > parts.find((p) => p.partKey === "busto").zIndex);
});
