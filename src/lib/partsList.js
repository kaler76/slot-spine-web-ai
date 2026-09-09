// src/lib/partsList.js — PARTS_LIST tipizzato per vista E per scope: unica
// fonte per il blocco "PARTS" interpolato in promptDecompose (vedi
// getPartsListText), invece di scrivere a mano una lista diversa per ogni
// combinazione vista/scope — che è esattamente il modo in cui queste liste
// divergono tra loro nel tempo.
//
// scope di default è "bust" (mezzo busto, coerente con il formato simbolo
// slot attuale: niente gambe/pelvi) — "full_body" (con gambe, per il
// turnaround completo) va richiesto esplicitamente dal chiamante.
//
// Ogni parte porta una part_key stabile (riusabile a valle nel rig), il lato
// secondo la convenzione del PERSONAGGIO (mai dello schermo, SPINE_RULES
// regola 6), e se in QUESTA vista passa davanti o dietro al torso: serve sia
// per l'ordine di lettura nel prompt sia per sapere quali parti vanno
// ricostruite per intero perché in questa vista sono parzialmente nascoste
// (SPINE_RULES regola 1 e 5).
//
// @typedef {'bust'|'full_body'} Scope
// @typedef {Object} PartSpec
// @property {string} key - part_key stabile, snake_case, univoco per vista
// @property {string} label - descrizione della parte per il prompt, in inglese
// @property {'left'|'right'|'center'} side - lato secondo il PERSONAGGIO
// @property {'front'|'back'|'side'} passes - relazione con il torso in questa
//   vista: 'side' = a fianco del corpo, nessuna occlusione; 'front' = passa
//   davanti al torso; 'back' = passa dietro, va ricostruita per intero
// @property {boolean} reconstruct - true se la parte richiede la
//   ricostruzione della porzione nascosta in questa vista

const CORE_PARTS = [
  { key: "head", label: "head, including neck", scopes: ["bust", "full_body"] },
  {
    key: "torso",
    label: "torso, chest to waist",
    fullBodyLabel: "torso, chest to pelvis top",
    scopes: ["bust", "full_body"]
  },
  { key: "pelvis", label: "pelvis / hip block", scopes: ["full_body"] },
  { key: "upper_arm", label: "upper arm, shoulder to elbow", limb: true, scopes: ["bust", "full_body"] },
  { key: "forearm", label: "forearm, elbow to wrist", limb: true, scopes: ["bust", "full_body"] },
  { key: "hand", label: "hand, wrist to fingertips", limb: true, scopes: ["bust", "full_body"] },
  { key: "thigh", label: "thigh, hip to knee", limb: true, scopes: ["full_body"] },
  { key: "shin", label: "shin, knee to ankle", limb: true, scopes: ["full_body"] },
  { key: "foot", label: "foot, ankle to toe, flat sole", limb: true, scopes: ["full_body"] }
];

const DEFAULT_SCOPE = "bust";

/** Espande le parti "limb" (definite una volta) in coppia sinistra/destra secondo la convenzione del PERSONAGGIO — mai dello schermo (SPINE_RULES regola 6) — filtrando per scope. */
function expandSides(passesBySide, scope) {
  const parts = [];
  for (const p of CORE_PARTS) {
    if (!p.scopes.includes(scope)) continue;
    const label = scope === "full_body" && p.fullBodyLabel ? p.fullBodyLabel : p.label;
    if (!p.limb) {
      parts.push({ key: p.key, label, side: "center", passes: "side", reconstruct: false });
      continue;
    }
    for (const side of ["left", "right"]) {
      const passes = passesBySide[side];
      parts.push({
        key: `${p.key}_${side}`,
        label: `${side} ${label}`,
        side,
        passes,
        reconstruct: passes === "back"
      });
    }
  }
  return parts;
}

// Occlusione rispetto al torso, per vista — stessa logica per braccia e
// gambe (quando presenti): a 0°/180° pendono a fianco del corpo senza
// coprirsi; a 45°/90° il lato che ruota via dalla camera passa dietro.
const PASSES_BY_VIEW = {
  front: { left: "side", right: "side" },
  three_quarter: { left: "back", right: "front" },
  side: { left: "back", right: "front" },
  back: { left: "side", right: "side" }
};

/** @type {Record<Scope, Record<'front'|'three_quarter'|'side'|'back', PartSpec[]>>} */
export const PARTS_BY_SCOPE = Object.fromEntries(
  ["bust", "full_body"].map((scope) => [
    scope,
    Object.fromEntries(
      Object.entries(PASSES_BY_VIEW).map(([view, passesBySide]) => [view, expandSides(passesBySide, scope)])
    )
  ])
);

/** Retrocompatibilità: stesso contenuto di PARTS_BY_SCOPE.bust (scope di default). */
export const PARTS_BY_VIEW = PARTS_BY_SCOPE[DEFAULT_SCOPE];

/** Converte l'elenco tipizzato in blocco di testo numerato per il prompt — l'unico punto in cui partsList diventa stringa, così non viene mai scritto a mano. */
export function getPartsListText(view, scope = DEFAULT_SCOPE) {
  const byView = PARTS_BY_SCOPE[scope];
  if (!byView) {
    throw new Error(`Scope sconosciuto: "${scope}". Valori ammessi: ${Object.keys(PARTS_BY_SCOPE).join(", ")}`);
  }
  const parts = byView[view];
  if (!parts) {
    throw new Error(`Vista sconosciuta: "${view}". Valori ammessi: ${Object.keys(byView).join(", ")}`);
  }
  return parts
    .map((p, i) => {
      const passNote =
        p.passes === "front" ? " — passes in front of the torso"
        : p.passes === "back" ? " — passes behind the torso, reconstruct the hidden portion in full"
        : "";
      return `${i + 1}. ${p.label}${passNote}`;
    })
    .join("\n");
}
