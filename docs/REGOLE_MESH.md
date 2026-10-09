# Regole del metodo MESH (personaggio intero in mesh pesata) — versione zeus-mesh-12, 9 ott 2026

Riferimento professionale: rig della Domatrice (`claude/ANALISI_RIG_DOMATRICE.md`). Caso approvato: Zeus, zeus-mesh-5
("perfetto", 8 ott). Codice: `src/lib/meshRig.js`. Test: `tests/meshRig.test.mjs` (M1–M7, Zeus), `tests/meshRigDomatrice.test.mjs` (D1–D5, Domatrice), `tests/meshRigBocca.test.mjs` (S1–S6, sorriso deformato), `tests/mouthGemini.test.mjs` (G1–G4, sorriso ridisegnato), `tests/meshRigOcchi.test.mjs` (O1, occhi), `tests/meshRigOggetto.test.mjs` (B1–B3, oggetto completato).

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

## R12 — Occhi trovati meglio (zeus-mesh-9.3) — APPROVATA dall'utente il 9 ott ("perfetto", Robin Hood)
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
- Garanzia per i casi futuri: `tests/meshRigOcchi.test.mjs` (O1) su avvocato, Domatrice e **Robin Hood**
  (`tests/fixtures/recognition/robin/`, ricostruito dal suo pacchetto: occhi di lato all'iride verde, come il caso che
  falliva). Ogni modifica futura alla ricerca degli occhi deve tenerli tutti e tre verdi.

