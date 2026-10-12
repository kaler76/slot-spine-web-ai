// MEMORIA DELLE RISPOSTE DI GEMINI (R25, zeus-mesh-15): numero di chiamate con un'API simulata.
// Ricrea, nuova analisi con gli stessi pixel in un nuovo array, cambio della posa (= pixel inviati diversi), rifiuto,
// errore di rete, "Ridisegna" (force), memoria persistente (pagina ricaricata).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createGeminiCache, cachedGemini, requestKey, hashBytes, GEMINI_MODEL } from "../src/lib/geminiCache.js";
import { armRemovalPrompts, armOnlyPrompts } from "../src/lib/partGemini.js";
import { SMILE_PROMPTS, isGeminiRefusal } from "../src/lib/mouthGemini.js";

const px = (seed, n = 4 * 64 * 36) => Uint8ClampedArray.from({ length: n }, (_, i) => (i * 31 + seed * 7) & 255);
const api = (behaviour) => { const f = async (prompt, k) => { f.calls++; return behaviour(prompt, k, f.calls); }; f.calls = 0; return f; };
const opts = { isRefusal: isGeminiRefusal };

test("C1 chiave: stessi pixel in un NUOVO array = stessa chiave; un pixel diverso, un prompt diverso o un altro tipo = chiave diversa", () => {
  const a = px(1), b = new Uint8ClampedArray(a), c = new Uint8ClampedArray(a); c[100] ^= 1;
  const P = armRemovalPrompts("left");
  assert.equal(requestKey("braccio", a, 64, 36, P), requestKey("braccio", b, 64, 36, P));
  assert.notEqual(requestKey("braccio", a, 64, 36, P), requestKey("braccio", c, 64, 36, P));
  assert.notEqual(requestKey("braccio", a, 64, 36, P), requestKey("braccio", a, 64, 36, armRemovalPrompts("right")));
  assert.notEqual(requestKey("braccio", a, 64, 36, P), requestKey("solo-braccio", a, 64, 36, P));
  assert.ok(requestKey("braccio", a, 64, 36, P).includes(GEMINI_MODEL));
  assert.equal(hashBytes(a).length, 16);
});

test("C2 Ricrea e nuova analisi con gli stessi pixel: una sola chiamata", async () => {
  const cache = createGeminiCache(), call = api(() => "IMG"), P = armRemovalPrompts("left");
  const r1 = await cachedGemini(cache, requestKey("braccio", px(2), 64, 36, P), P, call, opts);
  const r2 = await cachedGemini(cache, requestKey("braccio", px(2), 64, 36, P), P, call, opts); // Ricrea
  const r3 = await cachedGemini(cache, requestKey("braccio", new Uint8ClampedArray(px(2)), 64, 36, P), P, call, opts); // nuova analisi
  assert.equal(call.calls, 1);
  assert.equal(r1.cached, false); assert.equal(r2.cached, true); assert.equal(r3.cached, true);
  assert.equal(r3.b64, "IMG");
});

test("C3 posa cambiata (pixel inviati diversi): nuova chiamata", async () => {
  const cache = createGeminiCache(), call = api(() => "IMG"), P = armOnlyPrompts("left");
  await cachedGemini(cache, requestKey("solo-braccio", px(3), 64, 36, P), P, call, opts);
  await cachedGemini(cache, requestKey("solo-braccio", px(4), 64, 36, P), P, call, opts);
  assert.equal(call.calls, 2);
});

test("C4 rifiuto: si provano le varianti, poi il rifiuto si MEMORIZZA e Ricrea non richiama (anche il sorriso)", async () => {
  const cache = createGeminiCache(), P = SMILE_PROMPTS.chiusa;
  const call = api(() => { throw new Error("Nessuna immagine nella risposta Gemini (finishReason IMAGE_OTHER)"); });
  const key = requestKey("sorriso-chiusa", px(5), 64, 36, P);
  const r1 = await cachedGemini(cache, key, P, call, opts);
  assert.equal(r1.status, "refused"); assert.equal(call.calls, P.length);
  const r2 = await cachedGemini(cache, key, P, call, opts);
  assert.equal(r2.status, "refused"); assert.equal(r2.cached, true); assert.equal(call.calls, P.length);
});

test("C5 errore di rete/server: NON memorizzato, al Ricrea si riprova", async () => {
  const cache = createGeminiCache(), P = armRemovalPrompts("right");
  const call = api((p, k, n) => { if (n === 1) throw new Error("Errore HTTP 502"); return "IMG"; });
  const key = requestKey("braccio", px(6), 64, 36, P);
  await assert.rejects(cachedGemini(cache, key, P, call, opts), /502/);
  const r = await cachedGemini(cache, key, P, call, opts);
  assert.equal(r.status, "ok"); assert.equal(call.calls, 2);
});

test("C6 Ridisegna (force): richiama anche se memorizzato, e sostituisce il risultato", async () => {
  const cache = createGeminiCache(), P = armRemovalPrompts("left");
  const call = api((p, k, n) => `IMG${n}`);
  const key = requestKey("braccio", px(7), 64, 36, P);
  await cachedGemini(cache, key, P, call, opts);
  const r = await cachedGemini(cache, key, P, call, { ...opts, force: true });
  assert.equal(call.calls, 2); assert.equal(r.b64, "IMG2");
  assert.equal((await cachedGemini(cache, key, P, call, opts)).b64, "IMG2");
  assert.equal(call.calls, 2);
});

test("C7 memoria persistente (pagina ricaricata = nuova memoria in RAM): nessuna chiamata", async () => {
  const disk = new Map(), persist = { get: async (k) => disk.get(k), set: async (k, v) => void disk.set(k, v) };
  const P = armRemovalPrompts("left"), key = requestKey("braccio", px(8), 64, 36, P), call = api(() => "IMG");
  await cachedGemini(createGeminiCache(persist), key, P, call, opts);
  const r = await cachedGemini(createGeminiCache(persist), key, P, call, opts);
  assert.equal(call.calls, 1); assert.equal(r.cached, true);
});
