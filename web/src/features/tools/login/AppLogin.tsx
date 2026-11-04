// Anmeldung auf Handy und Tablet: Den eigenen Bildschirm kann man nicht scannen. Statt QR-Code ein Knopf, der den
// Anmelde-Link ({PUBLIC_URL}/qr/<code>) in der App der Organisation öffnet (Deep-Link, sobald die App ihn kennt), dazu der
// Hinweis, den QR-Code am Computer zu scannen. Der QR-Code bleibt auf Wunsch abrufbar (z. B. Tablet auf dem Tisch).
import { IconChevron } from '../../../ui/icons';
import { IconOpenApp } from '../icons';
import './login.css';

export interface AppLoginProps {
  /** Name der App der Organisation (`orgAppName` aus /api/instance) */
  appName: string;
  /** Bereich aufgeklappt (Anmelde-Code wird geholt) */
  open: boolean;
  onOpen: () => void;
  /** Anmelde-Link, sobald der Code da ist */
  url: string | null;
  error: string | null;
  qrOpen: boolean;
  onToggleQr: () => void;
}

export function AppLogin({ appName, open, onOpen, url, error, qrOpen, onToggleQr }: AppLoginProps) {
  if (!open)
    return (
      <button className="login-qr__toggle tools-applogin__toggle" aria-expanded="false" aria-controls="tools-applogin" onClick={onOpen}>
        <IconOpenApp size={28} />
        <span>
          <span className="login-qr__toggle-q">Ohne Passwort – die App bestätigt dich</span>
          <b>Mit der {appName}</b>
        </span>
        <IconChevron size={22} className="login-qr__chev" />
      </button>
    );
  return (
    <div className="tools-applogin" id="tools-applogin" data-testid="app-login">
      {!qrOpen && (
        <h1 className="tools-applogin__title">
          Mit der <em>{appName}</em> anmelden
        </h1>
      )}
      {url ? (
        <a className="btn btn--green tools-applogin__open" href={url} target="_blank" rel="noopener" data-testid="open-app">
          <IconOpenApp size={22} /> In der {appName} öffnen
        </a>
      ) : (
        <span className="btn btn--green tools-applogin__open is-loading" aria-busy="true" aria-disabled="true">
          <span className="qr-spinner" /> Code wird vorbereitet …
        </span>
      )}
      <ol className="tools-applogin__steps">
        <li>Die App öffnet sich und fragt, ob du dich bei Stachel anmelden willst.</li>
        <li>Bestätigen – diese Seite meldet dich dann von selbst an.</li>
      </ol>
      <p className="tools-applogin__hint">
        <b>Stachel am Computer offen?</b> Dann dort den QR-Code mit der {appName} scannen.
      </p>
      {error && (
        <p className="login-qr__notice" role="status">
          {error}
        </p>
      )}
      <button className="tools-applogin__qr" aria-expanded={qrOpen} aria-controls="qr-panel" onClick={onToggleQr}>
        {qrOpen ? 'QR-Code ausblenden' : 'QR-Code hier zeigen'}
      </button>
    </div>
  );
}
