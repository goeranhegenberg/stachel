# Self-hosting Stachel

Stachel is one container (web app + realtime server) with one data volume. This guide covers a production setup;
the variables are listed in the [README](../README.md#configuration).

## 1. Try it

```bash
docker run -d --name stachel -p 8080:8080 -v stachel-data:/data ghcr.io/goeranhegenberg/stachel
```

<http://localhost:8080> → register. Without SMTP the account is active immediately (`STACHEL_REQUIRE_VERIFICATION`
defaults to off without a mail server) and e-mails – including their links – appear in `docker logs stachel`.

## 2. Production with Docker Compose

```bash
git clone https://github.com/goeranhegenberg/stachel.git && cd stachel
cp .env.example .env && chmod 600 .env
```

Minimal `.env` for `https://board.example.org`:

```dotenv
PUBLIC_URL=https://board.example.org
STACHEL_DOMAIN=board.example.org
TRUST_PROXY=uniquelocal          # Caddy runs in the same compose network
STACHEL_TOKEN_KEY=...            # openssl rand -base64 32
STACHEL_IMPRINT_URL=https://example.org/imprint   # or put your texts into data/legal/ (see below)
STACHEL_PRIVACY_URL=https://example.org/privacy
# mail (recommended for public instances)
STACHEL_SMTP_HOST=smtp.example.org
STACHEL_SMTP_USER=noreply@example.org
STACHEL_SMTP_PASS=...
STACHEL_SMTP_FROM=Stachel <noreply@example.org>
```

```bash
docker compose --profile https up -d             # Stachel + Caddy (Let's Encrypt, ports 80/443)
docker compose --profile https --profile mcp up -d   # + MCP server under https://board.example.org/mcp
```

Requirements: Docker Compose 2.24+, DNS of the domain pointing to the host, ports 80 and 443 free.

### Behind your own reverse proxy

Run only the `stachel` service, publish it on localhost (`STACHEL_HTTP_PORT=127.0.0.1:8080`) and forward
**everything** to it, including WebSocket upgrades (`/sync`, `/native`). Set `TRUST_PROXY` to the address your proxy
connects from (e.g. `172.17.0.1` for a host nginx in front of the Docker bridge). nginx example:

```nginx
map $http_upgrade $connection_upgrade { default upgrade; '' close; }

server {
    server_name board.example.org;
    listen 443 ssl;
    # ssl_certificate …
    client_max_body_size 20m;            # images and PDFs up to 15 MB

    location /mcp {                      # optional MCP container
        proxy_pass http://127.0.0.1:8096;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_buffering off;
    }
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 1h;
    }
}
```

## 3. Accounts

- **Registration:** `STACHEL_REGISTRATION=open` (default) or `invite` (only people invited to a board by e-mail; the
  first account on a fresh instance may always register – that is you).
- **E-mail confirmation:** on when SMTP is configured, off without; force with `STACHEL_REQUIRE_VERIFICATION=1|0`.
- **Admin CLI** inside the container:

  ```bash
  docker exec stachel stachel-admin users                     # e-mail, name, confirmed?, created
  docker exec stachel stachel-admin verify ada@example.org    # confirm manually (e.g. no SMTP)
  docker exec stachel stachel-admin reset-link ada@example.org  # password link, valid 1 hour
  ```

  Outside Docker: `npm --prefix server run admin -- users`.
- Boards belong to their creator and are shared per e-mail or link (roles edit / comment / view). There is no global
  admin role; every person manages their own boards and account (incl. deleting it).
- **Login through an organisation instead** (`STACHEL_AUTH=org`): people do not register at Stachel; an organisation (club,
  company, event …) runs an identity service that Stachel asks for every login token (`STACHEL_ORG_IDENTITY_URL`, optional
  password login via `STACHEL_ORG_LOGIN_URL`, names in the UI from `STACHEL_ORG_NAME` / `STACHEL_ORG_APP_NAME`). Its app
  logs people in by QR code or opens Stachel directly. Interface: `docs/contract.md` §1 „Org-Token prüfen“, overview:
  `docs/features/accounts.md`. App links (`/.well-known/…`) only exist when you set `STACHEL_ANDROID_PACKAGE` /
  `STACHEL_IOS_APP_ID` (no defaults).

### Instance templates

Add your own templates to the gallery without touching code: put JSON files into `/data/templates/` (or
`STACHEL_TEMPLATES_DIR`). Everyone on the instance sees them under one category – `STACHEL_TEMPLATES_CATEGORY`, default
your `STACHEL_BRAND` (or „Weitere Vorlagen“). Changes are picked up within 30 s, no restart.

The easiest way to make one: build the template on a board, select it, „Auswahl als Vorlage speichern …“, then download
your own templates and copy the file into the folder:

```bash
curl -s -H "Authorization: Bearer stk_…" https://board.example.org/api/templates > my-templates.json   # token: board menu „KI-Zugang (MCP)“
docker cp my-templates.json stachel:/data/templates/
```

