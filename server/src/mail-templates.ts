// Texte der E-Mails (Modus local): schlicht, Deutsch, je HTML und Text. Platzhalter werden HTML-escaped.
import type { MailMessage } from './mailer.js';

export interface MailContext {
  brand: string;
  publicUrl: string;
  imprintUrl: string;
  privacyUrl: string;
  /** Nutzungsbedingungen (STACHEL_TERMS_URL), leer = kein Link */
  termsUrl?: string;
}

/**
 * Von Nutzer:innen gewählte Texte (Board-Titel, Anzeigename) in Mails an fremde Adressen: keine anklickbaren bzw.
 * leicht abtippbaren Links (Phishing über Einladungen, Review 2026-11-02 MAIL-1) – `https://x.y` → `https[:]//x[.]y`,
 * `www.x.y`/`x.de` → `x[.]y`; höchstens 120 Zeichen.
 */
export function defang(s: string): string {
  return s
    .slice(0, 120)
    .replace(/([a-z][a-z0-9+.-]*):\/\//gi, '$1[:]//')
    .replace(/([A-Za-z0-9-])\.(?=[A-Za-z]{2,})/g, '$1[.]');
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

interface Body {
  greeting: string;
  paragraphs: string[];
  button?: { label: string; url: string };
  after?: string[];
}

function render(ctx: MailContext, to: string, subject: string, b: Body): MailMessage {
  const host = new URL(ctx.publicUrl).host;
  const footerLinks = [
    ctx.imprintUrl && `Impressum: ${ctx.imprintUrl}`,
    ctx.privacyUrl && `Datenschutz: ${ctx.privacyUrl}`,
    ctx.termsUrl && `Nutzungsbedingungen: ${ctx.termsUrl}`,
  ].filter(Boolean);
  const text = [
    b.greeting,
    '',
    ...b.paragraphs.flatMap((p) => [p, '']),
    ...(b.button ? [`${b.button.label}: ${b.button.url}`, ''] : []),
    ...(b.after ?? []).flatMap((p) => [p, '']),
    '--',
    `${ctx.brand} · ${host}`,
    ...footerLinks,
  ].join('\n');
  const p = (s: string) => `<p style="margin:0 0 14px">${esc(s)}</p>`;
  const html = `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:24px;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;color:#111;font-size:15px;line-height:1.5">
<div style="max-width:520px;margin:0 auto;background:#fff;border:2px solid #111;border-radius:10px;padding:24px">
<p style="margin:0 0 18px;font-weight:bold;font-size:18px">${esc(ctx.brand)}</p>
${p(b.greeting)}
${b.paragraphs.map(p).join('\n')}
${
  b.button
    ? `<p style="margin:22px 0"><a href="${esc(b.button.url)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:8px">${esc(b.button.label)}</a></p>
<p style="margin:0 0 14px;font-size:13px;color:#555">Falls der Knopf nicht geht, diese Adresse in den Browser kopieren:<br><span style="word-break:break-all">${esc(b.button.url)}</span></p>`
    : ''
}
${(b.after ?? []).map(p).join('\n')}
</div>
<p style="max-width:520px;margin:14px auto 0;font-size:12px;color:#666">${esc(ctx.brand)} · ${esc(host)}${footerLinks.length ? ' · ' : ''}${[
    ctx.imprintUrl && `<a href="${esc(ctx.imprintUrl)}" style="color:#666">Impressum</a>`,
    ctx.privacyUrl && `<a href="${esc(ctx.privacyUrl)}" style="color:#666">Datenschutz</a>`,
    ctx.termsUrl && `<a href="${esc(ctx.termsUrl)}" style="color:#666">Nutzungsbedingungen</a>`,
  ]
    .filter(Boolean)
    .join(' · ')}</p>
</body></html>`;
  return { to, subject, text, html };
}

const hello = (name?: string) => (name ? `Hallo ${name},` : 'Hallo,');

export const mails = {
  verify: (ctx: MailContext, to: string, name: string, url: string) =>
    render(ctx, to, `${ctx.brand}: E-Mail-Adresse bestätigen`, {
      greeting: hello(name),
      paragraphs: [`schön, dass du ${ctx.brand} nutzen möchtest. Bitte bestätige deine E-Mail-Adresse, dann kannst du dich anmelden.`],
      button: { label: 'E-Mail-Adresse bestätigen', url },
      after: ['Der Link gilt 24 Stunden. Wenn du dich nicht registriert hast, kannst du diese Mail einfach ignorieren.'],
    }),
  existing: (ctx: MailContext, to: string, name: string, loginUrl: string, resetUrl: string) =>
    // Antwort auf eine Registrierung mit bekannter Adresse (keine Konto-Aufzählung auf der Webseite): klar sagen, warum
    // kein Bestätigungslink kommt, und zuerst zur Anmeldung führen; Passwort-Reset nur als Ausweg.
    render(ctx, to, `${ctx.brand}: Du hast schon ein Konto – bitte anmelden`, {
      greeting: hello(name),
      paragraphs: [
        `du hast dich gerade bei ${ctx.brand} registriert. Mit dieser E-Mail-Adresse gibt es aber schon ein Konto, deshalb ist keine Bestätigung nötig und es kommt kein Bestätigungslink.`,
        'Melde dich einfach mit deinem bisherigen Passwort an.',
      ],
      button: { label: 'Zur Anmeldung', url: loginUrl },
      after: [
        `Passwort vergessen? Hier legst du ein neues fest (1 Stunde gültig): ${resetUrl}`,
        'Wenn du dich nicht registriert hast, musst du nichts tun. Dein Konto bleibt unverändert.',
      ],
    }),
  reset: (ctx: MailContext, to: string, name: string, url: string) =>
    render(ctx, to, `${ctx.brand}: Passwort zurücksetzen`, {
      greeting: hello(name),
      paragraphs: ['jemand hat das Zurücksetzen deines Passworts angefordert. Mit diesem Link legst du ein neues fest:'],
      button: { label: 'Neues Passwort festlegen', url },
      after: ['Der Link gilt 1 Stunde und nur einmal. Wenn du das nicht warst, ignoriere diese Mail – dein Passwort bleibt, wie es ist.'],
    }),
  // Betreff ohne Titel und Namen (beides wählt die einladende Person frei), Text mit entschärften Links
  invite: (ctx: MailContext, to: string, byRaw: string, titleRaw: string, role: string, url: string) => {
    const by = defang(byRaw);
    const title = defang(titleRaw);
    return render(ctx, to, `${ctx.brand}: Du wurdest zu einem Board eingeladen`, {
      greeting: 'Hallo,',
      paragraphs: [
        `${by} möchte das Board „${title}“ in ${ctx.brand} mit dir teilen (${role}).`,
        `${ctx.brand} ist ein Online-Whiteboard. Um das Board zu sehen, registriere dich bitte mit genau dieser E-Mail-Adresse (${to}). Danach erscheint es unter „Mit mir geteilt“.`,
      ],
      button: { label: 'Registrieren und Board öffnen', url },
      after: ['Wenn du damit nichts anfangen kannst, ignoriere diese Mail einfach. Wir speichern deine Adresse nur für diese Einladung.'],
    });
  },
  shared: (ctx: MailContext, to: string, name: string, byRaw: string, titleRaw: string, role: string, url: string) => {
    const by = defang(byRaw);
    const title = defang(titleRaw);
    return render(ctx, to, `${ctx.brand}: Ein Board wurde mit dir geteilt`, {
      greeting: hello(name),
      paragraphs: [`${by} hat das Board „${title}“ mit dir geteilt (${role}).`],
      button: { label: 'Board öffnen', url },
    });
  },
  deleted: (ctx: MailContext, to: string, name: string) =>
    render(ctx, to, `${ctx.brand}: Dein Konto wurde gelöscht`, {
      greeting: hello(name),
      paragraphs: [`dein Konto bei ${ctx.brand} ist gelöscht. Deine Anmeldedaten sind entfernt, deine eigenen Boards wurden wie gewählt gelöscht oder übertragen.`],
    }),
};

/** Gleiches Layout für Mails anderer Module (reports.ts: Meldungen und Entscheidungen, DSA Art. 16/17). */
export const renderMail = render;
