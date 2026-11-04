// Stachel im WebView der App der Organisation (Modus org) erkennen.
// Die App öffnet Stachel über `/auth/app?code=…`; der Server leitet auf `/?app=1` (bzw. `/?b=<id>&app=1`) weiter.
// Nur dieses Kennzeichen zählt – eine allgemeine WebView-Kennung im User-Agent („; wv)“) haben auch die In-App-Browser
// von Instagram, Facebook usw., dort wäre der Hinweis „in der App neu öffnen“ falsch.
// Der Speicher des WebViews ist vom normalen Browser getrennt: Nach einer Anmeldung über die App merkt er sich
// `stachel.inApp=1`. Läuft die Sitzung später ab, zeigt die Anmeldeseite statt Passwort/QR den Hinweis, Stachel in der
// App neu zu öffnen.

const KEY = 'stachel.inApp';

/** Nach erfolgreicher Anmeldung aufrufen: merkt sich den App-Kontext (nur mit `app=1`) und entfernt ihn aus der Adresse. */
export function rememberInApp(): void {
  let fromParam = false;
  try {
    const q = new URLSearchParams(location.search);
    if (q.get('app') === '1') {
      fromParam = true;
      q.delete('app');
      const s = q.toString();
      history.replaceState(history.state, '', `${location.pathname}${s ? `?${s}` : ''}${location.hash}`);
    }
  } catch {
    /* Adresse bleibt, wie sie ist */
  }
  if (!fromParam) return;
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    /* Speicher gesperrt: dann eben kein Hinweis */
  }
}

export function wasInApp(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/** Bewusst abgemeldet: kein „Sitzung abgelaufen“ mehr zeigen. */
export function forgetInApp(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* egal */
  }
}
