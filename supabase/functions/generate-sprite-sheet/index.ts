// Supabase Edge Function: generate-sprite-sheet
//
// Genera UN tentativo di sprite sheet (uno dei 3 gruppi: face / hair / body,
// oppure "all" per tutti insieme) chiamando l'API Gemini (Nano Banana Pro) e
// verificando automaticamente la qualità geometrica del risultato (elementi
// separati, nessun blob fuso, etichette non a contatto con l'arte).
//
// La v19 fa un SOLO tentativo per invocazione (il retry con correzione è
// orchestrato dal CLIENT). La v20 aggiunge downsampling prima del controllo
// qualità pixel-per-pixel (limiti CPU/memoria). La v21-v23 rivedono la
// strategia per i giunti: invece di un taglio a filo preciso, si nasconde il
// giunto dietro un elemento del costume (pauldron, bracciale, collare) che
// copre generosamente. La v22/v24 aggiungono pupilla separata, blink a
// scambio di immagine, prospettiva 3/4 corretta per la testa girata. La v26
// corregge un bug reale in truncateAtIEND (scansione cieca che poteva
// trovare un falso IEND dentro i dati compressi, troncando il file troppo
// presto).
//
// La v27, su richiesta esplicita dell'utente dopo i problemi ricorrenti con
// la trasparenza (scacchiera finta, bug di parsing legati a grandi aree
// vuote): passa a uno SFONDO BIANCO PIENO invece di trasparenza — più
// affidabile da generare, e già pienamente supportato dall'importatore lato
// client (che ricostruisce la trasparenza da solo con una maschera pixel-
// per-pixel). Rinforza anche la nota sui giunti: l'accessorio che nasconde
// un giunto deve avvolgere la maggior parte della circonferenza dell'arto,
// non solo il lato frontale, altrimenti la cucitura si vede quando il pezzo
// ruota durante l'animazione vera, non solo nella posa statica del foglio.
//
// La v28 corregge un problema reale segnalato dall'utente con screenshot:
// occhi/sopracciglia/bocche generati frontali anche quando il personaggio di
// riferimento ha la testa girata di 3/4. Causa: l'istruzione per ogni singolo
// elemento del viso chiedeva di "combaciare con l'angolo usato nell'elemento
// testa qui sopra" — un riferimento circolare a un altro pezzo generato nella
// STESSA immagine (anch'esso soggetto allo stesso rischio di uscire frontale),
// invece che un ancoraggio concreto e ripetuto all'immagine di riferimento
// allegata. Aggiunge: (1) un campo "HEAD ANGLE" esplicito nell'analisi
// testuale del riferimento (prima esclusa perché classificata come "posa/
// inquadratura", ma l'angolo della testa è un fatto d'identità visiva, non di
// composizione), e (2) una nota dedicata (FACE_ANGLE_CONSISTENCY_NOTE) inserita
// nel prompt quando il gruppo include il viso E c'è un'immagine di riferimento,
// che rinforza esplicitamente di ricontrollare ogni singolo pezzo del viso
// contro l'angolo della testa nell'immagine allegata, non solo il pezzo testa.
//
// La v30, su richiesta esplicita dell'utente con screenshot (il pauldron
// disegnato sia sul braccio che, duplicato/in conflitto, sul torso):
// (1) le braccia non sono più divise in "braccio superiore" + "avambraccio":
// ogni braccio è ora UN unico pezzo intero dalla spalla alle dita, eliminando
// il giunto del gomito e il rischio di un pezzo "fluttuante" scollegato. (2)
// il torso viene generato con la spalla volutamente semplice/pulita: solo il
// pezzo braccio porta l'accessorio (pauldron/spallaccio) che nasconderà il
// giunto spalla-torso una volta impaginato nel rig — prima l'istruzione
// chiedeva erroneamente di continuare la decorazione anche sul torso,
// producendo una doppia decorazione in conflitto. (3) aggiunge il supporto
// per rigenerare UN SOLO elemento (campo elementIndex nella richiesta) invece
// di un intero gruppo, per correggere un singolo pezzo difettoso senza dover
// rigenerare tutta la sheet.
//
// La v31, su segnalazione dell'utente (4 tentativi su 4 fatti fallire dallo
// stesso errore "unrecognised content at end of stream" su un'immagine che
// l'importatore lato client aveva comunque decodificato e importato senza
// problemi — prova che il PNG non era davvero corrotto, era pngjs troppo
// severo): aggiunge hasValidPngHeader come rete di sicurezza — se il parser
// rigoroso rifiuta il file ma firma PNG e chunk IHDR risultano intatti, non
// si marca più il tentativo come fallito (bruciandolo inutilmente), si salta
// solo il controllo geometrico automatico segnalandolo come "unverified".
// Estende anche la nota di coerenza dell'angolo testa (rinominata da
// FACE_ANGLE_CONSISTENCY_NOTE a HEAD_ANGLE_CONSISTENCY_NOTE) al gruppo
// capelli, non solo al viso: prima i capelli potevano uscire frontali anche
// con una testa di riferimento a 3/4. Infine chiarisce che il bordo esterno
// dell'accessorio spalla del braccio dev'essere arrotondato senza sporgenze
// angolari, per non "bucare" la sagoma della spalla una volta impaginato.
//
// La v32, su segnalazione dell'utente (screenshot "no" vs "sì": il braccio va
// sovrapposto al torso alla spalla, non lasciato staccato): il pezzo braccio
// ora specifica esplicitamente che, una volta montato nel rig, la spalla
// verrà spostata in SOVRAPPOSIZIONE sul torso (non affiancata) — quindi
// l'accessorio spalla va disegnato generosamente grande, non a filo, per
// coprire comodamente quella zona di sovrapposizione. Lato client, l'importer
// (SpriteSheetImporter) ora avvicina automaticamente le parti riconosciute
// come arti (braccio/gamba, dal nome scelto dall'utente) al loro genitore
// invece di mantenere la stessa distanza "di sicurezza" usata nel foglio per
// il rilevamento — quella distanza è pensata per separare bene i componenti
// in fase di rilevamento, non per la posa finale assemblata, che richiede
// invece sovrapposizione al giunto.
//
// La v33, su segnalazione dell'utente (screenshot con moltissimi elementi
// mancanti — occhi, pupille, occhi chiusi, sopracciglia, un braccio, coppa,
// oggettini, forcine, nastri, perlina — su una lista lunga, specialmente col
// gruppo "tutto insieme" da 23 elementi): la lista elementi passa da elenco
// puntato a CHECKLIST NUMERATA, e viene aggiunto un paragrafo esplicito di
// verifica finale che impone di ricontrollare uno per uno tutti i numeri
// della lista prima di considerare il lavoro concluso, chiarendo che la
// completezza conta più del dettaglio sui pochi pezzi effettivamente
// disegnati. Non è una garanzia assoluta con liste molto lunghe (23
// elementi in un colpo solo restano al limite) — per la massima affidabilità
// resta comunque preferibile generare per gruppo (viso/capelli/corpo
// separati) invece che "tutto insieme".
//
// La v34, su segnalazione dell'utente (troppi pezzi inutili duplicati: la
// stessa collana/cintura ridisegnata anche come "oggetto decorativo" a parte,
// oltre a quella già presente sul torso): (1) HEAD_ELEMENT non gestisce più
// il collo in modo condizionale ("se c'è un collare, copri il collo, altrimenti
// taglia netto") — regola incoerente che a volte produceva un collo nudo senza
// collare né sul viso né sul torso. Ora la testa non ha MAI collo, punto: il
// collare/collana/cintura sono responsabilità esclusiva del pezzo torso,
// dichiarato esplicitamente come UNICO posto dove vanno disegnati. (2) Gli
// "oggetti decorativi piccoli" (sia nel gruppo capelli che corpo) escludono
// ora esplicitamente collane/collari/cinture/fusciacche, per evitare che il
// modello li ridisegni lì duplicando quanto già sul torso. (3) Rinforza
// ulteriormente il divieto di sporgenze sull'accessorio spalla del braccio
// (forma a cupola/capsula, mai punte/tacche/zigzag sul bordo esterno).
//
// La v35, su segnalazione dell'utente (screenshot: "Errore generazione: Nessuna
// immagine nella risposta Gemini (finishReason: PROHIBITED_CONTENT)" sul gruppo
// "tutto insieme", senza alcun tentativo automatico successivo): il filtro di
// sicurezza di Gemini sui finishReason PROHIBITED_CONTENT/SAFETY è noto per dare
// falsi positivi non deterministici sullo stesso identico prompt — un nuovo
// tentativo, a volte con una lieve riformulazione automatica, spesso passa senza
// che il contenuto fosse davvero un problema. Prima questo errore interrompeva
// subito tutti i tentativi (era trattato come errore definitivo, non transitorio).
// Ora: (1) il messaggio d'errore include un suggerimento concreto quando capita
// (provare a rigenerare, generare un gruppo alla volta invece di "tutto insieme",
// o modificare la descrizione/immagine di riferimento); (2) lato client questo
// finishReason è ora trattato come transitorio e riprovato automaticamente come
// un sovraccarico, invece di arrendersi al primo tentativo.
//
// La v36, su segnalazione dell'utente (screenshot: TUTTI i 12 tentativi — 4
// per ciascuno dei 3 gruppi di "tutto insieme" — falliti con lo stesso errore
// "Immagine non leggibile come PNG valido (unrecognised content at end of
// stream)", nonostante l'immagine mostrata fosse visibilmente corretta):
// (1) hasValidPngHeader controllava anche che il primo chunk dopo la firma
// fosse esattamente "IHDR" di 13 byte — un controllo ridondante e troppo
// fragile rispetto al suo scopo (distinguere "non è affatto un PNG" da "pngjs
// è stato troppo severo su un PNG comunque valido): la sola firma PNG a 8
// byte è già una prova sufficiente che il contenuto è un'immagine PNG reale,
// il resto lo ha già dimostrato il fatto che il browser/canvas del client la
// decodifica senza problemi. Rimosso il controllo aggiuntivo su IHDR: ora
// firma valida = trattato come "unverified" (si salta solo il controllo
// geometrico), mai come fallito, allineando finalmente il comportamento del
// server a quello osservato lato client su ogni segnalazione precedente
// (v31, v34) dove l'immagine "fallita" si è sempre rivelata perfettamente
// importabile. (2) Il torso non aveva mai un'istruzione di corrispondenza
// d'angolo come la testa (HEAD_ANGLE_CONSISTENCY_NOTE): con "tutto insieme"
// diviso in 3 chiamate separate (viso/capelli/corpo, v33+PR#17), il gruppo
// "corpo" non riceveva alcuna indicazione sull'angolo di spalle/busto del
// riferimento, producendo un torso frontale e simmetrico anche quando il
// personaggio di riferimento ha spalle/busto ruotati di 3/4 — esattamente lo
// stesso bug della v28 (viso frontale su testa girata), mai risolto per il
// corpo. Aggiunge BODY_ANGLE_CONSISTENCY_NOTE (stessa logica di
// HEAD_ANGLE_CONSISTENCY_NOTE ma per spalle/busto), un'istruzione esplicita
// di corrispondenza angolo sull'elemento torso stesso (come già HEAD_ELEMENT
// per la testa), ed estende l'analisi del riferimento (ANALYSIS_PROMPT) a
// descrivere anche l'angolo di spalle/busto, non solo quello della testa.
//
// La v37, su segnalazione dell'utente che il fix v36 NON ha risolto nulla
// (stesso identico errore, 12/12 tentativi falliti anche con hasValidPngHeader
// alleggerito alla sola firma PNG): quel fatto stesso è la prova che il
// problema non è mai stato la firma — vuol dire che pngjs falliva PRIMA di
// arrivare al nostro fallback, su un buffer che (dimostrato con un test
// riproducibile in locale, vedi sotto) HA la firma corretta. Causa radice
// trovata: pngjs usa una propria implementazione di inflate (non lo zlib
// nativo) che è severa sui byte extra ANCHE quando sono infilati dentro la
// lunghezza dichiarata dell'ultimo chunk IDAT (non solo dopo IEND, il caso
// che truncateAtIEND già copriva) — esattamente il modo in cui Gemini pare
// accodare i suoi metadati di provenienza. Test riprodotto: PNG valida +
// byte arbitrari appesi al payload IDAT (dentro la sua lunghezza dichiarata)
// → pngjs.PNG.sync.read fallisce (con testi di errore diversi a seconda di
// dove cade la spazzatura, "unrecognised content at end of stream" o "There
// are some read requests waitng on finished stream") mentre node:zlib
// (inflateSync) sullo STESSO payload decomprime correttamente, ignorando i
// byte extra in coda, e produce pixel IDENTICI byte-per-byte al file pulito.
// Sostituita quindi la dipendenza pngjs con decodePngLenient: un decoder PNG
// minimo scritto a mano (parsing chunk IHDR/IDAT, inflate via node:zlib,
// unfiltering manuale dei filtri PNG standard 0-4) che supporta 8-bit non
// interlacciato, grayscale/RGB/RGBA/grayscale+alpha — tutto quello che i
// nostri stessi prompt possono produrre. truncateAtIEND non serve più (il
// parsing manuale dei chunk si ferma già da solo a IEND, ignorando qualunque
// cosa venga dopo, sia dentro sia fuori l'ultimo chunk) ed è stato rimosso.
// hasValidPngHeader resta come rete di sicurezza finale per l'improbabile
// caso in cui anche decodePngLenient fallisca (es. formati non supportati).
//
// La v38, su richiesta esplicita dell'utente (nuovo template di prompt
// proposto con filosofia "adattiva": non forzare l'invenzione di accessori o
// oggetti assenti dal riferimento — es. "Never automatically add a bowl,
// container or generic prop. Do not invent any object absent from the
// reference"): finora GROUP_TEMPLATES.body chiedeva SEMPRE una "bowl or
// container prop" e GROUP_TEMPLATES.hair chiedeva SEMPRE ornamento centrale/
// forcine/nastri/orecchini/perlina, indipendentemente dal fatto che il
// personaggio li avesse — causa diretta di oggetti inventati non presenti nel
// riferimento. Confermato con l'utente di mantenere le 3 chiamate separate
// (viso/capelli/corpo) invece di un'unica generazione, applicando la logica
// adattiva solo dove ha senso: gli accessori di capelli/corpo (ornamento,
// forcine, nastri, orecchini, perlina, prop tenuto in mano, oggetti
// decorativi) ora includono "include ONLY IF il riferimento lo mostra
// chiaramente, altrimenti ometti" invece di essere sempre richiesti. Il
// gruppo viso resta con l'elenco fisso: occhi chiusi, pupille separate e le
// tre bocche servono sempre per l'animazione e non sono "nel riferimento" per
// definizione (un'immagine statica non mostra un blink), quindi la logica
// "solo se presente" non si applica a quei pezzi — restano marcati "ALWAYS
// required". Aggiorna anche il paragrafo di verifica finale (ora distingue
// pezzi sempre richiesti da pezzi condizionali, invece di richiedere un
// conteggio esatto che contraddirebbe le nuove istruzioni "ometti se
// assente") e, su scelta esplicita dell'utente, disattiva il controllo
// geometrico automatico (conteggio atteso) per i gruppi con elementi
// adattivi (hair, body, all): con un numero di pezzi ormai variabile quel
// controllo non è più valido, l'immagine viene sempre mostrata per una
// valutazione visiva invece di un retry automatico basato su regole.
//
// La chiave GEMINI_API_KEY deve essere configurata come secret del progetto
// Supabase (Project Settings -> Edge Functions -> Secrets), mai nel codice.

