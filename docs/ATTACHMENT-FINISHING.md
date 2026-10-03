# Raccordi, mantello e presa — regole riutilizzabili

Versione: `2026-10-02.zeus.1` — 2 ottobre 2026.

## Problemi segnalati dall'utente

1. Linee nere artificiali lungo i tagli delle braccia, visibili quando vengono ricomposte.
2. Mancanza del lembo del mantello davanti alla spalla dal lato della mano aperta.
3. Fulmine visibile sopra le dita anziché nascosto dalla presa.

Questi problemi devono diventare regole e test per i personaggi successivi. Obiettivo: un clic che esegua anche le verifiche, senza chiedere all'utente di cercare manualmente ogni difetto.

## Soluzioni implementate

### Linee nere dei raccordi

Non eliminare il contorno nero dell'intero personaggio: appartiene allo stile.

La funzione `repairJointInk` rende trasparenti solo pixel scuri di bordo vicini al pivot della spalla quando:

- il pezzo genitore sotto è opaco;
- il genitore corrisponde meglio ai pixel dell'originale;
- la linea scura non è presente in quella posizione nell'originale.

Conserva il contorno esterno, le vere linee scure del disegno e i pixel senza supporto opaco sotto. Non dipinge nuova pelle. Il metodo conservativo può lasciare difetti irrisolti: non significa che un raccordo sia corretto se non vengono modificati pixel.

### Mantello sopra la spalla

Creare un livello di copertura della spalla da una maschera esplicita del tessuto, usando il busto o l'originale come sorgente.

- Il livello viene disegnato davanti al braccio e al busto.
- È figlio del busto, con pivot alla spalla.
- Il sistema di mesh del busto lo porta sotto l'osso del petto, per seguire il respiro.
- Non ha un'oscillazione autonoma.

Non selezionare automaticamente la stoffa soltanto perché viola o di un altro colore: una maschera sbagliata può prendere anche pelle, fermagli o sfondo.

### Fulmine nella presa

Conservare l'oggetto intero. Creare un livello delle dita davanti al fulmine, copiato dal braccio tramite una maschera esplicita della mano.

- I pixel del fulmine non vengono cancellati.
- Il livello della presa è figlio del braccio.
- Oggetto e livello delle dita non hanno animazione indipendente: ereditano il movimento del braccio.
- L'ordine di disegno pone le dita sopra l'oggetto.

Questo evita il foro permanente nella sagoma del fulmine, che potrebbe scoprirsi se oggetto e mano si muovessero diversamente. Si può valutare una maschera distruttiva solo per una posa completamente rigida e condivisa; non è la soluzione implementata.

## Codice modificato nel progetto

Repository: `C:\Users\BOSS2\Documents\slot-spine-web-ai`.

- **Nuovo:** `src/lib/attachmentFinishing.js` — applicazione delle regole, maschere, livelli di copertura, controllo della gerarchia e del limite di pezzi.
- `src/lib/characterFromPieces.js` — livelli `presa_*` e `copertura_*` statici; rispetto del flag `motionLocked`.
- `src/lib/explodedSheet.js` — parametro opzionale `attachmentRules`; applicazione dopo allineamento e rig; regole, versione e modifiche restituite nei metadati.
- `src/components/ExplodedSheetImport.jsx` — prompt aggiornato per raccordi e presa; inoltro opzionale delle regole; esportazione dei metadati nel layout.
- **Nuovi:** `tests/attachmentFinishing.test.mjs` e `tests/attachmentFinishingImport.test.mjs`.

Le modifiche locali preesistenti ai controlli dei singoli pezzi sono state conservate. I file esistenti sono stati controllati tramite hash prima dell'integrazione. Nessun commit o deploy eseguito.

## Blocco prima delle correzioni

Se sono fornite regole dei raccordi, l'importatore richiede prima:

1. Tavola utilizzabile secondo il controllo generale di fedeltà.
2. Controllo dei singoli pezzi superato.

