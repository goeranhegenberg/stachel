// Kleine HTML-Seiten ohne Web-App: Hinweis für /qr/:code (QR mit der normalen Handy-Kamera gescannt bzw. „In der
// {Org-App} öffnen“ ohne App, Modus org) und die 404-Seite für unbekannte Pfade.
import { BRAND } from '../../shared/protocol.js';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const QR_FONTS: Record<string, string> = {
  'barlow-400.woff2': '@fontsource/barlow/files/barlow-latin-400-normal.woff2',
  'barlow-600.woff2': '@fontsource/barlow/files/barlow-latin-600-normal.woff2',
  'barlow-condensed-700.woff2': '@fontsource/barlow-condensed/files/barlow-condensed-latin-700-normal.woff2',
};

/** Gerüst im Stachel-Look (schwarz, Barlow), `main` ist schon fertiges HTML. */
function page(title: string, main: string): string {
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="theme-color" content="${BRAND.black}">
<title>${title}</title>
<style>
@font-face { font-family: 'Barlow'; font-weight: 400; font-display: swap; src: url(/qr-fonts/barlow-400.woff2) format('woff2'); }
@font-face { font-family: 'Barlow'; font-weight: 600; font-display: swap; src: url(/qr-fonts/barlow-600.woff2) format('woff2'); }
@font-face { font-family: 'Barlow Condensed'; font-weight: 700; font-display: swap; src: url(/qr-fonts/barlow-condensed-700.woff2) format('woff2'); }
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; }
body {
  min-height: 100vh; background: ${BRAND.black}; color: ${BRAND.white};
  font-family: 'Barlow', system-ui, sans-serif; font-size: 18px; line-height: 1.5;
  display: flex; align-items: center; justify-content: center; padding: 24px 16px;
}
main { width: 100%; max-width: 440px; }
.logo { display: flex; align-items: center; gap: 10px; margin-bottom: 32px; }
.logo span { font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 28px; letter-spacing: .04em; text-transform: uppercase; }
h1 { font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 44px; line-height: 1; text-transform: uppercase; margin: 0 0 16px; }
h1 em { font-style: normal; color: ${BRAND.green}; }
p { margin: 0 0 24px; color: #e6e6e6; }
ol { list-style: none; margin: 0 0 28px; padding: 0; counter-reset: s; }
li { counter-increment: s; display: flex; align-items: center; gap: 14px; padding: 14px 0; border-top: 1px solid #333; font-weight: 600; }
li:last-child { border-bottom: 1px solid #333; }
li::before {
  content: counter(s); flex: none; width: 34px; height: 34px; border-radius: 50%;
  background: ${BRAND.green}; color: ${BRAND.black}; display: grid; place-items: center;
  font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 20px;
}
.hint { font-size: 15px; color: #a6a6a6; margin: 0; }
.btn {
  display: inline-flex; align-items: center; justify-content: center; min-height: 48px; padding: 10px 24px; border-radius: 999px;
  text-align: center; line-height: 1.25;
  background: ${BRAND.green}; color: ${BRAND.black}; font-weight: 600; text-decoration: none; margin: 0 0 24px;
}
.btn:focus-visible { outline: 3px solid ${BRAND.white}; outline-offset: 3px; }
</style>
</head>
<body>
<main>
  <div class="logo" aria-hidden="true">
    <svg width="30" height="30" viewBox="0 0 32 32"><circle cx="16" cy="9" r="7" fill="${BRAND.pink}"/><path d="M14.5 15h3L16 31z" fill="${BRAND.white}"/></svg>
    <span>Stachel</span>
  </div>
${main}
</main>
</body>
</html>`;
}

/**
 * `/qr/:code`: Den Code scannt man in der App der Organisation (`appName`, STACHEL_ORG_APP_NAME), nicht mit der
 * Kamera. Mit `handy` (Rücksprung von „In der {appName} öffnen“ auf demselben Handy, wenn die App den Link nicht
 * übernommen hat): erklären, warum, und zur Anmeldung im Browser zurückführen.
 */
export function qrHintPage(handy = false, home = '/', appName = 'App'): string {
  const app = esc(appName);
  if (handy)
    return page(
      'Stachel – Anmeldung',
      `<h1>App hat sich <em>nicht geöffnet</em></h1>
  <p>Auf diesem Handy ist die ${app} nicht installiert oder noch nicht auf dem neuesten Stand. Den QR-Code kannst du auf demselben Handy nicht scannen.</p>
  <a class="btn" href="${home}">Im Browser anmelden</a>
  <p class="hint">Oder Stachel direkt in der ${app} öffnen.</p>`,
    );
  return page(
    'Stachel – Anmeldung',
    `<h1>Fast <em>geschafft</em></h1>
  <p>Diesen Code scannst du nicht mit der Kamera, sondern in der ${app}.</p>
  <ol>
    <li>Öffne die ${app}</li>
    <li>Gehe dort zu Stachel</li>
    <li>Scanne den Code mit dem QR-Knopf</li>
  </ol>
  <p class="hint">Danach bist du im Browser automatisch angemeldet.</p>`,
  );
}

/** Unbekannter Pfad (die Web-App kennt nur ihre Startadresse `home` mit Query-Parametern, site.ts). */
export function notFoundPage(home = '/'): string {
  return page(
    'Stachel – Seite nicht gefunden',
    `<h1>Seite <em>nicht gefunden</em></h1>
  <p>Diese Adresse gibt es bei Stachel nicht. Vielleicht ist der Link unvollständig oder veraltet.</p>
  <a class="btn" href="${home}">Zur Board-Übersicht</a>`,
  );
}
