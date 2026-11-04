// Signalton ohne Audiodatei (Web Audio): drei kurze Töne. Stumm-Schalter je Browser (localStorage).
const KEY = 'stachel.collab.timerSound';

export function soundOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setSoundOn(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* privater Modus: bleibt nur für diese Seite */
  }
}

let ctx: AudioContext | null = null;
/** Zahl der gespielten Signale (für Tests: window.__collabChimes) */
let played = 0;

export function chime() {
  played++;
  (window as unknown as { __collabChimes?: number }).__collabChimes = played;
  if (!soundOn()) return;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    const t0 = ctx.currentTime + 0.02;
    [0, 0.22, 0.44].forEach((d, i) => {
      const osc = ctx!.createOscillator();
      const gain = ctx!.createGain();
      osc.type = 'sine';
      osc.frequency.value = i === 2 ? 1175 : 880;
      gain.gain.setValueAtTime(0.0001, t0 + d);
      gain.gain.exponentialRampToValueAtTime(0.25, t0 + d + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + d + (i === 2 ? 0.5 : 0.18));
      osc.connect(gain).connect(ctx!.destination);
      osc.start(t0 + d);
      osc.stop(t0 + d + 0.55);
    });
  } catch {
    /* kein Audio verfügbar */
  }
}
