import { useEffect, useRef, useState, type FormEvent } from 'react';
import QRCode from 'qrcode';
import type { User } from '../protocol';
import { api, ApiError, errorText } from '../api';
import { StachelMark, Wordmark } from '../ui/Logo';
import { useMediaQuery } from '../ui/useMediaQuery';
import { AppLogin } from '../features/tools/login/AppLogin';
import { wasInApp } from './inApp';
import { FALLBACK_INSTANCE, useInstance, type Instance } from '../instance';
import { appOpenUrl, mobilePlatform } from './appLink';
import { LegalFooter } from './account/Footer';
import './login.css';

type QrState =
  | { phase: 'loading' }
  | { phase: 'ready'; svg: string; url: string; expiresAt: number; ttl: number }
  | { phase: 'error'; message: string };

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    });
  });

/** QR-Pairing wie WhatsApp Web: Code holen, per Long-Poll warten, nach Ablauf automatisch erneuern.
 *  Läuft nur, solange der QR-Code sichtbar ist (spart Requests und Rate-Limit). */
function useQrPairing(onApproved: (u: User) => void, enabled: boolean) {
  const [state, setState] = useState<QrState>({ phase: 'loading' });
  const [notice, setNotice] = useState<string | null>(null);
  const approvedRef = useRef(onApproved);
  approvedRef.current = onApproved;
  const netNotice = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    setState({ phase: 'loading' });
    setNotice(null);
    const ctrl = new AbortController();
    const { signal } = ctrl;
    (async () => {
      let failures = 0;
      while (!signal.aborted) {
        let pairing: Awaited<ReturnType<typeof api.qrStart>>;
        try {
          pairing = await api.qrStart();
          failures = 0;
        } catch (e) {
          if (signal.aborted) return;
          failures++;
          setState({ phase: 'error', message: errorText(e) });
          await sleep(Math.min(15000, 2000 * failures), signal);
          continue;
        }
        const expiresAt = Date.parse(pairing.expires_at) || Date.now() + 120_000;
        const svg = await QRCode.toString(pairing.url, {
          type: 'svg',
          margin: 0,
          errorCorrectionLevel: 'H',
          color: { dark: '#0a0a0a', light: '#ffffff' },
        });
        if (signal.aborted) return;
        setState({ phase: 'ready', svg, url: pairing.url, expiresAt, ttl: Math.max(1, expiresAt - Date.now()) });

        while (!signal.aborted && Date.now() < expiresAt) {
          const started = Date.now();
          // Long-Poll spätestens beim Ablauf abbrechen, damit sofort ein neuer Code kommt
          const waitCtrl = new AbortController();
          const onAbort = () => waitCtrl.abort();
          signal.addEventListener('abort', onAbort);
          const expiryTimer = setTimeout(() => waitCtrl.abort(), Math.max(0, expiresAt - Date.now()));
          try {
            const r = await api.qrWait(pairing.code, waitCtrl.signal);
            if (r.status === 'approved' && r.user) {
              approvedRef.current(r.user);
              return;
            }
            // Netzfehler-Hinweis verschwindet, sobald es wieder geht; QR-Hinweise bleiben stehen
            if (netNotice.current) {
              netNotice.current = false;
              setNotice(null);
            }
            // Server antwortet sofort statt zu warten? Nicht hämmern.
            if (Date.now() - started < 1000) await sleep(1000, signal);
          } catch (e) {
            if (signal.aborted) return;
            if (waitCtrl.signal.aborted) break; // abgelaufen → neuer Code
            if (e instanceof ApiError && e.code === 'expired') break;
            if (e instanceof ApiError && (e.code === 'wrong_browser' || e.code === 'unknown_code' || e.code === 'already_used')) {
              netNotice.current = false;
              setNotice(e.message);
              await sleep(1000, signal);
              break;
            }
            if (e instanceof ApiError && e.code === 'pending') {
              setNotice(e.message);
              await sleep(3000, signal);
              continue;
            }
            netNotice.current = true;
            setNotice(errorText(e));
            await sleep(3000, signal);
          } finally {
            clearTimeout(expiryTimer);
            signal.removeEventListener('abort', onAbort);
          }
        }
      }
    })();
    return () => ctrl.abort();
  }, [enabled]);

  return { state, notice };
}

