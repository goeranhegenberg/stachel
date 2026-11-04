# Stachel-MCP-Server: KI-Assistenten lesen und gestalten Boards (Streamable HTTP unter /mcp) und machen
# Bildschirmfotos mit Headless-Chromium. Bauen aus dem Repo-Root (braucht shared/ und web/src/):
#   docker build -f mcp/Dockerfile -t stachel-mcp .
# Doku: docs/features/mcp.md

# ---- Bauen (esbuild bündelt mcp/src samt mitbenutzter Dateien aus web/src und shared/) ----
# Reines JavaScript (keine nativen Module) → auf der Build-Plattform, auch für arm64-Images (Chromium kommt je Zielplattform)
FROM --platform=$BUILDPLATFORM node:26-bookworm-slim AS build
WORKDIR /app
COPY shared ./shared
COPY web/src ./web/src
COPY mcp/package.json mcp/package-lock.json ./mcp/
RUN cd mcp && npm ci --no-audit --no-fund
COPY mcp/build.mjs mcp/tsconfig.json ./mcp/
COPY mcp/bin ./mcp/bin
COPY mcp/src ./mcp/src
# Paket für die lokale Nutzung (`npx -y <PUBLIC_URL>/mcp/stachel-mcp.tgz`), danach nur Laufzeit-Abhängigkeiten
RUN cd mcp && node build.mjs && mkdir -p /app/pkg && npm pack --pack-destination /app/pkg && npm prune --omit=dev --no-audit --no-fund

# ---- Laufzeit: Node + nur Chromium (Headless Shell) passend zu playwright-core ----
FROM node:26-bookworm-slim
ARG VERSION=dev
ARG REVISION=unknown
LABEL org.opencontainers.image.title="Stachel MCP" \
      org.opencontainers.image.description="MCP server for Stachel: AI assistants read, design and screenshot whiteboards live" \
      org.opencontainers.image.source="https://github.com/goeranhegenberg/stachel" \
      org.opencontainers.image.url="https://github.com/goeranhegenberg/stachel" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}"
ENV NODE_ENV=production \
    PORT=8096 \
    HOST=0.0.0.0 \
    MCP_PATH=/mcp \
    MCP_TARBALL=/app/stachel-mcp.tgz \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app
COPY --from=build /app/mcp/package.json ./package.json
COPY --from=build /app/mcp/node_modules ./node_modules
# ffmpeg (Videoaufnahme, LGPL) braucht der MCP-Server nicht
RUN node node_modules/playwright-core/cli.js install --with-deps --only-shell chromium \
    && rm -rf /ms-playwright/ffmpeg* /var/lib/apt/lists/* /tmp/*
COPY --from=build /app/mcp/bin ./bin
COPY --from=build /app/mcp/dist/stachel-mcp.mjs ./dist/stachel-mcp.mjs
COPY --from=build /app/pkg/ /app/pkg/
RUN mv /app/pkg/stachel-mcp-*.tgz /app/stachel-mcp.tgz && rmdir /app/pkg
COPY LICENSE NOTICE THIRD_PARTY_NOTICES TRADEMARKS.md /usr/share/doc/stachel/
# Debian-Pakete samt Quellpaket und -version (Quellen über snapshot.debian.org, siehe THIRD_PARTY_NOTICES)
RUN dpkg-query -W -f='${binary:Package}\t${Version}\t${source:Package}\t${source:Version}\n' | sort > /usr/share/doc/stachel/debian-packages.tsv
USER node
EXPOSE 8096
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8096)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "dist/stachel-mcp.mjs", "serve"]
