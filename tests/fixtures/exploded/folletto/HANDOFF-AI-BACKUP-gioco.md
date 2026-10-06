# Passaggio di contesto per AI di backup — Folletto Spine

## Obiettivo e stato attuale

L'utente vuole una tavola esplosa dello stesso personaggio per animazione scheletrica 2D in Spine, con i tratti del viso separati. Il risultato finale è stato apprezzato esplicitamente: «ottimo lavoro delle palpebre fantastico». L'utente ha poi confermato questa versione come riferimento.

**Conservare la versione finale e il metodo delle palpebre. Non ricominciare a generare tutto il personaggio.**

Il lavoro grafico e il pacchetto Spine sono stati consegnati. Resta aperto un problema distinto: l'importatore automatico della sola tavola nell'app assegna male alcuni tratti piccoli del viso. Il pacchetto Spine finale usa coordinate esplicite ed evita quel passaggio.

## Vincoli dell'utente

- Stesso personaggio, stile, scala, proporzioni e posa dell'originale.
- Separare i pezzi mediante traslazioni, senza ruotarli, raddrizzarli o cambiare la posa.
- Testa comprensiva di cappello, capelli e barba, salvo le ciocche laterali da separare.
- Busto e due gambe insieme; ogni braccio con la propria mano; ogni oggetto tenuto come pezzo unico.
- Occhi aperti con linea superiore delle ciglia, sopracciglia, bocca e ciocche laterali separati, senza duplicati.
- Sulla testa: palpebre chiuse al posto degli occhi; pelle continua al posto di sopracciglia e bocca; niente buchi nel viso.
- Al massimo 16 pezzi complessivi. Il risultato finale ne contiene 12.
- Sfondo della tavola uniforme blu `#0018FF`, senza testo, ombre esterne, particelle o effetti.

## File e percorsi

Cartella di questa attività:

```text
C:\Users\BOSS2\Documents\Codex\2026-10-02\using-the-attached-character-image-create
```

Pacchetto finale da conservare:

```text
outputs\folletto-viso-Spine.zip
```

Cartella finale non compressa:

```text
outputs\folletto-viso-finale\
```

File principali nella cartella finale:

| File | Funzione |
| --- | --- |
| `tavola-viso.png` | Tavola esplosa finale, 12 pezzi |
| `testa.png` | Testa con palpebre chiuse e pelle ricostruita |
| `occhio_dx.png`, `occhio_sx.png` | Occhi aperti separati |
| `sopracciglio_dx.png`, `sopracciglio_sx.png` | Sopracciglia separate |
| `bocca.png` | Bocca sorridente separata |
| `ciocca_dx.png`, `ciocca_sx.png` | Due ciocche laterali separate |
| `busto.png`, `braccio_dx.png`, `braccio_sx.png`, `oggetto.png` | Pezzi corporei della base approvata |
| `folletto.spine.json` | Skeleton Spine 4.1 con posizioni, gerarchia, mesh e animazione |
| `placements.json` | Coordinate originali, coordinate sulla tavola e relazioni tra pezzi |
| `personaggio-ricomposto.png` | Ricomposizione con coordinate esplicite |
| `testa-ricomposta.png` | Controllo della testa con i tratti rimessi al loro posto |
| `anteprima-animata.gif` | Anteprima renderizzata dallo skeleton finale |
| `rig-validation.json` | Esiti della verifica dello skeleton e della simulazione |
| `pixel-checks.json` | Controlli di conservazione dei pezzi |
| `retouch-prompt.txt` | Prompt del ritocco locale della pelle |
| `RIFERIMENTO-APPROVATO.md` | Registrazione dell'approvazione dell'utente |
| `LEGGIMI.txt` | Uso del pacchetto e limiti noti |

I suffissi `sx` e `dx` indicano i lati del personaggio, non dello spettatore.

## Base da cui siamo ripartiti

Repository dell'app, letto per recuperare i riferimenti e usare le verifiche:

```text
C:\Users\BOSS2\Documents\slot-spine-web-ai
```

Originale del folletto, 587 × 523 pixel:

```text
tests\fixtures\exploded\folletto\original.png
```

Tavola a cinque pezzi già registrata come riferimento nei test:

```text
tests\fixtures\exploded\folletto\sheet.png
```

