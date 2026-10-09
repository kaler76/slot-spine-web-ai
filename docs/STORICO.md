# Storico dei progressi — character Spine (slot-spine-web-ai)

Un punto per ogni passo salvato: segno git (tag) per tornarci, cosa è cambiato, dove sono le regole e quali test lo
garantiscono. Per tornare a un punto: `git checkout <tag>` (per guardare) oppure `git switch -c prova <tag>`.
Ultimo in alto. Le regole valide sono sempre quelle del documento indicato; qui c'è il perché e il quando.

## Metodo MESH (originale intero deformato in mesh, pochi tagli) — docs/REGOLE_MESH.md

| Tag | Data | Cosa | Perché / difetto risolto | Test |
|---|---|---|---|---|
| zeus-mesh-11 | 9 ott | **Oggetto fermo** (maschera block): mano e oggetto bloccati, corpo attorno sfumato, il resto si muove; casella 🔒 nell'app | Robin: "arco rotto sopra e sotto, piuttosto non muoverlo, fai una maschera block" | B5 |
| zeus-mesh-10.1 | 9 ott | Niente riempimento sotto l'oggetto fuori dalla sagoma del corpo | Robin: "cos'è quel pezzo vicino alla punta" (macchia accanto alla corda) | B4 |
| zeus-mesh-10 | 9 ott | **Oggetto completato**: crescita per colore + filtro lungo l'asse, tutto nel pezzo della mano (arco intero, rigido) | Robin Hood: "l'arco si spezza, non è separato con la mano" | B1–B3 |
| zeus-mesh-9.3.1 | 9 ott | Robin Hood nei casi di prova (occhi); regola R12 **approvata "perfetto"** | Rendere la regola degli occhi garantita per i casi futuri | O1 (avvocato, Domatrice, Robin) |
| zeus-mesh-9.3 | 8 ott | Occhi: iride verde, bianco in ombra, buco dalle due parti dell'iride, chiusura per righe, ricerca ricentrata | Robin Hood e avvocato: occhi chiusi male (iride visibile) | M3, O1 + controllo visivo Zeus, Domatrice, avvocato |
| zeus-mesh-9.2 | 8 ott | Personaggio tagliato dal bordo dell'immagine; oggetto fra le due mani = un solo pezzo | Robin Hood: errore "reading 'length'" | E1, E2 |
| zeus-mesh-9.1 | 8 ott | Gemini rifiuta → altre 2 varianti del prompt ("personaggio illustrato originale"), poi deformazione senza AI | Avvocato: "Nessuna immagine nella risposta Gemini (IMAGE_OTHER)" | G1b |
| zeus-mesh-9 | 8 ott | **Sorriso ridisegnato con Gemini** (bocca chiusa / con i denti): ritaglio del viso → Gemini → riallineamento → colori → pezzo sfumato in dissolvenza | Il sorriso deformato non andava bene: "bisogna utilizzare Gemini per creare la parte" | G1–G4 |
| zeus-mesh-8 | 8 ott | **Sorriso** a scelta (no / nel loop / sempre): angoli della bocca trovati dai pixel, pezzo ad anelli sul viso, broncio raddrizzato | Richiesta: far sorridere l'avvocato | S1–S6 |
| zeus-mesh-7 | 8 ott | Braccio lungo il fianco tagliato dal **gomito** (auto: angolo omero ≤ 35°), isole del corpo che toccano il braccio vanno nel pezzo | Domatrice: il pezzo si portava via risvolto e bottoni (striscia grigia in movimento), frammento di cerchio sospeso | D1–D5 + M1–M7 |
| zeus-mesh-6 | 8 ott | Nell'app: Riconosci parti → **Crea character** (tabella scelte, anteprima col player Spine 4.1.56, zip Spine 4.1) | Metodo usabile dal sito, non solo da script | build + prova Zeus nel browser |
| zeus-mesh-5.1 | 8 ott | Pacchetto Spine 4.1 (atlas a pagina unica + images/), UV sui bordi dei pixel, verifica col runtime ufficiale; nasce REGOLE_MESH.md | Consegna; riposo diverso del 21% per UV a mezzo pixel | M1–M7 |
| zeus-mesh-5 | 8 ott | Palpebra come la Domatrice (anello sul contorno schiacciato al centro) | Palpebre bucate/strappate nel battito — **approvato "perfetto"** | M3 |
| zeus-mesh-4 | 8 ott | Testa senza traslazione, palpebra chiusa disegnata | Testa stirata in alto | M6 |
| zeus-mesh-3 | 8 ott | Oggetto in mano rigido, chiavi Bézier | Punta del fulmine stirata; animazione a scatti | M4, M5 |
| zeus-mesh-2 | 8 ott | Tagli automatici: braccio con oggetto, occhi, capelli lunghi | "Ci sono parti che vanno tagliate" | M1 |
| zeus-mesh-1 | 8 ott | Primo prototipo: tutto in mesh pesata | Analisi del rig professionale della Domatrice | — |

## Metodo TAVOLA ESPLOSA (pezzi separati da una tavola) — docs/REGOLE_TAVOLA_ESPLOSA.md

| Commit | Data | Cosa |
|---|---|---|
| 500111d | 8 ott | Profilo Standard: sagoma dalla tavola, colori visibili dall'originale (recolorVisible) — Zeus a riposo come il riferimento del 3 ott |
| a284ce9 | 6 ott | Profilo Standard: pezzi = tavola; bordo del drappo e zone nascoste per Testa-busto |
| bd37e66 | 6 ott | Salvataggio 3–6 ott: testa-busto, selettore automatico, registrazione pezzi, pulizia zone nascoste |
| 4ed45cf | 3 ott | Testa-busto P7.1/P7.2: controlli naso, raccordi, buchi in movimento |
| f46a97e | — | Ritorno al metodo di Zeus approvato (riferimento del profilo Standard) |

## Dove sta cosa
- **Regole**: `docs/REGOLE_MESH.md`, `docs/REGOLE_TAVOLA_ESPLOSA.md` (copie nel progetto Claude, cartella `claude/`).
- **Garanzie**: ogni regola ha un test in `tests/` (`node --test tests/*.test.mjs`); i casi approvati stanno in
  `tests/fixtures/` (Zeus, Domatrice, folletto, avvocato, Jessica) e non possono peggiorare senza che un test fallisca.
- **Prove visive**: `prototipi/` (pacchetti e fotogrammi di ogni passo, non salvati in git).

## Da fare (aperto)
Leprecauno (mano col sacchetto davanti alla pancia: mano doppia) — serve l'originale; barba/ciocche, gambe;
Jessica col metodo mesh.
