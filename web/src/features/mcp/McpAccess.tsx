// „KI-Zugang (MCP)“: persönliche API-Tokens für KI-Assistenten anlegen, fertige Einrichtung kopieren, widerrufen.
// Der Klartext eines Tokens erscheint nur direkt nach dem Anlegen. Vertrag: docs/features/mcp.md, server/src/api-tokens.ts.
import { useEffect, useState, type FormEvent } from 'react';
import { errorText, request } from '../../api';
import { ConfirmDialog, Modal } from '../../ui/Modal';
import { agoText, mcpSetups } from './config';
import './mcp.css';

export interface ApiTokenInfo {
  id: string;
  label: string;
  hint: string;
  createdAt: string;
  lastUsedAt: string | null;
  /** verfällt an diesem Tag, wenn es bis dahin nicht benutzt wird (12 Monate ohne Nutzung, server/src/api-tokens.ts) */
  expiresAt?: string;
}

/** Hinweis beim Anlegen (docs/legal/datenschutz.md §8, CR-9): was ein verbundener Assistent sieht und wohin es geht. */
export const MCP_PRIVACY_NOTE =
  'Ein verbundener KI-Assistent sieht alle Boards, auf die du Zugriff hast – auch Namen und Kommentare anderer. Diese Daten gehen an den Anbieter des Assistenten. Tokens, die 12 Monate nicht benutzt werden, verfallen automatisch.';

export const mcpApi = {
  list: () => request<{ tokens: ApiTokenInfo[]; mcpUrl: string }>('GET', '/api/tokens'),
  create: (label: string) => request<{ token: ApiTokenInfo; secret: string; mcpUrl: string }>('POST', '/api/tokens', { label }),
  revoke: (id: string) => request<{ ok: true }>('DELETE', `/api/tokens/${encodeURIComponent(id)}`),
};

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function CopyBlock({ code, label }: { code: string; label: string }) {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle');
  return (
    <div className="mcp-code">
      <pre tabIndex={0} aria-label={label}>
        {code}
      </pre>
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        onClick={async () => {
          setState((await copy(code)) ? 'ok' : 'fail');
          setTimeout(() => setState('idle'), 2000);
        }}
      >
        {state === 'ok' ? 'Kopiert' : state === 'fail' ? 'Bitte markieren' : 'Kopieren'}
      </button>
    </div>
  );
}

/** Inhalt (ohne Dialog-Rahmen), auch für eine Konto-Seite nutzbar. */
export function McpAccessPanel() {
  const [tokens, setTokens] = useState<ApiTokenInfo[] | null>(null);
  const [mcpUrl, setMcpUrl] = useState(`${location.origin}/mcp`);
  const [label, setLabel] = useState('');
  const [fresh, setFresh] = useState<{ token: ApiTokenInfo; secret: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revoking, setRevoking] = useState<ApiTokenInfo | null>(null);
  const [tab, setTab] = useState('claude-code');

  const load = () =>
    mcpApi
      .list()
      .then((r) => {
        setTokens(r.tokens);
        setMcpUrl(r.mcpUrl);
      })
      .catch((e) => setError(errorText(e)));
  useEffect(() => {
    void load();
  }, []);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await mcpApi.create(label.trim() || 'KI-Assistent');
      setFresh({ token: r.token, secret: r.secret });
      setMcpUrl(r.mcpUrl);
      setLabel('');
      await load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    if (!revoking) return;
    setBusy(true);
    try {
      await mcpApi.revoke(revoking.id);
      if (fresh?.token.id === revoking.id) setFresh(null);
      setRevoking(null);
      await load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const setups = fresh ? mcpSetups(mcpUrl, fresh.secret) : [];
  const active = setups.find((s) => s.id === tab) ?? setups[0];

  return (
    <div className="mcp-panel" data-testid="mcp-panel">
      <p className="mcp-intro">
        Mit einem persönlichen Token kann ein KI-Assistent (z. B. Claude) deine Boards lesen, gestalten und als Bild ansehen – live für alle sichtbar als
        „KI (für dich)“. Das Token hat deine Rechte: gib es nicht weiter.
      </p>

      {fresh && active && (
        <section className="mcp-fresh" aria-labelledby="mcp-fresh-h" data-testid="mcp-fresh">
          <h3 id="mcp-fresh-h">Token „{fresh.token.label}“ ist angelegt</h3>
          <p className="mcp-note">Jetzt kopieren – es wird nur dieses eine Mal angezeigt.</p>
          <CopyBlock code={fresh.secret} label="API-Token" />
          <div className="mcp-tabs" role="tablist" aria-label="Einrichtung">
            {setups.map((s) => (
              <button key={s.id} role="tab" aria-selected={s.id === active.id} className={`mcp-tab${s.id === active.id ? ' is-active' : ''}`} onClick={() => setTab(s.id)}>
                {s.title}
              </button>
            ))}
          </div>
          <p className="mcp-note">{active.hint}</p>
          <CopyBlock code={active.code} label={`Einrichtung ${active.title}`} />
        </section>
      )}

      <p className="mcp-privacy" role="note" data-testid="mcp-privacy-note">
        <strong>Bitte beachten:</strong> {MCP_PRIVACY_NOTE}
      </p>

      <form className="mcp-new" onSubmit={create}>
        <div className="field">
          <label htmlFor="mcp-label">Neues Token</label>
          <input id="mcp-label" className="input" value={label} maxLength={60} placeholder="z. B. Claude Code am Laptop" onChange={(e) => setLabel(e.target.value)} data-autofocus />
        </div>
        <button className="btn btn--primary" disabled={busy}>
          Token anlegen
        </button>
      </form>

      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}

      <section aria-labelledby="mcp-list-h">
        <h3 id="mcp-list-h" className="mcp-h">
          Deine Tokens
        </h3>
        {tokens === null ? (
          <p className="mcp-note">Lade …</p>
        ) : tokens.length === 0 ? (
          <p className="mcp-note">Noch keine. Lege oben eins an.</p>
        ) : (
          <ul className="mcp-list">
            {tokens.map((t) => (
              <li key={t.id} data-testid="mcp-token">
                <div>
                  <strong>{t.label}</strong>
                  <span className="mcp-meta">
                    …{t.hint} · angelegt {new Date(t.createdAt).toLocaleDateString('de-DE')} · {agoText(t.lastUsedAt)}
                    {t.expiresAt && <> · verfällt am {new Date(t.expiresAt).toLocaleDateString('de-DE')}</>}
                  </span>
                </div>
                <button className="btn btn--ghost btn--sm" onClick={() => setRevoking(t)} aria-label={`Token „${t.label}“ widerrufen`}>
                  Widerrufen
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {revoking && (
        <ConfirmDialog
          title="Token widerrufen?"
          text={`„${revoking.label}“ funktioniert danach sofort nicht mehr; ein verbundener Assistent verliert den Zugriff.`}
          confirmLabel="Widerrufen"
          danger
          busy={busy}
          onConfirm={() => void revoke()}
          onCancel={() => setRevoking(null)}
        />
      )}
    </div>
  );
}

export function McpDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="KI-Zugang (MCP)" onClose={onClose} labelledBy="mcp-title">
      <McpAccessPanel />
      <div className="modal-actions">
        <button className="btn btn--ghost btn--sm" onClick={onClose}>
          Schließen
        </button>
      </div>
    </Modal>
  );
}
