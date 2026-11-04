import path from 'node:path';
import { QR_WAIT_SECONDS } from '../../shared/protocol.js';
import { loadInstance, type InstanceConfig } from './instance.js';
import { applyLegalDefaults, LEGAL_RESERVED, legalDirOf } from './legal-pages.js';
import { loadLimits, type Limits } from './limits.js';
import { loadTemplatePackConfig, type TemplatePackConfig } from './template-packs.js';

export interface Config {
  port: number;
  host: string;
  /** Domain der Instanz ohne Pfad (Origin): API, Sync, Native-API, App-Links und MCP liegen immer an ihrer Wurzel. */
  publicUrl: string;
  /**
   * Pfad der Web-App unter der Domain (STACHEL_BASE_PATH, z. B. `/app`; '' = Wurzel wie bisher), ohne `/` am Ende.
   * Nur die Web-App (index.html, Assets) und ihre Seitenadressen (`/app/?b=…`, `/app/b/<id>`, Mail-Links) wandern
   * dorthin, siehe site.ts und docs/features/website.md.
   */
  basePath: string;
  /** Produktseite unter `/` (STACHEL_LANDING=1, nur mit basePath), siehe site.ts */
  landing: LandingConfig;
  /** Modus org: Identitätsdienst (STACHEL_ORG_IDENTITY_URL, Pflicht) und optional Passwort-Anmeldung (STACHEL_ORG_LOGIN_URL) */
  orgIdentityUrl: string;
  orgLoginUrl: string;
  dataDir: string;
  cookieSecure: boolean;
  webDist: string;
  /** Proxy-Vertrauen für die Client-IP (Rate-Limit), Fastify-trustProxy-Syntax. */
  trustProxy: string | boolean;
  /** Zusätzlich erlaubte Origins für WebSocket (kommagetrennt). */
  allowedOrigins: string[];
  logLevel: string;
  /** STACHEL_TOKEN_KEY: Schlüssel für die Org-Tokens in SQLite (token-crypt.ts); leer = Klartext */
  tokenKey: string;
  /** Zeitlimits, in Tests verkürzbar. */
  qrWaitMs: number;
  syncDebounceMs: number;
  syncMaxDebounceMs: number;
  /** Zeitlimit je Aufruf des Identitätsdienstes (STACHEL_ORG_TIMEOUT_MS) */
  orgTimeoutMs: number;
  /** Wie oft offene Sync-Verbindungen ihre Sitzung nachprüfen (Logout, Ablauf, gesperrt). */
  syncRecheckMs: number;
  /** Versionsverlauf: höchstens so oft eine automatische Version, solange jemand arbeitet (versions.ts). */
  versionIntervalMs?: number;
  /**
   * App-Links (siehe well-known.ts): Android-Paket + Zertifikat-Fingerabdrücke, iOS-App-ID. Ohne Env keine; Modus org
   * nennt hier die App der Organisation, Modus local die Stachel-App.
   */
  androidPackage: string;
  androidSha256: string[];
  iosAppId: string;
  /** Adresse des MCP-Servers für KI-Assistenten (Anzeige in „KI-Zugang“); Standard `${publicUrl}/mcp`. */
  mcpUrl?: string;
  /** Betriebsart (org | local), Name, Impressum/Datenschutz, Mail (instance.ts) */
  instance: InstanceConfig;
  /** Rechtstexte der Instanz (legal-pages.ts): STACHEL_LEGAL_DIR, Standard `<DATA_DIR>/legal` */
  legalDir: string;
  /** Native-API (docs/contract.md §8): Mindestversion der Org-App (`hello.client = "org"`, null = keine) */
  nativeMinApp: string | null;
  /** dasselbe für die eigenständige Stachel-App (`hello.client = "stachel"`) */
  nativeMinStachelApp: string | null;
  /** so lange bleibt ein Board-Spiegel ohne App-Verbindung geladen (Resume nach Funkloch) */
  nativeIdleMs: number;
  /** Sandbox-Aktionen der Native-API (`dev.*`, Vertrag §8.12) – Env STACHEL_NATIVE_DEV_ACTIONS=1 */
  nativeDevActions: boolean;
  /** Vorlagen der Instanz aus `*.json` (template-packs.ts: STACHEL_TEMPLATES_DIR, STACHEL_TEMPLATES_CATEGORY) */
  templatePacks: TemplatePackConfig;
  /** Quoten und Raten gegen Missbrauch (limits.ts: STACHEL_USER_QUOTA_MB, STACHEL_UPLOAD_MAX_MB, …) */
  limits: Limits;
  /** Ringpuffer für Resume: höchstens so viele Patches und so alt */
  nativeBufferMax: number;
  nativeBufferMs: number;
  /** Import aus anderen Whiteboards (docs/features/import.md §5, server/src/import/) */
  import: ImportConfig;
}

