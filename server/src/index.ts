import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const cfg = loadConfig();
// `index.js admin <befehl>`: Konten verwalten statt Server starten (admin.ts, im Image `stachel-admin`)
if (process.argv[2] === 'admin') {
  const { runAdmin } = await import('./admin.js');
  process.exit(runAdmin(process.argv.slice(3), cfg));
}
const { app, close } = await buildApp(cfg);
await app.listen({ port: cfg.port, host: cfg.host });

let stopping = false;
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    if (stopping) return;
    stopping = true;
    app.log.info(`${sig}: fahre herunter`);
    close()
      .then(() => process.exit(0))
      .catch((e) => {
        app.log.error(e);
        process.exit(1);
      });
  });
}
