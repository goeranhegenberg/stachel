// Betriebsart und Auftritt einer Stachel-Instanz (docs/features/accounts.md, .env.example):
// STACHEL_AUTH=local (eigene Konten, Standard) oder org (Anmeldung über den Identitätsdienst einer Organisation,
// docs/contract.md §1). Ein unbekannter Wert bricht den Start ab.
import type { SmtpConfig } from './mailer.js';

export type AuthMode = 'org' | 'local';

export interface InstanceConfig {
  auth: AuthMode;
  /** Name der Instanz in Oberfläche und Mails (Standard „Stachel“) */
  brand: string;
  imprintUrl: string;
  privacyUrl: string;
  /** Nutzungsbedingungen (STACHEL_TERMS_URL); leer = Häkchen bei der Registrierung ohne Link, Warnung beim Start (local) */
  termsUrl: string;
  /**
   * Fassung der Nutzungsbedingungen (STACHEL_TERMS_VERSION, z. B. `2026-11-04`): wird bei der Registrierung mit der
   * Zustimmung gespeichert; Konten mit einer anderen (älteren) Fassung werden beim nächsten Öffnen um Zustimmung gebeten
   * (`GET/POST /api/account/terms`). Leer = keine Fassungen, keine erneute Zustimmung.
   */
  termsVersion: string;
  /** smtp = echter Versand, log = Mails nach DATA_DIR/mail.log (nur Tests/Sandbox) */
  mailMode: 'smtp' | 'log';
  smtp: SmtpConfig;
  /** open = jede:r darf sich registrieren; invite = nur Adressen mit offener Board-Einladung */
  registration: 'open' | 'invite';
  /** Schwierigkeit des Captchas (größte Zahl, die der Browser im Mittel zur Hälfte durchprobiert) */
  captchaMax: number;
  /** Meldungen (reports.ts, DSA Art. 16) gehen an STACHEL_REPORT_EMAIL; leer = Absenderadresse STACHEL_SMTP_FROM */
  reportEmail: string;
  /** Admin-API für tools/admin.mts (moderation.ts), STACHEL_ADMIN_TOKEN, mind. 32 Zeichen; leer = aus */
  adminToken: string;
  /**
   * E-Mail-Adresse bestätigen, bevor man sich anmelden kann (STACHEL_REQUIRE_VERIFICATION). Standard: ja, sobald Mails
   * zugestellt werden (SMTP eingerichtet oder Mail-Log für Tests); ohne SMTP nein, damit eine Selbst-Hosting-Instanz ohne
   * Mailserver sofort benutzbar ist (Links stehen dann im Server-Log, Konten verwaltet `stachel-admin`).
   */
  requireVerification: boolean;
  /** Modus org: Name der Organisation in Texten (STACHEL_ORG_NAME, „Mit {Name} anmelden“) */
  orgName: string;
  /** Modus org: Name ihrer App (STACHEL_ORG_APP_NAME, Standard „{orgName}-App“) */
  orgAppName: string;
}

const str = (v: string | undefined, def: string) => (v === undefined || v.trim() === '' ? def : v.trim());

export function loadInstance(env: NodeJS.ProcessEnv): InstanceConfig {
  const authRaw = str(env.STACHEL_AUTH, 'local').toLowerCase();
  if (authRaw !== 'local' && authRaw !== 'org') {
    throw new Error(
      `STACHEL_AUTH="${env.STACHEL_AUTH}" ist unbekannt. Erlaubt sind local (eigene Konten) oder org (Identitätsdienst einer Organisation, STACHEL_ORG_IDENTITY_URL).`,
    );
  }
  const auth: AuthMode = authRaw;
  const orgName = str(env.STACHEL_ORG_NAME, 'Organisation').slice(0, 60);
  const port = Number(str(env.STACHEL_SMTP_PORT, '465'));
  const secureRaw = str(env.STACHEL_SMTP_SECURE, port === 465 ? 'ssl' : port === 25 ? 'none' : 'starttls').toLowerCase();
  const mailMode = str(env.STACHEL_MAIL_MODE, 'smtp').toLowerCase() === 'log' ? 'log' : 'smtp';
  const smtpHost = str(env.STACHEL_SMTP_HOST, '');
  const verifyRaw = str(env.STACHEL_REQUIRE_VERIFICATION, '').toLowerCase();
  return {
    auth,
    brand: str(env.STACHEL_BRAND, 'Stachel').slice(0, 60),
    imprintUrl: safeUrl(env.STACHEL_IMPRINT_URL),
    privacyUrl: safeUrl(env.STACHEL_PRIVACY_URL),
    termsUrl: safeUrl(env.STACHEL_TERMS_URL),
    termsVersion: termsVersionOf(env.STACHEL_TERMS_VERSION),
    mailMode,
    smtp: {
      host: smtpHost,
      port,
      user: str(env.STACHEL_SMTP_USER, ''),
      pass: env.STACHEL_SMTP_PASS ?? '',
      from: str(env.STACHEL_SMTP_FROM, ''),
      secure: secureRaw === 'ssl' || secureRaw === 'tls' ? 'ssl' : secureRaw === 'none' ? 'none' : 'starttls',
    },
    registration: str(env.STACHEL_REGISTRATION, 'open').toLowerCase() === 'invite' ? 'invite' : 'open',
    captchaMax: Math.max(1000, Math.min(5_000_000, Number(str(env.STACHEL_CAPTCHA_MAX, '250000')) || 250_000)),
    reportEmail: str(env.STACHEL_REPORT_EMAIL, ''),
    adminToken: str(env.STACHEL_ADMIN_TOKEN, ''),
    requireVerification: verifyRaw ? ['1', 'true', 'yes', 'on'].includes(verifyRaw) : mailMode === 'log' || !!smtpHost,
    orgName,
    orgAppName: str(env.STACHEL_ORG_APP_NAME, `${orgName}-App`).slice(0, 60),
  };
}

/** Fassung der Nutzungsbedingungen: 1–40 Zeichen aus Buchstaben, Ziffern, `.`, `_`, `-`; sonst Abbruch beim Start. */
function termsVersionOf(v: string | undefined): string {
  const s = (v ?? '').trim();
  if (!s) return '';
  if (!/^[A-Za-z0-9._-]{1,40}$/.test(s)) {
    throw new Error(`STACHEL_TERMS_VERSION="${v}" ist ungültig. Erlaubt sind bis zu 40 Zeichen aus Buchstaben, Ziffern, . _ - (z. B. 2026-11-04).`);
  }
  return s;
}

/** Nur http(s)-Adressen übernehmen (die Oberfläche verlinkt sie). */
function safeUrl(v: string | undefined): string {
  const s = (v ?? '').trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : '';
  } catch {
    return '';
  }
}
