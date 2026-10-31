// REGOLE DI COSTRUZIONE dei personaggi "nati per Spine" — quello che l'addestramento su Maga, Zeus e
// Francese (ottobre 2026) ha insegnato, scritto come regole con soglie misurabili.
// Ogni regola dice COSA, PERCHÉ (il caso che l'ha fatta nascere) e DOVE è applicata nel codice.
// Le misure (crepe, stiramento, traiettorie) sono funzioni pure: le usano il banco di prova
// (scripts/bancoPersonaggi.mjs) e i test (tests/constructionRules.test.mjs).

export const CONSTRUCTION_RULES_VERSION = "2026-10-31.costruzione.1";

/** Soglie: "ok" = va bene, "max" = oltre è un errore che blocca. */
export const THRESHOLDS = {
  // riposo identico all'originale (pixel con differenza colore > 60, sulla figura)
  restDiffPct: { ok: 2, max: 5 },
  restUncoveredPct: { ok: 0.5, max: 1.5 },
  restExtraPct: { ok: 1, max: 2 },
  // crepe nuove in movimento (pixel vuoti che una chiusura di raggio 3 riempirebbe), % della figura
  tearsPctFig: { ok: 0.15, max: 0.6 },
  // stiramento delle mesh: % di area con anisotropia σ1/σ2 > 1,6 o compressione σ2 < 0,55 o ribaltata
  stretchMaxPct: { ok: 5, max: 8 },
  // traiettorie (mani e testa): tarate sui 48 casi degli esempi ufficiali Spine 4.1
  straightShare: { ok: 0.5, max: 0.8 }, // parte del percorso fatta in linea retta (mediana ufficiale 0,31)
  straightPaths: { ok: 0.17, max: 0.3 }, // quota dei percorsi quasi dritti sul personaggio (ufficiale 17%)
  jerk: { ok: 1.1, max: 1.6 } // salto di velocità in un fotogramma / velocità massima (p90 ufficiale 1,09)
};