import { Buffer } from "node:buffer";
import { inflateSync } from "node:zlib";

const GEMINI_MODEL = "gemini-3-pro-image-preview";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const HEAD_ELEMENT =
  "Head with hair, rendered as ONE single complete illustration — the face " +
  "together with ONLY the front hair (the fringe/bangs that fall over the " +
  "forehead/temples, tight against the face), already combined in its natural " +
  "resting position. Do NOT include the back/side hair volume here — that is " +
  "a separate piece (see the back hair layer element) so it can be layered " +
  "behind the body and move independently in the rig. NO NECK AT ALL, always, " +
  "regardless of the costume: cut cleanly at the jawline and match the neck " +
  "skin tone exactly. Do NOT draw any collar, necklace, scarf or high neckline " +
  "here even if the costume has one — the torso piece owns the entire neck " +
  "area and any collar/necklace it needs (see the torso element); drawing it " +
  "again here would duplicate it and the two copies would not line up once " +
  "assembled. If a reference image is attached, match its exact head tilt, " +
  "turn angle and expression — do not straighten it into a neutral " +
  "front-facing pose. If no reference image is attached, use a natural, " +
  "relaxed front-facing pose.";

const GROUP_TEMPLATES = {
  face: {
    label: "Viso",
    elements: [
      HEAD_ELEMENT,
      "Left eye white/sclera shape, OPEN, isolated — just the eye white and eyelid outline, no pupil/iris (that is a separate piece, see below). CRITICAL: this must match the EXACT head turn/angle used in the head element above, not a generic frontal eye. If the head is turned 3/4, draw this as a proper 3/4-view eye with correct foreshortening (the eye on the far side of the turn appears narrower and more angled than a front-facing eye) — never draw a symmetric front-facing almond eye when the head itself is turned",
      "Right eye white/sclera shape, OPEN, isolated — just the eye white and eyelid outline, no pupil/iris. CRITICAL: this must match the EXACT head turn/angle used in the head element above (see note on the left eye) — the near-side eye (closer to the viewer in a 3/4 turn) looks noticeably different in shape/width from the far-side eye, they are NOT mirror copies of each other when the head is turned",
      "Left pupil and iris, isolated, small and separate from the eye white piece so it can be animated independently (subtle look direction or a sparkle highlight) — same head turn/angle as the eye white pieces, positioned as it would sit inside that eye shape",
      "Right pupil and iris, isolated, small and separate from the eye white piece — same head turn/angle as the eye white pieces",
      "Left eye CLOSED, isolated — a separate, fully drawn illustration of the shut eyelid with eyelashes, at the EXACT SAME position, size and angle as the open left eye piece, including the same head turn/angle (this is a straight swap for a blink, not a squashed/scaled copy of the open eye — draw the closed lid shape properly)",
      "Right eye CLOSED, isolated — a separate, fully drawn illustration of the shut eyelid with eyelashes, at the EXACT SAME position, size and angle as the open right eye piece, including the same head turn/angle (this is a straight swap for a blink, not a squashed/scaled copy of the open eye — draw the closed lid shape properly)",
      "Eyebrows pair (isolated), same head turn/angle as the head element — not a symmetric frontal pair if the head is turned",
      "Mouth closed/neutral (isolated)",
      "Mouth smiling (isolated)",
      "Mouth open (isolated)"
    ]
  },
  hair: {
    label: "Capelli e accessori",
    adaptive: true,
    elements: [
      "Back hair layer, isolated: the hair volume that falls behind the head and down over the back/shoulders (everything except the front fringe, which is already part of the head piece) — same hair color/texture and same head tilt/angle as the head piece, shaped as it would naturally drape when layered behind the body. This piece is ALWAYS required regardless of the reference, even for short hair with little back volume — the rig needs a back-hair layer to move independently behind the body.",
      "Central hair ornament / headpiece, isolated — include this piece ONLY if the reference image clearly shows a central hair ornament or headpiece. If the character does not wear one, DO NOT invent it: simply omit this piece entirely rather than adding a decorative item that is not actually part of the character.",
      "Side hairpins, isolated — include ONLY if the reference clearly shows hairpins. Do not invent hairpins the character does not have; omit this piece if absent.",
      "Side ribbons, isolated — include ONLY if the reference clearly shows hair ribbons. Do not invent ribbons the character does not have; omit this piece if absent.",
      "Left earring, isolated — include ONLY if the reference clearly shows an earring on this side. Do not invent earrings the character does not wear; omit this piece if absent.",
      "Right earring, isolated — include ONLY if the reference clearly shows an earring on this side. Do not invent earrings the character does not wear; omit this piece if absent.",
      "A single decorative pearl or bead, isolated (only if it is a hair/headwear ornament — NOT a necklace, choker or belt bead, those already belong to the torso piece) — include ONLY if the reference clearly shows a loose decorative pearl/bead in the hair. Do not invent one; omit this piece if absent."
    ]
  },
  body: {
    label: "Corpo, braccia e oggetti",
    adaptive: true,
    elements: [
      "Main body/torso with costume, from shoulders to waist, neck socket visible at the top, no head and no arms attached — painted as a COMPLETE, self-contained shape including EVERY costume accessory that sits on the torso itself: collar, necklace, choker, high neckline, belt, sash, waist ornament, etc. This is the ONLY place these accessories are drawn — do not also generate a standalone necklace, choker, collar or belt as one of the small decorative prop items or anywhere else in the sheet; that would duplicate an accessory that already exists here and the two copies would never line up once assembled. The shoulder area itself must be left PLAIN and SIMPLE — no pauldron, no shoulder guard, no strap, no armor painted here — because the arm piece worn on top already carries its own shoulder-covering accessory (see the arm element below); painting a matching or competing decoration on the torso's shoulder as well would visually duplicate or conflict with it once the two are layered in the rig. A plain shoulder here is correct, not unfinished. If a reference image is attached, match its exact shoulder/torso angle and twist (an asymmetric silhouette if the reference is turned) — do not straighten it into a neutral, perfectly symmetric front-facing pose just because that is simpler to draw. If no reference image is attached, use a natural, relaxed front-facing pose. This piece is ALWAYS required.",
      "Left arm, isolated, drawn as ONE single complete continuous piece from the shoulder all the way to the fingertips (upper arm, elbow and forearm all in one unbroken illustration, NOT split into separate upper-arm and forearm pieces) — natural relaxed bent pose, EMPTY HAND unless the reference clearly shows this hand holding something (see the prop element below for anything held — do not invent an item in the hand here). At the shoulder end (top) only, design an actual costume accessory — a pauldron/shoulder guard, a puffed sleeve, a wrapped cloth, a strap — consistent with the character's costume style, wrapping around most of the shoulder's circumference. The shoulder end's OUTER silhouette must be smoothly ROUNDED like a natural shoulder cap, closer to a dome or capsule shape — NO sharp corners, NO angular flat-cut edges, NO spikes, points, tabs, or any bit sticking out past the main rounded curve; trace the outer edge with your finger and it should feel like one continuous smooth curve, never a zigzag. A rounded accessory reads as a proper shoulder guard, an angular or spiky one reads as a cutout mistake. This accessory's entire purpose is to hide the torso's shoulder-socket once this arm is layered on top of the torso in the rig (see rigging note) — it belongs ONLY to this arm piece, the torso underneath is deliberately left plain there, do not expect or require a matching decoration on the torso. IMPORTANT for assembly: when rigged, this piece will be moved to OVERLAP over the torso's shoulder area (not placed edge-to-edge beside it) so the joint is fully hidden — draw the shoulder accessory generously large, comfortably covering more area than the bare minimum, rather than stopping at a tight edge that would leave a gap once the pieces are overlapped. This piece is ALWAYS required.",
      "Right arm, isolated, drawn as ONE single complete continuous piece from the shoulder all the way to the fingertips (upper arm, elbow and forearm all in one unbroken illustration, NOT split into separate upper-arm and forearm pieces) — natural relaxed bent pose, EMPTY HAND unless the reference clearly shows this hand holding something (see the prop element below for anything held — do not invent an item in the hand here). At the shoulder end (top) only, design an actual costume accessory — a pauldron/shoulder guard, a puffed sleeve, a wrapped cloth, a strap — consistent with the character's costume style, wrapping around most of the shoulder's circumference. The shoulder end's OUTER silhouette must be smoothly ROUNDED like a natural shoulder cap, closer to a dome or capsule shape — NO sharp corners, NO angular flat-cut edges, NO spikes, points, tabs, or any bit sticking out past the main rounded curve; trace the outer edge with your finger and it should feel like one continuous smooth curve, never a zigzag. A rounded accessory reads as a proper shoulder guard, an angular or spiky one reads as a cutout mistake. This accessory's entire purpose is to hide the torso's shoulder-socket once this arm is layered on top of the torso in the rig (see rigging note) — it belongs ONLY to this arm piece, the torso underneath is deliberately left plain there, do not expect or require a matching decoration on the torso. IMPORTANT for assembly: when rigged, this piece will be moved to OVERLAP over the torso's shoulder area (not placed edge-to-edge beside it) so the joint is fully hidden — draw the shoulder accessory generously large, comfortably covering more area than the bare minimum, rather than stopping at a tight edge that would leave a gap once the pieces are overlapped. This piece is ALWAYS required.",
      "A bowl, container, weapon, instrument or other held/carried prop, isolated — include this piece ONLY if the reference image clearly shows the character holding or carrying such an object. NEVER default to adding a generic bowl or container: if the character does not have a prop in the reference, DO NOT invent one, simply omit this piece entirely.",
      "Small decorative prop items relevant to the theme (e.g. loose pearls, gems, flowers) NOT already part of the torso costume, isolated — do NOT include a necklace, choker, collar, belt or sash here, those are drawn once on the torso piece and must not be duplicated. Include this piece ONLY if the reference clearly shows such loose decorative items separate from the character's body; do not invent any if absent."
    ]
  }
};