Se uno dei due controlli fallisce, le correzioni vengono bloccate. Il punteggio di fedeltà conserva il valore della tavola iniziale: non viene migliorato artificialmente dalle coperture.

## Formato della ricetta

Le coordinate dei poligoni sono nell'immagine originale, non nella tavola esplosa.

```js
const attachmentRules = [
  { type: "jointInk", arm: "braccio_dx", radius: 24 },
  {
    type: "shoulderCover",
    name: "copertura_spalla_sx",
    arm: "braccio_sx",
    parent: "busto",
    source: "original",
    polygon: /* contorno validato del lembo, in coordinate originali */
  },
  {
    type: "grip",
    arm: "braccio_dx",
    object: "oggetto",
    polygon: /* contorno validato delle dita, in coordinate originali */
  }
];
```

I poligoni dell'esempio vanno forniti: non è codice da eseguire senza completarli. I nomi dei pezzi devono corrispondere a quelli riconosciuti.

L'importatore restituisce `finishing.version`, `finishing.rules` e `finishing.changes`. Il download del layout conserva questi dati in `raccordi`.

L'app riceve le regole attraverso un parametro opzionale; **non è stato realizzato un selettore automatico delle ricette o delle maschere nell'interfaccia**. Senza ricetta, il flusso precedente resta invariato.

## Verifiche eseguite

- Intera suite: **78 test superati** dopo l'introduzione delle prime otto verifiche dei raccordi.
- Dopo l'aggiunta del blocco sulle tavole non valide: **9 test mirati superati**, inclusi gli otto precedenti e il nuovo test d'integrazione. L'intera suite non è stata ripetuta dopo quest'ultima aggiunta.
- Compilazione di produzione riuscita prima dell'ultimo blocco; nessun deploy.
- Analisi statica dei file modificati: nessun errore; due avvisi preesistenti sulle esportazioni del componente React.
- Verifica su 61 istanti del ciclo: dita e oggetto mantengono la stessa trasformazione ereditata dal braccio.
- Test di copertura: segue l'osso del petto con la mesh del respiro.
- Test negativi: maschere fuori posto, gerarchie incoerenti, troppi pezzi e tavola iniziale non fedele.

## Stato reale di Zeus

La tavola generata di Zeus non è un nuovo riferimento approvato. Oltre ai difetti mostrati dall'utente, il controllo locale rileva deformazioni e posizioni errate di alcuni tratti del viso.

È stata preparata una ricetta candidata in `outputs/zeus/raccordi/ricetta-raccordi-candidata.json` nella cartella di questa attività. La prova ha creato i livelli di presa e mantello, ma la pulizia conservativa dei raccordi ha modificato **0 pixel**: mancavano le condizioni per una correzione sicura. La ricomposizione resta non valida. Non presentare questa prova come Zeus corretto e non riutilizzarne automaticamente le maschere su altri personaggi.

Il risultato visivo errato della prova è conservato soltanto fra i file di lavoro. Le immagini precedenti del folletto approvato non sono state modificate.

## Lavoro ancora necessario

1. Recuperare o produrre una tavola di Zeus fedele, con i singoli pezzi correttamente posizionati.
2. Applicare e verificare le maschere specifiche di spalla e presa su quella base; registrare il caso reale solo dopo verifica visiva e in movimento.
3. Automatizzare l'individuazione delle maschere con un controllo di affidabilità. Le regole deterministiche introdotte qui sono il passo successivo alla selezione, non la sostituiscono.
4. Per il clic unico, mantenere verifiche interne su raccordi, ordine dei livelli, presa durante il movimento e singoli pezzi. Un caso incerto non deve diventare automaticamente un risultato approvato.

## Istruzione per l'AI di backup

Conservare queste regole e i relativi test. Non dichiarare risolto il caso Zeus né completa la pipeline a un clic. Non confondere la capacità di applicare una maschera valida con la capacità di trovarla automaticamente. Continuare dal caso approvato del folletto per il viso e dalle nuove funzioni per i raccordi, verificando anche le immagini reali.
