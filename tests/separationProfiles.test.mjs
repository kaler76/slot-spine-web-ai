// Profili di separazione: il profilo TESTA-BUSTO non cambia le regole approvate (standard).
import { test } from "node:test";
import assert from "node:assert/strict";
import { PROFILES, DEFAULT_PROFILE, TESTA_BUSTO_ROLES, buildTestaBustoPrompt } from "../src/lib/separationProfiles.js";

test("profilo predefinito = standard (regole approvate: taglio al polso, riempimenti ammessi)", () => {
  assert.equal(DEFAULT_PROFILE, "standard");
  assert.equal(PROFILES.standard.wristCut, true);
  assert.equal(PROFILES.standard.fillFromOriginal, true);
});

test("TESTA-BUSTO: 12 ruoli espliciti, nomi unici, genitori validi, niente taglio al polso né riempimenti", () => {
  const p = PROFILES["testa-busto"];
  assert.equal(p.roles.length, 12);
  const names = p.roles.map((r) => r.name);
  assert.equal(new Set(names).size, 12);
  for (const r of p.roles) assert.ok(r.parent === null || names.includes(r.parent), `${r.name}: genitore ${r.parent}`);
  assert.equal(p.roles.filter((r) => r.parent === null).length, 1);
  assert.equal(p.wristCut, false);
  assert.equal(p.fillFromOriginal, false);
  assert.equal(TESTA_BUSTO_ROLES, p.roles);
});

test("prompt TESTA-BUSTO: 12 pezzi, attacchi delle braccia, braccio con oggetto non tagliato al polso", () => {
  const t = buildTestaBustoPrompt({ name: "blue", hex: "#0018FF" });
  for (const s of ["EXACTLY 12 PIECES", "HEAD-BUST", "NO shoulder caps", "complete rounded shoulder", "do not cut at the wrist", "CLOSED EYELIDS", "Keep the nose", "#0018FF"])
    assert.ok(t.includes(s), s);
});
