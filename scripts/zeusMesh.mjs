// Prova "zeus mesh": Zeus in mesh pesata con tagli automatici (src/lib/meshRig.js).
// Uso: node scripts/zeusMesh.mjs [cartella] [moltiplicatore ampiezze] [fotogrammi]
// Scrive il pacchetto Spine 4.1: zeus_mesh.json + zeus_mesh.atlas + zeus_mesh.png (pagina unica, per il runtime)
// e images/<pezzo>.png (per Spine: Import Data). Più i fotogrammi di controllo _frame_NN.png.
// Versione 1 (tutto mesh): git checkout zeus-mesh-1.
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import { recognizeParts, foregroundFromUniformBorder } from "../src/lib/partRecognition.js";
import { buildMeshRig, packAtlas, MESH_RIG_RULES } from "../src/lib/meshRig.js";
import { renderFrame } from "./renderSpine.mjs";

const OUT = process.argv[2] || "prototipi/zeus_mesh_5";
const FRAMES = Number(process.argv[4] || 60); // fotogrammi di controllo sul loop (60 = 10 al secondo)
const BOOST = Number(process.argv[3] || 1);
const D = "tests/fixtures/exploded/zeus/";
const o = PNG.sync.read(fs.readFileSync(D + "original.png")), W = o.width, H = o.height, rgba = o.data;
const c = PNG.sync.read(fs.readFileSync(D + "categorie.png"));
const categories = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) categories[i] = Math.round(c.data[i * 4] / 40);
const landmarks = JSON.parse(fs.readFileSync(D + "landmarks.json", "utf8")).landmarks.map(([x, y, v]) => ({ x, y, visibility: v }));
const alpha = foregroundFromUniformBorder({ width: W, height: H, rgba, categories });
const fg = Uint8Array.from(alpha, (a) => (a >= 0.5 ? 1 : 0));
const rec = recognizeParts({ width: W, height: H, landmarks, categories, alpha, rgba });
const rules = { ...MESH_RIG_RULES, amp: Object.fromEntries(Object.entries(MESH_RIG_RULES.amp).map(([k, v]) => [k, v * BOOST])) };
const { json, images, report } = buildMeshRig({ width: W, height: H, rgba, fg, parts: rec.parts, categories, landmarks, joints: rec.joints }, rules);

fs.mkdirSync(path.join(OUT, "images"), { recursive: true });
const writePng = (file, im) => { const p = new PNG({ width: im.width, height: im.height }); p.data = Buffer.from(im.rgba); fs.writeFileSync(file, PNG.sync.write(p)); };
json.skeleton.images = "./images/";
fs.writeFileSync(path.join(OUT, "zeus_mesh.json"), JSON.stringify(json, null, 1));
const page = packAtlas(images, "zeus_mesh.png");
fs.writeFileSync(path.join(OUT, "zeus_mesh.atlas"), page.text);
writePng(path.join(OUT, "zeus_mesh.png"), page);
for (const [n, im] of Object.entries(images)) writePng(path.join(OUT, "images", n + ".png"), im);
// controlli del metodo mesh: tests/meshRig.test.mjs (i controlli dei raccordi di simulateLoop valgono per i pezzi rigidi)
console.log(JSON.stringify(report, null, 1));

// fotogrammi: tutti gli slot nell'ordine di disegno (FRAMES sul loop + 1 a occhi chiusi)
const times = [...Array.from({ length: FRAMES }, (_, f) => (f / FRAMES) * MESH_RIG_RULES.loopSeconds), MESH_RIG_RULES.blinkAt + 0.133];
times.forEach((t, f) => fs.writeFileSync(path.join(OUT, `_frame_${String(f).padStart(2, "0")}.png`), PNG.sync.write(renderFrame(json, images, "ambient", t, { scale: 0.5 }))));
