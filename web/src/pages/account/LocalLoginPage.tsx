// Anmeldung im Modus local (eigene Konten, docs/features/accounts.md): Anmelden, Registrieren (mit Captcha und
// Honigtopf), Passwort vergessen, Bestätigungs- und Reset-Links aus den Mails (`/?verify=…`, `/?reset=…`).
// Gleiches Design wie die Anmeldung im Modus org, aber ohne QR und App, mit dem Namen der Instanz.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { User } from '../../protocol';
import { ApiError, errorText } from '../../api';
import { useInstance } from '../../instance';
import { appHref } from '../../router';
import { Wordmark } from '../../ui/Logo';
import { accountApi } from './accountApi';
import { solveCaptcha } from './captcha';
import { LegalFooter } from './Footer';
import '../login.css';
import './account.css';

type Mode = 'login' | 'register' | 'forgot' | 'sent' | 'forgotSent' | 'verify' | 'reset';

const MIN_PW = 10;

/** Token aus der Adresse lesen und sofort aus dem Verlauf entfernen (nicht in Lesezeichen/Verlauf liegen lassen). */
function takeParams() {
  const q = new URLSearchParams(location.search);
  const verify = q.get('verify');
  const reset = q.get('reset');
  if (verify || reset) history.replaceState(null, '', appHref());
  return { verify, reset, register: q.get('register') === '1', forgot: q.get('forgot') === '1', email: q.get('email') ?? '' };
}

function initialMode(p: ReturnType<typeof takeParams>): Mode {
  if (p.verify) return 'verify';
  if (p.reset) return 'reset';
  if (p.register) return 'register';
  if (p.forgot) return 'forgot';
  return 'login';
}

