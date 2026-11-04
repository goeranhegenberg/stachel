// Grenzen gegen Missbrauch (Sicherheits-Review 2026-11-02 UPL-2, MAIL-1): Speicherquote je Konto, Größe je Upload,
// Uploads je Stunde, Boards je Person, Einladungs-Mails je Konto und je IP. Alle über Umgebungsvariablen einstellbar
// (docs/ops/limits.md); 0 = ohne Grenze. Die Vorgaben passen
// für kleine Selbstbetreiber-Instanzen; eigene Instanzen setzen großzügigere Werte in der .env.

import { MAX_IMAGE_BYTES } from '../../shared/protocol.js';

export interface Limits {
  /** STACHEL_UPLOAD_MAX_MB: größte Datei je Upload (Bild bzw. PDF) in Bytes, 1–15 MB (nur verkleinern möglich) */
  uploadMaxBytes: number;
  /** STACHEL_USER_QUOTA_MB: Speicher je Konto (Summe der eigenen Bilder/PDFs inkl. Kopien) in Bytes; 0 = unbegrenzt */
  userQuotaBytes: number;
  /** STACHEL_UPLOADS_PER_HOUR: Uploads je Person und Stunde (PDF-Seiten zählen einzeln); 0 = unbegrenzt */
  uploadsPerHour: number;
  /** STACHEL_MAX_BOARDS_PER_USER: Boards, die eine Person besitzen darf (inkl. Papierkorb); 0 = unbegrenzt */
  maxBoardsPerUser: number;
  /** STACHEL_INVITES_PER_HOUR: Einladungs-/Teilen-Mails je Konto und Stunde */
  invitesPerHour: number;
  /** STACHEL_INVITES_PER_DAY: Einladungs-/Teilen-Mails je Konto und Tag */
  invitesPerDay: number;
  /** STACHEL_INVITES_PER_DAY_IP: Einladungs-/Teilen-Mails je IP (IPv6: /64) und Tag, über alle Konten */
  invitesPerDayIp: number;
}

const MB = 1024 * 1024;

export const DEFAULT_LIMITS: Limits = {
  uploadMaxBytes: 15 * MB,
  userQuotaBytes: 1024 * MB,
  uploadsPerHour: 300,
  maxBoardsPerUser: 500,
  invitesPerHour: 60,
  invitesPerDay: 200,
  invitesPerDayIp: 300,
};

/** Ganze Zahl ≥ 0 aus der Umgebung; leer/kaputt = Vorgabe. */
function count(v: string | undefined, fallback: number): number {
  if (v === undefined || !v.trim()) return fallback;
  const n = Number(v.trim());
  if (!Number.isFinite(n) || n < 0) throw new Error(`Ungültiger Wert „${v}“: erwartet eine Zahl ≥ 0`);
  return Math.floor(n);
}

export function loadLimits(env: NodeJS.ProcessEnv = process.env): Limits {
  const d = DEFAULT_LIMITS;
  // 1–15 MB: Web und Apps prüfen vor dem Hochladen auf 15 MB (shared MAX_IMAGE_BYTES), nginx-Vorgabe 16 MB je Anfrage
  const uploadMb = Math.min(MAX_IMAGE_BYTES / MB, Math.max(1, count(env.STACHEL_UPLOAD_MAX_MB, d.uploadMaxBytes / MB) || d.uploadMaxBytes / MB));
  return {
    uploadMaxBytes: uploadMb * MB,
    userQuotaBytes: count(env.STACHEL_USER_QUOTA_MB, d.userQuotaBytes / MB) * MB,
    uploadsPerHour: count(env.STACHEL_UPLOADS_PER_HOUR, d.uploadsPerHour),
    maxBoardsPerUser: count(env.STACHEL_MAX_BOARDS_PER_USER, d.maxBoardsPerUser),
    invitesPerHour: count(env.STACHEL_INVITES_PER_HOUR, d.invitesPerHour),
    invitesPerDay: count(env.STACHEL_INVITES_PER_DAY, d.invitesPerDay),
    invitesPerDayIp: count(env.STACHEL_INVITES_PER_DAY_IP, d.invitesPerDayIp),
  };
}

/** „15 MB“, „1,5 GB“ für Fehlermeldungen. */
export function formatBytes(n: number): string {
  if (n >= 1024 * MB) return `${(n / (1024 * MB)).toLocaleString('de-DE', { maximumFractionDigits: 1 })} GB`;
  return `${Math.max(0, Math.round(n / MB)).toLocaleString('de-DE')} MB`;
}
