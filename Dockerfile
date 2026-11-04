# Stachel – collaborative whiteboard (web app + realtime server) in one image.
#
#   docker run -d -p 8080:8080 -v stachel-data:/data ghcr.io/goeranhegenberg/stachel
#
# Defaults are made for self-hosting: own accounts (STACHEL_AUTH=local), port 8080, data in the volume /data.
# Configuration via environment variables, see README.md ("Configuration") and .env.example.
# Builds web/ and server/; runtime runs as the unprivileged user `node` (UID 1000) on node:22-bookworm-slim.

# Multi-Arch (amd64/arm64, .github/workflows/docker.yml): web/ und das Server-Bündel sind reines JavaScript und werden
# auf der Build-Plattform gebaut (schnell, ohne Emulation); nur die Laufzeit-Abhängigkeiten (sharp) kommen je Zielplattform.

# ---- Web-App (Vite) ----
FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS web
WORKDIR /app
COPY shared ./shared
COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci --no-audit --no-fund
COPY web ./web
RUN cd web && npm run build

# ---- Server (TypeScript, gebündelt mit esbuild samt mitbenutztem Web-Code für die Native-API) ----
FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS server
WORKDIR /app
COPY shared ./shared
COPY web/src ./web/src
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --no-audit --no-fund
COPY server/tsconfig.json server/tsconfig.web.json server/build.mjs ./server/
COPY server/src ./server/src
RUN cd server && npm run build

# ---- Laufzeit-Abhängigkeiten für die Zielplattform (sharp bringt native Binärdateien je Architektur mit) ----
FROM node:22-bookworm-slim AS server-deps
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
# sharp-wasm32 ist nur der Ersatz für Plattformen ohne eigene Binärdatei (libvips statisch als WebAssembly, LGPL);
# linux/amd64 und linux/arm64 laden @img/sharp-linux-* → weglassen (THIRD_PARTY_NOTICES, Quellangebot)
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force \
    && rm -rf node_modules/@img/sharp-wasm32 node_modules/@emnapi

# ---- Laufzeit ----
FROM node:22-bookworm-slim
ARG VERSION=dev
ARG REVISION=unknown
LABEL org.opencontainers.image.title="Stachel" \
      org.opencontainers.image.description="Self-hostable realtime whiteboard for teams: sticky notes, shapes, connectors, mind maps, comments, live cursors" \
      org.opencontainers.image.source="https://github.com/goeranhegenberg/stachel" \
      org.opencontainers.image.url="https://github.com/goeranhegenberg/stachel" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}"
# Standardwerte fürs Selbst-Hosting; die INTSODE-Instanzen setzen PORT, STACHEL_AUTH usw. in ihrer .env (deploy/intsode).
# COOKIE_SECURE folgt PUBLIC_URL (https → Secure-Cookies), PUBLIC_URL ohne Angabe = http://localhost:<PORT>.
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    WEB_DIST=/app/web/dist \
    STACHEL_AUTH=local
# Texterkennung für „Zettel abfotografieren“ (server/src/photo-notes.ts): Tesseract 5 mit Deutsch und Englisch, läuft
# offline als eigener Prozess (Apache-2.0); abschaltbar mit STACHEL_PHOTO_NOTES=0
RUN apt-get update \
    && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-deu tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app/server
COPY --from=server-deps --chown=root:root /app/server/package.json ./package.json
COPY --from=server-deps --chown=root:root /app/server/node_modules ./node_modules
COPY --from=server --chown=root:root /app/server/dist ./dist
# Schriften der Vorschaubilder (Barlow, OFL; thumbnails.ts richtet fontconfig darauf ein)
COPY --chown=root:root server/assets ./assets
COPY --from=web --chown=root:root /app/web/dist /app/web/dist
COPY LICENSE NOTICE THIRD_PARTY_NOTICES TRADEMARKS.md /usr/share/doc/stachel/
# `docker exec <container> stachel-admin users|verify <email>|reset-link <email>` (server/src/admin.ts)
# Debian-Pakete samt Quellpaket und -version (Quellen über snapshot.debian.org, siehe THIRD_PARTY_NOTICES)
RUN dpkg-query -W -f='${binary:Package}\t${Version}\t${source:Package}\t${source:Version}\n' | sort > /usr/share/doc/stachel/debian-packages.tsv \
    && printf '#!/bin/sh\nexec node --disable-warning=ExperimentalWarning /app/server/dist/server/src/index.js admin "$@"\n' > /usr/local/bin/stachel-admin \
    && chmod 755 /usr/local/bin/stachel-admin \
    && mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/server/src/index.js"]