function Countdown({ expiresAt, ttl }: { expiresAt: number; ttl: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, expiresAt - now);
  const secs = Math.ceil(left / 1000);
  return (
    <div className="qr-countdown" aria-live="off">
      <div className="qr-countdown__bar">
        <span style={{ transform: `scaleX(${left / ttl})` }} />
      </div>
      <span className="qr-countdown__label">
        {secs > 0 ? `Neuer Code in ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : 'Neuer Code …'}
      </span>
    </div>
  );
}

// Anmeldung im Modus org (docs/contract.md §1/§2): über die App der Organisation (QR-Code am Computer, „In der App
// öffnen“ am Handy) und, wenn die Instanz es anbietet (`orgPasswordLogin`), mit Benutzername und Passwort der
// Organisation. Namen der Organisation und ihrer App kommen aus /api/instance (instance.ts).

/** Handy und Tablet: den eigenen Bildschirm kann man nicht scannen – Passwort zuerst, dann „In der App öffnen“
 *  (Modul tools); der QR-Code nur auf Wunsch. */
const COMPACT = '(pointer: coarse)';

/** Namen für die Texte der Anmeldung. */
function orgNames(inst: Instance | null) {
  const i = inst?.auth === 'org' ? inst : FALLBACK_INSTANCE;
  return { org: i.orgName ?? 'Organisation', app: i.orgAppName ?? 'App', password: i.orgPasswordLogin, androidPackage: i.orgAndroidPackage };
}

/** Im WebView der App ist die Sitzung abgelaufen: dort hilft nur, Stachel aus der App neu zu öffnen. */
function AppSessionExpired({ onPassword }: { onPassword: (() => void) | null }) {
  const n = orgNames(useInstance());
  return (
    <div className="login login--compact login--expired">
      <header className="login-top">
        <Wordmark size={26} inverted />
        <span className="login-qr__tag">{n.org}</span>
      </header>
      <section className="login-expired" role="alert" data-testid="app-session-expired">
        <span className="login-expired__pin" aria-hidden="true">
          <StachelMark size={44} body="#0a0a0a" />
        </span>
        <h1 className="login-expired__title">Sitzung abgelaufen</h1>
        <p className="login-expired__text">
          Bitte Stachel in der <b>{n.app}</b> neu öffnen.
        </p>
        {onPassword && (
          <button type="button" className="login-expired__pw" onClick={onPassword}>
            Trotzdem mit Passwort anmelden
          </button>
        )}
      </section>
    </div>
  );
}

export function LoginPage(props: { onLogin: (u: User) => void; notice?: string | null }) {
  const [inApp, setInApp] = useState(wasInApp);
  const password = orgNames(useInstance()).password;
  if (inApp) return <AppSessionExpired onPassword={password ? () => setInApp(false) : null} />;
  return <LoginForms {...props} />;
}

function LoginForms({ onLogin, notice: bootNotice }: { onLogin: (u: User) => void; notice?: string | null }) {
  const compact = useMediaQuery(COMPACT);
  const n = orgNames(useInstance());
  const [platform] = useState(() => mobilePlatform());
  // „In der App öffnen“: Android nur mit bekanntem App-Paket, iOS nie (Safari übernimmt Links derselben Domain nicht)
  const appButton = platform === 'other' || (platform === 'android' && !!n.androidPackage);
  const [qrOpen, setQrOpen] = useState(false);
  const [appOpen, setAppOpen] = useState(false);
  const qrVisible = !compact || qrOpen;
  const { state, notice } = useQrPairing(onLogin, qrVisible || (compact && appOpen));
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(bootNotice ?? null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError('Bitte Benutzername und Passwort eingeben.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onLogin(await api.passwordLogin(username.trim(), password));
    } catch (err) {
      setError(errorText(err));
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`login${compact ? ' login--compact' : ''}${n.password ? '' : ' login--qr-only'}`}>
      {compact && (
        <header className="login-top">
          <Wordmark size={26} inverted />
          <span className="login-qr__tag">{n.org}</span>
        </header>
      )}
      <section className="login-qr" aria-label={compact ? `Mit der ${n.app} anmelden` : undefined} aria-labelledby={compact ? undefined : 'qr-title'}>
        {!compact && (
          <header className="login-qr__head">
            <Wordmark size={30} inverted />
            <span className="login-qr__tag">{n.org}</span>
          </header>
        )}
        {compact && appButton && (
          <AppLogin
            appName={n.app}
            open={appOpen}
            onOpen={() => setAppOpen(true)}
            url={state.phase === 'ready' ? appOpenUrl(state.url, platform, n.androidPackage) : null}
            error={state.phase === 'error' ? state.message : !qrOpen ? notice : null}
            qrOpen={qrOpen}
            onToggleQr={() => setQrOpen((v) => !v)}
          />
        )}
        {compact && !appButton && (
          // iPhone/iPad (bzw. Android ohne bekanntes App-Paket): Die App kann den Anmelde-Link aus dem Browser nicht
          // übernehmen, also Passwort (oben) oder Stachel direkt in der App öffnen; den QR-Code nur für ein zweites Gerät
          <div className="tools-applogin" data-testid="ios-login-hint">
            <p className="tools-applogin__hint">
              <b>Auf diesem Gerät:</b> {n.password ? <>oben mit Benutzername &amp; Passwort anmelden – oder Stachel gleich in der {n.app} öffnen.</> : <>Stachel gleich in der {n.app} öffnen.</>}
            </p>
            <button className="tools-applogin__qr" aria-expanded={qrOpen} aria-controls="qr-panel" onClick={() => setQrOpen((v) => !v)}>
              {qrOpen ? 'QR-Code ausblenden' : 'QR-Code für ein anderes Handy zeigen'}
            </button>
          </div>
        )}

        {qrVisible && (
          <div className="login-qr__main" id="qr-panel">
            <h1 id="qr-title" className="login-qr__title">
              Mit der <em>{n.app}</em> anmelden
            </h1>
            <div className="login-qr__grid">
              <div className="qr-card" data-testid="qr-card">
                <span className="qr-card__pin" aria-hidden="true">
                  <StachelMark size={34} body="#0a0a0a" />
                </span>
                <div className="qr-card__code">
                  {state.phase === 'ready' ? (
                    <>
                      <div className="qr-card__svg" role="img" aria-label="QR-Code zum Anmelden" dangerouslySetInnerHTML={{ __html: state.svg }} />
                      <span className="qr-card__logo" aria-hidden="true">
                        <StachelMark size={30} body="#0a0a0a" />
                      </span>
                    </>
                  ) : state.phase === 'loading' ? (
                    <div className="qr-card__placeholder" aria-busy="true">
                      <span className="qr-spinner" />
                    </div>
                  ) : (
                    <div className="qr-card__placeholder qr-card__placeholder--err">
                      <span>{state.message}</span>
                    </div>
                  )}
                </div>
                {state.phase === 'ready' && <Countdown key={state.expiresAt} expiresAt={state.expiresAt} ttl={state.ttl} />}
              </div>

              <ol className="qr-steps">
                <li>
                  <b>Öffne die {n.app}</b> auf deinem Handy.
                </li>
                <li>
                  Wähle dort <b>Stachel</b> bzw. <b>QR-Code scannen</b>.
                </li>
                <li>
                  <b>Scanne den Code</b> und bestätige. Fertig.
                </li>
              </ol>
            </div>
            {notice && (
              <p className="login-qr__notice" role="status">
                {notice}
              </p>
            )}
          </div>
        )}

        <footer className="login-qr__foot">Kein eigenes Konto nötig. Keine Tracker, keine Werbung.</footer>
      </section>

      {n.password && (
      <section className="login-form" aria-labelledby="pw-title">
        <form className="login-form__card" onSubmit={submit} noValidate>
          <span className="login-form__kicker">{compact ? 'Anmelden' : 'Oder klassisch'}</span>
          <h2 id="pw-title">Benutzername &amp; Passwort</h2>
          <p className="login-form__lead">Dein Zugang bei {n.org}.</p>
          {error && (
            <div className="alert" role="alert" data-testid="login-error">
              {error}
            </div>
          )}
          <div className="field">
            <label htmlFor="u">Benutzername</label>
            <input
              id="u"
              className="input"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="p">Passwort</label>
            <input
              id="p"
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button className="btn btn--primary login-form__submit" type="submit" disabled={busy}>
            {busy ? 'Melde an …' : 'Anmelden'}
          </button>
          <p className="login-form__hint">Neu dabei? Sobald {n.org} dein Konto freigegeben hat, kommst du hier rein.</p>
        </form>
      </section>
      )}
      {/* Impressum, Datenschutz, Nutzungsbedingungen der Instanz (STACHEL_*_URL bzw. eigene Seiten) über die ganze Breite */}
      <div style={{ gridColumn: '1 / -1' }}>
        <LegalFooter />
      </div>
    </div>
  );
}
