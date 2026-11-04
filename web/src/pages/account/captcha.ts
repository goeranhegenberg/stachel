// Captcha (Proof-of-Work, server/src/captcha.ts): Aufgabe holen, im Worker lösen, Lösung als base64-JSON mitschicken.
// Kein Drittanbieter, kein Cookie. Ohne Worker (sehr alte Browser) wird im Haupt-Thread gerechnet.
import { request } from '../../api';
import { solvePow } from './pow';

interface Challenge {
  algorithm: string;
  challenge: string;
  maxnumber: number;
  salt: string;
  signature: string;
}

function solveInWorker(c: Challenge): Promise<number | null> {
  if (typeof Worker === 'undefined') return Promise.resolve(solvePow(c.salt, c.challenge, c.maxnumber));
  return new Promise((resolve) => {
    let w: Worker;
    try {
      w = new Worker(new URL('./pow.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      resolve(solvePow(c.salt, c.challenge, c.maxnumber));
      return;
    }
    w.onmessage = (e: MessageEvent<{ number: number | null }>) => {
      resolve(e.data.number);
      w.terminate();
    };
    w.onerror = () => {
      w.terminate();
      resolve(solvePow(c.salt, c.challenge, c.maxnumber));
    };
    w.postMessage({ salt: c.salt, challenge: c.challenge, max: c.maxnumber });
  });
}

/** Neue Aufgabe holen und lösen; liefert die Lösung fürs Feld `captcha`. */
export async function solveCaptcha(): Promise<string> {
  const c = await request<Challenge>('GET', '/api/auth/captcha');
  const number = await solveInWorker(c);
  if (number === null) throw new Error('Captcha nicht lösbar');
  return btoa(JSON.stringify({ algorithm: c.algorithm, challenge: c.challenge, number, salt: c.salt, signature: c.signature }));
}
