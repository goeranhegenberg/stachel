// Test-Sync-Server (Hocuspocus) pro Playwright-Worker auf einem freien Port vom Betriebssystem.
// Die Seite verbindet sich direkt dorthin (installFakeApi({ syncPort })), nicht über den Vite-Proxy:
// so kollidieren parallele Worker und gleichzeitige Läufe nicht mehr auf einem festen Port.
import { Server, type ServerConfiguration } from '@hocuspocus/server';

export async function startSyncServer(config: Partial<ServerConfiguration> = {}): Promise<{ server: Server; port: number }> {
  const server = new Server({ quiet: true, stopOnSignals: false, debounce: 50, ...config, port: 0 });
  await server.listen();
  return { server, port: server.address.port };
}
