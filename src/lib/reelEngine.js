/**
 * Funzioni pure per la vista "Rulli animati": costruzione dello striscione di
 * simboli che scorre durante lo spin e curva di decelerazione per l'atterraggio.
 */

export function pickRandom(pool) {
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Costruisce lo striscione di un rullo: `stripLen - visibleRows` simboli casuali
 * di "riempimento" (quelli che si vedono scorrere durante lo spin) seguiti dalle
 * `visibleRows` righe finali, cioè il risultato dell'atterraggio. Se `forcedResult`
 * è passato (stesso numero di elementi di visibleRows) viene usato come risultato
 * finale invece di uno casuale, per poter dimostrare l'animazione "win".
 */
export function buildStrip(pool, visibleRows, stripLen, forcedResult) {
  const filler = [];
  for (let i = 0; i < stripLen - visibleRows; i++) filler.push(pickRandom(pool));

  const finalRows =
    forcedResult && forcedResult.length === visibleRows ? forcedResult : Array.from({ length: visibleRows }, () => pickRandom(pool));

  return [...filler, ...finalRows];
}

/** Decelerazione morbida senza overshoot: parte veloce, rallenta fino a fermarsi esattamente sul risultato. */
export function easeOutQuart(t) {
  return 1 - Math.pow(1 - t, 4);
}
