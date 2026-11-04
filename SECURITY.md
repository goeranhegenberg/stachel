# Security Policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

- **Preferred:** GitHub private vulnerability reporting –
  [Security → Report a vulnerability](https://github.com/goeranhegenberg/stachel/security/advisories/new).
- **E-mail:** goeran@intsode.com (subject “Stachel security”).

Please include a description, the affected version (Docker image tag or commit), steps to reproduce and – if possible –
a proof of concept. What happens next:

- acknowledgement within **7 days**,
- a fix (and a note in the release notes / changelog) as soon as possible,
- coordinated disclosure: we publish details once a fix is available, at the latest **90 days** after the report.

## Supported versions

Only the current `main` branch and the latest Docker image (`ghcr.io/goeranhegenberg/stachel:latest`, newest version
tag) receive security fixes. Please update before reporting.

## Security model (summary)

- A threat model and an internal security review (2026-11-02) exist; they will be published under `docs/security/`
  once the remaining findings are fixed.
- **Central authorization** in `server/src/access.ts`: REST guard for every board route; realtime sync (Yjs) enforces
  roles on the server – `view` is read-only, `comment` may only change comment structures; the native API (apps) applies
  the same role filter.
- **Secrets at rest:** sessions, app tokens, API tokens (AI/MCP) and e-mail link tokens are stored only as SHA-256
  hashes; passwords with scrypt; login tokens of the `org` mode encrypted with `STACHEL_TOKEN_KEY` (AES-256-GCM).
- **CSRF:** state-changing `/api` requests need the header `X-Stachel: 1`; WebSocket origins are checked against
  `PUBLIC_URL`.
- **Browser:** Content-Security-Policy `default-src 'self'` (no third-party scripts, fonts or trackers); the server never
  fetches user-supplied URLs.
- Registration uses a proof-of-work captcha (no third party) and rate limits per IP and e-mail address.

## Running your own instance

- Run Stachel behind a **TLS reverse proxy** (Caddy profile in `docker-compose.yml`, nginx, Traefik) and set
  `PUBLIC_URL=https://…`; Secure cookies follow automatically (`COOKIE_SECURE` defaults to true for https).
- `TRUST_PROXY`: trust **only your own proxy** (default `loopback`; e.g. `172.17.0.1` for a host nginx in front of the
  Docker bridge). Never trust whole private networks on a shared Docker host – otherwise any container can forge
  `X-Forwarded-For` and bypass the rate limits.
- Publish ports only on `127.0.0.1` when a proxy on the same host terminates TLS (`"127.0.0.1:8080:8080"`).
- Container hardening (already in `docker-compose.yml`): `read_only`, `cap_drop: [ALL]`, `no-new-privileges`,
  `mem_limit`, log rotation. The image runs as the unprivileged user `node` (UID 1000).
- Set `STACHEL_TOKEN_KEY` (`openssl rand -base64 32`). Keep `.env` private (`chmod 600 .env`) and the data directory
  (`chmod 700`, owned by UID 1000 for bind mounts).
- **Backups:** `sqlite3 data/stachel.sqlite ".backup stachel-backup.sqlite"` (consistent while running) plus the folder
  `data/images/` (uploaded images and PDFs; `data/image-variants/` is regenerated); see
  [`docs/selfhosting.md`](docs/selfhosting.md#backups).
- Open registration (`STACHEL_REGISTRATION=open`) lets anyone create an account and upload images/PDFs without a quota.
  For public instances consider `STACHEL_REGISTRATION=invite` (only people invited to a board; the first account may
  always register).
- Without SMTP, e-mail confirmation is off by default (`STACHEL_REQUIRE_VERIFICATION`) and mail links appear in the server
  log – fine for a private instance, configure SMTP for public ones.
- The optional MCP container runs Chromium with `--no-sandbox`; the container is the sandbox: keep it on its own network,
  without capabilities and with a memory limit (as in `docker-compose.yml`).

---

## Sicherheitslücken melden (Deutsch)

Bitte **kein öffentliches Issue**. Am liebsten über GitHub („Security → Report a vulnerability“), sonst per Mail an
goeran@intsode.com mit Beschreibung, betroffener Version (Image-Tag oder Commit) und Schritten zum Nachstellen.
Wir bestätigen den Eingang innerhalb von 7 Tagen, beheben so schnell wie möglich und veröffentlichen Einzelheiten
abgestimmt, spätestens 90 Tage nach der Meldung. Unterstützt wird nur der aktuelle Stand (`main`, neuestes Image).
Hinweise für den eigenen Betrieb stehen oben unter „Running your own instance“.
