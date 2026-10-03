# Regole della tavola esplosa → character Spine

Versione: `2026-10-03.zeus.3` (Zeus approvato dall'utente: "perfetta") · progetto `slot-spine-web-ai`
Unità usate: **u** = distanza fra i centri degli occhi nell'originale; **sw** = distanza fra le spalle; coordinate sempre nell'immagine ORIGINALE.
"sx/dx" = lato del PERSONAGGIO (sx = a destra per chi guarda).
Stato: ✅ approvata dall'utente (Zeus incluso, 3 ott) · 🟡 da verificare in movimento nella pagina del character.

---

## A. Prompt della tavola (cosa chiediamo a Gemini)

| # | Regola | Stato | Dove |
|---|---|---|---|
| A1 | Stesso personaggio, stile, scala, proporzioni; **mai** cambiare posa, angoli, forma. Solo spostare i pezzi, mai ruotarli o scalarli. | ✅ | `ExplodedSheetImport.buildExplodedPrompt` |
| A2 | Al massimo 6–8 pezzi grandi (16 con il viso). Niente piastre/frammenti. | ✅ | idem |
| A3 | Sfondo pieno chroma, il colore **meno presente** nel personaggio fra blu `#0018FF`, verde `#00FF00`, magenta `#FF00FF`. Niente ombre, aloni, particelle, testo. | ✅ | `chooseChromaColor` |
| A4 | Pezzi staccati con spazio libero, vicini alla loro posizione originale. | ✅ | prompt |
| A5 | Zone nascoste ridisegnate: collo sotto la testa, spalla sotto l'attacco del braccio (con sovrapposizione), senza nuova linea nera sul taglio. Contorni esterni conservati. | ✅ | prompt |
| A6 | **Mano che impugna un oggetto lungo** (fulmine, bastone, lancia, spada) + oggetto intero = **un solo pezzo**, tagliato al polso. Pixel della presa conservati, niente buco a forma di mano, parte nascosta nel pugno non ridisegnata. Il braccio finisce al polso. Mano aperta = col suo braccio. | ✅ | prompt + `handObject.js` |
| A7 | **Capelli posteriori sempre un pezzo a sé**, allungati un po' sotto la testa. La testa tiene solo capelli davanti, corona, barba, con contorno pulito. | ✅ | prompt + `faceRig.labelBackHair` |
| A8 | **Lembo davanti alla spalla** (mantello, drappo con fibula) = un pezzo unico; la spalla sotto deve essere completa. | ✅ | prompt |
| A9 | Con viso: occhi aperti, sopracciglia, bocca, **baffi in due metà**, ciocche laterali come pezzi piccoli, **stessa misura dell'originale** (non ingranditi). Sulla testa palpebre chiuse e pelle liscia sotto i tratti, niente buchi. | ✅ | `FACE_PROMPT` |

---

## B. Controlli della tavola caricata

| # | Regola | Valore |
|---|---|---|
| B1 | Rifiuto se la tavola è l'immagine originale | differenza media < 6 |
| B2 | Rifiuto se lo sfondo non è saturo (nero/bianco/grigio) | max−min canali < 80 |
| B3 | Avviso se il colore di sfondo è nel personaggio | > 0,5% dei pixel |
| B4 | Pezzo = componente connessa (alpha > 0,5), briciole scartate | area < 0,015% della tavola |
| B5 | Rifiuto se troppo frammentata | > **16** pezzi (`MAX_PIECES`) |
| B6 | Scala comune tavola→originale dal pezzo più grande | 1 se errore < 35, altrimenti 0,80–1,25 |

---

## C. Ricollocamento dei pezzi

| # | Regola | Valore | Stato |
|---|---|---|---|
| C1 | Pezzi grandi: ricerca su tutta l'immagine a passo 8, rifinitura 2 → 1 px | errore troncato a 120 | ✅ |
| C2 | Pezzi piccoli (lato < **12%** dell'originale): ricerca a passo 2 | 1000 campioni | ✅ |
| C3 | **Gruppo del viso**: candidati = pezzi con lato fra **0,15 u e 2,4 u** (max 9). Per ogni pezzo × ogni punto (occhio sx/dx, sopracciglio sx/dx = 0,5 u sopra l'occhio, bocca, baffo sx/dx = 0,6 u di lato e 0,15 u sotto la bocca): ricerca locale entro **0,8 u**, scale `1, 0.6, 0.7, 0.8, 0.9, 1.1, 1.2, 1.3, 1.45`, accettata se errore ≤ **72**. | — | ✅ |
| C4 | Costo del gruppo = Σ max(0, errore + 10·\|ln scala\| − 30)/40 + RMS disposizione/u + **1,5** per pezzo non assegnato. Obbligatori i due occhi. Vince il costo minimo. | — | ✅ |
| C5 | Un **baffo** deve poggiare sulla testa (≥ **30%** dei pixel); altrimenti torna pezzo normale (ciocca). | — | ✅ |
| C6 | **Tenuto in mano** = qualche pixel entro **0,25 sw** dal polso/mano. Se no: si prova vicino alla mano, accettato solo se errore < min(errore attuale − 15, 75). | — | ✅ |
| C7 | Pezzo con errore > 80 → avviso "posizione incerta". | — | ✅ |

---

## D. Nomi, genitori, pivot

| Pezzo | Riconoscimento | Genitore | Pivot | Stato |
|---|---|---|---|---|
| `testa` | copre il naso; punteggio = completezza × specificità dei punti testa | busto | base del collo | ✅ |
| `busto` | copre un'anca | radice | centro delle anche | ✅ |
| `braccio_sx/dx` | copre il gomito + percorso spalla→gomito→polso | busto | spalla | ✅ |
| `occhio_sx/dx` | centro entro **0,35 u** dall'occhio (o gruppo C3) | testa | centro | ✅ |
| `sopracciglio_sx/dx` | entro 0,35 u dal punto 0,5 u sopra l'occhio | testa | centro | ✅ |
| `bocca` | entro **0,5 u** dal centro bocca, lato ≤ 1,8 u | testa | centro | ✅ |
| `baffo_sx/dx` | entro 0,45 u dal punto baffo, lato ≤ 1,8 u, sulla testa | testa | attaccatura (riga più alta sulla testa) | ✅ |
| `ciocca[_sx/_dx]` | attaccata alla testa, sporge dal viso (≥ 0,6 raggio), centro **non oltre 1 u sotto la bocca** | testa | attaccatura | ✅ |
| `capelli_dietro` | lato ≥ 1,2 u, non copre i polsi, e (≥ **20%** pixel sulla testa **oppure** riquadro ≥ **30%** dentro quello della testa con centro sopra le spalle) | testa | attaccatura | ✅ |
| `mano_oggetto_sx/dx` | copre polso + ≥1 punto mano; lunghezza asse principale ≥ **1,5 × avambraccio**; allungamento ≥ **2,2** | braccio del lato | polso | ✅ |
| `copertura_spalla_sx/dx` | non in mano; ≥ **5%** sul busto e ≥ **10%** su un braccio, entro la diagonale del pezzo dalla spalla | busto | spalla | ✅ |
| `oggetto[_N]` | tenuto in mano (C6), non lungo | braccio della mano più vicina | polso | ✅ |
| `accessorio_N` | non in mano, non copertura | pezzo del corpo con più sovrapposizione (busto preferito se ≥ 50% del migliore) | baricentro zona comune | ✅ |
| `dettaglio_viso` | dentro il viso, nessun altro nome | testa | centro | ✅ |

---

## E. Ordine di disegno

| # | Regola | Stato |
|---|---|---|
| E1 | Per ogni coppia sovrapposta davanti va il pezzo che somiglia di più all'originale (≥ 30 px in comune), poi ordinamento topologico. | ✅ |
| E2 | Occhi, sopracciglia, bocca, baffi **sempre davanti alla testa**. | ✅ |
| E3 | `capelli_dietro` **sempre in fondo** (dietro testa e busto). | ✅ |
| E4 | `copertura_spalla_*` subito **davanti a busto e braccio** del suo lato. | ✅ |

---

## F. Ricomposizione dall'originale (`sheetAssembly.transplantOriginal`) ✅

1. Sagoma del personaggio nell'originale: alpha > 16 se c'è trasparenza; altrimenti tutto tranne lo sfondo collegato al bordo (tolleranza **28**).
2. Ogni pixel della sagoma appartiene al pezzo **più davanti** che lo copre; se nessuno lo copre, al più vicino entro **48 px**.
3. Pixel posseduto → colore dell'**originale**. Pixel del pezzo **nascosto** da un pezzo davanti → resta il disegno della tavola. Pixel fuori sagoma e non nascosto → trasparente.
4. **Nessun pixel perso**: i pixel del personaggio che restano senza pezzo (scintille, monete, particelle non disegnate nella tavola) diventano pezzi `resto_N` con i pixel dell'originale. Gruppi = componenti entro 60 px; scartati solo i gruppi sotto lo 0,1% del personaggio. Genitore = pezzo con più pixel attorno; fermi; disegnati sopra il genitore.
5. Ricomposizione = originale per costruzione. La posizione trovata resta in `p.aligned`.

---

## G. Fedeltà e controlli finali

| # | Regola | Valore | Stato |
|---|---|---|---|
| G1 | Errore colori medio (pesato sull'area) | ≤ **50** fedele (anche dataset); ≤ **75** utilizzabile | ✅ |
| G2 | Utilizzabile anche se > 75 quando la posa è la stessa: **IoU sagome ≥ 0,84**, **buchi ≤ 1%**, **riempito per vicinanza ≤ 7%** (Zeus 0,861 / 5,3% ✔; folletto ridisegnato 0,815 / 9,3% ✘) | non per il dataset | ✅ |
| G3 | Avviso se > 0,5% del personaggio non era in nessun pezzo | — | ✅ |
| G4 | Controllo pezzo per pezzo: sagoma ≥ **0,6**; errore locale piccoli ≤ **65**, grandi ≤ **75**; occhi/sopracciglia/bocca sulla testa ≥ **70%**; occhi e sopracciglia a coppie | — | ✅ |
| G5 | Mano+oggetto: mano duplicata sul braccio (≥ 2 punti mano coperti), polso scoperto (sovrapposizione < 6 px), frammento di oggetto entro 12 px | avvisi | ✅ |

---

## H. Animazione di partenza

| Ruolo / pezzo | Animazione | Ampiezza |
|---|---|---|
| busto | ferma (respiro con mesh) | — |
| testa | oscillazione 0,6 | ±2,5° |
| braccia | oscillazione 0,8 (braccio alzato = saluto) | ±2° (saluto ±9°) |
| oggetto in mano | oscillazione 0,7, in ritardo | ±3,5° |
| `mano_oggetto_*`, `presa_*`, `copertura_*`, `resto_*` | **ferma**, eredita il genitore | — |
| occhi | battito sincronizzato, trasparenza piena (si vede la palpebra) | 1 ogni 4 s |
| sopracciglia, bocca | ferme | — |
| ciocche | vento 1,0 | ±3° |
| capelli_dietro | vento 0,8 | ±3° 🟡 |
| baffi | vento 0,7 | ±3° 🟡 |

---

## L. GARANZIA DI PRECISIONE (regola fissa) ✅

Per ogni character, la ricomposizione dei pezzi deve coincidere con l'originale:
- pixel del personaggio **scoperti ≤ 1%**;
- pixel **diversi dall'originale ≤ 1%** (differenza RGB > 30).

Come si ottiene sempre:
1. la tavola deve rispettare la **posa** (G1 o G2); se no si rigenera, mai correggerla a mano;
2. i pixel visibili vengono **sempre** dall'originale (F), la tavola solo nelle zone nascoste;
3. il viso si piazza **come gruppo** (C3–C5), mai pezzo per pezzo sul solo colore;
4. ciò che manca nella tavola diventa `resto_N` (F4), niente buchi.

Verifica automatica: `tests/precision.test.mjs` controlla OGNI caso in `tests/fixtures/exploded/`. **Ogni nuovo character approvato si aggiunge lì** (original.png, sheet.png, landmarks.json, expected.json) e da quel momento resta garantito.

Limiti noti: le zone nascoste sono disegnate da Gemini e vanno guardate in movimento; con la posa sbagliata (landmark errati) nomi e genitori possono sbagliare anche con ricomposizione perfetta.

## I. Lezioni (non toccare)

- Una tavola che cambia la **posa** non si salva: rigenerarla.
- La fedeltà dei colori non vede i pezzi piccoli: serve il controllo pezzo per pezzo.
- Il viso migliore viene dalla testa **originale**; Gemini serve solo per le zone nascoste.
- Mai fidarsi del solo colore per i tratti bianchi (sopracciglia, baffi, barba): usare il gruppo del viso.

## P. PROFILO "TESTA-BUSTO" 🟡 (da validare in movimento)

Profilo di separazione aggiuntivo (`src/lib/separationProfiles.js`), scelto nell'app accanto a **Standard** (folletto, avvocato, Zeus), che **resta invariato** e predefinito.
Per personaggi con petto e spalle scoperti sopra l'abito e capelli lunghi (caso: Jessica, 3 ott 2026).
Riferimenti: **tavola corretta di Jessica** per divisione dei pezzi e attacchi; **immagine originale** per identità, colori, posa, proporzioni e dimensioni. La tavola è un riferimento grafico, **non** un caso validato in movimento.

### P1. Pezzi — 12, ruoli espliciti (mai dedotti solo da colore o dimensione)

| # | Pezzo | Nome | Genitore |
|---|---|---|---|
| 1 | Testa-busto: testa, orecchie, orecchini, capelli anteriori corti, collo, clavicole, petto fino al bordo del vestito | `testa` | busto |
| 2–3 | Due ciocche anteriori lunghe, separate, non duplicate sulla testa | `ciocca_dx`, `ciocca_sx` | testa |
| 4–5 | Due sopracciglia | `sopracciglio_dx/sx` | testa |
| 6–7 | Due occhi aperti con ciglia | `occhio_dx/sx` | testa |
| 8 | Bocca | `bocca` | testa |
| 9 | Capelli posteriori, un unico pezzo indipendente | `capelli_dietro` | testa |
| 10 | Braccio alzato completo, spalla → dita, guanto, mano e oggetto nello **stesso** pezzo | `braccio_alzato` | busto |
| 11 | Braccio abbassato completo, spalla → dita | `braccio_abbassato` | busto |
| 12 | Vestito completo con gambe e scarpe | `busto` | radice |

I capelli posteriori non possono diventare `busto`; il vestito non può diventare `accessorio`. Ruolo mancante o doppio = **errore**, non un nome inventato.

### P2. Attacchi delle braccia — regola essenziale
- Ogni braccio ha la **propria spalla arrotondata completa**, ricostruita anche dove la copre il busto.
- La testa-busto **non** conserva frammenti di braccio o calotte delle spalle: i bordi laterali seguono l'attacco naturale verso le ascelle.
- Attacchi estesi leggermente sotto il busto (sovrapposizione per il movimento); sfumatura della pelle continua: niente nuove linee nere, anelli scuri, superfici piatte da moncone. Contorni esterni originali conservati.
- In ricomposizione il busto copre il margine interno degli attacchi; la rotazione delle braccia non deve produrre buchi, doppie spalle o bordi di taglio visibili.

### P3. Viso e capelli
- Sulla testa: palpebre chiuse con trucco e linea delle ciglia; pelle uniforme dove erano sopracciglia e bocca; **naso conservato**; nessun foro.
- Tratti separati con dimensioni e forme originali; sopracciglia sopra gli occhi, bocca sotto, destra/sinistra non scambiate.
- Capelli posteriori separati, completati, disegnati dietro testa e busto; le due ciocche anteriori indipendenti.

### P4. Posa e tavola
- Pose, angoli, scala e proporzioni dell'originale; pezzi solo spostati, mai ruotati o ridimensionati. Braccio alzato ancora piegato; braccio abbassato con la stessa inclinazione.
- Sfondo uniforme `#0018FF`, senza fumo, ombre, bagliori, testo, particelle; spazio blu chiaro fra tutti i pezzi.

### P5. Differenze dal profilo Standard
- **Niente taglio al polso** (A6/`handObject.js` spento): braccio alzato, mano e oggetto insieme.
- **Niente pixel dell'originale per nascondere errori**: niente `resto_N`, niente riempimento per vicinanza (F2/F4 spenti). Ciò che manca è un errore visibile.
- Le soglie **non** si abbassano.

### P6. Validazione (separata, in quest'ordine)
1. fedeltà all'originale; 2. nomi e genitori dei pezzi; 3. assenza di duplicazioni (spalle, ciocche, tratti del viso); 4. raccordi durante il movimento (simulazione).
I test dei personaggi approvati restano invariati; Jessica entra come **caso di riferimento**, non come caso approvato.

Stato attuazione: P1 (ruoli) e prompt nell'app ✅ (passo 1) · importatore del profilo (passo 2) · controlli dei raccordi (passo 3) · Jessica caso di riferimento (passo 4).

## Casi di prova

`tests/fixtures/exploded/`: folletto (30), folletto_viso (32), avvocato (63), folletto_ridisegnata (84, da scartare), **zeus (79,5 colori · IoU 0,86 · utilizzabile)**. Test: `node --test tests/*.test.mjs` → 101/101, garanzia di precisione superata da avvocato, folletto, folletto_viso, zeus.
