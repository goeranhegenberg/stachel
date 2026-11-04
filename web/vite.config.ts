import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { licensesPlugin } from './src/build/licenses';

/**
 * Legt neben jede Text-Datei des Builds eine vorkomprimierte `.br`- und `.gz`-Fassung. Der Server liefert sie mit
 * `@fastify/static` und `preCompressed: true` je nach Accept-Encoding aus (ohne Rechenzeit pro Abruf). Ohne Kompression
 * gehen Editor + Tiptap mit ≈ 1,3 MB statt ≈ 0,35 MB über die Leitung (am Handy mit 4G mehrere Sekunden).
 * Schriften (woff/woff2) und Bilder sind schon komprimiert, Quellkarten (.map) lädt nur das Entwicklerwerkzeug.
 */
function precompress(): Plugin {
  let outDir = 'dist';
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
  return {
    name: 'stachel-precompress',
    apply: 'build',
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    closeBundle() {
      for (const file of walk(outDir)) {
        // .mjs: pdf.js-Worker (features/documents/pdf.ts), .bcmap: dessen Zeichensatz-Tabellen
        if (!/\.(js|mjs|css|html|svg|json|webmanifest|txt|bcmap)$/.test(file)) continue;
        const raw = readFileSync(file);
        if (raw.length < 1024) continue;
        writeFileSync(`${file}.br`, brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: raw.length } }));
        writeFileSync(`${file}.gz`, gzipSync(raw, { level: 9 }));
      }
    },
  };
}

const SERVER = process.env.STACHEL_SERVER ?? 'http://localhost:8095';

export default defineConfig({
  // pfadneutral: dasselbe Bündel läuft unter / und unter STACHEL_BASE_PATH, z. B. /app/
  // (stachel.intsode.com, server/src/site.ts); Assets, Chunks, Worker und Schriften werden relativ geladen
  base: './',
  // licenses.txt (Lizenzen der mitgelieferten Software, Link „Lizenzen“ im Fuß) vor dem Vorkomprimieren
  plugins: [react(), licensesPlugin(fileURLToPath(new URL('./node_modules', import.meta.url))), precompress()],
  server: {
    port: Number(process.env.PORT ?? 5173),
    // shared/ liegt eine Ebene höher
    fs: { allow: ['..'] },
    proxy: {
      '/api': { target: SERVER, changeOrigin: false },
      '/sync': { target: SERVER.replace(/^http/, 'ws'), ws: true },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rolldownOptions: {
      output: {
        // große Bibliotheken als eigene Pakete: ändern sich selten, bleiben im Browser-Cache
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 3 },
            { name: 'yjs', test: /node_modules[\\/](yjs|lib0|y-protocols|@hocuspocus)[\\/]/, priority: 2 },
          ],
        },
      },
    },
  },
});