export const CONSTRUCTION_RULES = [
  {
    id: "C1",
    regola: "I pixel VISIBILI a riposo vengono sempre dall'originale; la tavola esplosa riempie solo le zone nascoste (spalla sotto il braccio, collo, palpebre).",
    perche: "Francese e Zeus: la tavola ridisegnata dall'AI ha maniche più strette, cinture diverse, niente pantaloni. Riposo: Francese 22,6% → 0,8%, Zeus 36,7% → 3,4% di pixel diversi.",
    dove: "kitImport.js (tavola esplosa: transplantOriginal; tavola a griglia: ownByColor)",
    misura: ["restDiffPct", "restUncoveredPct", "restExtraPct"]
  },
  {
    id: "C2",
    regola: "Ciò che nessun pezzo della tavola copre (pantaloni, oggetti dimenticati) non si perde: va al pezzo fermo più vicino (il busto).",
    perche: "Francese: la tavola finiva alla cintura, i pantaloni sparivano.",
    dove: "kitImport.js (resti di transplantOriginal uniti al busto)",
    misura: ["restUncoveredPct"]
  },
  {
    id: "C3",
    regola: "Sotto ogni articolazione il pezzo che sta dietro si allunga sotto quello che si muove (sovrapposizione ai raccordi), solo dove a riposo è nascosto.",
    perche: "Gomiti e polsi che piegano aprivano crepe sul contorno esterno.",
    dove: "kitImport.js (underlayJoints dopo il trapianto)",
    misura: ["tearsPctFig"]
  },
  {
    id: "C4",
    regola: "Gli arti in mesh pesata prendono i pesi per PROIEZIONE sulla catena spalla→gomito→polso→dita (passaggio morbido solo attorno alle articolazioni); il busto pesa solo sulla calotta della spalla (30% dell'omero, al massimo 50%).",
    perche: "Maga: la manica a campana accanto al fianco era pesata sul busto e restava giù in posa a T, stirando la mesh sulla gonna (stiramento 11,9% → 4,7%). Il manuale Spine: i pesi automatici seguono la forma della mesh, non la semplice distanza dalle ossa.",
    dove: "bipedRig.js skinnedMesh (chainWeights), kitImport.js chainSkin sulle braccia a griglia",
    misura: ["stretchMaxPct"]
  },
  {
    id: "C5",
    regola: "Niente smussatura dei pesi di default sugli arti a catena (Smooth/Prune come nel Weights view restano un'opzione).",
    perche: "Misurato sulla Maga: 2 passate 4,7% → 6,6% di stiramento, 1 passata 5,7%.",
    dove: "bipedRig.js (chainSkin.smooth, default 0)",
    misura: ["stretchMaxPct"]
  },
  {
    id: "C6",
    regola: "La posa di riposo sta a metà dell'escursione: braccia a circa 35° dalla verticale, gomiti appena piegati, mani aperte vuote.",
    perche: "Manuale Spine (pesi): più una mesh piega dal disegno di partenza più si deforma; le animazioni vanno sia giù (delusione) sia su (potere, posa a T).",
    dove: "kitPrompts.js (posa neutra)",
    misura: ["stretchMaxPct", "tearsPctFig"]
  },
  {
    id: "C7",
    regola: "Personaggio progettato per Spine: maniche aderenti o braccia nude, capelli corti o raccolti che non toccano le braccia, niente mantello che copre le braccia, braccia staccate dal corpo, niente braccia incrociate né oggetti in mano.",
    perche: "Maga: maniche a campana, capelli lunghi sopra le braccia e mantello dietro a tutto. Ogni parte ne nasconde un'altra e muovendo si scopre ciò che nessuna regola sa inventare. Il Francese (maglia aderente) è venuto pulito al primo colpo.",
    dove: "kitPrompts.js (designWarnings + prompt)",
    misura: []
  },
  {
    id: "C8",
    regola: "Le traiettorie di mani e testa corrono su ARCHI: al massimo metà del percorso in linea retta; niente salti di velocità oltre 1,1 volte la velocità massima in un fotogramma (fuori dai contatti voluti). L'entrata arriva su un arco, non in verticale.",
    perche: "Lezione Playtika sulle traiettorie; soglie tarate sugli esempi ufficiali Spine (arco mediano 0,11, percorso dritto mediano 31%, scatto p90 1,09).",
    dove: "animationLibrary.js (introSpec su arco); misura in trajectoryStats",
    misura: ["straightShare", "jerk"]
  },
  {
    id: "C10",
    regola: "BOCCA: larga quanto la distanza fra il dentro dei due occhi (pupille: angoli della bocca sotto le pupille) e centrata sulla verticale del centro del NASO, misurato sulla posa. Una sola scala per tutte le bocche della tavola, presa dalle labbra della bocca neutra. ALTEZZA: con i baffi il labbro alto è attaccato al bordo basso dei baffi; senza baffi la linea della bocca è a 2,5 cm reali dalla base del naso (0,40 · distanza pupille, che vale ~6,3 cm).",
    perche: "Utente, 31 ott, sul Francese: la bocca della risata era troppo larga, non in asse col naso e staccata dai baffi (il +12% fisso deciso a occhio su Zeus non era una regola).",
    dove: "kitImport.js faceAndKit (R-B1 larghezza, R-B2 asse del naso, R-B3 altezza: baffi o 2,5 cm dal naso)",
    misura: []
  },
  {
    id: "C9",
    regola: "Si controlla sempre a occhio oltre che coi numeri: foglio originale | riposo | crepe in magenta | fotogramma più stirato | posa a T, più un video di tutte le animazioni.",
    perche: "Il punteggio globale non vede i difetti piccoli (ornamenti della manica rimasti sul mantello della Maga).",
    dove: "scripts/bancoPersonaggi.mjs",
    misura: []
  }
];

