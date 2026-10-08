// Metodo mesh su un caso di tests/fixtures/recognition/<nome>/ (image.png, categories.png, landmarks.json),
// come nella pagina Riconosci parti > Crea character. Uso: node scripts/meshCase.mjs <nome> [cartella uscita] [fotogrammi]
// Scrive <nome>.json/.atlas/.png, images/ e i fotogrammi di controllo _frame_NN.png (+ uno a occhi chiusi).
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import { recognizeParts, foregroundFromUniformBorder } from "../src/lib/partRecognition.js";
import { buildMeshRig, packAtlas, MESH_RIG_RULES } from "../src/lib/meshRig.js";
import { renderFrame } from "./renderSpine.mjs";

const NAME = process.argv[2] || "domatrice";
const OUT = process.argv[3] || `prototipi/${NAME}_mesh`;
const FRAMES = Number(process.argv[4] || 12);
const SMILE = process.argv[5] || "no";
const D = `tests/fixtures/recognition/${NAME}/`;
const img = PNG.sync.read(fs.readFileSync(D + "image.png")), W = img.width, H = img.height, rgba = img.data;
const cat = PNG.sync.read(fs.readFileSync(D + "categories.png"));
const categories = new Uint8Array(W * H), alpha = new Uint8Array(W * H);
let hasAlpha = false;
for (let i = 0; i < W * H; i++) { categories[i] = cat.data[i * 4]; alpha[i] = rgba[i * 4 + 3]; if (alpha[i] < 250) hasAlpha = true; }
const landmarks = JSON.parse(fs.readFileSync(D + "landmarks.json", "utf8")).landmarks.map(([x, y, v]) => ({ x, y, visibility: v }));
const fgA = hasAlpha ? alpha : foregroundFromUniformBorder({ width: W, height: H, rgba, categories });
const rec = recognizeParts({ width: W, height: H, landmarks, categories, alpha: fgA || undefined, rgba });
const fg = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) fg[i] = fgA ? (fgA[i] >= 128 ? 1 : 0) : categories[i] ? 1 : 0;
const { json, images, report } = buildMeshRig({ width: W, height: H, rgba, fg, parts: rec.parts, categories, landmarks, joints: rec.joints }, { ...MESH_RIG_RULES, smile: SMILE });

fs.mkdirSync(path.join(OUT, "images"), { recursive: true });
const writePng = (file, im) => { const p = new PNG({ width: im.width, height: im.height }); p.data = Buffer.from(im.rgba); fs.writeFileSync(file, PNG.sync.write(p)); };
json.skeleton.images = "./images/";
fs.writeFileSync(path.join(OUT, `${NAME}.json`), JSON.stringify(json, null, 1));
const page = packAtlas(images, `${NAME}.png`);
fs.writeFileSync(path.join(OUT, `${NAME}.atlas`), page.text);
writePng(path.join(OUT, `${NAME}.png`), page);
for (const [n, im] of Object.entries(images)) writePng(path.join(OUT, "images", n + ".png"), im);
console.log(JSON.stringify(report, null, 1));
const times = [...Array.from({ length: FRAMES }, (_, f) => (f / FRAMES) * MESH_RIG_RULES.loopSeconds), MESH_RIG_RULES.blinkAt + 0.133];
times.forEach((t, f) => fs.writeFileSync(path.join(OUT, `_frame_${String(f).padStart(2, "0")}.png`), PNG.sync.write(renderFrame(json, images, "ambient", t, { scale: 0.5 }))));
