// src/workers/autoImport.worker.js — import della tavola esplosa con scelta automatica
// (autoSelect.js) fuori dal thread della pagina: 20-60 s di calcolo non bloccano l'interfaccia.
import { autoImportSheet } from "../lib/autoSelect.js";

self.onmessage = (e) => {
  try {
    const out = autoImportSheet(e.data);
    const transfer = out.pieces.map((p) => p.rgba.buffer).filter((b, i, a) => a.indexOf(b) === i);
    self.postMessage({ ok: true, out }, transfer);
  } catch (err) {
    self.postMessage({ ok: false, error: err?.message || String(err) });
  }
};