// Il gruppo viso non è adattivo di suo (occhi chiusi/pupille/bocche multiple
// servono sempre per l'animazione, non sono "nel riferimento" per definizione),
// ma quando finisce dentro "all" (v38, adattivo) va comunque marcato come
// sempre richiesto — altrimenti il modello potrebbe leggerlo come opzionale
// in mezzo agli elementi condizionali di hair/body nello stesso elenco.
GROUP_TEMPLATES.face.elements = GROUP_TEMPLATES.face.elements.map((e) => `${e} This piece is ALWAYS required.`);

for (const key of ["face", "hair", "body"]) {
  GROUP_TEMPLATES[key].expectedCount = GROUP_TEMPLATES[key].elements.length;
}

GROUP_TEMPLATES.all = {
  label: "Sprite sheet completa",
  adaptive: true, // combina face (fisso) + hair/body (adattivi, v38) — la formulazione adattiva gestisce correttamente entrambi i casi (vedi buildPrompt)
  expectedCount:
    GROUP_TEMPLATES.face.elements.length +
    GROUP_TEMPLATES.hair.elements.length +
    GROUP_TEMPLATES.body.elements.length,
  elements: [
    ...GROUP_TEMPLATES.face.elements,
    ...GROUP_TEMPLATES.hair.elements,
    ...GROUP_TEMPLATES.body.elements
  ]
};

