/**
 * Funzioni pure per la vista "Rulli animati": costruzione dello striscione di
 * simboli che scorre durante lo spin e curva di decelerazione per l'atterraggio.
 */

export function pickRandom(pool) {
  return pool[Math.floor(Math.random() * pool.length)];
}

/** Sottoinsieme del pool senza simboli "tall": usato per le righe dove un tall non ci può stare. */
function nonTallPool(pool) {
  return pool.some((it) => (it.tallSpan || 1) <= 1) ? pool.filter((it) => (it.tallSpan || 1) <= 1) : pool;
}

/**
 * Sceglie il risultato finale (le `visibleRows` righe) di un rullo. Se `forcedResult`
 * è passato lo usa così com'è (serve per il test vincita). Altrimenti pesca il primo
 * elemento a caso: se è un simbolo "tall" (occupa più celle in verticale, es. un
 * simbolo premiante alto 3 celle) e la sua altezza copre tutte le righe visibili,
 * riempie l'intero rullo con quello stesso elemento — sarà poi disegnato come
 * un'unica immagine grande invece di 3 copie schiacciate una sopra l'altra. Le righe
 * successive alla prima non possono mai pescare un tall da sole (non ci starebbe
 * schiacciato in una sola cella): un tall entra in gioco solo dalla prima riga in giù.
 */
export function pickFinalRows(pool, visibleRows, forcedResult) {
  if (forcedResult && forcedResult.length === visibleRows) return forcedResult;

  const first = pickRandom(pool);
  if ((first.tallSpan || 1) >= visibleRows) {
    return Array(visibleRows).fill(first);
  }
  const restPool = nonTallPool(pool);
  return [first, ...Array.from({ length: visibleRows - 1 }, () => pickRandom(restPool))];
}

/**
 * Costruisce lo striscione di un rullo: le `visibleRows` righe finali del risultato
 * (vedi pickFinalRows) seguite da `stripLen - visibleRows` simboli casuali di
 * "riempimento" (quelli che si vedono scorrere durante lo spin, sempre simboli
 * normali: uno "tall" schiacciato in una singola cella non avrebbe senso durante il
 * blur). Le righe finali vanno per prime perché il rullo scorre verso il basso — come
 * in un rullo vero, i simboli scendono ed entrano dall'alto — quindi l'animazione
 * parte mostrando il fondo dello striscione (riempimento) e arriva a translateY 0,
 * cioè esattamente l'inizio dello striscione (le righe finali).
 */
export function buildStrip(pool, visibleRows, stripLen, forcedResult) {
  const fillerPool = nonTallPool(pool);

  const filler = [];
  for (let i = 0; i < stripLen - visibleRows; i++) filler.push(pickRandom(fillerPool));

  const finalRows = pickFinalRows(pool, visibleRows, forcedResult);

  return [...finalRows, ...filler];
}

/** Decelerazione morbida senza overshoot: parte veloce, rallenta fino a fermarsi esattamente sul risultato. */
export function easeOutQuart(t) {
  return 1 - Math.pow(1 - t, 4);
}