/** Import aus Miro (docs/features/import.md §5). */
export interface ImportConfig {
  /** STACHEL_IMPORT ≠ off */
  enabled: boolean;
  /** persönliches Zugriffstoken einfügen (STACHEL_IMPORT_MIRO_TOKEN ≠ off) */
  tokenEnabled: boolean;
  /** „Mit Miro verbinden“: MIRO_CLIENT_ID und MIRO_CLIENT_SECRET gesetzt, Redirect Vorgabe <PUBLIC_URL>/api/import/miro/callback */
  oauth: { clientId: string; clientSecret: string; redirectUri: string } | null;
  /** gleichzeitige Importe der Instanz (STACHEL_IMPORT_CONCURRENCY) */
  concurrency: number;
  /** Boards je Person und Tag (STACHEL_IMPORTS_PER_DAY, 0 = unbegrenzt) */
  perDay: number;
  /** Objekte je Board (STACHEL_IMPORT_MAX_OBJECTS) */
  maxObjects: number;
  /** Bilder/Dokumente je Board (STACHEL_IMPORT_MAX_IMAGES) */
  maxImages: number;
  /** zusätzliche erlaubte Datei-Hosts (STACHEL_IMPORT_MIRO_HOSTS, `*.` erlaubt) */
  extraHosts: string[];
  /** REST-API (Standard https://api.miro.com; STACHEL_IMPORT_MIRO_API_BASE nur für Tests/Entwicklung) */
  apiBase: string;
  /** Freigabeseite (Standard https://miro.com; STACHEL_IMPORT_MIRO_AUTH_BASE nur für Tests/Entwicklung) */
  authBase: string;
  /**
   * Hosts (`host:port`) aus STACHEL_IMPORT_MIRO_API_BASE/-AUTH_BASE: dort sind auch http und lokale Adressen erlaubt
   * (Fake-Miro in Tests und Sandbox). Leer im Betrieb.
   */
  devHosts: string[];
}

export const MIRO_API_BASE = 'https://api.miro.com';
export const MIRO_AUTH_BASE = 'https://miro.com';

