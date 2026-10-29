// Web Worker: dal kit (posa neutra + tavola corpo + tavola viso) al pacchetto Spine 4.1 animato.
// Gira fuori dal thread della pagina perché l'importazione richiede alcuni secondi.
// Ingresso: { reference, bodySheet, faceSheet } = { width, height, rgba(ArrayBuffer) }, name, options.
// Uscita: { ok, json, atlas, page: { width, height, rgba }, report, clamped } oppure { ok: false, error }.
import { importBipedKit } from "./kitImport.js";
import { buildBipedSkeleton } from "./bipedRig.js";
import { addLibraryAnimations } from "./animationLibrary.js";
import { packAtlas } from "../meshRig.js";

const img = (o) => ({ width: o.width, height: o.height, rgba: new Uint8ClampedArray(o.rgba) });

self.onmessage = (e) => {
  const { reference, bodySheet, faceSheet, name = "personaggio", options = {} } = e.data;
  try {
    const t0 = performance.now();
    const { kit, images, report } = importBipedKit(
      { reference: img(reference), bodySheet: img(bodySheet), faceSheet: img(faceSheet) },
      { name, ...options }
    );
    const rig = buildBipedSkeleton(kit);
    const anims = addLibraryAnimations(rig);
    const page = packAtlas(images, `${name}.png`, { maxWidth: 2048 });
    const clamped = anims.flatMap((a) => a.clamped || []);
    self.postMessage(
      {
        ok: true,
        json: rig.json,
        atlas: page.text,
        page: { width: page.width, height: page.height, rgba: page.rgba.buffer },
        report,
        clamped,
        seconds: (performance.now() - t0) / 1000
      },
      [page.rgba.buffer]
    );
  } catch (err) {
    self.postMessage({ ok: false, error: String(err?.message || err) });
  }
};
