// App-Links: Ein Tipp auf einen Stachel-Link öffnet am Handy direkt die App (statt der Webseite).
// - Modus org → App der Organisation (STACHEL_ANDROID_PACKAGE / STACHEL_IOS_APP_ID): `{PUBLIC_URL}/qr/<code>` (Code
//   bestätigen wie ein gescannter QR-Code) und `{PUBLIC_URL}/b/<id>` (Board öffnen).
// - Modus local (stachel.intsode.com) → Stachel-App (com.intsode.stachel): `/b/<id>`, `/verify/<token>` (E-Mail
//   bestätigen) und `/reset/<token>` (Passwort zurücksetzen); ohne App leitet der Server diese Pfade ins Web um.
// - Android: `/.well-known/assetlinks.json`, Fingerabdrücke des Signier-Schlüssels aus `STACHEL_ANDROID_CERT_SHA256`
//   (kommagetrennt, z. B. Upload-Schlüssel und Play App Signing). Leer → 404 (keine App-Links).
// - iOS: `/.well-known/apple-app-site-association` (Universal Links für die Pfade oben, mit STACHEL_BASE_PATH zusätzlich
//   unter dem Pfad, z. B. `/app/b/*`; site.ts). Die Dateien selbst bleiben an der Wurzel.
// Beide ohne Sitzung und ohne Weiterleitung (sonst verwerfen Android/iOS die Datei), kurz cachebar.
import type { FastifyInstance } from 'fastify';
import type { Config } from './config.js';

const SHA256 = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;
/** Pfade, die die App übernimmt, je Modus (iOS; Android regelt das im Manifest der App). */
export const APP_LINK_PATHS: Record<'org' | 'local', readonly string[]> = {
  org: ['/qr/*', '/b/*'],
  local: ['/b/*', '/verify/*', '/reset/*'],
};

/** JSON für assetlinks.json oder null (keine gültigen Fingerabdrücke eingerichtet). */
export function assetLinksJson(cfg: Pick<Config, 'androidPackage' | 'androidSha256'>): string | null {
  const prints = [...new Set(cfg.androidSha256.map((s) => s.trim().toUpperCase()).filter((s) => SHA256.test(s)))];
  if (!cfg.androidPackage || !prints.length) return null;
  return JSON.stringify([
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: cfg.androidPackage, sha256_cert_fingerprints: prints },
    },
  ]);
}

/** Pfade, die die App übernimmt: ohne Präfix (ältere Links) und mit STACHEL_BASE_PATH (`/app/b/*`), außer der QR-Seite. */
export function appLinkPaths(auth: 'org' | 'local', basePath = ''): string[] {
  const paths = APP_LINK_PATHS[auth];
  return basePath ? [...paths, ...paths.filter((p) => !p.startsWith('/qr/')).map((p) => `${basePath}${p}`)] : [...paths];
}

/** JSON für apple-app-site-association oder null (keine App-ID). */
export function appleAppSiteAssociation(cfg: Pick<Config, 'iosAppId'> & { basePath?: string; instance: Pick<Config['instance'], 'auth'> }): string | null {
  if (!cfg.iosAppId) return null;
  const paths = appLinkPaths(cfg.instance.auth, cfg.basePath);
  return JSON.stringify({ applinks: { details: [{ appIDs: [cfg.iosAppId], components: paths.map((p) => ({ '/': p })) }] } });
}

export function registerWellKnown(app: FastifyInstance, cfg: Config) {
  const serve = (path: string, body: () => string | null) =>
    app.get(path, async (_req, reply) => {
      const json = body();
      if (!json) return reply.code(404).type('text/plain; charset=utf-8').send('Nicht gefunden.');
      return reply.header('Cache-Control', 'public, max-age=300').type('application/json').send(json);
    });
  serve('/.well-known/assetlinks.json', () => assetLinksJson(cfg));
  serve('/.well-known/apple-app-site-association', () => appleAppSiteAssociation(cfg));
}