/** Abschnitt `import` aus der Umgebung (docs/features/import.md §5). */
export function loadImportConfig(env: NodeJS.ProcessEnv, publicUrl: string): ImportConfig {
  const off = (v: string | undefined) => (v ?? '').trim().toLowerCase() === 'off' || (v ?? '').trim() === '0' || (v ?? '').trim().toLowerCase() === 'false';
  const num = (v: string | undefined, def: number, min: number, max: number) => {
    const n = Number(str(v, String(def)));
    if (!Number.isFinite(n) || n < 0) throw new Error(`Ungültiger Wert „${v}“: erwartet eine Zahl ≥ 0`);
    return Math.min(max, Math.max(min, Math.floor(n)));
  };
  const devBase = (v: string | undefined): string | null => {
    const s = (v ?? '').trim();
    if (!s) return null;
    let u: URL;
    try {
      u = new URL(s);
    } catch {
      throw new Error(`STACHEL_IMPORT_MIRO_*_BASE="${s}" ist keine Adresse (nur für Tests, z. B. http://127.0.0.1:8791).`);
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error(`STACHEL_IMPORT_MIRO_*_BASE="${s}": nur http(s).`);
    return u.origin;
  };
  const clientId = str(env.MIRO_CLIENT_ID, '');
  const clientSecret = str(env.MIRO_CLIENT_SECRET, '');
  const apiDev = devBase(env.STACHEL_IMPORT_MIRO_API_BASE);
  const authDev = devBase(env.STACHEL_IMPORT_MIRO_AUTH_BASE);
  return {
    enabled: !off(env.STACHEL_IMPORT),
    tokenEnabled: !off(env.STACHEL_IMPORT_MIRO_TOKEN),
    oauth:
      clientId && clientSecret
        ? { clientId, clientSecret, redirectUri: fullUrl(env.MIRO_REDIRECT_URI) || `${publicUrl}/api/import/miro/callback` }
        : null,
    concurrency: num(env.STACHEL_IMPORT_CONCURRENCY, 2, 1, 32),
    perDay: num(env.STACHEL_IMPORTS_PER_DAY, 20, 0, 100_000),
    maxObjects: num(env.STACHEL_IMPORT_MAX_OBJECTS, 20_000, 1, 1_000_000),
    maxImages: num(env.STACHEL_IMPORT_MAX_IMAGES, 1_000, 0, 100_000),
    extraHosts: (env.STACHEL_IMPORT_MIRO_HOSTS ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean),
    apiBase: apiDev ?? MIRO_API_BASE,
    authBase: authDev ?? MIRO_AUTH_BASE,
    devHosts: [apiDev, authDev].filter((x): x is string => !!x).map((o) => new URL(o).host.toLowerCase()),
  };
}

export interface LandingConfig {
  enabled: boolean;
  /** Quellcode (GitHub), STACHEL_REPO_URL; leer = „Quellcode folgt“ */
  repoUrl: string;
  /** Google Play, STACHEL_PLAY_URL; leer = „bald im Play Store“ */
  playUrl: string;
}

/** Erste Pfadteile, die der Server selbst an der Wurzel braucht – als STACHEL_BASE_PATH verboten. */
const RESERVED_BASE = new Set(['api', 'sync', 'native', '.well-known', 'mcp', 'qr', 'qr-fonts', 'b', 'verify', 'reset', 'auth', 'landing', 'assets', ...LEGAL_RESERVED]);

/**
 * STACHEL_BASE_PATH → '' oder `/seg[/seg…]` ohne `/` am Ende. Wirft bei unbrauchbaren Werten (Start bricht mit klarer
 * Meldung ab statt halb zu funktionieren).
 */
export function normalizeBasePath(raw: string | undefined): string {
  const s = (raw ?? '').trim().replace(/^\/+|\/+$/g, '');
  if (!s) return '';
  const segs = s.split('/');
  if (segs.some((g) => !/^[A-Za-z0-9._~-]+$/.test(g) || g === '.' || g === '..')) {
    throw new Error(`STACHEL_BASE_PATH="${raw}" ist kein gültiger Pfad. Erlaubt sind z. B. /app oder /stachel (Buchstaben, Ziffern, . _ ~ -).`);
  }
  if (RESERVED_BASE.has(segs[0]!.toLowerCase())) {
    throw new Error(`STACHEL_BASE_PATH="${raw}" kollidiert mit einem Server-Pfad (/${segs[0]}). Bitte einen anderen Pfad wählen, z. B. /app.`);
  }
  return `/${segs.join('/')}`;
}

/** Nur http(s)-Adressen übernehmen (die Produktseite verlinkt sie). */
function httpUrl(v: string | undefined): string {
  const s = (v ?? '').trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString().replace(/\/+$/, '') : '';
  } catch {
    return '';
  }
}