## R13 — Oggetto in mano COMPLETATO (B1–B3), zeus-mesh-10
Robin Hood (9 ott, "l'arco si spezza, non è separato con la mano"): nel browser il riconoscimento dell'oggetto (rifinitura
col segmentatore a punto, limitata a un riquadro attorno alla mano) aveva preso solo 13709 px d'arco vicino alla mano;
il resto dell'arco restava nel corpo e si piegava con la mesh, staccandosi dal tratto tagliato.
- Per ogni braccio tagliato: TAVOLOZZA dei colori dell'oggetto riconosciuto (pixel lontani dalla mano, colori RGB a
  8 livelli presenti in ≥ 1% dei pixel), CRESCITA sui pixel del personaggio collegati con quei colori (non sulla testa,
  al massimo 6 volte l'oggetto riconosciuto), e se l'oggetto è quasi tutto di una categoria del segmentatore diversa
  da "vestiti" (es. accessori) solo dentro quella categoria.
- FILTRO "a binario": si tiene solo ciò che PROSEGUE l'oggetto lungo il suo asse, tratto per tratto, in un corridoio
  previsto (centro che continua con la sua direzione, larghezza media degli ultimi tratti + 4 px, al massimo 0,3 ×
  spalle): segue le curve dell'arco, non entra nelle parti toccate di lato.
- Contorno e ombre scure dell'oggetto (fino a 4 px attorno) fanno parte dell'oggetto.
- Riempimento dietro il pezzo (zeus-mesh-10.1): sotto l'OGGETTO si riempie solo se sta dentro la sagoma del corpo
  (corpo da due lati opposti); accanto a parti sottili (corda) niente riempimento — prima restava una macchia vicino
  alla punta dell'arco che si vedeva quando l'arco si muove (B4).
- Tutto va nel pezzo del braccio tagliato, rigido sulla mano. Tabella: "oggetto_dx: completato per colore lungo
  l'asse (+N px ai M riconosciuti)". Spegnibile con `objectGrow: false`.
- Limiti noti: la corda dell'arco resta nel corpo; dove la punta dell'arco tocca una parte dello stesso colore (risvolto
  dello stivale) un pezzetto può entrare nel pezzo se le categorie non le distinguono.
- Zeus identico a zeus-mesh-9.3.1 (fulmine già intero).

## R14 — Oggetto FERMO, maschera block (B5), zeus-mesh-11
Robin Hood (9 ott): "arco rotto sopra e sotto, piuttosto non muoverlo: fai una maschera block e muovi il resto".
Casella nell'app **🔒 Oggetto fermo** (attiva di serie; regola `lockObject`, di serie spenta nel codice: Zeus invariato).
- Il pezzo del braccio tagliato (mano + oggetto) è pesato al 100% sulla radice: non si muove. Le ossa di quel
  braccio non hanno animazione.
- MASCHERA nel corpo: pixel bloccati = pezzo del braccio + parti dell'oggetto rimaste nel corpo (stessi colori,
  collegate, fino a 10 volte l'oggetto riconosciuto) + tutto ciò che sta dentro il contorno convesso dell'oggetto
  (+ margine 0,03 × spalle: la corda tesa fra le punte). I vertici del corpo entro una cella della griglia sono fermi,
  poi la fermezza sfuma su `lockBand` 0,14 × spalle: niente strappi fra parte ferma e parte che si muove.
- Così anche le parti d'oggetto che il riconoscimento non ha preso restano ferme e l'oggetto non si spezza.
- Tabella: "oggetto FERMO: braccio e oggetto bloccati, maschera di N px attorno (+M px d'oggetto rimasti nel corpo)".

Correzione zeus-mesh-13.1 (9 ott, vista Weights di Spine su Zeus: 277 vertici del corpo su 851 sulla radice, busto
fermo): con l'oggetto già completato (R13) la crescita per colore della maschera si ferma a `lockGrow` 0,08 spalle dal
pezzo (oro e bianco del fulmine sono anche su tunica e cintura). Senza completamento resta come prima. Test M8.

## R15 — Inquadratura (F1–F2), zeus-mesh-11.1 / 12
"Uno strumento per mostrare solo la porzione d'interesse" e "non c'è modo di fare frame nello Spine?".
- Nell'app, accanto all'anteprima: **🔍 Inquadratura**: rettangolo trascinato sulla miniatura, o Tutto / Viso / Busto
  (viso: 1,5 × spalle attorno all'osso "viso"; busto: dalla vita a sopra la testa, 2,2 × spalle). L'anteprima (player
  Spine 4.1) mostra solo quella porzione.
- **✂️ Ritaglia anche il pacchetto Spine** (attiva di serie quando c'è un'inquadratura): `applyFrameClip` aggiunge una
  MASCHERA DI RITAGLIO Spine (clipping attachment rettangolare) come primo slot "inquadratura" sull'osso radice, che
  ritaglia tutti gli slot fino all'ultimo; il riquadro dello skeleton diventa quello dell'inquadratura. Zip
  "…_inquadrato.zip"; il LEGGIMI riporta il riquadro. Per tornare al personaggio intero: nascondere o eliminare lo slot
  "inquadratura" in Spine. Letta dal runtime ufficiale 4.1 (F2). Nel gioco una maschera rettangolare costa poca CPU.
- Anche nella pagina del personaggio del METODO VECCHIO (`/character/:id`, pezzi e z-index; zeus-mesh-12.2): pulsante
  "🔍 Inquadratura" sotto l'anteprima composita → si trascina il rettangolo sull'anteprima (fuori resta scurito);
  "✂️ Ritaglia anche il pacchetto Spine" → "Scarica pacchetto" aggiunge la stessa maschera (`applyFrameClip`).
  Conversione anteprima → skeleton: x = px/zoom − centroX, y = centroY − py/zoom (y in alto, come gli offset delle parti).

## R16 — Mesh sulla SAGOMA (H1–H5), zeus-mesh-13
Difetto (9 ott, vista mesh di Spine su Zeus): ogni mesh era una griglia regolare sul riquadro intero, vertici anche sullo
sfondo trasparente. Ora (`src/lib/silhouetteMesh.js`, regola `meshShape: "sagoma"`; `"griglia"` = prima):
- contorno (hull) sui pixel visibili allargati di 2 px, semplificato (Douglas-Peucker 1,5 px), lati ≤ un passo;
- puntini staccati (< 0,05% dei pixel, max 200) fuori dalla mesh; parti staccate unite da un corridoio di 5 px;
- buchi grandi (≥ 2 passi², es. dentro il cerchio della Domatrice) restano VUOTI: anello di vertici, nessun triangolo;
  buchi piccoli riempiti; i lati di contorno e buchi sono anche in `edges` (l'editor li conserva);
- vertici interni solo dentro, griglia sfalsata al passo base (lato lungo / `cells`), più fitta (× `denseStep` 0,55)
  entro 0,2 spalle da collo, testa, spalle, gomiti, polsi e nel raggio del viso;
- Delaunay che rispetta i contorni (lati mancanti divisi a metà); controllo: area dei triangoli = area del contorno
  meno i buchi, altrimenti si torna alla griglia. Coordinate intere sugli spigoli dei pixel → UV esatte, riposo identico.
Zeus: corpo 920 vertici (prima 35×~41 su tutto il riquadro), Domatrice: cerchio vuoto. Vista: `node scripts/meshView.mjs`.

## R17 — Pesi MORBIDI (W1), zeus-mesh-13
Richiesta (9 ott): "gestisci i pesi in maniera ottimale" (vista Weights a gradini). Dopo i pesi da catena/viso/blocco,
4 passate di media coi vicini (`weightSmooth`; metà peso proprio, metà media dei vicini) lungo i lati dei triangoli:
la media corre DENTRO la mesh, quindi due parti vicine ma staccate (braccio e fianco con lo sfondo in mezzo) non si
scambiano pesi. Restano fissi: oggetto in mano (solo osso della mano, M4) e zona bloccata al 100% (R14).
Poi al massimo 4 ossa per vertice, pesi < 2% tolti, somma esattamente 1. W1: salti > 0,6 fra vertici vicini
ridotti di oltre 3 volte, nessun vertice con più di 4 ossa.

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
- `scripts/meshView.mjs <cartella> <nome.json> [uscita] [scala] [pesi]`: vista mesh come in Spine (lati, vertici,
  contorno arancione); con `pesi` i colori delle ossa mescolati come nella vista Weights.
- `scripts/renderSpine.mjs <json> <cartella png> <animazione> <uscita>`: rende qualsiasi JSON Spine (anche la Domatrice).
- I controlli dei raccordi di `simulateLoop` valgono per i pezzi rigidi della tavola esplosa, non per questo metodo:
  qui valgono M1–M7.

## Da fare
Catene per barba/ciocche, gambe; pulsante nell'app con la tabella taglio/mesh modificabile;
prova su Jessica (capelli lunghi, bocchino); leprecauno (mano col sacchetto DAVANTI alla pancia: mano doppia, serve l'originale per
verificare che il riempimento copra tutta la mano dipinta sul corpo).
