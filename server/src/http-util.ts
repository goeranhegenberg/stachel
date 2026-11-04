import type { FastifyReply } from 'fastify';

/** Fehlerantwort im Vertragsformat. */
export function sendError(reply: FastifyReply, status: number, error: string, message: string) {
  return reply.code(status).type('application/json; charset=utf-8').send({ ok: false, error, message });
}

export function parseCookieHeader(header: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (!k || k in out) continue;
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

/** Für ausgelieferte Bilder: nichts darin darf Skripte, Formulare oder Plugins ausführen (auch bei direktem Aufruf). */
export const IMAGE_CSP = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox";

export const MESSAGES = {
  not_logged_in: 'Bitte melde dich an.',
  csrf: 'Anfrage abgelehnt (Sicherheitsprüfung).',
  rate_limited: 'Zu viele Versuche. Bitte warte ein paar Minuten.',
  invalid_input: 'Die Eingabe ist ungültig.',
  not_found: 'Nicht gefunden.',
} as const;