/** http(s)-Adresse unverändert (mit Pfad und Query) übernehmen, sonst leer. */
function fullUrl(v: string | undefined): string {
  const s = (v ?? '').trim();
  if (!/^https?:\/\//i.test(s)) return '';
  try {
    new URL(s);
    return s;
  } catch {
    return '';
  }
}

function bool(v: string | undefined, def: boolean): boolean {
  if (v === undefined || v === '') return def;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

/** Leere Env-Werte gelten als nicht gesetzt. */
function str(v: string | undefined, def: string): string {
  return v === undefined || v.trim() === '' ? def : v.trim();
}

function trimSlash(s: string): string {
  return s.replace(/\/+$/, '');
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, overrides: Partial<Config> = {}): Config {
  // Standard nur loopback: wer hinter einem Proxy läuft, nennt genau dessen Adresse (sonst fälscht jeder Container im selben
  // Netz X-Forwarded-For und umgeht die Rate-Limits), z. B. TRUST_PROXY=172.17.0.1 für Host-nginx → Docker-Bridge
  const trust = str(env.TRUST_PROXY, 'loopback');
  const port = Number(str(env.PORT, '8095'));
  // ohne PUBLIC_URL die lokale Adresse (Selbst-Hosting zum Ausprobieren); Mail- und QR-Links brauchen die echte Adresse
  const publicUrl = trimSlash(str(env.PUBLIC_URL, `http://localhost:${port}`));
  const dataDir = path.resolve(str(env.DATA_DIR, './data'));
  const legalDir = legalDirOf(env, dataDir);
  // Rechtstexte im Ordner der Instanz verlinken sich selbst, wenn keine Adresse gesetzt ist (legal-pages.ts)
  const instance = applyLegalDefaults(loadInstance(env), publicUrl, legalDir);
  const cfg: Config = {
    port,
    host: str(env.HOST, '0.0.0.0'),
    publicUrl,
    basePath: normalizeBasePath(env.STACHEL_BASE_PATH),
    landing: { enabled: bool(env.STACHEL_LANDING, false), repoUrl: httpUrl(env.STACHEL_REPO_URL), playUrl: httpUrl(env.STACHEL_PLAY_URL) },
    // nur Modus org: Identitätsdienst der Organisation (Vertrag §1)
    orgIdentityUrl: fullUrl(env.STACHEL_ORG_IDENTITY_URL),
    orgLoginUrl: fullUrl(env.STACHEL_ORG_LOGIN_URL),
    dataDir,
    // Standard: Secure-Cookies genau dann, wenn die öffentliche Adresse https ist
    cookieSecure: bool(env.COOKIE_SECURE, publicUrl.startsWith('https:')),
    webDist: path.resolve(str(env.WEB_DIST, '../web/dist')),
    trustProxy: trust === 'true' ? true : trust === 'false' ? false : trust,
    allowedOrigins: (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => trimSlash(s.trim())).filter(Boolean),
    logLevel: str(env.LOG_LEVEL, 'info'),
    tokenKey: env.STACHEL_TOKEN_KEY ?? '',
    qrWaitMs: QR_WAIT_SECONDS * 1000,
    // Speichern 1 s nach der letzten Änderung (spätestens alle 10 s beim Dauertippen): Bei einem harten Absturz
    // (SIGKILL, OOM) geht höchstens ~1 s bestätigte Arbeit verloren; SIGTERM speichert ohnehin sofort.
    syncDebounceMs: 1_000,
    syncMaxDebounceMs: 10_000,
    orgTimeoutMs: Math.max(500, Number(str(env.STACHEL_ORG_TIMEOUT_MS, '8000')) || 8_000),
    syncRecheckMs: 5 * 60_000,
    androidPackage: str(env.STACHEL_ANDROID_PACKAGE, ''),
    androidSha256: (env.STACHEL_ANDROID_CERT_SHA256 ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    iosAppId: str(env.STACHEL_IOS_APP_ID, ''),
    ...(env.MCP_PUBLIC_URL?.trim() ? { mcpUrl: trimSlash(env.MCP_PUBLIC_URL.trim()) } : {}),
    instance,
    legalDir,
    nativeMinApp: env.STACHEL_NATIVE_MIN_APP?.trim() || null,
    nativeMinStachelApp: env.STACHEL_NATIVE_MIN_STACHEL_APP?.trim() || null,
    nativeIdleMs: 10 * 60_000,
    nativeDevActions: env.STACHEL_NATIVE_DEV_ACTIONS?.trim() === '1',
    limits: loadLimits(env),
    templatePacks: loadTemplatePackConfig(env, dataDir, instance.brand),
    nativeBufferMax: 1000,
    nativeBufferMs: 10 * 60_000,
    import: loadImportConfig(env, publicUrl),
  };
  return { ...cfg, ...overrides };
}
