/**
 * Suoni di feedback per la vista "Rulli animati", sintetizzati con Web Audio API
 * (nessun asset audio esterno da caricare/ospitare).
 */

let ctx = null;

function getCtx() {
  if (!ctx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    ctx = new AudioCtx();
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function tone(freq, duration, type, startGain, delay = 0) {
  const audioCtx = getCtx();
  if (!audioCtx) return;
  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const t0 = audioCtx.currentTime + delay;
    gain.gain.setValueAtTime(startGain, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + duration);
  } catch {
    // ambiente senza Web Audio utilizzabile: nessun suono, nessun crash
  }
}

export function playSpinStart() {
  tone(220, 0.12, "square", 0.12);
}

export function playReelStop() {
  tone(140, 0.1, "triangle", 0.16);
}

export function playWin() {
  tone(660, 0.14, "sine", 0.15, 0);
  tone(880, 0.14, "sine", 0.15, 0.1);
  tone(1100, 0.22, "sine", 0.15, 0.2);
}