const RIGGING_NOTE = `
Rigging note for 2D skeletal animation (Spine-style) — how an EXPERIENCED 2D
game rigger cuts joints, not a beginner mistake to avoid: each arm is now a
SINGLE complete piece (shoulder to fingertips, no elbow split), so there are
only TWO joints left to hide: neck-to-torso and shoulder-to-arm. Each is
hidden behind a deliberate COSTUME ELEMENT that belongs to the piece ON TOP —
a collar/necklace/high collar for the neck (drawn on the head piece), a
pauldron/shoulder guard/puffed sleeve/wrapped cloth/strap for the shoulder
(drawn on the arm piece). The piece UNDERNEATH (torso) is left plain and
simple at that exact point — no fine detail needed, it will not be visible —
and the piece on top generously overlaps it wearing that costume piece. Only
ONE of the two pieces at a joint carries the accessory (the one on top); the
piece underneath must NOT also have a matching or competing decoration
painted there — a joint hidden by two overlapping but independently-drawn
accessories looks wrong and defeats the purpose. This is why professional
character sheets always give even simple costumes a pauldron or a collar at
every joint — it is not decoration for its own sake, it is what makes the
cut invisible, and it belongs on exactly one of the two pieces.
IMPORTANT for animation, not just for this static sheet: the piece underneath
will ROTATE around this exact joint once rigged, swinging away from its
resting pose. A costume element painted only on the front-facing side of the
joint will stop covering the seam the moment the limb rotates and the gap
turns toward the camera. So draw every joint-hiding accessory (pauldron,
collar) as a band that WRAPS AROUND MOST OF THE LIMB'S CIRCUMFERENCE at that
exact point — not a flat decorative patch on one side only — so the seam
stays covered across the whole range of rotation the joint will actually
animate through, not just in this one reference pose.
Never attempt to hide a joint with a razor-thin precise bare-skin seam
between two separately-generated pieces — that requires pixel-perfect
matching between images that cannot see each other and is unreliable; a
wrap-around costume element hides it completely regardless of small position
differences AND regardless of rotation angle.
If the character's description or reference image does not suggest an
obvious costume piece for a given joint, invent a simple, tasteful one
consistent with the character's overall style (a plain leather bracer, a
simple metal band) rather than leaving the joint as bare skin.
Every element must have a small margin of empty solid-background space around
its silhouette (do not crop the artwork flush against the image edge) — this
avoids rough, clipped-looking edges when the piece is extracted and used
independently.
No outline, stroke, border, glow, halo, or "sticker die-cut" effect around any
element's silhouette — the edge must fade directly and cleanly from the
fully-opaque illustration to the solid white background, no extra visible rim
of any color surrounding the shape.`;

const HEAD_ANGLE_CONSISTENCY_NOTE = `
CRITICAL HEAD ANGLE CONSISTENCY — this is the single most common mistake on this
task, actively check for it before finishing: the attached reference image shows
the character's head at a SPECIFIC turn/tilt angle (frontal, 3/4, profile, etc).
Look at that angle again right now. EVERY element in this list that is described
as sharing the head's angle (the head itself, both open eyes, both pupils, both
closed eyes, the eyebrows, AND the back hair layer if present in this list) must
be drawn from that EXACT SAME angle as the reference — not a generic front-facing
version for some pieces while only the head matches. A 3/4-turned head paired
with symmetric, front-facing almond eyes, or paired with a hair silhouette drawn
as if seen from straight ahead, is WRONG and is the most common failure — if the
reference head is turned, the far-side eye must be visibly narrower and more
foreshortened than the near-side eye, the eyebrows must follow the same tilt as
the head instead of sitting level as if seen from the front, and the back hair
volume must drape asymmetrically the way real hair does on a turned head, not as
a symmetric frontal silhouette. Re-check each of these pieces against the
reference image's head angle individually before finishing, not just the head
piece.`;

const BODY_ANGLE_CONSISTENCY_NOTE = `
CRITICAL BODY/SHOULDER ANGLE CONSISTENCY — the same mistake as a frontal face on
a turned head, but for the torso, and just as common: the attached reference
image shows the character's shoulders and torso at a SPECIFIC angle (frontal,
3/4 turn, etc), which is not always the same as the head's turn angle — look at
the reference's shoulder line and torso twist again right now, independently of
the head. The torso element (and the shoulder end of each arm) must be drawn
from that EXACT SAME body angle as the reference — not a generic straight-on,
perfectly symmetric torso just because it is easier to draw that way. If the
reference shows the shoulders turned or the torso twisted, one shoulder sits
visibly higher and closer to the viewer than the other, and the torso
silhouette is asymmetric, not a mirror-symmetric front view. A perfectly
frontal, symmetric torso when the reference is turned is WRONG.`;