Format (one file may hold one template, a list, or `{"templates": [...]}`; `desc` and `keywords` are optional and feed the
gallery search):

```json
{ "templates": [
  { "id": "day-plan", "name": "Ablauf Sommerfest", "desc": "Aufbau bis Abbau", "keywords": ["fest"],
    "objects": [ { "id": "a", "type": "sticky", "x": 0, "y": 0, "w": 200, "h": 200, "color": "#fff27a", "text": "Aufbau" } ] }
] }
```

Same limits as personal templates (name ≤ 80 characters, ≤ 500 objects each), at most 200 templates and 5 MB per file;
invalid files or templates are skipped with a warning in the server log. Details: `docs/contract.md` §3 „Vorlagen der
Instanz“.

## 4. Backups

Everything lives in the data volume (`/data`):

| Path | Content |
|---|---|
| `stachel.sqlite` (+ `-wal`, `-shm`) | boards, Yjs documents, versions, accounts, sessions, comments |
| `images/` | uploaded images and PDFs |
| `image-variants/` | resized images (regenerated on demand, no backup needed) |
| `mail.log` | mails without SMTP (contains links – delete regularly) |
| `templates/` | instance templates (optional, your own JSON files) |

Consistent backup while running:

```bash
docker run --rm -v stachel-data:/data -v "$PWD":/backup alpine sh -c \
  'apk add --no-cache sqlite >/dev/null && sqlite3 /data/stachel.sqlite ".backup /backup/stachel.sqlite" && tar -C /data -czf /backup/images.tgz images'
```

Restore: stop the container, put `stachel.sqlite` and `images/` back into the volume (owner UID 1000), start again.

## 5. Updates

```bash
docker compose pull && docker compose up -d     # or: docker pull ghcr.io/goeranhegenberg/stachel && recreate
```

The database schema migrates itself on start. Pin a version with `STACHEL_VERSION=1.0.0` if you prefer controlled
upgrades; release notes are on the GitHub releases page.

## 6. Hardening checklist

