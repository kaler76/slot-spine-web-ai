// src/lib/partsList.js — PARTS_LIST tipizzato per vista: unica fonte per il
// blocco "PARTS" interpolato in promptDecompose (vedi getPartsListText),
// invece di scrivere a mano una lista diversa per ogni vista — che è
// esattamente il modo in cui queste liste divergono tra loro nel tempo.
//
// Ogni parte porta una part_key stabile (riusabile a valle nel rig), il lato
// secondo la convenzione del PERSONAGGIO (mai dello schermo, SPINE_RULES
// regola 6), e se in QUESTA vista passa davanti o dietro al torso: serve sia
// per l'ordine di lettura nel prompt sia per sapere quali parti vanno
// ricostruite per intero perché in questa vista sono parzialmente nascoste
// (SPINE_RULES regola 1 e 5).
//
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
  { key: "head", label: "head, including neck" },
  { key: "torso", label: "torso, chest to pelvis top" },
  { key: "pelvis", label: "pelvis / hip block" },
  { key: "upper_arm", label: "upper arm, shoulder to elbow", limb: true },
  { key: "forearm", label: "forearm, elbow to wrist", limb: true },
  { key: "hand", label: "hand, wrist to fingertips", limb: true },
  { key: "thigh", label: "thigh, hip to knee", limb: true },
  { key: "shin", label: "shin, knee to ankle", limb: true },
  { key: "foot", label: "foot, ankle to toe, flat sole", limb: true }
];

/** Espande le parti "limb" (definite una volta) in coppia sinistra/destra secondo la convenzione del PERSONAGGIO — mai dello schermo (SPINE_RULES regola 6). */
function expandSides(passesBySide) {
  const parts = [];
  for (const p of CORE_PARTS) {
    if (!p.limb) {
      parts.push({ key: p.key, label: p.label, side: "center", passes: "side", reconstruct: false });
      continue;
    }
    for (const side of ["left", "right"]) {
      const passes = passesBySide[side];
      parts.push({
        key: `${p.key}_${side}`,
        label: `${side} ${p.label}`,
        side,
        passes,
        reconstruct: passes === "back"
      });
    }
  }
  return parts;
}

/** @type {Record<'front'|'three_quarter'|'side'|'back', PartSpec[]>} */
export const PARTS_BY_VIEW = {
  // 0°: braccia e gambe pendono a fianco del corpo, nessuna occlusione dal torso.
  front: expandSides({ left: "side", right: "side" }),
  // 45°: il lato sinistro del personaggio ruota via dalla camera e passa
  // dietro al torso; il lato destro (vicino alla camera) passa davanti.
  three_quarter: expandSides({ left: "back", right: "front" }),
  // 90°, personaggio di profilo verso destra (vedi promptIdentity): il lato
  // sinistro è quasi interamente nascosto dietro al torso, il destro è il
  // più vicino alla camera.
  side: expandSides({ left: "back", right: "front" }),
  // 180°: personaggio di spalle. Braccia e gambe tornano a fianco del corpo
  // senza occlusione — le etichette sinistra/destra restano quelle del
  // personaggio, non si invertono perché lo vediamo da dietro.
  back: expandSides({ left: "side", right: "side" })
};

/** Converte l'elenco tipizzato in blocco di testo numerato per il prompt — l'unico punto in cui partsList diventa stringa, così non viene mai scritto a mano. */
export function getPartsListText(view) {
  const parts = PARTS_BY_VIEW[view];
  if (!parts) {
    throw new Error(`Vista sconosciuta: "${view}". Valori ammessi: ${Object.keys(PARTS_BY_VIEW).join(", ")}`);
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