/** Crepe: pixel vuoti che una chiusura morfologica di raggio R riempie (fessure sottili tra pezzi). */
export function crackMask(cov, w, h, R = 3) {
  const full = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) full[i] = cov[i] >= 0.5 ? 1 : 0;
  const clo = morph(morph(full, w, h, R, true), w, h, R, false);
  const mask = new Uint8Array(w * h);
  let n = 0;
  for (let i = 0; i < w * h; i++) if (clo[i] && !full[i]) { mask[i] = 1; n++; }
  return { n, mask };
}

function morph(src, w, h, R, dilate) {
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = dilate ? 0 : 1;
    for (let k = -R; k <= R; k++) { const s = src[y * w + Math.min(w - 1, Math.max(0, x + k))]; if (dilate ? s : !s) { v = dilate ? 1 : 0; break; } }
    tmp[y * w + x] = v;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = dilate ? 0 : 1;
    for (let k = -R; k <= R; k++) { const s = tmp[Math.min(h - 1, Math.max(0, y + k)) * w + x]; if (dilate ? s : !s) { v = dilate ? 1 : 0; break; } }
    out[y * w + x] = v;
  }
  return out;
}

/**
 * Stiramento delle mesh tra riposo e fotogramma.
 * @param {Record<string,{v:Float32Array,tris:number[]}>} rest, cur - vertici mondo per slot
 * @returns {{ frac:number, worst:[string, number] }} quota d'area distorta e slot peggiore
 */
export function meshStretch(rest, cur) {
  let tot = 0, bad = 0;
  const perSlot = {};
  for (const [name, R] of Object.entries(rest)) {
    const C = cur[name];
    if (!C) continue;
    let st = 0, sb = 0;
    for (let k = 0; k < R.tris.length; k += 3) {
      const i = R.tris[k] * 2, j = R.tris[k + 1] * 2, l = R.tris[k + 2] * 2;
      const ax = R.v[j] - R.v[i], ay = R.v[j + 1] - R.v[i + 1], bx = R.v[l] - R.v[i], by = R.v[l + 1] - R.v[i + 1];
      const cx = C.v[j] - C.v[i], cy = C.v[j + 1] - C.v[i + 1], dx = C.v[l] - C.v[i], dy = C.v[l + 1] - C.v[i + 1];
      const det = ax * by - ay * bx, area = Math.abs(det) / 2;
      if (area < 1e-6) continue;
      const m00 = (cx * by - dx * ay) / det, m01 = (dx * ax - cx * bx) / det, m10 = (cy * by - dy * ay) / det, m11 = (dy * ax - cy * bx) / det;
      const E = (m00 * m00 + m10 * m10 + m01 * m01 + m11 * m11) / 2, D = m00 * m11 - m01 * m10;
      const disc = Math.sqrt(Math.max(0, E * E - D * D)), s1 = Math.sqrt(E + disc), s2 = Math.sqrt(Math.max(1e-9, E - disc));
      const distorted = s1 / s2 > 1.6 || s2 < 0.55 || D <= 0;
      st += area;
      if (distorted) sb += area;
    }
    tot += st; bad += sb;
    perSlot[name] = st ? sb / st : 0;
  }
  const worst = Object.entries(perSlot).sort((x, y) => y[1] - x[1])[0] || ["", 0];
  return { frac: tot ? bad / tot : 0, worst };
}

/**
 * Traiettoria di un punto campionato a fps fissi: il percorso si divide nei tratti fra due soste
 * (minimi di velocità); per i tratti lunghi (corda ≥ minChord) arco = scostamento massimo dalla corda /
 * corda. straightShare = parte del percorso lungo fatta in linea retta (arco < 0,06).
 * jerk = salto di velocità massimo in un fotogramma / velocità massima.
 */
