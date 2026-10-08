# Regole del metodo MESH (personaggio intero in mesh pesata) — versione zeus-mesh-9.3, 8 ott 2026

Riferimento professionale: rig della Domatrice (`claude/ANALISI_RIG_DOMATRICE.md`). Caso approvato: Zeus, zeus-mesh-5
("perfetto", 8 ott). Codice: `src/lib/meshRig.js`. Test: `tests/meshRig.test.mjs` (M1–M7, Zeus), `tests/meshRigDomatrice.test.mjs` (D1–D5, Domatrice), `tests/meshRigBocca.test.mjs` (S1–S6, sorriso deformato), `tests/mouthGemini.test.mjs` (G1–G4, sorriso ridisegnato).

## Principio
L'immagine ORIGINALE è il corpo. Non si ridisegna il personaggio: si deforma con una mesh legata alle ossa e si
staccano solo le parti che lo richiedono. A riposo il risultato è l'originale (M2).

## R1 — Ossa dai punti della posa
anca (centro dei fianchi) → schiena → petto (a metà fra anca e base del collo) → collo → testa → viso (sul naso).
Braccia: omero (spalla→gomito), avambraccio (gomito→polso), mano (polso→mano). Gambe: nessun osso (ferme).

## R2 — Mesh del corpo e pesi
- Griglia sull'ingombro del personaggio: 34 celle sul lato lungo; coordinate sui bordi dei pixel (come le UV di Spine).
- Ogni vertice prende l'etichetta della parte più presente nella sua cella (mappa di "Riconosci parti"); fuori sagoma,
  quella del pixel del personaggio più vicino. Oggetto in mano: basta il 15% della cella.
- Peso lineare lungo la catena della parte: busto (anca → schiena → petto), testa (petto → collo → testa),
  braccio (omero → avambraccio → mano). Viso: sfumatura radiale attorno al naso (raggio 0,55 × larghezza spalle).
- Al massimo 4 ossa per vertice.

## R3 — Scelta automatica: tagliare o piegare (M1)
| Parte | Taglio quando | Altrimenti |
|---|---|---|
| Braccio | tiene un oggetto ≥ 0,2% del personaggio (fulmine, cerchio, bocchino) | mesh nel corpo |
| Capelli dietro | categoria "capelli" sotto la linea delle spalle ai lati del viso ≥ 0,4% | restano nella mesh della testa (Zeus) |
| Occhi | entrambi trovati | — |
Le parti tagliate nel corpo valgono come busto/testa; dietro la parte alta del braccio tagliato il busto si riempie
dai pixel vicini (fascia 0,14 × spalle, solo sopra il gomito: più in basso il riempimento usciva dalla sagoma).

## R8 — Da dove si taglia il braccio (D1–D5), zeus-mesh-7
Difetto visto sulla Domatrice (8 ott): il braccio col cerchio scende lungo il fianco; la mappa delle parti dà al
braccio tutta la fascia destra della giacca, e il pezzo si portava via risvolto e bottoni. In movimento la fascia si
spostava e lasciava vedere il riempimento grigio dietro, e un frammento del cerchio restava sospeso nel corpo.
- **Dalla SPALLA** se l'omero è staccato dal busto (angolo spalla→gomito rispetto a spalla→anca > 35°): Zeus, 45°,
  invariato (json identico a zeus-mesh-5.1).
- **Dal GOMITO** se l'omero scende lungo il fianco (≤ 35°): Domatrice, 13°. Nel pezzo vanno avambraccio, mano e
  oggetto, più un tratto d'omero di 0,08 × spalle attorno al gomito (sovrapposizione); l'omero e la giacca restano
  nella mesh del corpo e seguono la catena del braccio. Il riempimento dietro il pezzo vale per tutto il pezzo vicino
  al corpo (fascia 0,14 × spalle), non solo sopra il gomito.
- **Isole**: parti del personaggio staccate dal corpo che toccano il braccio tagliato (< 2% del personaggio) vanno nel
  pezzo come oggetto (Domatrice: frammento del cerchio; Zeus: un rombo di riempimento nascosto sotto il fulmine).
- Regolabili in `MESH_RIG_RULES`: `armFrom` ("auto" | "spalla" | "gomito"), `armDownMaxDeg`, `elbowOverlap`.
- Nell'app la tabella delle scelte mostra la riga "braccio_… tagliato dal GOMITO/dalla SPALLA (n°)".
- Nota: il bordo blu sotto la manica della Domatrice è nell'originale (luce di contorno), non è un difetto.

## R9 — Sorriso (S1–S6), zeus-mesh-8
Richiesta dell'8 ott (avvocato: "come faccio a farlo sorridere"). Scelta nell'app: **Sorriso = no / nel loop / sempre**
(di serie "no": la bocca resta quella del disegno).
- **Angoli dai pixel**, non dalla posa: i punti 9-10 di MediaPipe stanno spesso sopra la bocca (avvocato). Nel riquadro
  attorno a quei punti si cercano i pixel più scuri della pelle (< 60%) o rossi come le labbra; la componente più larga
  vicino al centro (vicini entro 2 px: la linea disegnata è spesso spezzata) dà angolo sinistro e destro. Se non c'è,
  si usano i punti della posa (lo dice la tabella).