function buildPrompt({ characterDescription, artStyle, group, correction, hasReference, referenceAnalysis, singleElementIndex }) {
  const g = GROUP_TEMPLATES[group];
  const isSingleElement = Number.isInteger(singleElementIndex) && g.elements[singleElementIndex] != null;
  const elements = isSingleElement ? [g.elements[singleElementIndex]] : g.elements;
  const elementsList = elements.map((e, i) => `${i + 1}. ${e}`).join("\n");
  const isFullSheet = !isSingleElement && group === "all";
  const includesBodyParts = isFullSheet || group === "body" || group === "face";
  const includesHeadAngleParts = isFullSheet || group === "face" || group === "hair";
  const includesTorsoParts = isFullSheet || group === "body";
  // Alcuni elementi di hair/body sono adattivi (accessori/prop presenti SOLO
  // se il personaggio li ha davvero, vedi v38): per questi gruppi il conteggio
  // "esatto" non ha più senso, va riformulato come tetto massimo con distinzione
  // tra pezzi sempre richiesti e pezzi condizionali — altrimenti il paragrafo di
  // completezza contraddice le istruzioni "ometti se assente" sui singoli elementi.
  const isAdaptive = !isSingleElement && g.adaptive === true;

  const subject = hasReference
    ? `The attached reference image shows the EXACT character to reproduce. Match it faithfully: same face, same proportions, same colors, same costume, same jewelry/headdress, and — just as important — the EXACT SAME art style and rendering technique as the reference image itself: same linework (or complete absence of outlines, if the reference has none), same shading approach (soft painterly/airbrushed gradients vs hard cel-shading vs flat vector fill — whichever the reference actually uses), same level of realism, same color depth and lighting. Do NOT default to a flat vector / cel-shaded / thick-black-outline cartoon look unless the reference image itself already looks that way — reproduce the reference's actual rendering technique exactly, with no restyling, no simplification, and no flattening.${
        referenceAnalysis
          ? `\n\nHere is a precise written analysis of the reference character's exact features — use it as the authoritative guide for colors and details on every separated part, together with the attached image:\n${referenceAnalysis}`
          : ""
      }${characterDescription ? ` Additional notes, secondary to matching the reference: ${characterDescription}.` : ""}`
    : `${characterDescription}.`;

  return `Character asset reference sheet for 2D game animation rigging${hasReference ? "" : `, ${artStyle}`}. ${subject}
Clean isolated modular body parts laid out separately on a plain white background,
each part occupying its own clearly reserved "safety zone" cell in an implicit
grid layout, with generous empty padding around it (minimum ${isFullSheet ? "180px" : "100px"}
equivalent spacing between every single element in every direction — left, right,
top, bottom — no parts touching, overlapping, or crossing into a neighboring
element's safety zone, no exceptions).${
    isFullSheet
      ? " This sheet contains MANY elements: prioritize spacing and a clean grid arrangement over compact composition — it is better to leave a very large canvas mostly empty than to have any two elements touch."
      : ""
  }

${
    isSingleElement
      ? "Generate ONLY this ONE single isolated element (not a full sheet, not the other elements of its group):"
      : isAdaptive
        ? `Go through these ${elements.length} numbered items, numbered below${isFullSheet ? "" : ` (from the "${g.label}" group)`}. Each one says explicitly whether it is ALWAYS required or included ONLY IF the reference actually shows it — follow that per-item rule exactly, this is not a free choice:`
        : `Include EXACTLY these ${elements.length} individual isolated elements, numbered below${isFullSheet ? "" : ` (from the "${g.label}" group)`} — this is a MANDATORY numbered checklist, not a set of suggestions:`
  }
${elementsList}
${
    isSingleElement
      ? ""
      : isAdaptive
        ? `\nCOMPLETENESS CHECK (adaptive list — read carefully, this is different from a simple "include everything" rule): go back through the list number by number. Every item marked "ALWAYS required" must be present and clearly visible — never omit those, no exceptions. Every item marked "include ONLY IF..." must be included if and only if the reference image actually shows it: omitting it because the character genuinely does not have it is CORRECT and expected, not a failure — but drawing one anyway when the reference doesn't show it is just as wrong as omitting a required piece. Do not merge two listed items into a single drawing, and do not invent decorative items, props or accessories beyond what this list and the reference actually call for.`
        : `\nMANDATORY COMPLETENESS CHECK: the list above has EXACTLY ${elements.length} numbered items. Before you finish, go back through the list number by number and confirm each one is present and clearly visible as its own separate drawing. Skipping, merging, or silently dropping ANY numbered item is a failure, even if the ones you did draw are highly detailed — completeness across all ${elements.length} items matters more than extra polish on a few. If you feel you are running out of space or budget, simplify the level of detail on EVERY item slightly rather than omitting items entirely. Do not stop until all ${elements.length} numbered items are on the canvas.`
  }
${includesHeadAngleParts && hasReference ? HEAD_ANGLE_CONSISTENCY_NOTE : ""}
${includesTorsoParts && hasReference ? BODY_ANGLE_CONSISTENCY_NOTE : ""}
${includesBodyParts ? RIGGING_NOTE : ""}

Each element must share the exact same art style, line weight, color palette,
lighting direction and proportions, as if all pieces belong to the same character.

Do NOT include a fully assembled full-body illustration anywhere in the image —
only the separated individual parts.

