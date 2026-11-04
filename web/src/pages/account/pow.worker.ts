// Web Worker: löst die Captcha-Aufgabe, ohne die Oberfläche zu blockieren (pow.ts).
import { solvePow } from './pow';

self.onmessage = (e: MessageEvent<{ salt: string; challenge: string; max: number }>) => {
  const { salt, challenge, max } = e.data;
  const started = performance.now();
  const number = solvePow(salt, challenge, max);
  (self as unknown as Worker).postMessage({ number, ms: Math.round(performance.now() - started) });
};