- **Bocca all'ingiù** (broncio): se gli angoli stanno sotto la linea delle labbra al centro (media dei pixel della bocca
  nella fascia centrale, non il bordo alto: le labbra piene della Domatrice non sono un broncio), il sorriso prima
  riporta su gli angoli di quella differenza, poi sorride.
- **Pezzo "bocca"** ad anelli, come la palpebra della Domatrice: copia dei pixel del corpo attorno alla bocca
  (ellisse 1,1 × 0,8 la larghezza della bocca), davanti al corpo, sull'osso "viso". Anello esterno fermo sul viso
  (a riposo coincide col corpo: S3); verso l'interno i vertici seguono le ossa `bocca_sx`/`bocca_dx` entro 0,6 × la
  larghezza dagli angoli: gli angoli salgono, il centro quasi no, e la curva diventa un sorriso.
- Ampiezza: su di `smileUp` 0,16 × larghezza (+ il broncio), in fuori `smileOut` 0,06 ×. "nel loop": sale 3,0→3,5 s,
  tiene, torna 4,8→5,3 s (dopo il battito a 2 s). "sempre": spostamento costante (nel setup la bocca resta disegnata).
- Limite noto: è una deformazione, non un ridisegno; sotto gli angoli la pelle si stira un po'. Una bocca aperta coi
  denti richiederebbe di disegnarla (Gemini).