La base è stata recuperata anche in `outputs\folletto-base-verificata\`. Il controllo dell'app la valuta con errore 30,3, scala 1, `faithful: true`, `usable: true`.

La base approvata non è un ritaglio perfettamente identico all'originale in ogni dettaglio: contiene già ricostruzioni delle zone nascoste. Il lavoro finale conserva tale base, invece di sostituirla con un nuovo ridisegno.

## Modifiche effettivamente apportate

1. Recuperati i cinque PNG della base approvata mediante l'importatore esistente.
2. Conservati **identici pixel per pixel** busto, braccio sinistro, braccio destro e borsa.
3. Ritagliati dalla testa approvata due occhi, due sopracciglia, bocca e due ciocche. I tratti estratti non sono stati ridimensionati o ruotati.
4. Prodotto un ritocco locale della testa con lo strumento imagegen integrato: palpebre chiuse, sopracciglia rimosse, bocca rimossa e pelle sfumata nelle rispettive zone.
5. Usata l'immagine generata soltanto come sorgente per le zone di pelle: ridimensionata alla testa di 176 × 221 pixel e applicata con maschere locali. **Non è stata sostituita tutta la testa con quella generata.** Cappello, barba, orecchie e restante disegno provengono dalla base approvata.
6. Rimossi dalla testa i tratti estratti, mantenendo il viso pieno e le palpebre chiuse. Le ciocche sono ritagli esterni del contorno.
7. Disposti i sette tratti vicino alla testa nella tavola approvata, lasciando i quattro pezzi corporei nelle posizioni precedenti. Sfondo blu `#0018FF`.
8. Registrate le coordinate esplicite dei 12 pezzi in `placements.json`.
9. Costruito lo skeleton con le funzioni già presenti nel repository: `piecesToCharacterParts`, `buildCharacterSkeleton`, `addTorsoBreathMesh`, `addHeadMesh`, `toSpine41` e `facePivot`.
10. Nell'animazione `ambient`, portata a zero l'opacità minima di entrambi gli occhi al momento della chiusura: chiave `ffffff00` al posto di `ffffff33`. Le due timeline restano sincronizzate. Le palpebre chiuse disegnate sulla testa diventano visibili durante il battito.
11. Verificato lo skeleton e simulato il movimento. Renderizzata anche una GIF dalla geometria effettiva dello skeleton, comprese le mesh.

**Nessun file sorgente del repository dell'app è stato modificato. Nessun deploy è stato eseguito.** Tutte le modifiche sono negli artefatti e negli script locali di questa attività.

## Coordinate principali da conservare

Coordinate di ricomposizione nell'immagine originale, secondo la base approvata:

| Pezzo | X | Y | Genitore |
| --- | ---: | ---: | --- |
| `braccio_sx` | 320 | 98 | `busto` |
| `busto` | 179 | 177 | nessuno |
| `testa` | 188 | 16 | `busto` |
| `oggetto` | 183 | 207 | `braccio_dx` |
| `braccio_dx` | 146 | 193 | `busto` |

La testa nella tavola approvata è a `(203, 28)` ed è di 176 × 221 pixel. Le coordinate dei tratti del viso si ricavano aggiungendo la posizione locale del ritaglio all'origine della testa `(188, 16)`. Usare i valori già salvati in `placements.json`, senza ricalcolarli mediante riconoscimento automatico.

## Verifiche eseguite e loro limiti

### Test esistenti

Sono stati eseguiti i file:

```text
tests/explodedSheet.test.mjs
tests/animationSim.test.mjs
tests/recognition.test.mjs
```

Risultato: **23 test superati**, comprese simulazioni su 120 personaggi sintetici, simulazioni dei casi reali folletto e avvocato e verifiche di riconoscimento su avvocato e domatrice.

Questi test verificano i casi salvati: non costituiscono da soli approvazione della nuova tavola con il viso separato.

Il normale avvio dei test con processi separati dava `spawn EPERM` nell'ambiente. L'esecuzione riuscita ha usato:

```text
node --test --test-isolation=none tests/explodedSheet.test.mjs tests/animationSim.test.mjs tests/recognition.test.mjs
```

### Pacchetto finale con coordinate esplicite

- Esportazione valida, nessun errore o avviso.
- 16 ossa, 12 slot, 10 regioni e 2 mesh: busto e testa.
- Animazione `ambient` di 4 secondi.
- Simulazione di 60 fotogrammi a 15 fps: nessun problema rilevato.
- Spostamento massimo dei piedi: 0.
- Nessun buco ai raccordi rilevato dalla simulazione.
- GIF: 100 fotogrammi a 25 fps, renderizzati dalle geometrie dello skeleton esportato.
- Controllo visivo effettuato sulla tavola, sulla testa ricomposta, sul personaggio ricomposto e sul fotogramma con occhi chiusi.

