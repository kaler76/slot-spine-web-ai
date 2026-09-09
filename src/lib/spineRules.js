// src/lib/spineRules.js — unica sorgente di verità per i vincoli condivisi tra
// promptIdentity e promptDecompose (parts list, regole di giunto, negative,
// formato output). Non duplicare questo blocco nei due prompt: è esattamente
// così che le regole di giunto/cella divergono tra i due file nel tempo.

export const SPINE_RULES = `
HARD RULES
1. Draw each part COMPLETE, including portions hidden behind other parts.
2. Every rotating joint end terminates in a full round cap, as close to a
   perfect circle as possible. Never a flat or angled cut.
3. Each child segment includes overlap material of ~one joint radius.
4. Outlines drawn above and below every intersection area.
5. Front-passing and back-passing elements are separate complete parts.
6. Left/right refer to the CHARACTER's left and right.
7. Limb segments straight and axis-aligned. No diagonals, no bent joints.
8. sRGB. Flat frontal lighting. No cast shadows, no gradients across parts.`;

export const OUTPUT_RULES = ({ canvas, gap }) => `
OUTPUT
One PNG, ${canvas}, background: solid pure magenta #FF00FF, uniform, no gradient,
no noise, no magenta halo on artwork edges, magenta never inside the character.
Exploded grid, reading order left-to-right top-to-bottom, minimum ${gap}px
between parts. No part touches or overlaps another. All parts at 1:1 scale.`;

export const NEGATIVE = `
NEGATIVE
no background art, no ground shadow, no drop shadow, no reflections, no text,
no labels, no numbers, no frames, no grid lines, no watermark, no assembled
figure, no duplicate parts, no cropped parts, no dynamic pose, no perspective,
no motion blur, no depth of field, no photographic realism.`;
