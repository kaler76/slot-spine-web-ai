/**
 * Ricostruisce il ciclo di rotazione completo a 360° da un piccolo set di frame
 * disegnati/generati per il solo semicerchio 0°→180° (fronte→retro), specchiando
 * orizzontalmente per l'altro lato — la tecnica dei "frame intermedi + mirror"
 * usata nei rig professionali per rotazioni rapide: non serve disegnare l'intero
 * giro, bastano poche pose (es. 0°, 45°, 90°, 135°, 180°) e i loro specchi.
 * Gli angoli 0° e 180° stanno sull'asse di simmetria e non vengono duplicati
 * specchiati, altrimenti il frame si vedrebbe due volte di fila nel loop.
 */
export function buildRotationSequence(frames) {
  const sorted = [...frames].sort((a, b) => a.angle - b.angle);
  const forward = sorted.map((f) => ({ ...f, flip: false }));
  const mirrored = sorted
    .filter((f) => f.angle > 0 && f.angle < 180)
    .sort((a, b) => b.angle - a.angle)
    .map((f) => ({ ...f, flip: true }));
  return [...forward, ...mirrored];
}
