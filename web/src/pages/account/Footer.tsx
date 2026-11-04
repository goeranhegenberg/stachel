// Fußzeile mit Impressum, Datenschutz, Nutzungsbedingungen (beide Modi, sobald gesetzt: STACHEL_IMPRINT_URL /
// STACHEL_PRIVACY_URL / STACHEL_TERMS_URL bzw. eigene Seiten aus <DATA_DIR>/legal) und den Lizenzen der mitgelieferten
// Software (`licenses.txt` aus dem Build).
import { useInstance } from '../../instance';
import { appHref } from '../../router';
import './account.css';

export function LegalFooter({ dark = false }: { dark?: boolean }) {
  const inst = useInstance();
  if (!inst) return null;
  return (
    <footer className={`acc-footer${dark ? ' acc-footer--dark' : ''}`} data-testid="legal-footer">
      <span>{inst.brand}</span>
      {inst.imprintUrl && (
        <a href={inst.imprintUrl} target="_blank" rel="noopener noreferrer">
          Impressum
        </a>
      )}
      {inst.privacyUrl && (
        <a href={inst.privacyUrl} target="_blank" rel="noopener noreferrer">
          Datenschutz
        </a>
      )}
      {inst.termsUrl && (
        <a href={inst.termsUrl} target="_blank" rel="noopener noreferrer">
          Nutzungsbedingungen
        </a>
      )}
      <a href={appHref('licenses.txt')} target="_blank" rel="noopener" data-testid="footer-licenses">
        Lizenzen
      </a>
      <span className="acc-footer__note">Keine Tracker, keine Werbung</span>
    </footer>
  );
}
