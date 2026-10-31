// PROMPT DELLE 3 TAVOLE di un personaggio "nato per Spine" (posa neutra, tavola corpo a 9 pezzi,
// tavola viso) con dentro le regole imparate: C6 posa a metà escursione, C7 personaggio progettato
// per Spine. Usati dalla generazione (Edge Function) partendo da un simbolo dello Studio o da una
// descrizione. Vedi constructionRules.js.

/** Avvisi di progetto (C7) sulla descrizione del personaggio: cose che a pezzi non si animano bene. */
export function designWarnings(description = "") {
  const d = description.toLowerCase();
  const w = [];
  const has = (re) => re.test(d);
  if (has(/bell sleeve|wide sleeve|flowing sleeve|maniche (a campana|larghe|ampie)|kimono/)) w.push("maniche larghe o a campana: coprono il busto e si stirano muovendo il braccio → maniche aderenti");
  if (has(/long (wavy |straight |flowing )?hair|capelli lunghi|very long hair|braids? (over|on) the shoulders/)) w.push("capelli lunghi sulle spalle: passano sopra le braccia → capelli corti, raccolti o dietro la schiena");
  if (has(/\bcape\b|cloak|mantello|mantella|cappa/)) w.push("mantello: sta dietro a tutto e si scopre muovendo le braccia → niente mantello o solo corto dietro le spalle");
  if (has(/crossed arms|arms crossed|braccia incrociate|conserte/)) w.push("braccia incrociate: non si separano → braccia lungo i fianchi");
  if (has(/holding|in (his|her) hand|impugna|tiene in mano|sword|spada|staff|bastone/)) w.push("oggetto in mano: va nella mano come pezzo a parte (regola mano-oggetto) → posa neutra a mani vuote");
  return w;
}

const POSE = (arms = 35) =>
  `POSE (neutral animation rest pose, middle of the range of motion): body and head facing the viewer straight on; both arms hanging relaxed and away from the body (about ${arms} degrees from vertical), elbows slightly bent, wrists straight, both hands open and relaxed with fingers together, palms toward the body. The arms are NOT crossed and hold NOTHING. Arms must not overlap the torso more than at the shoulders. Mouth closed with a gentle friendly smile, eyes open looking at the viewer.`;

const DESIGN =
  "DESIGN FOR SKELETAL ANIMATION: fitted sleeves or bare arms (no wide or bell sleeves), hair short or tied so it never touches the arms, no cape or cloak covering the arms, arms clearly separated from the body, nothing pointed toward the viewer.";

const GREEN = "BACKGROUND: solid flat pure green #00FF00, perfectly uniform, no shadow, no glow, no gradient, no text, no frame.";

/**
 * @param {{ description: string, he?: boolean, fromReference?: boolean, framing?: string, arms?: number,
 *   headParts?: string, torsoParts?: string, sleeve?: string }} c
 * @returns {{ neutro: string, kit_corpo: string, kit_viso: string, warnings: string[] }}
 */
export function buildKitPrompts(c) {
  const his = c.he === false ? "her" : "his";
  const framing = c.framing || "from the top of the head down to the hips, centered, the whole figure visible with margin on every side";
  const neutro = [
    c.fromReference
      ? `Redraw EXACTLY the same character as the reference image (${c.description}; same face, colors, line art, shading and art style), redrawn in HIGH DETAIL at full resolution, as a HALF-BODY character for 2D skeletal animation in Spine.`
      : `Original character for an online slot game, designed for 2D skeletal animation in Spine. Polished painted cartoon slot-game style, bold clean line art, rich colors, soft cel shading. CHARACTER: ${c.description}.`,
    `FRAMING: ${framing}.`,
    POSE(c.arms ?? 35),
    DESIGN,
    `${GREEN} The character must not contain pure green.`
  ].join("\n\n");
  const kit_corpo = [
    "Using the attached character, produce an EXPLODED PARTS SHEET for 2D skeletal animation (Spine): the same character cut into separate pieces, laid out with clear empty space (at least 60 px) between every piece, each piece kept close to its original position, same orientation and same size as in the reference.",
    "PIECES (exactly these 9, each a single solid piece, no duplicates):",
    `1. HEAD: ${c.headParts || "face, ears, hair and headwear"}. Eyes, eyebrows and mouth are REMOVED: where the eyes were, paint closed eyelids with a soft line of lashes; where the eyebrows were, plain smooth skin; where the mouth was, plain smooth skin. Include the neck, extended a little downward so it can tuck under the torso.`,
    "2. BACK HAIR: the hair at the back of the head and nape, as one separate piece, completed where the head hid it.",
    `3. TORSO: ${c.torsoParts || "the clothing of the upper body"}, from the base of the neck down to the bottom of the figure (legs or trousers included). NO arms. The shoulders are complete and rounded where the arms were attached (redraw the hidden shoulder area).`,
    "4. UPPER ARM on the character's RIGHT side (viewer's left): from shoulder to elbow, both ends finished with a full rounded cap.",
    `5. FOREARM on the character's right: ${c.sleeve || "sleeve"} from elbow to wrist, both ends rounded caps.`,
    "6. HAND on the character's right: open relaxed hand from the wrist, wrist end rounded (cuff included in the forearm, never a separate piece).",
    "7. UPPER ARM on the character's LEFT side (viewer's right), rounded caps.",
    `8. FOREARM on the character's left, ${c.sleeve || "sleeve"}, rounded caps.`,
    "9. HAND on the character's left, open relaxed hand, wrist end rounded.",
    "Every joint end (shoulder, elbow, wrist) must be a complete round cap with a little extra overlap material, never a flat or angled cut, so the pieces can rotate without gaps. Hidden areas are redrawn completely.",
    GREEN.replace("no text, no frame.", "no text, no labels, no numbers, no grid lines, no frame."),
    "Same art style, line art, colors, shading and SCALE as the reference image. Pieces are only moved apart, NEVER rotated, NEVER resized, NEVER redrawn in a different pose."
  ].join("\n");
  const kit_viso = [
    `Using the attached character, draw ONLY ${his} facial features as separate small pieces for 2D animation, at EXACTLY the same size and style as on ${his} face in the reference (do not enlarge them), laid out in two rows with clear empty space between pieces.`,
    `ROW 1 (left to right): ${his} eye on the character's right (viewer's left) open, ${his} eye on the character's left open (each eye with its white, iris, pupil, upper lid line and lashes, no eyebrow); ${his} eyebrow on the character's right; ${his} eyebrow on the character's left.`,
    "ROW 2 (left to right), FIVE mouth variants, each with only the lips and a little surrounding skin (moustache and beard stay on the head): 1) closed gentle smile (as in the reference), 2) wide open laughing mouth with teeth, 3) round surprised 'O' mouth, 4) big happy grin, 5) sad mouth with corners down.",
    GREEN.replace("no text, no frame.", "no text, no labels, no numbers, no grid lines, no frame."),
    "Same art style, line art, colors, shading and SCALE as the reference image. Pieces are only moved apart, NEVER rotated, NEVER resized, NEVER redrawn in a different pose."
  ].join("\n\n");
  return { neutro, kit_corpo, kit_viso, warnings: designWarnings(c.description) };
}
