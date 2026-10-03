// scripts/partmap.mjs — genera la MAPPA DELLE PARTI di un personaggio con Gemini (Edge Function
// generate-sprite-sheet, promptOverride) e la salva accanto all'originale.
// Uso (PowerShell, dalla cartella del progetto):
//   node scripts/partmap.mjs tests/fixtures/exploded/jessica
// Legge <cartella>/original.png e <cartella>/partmap_prompt.txt, scrive <cartella>/partmap.png.
// Chiave e URL da .env.local (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY): la chiave di Gemini
// resta nei Secrets di Supabase.
import fs from "node:fs";
import path from "node:path";

const dir = process.argv[2];
if (!dir) throw new Error("Uso: node scripts/partmap.mjs <cartella con original.png>");
const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);
const url = `${env.VITE_SUPABASE_URL}/functions/v1/generate-sprite-sheet`;
const key = env.VITE_SUPABASE_ANON_KEY;
const promptFile = fs.existsSync(path.join(dir, "partmap_prompt.txt")) ? path.join(dir, "partmap_prompt.txt") : "tests/fixtures/exploded/jessica/partmap_prompt.txt";
const body = {
  group: "body",
  promptOverride: fs.readFileSync(promptFile, "utf8"),
  referenceImagesBase64: [fs.readFileSync(path.join(dir, "original.png")).toString("base64")],
  referenceAnalysisError: "skip" // niente analisi testuale: serve solo la mappa
};
console.log("Genero la mappa delle parti con Gemini (fino a 2 minuti)...");
const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": "application/json" }, body: JSON.stringify(body) });
const data = await res.json();
if (!res.ok || !data.imageBase64) throw new Error(`Errore ${res.status}: ${JSON.stringify(data).slice(0, 400)}`);
const out = path.join(dir, "partmap.png");
fs.writeFileSync(out, Buffer.from(data.imageBase64, "base64"));
console.log(`Fatto: ${out}`);
