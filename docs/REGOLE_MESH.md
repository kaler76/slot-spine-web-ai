# Regole del metodo MESH (personaggio intero in mesh pesata) — versione zeus-mesh-5.1, 8 ott 2026

Riferimento professionale: rig della Domatrice (`claude/ANALISI_RIG_DOMATRICE.md`). Caso approvato: Zeus, zeus-mesh-5
("perfetto", 8 ott). Codice: `src/lib/meshRig.js`. Test: `tests/meshRig.test.mjs` (M1–M7).

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
- `scripts/renderSpine.mjs <json> <cartella png> <animazione> <uscita>`: rende qualsiasi JSON Spine (anche la Domatrice).
- I controlli dei raccordi di `simulateLoop` valgono per i pezzi rigidi della tavola esplosa, non per questo metodo:
  qui valgono M1–M7.

## Da fare
Bocca (angoli su ossa), catene per barba/ciocche, gambe; pulsante nell'app con la tabella taglio/mesh modificabile;
prova su Jessica (capelli lunghi, bocchino) e Domatrice (deve ritrovare il taglio del braccio col cerchio).