See [SECURITY.md → Running your own instance](../SECURITY.md#running-your-own-instance): TLS, `TRUST_PROXY` only for your
proxy, ports on 127.0.0.1 behind a proxy, read-only container without capabilities (already in `docker-compose.yml`),
`STACHEL_TOKEN_KEY`, `chmod 600 .env`, backups, `invite` registration for public instances.

## 7. Without Docker

Node.js 22.13+:

```bash
cd web && npm ci && npm run build
cd ../server && npm ci && npm run build
STACHEL_AUTH=local PUBLIC_URL=https://board.example.org DATA_DIR=/var/lib/stachel node dist/server/src/index.js
```

The server serves `../web/dist` (`WEB_DIST`). Run it as an unprivileged user with a process manager (systemd).

## Import from Miro

People can copy their own boards from Miro into Stachel („Board importieren“ → „Aus Miro“ in the board list, the
Stachel app, or the MCP tool `import_miro_board`). Stachel reads the board through the public Miro REST API (v2, read
only) and creates a **new** board: sticky notes, shapes, text, cards, frames, images, PDFs, connectors, groups, tags and
mind maps; a report lists what was adjusted or left out. An import only runs when a person starts it, only for boards
their Miro access can see; there is no background sync, and no personal data (creators, assignees, members) is
taken over. Details: [`docs/features/import.md`](features/import.md).

Miro is a trademark of RealtimeBoard, Inc. Stachel is not affiliated with Miro. If you mention the import on your
instance, name Miro only as the source of the data („Import aus Miro“), without Miro's logo or colours and without
suggesting a partnership.

### Two ways to connect

**1. Personal access token – works out of the box.** Nothing to configure. The person creates an app in their own Miro
account (profile → *Settings* → *Your apps* → *Create new app*, permission `boards:read`, *Install app and get OAuth
token*), pastes the token into Stachel, picks boards. Stachel checks the token once, keeps it **only in memory** for at
most 60 minutes, bound to that person, and never writes it to the database or the log. Turn this way off with
`STACHEL_IMPORT_MIRO_TOKEN=off`; turn the whole import off with `STACHEL_IMPORT=off`.

**2. „Mit Miro verbinden“ (OAuth) – needs your own Miro app.** People click a button, confirm on Miro's page and are
back in Stachel – no token handling. Set it up once:

1. Log in to Miro (a free account is enough) → your profile picture → *Settings* → tab *Your apps* → *Create new app*.
   Miro may ask you to create a developer team first; do so.
2. App name: your instance name plus „Import“, e.g. „**Board Club Import**“. The name must **not** start with
   „Miro“ and must not look like an app made by Miro (Miro's app guidelines).
3. Tick **„Expire user authorization token“** (Miro then issues short-lived access tokens plus a refresh token).
4. *Redirect URI for OAuth2.0*: exactly `<PUBLIC_URL>/api/import/miro/callback`, e.g.
   `https://board.example.org/api/import/miro/callback`. The API always lives at the root of your domain – also when the
   web app runs under `STACHEL_BASE_PATH` (e.g. `/app`): it is still `https://board.example.org/api/import/miro/callback`.
   Only if Stachel must use a different address, set `MIRO_REDIRECT_URI` to the same value.
5. *Permissions*: only **`boards:read`**. Nothing else.
6. Copy *Client ID* and *Client secret* into your `.env`:

   ```dotenv
   MIRO_CLIENT_ID=3458764…
   MIRO_CLIENT_SECRET=…
   STACHEL_TOKEN_KEY=...            # recommended: openssl rand -base64 32
   ```

   `STACHEL_TOKEN_KEY` encrypts the stored refresh tokens (AES-256-GCM, bound to the account). Without it Stachel
   creates a key file `import-secret.key` in the data directory – then a backup of the data volume contains key and
   tokens together, so set the variable for public instances.
7. Restart: `docker compose up -d`. The import dialog now offers „Mit Miro verbinden“; `GET /api/import/sources`
   reports `"oauth": true`.

What Stachel stores for way 2: only the **refresh token**, encrypted, per account; the access token stays in memory.
„Verbindung trennen“ revokes it at Miro and deletes it, as does deleting the account; after 60 days without use it is
deleted (Miro lets refresh tokens expire after 60 days). Import reports are kept 30 days, are part of „Meine Daten
herunterladen“ and are deleted with the account.

**Miro's developer terms.** With your own Miro app **you** (the operator) become a party to Miro's
[Developer Terms of Use](https://miro.com/legal/developer-terms-of-use/) and its
[App Development Policy](https://developers.miro.com/docs/app-development-policy) – read them before you switch the
OAuth way on. Among other things they require a public privacy policy for your app, strong encryption of stored data and
deleting data after an app is removed, and they let Miro restrict or revoke apps at its own discretion (the policy also
limits the use of the API for products with overlapping features). If Miro blocks your app, only way 2 stops working;
the personal-token way does not depend on your app. Your privacy policy should cover the import – the template in
`deploy/legal-templates/datenschutz.html` has a section „Import aus Miro“.

### Variables

| Variable | Default | Description |
|---|---|---|
| `STACHEL_IMPORT` | `on` | `off`: no import at all (dialog, endpoints and MCP tool answer „import disabled“). |
| `STACHEL_IMPORT_MIRO_TOKEN` | `on` | `off`: people cannot paste personal access tokens (only „Mit Miro verbinden“, if configured). |
| `MIRO_CLIENT_ID`, `MIRO_CLIENT_SECRET` | – | Your Miro app; both set = „Mit Miro verbinden“ is offered. |
| `MIRO_REDIRECT_URI` | `<PUBLIC_URL>/api/import/miro/callback` | Only if it must differ; must match the app's redirect URI exactly. |
| `STACHEL_TOKEN_KEY` | – | Encrypts stored refresh tokens (otherwise `DATA_DIR/import-secret.key`). Recommended. |
| `STACHEL_IMPORT_CONCURRENCY` | `2` | Imports running at the same time on the instance (one per person). |
| `STACHEL_IMPORTS_PER_DAY` | `20` | Imported boards per person and day (`0` = unlimited). |
| `STACHEL_IMPORT_MAX_OBJECTS` | `20000` | Objects per imported board; the rest is listed in the report. |
| `STACHEL_IMPORT_MAX_IMAGES` | `1000` | Images and PDFs per imported board. Each one counts against `STACHEL_USER_QUOTA_MB`. |
| `STACHEL_IMPORT_MIRO_HOSTS` | – | Extra allowed file hosts for images/PDFs, comma separated, `*.` allowed (only if Miro moves its file storage). |

Imported boards also count against `STACHEL_MAX_BOARDS_PER_USER`; images and PDFs go through the same checks as uploads
(size `STACHEL_UPLOAD_MAX_MB`, type, metadata removal). The server only downloads from Miro's hosts over HTTPS (no
private addresses, at most 3 redirects).

## Imprint, privacy policy, terms of service

Stachel ships **no** legal texts. A public instance usually needs its own imprint, privacy policy and – with open
registration – terms of service. Either link existing pages (`STACHEL_IMPRINT_URL`, `STACHEL_PRIVACY_URL`,
`STACHEL_TERMS_URL`) or let Stachel serve them: copy the German templates from `deploy/legal-templates/` into the data
volume (`/data/legal/impressum.html`, `datenschutz.html`, `nutzungsbedingungen.html`), replace every `[placeholder]` and
have them checked. They appear under `/impressum`, `/datenschutz`, `/nutzungsbedingungen` (static, no external
requests) and are linked from the footer, registration, apps and e-mails. With `STACHEL_TERMS_VERSION` Stachel stores
which version people accepted and asks again after a change. Details: `docs/features/legal-pages.md`.