**Non è stato aperto l'editor Spine per una verifica manuale dell'importazione.** Non presentare i controlli programmatici come una prova effettuata nell'editor.

## Problema ancora aperto: importazione automatica della tavola nell'app

La tavola finale viene rilevata come 12 pezzi, scala 1, errore complessivo 33,2, `faithful: true` e `usable: true`. Tuttavia la ricomposizione automatica è sbagliata: alcuni occhi e la bocca vengono trattati come oggetti e collocati vicino alle mani; alcune sopracciglia vengono classificate come ciocche.

Il punteggio globale pesa l'area dei pezzi: i grandi pezzi corporei corretti possono nascondere errori gravi sui piccoli tratti. **Non accettare una tavola soltanto perché il punteggio globale passa.**

Nel codice, `alignPiece` in `src/lib/explodedSheet.js` usa una ricerca globale iniziale a passo 8 pixel, seguita da rifinitura locale. Questo è un possibile punto da indagare per i piccoli tratti, ma non è stato dimostrato come unica causa né corretto. L'assegnazione dei ruoli avviene dopo il posizionamento; un posizionamento sbagliato può quindi produrre anche un nome sbagliato.

Diagnostica della prova fallita conservata separatamente in:

```text
work\import-verification-non-valida.json
work\ricomposizione-importatore-non-valida.png
```

Questi due file **non fanno parte del risultato approvato**. Il pacchetto finale contiene lo skeleton costruito dalle coordinate esplicite e la sua ricomposizione corretta.

Se l'utente chiederà di usare direttamente la tavola nell'app, occorrerà lavorare sull'importatore e verificarne nomi, posizioni, gerarchie e ordine di disegno sui tratti reali, non soltanto sulle simulazioni sintetiche. Non dichiarare questo problema già risolto.

## Tentativi da non riutilizzare

- `outputs\folletto-exploded.png`: prima generazione a cinque pezzi; fedeltà insufficiente.
- `outputs\folletto-exploded-face-parts.png`: generazione con viso; scala e forme alterate, errore 100,3.
- `outputs\folletto-source-cutouts\`: tentativo manuale rifiutato dall'utente per la qualità grafica. Pur passando un controllo numerico, aveva ricostruzioni e bordi scadenti.
- `tests\fixtures\exploded\folletto\2sheet.png`: corrisponde alla tavola con viso non valida; non confonderla con il risultato finale approvato.

Le precedenti consegne avevano perso il focus e fatto ripetere all'utente la richiesta. Proseguire direttamente dal risultato finale, senza chiedere all'utente di rifare ritagli, caricamenti o verifiche già svolte.

## Script locali utili per riprodurre il lavoro

Nella cartella `work` di questa attività:

- `recover-baseline.mjs`: recupero della base e confronto delle tavole precedenti.
- `base-pieces.json`: metadati dei cinque pezzi approvati.
- `finish-face.py`: ritagli del viso, maschere del ritocco, composizione della tavola e metadati.
- `verify-face.mjs`: prova dell'importatore automatico; evidenzia il problema ancora aperto.
- `export-face-rig.mjs`: skeleton con coordinate esplicite, verifiche, ricomposizione e geometrie dei fotogrammi.
- `render-rig.py`: rendering della GIF dalle geometrie dello skeleton.

Attenzione: `finish-face.py` dipende anche dalla sorgente di ritocco generata, fuori dalla cartella degli output:

```text
C:\Users\BOSS2\.codex\generated_images\01a0fbef-9fcc-7521-aa04-ec88fa6a6d9e\exec-197e4960-dcc6-4040-ade4-d548c2b41727.png
```

Per usare il risultato non serve rigenerare nulla: i PNG finali sono già inclusi nello ZIP. Se trasferisci soltanto il pacchetto a un altro computer, non presumere che gli script e le loro dipendenze siano disponibili.

## Istruzione di continuità per l'AI che riceve questo documento

Usa `folletto-viso-Spine.zip` e i file di `folletto-viso-finale` come riferimento approvato. Conserva il battito con palpebre chiuse sulla testa e occhi originali separati. Verifica ogni eventuale modifica anche visivamente. Non rigenerare l'intero personaggio, non tornare ai tentativi scartati e non confondere la validità dello skeleton finale con il problema ancora aperto dell'importatore della tavola.

Questo documento riassume il lavoro precedente; segui la nuova richiesta dell'utente per decidere quali azioni intraprendere.
