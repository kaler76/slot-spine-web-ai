// src/lib/geminiCache.js — MEMORIA DELLE RISPOSTE DI GEMINI (regola R25 di docs/REGOLE_MESH.md, zeus-mesh-15).
// Analisi del 12 ott: la memoria del braccio dipendeva dall'oggetto in memoria dei pixel (stessi pixel in un nuovo
// array = nuova chiamata) e da una chiave parziale (lato + punti arrotondati, senza sagoma e oggetto); il sorriso
// non memorizzava i rifiuti e "Ricrea" li ritentava. Qui si separano:
//   - la RISPOSTA generativa (a pagamento), memorizzata per CONTENUTO della richiesta: pixel esatti inviati, testo dei
//     prompt, modello. Stessa richiesta = stessa chiave, qualunque sia l'oggetto JS che porta i pixel;
//   - l'elaborazione (allineamento, maschera, pezzo), deterministica e ricalcolata ogni volta dalla risposta.
// Stati memorizzati: "ok" (immagine) e "refused" (Gemini ha rifiutato tutte le varianti del prompt). Un errore di rete
// o del server NON si memorizza (non è stato consegnato niente): al prossimo "Ricrea" si riprova. Si richiama Gemini
// su una richiesta già memorizzata solo con force (pulsanti "Ridisegna ... (Gemini)").
// Puro: nessun DOM; la persistenza (IndexedDB) è facoltativa e passata da fuori.

export const GEMINI_MODEL = "gemini-3-pro-image-preview";

// hash a 64 bit (due FNV-1a a 32 bit con semi diversi): collisioni trascurabili per questo uso
function fnv(bytes, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
export function hashBytes(bytes) {
  return fnv(bytes, 2166136261).toString(16).padStart(8, "0") + fnv(bytes, 0x9747b28c).toString(16).padStart(8, "0");
}
export const hashText = (s) => hashBytes(new TextEncoder().encode(String(s)));

/** Chiave della richiesta: tipo, misure e pixel ESATTI inviati, testo di tutte le varianti del prompt, modello. */
export function requestKey(kind, pixels, width, height, prompts) {
  return [kind, `${width}x${height}`, hashBytes(pixels), hashText([].concat(prompts).join("\n␞\n")), GEMINI_MODEL].join("|");
}

/** Memoria in RAM, con persistenza facoltativa ({ get(key) → Promise, set(key, value) → Promise }). */
export function createGeminiCache(persist = null) {
  const mem = new Map();
  return {
    async get(key) {
      if (mem.has(key)) return mem.get(key);
      if (!persist) return null;
      try { const v = await persist.get(key); if (v) mem.set(key, v); return v || null; } catch { return null; }
    },
    async set(key, value) {
      mem.set(key, value);
      if (persist) { try { await persist.set(key, value); } catch { /* la memoria in RAM basta */ } }
    },
    has: (key) => mem.has(key),
    size: () => mem.size
  };
}

/**
 * Risposta di Gemini con memoria. call(prompt, indice) → Promise<base64> (lancia se rifiuta o fallisce).
 * Restituisce { status: "ok", b64, promptIndex, cached } oppure { status: "refused", message, cached }.
 * Gli errori che non sono rifiuti si rilanciano e non si memorizzano.
 */
export async function cachedGemini(cache, key, prompts, call, { force = false, isRefusal = () => false, onTry = null } = {}) {
  if (!force) { const hit = await cache.get(key); if (hit) return { ...hit, cached: true }; }
  let last = null;
  for (let k = 0; k < prompts.length; k++) {
    onTry?.(k);
    try {
      const b64 = await call(prompts[k], k);
      const r = { status: "ok", b64, promptIndex: k };
      await cache.set(key, r);
      return { ...r, cached: false };
    } catch (e) {
      if (!isRefusal(e?.message)) throw e;
      last = e;
    }
  }
  const r = { status: "refused", message: `Gemini ha rifiutato ${prompts.length} volte (${last?.message || "nessuna immagine"})` };
  await cache.set(key, r);
  return { ...r, cached: false };
}

/** Persistenza nel browser (IndexedDB): le risposte restano anche ricaricando la pagina. null fuori dal browser. */
export function indexedDbStore(name = "slot-spine-gemini", store = "risposte") {
  if (typeof indexedDB === "undefined") return null;
  let dbp = null;
  const db = () => (dbp ||= new Promise((ok, ko) => {
    const r = indexedDB.open(name, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(store);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
  }));
  const tx = async (mode, fn) => { const d = await db(); return new Promise((ok, ko) => { const t = d.transaction(store, mode), s = t.objectStore(store), q = fn(s); t.oncomplete = () => ok(q?.result); t.onerror = () => ko(t.error); }); };
  return { get: (k) => tx("readonly", (s) => s.get(k)), set: (k, v) => tx("readwrite", (s) => s.put(v, k)) };
}
