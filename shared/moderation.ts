// Melden und Blockieren (docs/features/moderation.md, Vertrag docs/contract.md §6 „Melden und Blockieren“):
// Konstanten und Typen für server/ und web/. Nur Typen + Konstanten, keine Laufzeit-Abhängigkeiten (wie protocol.ts).

export const REPORTS_PATH = '/api/reports';
export const BLOCKS_PATH = '/api/blocks';

/** Gründe einer Meldung (Google Play UGC, DSA Art. 16) */
export const REPORT_REASONS = ['illegal', 'harassment', 'spam', 'privacy', 'copyright', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_REASON_LABEL: Record<ReportReason, string> = {
  illegal: 'Rechtswidriger Inhalt',
  harassment: 'Belästigung, Hass oder Bedrohung',
  spam: 'Spam oder Betrug',
  privacy: 'Persönliche Daten ohne Erlaubnis',
  copyright: 'Urheberrecht oder Marke verletzt',
  other: 'Etwas anderes',
};

/** Bei diesen Gründen braucht die Meldung eine Begründung (DSA Art. 16 Abs. 2 a) */
export const REPORT_TEXT_REQUIRED: readonly ReportReason[] = ['illegal', 'other'];
export const REPORT_TEXT_MIN = 10;
export const REPORT_TEXT_MAX = 2000;

export interface ReportInput {
  boardId: string;
  /** gemeldetes Objekt auf dem Board */
  objectId?: string;
  /** gemeldeter Kommentar-Thread (`collab.comments`), mit `messageId` eine einzelne Nachricht darin */
  commentId?: string;
  messageId?: string;
  /** gemeldete Person (user_key) */
  userKey?: string;
  reason: ReportReason;
  text?: string;
}

/** Antwort von POST /api/reports (201) */
export interface ReportCreated {
  ok: true;
  report: { id: string; createdAt: string };
  /** Eingangsbestätigung per Mail verschickt (nur wenn eine Adresse bekannt ist, Modus local) */
  mailed: boolean;
}

export interface BlockedPerson {
  key: string;
  name: string;
  at: string;
}

/** Moderations-Sperre eines Boards (tools/admin.mts): nur ansehen bzw. für alle ausgeblendet */
export type BoardLockMode = 'readonly' | 'hidden';

export const isReportReason = (v: unknown): v is ReportReason => typeof v === 'string' && (REPORT_REASONS as readonly string[]).includes(v);