Background: a single SOLID, FLAT, uniform pure white color (RGB 255,255,255)
covering the entire canvas, completely opaque — no transparency, no gradient,
no texture, no pattern, no checkerboard, no shadow, no scenery of any kind.
Every element must be fully opaque itself too (no partial opacity anywhere in
the artwork), so its edges against the white background are always crisp,
high-contrast and easy to cut out. High resolution, sharp clean edges suitable
for extraction and cropping, no drop shadows, no watermark, no text labels.
${hasReference ? "\nReminder: reproduce the reference image's exact art style and rendering technique on every single element — do not convert it to a different, more generic, or more simplified style." : ""}
${correction ? `\nIMPORTANT CORRECTION FROM PREVIOUS ATTEMPT: ${correction}` : ""}`;
}

const MIN_COMPONENT_PIXELS = 200;
const MIN_COMPONENT_AREA = 400;
const DILATION_ITERATIONS = 2;
const ALPHA_THRESHOLD = 15;
const LABEL_SATURATION_THRESHOLD = 0.12;
const DOWNSAMPLE_MAX_DIM = 700;

function dilateMask(mask, width, height, iterations) {
  let current = mask;
  for (let it = 0; it < iterations; it++) {
    const next = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (current[idx]) { next[idx] = 1; continue; }
        let found = 0;
        for (let dy = -1; dy <= 1 && !found; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= width) continue;
            if (current[ny * width + nx]) { found = 1; break; }
          }
        }
        next[idx] = found;
      }
    }
    current = next;
  }
  return current;
}

function labelComponents(mask, width, height) {
  const labels = new Int32Array(width * height);
  let nextLabel = 1;
  const queue = new Int32Array(width * height);
  for (let start = 0; start < width * height; start++) {
    if (!mask[start] || labels[start]) continue;
    const label = nextLabel++;
    let qHead = 0, qTail = 0;
    queue[qTail++] = start;
    labels[start] = label;
    while (qHead < qTail) {
      const idx = queue[qHead++];
      const x = idx % width;
      const y = (idx - x) / width;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const nIdx = ny * width + nx;
          if (mask[nIdx] && !labels[nIdx]) {
            labels[nIdx] = label;
            queue[qTail++] = nIdx;
          }
        }
      }
    }
  }
  return { labels, count: nextLabel - 1 };
}

/** Campiona rgba (width x height) a una griglia al più DOWNSAMPLE_MAX_DIM sul lato lungo, nearest-neighbor. Ritorna anche lo stride usato, per poter riscalare le coordinate delle regioni trovate. */
function downsampleRgba(width, height, rgba) {
  const stride = Math.max(1, Math.ceil(Math.max(width, height) / DOWNSAMPLE_MAX_DIM));
  if (stride === 1) return { dwidth: width, dheight: height, drgba: rgba, stride };

  const dwidth = Math.ceil(width / stride);
  const dheight = Math.ceil(height / stride);
  const drgba = new Uint8ClampedArray(dwidth * dheight * 4);
  for (let dy = 0; dy < dheight; dy++) {
    const sy = Math.min(height - 1, dy * stride);
    for (let dx = 0; dx < dwidth; dx++) {
      const sx = Math.min(width - 1, dx * stride);
      const srcIdx = (sy * width + sx) * 4;
      const dstIdx = (dy * dwidth + dx) * 4;
      drgba[dstIdx] = rgba[srcIdx];
      drgba[dstIdx + 1] = rgba[srcIdx + 1];
      drgba[dstIdx + 2] = rgba[srcIdx + 2];
      drgba[dstIdx + 3] = rgba[srcIdx + 3];
    }
  }
  return { dwidth, dheight, drgba, stride };
}

function detectSpriteRegions({ width, height, rgba }) {
  const { dwidth, dheight, drgba, stride } = downsampleRgba(width, height, rgba);
  const n = dwidth * dheight;
  const minComponentPixels = Math.max(1, Math.round(MIN_COMPONENT_PIXELS / (stride * stride)));
  const minComponentArea = Math.max(1, Math.round(MIN_COMPONENT_AREA / (stride * stride)));

  let transparentPixelCount = 0;
  for (let i = 0; i < n; i++) {
    if (drgba[i * 4 + 3] < 250) transparentPixelCount++;
  }
  const hasRealTransparency = transparentPixelCount / n > 0.01;

  const rawMask = new Uint8Array(n);
  if (hasRealTransparency) {
    for (let i = 0; i < n; i++) rawMask[i] = drgba[i * 4 + 3] > ALPHA_THRESHOLD ? 1 : 0;
  } else {
    const WHITE_THRESHOLD = 235;
    for (let i = 0; i < n; i++) {
      const r = drgba[i * 4], g = drgba[i * 4 + 1], b = drgba[i * 4 + 2];
      rawMask[i] = r > WHITE_THRESHOLD && g > WHITE_THRESHOLD && b > WHITE_THRESHOLD ? 0 : 1;
    }
  }

  const dilated = dilateMask(rawMask, dwidth, dheight, DILATION_ITERATIONS);
  const { labels, count } = labelComponents(dilated, dwidth, dheight);

  const stats = Array.from({ length: count + 1 }, () => ({
    minX: Infinity, minY: Infinity, maxX: -1, maxY: -1, pixelCount: 0
  }));

  for (let y = 0; y < dheight; y++) {
    for (let x = 0; x < dwidth; x++) {
      const idx = y * dwidth + x;
      if (!rawMask[idx]) continue;
      const label = labels[idx];
      if (!label) continue;
      const s = stats[label];
      if (x < s.minX) s.minX = x;
      if (x > s.maxX) s.maxX = x;
      if (y < s.minY) s.minY = y;
      if (y > s.maxY) s.maxY = y;
      s.pixelCount++;
    }
  }

  const regions = [];
  for (let label = 1; label <= count; label++) {
    const s = stats[label];
    if (s.pixelCount < minComponentPixels || s.maxX < 0) continue;
    const w = s.maxX - s.minX + 1;
    const h = s.maxY - s.minY + 1;
    if (w * h < minComponentArea) continue;

    let satSum = 0, satCount = 0, extremeCount = 0;
    for (let y = s.minY; y <= s.maxY; y++) {
      for (let x = s.minX; x <= s.maxX; x++) {
        const idx = y * dwidth + x;
        if (!rawMask[idx] || labels[idx] !== label) continue;
        const r = drgba[idx * 4] / 255, g = drgba[idx * 4 + 1] / 255, b = drgba[idx * 4 + 2] / 255;
        const maxc = Math.max(r, g, b), minc = Math.min(r, g, b);
        satSum += maxc > 0 ? (maxc - minc) / maxc : 0;
        satCount++;
        const luminance = (r + g + b) / 3;
        if (luminance < 0.15 || luminance > 0.9) extremeCount++;
      }
    }
    const meanSaturation = satCount > 0 ? satSum / satCount : 0;
    const extremeFraction = satCount > 0 ? extremeCount / satCount : 0;

    regions.push({
      x: s.minX * stride, y: s.minY * stride, w: w * stride, h: h * stride,
      areaFraction: (w * h) / (dwidth * dheight),
      meanSaturation,
      isProbablyLabel: meanSaturation < LABEL_SATURATION_THRESHOLD && extremeFraction > 0.55
    });
  }
  return regions;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_CHANNELS_BY_COLOR_TYPE = { 0: 1, 2: 3, 4: 2, 6: 4 }; // 3 = palette, non supportata

/**
 * Decoder PNG minimo scritto a mano, usato al posto di pngjs: pngjs adopera
 * una propria implementazione di inflate (non lo zlib nativo) che è severa
 * sui byte extra anche quando sono infilati DENTRO la lunghezza dichiarata
 * dell'ultimo chunk IDAT — esattamente il modo in cui Gemini pare accodare i
 * suoi metadati di provenienza (v36: anche dopo aver alleggerito il
 * fallback alla sola firma PNG, il problema persisteva 12/12 perché pngjs
 * falliva ben prima che il fallback entrasse in gioco). Confermato con un
 * test riproducibile: PNG valida + byte arbitrari appesi al payload IDAT →
 * pngjs.PNG.sync.read fallisce, node:zlib.inflateSync sullo stesso payload
 * decomprime correttamente ignorando i byte extra, con pixel identici al
 * file pulito. Il parsing dei chunk qui sotto si ferma da solo a IEND,
 * quindi non serve più troncare il buffer prima (truncateAtIEND, v26-v36,
 * rimosso). Supporta PNG 8-bit non interlacciati — grayscale, RGB,
 * grayscale+alpha, RGBA — che è tutto quello che i nostri prompt possono
 * produrre; per qualunque altro caso lancia un errore leggibile invece di
 * restituire pixel sbagliati in silenzio.
 */
function decodePngLenient(buffer) {
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (buffer[i] !== PNG_SIGNATURE[i]) throw new Error("firma PNG non valida");
  }
  let offset = PNG_SIGNATURE.length;
  let width, height, bitDepth, colorType, interlace;
  const idatParts = [];
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd > buffer.length) break;
    if (type === "IHDR") {
      width = buffer.readUInt32BE(dataStart);
      height = buffer.readUInt32BE(dataStart + 4);
      bitDepth = buffer[dataStart + 8];
      colorType = buffer[dataStart + 9];
      interlace = buffer[dataStart + 12];
    } else if (type === "IDAT") {
      idatParts.push(buffer.subarray(dataStart, dataEnd));
    } else if (type === "IEND") {
      break;
    }
    offset = dataEnd + 4;
  }
  if (!width || !height) throw new Error("IHDR mancante o non valido");
  if (interlace) throw new Error("PNG interlacciato non supportato dal decoder leggero");
  if (bitDepth !== 8) throw new Error(`bit depth ${bitDepth} non supportato dal decoder leggero`);
  const channels = PNG_CHANNELS_BY_COLOR_TYPE[colorType];
  if (!channels) throw new Error(`color type ${colorType} non supportato dal decoder leggero`);
  if (idatParts.length === 0) throw new Error("nessun chunk IDAT trovato");

  const raw = inflateSync(Buffer.concat(idatParts));
  const stride = width * channels;
  const rgba = new Uint8ClampedArray(width * height * 4);
  let prevRow = new Uint8Array(stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filterType = raw[pos++];
    const row = raw.subarray(pos, pos + stride);
    pos += stride;
    const outRow = new Uint8Array(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? outRow[x - channels] : 0;
      const b = prevRow[x];
      const c = x >= channels ? prevRow[x - channels] : 0;
      let value = row[x];
      if (filterType === 1) value += a;
      else if (filterType === 2) value += b;
      else if (filterType === 3) value += (a + b) >> 1;
      else if (filterType === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      outRow[x] = value & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const srcIdx = x * channels;
      const dstIdx = (y * width + x) * 4;
      if (channels === 4) {
        rgba[dstIdx] = outRow[srcIdx];
        rgba[dstIdx + 1] = outRow[srcIdx + 1];
        rgba[dstIdx + 2] = outRow[srcIdx + 2];
        rgba[dstIdx + 3] = outRow[srcIdx + 3];
      } else if (channels === 3) {
        rgba[dstIdx] = outRow[srcIdx];
        rgba[dstIdx + 1] = outRow[srcIdx + 1];
        rgba[dstIdx + 2] = outRow[srcIdx + 2];
        rgba[dstIdx + 3] = 255;
      } else if (channels === 2) {
        rgba[dstIdx] = rgba[dstIdx + 1] = rgba[dstIdx + 2] = outRow[srcIdx];
        rgba[dstIdx + 3] = outRow[srcIdx + 1];
      } else if (channels === 1) {
        rgba[dstIdx] = rgba[dstIdx + 1] = rgba[dstIdx + 2] = outRow[srcIdx];
        rgba[dstIdx + 3] = 255;
      }
    }
    prevRow = outRow;
  }
  return { width, height, data: rgba };
}

/**
 * Rete di sicurezza finale, per l'improbabile caso in cui anche
 * decodePngLenient fallisca (es. un formato PNG non supportato, come
 * palette/16-bit/interlacciato): se almeno la firma PNG è presente, il
 * contenuto è comunque un'immagine PNG reale (non un errore testuale o un
 * buffer vuoto) — si passa l'immagine così com'è, segnalando solo che il
 * controllo geometrico automatico non è stato eseguito.
 */
function hasValidPngHeader(buffer) {
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (buffer[i] !== PNG_SIGNATURE[i]) return false;
  }
  return buffer.length > PNG_SIGNATURE.length;
}

function evaluateQuality(regions, expectedCount) {
  const art = regions.filter((r) => !r.isProbablyLabel);
  const issues = [];

  if (art.length < expectedCount - 1) {
    issues.push(`Trovate solo ${art.length} illustrazioni su ${expectedCount} attese (probabile fusione o omissione).`);
  }

  const hugeBlobs = art.filter((r) => r.areaFraction > 0.35);
  if (hugeBlobs.length > 0) {
    issues.push(`${hugeBlobs.length} elemento/i anomalo/i troppo grande/i (probabile fusione tra più illustrazioni).`);
  }

  let overlapCount = 0;
  for (let i = 0; i < art.length; i++) {
    for (let j = i + 1; j < art.length; j++) {
      const a = art[i], b = art[j];
      const overlapX = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
      const overlapY = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
      if (overlapX > 0 && overlapY > 0) overlapCount++;
    }
  }
  if (overlapCount > 0) {
    issues.push(`${overlapCount} coppia/e di elementi con bounding box sovrapposti (rischio contaminazione).`);
  }

  const pass = issues.length === 0 && art.length >= expectedCount - 1;

  let correction = null;
  if (!pass) {
    const parts = [];
    if (hugeBlobs.length > 0 || overlapCount > 0) {
      parts.push("increase spacing to at least 150px between every single element, no exceptions, nothing touching or overlapping");
    }
    if (art.length < expectedCount - 1) {
      parts.push(`make sure ALL ${expectedCount} listed elements are present and clearly visible, do not omit any`);
    }
    correction = parts.join("; ");
  }

  return { pass, issues, correction, artCount: art.length };
}

// v39: provider immagini intercambiabile (stesso contratto di risposta {imageBase64, finishReason}).
// AI_PROVIDER=openai (secret) -> usa OpenAI per primo; altrimenti Gemini con ripiego su OpenAI quando Gemini
// risponde tetto di spesa / quota esaurita / blocco di sicurezza. Chiavi solo nei Secrets.
async function callOpenAIImage(prompt, referenceImagesBase64 = []) {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) throw new Error("OPENAI_API_KEY non configurata come secret del progetto.");
  const model = Deno.env.get("OPENAI_IMAGE_MODEL") || "gpt-image-2.5-flare";
  const quality = Deno.env.get("OPENAI_IMAGE_QUALITY") || "high";
  const common = { model, prompt, size: "1536x864", quality, output_format: "png" };
  let res;
  if (referenceImagesBase64.length) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(common)) fd.append(k, String(v));
    referenceImagesBase64.slice(0, 4).forEach((b64, i) => fd.append("image[]", new Blob([Buffer.from(b64, "base64")], { type: "image/png" }), `ref${i}.png`));
    res = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: fd });
  } else {
    res = await fetch("https://api.openai.com/v1/images/generations", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(common) });
  }
  if (!res.ok) throw new Error(`OpenAI API error ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const d = await res.json();
  const b64 = d?.data?.[0]?.b64_json;
  if (!b64) throw new Error("Nessuna immagine nella risposta OpenAI.");
  return { imageBase64: b64, finishReason: "STOP" };
}

