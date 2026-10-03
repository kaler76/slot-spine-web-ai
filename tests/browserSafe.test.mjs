// Il codice di src/ gira nel BROWSER: niente variabili di Node (process, require, __dirname).
// Caso reale: un "process.env.DBG" lasciato per il debug ha bloccato l'import della tavola
// ("process is not defined").
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const src = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const files = [];
(function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (/\.(js|jsx)$/.test(f)) files.push(p);
  }
})(src);

test("src/ senza process / require / __dirname (codice per il browser)", () => {
  const bad = [];
  for (const f of files) {
    const lines = fs.readFileSync(f, "utf8").split(/\r?\n/);
    lines.forEach((l, i) => {
      const code = l.replace(/\/\/.*$/, "");
      if (/\bprocess\.|\brequire\(|__dirname/.test(code)) bad.push(`${path.relative(src, f)}:${i + 1}: ${l.trim()}`);
    });
  }
  assert.deepEqual(bad, []);
});