export function trajectoryStats(P, { minChord = 40 } = {}) {
  const sp = [];
  let len = 0;
  for (let i = 1; i < P.length; i++) { const d = Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); sp.push(d); len += d; }
  const vmax = Math.max(1e-9, ...sp);
  const cuts = [0];
  for (let i = 1; i < sp.length - 1; i++) if (sp[i] <= sp[i - 1] && sp[i] < sp[i + 1] && sp[i] < 0.35 * vmax) cuts.push(i);
  cuts.push(P.length - 1);
  let straight = 0, long = 0, arcSum = 0;
  for (let k = 0; k < cuts.length - 1; k++) {
    const i0 = cuts[k], i1 = cuts[k + 1], [ax, ay] = P[i0], [bx, by] = P[i1], cl = Math.hypot(bx - ax, by - ay);
    let seg = 0;
    for (let i = i0 + 1; i <= i1; i++) seg += sp[i - 1];
    if (cl < minChord) continue;
    let dev = 0;
    for (let i = i0; i <= i1; i++) dev = Math.max(dev, Math.abs((P[i][0] - ax) * (by - ay) - (P[i][1] - ay) * (bx - ax)) / cl);
    long += seg; arcSum += (dev / cl) * seg;
    if (dev / cl < 0.06) straight += seg;
  }
  let jerk = 0;
  for (let i = 1; i < P.length - 1; i++) jerk = Math.max(jerk, Math.hypot(P[i + 1][0] - 2 * P[i][0] + P[i - 1][0], P[i + 1][1] - 2 * P[i][1] + P[i - 1][1]) / vmax);
  return { length: Math.round(len), arc: long ? +(arcSum / long).toFixed(2) : null, straightShare: long ? +(straight / long).toFixed(2) : 0, jerk: +jerk.toFixed(2) };
}

/**
 * Verdetto sulle misure di un personaggio.
 * @param {object} m - restDiffPct, restUncoveredPct, restExtraPct, tearsPctFig, stretchMaxPct (numeri,
 *   facoltativi) e trajectories: { [anim]: { [osso]: trajectoryStats } }
 * @returns {{ ok:boolean, errors:string[], warnings:string[] }}
 */
export function constructionVerdict(m) {
  const errors = [], warnings = [];
  const rule = (key) => CONSTRUCTION_RULES.find((r) => r.misura.includes(key))?.id || "";
  for (const key of ["restDiffPct", "restUncoveredPct", "restExtraPct", "tearsPctFig", "stretchMaxPct"]) {
    if (!Number.isFinite(m[key])) continue;
    const t = THRESHOLDS[key];
    if (m[key] > t.max) errors.push(`${rule(key)} ${key} ${m[key]} > ${t.max}`);
    else if (m[key] > t.ok) warnings.push(`${rule(key)} ${key} ${m[key]} > ${t.ok}`);
  }
  // traiettorie: negli esempi ufficiali il 17% dei percorsi è quasi dritto (> 0,8) e gli scatti
  // oltre 1,1 sono il 10%: si giudica la QUOTA sul personaggio, più un tetto per singolo scatto
  const tr = Object.entries(m.trajectories || {}).flatMap(([a, bones]) => Object.entries(bones).map(([b, s]) => ({ where: `${a}/${b}`, ...s }))).filter((s) => s.length >= 40);
  if (tr.length) {
    const straight = tr.filter((s) => s.straightShare > THRESHOLDS.straightShare.max);
    const q = straight.length / tr.length;
    const msg = `C8 percorsi quasi dritti ${Math.round(100 * q)}% (${straight.map((s) => s.where).join(", ")})`;
    if (q > THRESHOLDS.straightPaths.max) errors.push(msg);
    else if (q > THRESHOLDS.straightPaths.ok) warnings.push(msg);
    for (const s of tr) {
      if (s.jerk > THRESHOLDS.jerk.max) errors.push(`C8 scatto ${s.where} ${s.jerk} > ${THRESHOLDS.jerk.max}`);
      else if (s.jerk > THRESHOLDS.jerk.ok) warnings.push(`C8 scatto ${s.where} ${s.jerk} > ${THRESHOLDS.jerk.ok}`);
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}