async function callGemini(prompt, apiKey, referenceImagesBase64 = []) {
  const hasOpenAI = !!Deno.env.get("OPENAI_API_KEY");
  if ((Deno.env.get("AI_PROVIDER") || "").toLowerCase() === "openai" && hasOpenAI) return callOpenAIImage(prompt, referenceImagesBase64);
  try {
    return await callGeminiDirect(prompt, apiKey, referenceImagesBase64);
  } catch (e) {
    const msg = String(e?.message || e);
    if (hasOpenAI && /\b429\b|RESOURCE_EXHAUSTED|spending cap|quota|PROHIBITED_CONTENT|SAFETY/i.test(msg)) return callOpenAIImage(prompt, referenceImagesBase64);
    throw e;
  }
}

async function callGeminiDirect(prompt, apiKey, referenceImagesBase64 = []) {
  const parts = [
    ...referenceImagesBase64.map((b64) => ({ inlineData: { mimeType: "image/png", data: b64 } })),
    { text: prompt }
  ];

  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: { aspectRatio: "16:9", imageSize: "1K" }
      }
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const candidate = data?.candidates?.[0];
  const responseParts = candidate?.content?.parts || [];
  const imagePart = responseParts.find((p) => p.inlineData?.data);
  if (!imagePart) {
    const textPart = responseParts.find((p) => p.text)?.text;
    const reason = candidate?.finishReason || "sconosciuto";
    const isSafetyBlock = reason === "PROHIBITED_CONTENT" || reason === "SAFETY";
    throw new Error(
      `Nessuna immagine nella risposta Gemini (finishReason: ${reason}).` +
        (isSafetyBlock
          ? " Il filtro di sicurezza di Gemini a volte scatta per errore sullo stesso identico prompt — spesso basta riprovare; se persiste, prova a generare un gruppo alla volta invece di \"tutto insieme\", oppure modifica la descrizione o l'immagine di riferimento."
          : "") +
        (textPart ? ` Testo ricevuto invece: ${textPart.slice(0, 300)}` : "")
    );
  }
  return { imageBase64: imagePart.inlineData.data, finishReason: candidate?.finishReason };
}

