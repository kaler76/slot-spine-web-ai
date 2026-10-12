// Cache di sessione: nessun dato immagine scritto su disco o inviato per calcolare la chiave.
// I risultati, inclusi i rifiuti, restano disponibili fino al ricaricamento della pagina.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, canonical(value[key])])
  );
  return value;
}

async function digest(bytes) {
  const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (v) => v.toString(16).padStart(2, "0")).join("");
}

export async function imageCacheKey({ width, height, rgba }, fg) {
  const [pixels, mask] = await Promise.all([digest(rgba), digest(fg)]);
  return `${width}x${height}:${pixels}:${mask}`;
}

export function editCacheKey(imageKey, kind, inputs) {
  return JSON.stringify(["mesh-gemini-cache-v1", imageKey, kind, canonical(inputs)]);
}

export function createGeminiCache() {
  const entries = new Map();
  return {
    run(key, generate, { force = false } = {}) {
      const previous = entries.get(key);
      // Anche un doppio click su Ridisegna condivide la richiesta già in corso.
      if (previous && (!force || previous.pending)) return previous.promise;
      const entry = { pending: true, promise: null };
      entry.promise = Promise.resolve().then(generate).then(
        (value) => { entry.pending = false; return value; },
        (error) => { entry.pending = false; throw error; }
      );
      entries.set(key, entry);
      return entry.promise;
    }
  };
}

export const geminiCache = createGeminiCache();