## R10 — Sorriso RIDISEGNATO con Gemini (G1–G4), zeus-mesh-9
Il sorriso deformato (R9) non convince ("bisogna utilizzare Gemini per creare la parte"). Nell'app, con Sorriso ≠ no:
**bocca ridisegnata (Gemini)** (di serie) oppure **deformazione (senza AI)**; con Gemini: **bocca chiusa** o **con i denti**.
1. Angoli e larghezza della bocca come in R9 (`findMouth`).
2. Ritaglio 16:9 attorno alla bocca (5 × la larghezza; naso e mento dentro), trasparente → grigio medio, ingrandito a
   1376 px e mandato alla funzione edge già in produzione `generate-sprite-sheet` (prompt personalizzato + immagine;
   `referenceAnalysisError` valorizzato per saltare l'analisi del riferimento). Nessuna nuova funzione da pubblicare,
   la chiave resta nei Secrets di Supabase, modello `gemini-3-pro-image-preview`.
3. Prompt (`SMILE_PROMPTS`, 3 varianti per tipo): cambiare SOLO la bocca, inquadratura e tutto il resto identici; si
   dice che è un personaggio illustrato ORIGINALE per un gioco slot. Se Gemini non restituisce l'immagine
   (finishReason IMAGE_OTHER / SAFETY / PROHIBITED_CONTENT: visto sull'avvocato l'8 ott, succede con volti che
   sembrano persone reali) si prova la variante successiva; dopo 3 rifiuti si usa la deformazione R9 e lo si dice.
4. **Riallineamento**: la risposta, riportata alle misure del ritaglio, si sposta (±6%) e si scala (0,94–1,06) finché i
   pixel FUORI dalla bocca coincidono con l'originale; scarto medio > 22 → avviso "Gemini ha cambiato anche il resto del
   viso: meglio ridisegnare".
5. **Colori**: guadagno + scarto per canale stimati sull'anello attorno alla bocca (stessa pelle e luce).
6. **Pezzo `bocca_sorriso`**: solo l'ellisse della bocca (1,15 × 0,85 la larghezza), pieno fino a 0,65 del raggio, poi
   sfumato a zero; region sull'osso "viso", davanti al corpo, invisibile nel setup (colore ffffff00).
7. **Animazione**: "nel loop" compare 3,0→3,35 s, resta, sparisce 4,85→5,2 s; "sempre" visibile per tutto il loop.
   Con il pezzo di Gemini non si usa la deformazione R9.
- Nell'app: anteprime Originale / Gemini / Risultato, riallineamento trovato, pulsante "🔄 Ridisegna bocca (Gemini)".
  La risposta resta in memoria: "Ricrea" non richiama Gemini se il tipo di bocca non cambia.
- Costo: una immagine Gemini per ogni "Crea character"/"Ridisegna" col sorriso ridisegnato.

## R11 — Casi limite (E1–E2), zeus-mesh-9.2
- **Personaggio che esce dal bordo dell'immagine** (Robin Hood, tagliato in basso): i vertici del bordo della griglia
  cadono su x = W / y = H; l'etichetta del pixel più vicino si legge con le coordinate riportate dentro l'immagine.
  Prima: errore "Impossibile leggere le proprietà di undefined (lettura di 'length')".
- **Oggetto che attraversa la linea di mezzo** (freccia tenuta fra le due mani, arco): è UN pezzo e va tutto al lato
  che ne ha di più, invece di essere spezzato sulla verticale del collo (due metà che si muovono ognuna col suo braccio).
  Limite: l'altra mano non tiene l'oggetto (la freccia segue la mano dell'arco).

## R12 — Occhi trovati meglio (zeus-mesh-9.3)
Robin Hood (8 ott, "anche gli occhi vengono chiusi male"): il buco dell'occhio era solo il bianco a destra dell'iride
VERDE (l'iride valeva solo se blu) e il punto della posa stava di lato all'occhio: la palpebra chiudeva solo quella
striscia e l'iride restava aperta. Avvocato: iride castana e bianco in ombra fuori dal buco, pupilla visibile a occhio
chiuso.
- Iride: blu (b > r) o VERDE (g > r + 20, anche scura). Castana: nessuna regola di colore (prendeva ombretto e ciglia
  della Domatrice): la prende la chiusura per righe.
- Bianco: chiaro e poco saturo (l > 170, sat < 60) oppure in ombra quasi senza colore (l > 120, sat < 35).
- Buco = componente più grande + le altre ≥ 10% alla stessa altezza (il bianco dall'altra parte dell'iride); poi
  chiusura dall'esterno e CHIUSURA PER RIGHE (fra due pixel del buco sulla stessa riga, distanza ≤ 0,6 × larghezza).
- Seconda ricerca centrata sul buco trovato; si tiene solo se contiene ≥ 80% del primo buco ed è alta ≤ 1,5 volte
  (le finestre più alte salivano su sopracciglia e trucco della Domatrice: provato e scartato).
- Riflessi bianchi dentro l'iride (fra pixel d'iride su riga e colonna) vanno nella pupilla e si muovono con lei.
- Zeus: buco più completo, occhio chiuso più pulito (json diverso da zeus-mesh-9.2 solo negli occhi); M1–M7 verdi.

## R4 — Pezzo del braccio tagliato (M4)
Mesh propria (14 celle) sulle ossa del braccio; i vertici fuori sagoma seguono il pixel DEL PEZZO più vicino:
l'oggetto in mano dipende solo dall'osso della mano ed è rigido.

## R5 — Occhi (M3), come la Domatrice
- Buco nel corpo = sclera + iride (pupilla e riflessi compresi), componente principale attorno al punto della posa.
- Sotto il corpo: `bianco_*` (colore della sclera, ombra in alto) e `pupilla_*` (iride dell'originale) sull'osso pupilla.
- Davanti: `palpebra_*` = copia della pelle attorno all'occhio (buco escluso) con TRE anelli di 24 vertici:
  interno sul contorno del buco (racchiude tutto il buco, per settore angolare) 100% sull'osso palpebra al centro
  dell'occhio; intermedio 50/50; esterno fermo. A riposo coincide col corpo e non si vede.
- Battito a 2,0 s: scala Y dell'osso palpebra 1 → −0,04 in 0,13 s → 1 in 0,2 s. A occhio chiuso 0 pixel di occhio visibili.
- Alternativa: `MESH_RIG_RULES.lid = "disegnata"` (palpebra chiusa disegnata, zeus-mesh-4).

## R6 — Animazione `ambient` (M5, M6), loop 6 s
Ampiezze (gradi): schiena ±1,2 (due oscillazioni), petto −2,4 + respiro 1%, testa ±2 (solo rotazione: lo
spostamento della testa stirava cappello e capelli), omero ±3, avambraccio ±2,4, mano ±3 (due), fasi sfalsate fra
i lati. Viso che scorre 0,4% dell'altezza. Pupille: due sguardi. Capelli dietro: ±3 / ±3,9.
Chiavi solo su massimi, minimi e flessi, con curve di Bézier (tangente esatta): 4–9 chiavi per traccia.
Ogni traccia torna al valore iniziale a fine loop.

## R7 — Pacchetto Spine 4.1 (M7)
`<nome>.json` (skeleton.images = "./images/") + `<nome>.atlas` + `<nome>.png` (pagina unica per il runtime) +
`images/<pezzo>.png` (per Spine → Import Data). Verificato col runtime ufficiale `@esotericsoftware/spine-core` 4.1.56:
legge il pacchetto, nessun valore non valido, vertici uguali al simulatore entro 0,64 px.
Comando: `node scripts/verifySpineRuntime.mjs <cartella con spine-core> <json> <atlas>`.

## Strumenti
- `scripts/zeusMesh.mjs [cartella] [ampiezze×] [fotogrammi]`: genera Zeus + fotogrammi di controllo.
- `scripts/meshCase.mjs <nome> [cartella] [fotogrammi]`: stesso metodo su un caso di `tests/fixtures/recognition/<nome>/`
  (come Riconosci parti → Crea character).
- `scripts/renderSpine.mjs <json> <cartella png> <animazione> <uscita>`: rende qualsiasi JSON Spine (anche la Domatrice).
- I controlli dei raccordi di `simulateLoop` valgono per i pezzi rigidi della tavola esplosa, non per questo metodo:
  qui valgono M1–M7.

## Da fare
Catene per barba/ciocche, gambe; pulsante nell'app con la tabella taglio/mesh modificabile;
prova su Jessica (capelli lunghi, bocchino); leprecauno (mano col sacchetto DAVANTI alla pancia: mano doppia, serve l'originale per
verificare che il riempimento copra tutta la mano dipinta sul corpo).