/** Captcha im Hintergrund lösen, sobald das Registrieren-Formular sichtbar ist. */
function useCaptcha(active: boolean) {
  const [state, setState] = useState<'idle' | 'solving' | 'done' | 'error'>('idle');
  const job = useRef<Promise<string> | null>(null);
  const start = () => {
    setState('solving');
    const p = solveCaptcha();
    job.current = p;
    p.then(
      () => job.current === p && setState('done'),
      () => job.current === p && setState('error'),
    );
    return p;
  };
  useEffect(() => {
    if (active && !job.current) void start().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  return {
    state,
    /** Lösung holen (wartet ggf.); danach ist sie verbraucht, die nächste wird schon gerechnet */
    take: async () => {
      const p = job.current ?? start();
      try {
        return await p;
      } finally {
        job.current = null;
        void start().catch(() => {});
      }
    },
  };
}

function PasswordField({ id, label, value, onChange, autoComplete, hint }: { id: string; label: string; value: string; onChange: (v: string) => void; autoComplete: string; hint?: ReactNode }) {
  const [show, setShow] = useState(false);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="acc-pw">
        <input id={id} className="input" type={show ? 'text' : 'password'} autoComplete={autoComplete} value={value} onChange={(e) => onChange(e.target.value)} />
        <button type="button" className="acc-pw__toggle" onClick={() => setShow((v) => !v)} aria-pressed={show} aria-label={show ? 'Passwort verbergen' : 'Passwort zeigen'}>
          {show ? 'Verbergen' : 'Zeigen'}
        </button>
      </div>
      {hint && <span className="acc-hint">{hint}</span>}
    </div>
  );
}

export function LocalLoginPage({ onLogin, notice }: { onLogin: (u: User) => void; notice?: string | null }) {
  const inst = useInstance();
  const [params] = useState(takeParams);
  const [mode, setMode] = useState<Mode>(() => initialMode(params));
  const [email, setEmail] = useState(params.email);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [terms, setTerms] = useState(false);
  const [website, setWebsite] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(notice ?? null);
  const [info, setInfo] = useState<string | null>(null);
  const [unverified, setUnverified] = useState(false);
  const captcha = useCaptcha(mode === 'register');
  const brand = inst?.brand ?? 'Stachel';

  const go = (m: Mode) => {
    setMode(m);
    setError(null);
    setInfo(null);
    setUnverified(false);
    setPassword('');
  };

  // Bestätigungslink aus der Mail
  useEffect(() => {
    if (!params.verify) return;
    let alive = true;
    accountApi
      .verify(params.verify)
      .then((r) => {
        if (!alive) return;
        setEmail(r.email);
        setMode('login');
        setInfo('E-Mail-Adresse bestätigt. Melde dich jetzt an.');
      })
      .catch((e) => {
        if (!alive) return;
        setMode('login');
        setError(e instanceof ApiError && e.code === 'link_expired' ? 'Dieser Bestätigungslink ist abgelaufen oder wurde schon benutzt. Melde dich an – falls nötig, schicken wir dir einen neuen.' : errorText(e));
      });
    return () => {
      alive = false;
    };
  }, [params.verify]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
      return e;
    } finally {
      setBusy(false);
    }
  };

  const login = (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return setError('Bitte E-Mail-Adresse und Passwort eingeben.');
    void run(async () => {
      try {
        onLogin(await accountApi.login(email.trim(), password));
      } catch (err) {
        setPassword('');
        if (err instanceof ApiError && err.code === 'not_verified') setUnverified(true);
        throw err;
      }
    });
  };

  const register = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError('Bitte gib deinen Namen an.');
    if (!email.trim()) return setError('Bitte gib deine E-Mail-Adresse an.');
    if (password.length < MIN_PW) return setError(`Das Passwort braucht mindestens ${MIN_PW} Zeichen.`);
    if (!terms) return setError('Bitte akzeptiere die Nutzungsbedingungen und bestätige, dass du mindestens 18 Jahre alt bist.');
    void run(async () => {
      const body = { name: name.trim(), email: email.trim(), password, terms, website };
      let r: { verified?: boolean };
      try {
        r = await accountApi.register({ ...body, captcha: await captcha.take() });
      } catch (err) {
        // Captcha abgelaufen (z. B. Formular lange offen): einmal mit frischer Lösung
        if (!(err instanceof ApiError && err.code === 'captcha_invalid')) throw err;
        r = await accountApi.register({ ...body, captcha: await captcha.take() });
      }
      // Instanz ohne E-Mail-Bestätigung (Selbst-Hosting ohne SMTP): Konto ist sofort aktiv → gleich anmelden
      if (r.verified) return onLogin(await accountApi.login(body.email, password));
      setPassword('');
      setMode('sent');
    });
  };

  const forgot = (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return setError('Bitte gib deine E-Mail-Adresse an.');
    void run(async () => {
      await accountApi.forgot(email.trim());
      setMode('forgotSent');
    });
  };

  const reset = (e: FormEvent) => {
    e.preventDefault();
    if (password.length < MIN_PW) return setError(`Das Passwort braucht mindestens ${MIN_PW} Zeichen.`);
    void run(async () => {
      try {
        const r = await accountApi.reset(params.reset!, password);
        setEmail(r.email);
        go('login');
        setInfo('Neues Passwort gespeichert. Melde dich jetzt damit an.');
      } catch (err) {
        if (err instanceof ApiError && err.code === 'link_expired') {
          go('forgot');
          throw new ApiError('link_expired', 410, 'Dieser Link ist abgelaufen oder wurde schon benutzt. Fordere hier einen neuen an.');
        }
        throw err;
      }
    });
  };

  const resend = () =>
    void run(async () => {
      await accountApi.resend(email.trim());
      setUnverified(false);
      setInfo('Wir haben dir die Bestätigungsmail noch einmal geschickt.');
    });

  const alerts = (
    <>
      {error && (
        <div className="alert" role="alert" data-testid="login-error">
          {error}
        </div>
      )}
      {info && (
        <div className="acc-ok" role="status" data-testid="login-info">
          {info}
        </div>
      )}
    </>
  );

  const emailField = (autoFocus = false) => (
    <div className="field">
      <label htmlFor="acc-email">E-Mail-Adresse</label>
      <input
        id="acc-email"
        className="input"
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        autoFocus={autoFocus}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
    </div>
  );

  const tabs = (mode === 'login' || mode === 'register') && (
    <div className="acc-tabs" role="tablist" aria-label="Anmelden oder registrieren">
      <button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'is-active' : ''} onClick={() => go('login')}>
        Anmelden
      </button>
      <button type="button" role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'is-active' : ''} onClick={() => go('register')}>
        Registrieren
      </button>
    </div>
  );

  let card: ReactNode;
  if (mode === 'verify') {
    card = (
      <div className="login-form__card" aria-busy="true">
        <h2>E-Mail bestätigen</h2>
        <p className="login-form__lead">Einen Moment …</p>
      </div>
    );
  } else if (mode === 'login') {
    card = (
      <form className="login-form__card" onSubmit={login} noValidate aria-labelledby="acc-title">
        {tabs}
        <h2 id="acc-title">Anmelden</h2>
        {alerts}
        {unverified && (
          <button type="button" className="btn btn--ghost btn--sm acc-resend" onClick={resend} disabled={busy}>
            Bestätigungsmail erneut senden
          </button>
        )}
        {emailField(!email)}
        <PasswordField id="acc-pw" label="Passwort" value={password} onChange={setPassword} autoComplete="current-password" />
        <button className="btn btn--primary login-form__submit" type="submit" disabled={busy}>
          {busy ? 'Melde an …' : 'Anmelden'}
        </button>
        <button type="button" className="acc-link" onClick={() => go('forgot')}>
          Passwort vergessen?
        </button>
      </form>
    );
  } else if (mode === 'register') {
    card = (
      <form className="login-form__card" onSubmit={register} noValidate aria-labelledby="acc-title">
        {tabs}
        <h2 id="acc-title">Konto anlegen</h2>
        <p className="login-form__lead">
          {inst?.verification === false ? 'Kostenlos. Dein Konto ist sofort startklar.' : 'Kostenlos. Danach schicken wir dir einen Bestätigungslink.'}
        </p>
        {alerts}
        <div className="field">
          <label htmlFor="acc-name">Name</label>
          <input id="acc-name" className="input" autoComplete="name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        {emailField()}
        <PasswordField
          id="acc-pw"
          label="Passwort"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          hint={password && password.length < MIN_PW ? `Noch ${MIN_PW - password.length} Zeichen` : `Mindestens ${MIN_PW} Zeichen, gern ein ganzer Satz.`}
        />
        {/* Honigtopf: für Menschen unsichtbar, Bots füllen es aus */}
        <div className="acc-hp" aria-hidden="true">
          <label htmlFor="acc-website">Webseite</label>
          <input id="acc-website" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </div>
        {/* Nutzungsbedingungen + 18 als Pflicht-Häkchen; Datenschutz nur als Hinweis (keine Einwilligung, docs/legal CR-1) */}
        <label className="acc-check">
          <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} data-testid="register-terms" />
          <span>
            Ich akzeptiere die{' '}
            {inst?.termsUrl ? (
              <a href={inst.termsUrl} target="_blank" rel="noopener noreferrer">
                Nutzungsbedingungen
              </a>
            ) : (
              'Nutzungsbedingungen'
            )}{' '}
            und bin mindestens 18 Jahre alt.
          </span>
        </label>
        <p className="acc-hint" data-testid="register-privacy-note">
          Informationen zum Datenschutz findest du in der{' '}
          {inst?.privacyUrl ? (
            <a href={inst.privacyUrl} target="_blank" rel="noopener noreferrer">
              Datenschutzerklärung
            </a>
          ) : (
            'Datenschutzerklärung'
          )}
          .
        </p>
        <p className={`acc-captcha acc-captcha--${captcha.state}`} role="status" data-testid="captcha-state">
          <span className="acc-captcha__box" aria-hidden="true" />
          {captcha.state === 'done'
            ? 'Sicherheitsprüfung erledigt'
            : captcha.state === 'error'
              ? 'Sicherheitsprüfung fehlgeschlagen – beim Absenden neuer Versuch'
              : 'Sicherheitsprüfung läuft im Hintergrund …'}
          <small>ohne Drittanbieter, ohne Cookies</small>
        </p>
        <button className="btn btn--primary login-form__submit" type="submit" disabled={busy}>
          {busy ? 'Einen Moment …' : 'Konto anlegen'}
        </button>
      </form>
    );
  } else if (mode === 'sent') {
    card = (
      <div className="login-form__card" data-testid="register-sent">
        <span className="login-form__kicker">Fast geschafft</span>
        <h2>Schau in dein Postfach</h2>
        <p className="login-form__lead">
          Wir haben eine E-Mail an <b>{email.trim()}</b> geschickt. Klick auf den Link darin, dann kannst du dich anmelden. Der Link gilt 24 Stunden.
        </p>
        {alerts}
        <button type="button" className="btn btn--ghost btn--sm" onClick={resend} disabled={busy}>
          Keine Mail bekommen? Erneut senden
        </button>
        <button type="button" className="acc-link" onClick={() => go('login')}>
          Zur Anmeldung
        </button>
      </div>
    );
  } else if (mode === 'forgot') {
    card = (
      <form className="login-form__card" onSubmit={forgot} noValidate aria-labelledby="acc-title">
        <h2 id="acc-title">Passwort vergessen</h2>
        <p className="login-form__lead">Gib deine E-Mail-Adresse ein. Wir schicken dir einen Link, mit dem du ein neues Passwort festlegst.</p>
        {alerts}
        {emailField(true)}
        <button className="btn btn--primary login-form__submit" type="submit" disabled={busy}>
          {busy ? 'Einen Moment …' : 'Link senden'}
        </button>
        <button type="button" className="acc-link" onClick={() => go('login')}>
          Zurück zur Anmeldung
        </button>
      </form>
    );
  } else if (mode === 'forgotSent') {
    card = (
      <div className="login-form__card" data-testid="forgot-sent">
        <h2>Mail ist unterwegs</h2>
        <p className="login-form__lead">
          Wenn es für <b>{email.trim()}</b> ein Konto gibt, bekommst du gleich eine E-Mail mit einem Link. Er gilt eine Stunde.
        </p>
        <button type="button" className="acc-link" onClick={() => go('login')}>
          Zur Anmeldung
        </button>
      </div>
    );
  } else {
    card = (
      <form className="login-form__card" onSubmit={reset} noValidate aria-labelledby="acc-title">
        <h2 id="acc-title">Neues Passwort</h2>
        {alerts}
        <PasswordField id="acc-pw" label="Neues Passwort" value={password} onChange={setPassword} autoComplete="new-password" hint={`Mindestens ${MIN_PW} Zeichen.`} />
        <button className="btn btn--primary login-form__submit" type="submit" disabled={busy}>
          {busy ? 'Speichere …' : 'Passwort speichern'}
        </button>
      </form>
    );
  }

  return (
    <div className="login acc-login">
      {/* Handy/schmal: Marke oben, die dunkle Erklärung rutscht unter das Formular */}
      <header className="login-top acc-top">
        <Wordmark size={26} inverted />
        {brand !== 'Stachel' && <span className="login-qr__tag">{brand}</span>}
      </header>
      <section className="login-qr acc-hero" aria-label={brand}>
        <header className="login-qr__head">
          <Wordmark size={30} inverted />
          {brand !== 'Stachel' && <span className="login-qr__tag">{brand}</span>}
        </header>
        <div className="acc-hero__main">
          <h1 className="login-qr__title">
            Ideen <em>live</em> auf einem Board.
          </h1>
          <ul className="acc-hero__points">
            <li>Haftnotizen, Formen, Pfeile, Rahmen – wie gewohnt.</li>
            <li>Alle sehen Änderungen sofort, mit Cursor und Kommentaren.</li>
            <li>Teilen per E-Mail oder Link: ansehen, kommentieren oder bearbeiten.</li>
          </ul>
        </div>
      </section>
      <section className="login-form acc-form">
        {card}
        <LegalFooter />
      </section>
    </div>
  );
}