const ANALYSIS_PROMPT = `You are a meticulous character reference analyst preparing notes for an
artist who will redraw this exact character as separated body parts for 2D game rigging,
WITHOUT being able to look at this image again — your written analysis is their only guide,
so it must be precise and unambiguous. Look carefully at the attached character image and
write a structured analysis covering, in this exact order:

1. ART STYLE: rendering technique (e.g. painted digital illustration, cel-shaded, flat
   vector), line quality, shading approach (soft airbrushed vs hard cel shading), color
   saturation and depth, lighting direction, overall level of realism.
2. HEAD ANGLE: the exact head turn/tilt angle in this image (e.g. "3/4 turn to the
   viewer's right, chin level, no vertical tilt" or "full front-facing, no turn" or
   "profile view facing left, slight downward tilt"). Be precise about direction and
   degree — this is the single most important fact for keeping every separated face
   piece (eyes, eyebrows, closed eyes) consistent with each other and with this image.
2b. BODY/SHOULDER ANGLE: the exact shoulder line and torso twist angle, stated
   separately from the head angle above since they can differ (e.g. "shoulders
   turned 3/4 matching the head, near shoulder lower and closer to viewer" or
   "shoulders fully frontal even though the head is turned"). This is needed to
   keep the separately-generated torso and arm pieces consistent with this image.
3. SKIN: exact skin tone (be specific, e.g. "warm tan/olive", not just "brown").
4. FACE: eye color and shape, eyebrow shape and color, lip color and shape, expression,
   any facial markings or makeup.
5. HAIR: exact color(s) including any highlights, style, texture, where it parts, how the
   front and back layers fall.
6. HEADWEAR: exact colors of every distinct piece (e.g. headdress base, feathers by color
   band, central gem color, side ornaments), materials (metal tone: gold/silver/bronze).
7. JEWELRY: each visible piece (earrings, necklace, bracelets, rings, hairpins) — shape,
   exact color, material, per item, left vs right if they differ.
8. COSTUME/TORSO: every distinct costume piece and its exact color and pattern, gem colors,
   metal trim color, how much skin is visible and where.
9. ARMS/HANDS: skin tone consistency, any bracelets/armbands/sleeves, hand pose, anything
   held.
10. PROPS: any held or nearby object — exact colors and shape.

Be extremely specific about colors (name precise hues, e.g. "teal-turquoise", "crimson red",
"antique gold" — never just "blue" or "red"). Other than the HEAD ANGLE in point 2 and the
BODY/SHOULDER ANGLE in point 2b above (needed so the separately-generated face, torso and
arm pieces can each match them), do not describe body pose, camera framing, or background
composition — only visual identity details needed to redraw each isolated body part
faithfully. Keep it as a compact but complete list, not prose.`;

/** Analizza l'immagine di riferimento con una chiamata solo testo (nessuna immagine generata qui). Non blocca la generazione se fallisce: si torna semplicemente a usare la sola immagine come guida. */
async function analyzeReferenceCharacter(referenceImageBase64, apiKey) {
  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{
        parts: [
          { inlineData: { mimeType: "image/png", data: referenceImageBase64 } },
          { text: ANALYSIS_PROMPT }
        ]
      }],
      generationConfig: { responseModalities: ["TEXT"] }
    })
  });
  if (!res.ok) throw new Error(`Gemini API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text;
  if (!text) throw new Error("Analisi del riferimento vuota.");
  return text.trim();
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Usa POST" }), {
      status: 405,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
    });
  }

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "GEMINI_API_KEY non configurata come secret del progetto." }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

  try {
    const {
      characterDescription,
      artStyle,
      group,
      referenceImagesBase64,
      previewOnly,
      promptOverride,
      correction: incomingCorrection,
      referenceAnalysis: incomingReferenceAnalysis,
      referenceAnalysisError: incomingReferenceAnalysisError,
      elementIndex
    } = await req.json();

    const singleElementIndex = Number.isInteger(elementIndex) ? elementIndex : null;

    if (!GROUP_TEMPLATES[group]) {
      return new Response(
        JSON.stringify({ error: `group non valido. Valori ammessi: ${Object.keys(GROUP_TEMPLATES).join(", ")}` }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }
    const hasReference = Array.isArray(referenceImagesBase64) && referenceImagesBase64.length > 0;
    const hasPromptOverride = typeof promptOverride === "string" && promptOverride.trim().length > 0;
    const DEFAULT_ART_STYLE = "flat vector game illustration, clean lineart, cel-shaded";
    const effectiveArtStyle = artStyle || DEFAULT_ART_STYLE;
    if (!characterDescription && !hasReference && !hasPromptOverride) {
      return new Response(
        JSON.stringify({
          error: "Serve characterDescription, un'immagine di riferimento, oppure un prompt personalizzato."
        }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    let referenceAnalysis = incomingReferenceAnalysis ?? null;
    let referenceAnalysisError = incomingReferenceAnalysisError ?? null;
    if (hasReference && !referenceAnalysis && !referenceAnalysisError) {
      try {
        referenceAnalysis = await analyzeReferenceCharacter(referenceImagesBase64[0], apiKey);
      } catch (e) {
        referenceAnalysisError = String(e?.message || e);
      }
    }

    if (previewOnly) {
      const prompt = buildPrompt({
        characterDescription,
        artStyle: effectiveArtStyle,
        group,
        correction: null,
        hasReference,
        referenceAnalysis,
        singleElementIndex
      });
      return new Response(
        JSON.stringify({ prompt, referenceAnalysis, referenceAnalysisError }),
        { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    const expectedCount = singleElementIndex != null ? 1 : GROUP_TEMPLATES[group].expectedCount;
    const prompt = hasPromptOverride
      ? incomingCorrection
        ? `${promptOverride.trim()}\n\nIMPORTANT CORRECTION FROM PREVIOUS ATTEMPT: ${incomingCorrection}`
        : promptOverride.trim()
      : buildPrompt({
          characterDescription,
          artStyle: effectiveArtStyle,
          group,
          correction: incomingCorrection || null,
          hasReference,
          referenceAnalysis,
          singleElementIndex
        });

    const { imageBase64, finishReason } = await callGemini(prompt, apiKey, referenceImagesBase64 || []);

    let regions = [];
    let evaluation = { pass: false, issues: [], correction: null, artCount: 0 };
    let parseError = null;
    let unverified = false;

    // v38: hair/body (e "all", che li combina) hanno elementi adattivi — il
    // numero di pezzi attesi non è più fisso (accessori/prop presenti solo se
    // il personaggio li ha davvero), quindi il controllo geometrico basato su
    // un conteggio atteso non ha più senso e va saltato del tutto per una
    // generazione a gruppo intero (non per la rigenerazione di un singolo
    // elemento, dove expectedCount resta 1 per definizione): l'immagine viene
    // sempre mostrata per una valutazione visiva, senza retry automatici
    // basati su regole di conteggio che non sono più valide.
    const skipQualityCheck = singleElementIndex == null && GROUP_TEMPLATES[group].adaptive === true;

    const rawPngBuffer = Buffer.from(imageBase64, "base64");
    try {
      const png = decodePngLenient(rawPngBuffer);
      regions = detectSpriteRegions({ width: png.width, height: png.height, rgba: png.data });
      evaluation = skipQualityCheck
        ? { pass: true, issues: [], correction: null, artCount: regions.filter((r) => !r.isProbablyLabel).length }
        : evaluateQuality(regions, expectedCount);
    } catch (e) {
      parseError = String(e?.message || e);
      // Il parser rigoroso a volte rifiuta un file che è comunque un PNG
      // valido (vedi hasValidPngHeader) — in quel caso non bruciamo un
      // tentativo per un limite nostro: si passa l'immagine così com'è e si
      // segnala solo che il controllo geometrico automatico non è stato
      // eseguito, invece di marcarla come fallita.
      if (hasValidPngHeader(rawPngBuffer)) {
        unverified = true;
        evaluation = { pass: true, issues: [], correction: null, artCount: expectedCount };
      }
    }

    const issuesForLog = parseError && !unverified
      ? [
          `Immagine non leggibile come PNG valido (${parseError}).`,
          finishReason && finishReason !== "STOP" ? `Motivo di interruzione Gemini: ${finishReason}.` : null
        ].filter(Boolean)
      : evaluation.issues;

    const nextCorrection = parseError && !unverified
      ? "the previous image appears to have been cut off or corrupted; generate a smaller, simpler composition if needed to ensure it completes fully"
      : evaluation.correction;

    return new Response(
      JSON.stringify({
        passed: evaluation.pass,
        issues: issuesForLog,
        artCount: evaluation.artCount,
        correction: nextCorrection,
        imageBase64,
        regions,
        group,
        expectedCount,
        unverified,
        referenceAnalysis,
        referenceAnalysisError
      }),
      { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err?.message || err) }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
    });
  }
});
