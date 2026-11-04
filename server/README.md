# Stachel-Server

Node 22 + TypeScript: Fastify (HTTP-API, Web-App), Hocuspocus unter `/sync` (Yjs-Sync), SQLite über das
eingebaute `node:sqlite` (kein natives Modul, baut überall). Vertrag: `../docs/contract.md`.

```bash
npm ci
npm run dev        # tsx watch, liest optional server/.env (z. B. STACHEL_AUTH, PUBLIC_URL)
npm test           # vitest: echter Server + lokaler Fake-Identitätsdienst (test/fake-org.ts), kein Netz
npm run typecheck
npm run build && npm start   # dist/server/src/index.js, liefert ../web/dist (WEB_DIST) mit aus
```

Env: `PORT` (8095), `PUBLIC_URL`, `STACHEL_AUTH` (`local` | `org` mit `STACHEL_ORG_*`, Vertrag §1), `DATA_DIR` (./data → `stachel.sqlite`, `images/`),
`COOKIE_SECURE`, `WEB_DIST` (../web/dist), `TRUST_PROXY` (loopback,uniquelocal), `ALLOWED_ORIGINS`, `LOG_LEVEL`.

Aufbau `src/`: `app.ts` (Routen, Header, SPA), `sync.ts` (Hocuspocus + WebSocket-Upgrade), `sessions.ts`,
`pairings.ts` (QR-Login), `org-identity.ts` (Identitätsdienst im Modus org), `template-packs.ts` (Vorlagen der Instanz), `images.ts` (Magic Bytes), `db.ts` (Schema).

## Host-nginx (board.example.org → 127.0.0.1:8095)

```nginx
client_max_body_size 16m;               # Bild-Upload bis 15 MB
location / {
    proxy_pass http://127.0.0.1:8095;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;  # /sync (WebSocket)
    proxy_set_header Connection $connection_upgrade;
    proxy_read_timeout 3600s;
}
```
(`$connection_upgrade` per `map $http_upgrade $connection_upgrade { default upgrade; '' close; }` im http-Block.)
Datenordner für den Container: `mkdir -p data && chown 1000:1000 data`.
