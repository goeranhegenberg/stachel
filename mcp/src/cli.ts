// Einstieg: `stachel-mcp` (stdio, lokal) bzw. `stachel-mcp serve` (Streamable HTTP, im Container hinter nginx).
//
//   stachel-mcp --url https://stachel.example.org --token stk_…         (oder STACHEL_URL / STACHEL_TOKEN)
//   stachel-mcp serve --port 8096 --url http://stachel:8095             (Token je Anfrage im Authorization-Header)
//
// Weitere Optionen: --web-url (Web-App für Bildschirmfotos, Standard = --url), --browser (Chrome/Edge-Pfad),
// --host, --path (Standard /mcp), --tarball (Paket für `npx`, ausgeliefert unter <path>/stachel-mcp.tgz).
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Agent } from './agent';
import { startHttp } from './http';
import { Renderer } from './render/renderer';
import { StachelApi } from './stachel/api';
import { createMcpServer } from './tools';

function args(argv: string[]) {
  const out: Record<string, string | boolean> = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=', 2);
      if (v !== undefined) out[k!] = v;
      else if (argv[i + 1] && !argv[i + 1]!.startsWith('--')) out[k!] = argv[++i]!;
      else out[k!] = true;
    } else rest.push(a);
  }
  return { opts: out, rest };
}

const HELP = `stachel-mcp – MCP-Server für Stachel (KI gestaltet Boards live)

Lokal (stdio):  stachel-mcp --url https://stachel.example.org --token stk_…
Server (HTTP):  stachel-mcp serve --port 8096 --url http://127.0.0.1:8095

Umgebung: STACHEL_URL, STACHEL_TOKEN, STACHEL_WEB_URL, STACHEL_MCP_BROWSER, PORT, HOST, MCP_PATH, MCP_TARBALL`;

async function main() {
  const { opts, rest } = args(process.argv.slice(2));
  const str = (k: string, env: string, def?: string) => (typeof opts[k] === 'string' ? (opts[k] as string) : process.env[env] || def);
  if (opts.help || opts.h) {
    console.error(HELP);
    return;
  }
  const url = str('url', 'STACHEL_URL', 'http://localhost:8080')!;
  const renderer = new Renderer({ executablePath: str('browser', 'STACHEL_MCP_BROWSER'), timeoutMs: Number(process.env.STACHEL_MCP_SHOT_TIMEOUT_MS || 30_000) });
  if (rest[0] === 'serve') {
    const h = await startHttp({
      port: Number(str('port', 'PORT', '8096')),
      host: str('host', 'HOST', '0.0.0.0')!,
      stachelUrl: url,
      webUrl: str('web-url', 'STACHEL_WEB_URL'),
      path: str('path', 'MCP_PATH', '/mcp'),
      tarball: str('tarball', 'MCP_TARBALL'),
      renderer,
    });
    console.error(`stachel-mcp: Streamable HTTP auf ${h.url} → Stachel ${url}`);
    const stop = () => void h.close().then(() => process.exit(0));
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    return;
  }
  const token = str('token', 'STACHEL_TOKEN');
  if (!token) {
    console.error(`API-Token fehlt (--token oder STACHEL_TOKEN). Anlegen in Stachel → Board-Menü → „KI-Zugang (MCP)“.\n\n${HELP}`);
    process.exit(2);
  }
  const agent = new Agent(new StachelApi(url, token), renderer, str('web-url', 'STACHEL_WEB_URL', url));
  const server = createMcpServer(agent);
  await server.connect(new StdioServerTransport());
  const stop = async () => {
    await agent.close();
    await renderer.close();
    process.exit(0);
  };
  process.stdin.on('close', () => void stop());
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
