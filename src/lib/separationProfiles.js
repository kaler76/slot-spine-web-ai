// src/lib/separationProfiles.js — PROFILI DI SEPARAZIONE della tavola esplosa.
// "standard": regole approvate (folletto, avvocato, Zeus) — invariate.
// "testa-busto": personaggi con petto e spalle scoperti sopra l'abito e capelli lunghi (Jessica,
// 3 ott 2026). Riferimento grafico per divisione e attacchi: la tavola corretta di Jessica;
// riferimento per identità, colori, posa, proporzioni e dimensioni: l'immagine originale.
// Stato del profilo: DA VALIDARE IN MOVIMENTO (la tavola è un riferimento grafico, non un caso
// approvato). Puro: nessun DOM.

/**
 * Ruoli del profilo TESTA-BUSTO: 12 pezzi (13 con il ciuffo facoltativo, P7.3), ognuno associato esplicitamente al suo ruolo
 * (mai dedotto solo da colore o dimensione). parent = genitore nel rig.
 */
export const TESTA_BUSTO_ROLES = [
  { name: "testa", label: "Testa-busto", parent: "busto" },
  { name: "ciocca_dx", label: "Ciocca anteriore destra", parent: "testa" },
  { name: "ciocca_sx", label: "Ciocca anteriore sinistra", parent: "testa" },
  { name: "sopracciglio_dx", label: "Sopracciglio destro", parent: "testa" },
  { name: "sopracciglio_sx", label: "Sopracciglio sinistro", parent: "testa" },
  { name: "occhio_dx", label: "Occhio destro", parent: "testa" },
  { name: "occhio_sx", label: "Occhio sinistro", parent: "testa" },
  { name: "bocca", label: "Bocca", parent: "testa" },
  { name: "capelli_dietro", label: "Capelli posteriori", parent: "testa" },
  // 13° pezzo FACOLTATIVO (P7.3): ciuffo davanti all'occhio, se non coincide con una ciocca
  { name: "ciuffo", label: "Ciuffo davanti all'occhio", parent: "testa", optional: true },
  { name: "braccio_alzato", label: "Braccio alzato (con mano e oggetto)", parent: "busto" },
  { name: "braccio_abbassato", label: "Braccio abbassato", parent: "busto" },
  { name: "busto", label: "Vestito con gambe e scarpe", parent: null }
];

export const PROFILES = {
  standard: {
    id: "standard",
    label: "Standard (folletto, avvocato, Zeus)",
    roles: null, // nomi dedotti dalle regole approvate
    wristCut: true, // mano + oggetto lungo tagliati al polso (handObject.js)
    fillFromOriginal: true // resto_N e riempimento per vicinanza ammessi
  },
  "testa-busto": {
    id: "testa-busto",
    label: "Testa-busto (petto scoperto, capelli lunghi: Jessica)",
    roles: TESTA_BUSTO_ROLES,
    wristCut: false, // braccio alzato, mano e oggetto restano UN pezzo
    fillFromOriginal: false // vietato nascondere una separazione sbagliata con pixel dell'originale
  }
};
export const DEFAULT_PROFILE = "standard";

/** Prompt della tavola esplosa per il profilo TESTA-BUSTO (12 pezzi + ciuffo, correzioni P7). */
export function buildTestaBustoPrompt(chroma = { name: "blue", hex: "#0018FF" }) {
  return `Using the attached character image, create an EXPLODED VIEW sheet of the SAME character for 2D skeletal animation (Spine). This is a technical asset sheet, not a new illustration.

REFERENCE
- The attached image is the reference for identity, colors, pose, angles, scale, proportions and size. Do not redesign, restyle, re-pose, rotate or rescale anything. Only move the pieces apart.
- Same canvas size and aspect ratio as the attached image.

12 PIECES (13 with the forelock, see 13), each separate with a clear ${chroma.name} gap around it, nothing touching or overlapping:
1. HEAD-BUST: head, ears, earrings, short front hair, neck, collarbones and the visible skin of the chest down to the neckline. Any hidden extension of the chest continues only BEHIND the top edge of the dress, never on top of it. Its side edges follow the natural attachment of the arms toward the armpits: NO fragments of the arms and NO shoulder caps on this piece.
2-3. The two long FRONT HAIR LOCKS, each its own piece, not duplicated on the head.
4-5. LEFT EYEBROW and RIGHT EYEBROW.
6-7. LEFT EYE and RIGHT EYE, open, with lashes.
8. MOUTH (lips).
9. BACK HAIR: the whole hair volume behind the head and shoulders, one independent piece, completed where it was hidden.
10. RAISED ARM, complete from the shoulder to the fingertips, with glove, hand AND the held object in the SAME piece (do not cut at the wrist). Still bent exactly as in the original.
11. LOWERED ARM, complete from the shoulder to the fingertips, same inclination as in the original.
12. DRESS, complete, with the bustier, legs and shoes.
13. FORELOCK: the front lock of hair that falls over the eye on the left side of the image, as its own piece, separate from the back hair and from the side locks. Same outline, length and position as in the original. Remove it from the head and repaint the forehead and the eye area underneath. Do NOT move the eye. If this forelock is the same lock as piece 2 or 3, do not draw it twice: keep only that piece.

CONTINUITY (when the pieces are put back together)
- The pieces are separate for animation but must look continuous when reassembled: no double bands of skin, no color steps, no hard edges, no duplicated shoulders.
- At every joint the pieces OVERLAP, with colors and shading consistent with the original.
- Do NOT feather or blur the outer outlines into transparency to hide errors: clean, sharp outer edges.

ARM ATTACHMENTS (essential)
- Each arm has its own complete rounded shoulder, reconstructed also where the bust hid it.
- Extend each arm attachment slightly under the bust, so there is enough overlap for movement.
- Continue the skin shading across the joint: no new black lines, no dark rings, no flat stump surfaces on the internal cuts. Keep the original exterior outlines.

FACE AND HAIR
- On the HEAD-BUST: CLOSED EYELIDS with makeup and lash line where the eyes were; smooth even skin where the eyebrows and the mouth were. No holes.
- Keep the nose intact on the head: original position and shape, with tip, nostrils, shadows and highlights. Repaint ONLY inside the eye, eyebrow and mouth areas: do not erase or flatten the nose and do not smooth the whole center of the face.
- The separate face parts keep their ORIGINAL size and shape: eyebrows above the eyes, mouth below, left stays left and right stays right. Place them together beside the head, arranged like on the face.
- Back hair separate and completed; the two front locks independent; the forelock in front of the face and eye.

SHEET
- Keep the dress at its original position and size; arms beside it at their original height; head-bust, locks, face parts and back hair in the free space above.
- Background: flat solid pure ${chroma.name} ${chroma.hex}, no smoke, no shadows, no glow, no text, no particles.`;
}
