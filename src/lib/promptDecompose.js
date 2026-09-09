// src/lib/promptDecompose.js — Prompt B (decomposition / skin variant), unico
// prompt per entrambi i lavori: turnaround → parts sheet e skin variant sono
// lo stesso prompt con un parametro MODE, non due file separati (vedi
// spineRules.js per il perché: fonderli evita che le regole di giunto/cella
// divergano tra due sorgenti nel tempo).
//
// partsList va generato con getPartsListText(view) da partsList.js — non va
// mai scritto a mano qui, altrimenti la lista smette di essere la stessa
// sorgente per ogni vista.

import { SPINE_RULES, OUTPUT_RULES, NEGATIVE } from "./spineRules.js";

export const promptDecompose = ({
  mode,           // 'VIEW' | 'SKIN'
  view,           // front | three_quarter | side | back
  variant,        // solo per SKIN
  partsList,      // testo prodotto da getPartsListText(view), vedi partsList.js
  canvas, gap,
}) => `
INPUT: the attached anchor image.
TASK: ${mode === 'VIEW'
  ? `decompose the ${view} view of this character into a Spine-ready parts sheet.`
  : `produce the "${variant}" skin variant of the attached parts sheet.`}

Preserve the anchor artwork exactly: same proportions, palette, line weight and
shading. Do not restyle, do not redraw, do not add detail.

RECONSTRUCTION
Inpaint every occluded area with what logically sits behind the occluder (torso
under the arms, hair behind the head, thigh under the skirt). Extend each
reconstruction at least one joint diameter beyond the visible edge.
Straighten every limb segment to a neutral axis-aligned orientation, keeping its
original length and volume. Round every joint end into a circular cap.

${mode === 'SKIN' ? `
LAYOUT LOCK
Identical canvas, identical grid, identical cell positions. Every part occupies
the SAME cell as the input, same anchor point, same bounding-box centre, same
orientation, same joint-cap radius and offset. Artwork may change; position,
scale and rotation may not. Parts unaffected by the variant are reproduced
pixel-identical. No new parts, no removed parts.
` : ''}
PARTS — exactly these, in this order, one per cell:
${partsList}
${SPINE_RULES}
${OUTPUT_RULES({ canvas, gap })}
${NEGATIVE}${mode === 'SKIN' ? '\nno re-layout, no re-scaling, no re-posing.' : ''}`;
