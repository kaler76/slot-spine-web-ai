// src/lib/promptIdentity.js — Prompt A (identity/turnaround lock). Gira una
// volta per personaggio: produce la reference visiva canonica su cui si
// ancorano tutte le chiamate di promptDecompose (vedi promptDecompose.js).

import { NEGATIVE } from "./spineRules.js";

export const promptIdentity = ({ character, style, palette }) => `
ROLE
2D game character artist producing a production turnaround reference sheet.

SUBJECT
${character}

STYLE
${style}. Palette: ${palette}. Flat cel shading, max 2 shadow tones + 1 highlight.

OUTPUT
One PNG, 2560x1024, background solid pure magenta #FF00FF.
Five full-body views of the SAME character, one horizontal row, identical scale,
identical height, same invisible ground line, in order:
front 0deg | three-quarter front 45deg | side 90deg facing right |
three-quarter back 135deg | back 180deg.

POSE (identical in all five)
Neutral A-pose, arms straight lowered ~40deg, legs straight and parallel, feet
flat, head level, neutral expression.

CONSISTENCY LOCK
Same proportions, costume, palette, line weight and shading in all five views.
Same eye / shoulder / hip / knee / foot height line in every view. Every costume
element visible in one view is accounted for in the others.
${NEGATIVE}
no varying scale between views, no expression change, no pose change.`;
