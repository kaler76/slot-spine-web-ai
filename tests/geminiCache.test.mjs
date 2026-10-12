import test from "node:test";
import assert from "node:assert/strict";
import { createGeminiCache, imageCacheKey, editCacheKey } from "../src/lib/geminiCache.js";

const image = () => ({ width: 2, height: 1, rgba: new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255]) });
const mask = () => new Uint8Array([1, 1]);

test("Ricrea riusa il risultato anche con nuovi array degli stessi pixel e sagoma", async () => {
  const cache = createGeminiCache(); let calls = 0;
  const generate = () => { calls++; return { patch: "approved" }; };
  const key = async () => editCacheKey(await imageCacheKey(image(), mask()), "arm", { side: "dx" });
  const first = await cache.run(await key(), generate);
  assert.strictEqual(await cache.run(await key(), generate), first);
  assert.equal(calls, 1);
});

test("nuovi pixel, trasparenza, sagoma e dimensioni invalidano l'identità", async () => {
  const base = await imageCacheKey(image(), mask());
  for (const index of [0, 3, 7]) {
    const next = image(); next.rgba[index]--;
    assert.notEqual(await imageCacheKey(next, mask()), base);
  }
  assert.notEqual(await imageCacheKey(image(), new Uint8Array([1, 0])), base);
  assert.notEqual(await imageCacheKey({ ...image(), width: 1, height: 2 }, mask()), base);
});

test("posa precisa, lato, spalle, oggetto, crop e prompt invalidano la richiesta", () => {
  const inputs = { arm: { side: "dx", imageSide: "left", shoulderW: 100, wr: { x: 10, y: 10 }, objBox: { x0: 1 } }, box: { x0: 0 }, prompts: ["v1"], requestSide: 1376 };
  const base = editCacheKey("image", "arm", inputs);
  for (const change of [
    (v) => { v.arm.wr.x += 0.1; }, (v) => { v.arm.side = "sx"; },
    (v) => { v.arm.imageSide = "right"; }, (v) => { v.arm.shoulderW++; },
    (v) => { v.arm.objBox.x0++; }, (v) => { v.box.x0++; },
    (v) => { v.prompts[0] = "v2"; }, (v) => { v.requestSide++; }
  ]) {
    const next = structuredClone(inputs); change(next);
    assert.notEqual(editCacheKey("image", "arm", next), base);
  }
  assert.equal(editCacheKey("image", "arm", { b: 2, a: { y: 2, x: 1 } }), editCacheKey("image", "arm", { a: { x: 1, y: 2 }, b: 2 }));
});

test("rifiuto del sorriso conservato: Ricrea non ripete, Ridisegna riprova", async () => {
  const cache = createGeminiCache(); let calls = 0;
  const refused = Object.assign(new Error("Gemini ha rifiutato"), { refused: true });
  const generate = () => { calls++; throw refused; };
  for (let i = 0; i < 3; i++) await assert.rejects(cache.run("smile", generate), (e) => e === refused && e.refused);
  assert.equal(calls, 1);
  const result = await cache.run("smile", () => { calls++; return "new smile"; }, { force: true });
  assert.equal(result, "new smile");
  assert.equal(await cache.run("smile", generate), result);
  assert.equal(calls, 2);
});

test("errori di rete e risultati non validi non provocano retry automatici", async () => {
  const cache = createGeminiCache(); let calls = 0;
  const generate = () => { calls++; throw new Error("HTTP 503"); };
  await assert.rejects(cache.run("network", generate), /503/);
  await assert.rejects(cache.run("network", generate), /503/);
  const invalid = () => { calls++; return { patch: { error: "sagoma non valida" } }; };
  assert.deepEqual(await cache.run("invalid", invalid), await cache.run("invalid", invalid));
  assert.equal(calls, 2);
});

test("richieste simultanee, anche forzate, condividono una sola generazione", async () => {
  const cache = createGeminiCache(); let calls = 0, finish;
  const generate = () => { calls++; return new Promise((resolve) => { finish = resolve; }); };
  const a = cache.run("arm", generate), b = cache.run("arm", generate, { force: true });
  assert.strictEqual(a, b);
  await Promise.resolve(); assert.equal(calls, 1);
  finish("arm result");
  assert.deepEqual(await Promise.all([a, b]), ["arm result", "arm result"]);
});

test("Ridisegna un lato non invalida l'altro braccio o il sorriso", async () => {
  const cache = createGeminiCache(), calls = { sx: 0, dx: 0, smile: 0 };
  const generate = (side) => () => ++calls[side];
  for (const side of Object.keys(calls)) await cache.run(side, generate(side));
  await cache.run("sx", generate("sx"), { force: true });
  for (const side of Object.keys(calls)) await cache.run(side, generate(side));
  assert.deepEqual(calls, { sx: 2, dx: 1, smile: 1 });
});

test("tipi di sorriso e posizioni della bocca hanno risultati distinti e riutilizzabili", async () => {
  const cache = createGeminiCache(); let calls = 0;
  const generate = () => ++calls;
  const key = (smileKind, x = 10) => editCacheKey("image", "smile", { smileKind, mouth: { x }, prompts: ["same"] });
  assert.equal(await cache.run(key("chiusa"), generate), 1);
  assert.equal(await cache.run(key("aperta"), generate), 2);
  assert.equal(await cache.run(key("chiusa", 11), generate), 3);
  assert.equal(await cache.run(key("chiusa"), generate), 1);
  assert.equal(calls, 3);
});
